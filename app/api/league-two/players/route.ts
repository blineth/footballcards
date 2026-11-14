import { NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, players: [], error: "Database not connected" }, { status: 503 })
  }

  await ensureResearchSchema()
  const [rows, previousRows] = await Promise.all([
    db.select().from(playerBaselines)
      .where(and(eq(playerBaselines.competition, "League Two"), eq(playerBaselines.season, "2026/27")))
      .orderBy(desc(playerBaselines.minutes)),
    db.select().from(playerBaselines).where(eq(playerBaselines.season, "2025/26")).orderBy(desc(playerBaselines.minutes)),
  ])
  const norm = (v:string) => String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
  const previousFor = (r:(typeof rows)[number]) => {
    let matches = r.externalPlayerId ? previousRows.filter(p=>p.externalPlayerId===r.externalPlayerId) : []
    if(!matches.length){
      const name=norm(r.playerName)
      matches=previousRows.filter(p=>norm(p.playerName)===name)
    }
    if(!matches.length)return null
    const sum=(key:keyof (typeof matches)[number])=>matches.reduce((s,p)=>s+Number(p[key]??0),0)
    const minutes=sum("minutes"),yc=sum("yellowCards"),fouls=sum("foulsCommitted"),shots=sum("shots"),sot=sum("shotsOnTarget")
    return {
      season:"2025/26",
      clubs:Array.from(new Set(matches.map(p=>p.team).filter(Boolean))),
      competitions:Array.from(new Set(matches.map(p=>p.competition).filter(Boolean))),
      appearances:sum("appearances"),starts:sum("starts"),minutes,
      goals:sum("goals"),assists:sum("assists"),yellowCards:yc,redCards:sum("redCards"),
      foulsCommitted:fouls,foulsDrawn:sum("foulsDrawn"),shots,shotsOnTarget:sot,
      fouls90:minutes?Math.round((fouls*90/minutes)*100)/100:null,
      cards90:minutes?Math.round((yc*90/minutes)*100)/100:null,
      shots90:minutes?Math.round((shots*90/minutes)*100)/100:null,
      shotsOnTarget90:minutes?Math.round((sot*90/minutes)*100)/100:null,
    }
  }

  const players = rows.map((r) => {
    const minutes = Number(r.minutes ?? 0)
    const per90 = (value: number) => minutes > 0 ? Math.round(((value * 90) / minutes) * 100) / 100 : null
    return {
      name: r.playerName,
      team: r.team,
      position: r.position,
      appearances: Number(r.appearances ?? 0),
      starts: Number(r.starts ?? 0),
      minutes,
      goals: Number(r.goals ?? 0),
      assists: Number(r.assists ?? 0),
      yellowCards: Number(r.yellowCards ?? 0),
      redCards: Number(r.redCards ?? 0),
      foulsCommitted: Number(r.foulsCommitted ?? 0),
      foulsDrawn: Number(r.foulsDrawn ?? 0),
      shots: Number(r.shots ?? 0),
      shotsOnTarget: Number(r.shotsOnTarget ?? 0),
      goals90: per90(Number(r.goals ?? 0)),
      assists90: per90(Number(r.assists ?? 0)),
      fouls90: r.foulsPer90 == null ? per90(Number(r.foulsCommitted ?? 0)) : Number(r.foulsPer90),
      fouled90: per90(Number(r.foulsDrawn ?? 0)),
      cards90: r.cardsPer90 == null ? per90(Number(r.yellowCards ?? 0)) : Number(r.cardsPer90),
      shots90: r.shotsPer90 == null ? per90(Number(r.shots ?? 0)) : Number(r.shotsPer90),
      shotsOnTarget90: r.shotsOnTargetPer90 == null ? per90(Number(r.shotsOnTarget ?? 0)) : Number(r.shotsOnTargetPer90),
      externalPlayerId: r.externalPlayerId,
      previousSeason: previousFor(r),
    }
  })

  return NextResponse.json({
    connected: true,
    competition: "League Two",
    season: "2026/27",
    source: "FBref 2026/27 League Two Standard + Shooting + Misc player tables",
    crossCheck: {
      fbrefStandard: "https://fbref.com/en/comps/16/stats/League Two-Stats",
      fbrefShooting: "https://fbref.com/en/comps/16/shooting/League Two-Stats",
      fbrefMisc: "https://fbref.com/en/comps/16/misc/League Two-Stats",
    },
    players,
    playerCount: players.length,
    loadedAt: new Date().toISOString(),
  })
}
