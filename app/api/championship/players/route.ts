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
  const rows = await db
    .select()
    .from(playerBaselines)
    .where(and(eq(playerBaselines.competition, "Championship"), eq(playerBaselines.season, "2026/27")))
    .orderBy(desc(playerBaselines.minutes))

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
    }
  })

  return NextResponse.json({
    connected: true,
    competition: "Championship",
    season: "2026/27",
    source: "API-Football live player aggregates; FBref standard/shooting/misc used as cross-check",
    crossCheck: {
      fbrefStandard: "https://fbref.com/en/comps/10/stats/Championship-Stats",
      fbrefShooting: "https://fbref.com/en/comps/10/shooting/Championship-Stats",
      fbrefMisc: "https://fbref.com/en/comps/10/misc/Championship-Stats",
    },
    players,
    playerCount: players.length,
    loadedAt: new Date().toISOString(),
  })
}
