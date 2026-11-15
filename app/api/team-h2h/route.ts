import { NextResponse } from "next/server"
import { and, gte, inArray, lt } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { playerH2H } from "@/lib/db/schema"
import { snapshotRowsForCompetition } from "@/lib/current-season-snapshot"

export const dynamic="force-dynamic"
export const revalidate=0

const DOMESTIC_START="2025-07-01"
const INTERNATIONAL_START="2024-06-01"
const DOMESTIC=new Set(["Premier League","Championship","League One","League Two"])

const DOMESTIC_ESPN=[
  {slug:"eng.1",label:"Premier League",seasons:[2025,2026]},
  {slug:"eng.2",label:"Championship",seasons:[2025,2026]},
  {slug:"eng.3",label:"League One",seasons:[2025,2026]},
  {slug:"eng.4",label:"League Two",seasons:[2025,2026]},
  {slug:"eng.fa",label:"FA Cup",seasons:[2025,2026]},
  {slug:"eng.league_cup",label:"League Cup",seasons:[2025,2026]},
]
const INTERNATIONAL_ESPN=[
  {slug:"fifa.world",label:"FIFA World Cup",seasons:[2026]},
  {slug:"uefa.euro",label:"UEFA European Championship",seasons:[2024]},
  {slug:"uefa.nations",label:"UEFA Nations League",seasons:[2022,2024,2026]},
  {slug:"fifa.worldq.uefa",label:"FIFA World Cup Qualifying - UEFA",seasons:[2026]},
  {slug:"fifa.friendly",label:"International Friendly",seasons:[2024,2025,2026]},
]

function norm(v:string|null|undefined){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function same(a:string|null|undefined,b:string|null|undefined){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function dateOnly(v:any){return String(v??"").slice(0,10)}
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:0}
function startFor(competition:string){return DOMESTIC.has(competition)?DOMESTIC_START:INTERNATIONAL_START}
function targetDate(date:string){return date||new Date().toISOString().slice(0,10)}

type Meeting={
  fixtureId?:string
  date:string
  competition?:string|null
  home:string
  away:string
  homeGoals:number
  awayGoals:number
  scorers:Array<{player:string;team:string;goals:number;assists:number}>
  bookings:Array<{player:string;team:string;yellow:boolean;red:boolean}>
  players:Array<{player:string;team:string;minutes:number;goals:number;assists:number;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;yellow:boolean;red:boolean}>
  totals:{home:{yellow:number;red:number;fouls:number;shots:number;sot:number};away:{yellow:number;red:number;fouls:number;shots:number;sot:number}}
}

type Row={
  playerName:string
  team:string
  opponent:string
  matchDate:string
  competition?:string|null
  venue:string
  minutes:number
  goals:number
  assists:number
  foulsCommitted:number
  foulsDrawn:number
  shots:number
  shotsOnTarget:number
  yellowCard:boolean
  redCard:boolean
}

function emptyTotals(){return {yellow:0,red:0,fouls:0,shots:0,sot:0}}

function aggregate(rows:Row[],home:string,away:string,start:string,before:string):Meeting[]{
  const byDate=new Map<string,Row[]>()
  for(const row of rows){
    if(!(same(row.team,home)&&same(row.opponent,away))&&!(same(row.team,away)&&same(row.opponent,home)))continue
    const d=dateOnly(row.matchDate)
    if(!d||d<start||d>=before)continue
    const list=byDate.get(d)??[]
    list.push(row)
    byDate.set(d,list)
  }
  return [...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12).map(([date,matchRows])=>{
    const first=matchRows[0]
    const homeTeamRows=matchRows.filter(r=>same(r.team,home))
    const awayTeamRows=matchRows.filter(r=>same(r.team,away))
    const reverseHome=homeTeamRows[0]?.venue?.toLowerCase()==="away"
    const actualHome=reverseHome?away:home
    const actualAway=reverseHome?home:away
    const actualHomeRows=reverseHome?awayTeamRows:homeTeamRows
    const actualAwayRows=reverseHome?homeTeamRows:awayTeamRows
    const scorers=matchRows.filter(r=>n(r.goals)>0).map(r=>({player:r.playerName,team:r.team,goals:n(r.goals),assists:n(r.assists)}))
      .sort((a,b)=>b.goals-a.goals||a.player.localeCompare(b.player))
    const bookings=matchRows.filter(r=>r.yellowCard||r.redCard).map(r=>({player:r.playerName,team:r.team,yellow:r.yellowCard,red:r.redCard}))
    const players=matchRows.filter(r=>n(r.minutes)>0||n(r.goals)>0||r.yellowCard||r.redCard).map(r=>({
      player:r.playerName,team:r.team,minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),
      foulsCommitted:n(r.foulsCommitted),foulsDrawn:n(r.foulsDrawn),shots:n(r.shots),shotsOnTarget:n(r.shotsOnTarget),
      yellow:r.yellowCard,red:r.redCard,
    })).sort((a,b)=>b.goals-a.goals||Number(b.yellow)-Number(a.yellow)||b.foulsCommitted-a.foulsCommitted||b.shots-a.shots)
    const totals=(teamRows:Row[])=>({
      yellow:teamRows.filter(r=>r.yellowCard).length,
      red:teamRows.filter(r=>r.redCard).length,
      fouls:teamRows.reduce((s,r)=>s+n(r.foulsCommitted),0),
      shots:teamRows.reduce((s,r)=>s+n(r.shots),0),
      sot:teamRows.reduce((s,r)=>s+n(r.shotsOnTarget),0),
    })
    return {
      date,competition:first?.competition??null,home:actualHome,away:actualAway,
      homeGoals:actualHomeRows.reduce((s,r)=>s+n(r.goals),0),
      awayGoals:actualAwayRows.reduce((s,r)=>s+n(r.goals),0),
      scorers,bookings,players,totals:{home:totals(actualHomeRows),away:totals(actualAwayRows)},
    }
  })
}

