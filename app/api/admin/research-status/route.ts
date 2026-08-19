import { NextResponse } from "next/server"
import { and, eq, sql } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, competitions: null })
  }

  await ensureResearchSchema()

  const count = sql<number>`count(*)::int`
  const [[plB], [chB], [plH], [chH], [plR], [chR], [plP], [chP]] = await Promise.all([
    db.select({ n: count }).from(playerBaselines).where(eq(playerBaselines.competition, "Premier League")),
    db.select({ n: count }).from(playerBaselines).where(eq(playerBaselines.competition, "Championship")),
    db.select({ n: count }).from(playerH2H).where(eq(playerH2H.competition, "Premier League")),
    db.select({ n: count }).from(playerH2H).where(eq(playerH2H.competition, "Championship")),
    db.select({ n: count }).from(referees).where(and(eq(referees.competition, "Premier League"), eq(referees.season, "2025/26"))),
    db.select({ n: count }).from(referees).where(and(eq(referees.competition, "Championship"), eq(referees.season, "2025/26"))),
    db.select({ n: count }).from(playerRefereeHistory).where(and(eq(playerRefereeHistory.competition, "Premier League"), eq(playerRefereeHistory.season, "2025/26"))),
    db.select({ n: count }).from(playerRefereeHistory).where(and(eq(playerRefereeHistory.competition, "Championship"), eq(playerRefereeHistory.season, "2025/26"))),
  ])

  return NextResponse.json({
    connected: true,
    competitions: {
      "Premier League": {
        player_baselines: plB?.n ?? 0,
        h2h: plH?.n ?? 0,
        referees: plR?.n ?? 0,
        player_referee_history: plP?.n ?? 0,
      },
      Championship: {
        player_baselines: chB?.n ?? 0,
        h2h: chH?.n ?? 0,
        referees: chR?.n ?? 0,
        player_referee_history: chP?.n ?? 0,
      },
    },
  })
}
