import { NextResponse } from "next/server"
import { isDatabaseConfigured, pool } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"

export const dynamic="force-dynamic"
export const revalidate=0

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))return NextResponse.json({ok:false,error:"Expected date YYYY-MM-DD"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    const [runs,market,examples,history,recs]=await Promise.all([
      pool.query(`SELECT count(DISTINCT r.id)::int runs,count(l.id)::int legs,
        count(l.id) FILTER(WHERE l.graded_at IS NOT NULL)::int graded,
        count(l.id) FILTER(WHERE l.outcome IS TRUE)::int won,
        count(DISTINCT r.id) FILTER(WHERE r.fully_graded)::int graded_slips,
        count(DISTINCT r.id) FILTER(WHERE r.fully_graded AND r.won)::int winning_slips
        FROM prediction_runs r LEFT JOIN prediction_legs l ON l.run_id=r.id
        WHERE r.fixture_date=$1 OR r.id IN(SELECT run_id FROM prediction_legs WHERE fixture_date=$1)`,[date]),
      pool.query(`SELECT CASE WHEN l.market LIKE 'foul%' AND l.market NOT LIKE 'fouled%' THEN 'fouls' WHEN l.market LIKE 'fouled%' THEN 'fouled' WHEN l.market='card' THEN 'cards' WHEN l.market LIKE 'shot%' THEN 'shots' WHEN l.market LIKE 'sot%' THEN 'sot' ELSE l.market END market,
        count(*)::int predictions,count(*) FILTER(WHERE l.graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE l.outcome IS TRUE)::int won,
        round(avg(l.model_probability::numeric)*100,1) AS predicted_pct
        FROM prediction_legs l WHERE l.fixture_date=$1 GROUP BY 1 ORDER BY predictions DESC`,[date]),
      pool.query(`SELECT r.id AS run_id,r.surface,r.slip_title,r.tier,r.odds_target,r.live,r.live_minute,
        r.captured_at,r.home_team AS run_home,r.away_team AS run_away,r.fully_graded,r.won AS slip_won,
        l.leg_index,l.player_name,l.market,l.label,l.model_probability,l.bookmaker_odds,
        l.fixture_date,l.home_team,l.away_team,l.graded_at,l.outcome,l.result_value,
        l.live_current_count,l.live_fouls,l.live_fouled,
        h.fouls_committed AS actual_fouls,h.fouls_drawn AS actual_fouled,
        h.shots AS actual_shots,h.shots_on_target AS actual_sot,
        h.yellow_card AS actual_yellow,h.red_card AS actual_red,h.minutes AS actual_minutes
        FROM prediction_runs r JOIN prediction_legs l ON l.run_id=r.id
        LEFT JOIN LATERAL (
          SELECT h.* FROM player_h2h h
          WHERE h.match_date=l.fixture_date AND lower(h.player_name)=lower(COALESCE(l.db_player_name,l.player_name))
          ORDER BY (lower(coalesce(h.opponent,''))=lower(coalesce(l.opponent_team,''))) DESC,h.minutes DESC NULLS LAST LIMIT 1
        ) h ON l.player_name IS NOT NULL
        WHERE l.fixture_date=$1 AND (r.live=false OR r.surface IN ('multi_match','multi_combined','acca','legacy_recommended'))
        ORDER BY r.captured_at ASC,l.leg_index ASC LIMIT 150`,[date]),
      pool.query(`SELECT count(*)::int player_rows,count(DISTINCT player_name)::int players,
        count(DISTINCT opponent)::int opponents
        FROM player_h2h WHERE match_date=$1`,[date]),
      pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded
        FROM recommendation_snapshots WHERE fixture_date=$1`,[date]),
    ])
    return NextResponse.json({ok:true,date,summary:runs.rows[0],markets:market.rows,
      examples:examples.rows,playerHistory:history.rows[0],legacyRecommendations:recs.rows[0],
      updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Audit failed"},{status:500})}
}
