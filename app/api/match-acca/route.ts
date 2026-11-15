import { NextResponse } from "next/server"
import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { londonToday } from "@/lib/date"
import { GET as fixturesGET } from "../fixtures/route"
import matchAccaBacktest from "@/data/model/match-acca-backtest.json"
import { snapshotRowsForCompetition } from "@/lib/current-season-snapshot"

export const dynamic="force-dynamic"
export const revalidate=900

const COMPETITIONS=["Premier League","Championship","League One","League Two","International"] as const
type Competition=typeof COMPETITIONS[number]
const LEAGUE_IDS:Partial<Record<Competition,string>>={
  "Premier League":"39",Championship:"40","League One":"41","League Two":"42",
}
const BOOKS=["Bet365","Sky Bet","William Hill","Paddy Power"] as const

type MatchRow={date:string;team:string;opponent:string;venue:"home"|"away"|"";gf:number;ga:number;result:"W"|"D"|"L";btts:boolean}
type Metrics={team:string;position:number;teams:number;played:number;points:number;ppg:number;winRate:number;drawRate:number;lossRate:number;gd:number;gfPerGame:number;gaPerGame:number;recentForm:string;recentPPG:number;streak:string;venueWinRate:number;venuePPG:number;venueGFPerGame:number;venueGAPerGame:number;venueBttsRate:number;venueScoreRate:number;venueConcedeRate:number;bttsRate:number}
type PriceSet={homeWin?:number;draw?:number;awayWin?:number;homeOrDraw?:number;awayOrDraw?:number;bttsYes?:number;bttsNo?:number}

