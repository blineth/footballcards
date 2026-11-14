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

  const meetings=aggregate(rows,home,away)
  return NextResponse.json({ok:true,home,away,competition,date,source,meetings,count:meetings.length})
}
