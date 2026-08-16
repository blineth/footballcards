import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { and, desc, eq, sql } from "drizzle-orm"

/**
 * Data-access helpers for the historical research library. These NEVER
 * fabricate data: when nothing has been imported they return empty/null so the
 * UI can show "Not enough historical data" instead of zeros.
 */

export async function hasAnyHistoricalData(): Promise<boolean> {
  if (!isDatabaseConfigured) return false
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(playerBaselines)
  return (row?.n ?? 0) > 0
}

export async function getPlayerBaseline(playerName: string, team?: string) {
  if (!isDatabaseConfigured) return null
  const where = team
    ? and(eq(playerBaselines.playerName, playerName), eq(playerBaselines.team, team))
    : eq(playerBaselines.playerName, playerName)
  const rows = await db
    .select()
    .from(playerBaselines)
    .where(where)
    .orderBy(desc(playerBaselines.season))
  return rows[0] ?? null
}

export async function getPlayerH2H(playerName: string, opponent: string) {
  if (!isDatabaseConfigured) return []
  return db
    .select()
    .from(playerH2H)
    .where(and(eq(playerH2H.playerName, playerName), eq(playerH2H.opponent, opponent)))
    .orderBy(desc(playerH2H.matchDate))
}

export async function getRefereeByName(name: string) {
  if (!isDatabaseConfigured) return null
  const rows = await db
    .select()
    .from(referees)
    .where(eq(referees.refereeName, name))
    .orderBy(desc(referees.season))
  return rows[0] ?? null
}

export async function getPlayerRefereeHistory(refereeName: string, playerName: string) {
  if (!isDatabaseConfigured) return null
  const rows = await db
    .select()
    .from(playerRefereeHistory)
    .where(
      and(
        eq(playerRefereeHistory.refereeName, refereeName),
        eq(playerRefereeHistory.playerName, playerName),
      ),
    )
  return rows[0] ?? null
}