function norm(v:any){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function same(a:any,b:any){const x=norm(a),y=norm(b);return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v))}
function pct(v:number){return Math.round(v*1000)/1000}
function calibrateMarket(market:"homeWin"|"awayWin"|"bttsYes"|"bttsNo",raw:number){
  const bands=(matchAccaBacktest as any)?.calibration?.[market]?.bands
  if(!Array.isArray(bands)||bands.length!==20)return raw
  const idx=Math.max(0,Math.min(19,Math.floor(clamp(raw,0,.999999)/.05)))
  const value=Number(bands[idx]?.calibratedProbability)
  return Number.isFinite(value)?clamp(value,.01,.99):raw
}
function seasonYear(date:string){const d=new Date(date+"T12:00:00Z");return d.getUTCMonth()>=6?d.getUTCFullYear():d.getUTCFullYear()-1}
function seasonStart(date:string){return String(seasonYear(date))+"-07-01"}
function historyStart(date:string){const d=new Date(date+"T12:00:00Z");d.setUTCFullYear(d.getUTCFullYear()-3);return d.toISOString().slice(0,10)}
function points(r:"W"|"D"|"L"){return r==="W"?3:r==="D"?1:0}
function ordinal(n:number){const x=n%100;if(x>=11&&x<=13)return n+"th";return n+(n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th")}

async function matches(competition:Competition,from:string,to:string){
  let rows:Array<{date:string;team:string;opponent:string;venue:string;goals:number}>=[]
  if(isDatabaseConfigured){
    try{
      const sql="SELECT match_date::text AS date, team, opponent, COALESCE(venue,'') AS venue, SUM(COALESCE(goals,0))::int AS goals FROM player_h2h WHERE competition=$1 AND match_date >= $2 AND match_date < $3 AND team IS NOT NULL AND opponent IS NOT NULL GROUP BY match_date,team,opponent,venue ORDER BY match_date"
      const r=await pool.query(sql,[competition,from,to])
      rows=r.rows.map((x:any)=>({date:String(x.date).slice(0,10),team:String(x.team),opponent:String(x.opponent),venue:String(x.venue??"").toLowerCase(),goals:Number(x.goals??0)}))
    }catch{}
  }
  if(!rows.length){
    const snapshot=await snapshotRowsForCompetition(competition,from,to)
    const grouped=new Map<string,{date:string;team:string;opponent:string;venue:string;goals:number}>()
    for(const row of snapshot){
      const key=[row.match_date,row.team,row.opponent,row.venue].join("|")
      const current=grouped.get(key)??{date:row.match_date,team:row.team,opponent:row.opponent,venue:String(row.venue??"").toLowerCase(),goals:0}
      current.goals+=Number(row.goals??0)
      grouped.set(key,current)
    }
    rows=[...grouped.values()].sort((a,b)=>a.date.localeCompare(b.date))
  }
  const map=new Map(rows.map((x:any)=>[[x.date,norm(x.team),norm(x.opponent)].join("|"),x]))
  const out:MatchRow[]=[]
  for(const x of rows){
    const other=map.get([x.date,norm(x.opponent),norm(x.team)].join("|")) as any
    if(!other)continue
    const gf=x.goals,ga=other.goals
    out.push({date:x.date,team:x.team,opponent:x.opponent,venue:x.venue==="home"?"home":x.venue==="away"?"away":"",gf,ga,result:gf>ga?"W":gf<ga?"L":"D",btts:gf>0&&ga>0})
  }
  return out
}
function table(all:MatchRow[]){
  const teams=[...new Set(all.map(m=>m.team))]
  const rows=teams.map(team=>{const ms=all.filter(m=>same(m.team,team));const gf=ms.reduce((s,m)=>s+m.gf,0),ga=ms.reduce((s,m)=>s+m.ga,0);return{team,pts:ms.reduce((s,m)=>s+points(m.result),0),gd:gf-ga,gf}})
    .sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf)
  return {teams:rows.map(r=>r.team),positions:new Map(rows.map((r,i)=>[norm(r.team),i+1]))}
}
function canonical(name:string,teams:string[]){return teams.find(t=>norm(t)===norm(name))??teams.find(t=>same(t,name))??name}
function streak(rows:MatchRow[]){const r=[...rows].sort((a,b)=>b.date.localeCompare(a.date));if(!r.length)return "—";const first=r[0].result;let n=0;for(const m of r){if(m.result!==first)break;n++}return first+String(n)}
function metrics(team:string,all:MatchRow[],positions:Map<string,number>,teamCount:number,venue:"home"|"away"):Metrics{
  const rows=all.filter(m=>same(m.team,team)).sort((a,b)=>a.date.localeCompare(b.date)),recent=rows.slice(-5),split=rows.filter(m=>m.venue===venue)
  const rate=(xs:MatchRow[],f:(m:MatchRow)=>boolean)=>xs.length?xs.filter(f).length/xs.length:.5
  const pts=rows.reduce((s,m)=>s+points(m.result),0),gf=rows.reduce((s,m)=>s+m.gf,0),ga=rows.reduce((s,m)=>s+m.ga,0)
  const splitGF=split.reduce((s,m)=>s+m.gf,0),splitGA=split.reduce((s,m)=>s+m.ga,0)
  return {team,position:positions.get(norm(team))??teamCount,teams:teamCount,played:rows.length,points:pts,ppg:rows.length?pts/rows.length:1.2,winRate:rate(rows,m=>m.result==="W"),drawRate:rate(rows,m=>m.result==="D"),lossRate:rate(rows,m=>m.result==="L"),gd:gf-ga,gfPerGame:rows.length?gf/rows.length:1.25,gaPerGame:rows.length?ga/rows.length:1.25,recentForm:recent.map(m=>m.result).join("")||"—",recentPPG:recent.length?recent.reduce((s,m)=>s+points(m.result),0)/recent.length:1.2,streak:streak(rows),venueWinRate:rate(split,m=>m.result==="W"),venuePPG:split.length?split.reduce((s,m)=>s+points(m.result),0)/split.length:1.2,venueGFPerGame:split.length?splitGF/split.length:(rows.length?gf/rows.length:1.25),venueGAPerGame:split.length?splitGA/split.length:(rows.length?ga/rows.length:1.25),venueBttsRate:rate(split,m=>m.btts),venueScoreRate:rate(split,m=>m.gf>0),venueConcedeRate:rate(split,m=>m.ga>0),bttsRate:rate(rows,m=>m.btts)}
}
function h2h(home:string,away:string,history:MatchRow[]){
  const rows=history.filter(m=>same(m.team,home)&&same(m.opponent,away)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6)
  const hw=rows.filter(m=>m.result==="W").length,d=rows.filter(m=>m.result==="D").length,aw=rows.filter(m=>m.result==="L").length
  return {
    matches:rows.length,
    homeWins:hw,
    draws:d,
    awayWins:aw,
    homeWinRate:rows.length?hw/rows.length:.5,
    bttsRate:rows.length?rows.filter(m=>m.btts).length/rows.length:.5,
    recent:rows.map(m=>({date:m.date,home,away,homeGoals:m.gf,awayGoals:m.ga,result:m.result,btts:m.btts}))
  }
}
function strength(m:Metrics){const pos=m.teams>1?1-(m.position-1)/(m.teams-1):.5;const gd=m.played?m.gd/m.played:0;const gdScore=1/(1+Math.exp(-gd*1.25));return pos*.25+(m.ppg/3)*.22+(m.recentPPG/3)*.22+(m.venuePPG/3)*.16+gdScore*.10+m.winRate*.05}
function resultProb(home:Metrics,away:Metrics,h:any){
  const reliability=clamp(Math.min(home.played,away.played)/8,.25,1)
  let diff=strength(home)-strength(away)+.055
  if(h.matches>=2)diff+=(h.homeWinRate-.5)*Math.min(.08,h.matches*.012)
  for(const [m,sign] of [[home,1],[away,-1]] as const){if(m.streak.startsWith("W"))diff+=sign*Math.min(.06,Number(m.streak.slice(1)||0)*.012);if(m.streak.startsWith("L"))diff-=sign*Math.min(.06,Number(m.streak.slice(1)||0)*.012)}
  const draw=clamp((home.drawRate+away.drawRate)/2*.55+.11,.18,.34),share=1/(1+Math.exp(-diff*4.2))
  let hp=(1-draw)*share,ap=(1-draw)*(1-share),dp=draw
  hp=hp*reliability+.42*(1-reliability);dp=dp*reliability+.28*(1-reliability);ap=ap*reliability+.30*(1-reliability)
  const t=hp+dp+ap;return{home:pct(hp/t),draw:pct(dp/t),away:pct(ap/t),reliability}
}
function bttsProb(home:Metrics,away:Metrics,h:any){
  const rel=clamp(Math.min(home.played,away.played)/8,.25,1)
  const scoring=((home.venueScoreRate*away.venueConcedeRate)+(away.venueScoreRate*home.venueConcedeRate))/2
  let p=home.venueBttsRate*.24+away.venueBttsRate*.24+home.bttsRate*.13+away.bttsRate*.13+scoring*.18+h.bttsRate*.08
  return pct(clamp(p*rel+.5*(1-rel),.16,.84))
}
function poissonPmf(lambda:number,k:number){
  if(lambda<=0)return k===0?1:0
  let factorial=1
  for(let i=2;i<=k;i++)factorial*=i
  return Math.exp(-lambda)*Math.pow(lambda,k)/factorial
}
function inPlayProbabilities(input:{
  minute:number;homeScore:number;awayScore:number;home:Metrics;away:Metrics;
  preHome:number;preDraw:number;preAway:number;preBtts:number;finished?:boolean
}){
  const minute=clamp(input.minute,0,96)
  if(input.finished){
    const home=input.homeScore>input.awayScore?1:0
    const draw=input.homeScore===input.awayScore?1:0
    const away=input.awayScore>input.homeScore?1:0
    const btts=input.homeScore>0&&input.awayScore>0?1:0
    return {home,draw,away,bttsYes:btts,bttsNo:1-btts,remainingHomeGoals:0,remainingAwayGoals:0}
  }
  const remaining=clamp((96-minute)/96,0,1)
  const baseHome=Math.max(.25,(input.home.venueGFPerGame+input.away.venueGAPerGame)/2)
  const baseAway=Math.max(.25,(input.away.venueGFPerGame+input.home.venueGAPerGame)/2)
  const preBias=clamp((input.preHome-input.preAway)*.32,-.18,.18)
  let lambdaHome=baseHome*remaining*(1+preBias)
  let lambdaAway=baseAway*remaining*(1-preBias)
  if(input.homeScore<input.awayScore){lambdaHome*=1.12;lambdaAway*=.92}
  if(input.awayScore<input.homeScore){lambdaAway*=1.12;lambdaHome*=.92}
  lambdaHome=clamp(lambdaHome,.001,3.5)
  lambdaAway=clamp(lambdaAway,.001,3.5)

  let h=0,d=0,a=0,total=0
  for(let hg=0;hg<=7;hg++){
    for(let ag=0;ag<=7;ag++){
      const p=poissonPmf(lambdaHome,hg)*poissonPmf(lambdaAway,ag)
      total+=p
      const fh=input.homeScore+hg,fa=input.awayScore+ag
      if(fh>fa)h+=p
      else if(fh===fa)d+=p
      else a+=p
    }
  }
  if(total>0){h/=total;d/=total;a/=total}
  const priorWeight=clamp(remaining*.22,0,.22)
  h=h*(1-priorWeight)+input.preHome*priorWeight
  d=d*(1-priorWeight)+input.preDraw*priorWeight
  a=a*(1-priorWeight)+input.preAway*priorWeight
  const resultTotal=h+d+a
  h/=resultTotal;d/=resultTotal;a/=resultTotal

  let bttsYes:number
  if(input.homeScore>0&&input.awayScore>0)bttsYes=1
  else if(input.homeScore>0)bttsYes=1-Math.exp(-lambdaAway)
  else if(input.awayScore>0)bttsYes=1-Math.exp(-lambdaHome)
  else bttsYes=(1-Math.exp(-lambdaHome))*(1-Math.exp(-lambdaAway))
  const bttsPriorWeight=clamp(remaining*.12,0,.12)
  if(!(input.homeScore>0&&input.awayScore>0)){
    bttsYes=bttsYes*(1-bttsPriorWeight)+input.preBtts*bttsPriorWeight
  }
  bttsYes=clamp(bttsYes,0,1)
  return {home:pct(h),draw:pct(d),away:pct(a),bttsYes:pct(bttsYes),bttsNo:pct(1-bttsYes),remainingHomeGoals:pct(lambdaHome),remainingAwayGoals:pct(lambdaAway)}
}
function grade(certainty:number,reliability:number){const s=certainty*.72+reliability*.28;return s>=.72?"A":s>=.60?"B":s>=.49?"C":"D"}
function preferredBook(name:string){const n=norm(name);if(n.includes("bet365"))return "Bet365";if(n.includes("sky bet")||n.includes("skybet"))return "Sky Bet";if(n.includes("william hill"))return "William Hill";if(n.includes("paddy power"))return "Paddy Power";return null}

const internationalPredictionCache=new Map<string,{expires:number,value:any}>()
const internationalTeamFormCache=new Map<string,{expires:number,value:any}>()
const espnInternationalFormCache=new Map<string,{expires:number,value:any}>()
const espnCompetitionHistoryCache=new Map<string,{expires:number,value:any[]}>()

async function espnJson(url:string){
  try{
    const r=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(9000),headers:{accept:"application/json"}})
    if(!r.ok)return null
    return await r.json()
  }catch{return null}
}
function monthKeysBack(beforeDate:string,count=14){
  const d=new Date(beforeDate+"T12:00:00Z")
  const out:string[]=[]
  let y=d.getUTCFullYear(),m=d.getUTCMonth()+1
  for(let i=0;i<count;i++){
    out.push(String(y)+String(m).padStart(2,"0"))
    m--;if(m<1){m=12;y--}
  }
  return out
}
function espnScore(comp:any,side:"home"|"away"){
  const row=(comp?.competitors??[]).find((x:any)=>x?.homeAway===side)
  const raw=row?.score?.value??row?.score?.displayValue??row?.score
  const v=Number(raw)
  return Number.isFinite(v)?v:0
}
async function espnCompetitionHistory(slug:string,beforeDate:string){
  const key=[slug,beforeDate.slice(0,7)].join("|")
  const cached=espnCompetitionHistoryCache.get(key)
  if(cached&&cached.expires>Date.now())return cached.value
  const months=monthKeysBack(beforeDate,14)
  const responses=await Promise.all(months.map(month=>
    espnJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+month+"&limit=500")
  ))
  const events=new Map<string,any>()
  for(const data of responses){
    for(const event of data?.events??[]){
      const id=String(event?.id??"")
      const d=String(event?.date??"").slice(0,10)
      const status=event?.status?.type??{}
      const complete=status?.completed===true||String(status?.state??"").toLowerCase()==="post"
      if(!id||!complete||!d||d>=beforeDate)continue
      events.set(id,event)
    }
  }
  const rows:any[]=[]
  for(const event of events.values()){
    const comp=event?.competitions?.[0]??{}
    const home=(comp?.competitors??[]).find((x:any)=>x?.homeAway==="home")
    const away=(comp?.competitors??[]).find((x:any)=>x?.homeAway==="away")
    const homeId=String(home?.team?.id??""),awayId=String(away?.team?.id??"")
    const homeName=String(home?.team?.displayName??home?.team?.name??"")
    const awayName=String(away?.team?.displayName??away?.team?.name??"")
    if(!homeName||!awayName)continue
    const hg=espnScore(comp,"home"),ag=espnScore(comp,"away")
    const d=String(event?.date??"").slice(0,10)
    rows.push({date:d,teamId:homeId,team:homeName,opponentId:awayId,opponent:awayName,gf:hg,ga:ag,result:hg>ag?"W":hg<ag?"L":"D"})
    rows.push({date:d,teamId:awayId,team:awayName,opponentId:homeId,opponent:homeName,gf:ag,ga:hg,result:ag>hg?"W":ag<hg?"L":"D"})
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date))
  espnCompetitionHistoryCache.set(key,{expires:Date.now()+6*60*60*1000,value:rows})
  return rows
}
function formFromRows(rows:any[],teamId:string,teamName:string){
  const matches=rows.filter(r=>(teamId&&String(r.teamId)===String(teamId))||same(r.team,teamName)).slice(-8)
  if(!matches.length)return null
  let points=0,wins=0,draws=0,gf=0,ga=0,btts=0,scored=0,conceded=0
  for(const row of matches){
    const a=Number(row.gf??0),b=Number(row.ga??0)
    gf+=a;ga+=b
    if(a>0)scored++
    if(b>0)conceded++
    if(a>0&&b>0)btts++
    if(row.result==="W"){points+=3;wins++}
    else if(row.result==="D"){points+=1;draws++}
  }
  const n=matches.length
  return {matches:n,ppg:points/n,winRate:wins/n,drawRate:draws/n,gfPerGame:gf/n,gaPerGame:ga/n,goalDiffPerGame:(gf-ga)/n,bttsRate:btts/n,scoreRate:scored/n,concedeRate:conceded/n,recent:matches.map(r=>r.result).join("")}
}
function h2hFromRows(rows:any[],homeId:string,homeName:string,awayId:string,awayName:string){
  const matches=rows.filter(r=>{
    const teamOk=(homeId&&String(r.teamId)===String(homeId))||same(r.team,homeName)
    const oppOk=(awayId&&String(r.opponentId)===String(awayId))||same(r.opponent,awayName)
    return teamOk&&oppOk
  }).slice(-6)
  if(!matches.length)return null
  return {
    matches:matches.length,
    homeWinRate:matches.filter(r=>r.result==="W").length/matches.length,
    drawRate:matches.filter(r=>r.result==="D").length/matches.length,
    awayWinRate:matches.filter(r=>r.result==="L").length/matches.length,
    bttsRate:matches.filter(r=>Number(r.gf)>0&&Number(r.ga)>0).length/matches.length,
  }
}
async function espnInternationalPrediction(f:any,date:string){
  const rawId=String(f?.id??"")
  const slug=rawId.includes(":")?rawId.split(":")[0]:""
  const homeId=String(f?.home?.id??""),awayId=String(f?.away?.id??"")
  const homeName=String(f?.home?.name??""),awayName=String(f?.away?.name??"")
  if(!slug||!homeName||!awayName)return null
  const rows=await espnCompetitionHistory(slug,date)
  const homeForm=formFromRows(rows,homeId,homeName),awayForm=formFromRows(rows,awayId,awayName)
  let value=internationalFormProb(homeForm,awayForm)
  if(!value)return null
  const hh=h2hFromRows(rows,homeId,homeName,awayId,awayName)
  if(hh?.matches){
    const w=Math.min(.18,.06+hh.matches*.02)
    const total=(1-w)+w
    value={
      ...value,
      home:(value.home*(1-w)+hh.homeWinRate*w)/total,
      draw:(value.draw*(1-w)+hh.drawRate*w)/total,
      away:(value.away*(1-w)+hh.awayWinRate*w)/total,
    }
  }
  const sum=value.home+value.draw+value.away
  const scoring=((homeForm.scoreRate*awayForm.concedeRate)+(awayForm.scoreRate*homeForm.concedeRate))/2
  let bttsYes=homeForm.bttsRate*.30+awayForm.bttsRate*.30+scoring*.30+(hh?.bttsRate??.5)*.10
  bttsYes=clamp(bttsYes,.12,.82)
  return {
    home:value.home/sum,draw:value.draw/sum,away:value.away/sum,bttsYes,
    source:"ESPN recent "+String(f?.tournament??"international")+" results"+(hh?.matches?" + H2H":""),
    homeForm,awayForm,h2h:hh,
  }
}

