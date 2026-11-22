import { NextResponse } from "next/server"
import { pool,isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
export const dynamic="force-dynamic"
export const revalidate=0

const marketGroup="CASE WHEN market='card' THEN 'Yellow cards' WHEN market LIKE 'fouled%' THEN 'Fouls drawn' WHEN market LIKE 'foul%' THEN 'Fouls committed' WHEN market LIKE 'sot%' THEN 'Shots on target' WHEN market LIKE 'shot%' THEN 'Shots' WHEN market LIKE 'goal%' THEN 'Goals' WHEN market LIKE 'assist%' THEN 'Assists' WHEN market IN ('homeWin','awayWin','draw') THEN 'Match result' WHEN market LIKE 'btts%' THEN 'Both teams score' ELSE market END"
export async function GET(request:Request){
  const u=new URL(request.url)
  const days=Math.max(1,Math.min(365,Number(u.searchParams.get("days")??30)||30))
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Prediction database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    // Only the earliest published snapshot for a given player/event and surface is
    // counted. A refresh 20 seconds later must not count as another independent win.
    // Live and pre-match each remain separate evaluation populations.
    const cte=`WITH source AS (
      SELECT l.id,l.fixture_date,l.player_name,l.home_team,l.away_team,l.market,l.threshold,
        l.model_probability::float8 probability,l.outcome,l.graded_at,
        l.discipline_heat::float8 heat,l.recent_fouls_10::float8 recent_fouls,
        l.live_fouls::float8 live_fouls,l.live_fouled::float8 live_fouled,
        r.id run_id,r.captured_at,r.live,
        CASE WHEN COALESCE(l.kickoff,r.kickoff) IS NULL THEN 'unknown kickoff'
          WHEN r.live AND r.captured_at < COALESCE(l.kickoff,r.kickoff) THEN 'live before kickoff'
          WHEN NOT r.live AND r.captured_at >= COALESCE(l.kickoff,r.kickoff) THEN 'pre-match after kickoff'
          ELSE 'valid' END AS timing_quality,
        CASE WHEN r.live THEN 'live' ELSE 'pre-match' END AS phase,
        ${marketGroup} AS market_group,
        row_number() OVER (PARTITION BY CASE WHEN r.live THEN 'live' ELSE 'pre-match' END,
          l.fixture_date,coalesce(lower(l.home_team),''),coalesce(lower(l.away_team),''),
          coalesce(lower(l.player_name),'match'),l.market,coalesce(l.threshold,-1)
          ORDER BY r.captured_at,r.id,l.id) AS rank_first
      FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
      WHERE l.fixture_date >= CURRENT_DATE - $1::int AND l.fixture_date < CURRENT_DATE
        AND l.model_probability IS NOT NULL
    ), unique_picks AS (
      SELECT * FROM source WHERE rank_first=1 AND timing_quality='valid'
    )`
    const [phases,markets,confidence,signals,goals,walkForward,coverage,timing,featureCoverage]=await Promise.all([
      pool.query(cte+` SELECT phase,count(*)::int total,
        count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE outcome IS TRUE)::int hits,
        round(avg(probability) FILTER(WHERE graded_at IS NOT NULL)::numeric*100,1) avg_confidence,
        round(avg(power(probability-(CASE WHEN outcome THEN 1 ELSE 0 END),2)) FILTER(WHERE graded_at IS NOT NULL)::numeric,4) brier
        FROM unique_picks GROUP BY phase ORDER BY phase`,[days]),
      pool.query(cte+` SELECT phase,market_group,count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE outcome IS TRUE)::int hits,
        round(avg(probability) FILTER(WHERE graded_at IS NOT NULL)::numeric*100,1) avg_confidence
        FROM unique_picks GROUP BY phase,market_group ORDER BY phase,graded DESC`,[days]),
      pool.query(cte+` SELECT phase,
        CASE WHEN probability >= .75 THEN '75%+' WHEN probability>=.60 THEN '60–74%' WHEN probability>=.45 THEN '45–59%' ELSE 'Under 45%' END AS band,
        count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE outcome IS TRUE)::int hits,
        round(avg(probability) FILTER(WHERE graded_at IS NOT NULL)::numeric*100,1) avg_confidence
        FROM unique_picks GROUP BY phase,band ORDER BY phase,band`,[days]),
      pool.query(cte+` SELECT
        CASE WHEN heat>=.45 THEN 'Discipline heat ≥45'
             WHEN coalesce(recent_fouls,0)>=2 THEN '2+ recent fouls'
             WHEN coalesce(live_fouls,0)>=2 THEN '2+ fouls already'
             ELSE 'Other live cards' END AS signal,
        count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE outcome IS TRUE)::int hits,
        round(avg(probability) FILTER(WHERE graded_at IS NOT NULL)::numeric*100,1) avg_confidence
        FROM unique_picks WHERE phase='live' AND market='card'
        GROUP BY 1 ORDER BY graded DESC`,[days]),
      pool.query(cte+` SELECT phase,count(*) FILTER(WHERE market_group='Goals' AND graded_at IS NOT NULL)::int graded_goals,
        count(*) FILTER(WHERE market_group='Goals' AND outcome IS TRUE)::int scored
        FROM unique_picks GROUP BY phase`,[days]),
      pool.query(cte+` SELECT phase,market_group,
        CASE WHEN fixture_date=(SELECT max(fixture_date) FROM unique_picks) THEN 'holdout' ELSE 'training' END AS split,
        cutoffs.cutoff AS threshold,
        count(*)::int graded,count(*) FILTER(WHERE outcome IS TRUE)::int hits,
        round(avg(probability)::numeric*100,1) avg_confidence
        FROM unique_picks CROSS JOIN (VALUES (.50::float8),(.60::float8),(.70::float8),(.75::float8),(.80::float8)) cutoffs(cutoff)
        WHERE graded_at IS NOT NULL AND probability>=cutoffs.cutoff
        GROUP BY phase,market_group,split,cutoffs.cutoff ORDER BY phase,market_group,split,cutoffs.cutoff`,[days]),
      pool.query(cte+` SELECT count(*)::int unique_saved,
        count(*) FILTER(WHERE graded_at IS NULL)::int ungraded,
        count(DISTINCT fixture_date)::int match_days FROM unique_picks`,[days]),
      pool.query(cte+` SELECT timing_quality,phase,count(*) FILTER(WHERE rank_first=1)::int selections
        FROM source GROUP BY timing_quality,phase ORDER BY selections DESC`,[days]),
      pool.query(cte+` SELECT phase,market_group,
        count(*) FILTER(WHERE graded_at IS NOT NULL)::int graded,
        count(*) FILTER(WHERE graded_at IS NOT NULL AND sample_matches IS NULL)::int no_sample
        FROM (
          SELECT l.sample_matches,r.live,l.graded_at,l.market,
          CASE WHEN r.live THEN 'live' ELSE 'pre-match' END phase,
          ${marketGroup} AS market_group
          FROM prediction_legs l JOIN prediction_runs r ON r.id=l.run_id
          WHERE l.fixture_date >= CURRENT_DATE-$1::int AND l.fixture_date < CURRENT_DATE
        ) q GROUP BY phase,market_group ORDER BY graded DESC`,[days]),
    ])
    return NextResponse.json({ok:true,days,updatedAt:new Date().toISOString(),
      coverage:coverage.rows[0],phases:phases.rows,markets:markets.rows,confidence:confidence.rows,
      liveCardSignals:signals.rows,goals:goals.rows,walkForward:walkForward.rows,
      timingQuality:timing.rows,featureCoverage:featureCoverage.rows,
      note:"First published prediction per phase, fixture, player, market and threshold. No duplicate refreshes. Only snapshots made at a verifiable eligible time are evaluated; absent results are excluded."},
      {headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Accuracy unavailable"},{status:500})}
}
