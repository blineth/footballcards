import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"

export type TrackingLeg = {
  player:string
  dbPlayerName?:string|null
  team:string
  market:string
  label:string
  probability:number
  fairOdds?:number|null
  bookmakerOdds?:number|null
  bookmakerName?:string|null
  edge?:number|null
  confidence?:string|null
  priceSource?:"exact"|"estimated"|null
}

export type TrackingRecommendation = {
  fixture:{
    id:string
    competition:string
    kickoff:string
    home:{name:string}
    away:{name:string}
  }
  slip:{
    id:string
    title?:string
    bookmaker?:string|null
    legs:TrackingLeg[]
  }
  rank:number
  position:number
  confirmed:boolean
  placeable:boolean
}

function thresholdFromMarket(market:string,label:string){
  const m=market.match(/(?:foul|shot|sot)(\d+)$/i)
  if(m)return Number(m[1])
  const plus=label.match(/(\d+)\s*\+/)
  return plus?Number(plus[1]):null
}

function opponentFor(team:string,home:string,away:string){
  const n=(v:string)=>v.toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()
  const t=n(team),h=n(home),a=n(away)
  if(t&&h&&(t===h||t.includes(h)||h.includes(t)))return away
  if(t&&a&&(t===a||t.includes(a)||a.includes(t)))return home
  return null
}

export async function saveRecommendationSnapshots(recommendations:TrackingRecommendation[]){
  if(!isDatabaseConfigured||!recommendations.length)return
  await ensureResearchSchema()
  for(const rec of recommendations){
    const fixtureDate=new Date(rec.fixture.kickoff).toISOString().slice(0,10)
    const bookmaker=rec.slip.bookmaker??rec.slip.legs.find(l=>l.bookmakerName)?.bookmakerName??null
    const recommendationKey=[fixtureDate,rec.fixture.id,rec.slip.id,bookmaker??"none"].join("|")
    for(const leg of rec.slip.legs){
      const threshold=thresholdFromMarket(leg.market,leg.label)
      const opponent=opponentFor(leg.team,rec.fixture.home.name,rec.fixture.away.name)
      await pool.query(
        `INSERT INTO recommendation_snapshots (
          recommendation_key, fixture_id, competition, fixture_date, kickoff,
          home_team, away_team, slip_id, slip_title, recommendation_rank,
          is_top_pick, bookmaker, player_name, db_player_name, player_team,
          opponent_team, market, threshold, label, model_probability, fair_odds,
          bookmaker_odds, edge, price_source, confidence, lineup_confirmed,
          placeable, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,$25,$26,$27,now()
        )
        ON CONFLICT (recommendation_key, player_name, market, COALESCE(bookmaker, ''))
        DO UPDATE SET
          recommendation_rank=EXCLUDED.recommendation_rank,
          is_top_pick=EXCLUDED.is_top_pick,
          model_probability=EXCLUDED.model_probability,
          fair_odds=EXCLUDED.fair_odds,
          bookmaker_odds=EXCLUDED.bookmaker_odds,
          edge=EXCLUDED.edge,
          price_source=EXCLUDED.price_source,
          confidence=EXCLUDED.confidence,
          lineup_confirmed=EXCLUDED.lineup_confirmed,
          placeable=EXCLUDED.placeable,
          updated_at=now()`,
        [
          recommendationKey,rec.fixture.id,rec.fixture.competition,fixtureDate,new Date(rec.fixture.kickoff),
          rec.fixture.home.name,rec.fixture.away.name,rec.slip.id,rec.slip.title??rec.slip.id,
          rec.position,rec.position===1,bookmaker,leg.player,leg.dbPlayerName??null,leg.team,
          opponent,leg.market,threshold,leg.label,leg.probability,leg.fairOdds??null,
          leg.bookmakerOdds??null,leg.edge??null,leg.priceSource??null,leg.confidence??null,
          rec.confirmed,rec.placeable,
        ],
      )
    }
  }
}

function resultForMarket(row:any,market:string,threshold:number|null){
  const t=threshold??1
  if(market==="card")return {value:row.yellow_card?1:0,outcome:Boolean(row.yellow_card)}
  if(market.startsWith("fouled")){const value=Number(row.fouls_drawn??0);return {value,outcome:value>=t}}
  if(market.startsWith("foul")){const value=Number(row.fouls_committed??0);return {value,outcome:value>=t}}
  if(market.startsWith("sot")){const value=Number(row.shots_on_target??0);return {value,outcome:value>=t}}
  if(market.startsWith("shot")){const value=Number(row.shots??0);return {value,outcome:value>=t}}
  return null
}

export async function gradeHistoricalRecommendations(limit=500){
  if(!isDatabaseConfigured)return {graded:0}
  await ensureResearchSchema()
  const pending=await pool.query(
    `SELECT *
     FROM recommendation_snapshots
     WHERE graded_at IS NULL
       AND kickoff < now() - interval '105 minutes'
     ORDER BY kickoff ASC
     LIMIT $1`,[limit],
  )
  let graded=0
  for(const rec of pending.rows){
    const playerName=rec.db_player_name||rec.player_name
    const params:any[]=[playerName,rec.fixture_date]
    let sql=`SELECT * FROM player_h2h WHERE player_name=$1 AND match_date=$2`
    if(rec.opponent_team){params.push(rec.opponent_team);sql+=` AND lower(opponent)=lower($3)`}
    sql+=` ORDER BY minutes DESC NULLS LAST LIMIT 1`
    let match=(await pool.query(sql,params)).rows[0]
    if(!match&&rec.opponent_team){
      match=(await pool.query(
        `SELECT * FROM player_h2h
         WHERE player_name=$1 AND match_date=$2
         ORDER BY minutes DESC NULLS LAST LIMIT 1`,
        [playerName,rec.fixture_date],
      )).rows[0]
    }
    if(!match)continue
    const result=resultForMarket(match,rec.market,rec.threshold==null?null:Number(rec.threshold))
    if(!result)continue
    await pool.query(
      `UPDATE recommendation_snapshots
       SET outcome=$1,result_value=$2,graded_at=now(),updated_at=now()
       WHERE id=$3`,
      [result.outcome,result.value,rec.id],
    )
    graded+=1
  }
  return {graded}
}

