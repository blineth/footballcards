import { NextResponse } from "next/server"
import { pool,isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { GET as fixturesGET } from "@/app/api/fixtures/route"
import { GET as playerStatsGET } from "@/app/api/live-player-stats/route"
import { gradePredictionLedger } from "@/lib/prediction-ledger"
import { gradeHistoricalRecommendations } from "@/lib/recommendation-tracking"

export const dynamic="force-dynamic"
export const revalidate=0
function ymd(v:string){return /^20\d{2}-\d{2}-\d{2}$/.test(v)}
export async function GET(request:Request){
  const params=new URL(request.url).searchParams
  const date=params.get("date")??""
  const offset=Math.max(0,Math.min(500,Number(params.get("offset")??0)||0))
  const limit=Math.max(1,Math.min(5,Number(params.get("limit")??4)||4))
  if(!ymd(date)||date>=new Date().toISOString().slice(0,10))return NextResponse.json({ok:false,error:"Date must be a completed past day"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    const response=await fixturesGET(new Request("http://internal/api/fixtures?date="+date+"&nextIfEmpty=0"))
    const board=await response.json()
    const fixtures=Object.values(board?.leagues??{}).flat() as any[]
    const finished=fixtures.filter(f=>f.status==="finished")
    const selected=finished.slice(offset,offset+limit)
    const results=await Promise.all(selected.map(async f=>{
      const name=f.home.name+" v "+f.away.name
      try{
        const q=new URLSearchParams({date,home:f.home.name,away:f.away.name,competition:f.competition})
        const res=await playerStatsGET(new Request("http://internal/api/live-player-stats?"+q))
        const data=await res.json()
        if(data.status!=="finished"||!Array.isArray(data.players)||data.players.length<10){
          return {fixture:name,imported:0,status:"incomplete source",feed:data.source??null}
        }
        let imported=0
        for(const player of data.players){
          if(!player?.player||!player?.team)continue
          const home=String(f.home.name).toLowerCase(),team=String(player.team).toLowerCase()
          const isHome=team===home||team.includes(home)||home.includes(team)
          const opponent=isHome?f.away.name:f.home.name
          await pool.query(`INSERT INTO player_h2h
            (player_name,team,opponent,match_date,competition,minutes,
             fouls_committed,fouls_drawn,shots,shots_on_target,yellow_card,red_card,goals,assists,
             external_match_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT(player_name,team,opponent,match_date,competition)
            DO UPDATE SET minutes=EXCLUDED.minutes,fouls_committed=EXCLUDED.fouls_committed,
            fouls_drawn=EXCLUDED.fouls_drawn,shots=EXCLUDED.shots,
            shots_on_target=EXCLUDED.shots_on_target,yellow_card=EXCLUDED.yellow_card,
            red_card=EXCLUDED.red_card,goals=EXCLUDED.goals,assists=EXCLUDED.assists,
            external_match_id=EXCLUDED.external_match_id`,
            [player.player,player.team,opponent,date,f.competition,
             player.minutes??null,player.foulsCommitted??null,player.foulsDrawn??null,
             player.shots??null,player.shotsOnTarget??null,Number(player.yellowCards??0)>0,
             Number(player.redCards??0)>0,player.goals??null,player.assists??null,
             String(f.id??"")])
          imported++
        }
        const ref=String(data.referee?.name??"").trim()
        if(ref&&data.score?.home!=null&&data.score?.away!=null){
          await pool.query(`INSERT INTO referee_match_history
           (fixture_id,referee_name,fixture_date,competition,home_team,away_team,home_score,away_score,source,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT(fixture_id) DO UPDATE SET home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,updated_at=now()`,
           [String(f.id??""),ref,date,f.competition,f.home.name,f.away.name,data.score.home,data.score.away,data.source??"fixture"])
        }
        return {fixture:name,imported,status:"saved",feed:data.source??null}
      }catch(e){return {fixture:name,imported:0,status:"error",error:e instanceof Error?e.message:"Import failed"}}
    }))
    const graded=await gradePredictionLedger(3500).catch(e=>({graded:0,runsUpdated:0,error:String(e)}))
    const legacy=await gradeHistoricalRecommendations(1500).catch(e=>({graded:0,error:String(e)}))
    return NextResponse.json({ok:true,date,offset,limit,totalFinished:finished.length,
      nextOffset:offset+selected.length<finished.length?offset+selected.length:null,
      results,graded,legacy,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Import failed"},{status:500})}
}