async function apiFootballRequest(path:string,params:Record<string,string>){
  const key=process.env.API_FOOTBALL_KEY
  if(!key)return null
  try{
    const url=new URL("https://v3.football.api-sports.io"+path)
    for(const[k,v]of Object.entries(params))url.searchParams.set(k,v)
    const r=await fetch(url,{headers:{"x-apisports-key":key},cache:"no-store",signal:AbortSignal.timeout(9000)})
    if(!r.ok)return null
    const j=await r.json()
    return Array.isArray(j?.response)?j.response:null
  }catch{return null}
}
function pctString(v:any){
  const n=Number(String(v??"").replace("%",""))
  return Number.isFinite(n)?clamp(n/100,.01,.99):null
}
async function recentInternationalForm(teamId:string,beforeDate:string){
  const cacheKey=teamId+"|"+beforeDate
  const cached=internationalTeamFormCache.get(cacheKey)
  if(cached&&cached.expires>Date.now())return cached.value
  const rows=await apiFootballRequest("/fixtures",{team:teamId,last:"8",timezone:"Europe/London"})??[]
  const finished=rows.filter((row:any)=>{
    const status=String(row?.fixture?.status?.short??"")
    const d=String(row?.fixture?.date??"").slice(0,10)
    return ["FT","AET","PEN"].includes(status)&&d<beforeDate
  }).slice(-8)
  if(!finished.length)return null
  let points=0,gf=0,ga=0,wins=0,draws=0
  for(const row of finished){
    const home=String(row?.teams?.home?.id??"")===teamId
    const a=Number(home?row?.goals?.home:row?.goals?.away)
    const b=Number(home?row?.goals?.away:row?.goals?.home)
    const scored=Number.isFinite(a)?a:0,conceded=Number.isFinite(b)?b:0
    gf+=scored;ga+=conceded
    if(scored>conceded){points+=3;wins++}
    else if(scored===conceded){points+=1;draws++}
  }
  const n=finished.length
  const value={matches:n,ppg:points/n,winRate:wins/n,drawRate:draws/n,gfPerGame:gf/n,gaPerGame:ga/n,goalDiffPerGame:(gf-ga)/n}
  internationalTeamFormCache.set(cacheKey,{expires:Date.now()+6*60*60*1000,value})
  return value
}
function internationalFormProb(home:any,away:any){
  if(!home||!away)return null
  const hStrength=home.ppg/3*.42+home.winRate*.18+clamp((home.goalDiffPerGame+2)/4,0,1)*.22+clamp(home.gfPerGame/3,0,1)*.18
  const aStrength=away.ppg/3*.42+away.winRate*.18+clamp((away.goalDiffPerGame+2)/4,0,1)*.22+clamp(away.gfPerGame/3,0,1)*.18
  const diff=hStrength-aStrength+.035
  const closeness=1-Math.min(1,Math.abs(diff)/.45)
  const baseDraw=clamp((home.drawRate+away.drawRate)/2*.5+.14,.18,.36)
  const draw=clamp(baseDraw+closeness*.045,.19,.38)
  const sideBudget=1-draw
  const share=1/(1+Math.exp(-diff*5.2))
  const homeP=sideBudget*share,awayP=sideBudget*(1-share)
  return {home:homeP,draw,away:awayP,source:"API-Football recent international form"}
}
async function internationalApiPredictions(date:string,fixtures:any[]){
  const needed=fixtures.filter(f=>String(f?.status??"scheduled").toLowerCase()==="scheduled")
  if(!needed.length)return new Map<string,any>()
  const fixtureRows=process.env.API_FOOTBALL_KEY
    ? await apiFootballRequest("/fixtures",{date,timezone:"Europe/London"})??[]
    : []
  const matches=new Map<string,any>()
  for(const f of needed){
    const key=[date,norm(f?.home?.name),norm(f?.away?.name)].join("|")
    const cached=internationalPredictionCache.get(key)
    if(cached&&cached.expires>Date.now()){matches.set(String(f.id),cached.value);continue}
    let value:any=null
    if(process.env.API_FOOTBALL_KEY){
      const hit=fixtureRows.find((row:any)=>same(row?.teams?.home?.name,f?.home?.name)&&same(row?.teams?.away?.name,f?.away?.name))
      const id=String(hit?.fixture?.id??"")
      if(id){
        const rows=await apiFootballRequest("/predictions",{fixture:id})
        const row=rows?.[0]
        const home=pctString(row?.predictions?.percent?.home)
        const draw=pctString(row?.predictions?.percent?.draw)
        const away=pctString(row?.predictions?.percent?.away)
        if(home!=null&&draw!=null&&away!=null){
          const total=home+draw+away
          value={
            home:home/total,draw:draw/total,away:away/total,
            advice:String(row?.predictions?.advice??""),
            winner:String(row?.predictions?.winner?.name??""),
            source:"API-Football predictions",
          }
        }else{
          const homeId=String(hit?.teams?.home?.id??""),awayId=String(hit?.teams?.away?.id??"")
          if(homeId&&awayId){
            const [homeForm,awayForm]=await Promise.all([recentInternationalForm(homeId,date),recentInternationalForm(awayId,date)])
            value=internationalFormProb(homeForm,awayForm)
          }
        }
      }
    }
    if(!value)value=await espnInternationalPrediction(f,date)
    if(!value)continue
    internationalPredictionCache.set(key,{expires:Date.now()+6*60*60*1000,value})
    matches.set(String(f.id),value)
  }
  return matches
}
async function oddsRows(competition:Competition,date:string){
  const key=process.env.API_FOOTBALL_KEY,leagueId=LEAGUE_IDS[competition];if(!key||!leagueId)return []
  try{const u=new URL("https://v3.football.api-sports.io/odds");u.searchParams.set("league",leagueId);u.searchParams.set("season",String(seasonYear(date)));u.searchParams.set("date",date);u.searchParams.set("timezone","Europe/London")
    const r=await fetch(u,{headers:{"x-apisports-key":key},next:{revalidate:900},signal:AbortSignal.timeout(10000)});if(!r.ok)return[];const j=await r.json();return Array.isArray(j?.response)?j.response:[]
  }catch{return[]}
}
function priceMap(rows:any[],home:string,away:string){
  const out:Record<string,PriceSet>={},row=rows.find((x:any)=>same(x?.teams?.home?.name,home)&&same(x?.teams?.away?.name,away));if(!row)return out
  for(const b of row?.bookmakers??[]){const book=preferredBook(String(b?.name??""));if(!book)continue;const p=out[book]??{}
    for(const bet of b?.bets??[]){const name=norm(bet?.name),isResult=/match winner|1x2|full time result|fulltime result/.test(name),isDouble=/double chance/.test(name),isBtts=/both teams.*score|btts/.test(name);if(!isResult&&!isDouble&&!isBtts)continue
      for(const v of bet?.values??[]){const odd=Number(v?.odd);if(!Number.isFinite(odd)||odd<=1)continue;const val=norm(String(v?.value??""))
        if(isResult){if(same(val,home)||val==="home"||val==="1")p.homeWin=odd;else if(same(val,away)||val==="away"||val==="2")p.awayWin=odd;else if(val==="draw"||val==="x")p.draw=odd}
        else if(isDouble){
          if(["home or draw","1x","1 x","home draw"].includes(val)||val.includes("1x"))p.homeOrDraw=odd
          else if(["away or draw","x2","x 2","draw away"].includes(val)||val.includes("x2"))p.awayOrDraw=odd
        }else{if(val==="yes")p.bttsYes=odd;else if(val==="no")p.bttsNo=odd}
      }
    }out[book]=p
  }return out
}
function exactPrice(pred:any,market:string,book:string){if(pred?.inPlay)return null;const p=pred.oddsByBook?.[book];if(!p)return null;return market==="homeWin"?p.homeWin??null:market==="awayWin"?p.awayWin??null:market==="draw"?p.draw??null:market==="bttsYes"?p.bttsYes??null:market==="bttsNo"?p.bttsNo??null:null}
function buildSlip(id:string,title:string,subtitle:string,legs:any[],structureKey:"fold5"|"fold7"|"fold10",requiredLegs:number){
  const xs=legs.filter(Boolean)
  const uniqueByFixture:any[]=[]
  const seenFixtures=new Set<string>()
  for(const leg of xs){
    const fixtureId=String(leg?.prediction?.id??"")
    if(!fixtureId||seenFixtures.has(fixtureId))continue
    seenFixtures.add(fixtureId)
    uniqueByFixture.push(leg)
  }
  const minimum=requiredLegs===10?Math.min(10,Math.max(5,uniqueByFixture.length)):requiredLegs
  const targetCount=requiredLegs===10&&uniqueByFixture.length<10?uniqueByFixture.length:requiredLegs
  const enough=uniqueByFixture.length>=minimum&&targetCount>=5
  const selected=enough?uniqueByFixture.slice(0,targetCount):[]
  const rawAllHit=selected.length?selected.reduce((v,l)=>v*Math.max(.01,l.probability),1):null
  const containsLive=selected.some(l=>Boolean(l?.prediction?.inPlay))
  const backtest=(matchAccaBacktest as any)?.structures?.[structureKey]
  const sample=Number(backtest?.sample??0)
  const observed=Number(backtest?.hitRate??0)
  const historicalModel=Number(backtest?.avgModel??0)
  const reliability=sample/(sample+25)
  const ratio=historicalModel>0?clamp(observed/historicalModel,.35,1.10):1
  const adjustedAllHit=rawAllHit==null?null:containsLive?clamp(rawAllHit,.001,.99):clamp(rawAllHit*(1-reliability+reliability*ratio),.001,.99)
  const fair=adjustedAllHit==null?null:1/adjustedAllHit
  let book:string|null=null,exact:number|null=null
  for(const b of BOOKS){const prices=selected.map(l=>exactPrice(l.prediction,l.market,b));if(!prices.length||prices.some(x=>x==null))continue;const combined=prices.reduce((v,x)=>v*Number(x),1);if(exact==null||combined>exact){book=b;exact=combined}}
  const avgLeg=selected.length?selected.reduce((s,l)=>s+Number(l.probability??0),0)/selected.length:0
  const actualTitle=selected.length&&selected.length!==requiredLegs?selected.length+"-Fold Risky Acca":title
  const qualityNote=avgLeg>=.58?"Strong average leg confidence":avgLeg>=.48?"Moderate average leg confidence":"Lower-confidence matchday — review each leg"
  const actualSubtitle=(selected.length&&selected.length!==requiredLegs?"Risky target is 10 legs, reduced to "+selected.length+" because this matchday only has "+uniqueByFixture.length+" usable fixtures. ":"")+qualityNote+"."
  return {id,title:actualTitle,subtitle:actualSubtitle,structureKey,requiredLegs:selected.length||requiredLegs,targetLegs:requiredLegs,available:enough,containsLive,legs:selected.map(l=>({fixtureId:l.prediction.id,competition:l.prediction.competition,kickoff:l.prediction.kickoff,home:l.prediction.home,away:l.prediction.away,inPlay:Boolean(l.prediction.inPlay),elapsed:l.prediction.elapsed??null,score:l.prediction.score??null,market:l.market,label:l.label,probability:pct(l.probability),fairOdds:Math.round((1/Math.max(.05,l.probability))*100)/100,bookmakerOdds:book?exactPrice(l.prediction,l.market,book):null,bookmaker:book,grade:l.grade,reasons:l.reasons})),modelAllHitProbability:rawAllHit==null?null:pct(rawAllHit),adjustedAllHitProbability:adjustedAllHit==null?null:pct(adjustedAllHit),historicalStructureSample:containsLive?0:sample,historicalStructureHitRate:containsLive?null:(sample?observed:null),fairCombinedOdds:fair==null?null:Math.round(fair*100)/100,bookmaker:book,exactCombinedOdds:exact==null?null:Math.round(exact*100)/100,exactPriced:Boolean(book&&exact),combinedProbabilityNote:containsLive?"Contains live legs: combined probability uses the current live model product and is not pre-match structure-calibrated.":"Pre-match combined probability is adjusted against the historical hit-rate of the same fold size."}
}

