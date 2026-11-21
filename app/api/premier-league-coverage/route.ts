import {NextResponse} from "next/server"
import {db,isDatabaseConfigured} from "@/lib/db"
import {playerH2H} from "@/lib/db/schema"
import {lt,gte,and,eq,inArray} from "drizzle-orm"
export const dynamic="force-dynamic"
const teams=["Manchester City","Fulham","AFC Bournemouth","Nottingham Forest","Aston Villa","Sunderland","Chelsea","Leeds United","Coventry City","Crystal Palace","Tottenham Hotspur","Ipswich Town","Newcastle United","Arsenal","Hull City","Brighton & Hove Albion","Liverpool","Manchester United","Brentford","Everton"]
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"").replace(/^afc/,"").replace(/hotspur$/,"")
export async function GET(request:Request){
 const detailed=new URL(request.url).searchParams.get("detail")==="players"
 if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
 try{
  const rows=await db.select({player:playerH2H.playerName,team:playerH2H.team,date:playerH2H.matchDate,match:playerH2H.externalMatchId,shots:playerH2H.shots,fouls:playerH2H.foulsCommitted,foulsWon:playerH2H.foulsDrawn,shotsOnTarget:playerH2H.shotsOnTarget,yellow:playerH2H.yellowCard,opponent:playerH2H.opponent,competition:playerH2H.competition}).from(playerH2H).where(and(gte(playerH2H.matchDate,"2026-08-21"),lt(playerH2H.matchDate,"2026-11-21")))
  const byTeam=teams.map(team=>{
    const mine=rows.filter(r=>norm(r.team??"")===norm(team))
    const players=new Map<string,typeof mine>()
    for(const r of mine){const a=players.get(r.player)??[];a.push(r);players.set(r.player,a)}
    const covered=[...players.values()].filter(a=>a.length>=5).length
    const playerAudit=[...players.entries()].map(([name,games])=>{const sorted=[...games].sort((a,b)=>String(b.date).localeCompare(String(a.date)));const last5=sorted.slice(0,5);return {name,matches:games.length,lastMatch:String(sorted[0]?.date??""),lastFive:last5.length,verifiedESPN:last5.filter(r=>String(r.match??"").startsWith("espn:")).length,missingFields:last5.filter(r=>r.shots===null||r.shotsOnTarget===null||r.fouls===null||r.foulsWon===null||r.yellow===null).length,opponents:last5.map(r=>r.opponent)}})
    const current=[...players.values()].filter(a=>a.some(r=>String(r.date)>="2026-10-20")).length
    return {team,players:players.size,playersWithFiveMatches:covered,playersWithRecentMatch:current,matchRows:mine.length,missingShotOrFoulFields:mine.filter(r=>r.shots===null||r.fouls===null).length,sourceMatches:new Set(mine.map(r=>r.match).filter(Boolean)).size,...(detailed?{playerAudit}:{})}
  })
  return NextResponse.json({ok:true,seasonStart:"2026-08-21",cutoff:"2026-11-21",teams:byTeam,totalRows:rows.length},{headers:{"Cache-Control":"no-store"}})
 }catch(e){return NextResponse.json({ok:false,error:String(e).slice(0,200)},{status:503})}
}