async function apiFootball(path:string,params:Record<string,string>){
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

const apiCache=new Map<string,{expires:number,value:Meeting[]}>()
async function resolveApiTeamIds(date:string,home:string,away:string){
  const fixtures=await apiFootball("/fixtures",{date,timezone:"Europe/London"})??[]
  const hit=fixtures.find((f:any)=>same(f?.teams?.home?.name,home)&&same(f?.teams?.away?.name,away))
  if(hit?.teams?.home?.id&&hit?.teams?.away?.id)return {homeId:String(hit.teams.home.id),awayId:String(hit.teams.away.id)}
  const [a,b]=await Promise.all([apiFootball("/teams",{search:home}),apiFootball("/teams",{search:away})])
  const pick=(rows:any[]|null,name:string)=>{
    const exact=(rows??[]).find((x:any)=>norm(x?.team?.name)===norm(name))
    const fuzzy=exact??(rows??[]).find((x:any)=>same(x?.team?.name,name))
    return fuzzy?.team?.id?String(fuzzy.team.id):""
  }
  return {homeId:pick(a,home),awayId:pick(b,away)}
}
function basicApiMeeting(row:any):Meeting{
  return {
    fixtureId:String(row?.fixture?.id??""),
    date:dateOnly(row?.fixture?.date),
    competition:String(row?.league?.name??"")||null,
    home:String(row?.teams?.home?.name??""),
    away:String(row?.teams?.away?.name??""),
    homeGoals:n(row?.goals?.home),awayGoals:n(row?.goals?.away),
    scorers:[],bookings:[],players:[],totals:{home:emptyTotals(),away:emptyTotals()},
  }
}
async function enrichApiMeeting(meeting:Meeting){
  if(!meeting.fixtureId)return meeting
  const teams=await apiFootball("/fixtures/players",{fixture:meeting.fixtureId})
  if(!teams?.length)return meeting
  const players:any[]=[]
  for(const teamBlock of teams){
    const teamName=String(teamBlock?.team?.name??"")
    for(const p of teamBlock?.players??[]){
      const s=Array.isArray(p?.statistics)?p.statistics[0]??{}:{}
      players.push({
        player:String(p?.player?.name??"Unknown"),team:teamName,minutes:n(s?.games?.minutes),
        goals:n(s?.goals?.total),assists:n(s?.goals?.assists),foulsCommitted:n(s?.fouls?.committed),
        foulsDrawn:n(s?.fouls?.drawn),shots:n(s?.shots?.total),shotsOnTarget:n(s?.shots?.on),
        yellow:n(s?.cards?.yellow)>0,red:n(s?.cards?.red)>0,
      })
    }
  }
  const h=players.filter(p=>same(p.team,meeting.home)),a=players.filter(p=>same(p.team,meeting.away))
  const totals=(ps:any[])=>({yellow:ps.filter(p=>p.yellow).length,red:ps.filter(p=>p.red).length,fouls:ps.reduce((s,p)=>s+p.foulsCommitted,0),shots:ps.reduce((s,p)=>s+p.shots,0),sot:ps.reduce((s,p)=>s+p.shotsOnTarget,0)})
  return {
    ...meeting,
    scorers:players.filter(p=>p.goals>0).map(p=>({player:p.player,team:p.team,goals:p.goals,assists:p.assists})).sort((x,y)=>y.goals-x.goals),
    bookings:players.filter(p=>p.yellow||p.red).map(p=>({player:p.player,team:p.team,yellow:p.yellow,red:p.red})),
    players:players.filter(p=>p.minutes>0||p.goals>0||p.yellow||p.red),
    totals:{home:totals(h),away:totals(a)},
  }
}
async function apiFootballH2H(date:string,home:string,away:string,competition:string){
  const start=startFor(competition),before=targetDate(date)
  const key=[start,before,norm(home),norm(away)].join("|")
  const cached=apiCache.get(key)
  if(cached&&cached.expires>Date.now())return cached.value
  const ids=await resolveApiTeamIds(date,home,away)
  if(!ids.homeId||!ids.awayId)return []
  const rows=await apiFootball("/fixtures/headtohead",{h2h:ids.homeId+"-"+ids.awayId,last:"20"})
  if(!rows?.length)return []
  const basics=rows.filter((row:any)=>{
    const d=dateOnly(row?.fixture?.date)
    return d>=start&&d<before
  }).sort((a:any,b:any)=>dateOnly(b?.fixture?.date).localeCompare(dateOnly(a?.fixture?.date))).slice(0,12).map(basicApiMeeting)
  const detailed=await Promise.all(basics.slice(0,6).map(enrichApiMeeting))
  const value=[...detailed,...basics.slice(6)]
  apiCache.set(key,{expires:Date.now()+12*60*60*1000,value})
  return value
}

async function espn(slug:string,path:string){
  try{
    const r=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/"+path,{
      cache:"no-store",signal:AbortSignal.timeout(9000),headers:{accept:"application/json"},
    })
    if(!r.ok)return null
    return await r.json()
  }catch{return null}
}
async function resolveEspnTeamIds(specs:typeof DOMESTIC_ESPN,home:string,away:string){
  for(const spec of specs){
    const data=await espn(spec.slug,"teams?limit=500")
    const teams=(data?.sports?.[0]?.leagues?.[0]?.teams??[]).map((x:any)=>x?.team).filter(Boolean)
    const h=teams.find((t:any)=>same(t?.displayName??t?.name,home))
    const a=teams.find((t:any)=>same(t?.displayName??t?.name,away))
    if(h?.id&&a?.id)return {homeId:String(h.id),awayId:String(a.id)}
  }
  return {homeId:"",awayId:""}
}
function espnStat(row:any,name:string){
  const item=(row?.stats??[]).find((s:any)=>s?.name===name)
  return n(item?.value??item?.displayValue)
}
async function enrichEspnMeeting(meeting:Meeting,slug:string){
  if(!meeting.fixtureId)return meeting
  const summary=await espn(slug,"summary?event="+meeting.fixtureId)
  if(!summary)return meeting
  const players:any[]=[]
  for(const section of summary?.rosters??[]){
    const team=String(section?.team?.displayName??section?.team?.name??"")
    for(const row of section?.roster??[]){
      const player=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim()
      if(!player)continue
      const goals=espnStat(row,"totalGoals"),assists=espnStat(row,"goalAssists")
      const foulsCommitted=espnStat(row,"foulsCommitted"),foulsDrawn=espnStat(row,"foulsSuffered")
      const shots=espnStat(row,"totalShots"),shotsOnTarget=espnStat(row,"shotsOnTarget")
      const yellow=espnStat(row,"yellowCards")>0,red=espnStat(row,"redCards")>0
      const appeared=row?.starter===true||row?.subbedIn===true||goals>0||foulsCommitted>0||foulsDrawn>0||shots>0||yellow||red
      if(!appeared)continue
      players.push({player,team,minutes:row?.starter===true?90:0,goals,assists,foulsCommitted,foulsDrawn,shots,shotsOnTarget,yellow,red})
    }
  }
  const h=players.filter(p=>same(p.team,meeting.home)),a=players.filter(p=>same(p.team,meeting.away))
  const totals=(ps:any[])=>({yellow:ps.filter(p=>p.yellow).length,red:ps.filter(p=>p.red).length,fouls:ps.reduce((s,p)=>s+p.foulsCommitted,0),shots:ps.reduce((s,p)=>s+p.shots,0),sot:ps.reduce((s,p)=>s+p.shotsOnTarget,0)})
  return {
    ...meeting,
    scorers:players.filter(p=>p.goals>0).map(p=>({player:p.player,team:p.team,goals:p.goals,assists:p.assists})).sort((x,y)=>y.goals-x.goals),
    bookings:players.filter(p=>p.yellow||p.red).map(p=>({player:p.player,team:p.team,yellow:p.yellow,red:p.red})),
    players,totals:{home:totals(h),away:totals(a)},
  }
}

