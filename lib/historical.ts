import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { and, desc, eq, sql } from "drizzle-orm"

function normName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function refereeNameMatch(a: string | null | undefined, b: string | null | undefined) {
  const aa = normName(a).split(" ").filter(Boolean)
  const bb = normName(b).split(" ").filter(Boolean)
  if (!aa.length || !bb.length) return false
  if (aa.join(" ") === bb.join(" ")) return true
  if (aa.at(-1) !== bb.at(-1)) return false
  const af = aa[0]
  const bf = bb[0]
  return Boolean(af && bf && (af === bf || af[0] === bf[0]))
}

export async function hasAnyHistoricalData(): Promise<boolean> {
  if (!isDatabaseConfigured) return false
  await ensureResearchSchema()
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(playerBaselines)
  return (row?.n ?? 0) > 0
}

export async function getPlayerBaseline(playerName: string, team?: string) {
  if (!isDatabaseConfigured) return null
  await ensureResearchSchema()
  const where = team
    ? and(eq(playerBaselines.playerName, playerName), eq(playerBaselines.team, team))
    : eq(playerBaselines.playerName, playerName)
  const rows = await db.select().from(playerBaselines).where(where).orderBy(desc(playerBaselines.season))
  return rows[0] ?? null
}

export async function getPlayerH2H(playerName: string, opponent: string) {
  if (!isDatabaseConfigured) return []
  await ensureResearchSchema()
  return db
    .select()
    .from(playerH2H)
    .where(and(eq(playerH2H.playerName, playerName), eq(playerH2H.opponent, opponent)))
    .orderBy(desc(playerH2H.matchDate))
}

export async function getRefereeByName(name: string) {
  if (!isDatabaseConfigured) return null
  await ensureResearchSchema()
  const exact = await db.select().from(referees).where(eq(referees.refereeName, name)).orderBy(desc(referees.season))
  if (exact[0]) return exact[0]
  const rows = await db.select().from(referees).orderBy(desc(referees.season))
  return rows.find((row) => refereeNameMatch(row.refereeName, name)) ?? null
}

export async function getPlayerRefereeHistory(refereeName: string, playerName: string) {
  if (!isDatabaseConfigured) return null
  await ensureResearchSchema()
  const exact = await db
    .select()
    .from(playerRefereeHistory)
    .where(and(eq(playerRefereeHistory.refereeName, refereeName), eq(playerRefereeHistory.playerName, playerName)))
    .orderBy(desc(playerRefereeHistory.season))
  if (exact[0]) return exact[0]

  const rows = await db
    .select()
    .from(playerRefereeHistory)
    .where(eq(playerRefereeHistory.playerName, playerName))
    .orderBy(desc(playerRefereeHistory.season))
  return rows.find((row) => refereeNameMatch(row.refereeName, refereeName)) ?? null
}
