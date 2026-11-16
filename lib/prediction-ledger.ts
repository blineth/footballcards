import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"

export type LedgerFixture={
  id?:string|null;competition?:string|null;kickoff?:string|null;date?:string|null;
  home?:string|null;away?:string|null
}
export type LedgerLeg={
  fixture?:LedgerFixture|null;
  playerName?:string|null;dbPlayerName?:string|null;team?:string|null;opponent?:string|null;
  market:string;label:string;threshold?:number|null;
  modelProbability:number;fairOdds?:number|null;bookmakerOdds?:number|null;confidence?:string|null;
  recent5HitRate?:number|null;seasonHitRate?:number|null;h2hHitRate?:number|null;h2hMatches?:number|null;sampleMatches?:number|null;
  disciplineHeat?:number|null;recentFouls10?:number|null;liveCurrentCount?:number|null;
  liveFouls?:number|null;liveFouled?:number|null;liveShots?:number|null;liveSot?:number|null;
}
export type LedgerRun={
  surface:string;
  fixture?:LedgerFixture|null;
  slip:{
    id:string;title?:string|null;tier?:string|null;oddsTarget?:string|null;
    combinedOdds?:number|null;modelJointProbability?:number|null;bookmaker?:string|null;
  };
  lineupConfirmed?:boolean;
  live?:boolean;liveMinute?:number|null;
  referee?:{name?:string|null;strictnessScore?:number|null}|null;
  legs:LedgerLeg[];
}