const espnCache=new Map<string,{expires:number,value:Meeting[]}>()
async function espnH2H(date:string,home:string,away:string,competition:string){
  const specs=DOMESTIC.has(competition)?DOMESTIC_ESPN:INTERNATIONAL_ESPN
  const start=startFor(competition),before=targetDate(date)
  const key=["espn",start,before,norm(home),norm(away)].join("|")
  const cached=espnCache.get(key)
  if(cached&&cached.expires>Date.now())return cached.value
  const ids=await resolveEspnTeamIds(specs as any,home,away)
  if(!ids.homeId||!ids.awayId)return []
  const found=new Map<string,{meeting:Meeting;slug:string}>()
  for(const spec of specs){
    for(const season of spec.seasons){
      const schedule=await espn(spec.slug,"teams/"+ids.homeId+"/schedule?season="+season)
      for(const event of schedule?.events??[]){
        const d=dateOnly(event?.date)
        if(!d||d<start||d>=before)continue
        const comp=event?.competitions?.[0]??{}
        const competitors=comp?.competitors??[]
        const h=competitors.find((x:any)=>x?.homeAway==="home")
        const a=competitors.find((x:any)=>x?.homeAway==="away")
        const hasAway=competitors.some((x:any)=>String(x?.team?.id??"")===ids.awayId||same(x?.team?.displayName,away))
        if(!hasAway)continue
        const id=String(event?.id??comp?.id??"")
        if(!id||found.has(id))continue
        found.set(id,{slug:spec.slug,meeting:{
          fixtureId:id,date:d,competition:spec.label,
          home:String(h?.team?.displayName??""),away:String(a?.team?.displayName??""),
          homeGoals:n(h?.score?.value??h?.score?.displayValue),awayGoals:n(a?.score?.value??a?.score?.displayValue),
          scorers:[],bookings:[],players:[],totals:{home:emptyTotals(),away:emptyTotals()},
        }})
      }
    }
  }
  const ordered=[...found.values()].sort((x,y)=>y.meeting.date.localeCompare(x.meeting.date)).slice(0,12)
  const detailed=await Promise.all(ordered.map(x=>enrichEspnMeeting(x.meeting,x.slug)))
  espnCache.set(key,{expires:Date.now()+12*60*60*1000,value:detailed})
  return detailed
}

