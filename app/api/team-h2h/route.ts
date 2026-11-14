import { NextResponse } from "next/server"
import { and, eq, inArray, lt } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { playerH2H } from "@/lib/db/schema"
import { snapshotRowsForCompetition } from "@/lib/current-season-snapshot"

export const dynamic="force-dynamic"
export const revalidate=0

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

const apiH2HCache=new Map<string,{expires:number;meetings:any[]}>()
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
async function resolveTeamIds(date:string,home:string,away:string){
  const fixtures=await apiFootball("/fixtures",{date,timezone:"Europe/London"})??[]
  const hit=fixtures.find((f:any)=>same(f?.teams?.home?.name,home)&&same(f?.teams?.away?.name,away))
  if(hit?.teams?.home?.id&&hit?.teams?.away?.id){
    return {homeId:String(hit.teams.home.id),awayId:String(hit.teams.away.id)}
  }
  const [homeRows,awayRows]=await Promise.all([
    apiFootball("/teams",{search:home}),
    apiFootball("/teams",{search:away}),
  ])
  const pick=(rows:any[]|null,name:string)=>{
    const exact=(rows??[]).find((x:any)=>norm(x?.team?.name)===norm(name))
    const fuzzy=exact??(rows??[]).find((x:any)=>same(x?.team?.name,name))
    return fuzzy?.team?.id?String(fuzzy.team.id):""
  }
  return {homeId:pick(homeRows,home),awayId:pick(awayRows,away)}
}
function basicApiMeeting(row:any){
  const actualHome=String(row?.teams?.home?.name??"")
  const actualAway=String(row?.teams?.away?.name??"")
  return {
    fixtureId:String(row?.fixture?.id??""),
    date:dateOnly(row?.fixture?.date),
    home:actualHome,
    away:actualAway,
    homeGoals:n(row?.goals?.home),
    awayGoals:n(row?.goals?.away),
    scorers:[] as any[],
    bookings:[] as any[],
    players:[] as any[],
    totals:{
      home:{yellow:0,red:0,fouls:0,shots:0,sot:0},
      away:{yellow:0,red:0,fouls:0,shots:0,sot:0},
    },
  }
}
async function enrichApiMeeting(meeting:any){
  if(!meeting.fixtureId)return meeting
  const teams=await apiFootball("/fixtures/players",{fixture:meeting.fixtureId})
  if(!teams?.length)return meeting
  const players:any[]=[]
  for(const teamBlock of teams){
    const teamName=String(teamBlock?.team?.name??"")
    for(const p of teamBlock?.players??[]){
      const s=Array.isArray(p?.statistics)?p.statistics[0]??{}:{}
      players.push({
        player:String(p?.player?.name??"Unknown"),
        team:teamName,
        minutes:n(s?.games?.minutes),
        goals:n(s?.goals?.total),
        assists:n(s?.goals?.assists),
        foulsCommitted:n(s?.fouls?.committed),
        foulsDrawn:n(s?.fouls?.drawn),
        shots:n(s?.shots?.total),
        shotsOnTarget:n(s?.shots?.on),
        yellow:n(s?.cards?.yellow)>0,
        red:n(s?.cards?.red)>0,
      })
    }
  }
  const homePlayers=players.filter(p=>same(p.team,meeting.home))
  const awayPlayers=players.filter(p=>same(p.team,meeting.away))
  return {
    ...meeting,
    scorers:players.filter(p=>p.goals>0).map(p=>({player:p.player,team:p.team,goals:p.goals,assists:p.assists})).sort((a,b)=>b.goals-a.goals||a.player.localeCompare(b.player)),
    bookings:players.filter(p=>p.yellow||p.red).map(p=>({player:p.player,team:p.team,yellow:p.yellow,red:p.red})),
    players:players.filter(p=>p.minutes>0||p.goals>0||p.yellow||p.red),
    totals:{
      home:{yellow:homePlayers.filter(p=>p.yellow).length,red:homePlayers.filter(p=>p.red).length,fouls:homePlayers.reduce((s,p)=>s+p.foulsCommitted,0),shots:homePlayers.reduce((s,p)=>s+p.shots,0),sot:homePlayers.reduce((s,p)=>s+p.shotsOnTarget,0)},
      away:{yellow:awayPlayers.filter(p=>p.yellow).length,red:awayPlayers.filter(p=>p.red).length,fouls:awayPlayers.reduce((s,p)=>s+p.foulsCommitted,0),shots:awayPlayers.reduce((s,p)=>s+p.shots,0),sot:awayPlayers.reduce((s,p)=>s+p.shotsOnTarget,0)},
    },
  }
}
async function apiFootballH2H(date:string,home:string,away:string){
  const cacheKey=[date,norm(home),norm(away)].join("|")
  const cached=apiH2HCache.get(cacheKey)
  if(cached&&cached.expires>Date.now())return cached.meetings
  const ids=await resolveTeamIds(date,home,away)
  if(!ids.homeId||!ids.awayId)return []
  const rows=await apiFootball("/fixtures/headtohead",{h2h:ids.homeId+"-"+ids.awayId,last:"8"})
  if(!rows?.length)return []
  const basics=rows
    .filter((row:any)=>dateOnly(row?.fixture?.date)<date)
    .sort((a:any,b:any)=>dateOnly(b?.fixture?.date).localeCompare(dateOnly(a?.fixture?.date)))
    .slice(0,8)
    .map(basicApiMeeting)
  const detailed=await Promise.all(basics.slice(0,3).map(enrichApiMeeting))
  const meetings=[...detailed,...basics.slice(3)]
  apiH2HCache.set(cacheKey,{expires:Date.now()+12*60*60*1000,meetings})
  return meetings
}

