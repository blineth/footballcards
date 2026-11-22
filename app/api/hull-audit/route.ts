import { NextResponse } from "next/server"
import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { gradePredictionLedger } from "@/lib/prediction-ledger"
import { GET as importMatchResults } from "@/app/api/admin/import-match-results/route"

export const dynamic="force-dynamic"
export const revalidate=0

// Read-only audit of the app's own historic model recommendations.
// No account details, private bets or database credentials are returned.
export async function GET(){
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    let importStatus:unknown=null
    const secret=process.env.CRON_SECRET
    if(secret){
      await pool.query(`CREATE TABLE IF NOT EXISTS prediction_audit_refresh (
        audit_key text PRIMARY KEY, last_attempt timestamptz NOT NULL DEFAULT now()
      )`)
      const claimed=await pool.query(`INSERT INTO prediction_audit_refresh(audit_key,last_attempt)
        VALUES('hull-2026-11-22',now())
        ON CONFLICT(audit_key) DO UPDATE SET last_attempt=now()
        WHERE prediction_audit_refresh.last_attempt<now()-interval '15 minutes'
        RETURNING audit_key`)
      if(claimed.rowCount){
        const params=new URLSearchParams({date:"2026-11-22",home:"Hull",away:"Brighton",limit:"4"})
        const response=await importMatchResults(new Request("http://internal/api/admin/import-match-results?"+params,{
          headers:{authorization:"Bearer "+secret}
        }))
        const payload=await response.json()
        importStatus={ok:response.ok&&payload.ok,results:payload.results??[],graded:payload.graded??null,error:payload.error??null}
      }
    }
    const gradeStatus=await gradePredictionLedger(1500)
    const runs=await pool.query(`
      SELECT r.id,r.surface,r.fixture_date,r.home_team,r.away_team,
        r.slip_id,r.slip_title,r.tier,r.odds_target,r.combined_odds,
        r.model_joint_probability,r.lineup_confirmed,r.live,r.live_minute,
        r.captured_at,r.fully_graded,r.won
      FROM prediction_runs r
      WHERE r.fixture_date BETWEEN DATE '2026-11-21' AND DATE '2026-11-23'
        AND (lower(coalesce(r.home_team,'')) LIKE '%hull%'
          OR lower(coalesce(r.away_team,'')) LIKE '%hull%')
      ORDER BY r.captured_at ASC LIMIT 400
    `)
    const ids=runs.rows.map(r=>r.id)
    const legs=ids.length?await pool.query(`
      SELECT run_id,leg_index,fixture_date,home_team,away_team,
        player_name,player_team,market,threshold,label,model_probability,
        bookmaker_odds,result_value,outcome,graded_at
      FROM prediction_legs WHERE run_id=ANY($1::bigint[])
      ORDER BY run_id,leg_index
    `,[ids]):{rows:[]}
    const byRun=new Map<string,any[]>()
    for(const leg of legs.rows){
      const key=String(leg.run_id),arr=byRun.get(key)??[]
      arr.push({...leg,run_id:undefined});byRun.set(key,arr)
    }
    const output=runs.rows.map(r=>({...r,id:undefined,legs:byRun.get(String(r.id))??[]}))
    return NextResponse.json({ok:true,fixture:"Hull",runs:output,runCount:output.length,legCount:legs.rows.length,gradedLegs:legs.rows.filter(l=>l.graded_at!=null).length,gradeStatus,importStatus},{headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Audit unavailable"},{status:500})}
}