function mergeMeetings(...sets:Meeting[][]){
  const map=new Map<string,Meeting>()
  for(const set of sets){
    for(const meeting of set){
      const key=[meeting.date,norm(meeting.home),norm(meeting.away)].join("|")
      const existing=map.get(key)
      if(!existing||meeting.players.length>existing.players.length||meeting.bookings.length>existing.bookings.length)map.set(key,meeting)
    }
  }
  return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12)
}

export async function GET(request:Request){
  const u=new URL(request.url)
  const date=u.searchParams.get("date")??"",home=u.searchParams.get("home")??"",away=u.searchParams.get("away")??"",competition=u.searchParams.get("competition")??""
  if(!date||!home||!away||!competition)return NextResponse.json({ok:false,error:"Missing fixture parameters"},{status:400})
  const start=startFor(competition),before=targetDate(date)
  let local:Meeting[]=[]
  let sourceParts:string[]=[]

  if(isDatabaseConfigured){
    try{
      const dbRows=await db.select().from(playerH2H).where(and(
        inArray(playerH2H.team,[home,away]),
        inArray(playerH2H.opponent,[home,away]),
        gte(playerH2H.matchDate,start),
        lt(playerH2H.matchDate,before),
      ))
      const rows:Row[]=dbRows.map((r:any)=>({
        playerName:String(r.playerName??""),team:String(r.team??""),opponent:String(r.opponent??""),matchDate:dateOnly(r.matchDate),
        competition:String(r.competition??""),venue:String(r.venue??""),minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),
        foulsCommitted:n(r.foulsCommitted),foulsDrawn:n(r.foulsDrawn),shots:n(r.shots),shotsOnTarget:n(r.shotsOnTarget),
        yellowCard:r.yellowCard===true,redCard:r.redCard===true,
      }))
      local=aggregate(rows,home,away,start,before)
      if(local.length)sourceParts.push("player-history database")
    }catch{}
  }

  if(!local.length&&DOMESTIC.has(competition)){
    try{
      const snap=await snapshotRowsForCompetition(competition,undefined,before)
      const rows:Row[]=snap.map((r:any)=>({
        playerName:String(r.player_name??""),team:String(r.team??""),opponent:String(r.opponent??""),matchDate:dateOnly(r.match_date),
        competition:String(r.competition??competition),venue:String(r.venue??""),minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),
        foulsCommitted:n(r.fouls_committed),foulsDrawn:n(r.fouls_drawn),shots:n(r.shots),shotsOnTarget:n(r.shots_on_target),
        yellowCard:r.yellow_card===true,redCard:r.red_card===true,
      }))
      local=aggregate(rows,home,away,start,before)
      if(local.length)sourceParts.push("season snapshot")
    }catch{}
  }

  const [api,espnRows]=await Promise.all([
    apiFootballH2H(date,home,away,competition),
    espnH2H(date,home,away,competition),
  ])
  if(api.length)sourceParts.push("API-Football")
  if(espnRows.length)sourceParts.push("ESPN")
  const meetings=mergeMeetings(local,api,espnRows)
  const scope=DOMESTIC.has(competition)
    ?"2025/26 + 2026/27 seasons, including league and domestic cup meetings"
    :"Recent international cycle: Euro 2024, 2024/25 and 2026/27 Nations League, 2026 World Cup qualifying, 2026 World Cup and relevant friendlies"

  return NextResponse.json({
    ok:true,home,away,competition,date,startDate:start,scope,
    source:sourceParts.length?[...new Set(sourceParts)].join(" + "):"No matching history source",
    meetings,count:meetings.length,
  })
}
