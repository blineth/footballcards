import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { and, eq, gte } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const API = "https://www.sofascore.com/api/v1"
const TOURNAMENT_ID = 17
const COMPETITION = "Premier League"
const SEASON = "2026/27"
const START = "2026-08-21"
const SYNC_KEY = "mw1-2026-27-7f4d9c2a"
type R = Record<string, any>

async function j(path:string){ const r=await fetch(`${API}${path}`,{headers:{"User-Agent":"Mozilla/5.0 (compatible; footballcards-research/4.0)",Accept:"application/json","Referer":"https://www.sofascore.com/"},cache:"no-store"}); if(!r.ok) throw new Error(`${r.status} ${path}`); return r.json() }
const n=(v:any)=>Number.isFinite(Number(v))?Math.trunc(Number(v)):null
function stat(s:R,...keys:string[]){ for(const k of keys){ const v=n(s?.[k]); if(v!=null)return v } return null }
function cardMap(x:R){ const m=new Map<number,{y:number,r:number}>(); for(const i of x.incidents??[]){ const id=Number(i?.player?.id); if(!id)continue; const t=String(i?.incidentType??"").toLowerCase(), c=String(i?.incidentClass??i?.class??"").toLowerCase().replaceAll("-",""); if(!t.includes("card"))continue; const z=m.get(id)??{y:0,r:0}; if(c.includes("yellow"))z.y++; if(c.includes("red"))z.r++; if(c.includes("yellowred")){z.y=Math.max(z.y,1);z.r=Math.max(z.r,1)} m.set(id,z) } return m }
function dateOf(e:R){ return new Date(Number(e.startTimestamp)*1000).toISOString().slice(0,10) }
function refOf(e:R,d:R){ const x=d?.event?.referee??d?.referee??e?.referee; return x?.name?{name:String(x.name),id:String(x.id??"")}: {name:"",id:""} }
function parseSide(entries:R[],event:R,team:string,opp:string,venue:"home"|"away",ref:{name:string,id:string},cards:Map<number,{y:number,r:number}>){ const out:R[]=[]; for(const e of entries){ const p=e.player??{}, id=Number(p.id); if(!id||!p.name)continue; const s=e.statistics??{}, mins=stat(s,"minutesPlayed","minutes"), starter=!Boolean(e.substitute); if(mins==null&&!starter)continue; const minutes=mins??90; if(minutes<=0)continue; const c=cards.get(id)??{y:0,r:0}; const y=Math.max(stat(s,"yellowCards")??0,c.y), r=Math.max(stat(s,"redCards")??0,c.r); out.push({playerName:String(p.name),team,opponent:opp,matchDate:dateOf(event),competition:COMPETITION,venue,minutes,foulsCommitted:stat(s,"fouls")??0,foulsDrawn:stat(s,"wasFouled","fouled")??0,yellowCard:y>0,redCard:r>0,externalPlayerId:String(id),position:String(p.position??e.position??""),starter,referee:ref.name,externalRefereeId:ref.id}) } return out }