function numeric(v:any){return v==null?null:Number(v)}

export async function recommendationTrackingSummary(days=30){
  if(!isDatabaseConfigured)return {available:false,days,gradedLegs:0}
  await ensureResearchSchema()
  const overall=await pool.query(
    `SELECT
       count(*) FILTER (WHERE graded_at IS NOT NULL)::int AS graded_legs,
       count(*) FILTER (WHERE outcome IS TRUE)::int AS hits,
       avg(model_probability::numeric) FILTER (WHERE graded_at IS NOT NULL) AS avg_probability,
       avg((model_probability::numeric - CASE WHEN outcome THEN 1 ELSE 0 END)^2)
         FILTER (WHERE graded_at IS NOT NULL) AS brier,
       count(*) FILTER (WHERE is_top_pick AND graded_at IS NOT NULL)::int AS top_pick_legs,
       count(*) FILTER (WHERE is_top_pick AND outcome IS TRUE)::int AS top_pick_hits,
       avg(model_probability::numeric) FILTER (WHERE is_top_pick AND graded_at IS NOT NULL) AS top_pick_avg_probability
     FROM recommendation_snapshots
     WHERE fixture_date >= (CURRENT_DATE - $1::int)`,[days],
  )
  const slips=await pool.query(
    `WITH grouped AS (
       SELECT recommendation_key,
              bool_and(graded_at IS NOT NULL) AS fully_graded,
              bool_and(COALESCE(outcome,false)) AS won,
              bool_or(is_top_pick) AS top_pick
       FROM recommendation_snapshots
       WHERE fixture_date >= (CURRENT_DATE - $1::int)
       GROUP BY recommendation_key
     )
     SELECT
       count(*) FILTER (WHERE fully_graded)::int AS complete_slips,
       count(*) FILTER (WHERE fully_graded AND won)::int AS winning_slips,
       count(*) FILTER (WHERE fully_graded AND top_pick)::int AS top_pick_slips,
       count(*) FILTER (WHERE fully_graded AND top_pick AND won)::int AS top_pick_winning_slips
     FROM grouped`,[days],
  )
  const exact=await pool.query(
    `SELECT
       count(*)::int AS sample,
       sum(CASE WHEN outcome THEN bookmaker_odds::numeric - 1 ELSE -1 END) AS profit_units
     FROM recommendation_snapshots
     WHERE fixture_date >= (CURRENT_DATE - $1::int)
       AND graded_at IS NOT NULL
       AND price_source='exact'
       AND bookmaker_odds IS NOT NULL
       AND placeable IS TRUE`,[days],
  )
  const byMarket=await pool.query(
    `SELECT market,
       count(*)::int AS sample,
       count(*) FILTER (WHERE outcome IS TRUE)::int AS hits,
       avg(model_probability::numeric) AS avg_probability,
       avg(bookmaker_odds::numeric) FILTER (WHERE bookmaker_odds IS NOT NULL AND price_source='exact') AS avg_exact_odds
     FROM recommendation_snapshots
     WHERE fixture_date >= (CURRENT_DATE - $1::int)
       AND graded_at IS NOT NULL
     GROUP BY market
     ORDER BY sample DESC`,[days],
  )
  const row=overall.rows[0]??{}
  const slipRow=slips.rows[0]??{}
  const exactRow=exact.rows[0]??{}
  const graded=Number(row.graded_legs??0)
  const hits=Number(row.hits??0)
  const topSample=Number(row.top_pick_legs??0)
  const topHits=Number(row.top_pick_hits??0)
  const completeSlips=Number(slipRow.complete_slips??0)
  const winningSlips=Number(slipRow.winning_slips??0)
  const topPickSlips=Number(slipRow.top_pick_slips??0)
  const topPickWinningSlips=Number(slipRow.top_pick_winning_slips??0)
  const exactSample=Number(exactRow.sample??0)
  const exactProfit=numeric(exactRow.profit_units)??0
  return {
    available:true,
    days,
    gradedLegs:graded,
    hits,
    hitRate:graded?hits/graded:null,
    avgProbability:numeric(row.avg_probability),
    brier:numeric(row.brier),
    topPickLegs:topSample,
    topPickHits:topHits,
    topPickHitRate:topSample?topHits/topSample:null,
    topPickAvgProbability:numeric(row.top_pick_avg_probability),
    completeSlips,
    winningSlips,
    slipHitRate:completeSlips?winningSlips/completeSlips:null,
    topPickSlips,
    topPickWinningSlips,
    topPickSlipHitRate:topPickSlips?topPickWinningSlips/topPickSlips:null,
    exactPriceLegs:exactSample,
    exactPriceProfitUnits:exactSample?exactProfit:null,
    exactPriceROI:exactSample?exactProfit/exactSample:null,
    byMarket:byMarket.rows.map(r=>({
      market:r.market,
      sample:Number(r.sample??0),
      hits:Number(r.hits??0),
      hitRate:Number(r.sample??0)?Number(r.hits??0)/Number(r.sample):null,
      avgProbability:numeric(r.avg_probability),
      avgExactOdds:numeric(r.avg_exact_odds),
    })),
  }
}
