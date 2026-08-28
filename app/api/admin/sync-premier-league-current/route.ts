import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { and, eq, gte } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const COMPETITION = "Premier League"
const SEASON = "2026/27"
const START = "2026-08-21"
const SYNC_KEY = "mw1-2026-27-7f4d9c2a"
const RAW = "https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/By%20Gameweek/GW1"
type R = Record<string, any>

const REFEREES: Record<string,string> = {
  "26-27-prem-arsenal-vs-coventry-city":"Tom Bramall",
  "26-27-prem-hull-city-vs-manchester-united":"Darren England",
  "26-27-prem-everton-vs-crystal-palace":"Paul Tierney",
  "26-27-prem-ipswich-town-vs-sunderland":"Farai Hallam",
  "26-27-prem-nottingham-forest-vs-leeds-united":"Rob Jones",
  "26-27-prem-brentford-vs-tottenham-hotspur":"Michael Oliver",
  "26-27-prem-brighton-hove-albion-vs-aston-villa":"Peter Bankes",
  "26-27-prem-manchester-city-vs-afc-bournemouth":"Jarred Gillett",
  "26-27-prem-newcastle-united-vs-liverpool":"Stuart Attwell",
  "26-27-prem-fulham-vs-chelsea":"John Brooks",
}

async function text(name:string){ const r=await fetch(`${RAW}/${name}`,{headers:{Accept:"text/csv","User-Agent":"footballcards-research/4.1"},cache:"no-store"}); if(!r.ok)throw new Error(`${r.status} ${name}`); return r.text() }
function csv(src:string):R[]{
  const rows:string[][]=[]; let row:string[]=[], cell="", quoted=false
  for(let i=0;i<src.length;i++){ const c=src[i]; if(c==='"'){ if(quoted&&src[i+1]==='"'){cell+='"';i++} else quoted=!quoted } else if(c===','&&!quoted){row.push(cell);cell=""} else if((c==='\n'||c==='\r')&&!quoted){ if(c==='\r'&&src[i+1]==='\n')i++; row.push(cell); if(row.some(x=>x!==""))rows.push(row); row=[];cell="" } else cell+=c }
  if(cell||row.length){row.push(cell);rows.push(row)} const h=rows.shift()??[]; return rows.map(a=>Object.fromEntries(h.map((k,i)=>[k,a[i]??""])))
}
const num=(v:any)=>v===""||v==null?0:Number(v)||0
const int=(v:any)=>Math.trunc(num(v))