export async function GET(req:Request){
  const u=new URL(req.url); if(u.searchParams.get("key")!==SYNC_KEY)return NextResponse.json({ok:false},{status:404}); if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not connected"},{status:503}); await ensureResearchSchema()
  try{
    const seasons=await j(`/unique-tournament/${TOURNAMENT_ID}/seasons`); const season=(seasons.seasons??[]).find((x:R)=>String(x.name??"").includes("26/27")||String(x.year??"").includes("26/27")||String(x.name??"").includes("2026/27")); if(!season?.id)throw new Error("Could not resolve Sofascore 2026/27 Premier League season")
    const rd=await j(`/unique-tournament/${TOURNAMENT_ID}/season/${season.id}/events/round/1`); const events=(rd.events??[]).filter((e:R)=>String(e.status?.type??"").toLowerCase()==="finished"||String(e.status?.description??"").toLowerCase().includes("ended")); if(events.length!==10)throw new Error(`Quality gate failed: expected 10 finished MW1 matches, found ${events.length}`)
    const rows:R[]=[], meta:R[]=[]
    for(const e of events){ const id=Number(e.id), [lineups,incidents,detail]=await Promise.all([j(`/event/${id}/lineups`),j(`/event/${id}/incidents`),j(`/event/${id}`)]); const home=String(e?.homeTeam?.name??""),away=String(e?.awayTeam?.name??""),ref=refOf(e,detail),cards=cardMap(incidents); const hr=parseSide(lineups?.home?.players??[],e,home,away,"home",ref,cards), ar=parseSide(lineups?.away?.players??[],e,away,home,"away",ref,cards); rows.push(...hr,...ar); meta.push({id,date:dateOf(e),home,away,referee:ref.name,playerRows:hr.length+ar.length}) }
    if(rows.length<250)throw new Error(`Quality gate failed: only ${rows.length} player-match rows`)
    const bm=new Map<string,R>(); for(const r of rows){ const k=`${r.externalPlayerId}|${r.team}`,x=bm.get(k)??{playerName:r.playerName,team:r.team,competition:COMPETITION,season:SEASON,appearances:0,starts:0,minutes:0,yellowCards:0,redCards:0,foulsCommitted:0,foulsDrawn:0,position:r.position,externalPlayerId:r.externalPlayerId}; x.appearances++;x.starts+=r.starter?1:0;x.minutes+=r.minutes;x.yellowCards+=r.yellowCard?1:0;x.redCards+=r.redCard?1:0;x.foulsCommitted+=r.foulsCommitted;x.foulsDrawn+=r.foulsDrawn;bm.set(k,x) }
    const baselines=[...bm.values()].map(x=>({...x,foulsPer90:x.minutes?String(Number((x.foulsCommitted*90/x.minutes).toFixed(4))):null,cardsPer90:x.minutes?String(Number((x.yellowCards*90/x.minutes).toFixed(4))):null}))
    const refs=new Map<string,R>(), pr=new Map<string,R>(); for(const r of rows){ if(!r.referee)continue; const a=refs.get(r.referee)??{players:new Set<string>(),yellowCards:0,redCards:0,fouls:0,externalRefereeId:r.externalRefereeId}; a.players.add(`${r.matchDate}|${r.team}|${r.opponent}`);a.yellowCards+=r.yellowCard?1:0;a.redCards+=r.redCard?1:0;a.fouls+=r.foulsCommitted;refs.set(r.referee,a); const k=`${r.referee}|${r.externalPlayerId}`,b=pr.get(k)??{refereeName:r.referee,playerName:r.playerName,team:r.team,competition:COMPETITION,season:SEASON,matchesTogether:0,yellowCards:0,redCards:0,foulsCommitted:0,externalRefereeId:r.externalRefereeId,externalPlayerId:r.externalPlayerId};b.matchesTogether++;b.yellowCards+=r.yellowCard?1:0;b.redCards+=r.redCard?1:0;b.foulsCommitted+=r.foulsCommitted;pr.set(k,b) }
    const refRows=[...refs.entries()].map(([name,x])=>{const matches=Math.max(1,x.players.size/2);return{refereeName:name,matchesRefereed:matches,yellowCards:x.yellowCards,redCards:x.redCards,yellowsPerGame:String(Number((x.yellowCards/matches).toFixed(4))),foulsPerGame:String(Number((x.fouls/matches).toFixed(4))),competition:COMPETITION,season:SEASON,externalRefereeId:x.externalRefereeId||null}})
    const h2h=rows.map(r=>({playerName:r.playerName,team:r.team,opponent:r.opponent,matchDate:r.matchDate,competition:COMPETITION,venue:r.venue,minutes:r.minutes,foulsCommitted:r.foulsCommitted,foulsDrawn:r.foulsDrawn,yellowCard:r.yellowCard,redCard:r.redCard,externalPlayerId:r.externalPlayerId}))
    await db.transaction(async tx=>{ await tx.delete(playerBaselines).where(and(eq(playerBaselines.competition,COMPETITION),eq(playerBaselines.season,SEASON)));await tx.delete(referees).where(and(eq(referees.competition,COMPETITION),eq(referees.season,SEASON)));await tx.delete(playerRefereeHistory).where(and(eq(playerRefereeHistory.competition,COMPETITION),eq(playerRefereeHistory.season,SEASON)));await tx.delete(playerH2H).where(and(eq(playerH2H.competition,COMPETITION),gte(playerH2H.matchDate,START)));for(let i=0;i<baselines.length;i+=200)await tx.insert(playerBaselines).values(baselines.slice(i,i+200));for(let i=0;i<h2h.length;i+=200)await tx.insert(playerH2H).values(h2h.slice(i,i+200));if(refRows.length)await tx.insert(referees).values(refRows);const pv=[...pr.values()];for(let i=0;i<pv.length;i+=200)await tx.insert(playerRefereeHistory).values(pv.slice(i,i+200)) })
    return NextResponse.json({ok:true,source:"Sofascore",competition:COMPETITION,season:SEASON,preservedHistoricalSeason:"2025/26",matches:events.length,playerMatchRows:h2h.length,playerBaselines:baselines.length,referees:refRows.length,playerRefereeRows:pr.size,meta})
  }catch(e){console.error("[sync-premier-league-current]",e);return NextResponse.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500})}
}