const responseCache=new Map<string,{at:number,payload:any}>()
const FRESH_CACHE_MS=5*60*1000
const STALE_CACHE_MS=6*60*60*1000

export async function GET(request:Request){
  const url=new URL(request.url),date=url.searchParams.get("date")??londonToday()
  const refresh=url.searchParams.has("refresh")
  const cached=responseCache.get(date)
  if(!refresh&&cached&&Date.now()-cached.at<FRESH_CACHE_MS){
    return NextResponse.json({...cached.payload,cached:true},{headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=900"}})
  }
  try{
    const fixtureRes=await fixturesGET(new Request("http://local/api/fixtures?"+new URLSearchParams({date,nextIfEmpty:"0"}).toString()))
    if(!fixtureRes.ok)return fixtureRes
    const fixtureData=await fixtureRes.json()
    const internationalFallbacks=await internationalApiPredictions(date,fixtureData?.leagues?.International??[])
    const packs=new Map<Competition,{season:MatchRow[];history:MatchRow[];odds:any[]}>()
    await Promise.all(COMPETITIONS.map(async c=>{const [s,h,o]=await Promise.all([matches(c,seasonStart(date),date),matches(c,historyStart(date),date),oddsRows(c,date)]);packs.set(c,{season:s,history:h,odds:o})}))
    const predictions:any[]=[]
    for(const competition of COMPETITIONS){const pack=packs.get(competition)!,tbl=table(pack.season)
      for(const f of fixtureData?.leagues?.[competition]??[]){const home=canonical(String(f.home?.name??""),tbl.teams),away=canonical(String(f.away?.name??""),tbl.teams),hm=metrics(home,pack.season,tbl.positions,tbl.teams.length||24,"home"),am=metrics(away,pack.season,tbl.positions,tbl.teams.length||24,"away"),hh=h2h(home,away,pack.history),wp=resultProb(hm,am,hh),bp=bttsProb(hm,am,hh)
        const rawHome=wp.home,rawAway=wp.away,rawBtts=bp
        const intlFallback=competition==="International"&&hm.played===0&&am.played===0?internationalFallbacks.get(String(f.id)):null
        const useCalibration=competition!=="International"
        const calibratedHome=useCalibration?calibrateMarket("homeWin",rawHome):rawHome
        const calibratedAway=useCalibration?calibrateMarket("awayWin",rawAway):rawAway
        const resultScale=calibratedHome+calibratedAway
        const drawBase=clamp(wp.draw,.12,.45)
        const sideBudget=1-drawBase
        let homeP=resultScale>0?calibratedHome/resultScale*sideBudget:rawHome
        let awayP=resultScale>0?calibratedAway/resultScale*sideBudget:rawAway
        let drawP=1-homeP-awayP
        if(intlFallback){
          // When our international history has no usable sample, use API-Football's
          // independent form/statistics prediction rather than identical neutral priors.
          homeP=clamp(Number(intlFallback.home),.05,.88)
          drawP=clamp(Number(intlFallback.draw),.05,.55)
          awayP=clamp(Number(intlFallback.away),.05,.88)
          const t=homeP+drawP+awayP
          homeP/=t;drawP/=t;awayP/=t
        }
        const calibratedBttsYes=useCalibration?calibrateMarket("bttsYes",rawBtts):rawBtts
        const calibratedBttsNo=useCalibration?calibrateMarket("bttsNo",1-rawBtts):1-rawBtts
        const bttsScale=calibratedBttsYes+calibratedBttsNo
        let bttsYes=bttsScale>0?calibratedBttsYes/bttsScale:rawBtts
        if(intlFallback?.bttsYes!=null)bttsYes=clamp(Number(intlFallback.bttsYes),.08,.92)
        const bttsNo=1-bttsYes
        const status=String(f.status??"scheduled").toLowerCase()
        if(["postponed","cancelled","canceled","abandoned","suspended"].includes(status))continue
        const scoreHome=Number(f?.score?.home)
        const scoreAway=Number(f?.score?.away)
        const hasScore=Number.isFinite(scoreHome)&&Number.isFinite(scoreAway)
        const kickoffMs=new Date(String(f.kickoff)).getTime()
        const minutesSinceKickoff=Number.isFinite(kickoffMs)?Math.floor((Date.now()-kickoffMs)/60000):0
        const explicitFinished=["finished","ft","full time","after extra time","aet"].includes(status)
        const explicitLive=["live","halftime","in progress","1h","2h","et","extra time"].includes(status)
        const inferredLive=hasScore&&!explicitFinished&&Number.isFinite(kickoffMs)&&minutesSinceKickoff>=0&&minutesSinceKickoff<=180
        const live=explicitLive||inferredLive
        const finished=explicitFinished
        const elapsed=status==="halftime"?45:Math.max(0,Math.min(96,Number.isFinite(Number(f?.elapsed))?Number(f?.elapsed):minutesSinceKickoff))
        const inPlay=live&&hasScore
        const liveModel=inPlay||finished&&hasScore
          ? inPlayProbabilities({minute:finished?96:elapsed,homeScore:scoreHome,awayScore:scoreAway,home:hm,away:am,preHome:homeP,preDraw:drawP,preAway:awayP,preBtts:bttsYes,finished})
          : null
        const currentHome=liveModel?.home??homeP
        const currentDraw=liveModel?.draw??drawP
        const currentAway=liveModel?.away??awayP
        const currentBttsYes=liveModel?.bttsYes??bttsYes
        const currentBttsNo=liveModel?.bttsNo??bttsNo
        const side=currentHome>=currentAway&&currentHome>=.36?"home":currentAway>currentHome&&currentAway>=.36?"away":null
        const winnerP=side==="home"?currentHome:side==="away"?currentAway:Math.max(currentHome,currentAway)
        const sideGap=Math.abs(currentHome-currentAway)
        const strongestSide=Math.max(currentHome,currentAway)
        const reliableForDraw=competition!=="International"||Boolean(intlFallback)||hm.played>0||am.played>0
        const drawEligible=reliableForDraw&&!finished&&sideGap<=.10&&currentDraw>=.285&&currentDraw>=strongestSide-.10
        const bttsSettled=Boolean(hasScore&&scoreHome>0&&scoreAway>0)
        const bpick=bttsSettled?null:currentBttsYes>=.535?"yes":null
        const bprob=bpick==="yes"?currentBttsYes:currentBttsYes
        const rel=wp.reliability
        const reasons=competition==="International"&&hm.played===0&&am.played===0
          ? [intlFallback
              ? "International model uses "+String(intlFallback.source??"recent country form")+(intlFallback.homeForm&&intlFallback.awayForm?" · "+String(f.home.name)+" "+String(intlFallback.homeForm.recent??"")+" · "+String(f.away.name)+" "+String(intlFallback.awayForm.recent??""):"")+" because the local database sample is unavailable or sparse."
              : "International history is sparse, so this match is heavily shrunk toward neutral priors."]
          : [ordinal(hm.position)+" vs "+ordinal(am.position)+" in "+competition,String(f.home.name)+" home win "+Math.round(hm.venueWinRate*100)+"% · "+String(f.away.name)+" away win "+Math.round(am.venueWinRate*100)+"%","Form "+String(f.home.name)+" "+hm.recentForm+" · "+String(f.away.name)+" "+am.recentForm]
        if(hh.matches>=2)reasons.push("H2H "+String(f.home.name)+" "+hh.homeWins+"W · "+hh.draws+"D · "+String(f.away.name)+" "+hh.awayWins+"W · BTTS "+Math.round(hh.bttsRate*100)+"%")
        if(inPlay){
          const state=scoreHome===scoreAway?"level":scoreHome>scoreAway?String(f.home.name)+" leading":String(f.away.name)+" leading"
          reasons.unshift("LIVE "+elapsed+"' · "+String(scoreHome)+"-"+String(scoreAway)+" · "+state+" · probabilities recalculated from score, time remaining and scoring rates")
        }
        predictions.push({id:String(f.id),competition,kickoff:String(f.kickoff),status,inPlay,finished,bttsSettled,elapsed:inPlay?elapsed:null,score:hasScore?{home:scoreHome,away:scoreAway}:null,home:String(f.home.name),away:String(f.away.name),homeCrest:f.home?.crest??null,awayCrest:f.away?.crest??null,homeStats:hm,awayStats:am,h2h:hh,preMatchProbabilities:{homeWin:pct(homeP),draw:pct(drawP),awayWin:pct(awayP),bttsYes:pct(bttsYes),bttsNo:pct(bttsNo)},probabilities:{homeWin:pct(currentHome),draw:pct(currentDraw),awayWin:pct(currentAway),bttsYes:pct(currentBttsYes),bttsNo:pct(currentBttsNo)},inPlayModel:liveModel,winnerPick:side&&!finished?{side,team:side==="home"?String(f.home.name):String(f.away.name),loser:side==="home"?String(f.away.name):String(f.home.name),probability:pct(winnerP),grade:grade(winnerP,rel)}:null,drawPick:drawEligible?{probability:pct(currentDraw),grade:grade(.5+Math.max(0,currentDraw-.24),Math.max(rel,.55))}:null,bttsPick:bpick&&!finished?{selection:bpick,probability:pct(bprob),grade:grade(.5+Math.abs(currentBttsYes-.5),rel)}:null,reasons,oddsByBook:priceMap(pack.odds,String(f.home.name),String(f.away.name))})
      }
    }
    const wins=predictions.filter(p=>!p.finished&&p.winnerPick&&p.winnerPick.grade!=="D").map(p=>({prediction:p,market:p.winnerPick.side==="home"?"homeWin":"awayWin",label:p.winnerPick.team+" to win",probability:p.winnerPick.probability,grade:p.winnerPick.grade,reasons:p.reasons})).sort((a,b)=>b.probability-a.probability)
    const btts=predictions.filter(p=>!p.finished&&p.bttsPick&&p.bttsPick.grade!=="D").map(p=>({prediction:p,market:p.bttsPick.selection==="yes"?"bttsYes":"bttsNo",label:"BTTS "+(p.bttsPick.selection==="yes"?"Yes":"No"),probability:p.bttsPick.probability,grade:p.bttsPick.grade,reasons:p.reasons})).sort((a,b)=>b.probability-a.probability)
    const mixed=predictions.filter(p=>!p.finished).map(p=>{
      const resultCandidates=[
        {market:"homeWin",label:p.home+" to win",probability:p.probabilities.homeWin},
        {market:"draw",label:"Draw",probability:p.probabilities.draw},
        {market:"awayWin",label:p.away+" to win",probability:p.probabilities.awayWin},
      ].map((x:any)=>({
        prediction:p,...x,
        grade:grade(x.probability,Math.max(.45,p?.competition==="International"?.68:(p?.inPlayModel?.reliability??.55))),
        reasons:p.reasons,
        score:x.probability,
      }))
      const bttsCandidates=p.bttsSettled?[]:[
        {prediction:p,market:"bttsYes",label:"BTTS Yes",probability:p.probabilities.bttsYes,grade:grade(.5+Math.abs(p.probabilities.bttsYes-.5),.58),reasons:p.reasons,score:p.probabilities.bttsYes},
      ]
      return [...resultCandidates,...bttsCandidates]
        .sort((a:any,b:any)=>b.score-a.score||b.probability-a.probability)[0]??null
    }).filter(Boolean).sort((a:any,b:any)=>b.score-a.score||b.probability-a.probability)
    const activePredictions=predictions.filter(p=>!p.finished)
    const finishedPredictions=predictions.filter(p=>p.finished)
    const payload={ok:true,date,generatedAt:new Date().toISOString(),fixtureCount:predictions.length,activeFixtureCount:activePredictions.length,finishedFixtureCount:finishedPredictions.length,predictions:activePredictions,finishedPredictions,slips:[
      buildSlip("fold-5","5-Fold Acca","Five strongest selections from five different matches.",mixed,"fold5",5),
      buildSlip("fold-7","7-Fold Acca","Seven strongest selections from seven different matches.",mixed,"fold7",7),
      buildSlip("fold-10","10-Fold Acca","Ten strongest selections from ten different matches.",mixed,"fold10",10)
    ],cached:false,staleFallback:false,methodology:{resultModel:"Premier League through League Two use league position, PPG, recent five-match form, streaks, home/away PPG and win rate, goal difference and recent H2H with sample shrinkage, followed by walk-forward calibration. Internationals use available local history first, then API-Football where available, and finally ESPN recent competition form using the actual country team IDs. Neutral identical priors are not used to build suggested Accas when recent team form can be recovered.",bttsModel:"Home/away BTTS, scoring and conceding rates, overall BTTS and H2H BTTS. Once both teams have already scored in-play, BTTS is treated as settled and removed from betting recommendations.",pricing:"Each fold uses one selection per fixture. Acca recommendations never use double-chance markets; eligible legs are direct home/away wins, selective draws when the match is genuinely even, and BTTS Yes only. BTTS No is deliberately excluded from automatic Acca recommendations. Exact combined odds are shown only when one preferred bookmaker prices every leg. Model fair combined odds are adjusted using the historical hit-rate of the same fold size rather than naive probability multiplication alone.",inPlay:"Live matches are recalculated from the current score, match minute, remaining-time goal rates and the calibrated pre-match strength. Pre-match bookmaker prices are never reused as if they were live prices.",fallback:"Team history uses the live database when available and automatically falls back to the checked-in daily current-season snapshot if database quota or connectivity fails.",caution:"Model estimates, not guarantees. Team news, red cards, injuries and other in-play events can materially change outcomes."}}
    responseCache.set(date,{at:Date.now(),payload})
    return NextResponse.json(payload,{headers:{"Cache-Control":activePredictions.some(p=>p.inPlay)?"public, s-maxage=20, stale-while-revalidate=120":"public, s-maxage=300, stale-while-revalidate=1800"}})
  }catch(error){
    const stale=responseCache.get(date)
    if(stale&&Date.now()-stale.at<STALE_CACHE_MS){
      return NextResponse.json({...stale.payload,cached:true,staleFallback:true,warning:"Fresh data pull failed; showing the last successful Accumulator snapshot."},{headers:{"Cache-Control":"public, s-maxage=30, stale-while-revalidate=900"}})
    }
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Accumulator analysis failed"},{status:500})
  }
}