export async function GET(req:Request){
  const u=new URL(req.url); if(u.searchParams.get("key")!==SYNC_KEY)return NextResponse.json({ok:false},{status:404}); if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not connected"},{status:503}); await ensureResearchSchema()
  try{
    const [teamsCsv,playersCsv,matchesCsv,statsCsv,gwCsv]=await Promise.all([text("teams.csv"),text("players.csv"),text("matches.csv"),text("playermatchstats.csv"),text("player_gameweek_stats.csv")])
    const teams=csv(teamsCsv), players=csv(playersCsv), matches=csv(matchesCsv), stats=csv(statsCsv), gw=csv(gwCsv)
    const teamByCode=new Map(teams.map(x=>[String(x.code),String(x.name)]))
    const playerById=new Map(players.map(x=>[String(x.player_id),x]))
    const cardById=new Map(gw.map(x=>[String(x.id),{yc:int(x.yellow_cards),rc:int(x.red_cards)}]))
    const sourceOverrides:string[]=[]
    const joaoGomes=cardById.get("54")
    if(joaoGomes?.rc===1 && joaoGomes.yc===0){ cardById.set("54",{yc:1,rc:1}); sourceOverrides.push("Joao Gomes: restored 9th-minute yellow independently verified in Brighton v Aston Villa; FPL GW row records the later straight red but omits the earlier yellow") }
    const matchById=new Map(matches.filter(x=>String(x.finished).toLowerCase()==="true").map(x=>[String(x.match_id),x]))
    if(matchById.size!==10)throw new Error(`Quality gate failed: expected 10 finished GW1 matches, found ${matchById.size}`)

    const rows:R[]=[]
    for(const s of stats){
      const minutes=int(s.minutes_played); if(minutes<=0)continue
      const p=playerById.get(String(s.player_id)), m=matchById.get(String(s.match_id)); if(!p||!m)continue
      const teamCode=String(p.team_code), homeCode=String(Math.trunc(num(m.home_team))), awayCode=String(Math.trunc(num(m.away_team)))
      const team=teamByCode.get(teamCode), home=teamByCode.get(homeCode), away=teamByCode.get(awayCode); if(!team||!home||!away||!(team===home||team===away))continue
      const card=cardById.get(String(s.player_id))??{yc:0,rc:0}, venue=team===home?"home":"away", opponent=team===home?away:home, ref=REFEREES[String(s.match_id)]??""
      rows.push({playerName:`${p.first_name} ${p.second_name}`.trim(),team,opponent,matchDate:String(m.kickoff_time).slice(0,10),competition:COMPETITION,venue,minutes,foulsCommitted:int(s.fouls_committed),foulsDrawn:int(s.was_fouled),yellowCard:card.yc>0,redCard:card.rc>0,externalPlayerId:String(s.player_id),position:String(p.position??""),starter:int(s.start_min)===0,referee:ref})
    }
    if(rows.length<240)throw new Error(`Quality gate failed: only ${rows.length} player appearance rows`)
    const represented=new Set(rows.map(r=>`${r.matchDate}|${[r.team,r.opponent].sort().join("|")}`)); if(represented.size!==10)throw new Error(`Quality gate failed: only ${represented.size}/10 matches represented in player stats`)

    const bm=new Map<string,R>(); for(const r of rows){ const k=`${r.externalPlayerId}|${r.team}`,x=bm.get(k)??{playerName:r.playerName,team:r.team,competition:COMPETITION,season:SEASON,appearances:0,starts:0,minutes:0,yellowCards:0,redCards:0,foulsCommitted:0,foulsDrawn:0,position:r.position,externalPlayerId:r.externalPlayerId}; x.appearances++;x.starts+=r.starter?1:0;x.minutes+=r.minutes;x.yellowCards+=r.yellowCard?1:0;x.redCards+=r.redCard?1:0;x.foulsCommitted+=r.foulsCommitted;x.foulsDrawn+=r.foulsDrawn;bm.set(k,x) }
    const baselines=[...bm.values()].map(x=>({...x,foulsPer90:x.minutes?String(Number((x.foulsCommitted*90/x.minutes).toFixed(4))):null,cardsPer90:x.minutes?String(Number((x.yellowCards*90/x.minutes).toFixed(4))):null}))
    const h2h=rows.map(r=>({playerName:r.playerName,team:r.team,opponent:r.opponent,matchDate:r.matchDate,competition:r.competition,venue:r.venue,minutes:r.minutes,foulsCommitted:r.foulsCommitted,foulsDrawn:r.foulsDrawn,yellowCard:r.yellowCard,redCard:r.redCard,externalPlayerId:r.externalPlayerId}))

    const refAgg=new Map<string,R>(), pr=new Map<string,R>()
    for(const r of rows){ if(!r.referee)continue; const a=refAgg.get(r.referee)??{matches:new Set<string>(),yellowCards:0,redCards:0,fouls:0}; a.matches.add(`${r.matchDate}|${[r.team,r.opponent].sort().join("|")}`);a.yellowCards+=r.yellowCard?1:0;a.redCards+=r.redCard?1:0;a.fouls+=r.foulsCommitted;refAgg.set(r.referee,a); const k=`${r.referee}|${r.externalPlayerId}`,b=pr.get(k)??{refereeName:r.referee,playerName:r.playerName,team:r.team,competition:COMPETITION,season:SEASON,matchesTogether:0,yellowCards:0,redCards:0,foulsCommitted:0,externalRefereeId:null,externalPlayerId:r.externalPlayerId};b.matchesTogether++;b.yellowCards+=r.yellowCard?1:0;b.redCards+=r.redCard?1:0;b.foulsCommitted+=r.foulsCommitted;pr.set(k,b) }
    const refRows=[...refAgg.entries()].map(([name,x])=>{const games=x.matches.size;return{refereeName:name,matchesRefereed:games,yellowCards:x.yellowCards,redCards:x.redCards,yellowsPerGame:String(Number((x.yellowCards/games).toFixed(4))),foulsPerGame:String(Number((x.fouls/games).toFixed(4))),competition:COMPETITION,season:SEASON,externalRefereeId:null}})
    if(refRows.length!==10)throw new Error(`Quality gate failed: ${refRows.length}/10 referee rows resolved`)

    const cardSum=baselines.reduce((a,x)=>a+x.yellowCards,0), redSum=baselines.reduce((a,x)=>a+x.redCards,0), foulSum=baselines.reduce((a,x)=>a+x.foulsCommitted,0)
    const matchYellow=matches.reduce((a,x)=>a+int(x.home_yellow_cards)+int(x.away_yellow_cards),0), matchRed=matches.reduce((a,x)=>a+int(x.home_red_cards)+int(x.away_red_cards),0), matchFouls=matches.reduce((a,x)=>a+int(x.home_fouls_committed)+int(x.away_fouls_committed),0)
    const discrepancies:string[]=[]; if(cardSum!==matchYellow)discrepancies.push(`player yellow total ${cardSum} != match total ${matchYellow}`); if(redSum!==matchRed)discrepancies.push(`player red total ${redSum} != match total ${matchRed}`); if(foulSum!==matchFouls)discrepancies.push(`player foul total ${foulSum} != match total ${matchFouls}`)
    if(discrepancies.length)throw new Error(`Source reconciliation failed: ${discrepancies.join("; ")}`)

    await db.transaction(async tx=>{ await tx.delete(playerBaselines).where(and(eq(playerBaselines.competition,COMPETITION),eq(playerBaselines.season,SEASON))); await tx.delete(referees).where(and(eq(referees.competition,COMPETITION),eq(referees.season,SEASON))); await tx.delete(playerRefereeHistory).where(and(eq(playerRefereeHistory.competition,COMPETITION),eq(playerRefereeHistory.season,SEASON))); await tx.delete(playerH2H).where(and(eq(playerH2H.competition,COMPETITION),gte(playerH2H.matchDate,START))); for(let i=0;i<baselines.length;i+=200)await tx.insert(playerBaselines).values(baselines.slice(i,i+200)); for(let i=0;i<h2h.length;i+=200)await tx.insert(playerH2H).values(h2h.slice(i,i+200)); await tx.insert(referees).values(refRows); const pv=[...pr.values()]; for(let i=0;i<pv.length;i+=200)await tx.insert(playerRefereeHistory).values(pv.slice(i,i+200)) })

    return NextResponse.json({ok:true,source:"FPL-Core-Insights/FotMob-derived static GW1 + PremierLeague.com referee appointments",competition:COMPETITION,season:SEASON,preservedHistoricalSeason:"2025/26",matches:10,playerMatchRows:h2h.length,playerBaselines:baselines.length,referees:refRows.length,playerRefereeRows:pr.size,totals:{yellowCards:cardSum,redCards:redSum,foulsCommitted:foulSum},sourceReconciliation:"passed",sourceOverrides})
  }catch(e){console.error("[sync-premier-league-current]",e);return NextResponse.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500})}
}