function norm(v:any){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function num(v:any){
  if(v==null||v==="")return null
  const n=Number(v);return Number.isFinite(n)?n:null
}
function fixtureDate(f?:LedgerFixture|null){
  if(f?.date&&/^\d{4}-\d{2}-\d{2}$/.test(f.date))return f.date
  if(f?.kickoff){
    const d=new Date(f.kickoff)
    if(Number.isFinite(d.getTime()))return d.toISOString().slice(0,10)
  }
  return null
}
function thresholdFromMarket(market:string,label:string,provided?:number|null){
  if(provided!=null&&Number.isFinite(Number(provided)))return Number(provided)
  // Live rows keep the base family key (e.g. foul1) while the displayed label
  // advances to the next unsettled threshold (e.g. 4+ fouls). Grade what was shown.
  const plus=String(label).match(/(\d+)\s*\+/)
  if(plus)return Number(plus[1])
  const explicit=String(market).match(/(?:foul|fouled|shot|sot|goal|assist)(\d+)$/i)
  return explicit?Number(explicit[1]):null
}
function opponentFor(team:string|null|undefined,fixture?:LedgerFixture|null){
  const t=norm(team),h=norm(fixture?.home),a=norm(fixture?.away)
  if(t&&h&&(t===h||t.includes(h)||h.includes(t)))return fixture?.away??null
  if(t&&a&&(t===a||t.includes(a)||a.includes(t)))return fixture?.home??null
  return null
}
function bucketKey(run:LedgerRun,now=Date.now()){
  const live=Boolean(run.live)
  const bucketMs=live?2*60*1000:15*60*1000
  const bucket=new Date(Math.floor(now/bucketMs)*bucketMs).toISOString()
  const fixturePart=run.fixture?.id??([run.fixture?.date,run.fixture?.home,run.fixture?.away].filter(Boolean).join("|")||"multi")
  return [run.surface,fixturePart,run.slip.id,run.liveMinute??"",bucket].join("|")
}

export async function savePredictionLedger(runs:LedgerRun[]){
  if(!isDatabaseConfigured||!runs.length)return {savedRuns:0,savedLegs:0}
  await ensureResearchSchema()
  let savedRuns=0,savedLegs=0
  for(const run of runs){
    if(!run?.slip?.id||!Array.isArray(run.legs)||!run.legs.length)continue
    const date=fixtureDate(run.fixture)
    const key=bucketKey(run)
    const inserted=await pool.query(
      `INSERT INTO prediction_runs (
        snapshot_key,surface,fixture_id,competition,fixture_date,kickoff,home_team,away_team,
        slip_id,slip_title,tier,odds_target,combined_odds,model_joint_probability,bookmaker,
        lineup_confirmed,live,live_minute,referee_name,referee_strictness,captured_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now()
      )
      ON CONFLICT (snapshot_key) DO NOTHING
      RETURNING id`,
      [
        key,run.surface,run.fixture?.id??null,run.fixture?.competition??null,date,
        run.fixture?.kickoff?new Date(run.fixture.kickoff):null,run.fixture?.home??null,run.fixture?.away??null,
        run.slip.id,run.slip.title??run.slip.id,run.slip.tier??null,run.slip.oddsTarget??null,
        num(run.slip.combinedOdds),num(run.slip.modelJointProbability),run.slip.bookmaker??null,
        Boolean(run.lineupConfirmed),Boolean(run.live),num(run.liveMinute),
        run.referee?.name??null,num(run.referee?.strictnessScore),
      ],
    )
    const runId=inserted.rows[0]?.id
    if(!runId)continue
    savedRuns++
    for(let i=0;i<run.legs.length;i++){
      const leg=run.legs[i]
      const legFixture=leg.fixture??run.fixture??null
      const legDate=fixtureDate(legFixture)
      const threshold=thresholdFromMarket(leg.market,leg.label,leg.threshold)
      await pool.query(
        `INSERT INTO prediction_legs (
          run_id,leg_index,fixture_id,competition,fixture_date,kickoff,home_team,away_team,
          player_name,db_player_name,player_team,opponent_team,market,threshold,label,
          model_probability,fair_odds,bookmaker_odds,confidence,
          recent5_hit_rate,season_hit_rate,h2h_hit_rate,h2h_matches,sample_matches,
          discipline_heat,recent_fouls_10,live_current_count,live_fouls,live_fouled,live_shots,live_sot
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
        )`,
        [
          runId,i,legFixture?.id??null,legFixture?.competition??null,legDate,
          legFixture?.kickoff?new Date(legFixture.kickoff):null,legFixture?.home??null,legFixture?.away??null,
          leg.playerName??null,leg.dbPlayerName??null,leg.team??null,leg.opponent??opponentFor(leg.team,legFixture),
          leg.market,threshold,leg.label,leg.modelProbability,num(leg.fairOdds),num(leg.bookmakerOdds),leg.confidence??null,
          num(leg.recent5HitRate),num(leg.seasonHitRate),num(leg.h2hHitRate),num(leg.h2hMatches),num(leg.sampleMatches),
          num(leg.disciplineHeat),num(leg.recentFouls10),num(leg.liveCurrentCount),
          num(leg.liveFouls),num(leg.liveFouled),num(leg.liveShots),num(leg.liveSot),
        ],
      )
      savedLegs++
    }
  }
  return {savedRuns,savedLegs}
}

function playerResult(row:any,market:string,threshold:number|null){
  const t=threshold??1
  if(market==="card")return {value:(row.yellow_card||row.red_card)?1:0,outcome:Boolean(row.yellow_card||row.red_card)}
  if(market.startsWith("fouled")){const value=Number(row.fouls_drawn??0);return {value,outcome:value>=t}}
  if(market.startsWith("foul")){const value=Number(row.fouls_committed??0);return {value,outcome:value>=t}}
  if(market.startsWith("sot")){const value=Number(row.shots_on_target??0);return {value,outcome:value>=t}}
  if(market.startsWith("shot")){const value=Number(row.shots??0);return {value,outcome:value>=t}}
  if(market.startsWith("goal")){const value=Number(row.goals??0);return {value,outcome:value>=t}}
  if(market.startsWith("assist")){const value=Number(row.assists??0);return {value,outcome:value>=t}}
  return null
}

async function matchScore(leg:any){
  const date=String(leg.fixture_date??"").slice(0,10)
  const home=String(leg.home_team??""),away=String(leg.away_team??"")
  if(!date||!home||!away)return null
  try{
    const ref=await pool.query(
      `SELECT home_team,away_team,home_score,away_score
       FROM referee_match_history
       WHERE fixture_date=$1
       ORDER BY updated_at DESC`,[date],
    )
    for(const row of ref.rows){
      const rh=norm(row.home_team),ra=norm(row.away_team),h=norm(home),a=norm(away)
      if((rh===h||rh.includes(h)||h.includes(rh))&&(ra===a||ra.includes(a)||a.includes(ra))){
        if(row.home_score!=null&&row.away_score!=null)return {home:Number(row.home_score),away:Number(row.away_score)}
      }
    }
  }catch{}
  try{
    const rows=(await pool.query(
      `SELECT team,opponent,SUM(COALESCE(goals,0))::int goals
       FROM player_h2h WHERE match_date=$1
       GROUP BY team,opponent`,[date],
    )).rows
    let hg:number|null=null,ag:number|null=null
    for(const row of rows){
      const t=norm(row.team),o=norm(row.opponent),h=norm(home),a=norm(away)
      if((t===h||t.includes(h)||h.includes(t))&&(o===a||o.includes(a)||a.includes(o)))hg=Number(row.goals??0)
      if((t===a||t.includes(a)||a.includes(t))&&(o===h||o.includes(h)||h.includes(o)))ag=Number(row.goals??0)
    }
    return hg!=null&&ag!=null?{home:hg,away:ag}:null
  }catch{return null}
}
function matchResult(market:string,score:{home:number;away:number}){
  if(market==="homeWin")return {value:score.home-score.away,outcome:score.home>score.away}
  if(market==="awayWin")return {value:score.away-score.home,outcome:score.away>score.home}
  if(market==="draw")return {value:score.home-score.away,outcome:score.home===score.away}
  if(market==="bttsYes")return {value:(score.home>0&&score.away>0)?1:0,outcome:score.home>0&&score.away>0}
  if(market==="bttsNo")return {value:(score.home===0||score.away===0)?1:0,outcome:score.home===0||score.away===0}
  return null
}

export async function gradePredictionLedger(limit=1500){
  if(!isDatabaseConfigured)return {graded:0,runsUpdated:0}
  await ensureResearchSchema()
  const pending=(await pool.query(
    `SELECT l.*,r.surface
     FROM prediction_legs l
     JOIN prediction_runs r ON r.id=l.run_id
     WHERE l.graded_at IS NULL
       AND COALESCE(l.kickoff,r.kickoff) < now()-interval '105 minutes'
     ORDER BY COALESCE(l.kickoff,r.kickoff) ASC NULLS LAST
     LIMIT $1`,[limit],
  )).rows
  let graded=0
  const touched=new Set<number>()
  for(const leg of pending){
    let result:any=null
    if(leg.player_name){
      const name=leg.db_player_name||leg.player_name
      const date=String(leg.fixture_date??"").slice(0,10)
      if(date){
        const rows=(await pool.query(
          `SELECT * FROM player_h2h WHERE player_name=$1 AND match_date=$2 ORDER BY minutes DESC NULLS LAST`,
          [name,date],
        )).rows
        let match=rows.find((r:any)=>{
          if(!leg.opponent_team)return true
          const a=norm(r.opponent),b=norm(leg.opponent_team)
          return a===b||a.includes(b)||b.includes(a)
        })??rows[0]
        if(!match&&leg.player_name!==name){
          const alt=(await pool.query(
            `SELECT * FROM player_h2h WHERE player_name=$1 AND match_date=$2 ORDER BY minutes DESC NULLS LAST`,
            [leg.player_name,date],
          )).rows
          match=alt[0]
        }
        if(match)result=playerResult(match,leg.market,leg.threshold==null?null:Number(leg.threshold))
      }
    }else{
      const score=await matchScore(leg)
      if(score)result=matchResult(leg.market,score)
    }
    if(!result)continue
    await pool.query(
      `UPDATE prediction_legs SET outcome=$1,result_value=$2,graded_at=now() WHERE id=$3`,
      [result.outcome,result.value,leg.id],
    )
    graded++
    touched.add(Number(leg.run_id))
  }
  let runsUpdated=0
  for(const runId of touched){
    const state=(await pool.query(
      `SELECT count(*)::int total,
              count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
              bool_and(COALESCE(outcome,false)) FILTER(WHERE graded_at IS NOT NULL) won
       FROM prediction_legs WHERE run_id=$1`,[runId],
    )).rows[0]
    const fully=Number(state?.total??0)>0&&Number(state?.graded??0)===Number(state?.total??0)
    if(fully){
      await pool.query(`UPDATE prediction_runs SET fully_graded=true,won=$1,graded_at=now() WHERE id=$2`,[Boolean(state?.won),runId])
      runsUpdated++
    }
  }
  return {graded,runsUpdated}
}

function n(v:any){return v==null?null:Number(v)}
function rowsToStats(rows:any[]){
  return rows.map(r=>{
    const sample=Number(r.sample??0),hits=Number(r.hits??0)
    const hitRate=sample?hits/sample:null
    const avgProbability=n(r.avg_probability)
    return {...r,sample,hits,hitRate,avgProbability,gap:hitRate!=null&&avgProbability!=null?hitRate-avgProbability:null}
  })
}

export async function predictionPerformanceSummary(days=30){
  if(!isDatabaseConfigured)return {available:false,days}
  await ensureResearchSchema()
  const [overall,byMarket,bySurface,byTier,byBand,byConfidence,recentMisses,recentRuns]=await Promise.all([
    pool.query(`SELECT
      count(*) FILTER(WHERE l.graded_at IS NOT NULL)::int graded_legs,
      count(*) FILTER(WHERE l.outcome IS TRUE)::int hits,
      avg(l.model_probability::numeric) FILTER(WHERE l.graded_at IS NOT NULL) avg_probability,
      avg((l.model_probability::numeric-CASE WHEN l.outcome THEN 1 ELSE 0 END)^2) FILTER(WHERE l.graded_at IS NOT NULL) brier,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded)::int graded_runs,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded AND r.won)::int winning_runs,
      count(DISTINCT r.id)::int total_runs
      FROM prediction_runs r LEFT JOIN prediction_legs l ON l.run_id=r.id
      WHERE r.captured_at>=now()-($1::int*interval '1 day')`,[days]),
    pool.query(`SELECT CASE
        WHEN market LIKE 'foul%' AND market NOT LIKE 'fouled%' THEN 'fouls'
        WHEN market LIKE 'fouled%' THEN 'fouled'
        WHEN market LIKE 'sot%' THEN 'sot'
        WHEN market LIKE 'shot%' THEN 'shots'
        WHEN market LIKE 'goal%' THEN 'goals'
        WHEN market LIKE 'assist%' THEN 'assists'
        WHEN market='card' THEN 'cards'
        WHEN market IN ('homeWin','awayWin','draw') THEN 'match result'
        WHEN market LIKE 'btts%' THEN 'btts'
        ELSE market END market_group,
      count(*)::int sample,count(*) FILTER(WHERE outcome IS TRUE)::int hits,
      avg(model_probability::numeric) avg_probability,
      avg(bookmaker_odds::numeric) FILTER(WHERE bookmaker_odds IS NOT NULL) avg_bookmaker_odds
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.graded_at IS NOT NULL AND r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY 1 ORDER BY sample DESC`,[days]),
    pool.query(`SELECT r.surface,
      count(*)::int sample,count(*) FILTER(WHERE l.outcome IS TRUE)::int hits,
      avg(l.model_probability::numeric) avg_probability,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded)::int graded_runs,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded AND r.won)::int winning_runs
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.graded_at IS NOT NULL AND r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY r.surface ORDER BY sample DESC`,[days]),
    pool.query(`SELECT COALESCE(r.odds_target,r.tier,r.slip_title) tier,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded)::int sample,
      count(DISTINCT r.id) FILTER(WHERE r.fully_graded AND r.won)::int hits,
      avg(r.model_joint_probability::numeric) FILTER(WHERE r.fully_graded) avg_probability,
      avg(r.combined_odds::numeric) FILTER(WHERE r.fully_graded) avg_odds
      FROM prediction_runs r
      WHERE r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY 1 HAVING count(DISTINCT r.id) FILTER(WHERE r.fully_graded)>0
      ORDER BY sample DESC`,[days]),
    pool.query(`SELECT
      (floor((model_probability::numeric*100)/10)*10)::int lower_bound,
      count(*)::int sample,count(*) FILTER(WHERE outcome IS TRUE)::int hits,
      avg(model_probability::numeric) avg_probability
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.graded_at IS NOT NULL AND r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY 1 ORDER BY 1`,[days]),
    pool.query(`SELECT COALESCE(confidence,'Unknown') confidence,
      count(*)::int sample,count(*) FILTER(WHERE outcome IS TRUE)::int hits,
      avg(model_probability::numeric) avg_probability
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.graded_at IS NOT NULL AND r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY 1 ORDER BY 1`,[days]),
    pool.query(`SELECT r.surface,r.captured_at,r.slip_title,r.odds_target,l.fixture_date,l.home_team,l.away_team,
      l.player_name,l.market,l.label,l.model_probability,l.bookmaker_odds,l.result_value,
      l.recent5_hit_rate,l.season_hit_rate,l.h2h_hit_rate,l.h2h_matches,l.discipline_heat
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.graded_at IS NOT NULL AND l.outcome IS FALSE
        AND r.captured_at>=now()-($1::int*interval '1 day')
      ORDER BY l.model_probability::numeric DESC,r.captured_at DESC LIMIT 40`,[days]),
    pool.query(`SELECT r.id,r.surface,r.captured_at,r.slip_title,r.odds_target,r.combined_odds,r.model_joint_probability,
      r.live,r.live_minute,r.fully_graded,r.won,r.home_team,r.away_team,
      count(l.id)::int legs,count(l.id) FILTER(WHERE l.outcome IS TRUE)::int hits,
      count(l.id) FILTER(WHERE l.graded_at IS NOT NULL)::int graded
      FROM prediction_runs r LEFT JOIN prediction_legs l ON l.run_id=r.id
      WHERE r.captured_at>=now()-($1::int*interval '1 day')
      GROUP BY r.id ORDER BY r.captured_at DESC LIMIT 60`,[days]),
  ])
  const o=overall.rows[0]??{}
  const gradedLegs=Number(o.graded_legs??0),hits=Number(o.hits??0)
  const gradedRuns=Number(o.graded_runs??0),winningRuns=Number(o.winning_runs??0)
  const markets=rowsToStats(byMarket.rows)
  const surfaces=bySurface.rows.map(r=>{
    const sample=Number(r.sample??0),h=Number(r.hits??0),gr=Number(r.graded_runs??0),wr=Number(r.winning_runs??0)
    return {surface:r.surface,sample,hits:h,hitRate:sample?h/sample:null,avgProbability:n(r.avg_probability),
      gradedRuns:gr,winningRuns:wr,runHitRate:gr?wr/gr:null}
  })
  const tiers=rowsToStats(byTier.rows)
  const probabilityBands=rowsToStats(byBand.rows).map(r=>({...r,label:String(r.lower_bound)+"–"+String(Number(r.lower_bound)+9)+"%"}))
  const confidence=rowsToStats(byConfidence.rows)
  const improvement=markets
    .filter(r=>r.sample>=5&&r.gap!=null)
    .sort((a,b)=>(a.gap??0)-(b.gap??0))
    .map(r=>({
      area:r.market_group,sample:r.sample,hitRate:r.hitRate,avgProbability:r.avgProbability,gap:r.gap,
      status:(r.gap??0)<-.12?"needs work":(r.gap??0)<-.05?"watch":"healthy",
    }))
  return {
    available:true,days,totalRuns:Number(o.total_runs??0),gradedLegs,hits,
    hitRate:gradedLegs?hits/gradedLegs:null,avgProbability:n(o.avg_probability),brier:n(o.brier),
    gradedRuns,winningRuns,runHitRate:gradedRuns?winningRuns/gradedRuns:null,
    byMarket:markets,bySurface:surfaces,byTier:tiers,probabilityBands,byConfidence:confidence,
    improvement,recentMisses:recentMisses.rows,recentRuns:recentRuns.rows,
  }
}