type Row={
  playerName:string
  team:string
  opponent:string
  matchDate:string
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

function aggregate(rows:Row[],home:string,away:string){
  const byDate=new Map<string,Row[]>()
  for(const row of rows){
    if(!(same(row.team,home)&&same(row.opponent,away))&&!(same(row.team,away)&&same(row.opponent,home)))continue
    const d=dateOnly(row.matchDate);if(!d)continue
    const list=byDate.get(d)??[];list.push(row);byDate.set(d,list)
  }
  return [...byDate.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8).map(([date,matchRows])=>{
    const homeRows=matchRows.filter(r=>same(r.team,home))
    const awayRows=matchRows.filter(r=>same(r.team,away))
    const homeGoals=homeRows.reduce((s,r)=>s+n(r.goals),0)
    const awayGoals=awayRows.reduce((s,r)=>s+n(r.goals),0)
    const scorers=matchRows.filter(r=>n(r.goals)>0).map(r=>({player:r.playerName,team:r.team,goals:n(r.goals),assists:n(r.assists)}))
      .sort((a,b)=>b.goals-a.goals||a.player.localeCompare(b.player))
    const bookings=matchRows.filter(r=>r.yellowCard||r.redCard).map(r=>({player:r.playerName,team:r.team,yellow:r.yellowCard,red:r.redCard}))
    const players=matchRows.filter(r=>n(r.minutes)>0).map(r=>({
      player:r.playerName,team:r.team,minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),
      foulsCommitted:n(r.foulsCommitted),foulsDrawn:n(r.foulsDrawn),shots:n(r.shots),shotsOnTarget:n(r.shotsOnTarget),
      yellow:r.yellowCard,red:r.redCard,
    })).sort((a,b)=>b.goals-a.goals||Number(b.yellow)-Number(a.yellow)||b.foulsCommitted-a.foulsCommitted||b.shots-a.shots)
    return {
      date,home,away,homeGoals,awayGoals,scorers,bookings,players,
      totals:{
        home:{yellow:homeRows.filter(r=>r.yellowCard).length,red:homeRows.filter(r=>r.redCard).length,fouls:homeRows.reduce((s,r)=>s+n(r.foulsCommitted),0),shots:homeRows.reduce((s,r)=>s+n(r.shots),0),sot:homeRows.reduce((s,r)=>s+n(r.shotsOnTarget),0)},
        away:{yellow:awayRows.filter(r=>r.yellowCard).length,red:awayRows.filter(r=>r.redCard).length,fouls:awayRows.reduce((s,r)=>s+n(r.foulsCommitted),0),shots:awayRows.reduce((s,r)=>s+n(r.shots),0),sot:awayRows.reduce((s,r)=>s+n(r.shotsOnTarget),0)},
      },
    }
  })
}

export async function GET(request:Request){
  const u=new URL(request.url)
  const date=u.searchParams.get("date")??"",home=u.searchParams.get("home")??"",away=u.searchParams.get("away")??"",competition=u.searchParams.get("competition")??""
  if(!date||!home||!away||!competition)return NextResponse.json({ok:false,error:"Missing fixture parameters"},{status:400})

  let rows:Row[]=[]
  let source="snapshot"
  if(isDatabaseConfigured){
    try{
      const dbRows=await db.select().from(playerH2H).where(and(
        eq(playerH2H.competition,competition),
        inArray(playerH2H.team,[home,away]),
        inArray(playerH2H.opponent,[home,away]),
        lt(playerH2H.matchDate,date),
      ))
      rows=dbRows.map((r:any)=>({
        playerName:String(r.playerName??""),team:String(r.team??""),opponent:String(r.opponent??""),matchDate:dateOnly(r.matchDate),venue:String(r.venue??""),
        minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),foulsCommitted:n(r.foulsCommitted),foulsDrawn:n(r.foulsDrawn),
        shots:n(r.shots),shotsOnTarget:n(r.shotsOnTarget),yellowCard:r.yellowCard===true,redCard:r.redCard===true,
      }))
      source="player-history database"
    }catch{}
  }

  if(!rows.length){
    try{
      const snap=await snapshotRowsForCompetition(competition,undefined,date)
      rows=snap.filter((r:any)=>
        (same(r.team,home)&&same(r.opponent,away))||(same(r.team,away)&&same(r.opponent,home))
      ).map((r:any)=>({
        playerName:String(r.player_name??""),team:String(r.team??""),opponent:String(r.opponent??""),matchDate:dateOnly(r.match_date),venue:String(r.venue??""),
        minutes:n(r.minutes),goals:n(r.goals),assists:n(r.assists),foulsCommitted:n(r.fouls_committed),foulsDrawn:n(r.fouls_drawn),
        shots:n(r.shots),shotsOnTarget:n(r.shots_on_target),yellowCard:r.yellow_card===true,redCard:r.red_card===true,
      }))
      source="current-season snapshot"
    }catch{}
  }

  let meetings=aggregate(rows,home,away)
  if(!meetings.length){
    const apiMeetings=await apiFootballH2H(date,home,away)
    if(apiMeetings.length){
      meetings=apiMeetings
      source="API-Football H2H"
    }
  }
  return NextResponse.json({ok:true,home,away,competition,date,source,meetings,count:meetings.length})
}
