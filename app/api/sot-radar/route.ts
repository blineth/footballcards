import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const SOFA = "https://www.sofascore.com/api/v1"

function norm(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(afc|fc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function parseJsonText(text:string){
  try{return JSON.parse(text)}catch{}
  const start=text.indexOf("{"),end=text.lastIndexOf("}")
  if(start>=0&&end>start){try{return JSON.parse(text.slice(start,end+1))}catch{}}
  return null
}
async function sofa(path: string) {
  const primary=`https://www.sofascore.com/api/v1${path}`
  const urls=[
    primary,
    `https://api.sofascore.com/api/v1${path}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(primary)}`,
    `https://r.jina.ai/${primary}`,
  ]
  const errors:string[]=[]
  for(const url of urls){
    try{
      const r=await fetch(url,{
        cache:"no-store",
        signal:AbortSignal.timeout(10000),
        headers:{accept:"application/json,text/plain,*/*","user-agent":"Mozilla/5.0 footballcards/1.0"},
      })
      const text=await r.text()
      const parsed=r.ok?parseJsonText(text):null
      if(parsed)return parsed
      errors.push(`${r.status} ${url.slice(0,60)}`)
    }catch(e){errors.push(e instanceof Error?e.message:"fetch error")}
  }
  throw new Error(`SofaScore providers failed: ${errors.join(" | ")}`)
}
function dateOnly(ts: number | null | undefined) {
  return ts ? new Date(ts * 1000).toISOString().slice(0,10) : ""
}
function sotFromStats(stats: any) {
  const candidates = [
    stats?.onTargetScoringAttempt,
    stats?.shotsOnTarget,
    stats?.shotOnTarget,
    stats?.onTargetAttempts,
  ]
  for (const v of candidates) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}
function minutesFromStats(stats: any) {
  const vals = [stats?.minutesPlayed, stats?.minutes, stats?.timePlayed]
  for (const v of vals) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}
async function findFixture(date: string, home: string, away: string) {
  const data = await sofa(`/sport/football/scheduled-events/${date}`)
  return (data?.events ?? []).find((e:any) => teamMatch(e?.homeTeam?.name, home) && teamMatch(e?.awayTeam?.name, away)) ?? null
}
async function recentFinished(teamId: number, beforeDate: string) {
  const collected:any[] = []
  for (let page=0; page<3 && collected.length<5; page++) {
    let data:any
    try { data = await sofa(`/team/${teamId}/events/last/${page}`) } catch { break }
    for (const e of data?.events ?? []) {
      const d = dateOnly(e?.startTimestamp)
      const type = String(e?.status?.type ?? "").toLowerCase()
      if (!d || d >= beforeDate) continue
      if (!(type.includes("finished") || type.includes("after"))) continue
      if (!collected.some(x=>x.id===e.id)) collected.push(e)
      if (collected.length>=5) break
    }
  }
  return collected.slice(0,5)
}
async function teamSot(team:any, beforeDate:string) {
  const events = await recentFinished(Number(team.id), beforeDate)
  const players = new Map<string, {
    name:string; team:string; games:number; minutes:number; sot:number; onePlus:number; twoPlus:number;
    matches:Array<{date:string;opponent:string;sot:number;minutes:number}>
  }>()

  await Promise.all(events.map(async (e:any) => {
    let lineups:any
    try { lineups = await sofa(`/event/${e.id}/lineups`) } catch { return }
    const isHome = Number(e?.homeTeam?.id) === Number(team.id)
    const rows = ((lineups?.[isHome ? "home" : "away"]?.players) ?? [])
    const opponent = isHome ? e?.awayTeam?.name : e?.homeTeam?.name
    const d = dateOnly(e?.startTimestamp)

    for (const row of rows) {
      const p = row?.player
      if (!p?.name) continue
      const stats = row?.statistics ?? {}
      const minutes = minutesFromStats(stats)
      if (minutes <= 0) continue
      const sot = sotFromStats(stats)
      const key = norm(p.name)
      const current = players.get(key) ?? {
        name:String(p.name), team:String(team.name), games:0, minutes:0, sot:0, onePlus:0, twoPlus:0, matches:[]
      }
      current.games += 1
      current.minutes += minutes
      current.sot += sot
      if (sot >= 1) current.onePlus += 1
      if (sot >= 2) current.twoPlus += 1
      current.matches.push({date:d, opponent:String(opponent??""), sot, minutes})
      players.set(key,current)
    }
  }))

  return [...players.values()].map(p => ({
    ...p,
    sot90: p.minutes ? p.sot / p.minutes * 90 : 0,
    onePlusRate: p.games ? p.onePlus / p.games : 0,
    twoPlusRate: p.games ? p.twoPlus / p.games : 0,
    score: Math.round((
      Math.min(1, (p.minutes ? p.sot / p.minutes * 90 : 0) / 1.2) * 45 +
      (p.games ? p.onePlus / p.games : 0) * 30 +
      (p.games ? p.twoPlus / p.games : 0) * 25
    ) * 10) / 10,
  }))
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  if (!date || !home || !away) return NextResponse.json({ players: [], error:"Invalid fixture parameters" }, { status:400 })

  try {
    const event = await findFixture(date, home, away)
    if (!event?.homeTeam?.id || !event?.awayTeam?.id) {
      return NextResponse.json({ connected:true, source:"SofaScore", players:[], note:"Fixture not found in SofaScore schedule." })
    }
    const [homeRows, awayRows] = await Promise.all([
      teamSot(event.homeTeam, date),
      teamSot(event.awayTeam, date),
    ])
    const players = [...homeRows, ...awayRows]
      .filter(p => p.games >= 2)
      .sort((a,b) => b.score-a.score || b.sot90-a.sot90 || b.sot-a.sot)
      .slice(0,20)
    return NextResponse.json({
      connected:true,
      source:"SofaScore recent player match stats",
      fixtureId:String(event.id),
      updatedAt:new Date().toISOString(),
      players,
    })
  } catch (error) {
    console.log("[sot-radar]", error instanceof Error ? error.message : error)
    return NextResponse.json({ connected:false, source:"SofaScore", players:[], error:"SOT research feed unavailable." }, { status:502 })
  }
}
