import { NextResponse } from "next/server"
import { and, eq, gte } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1"
const SEASON_START = "2026-08-21"

function n(value: unknown) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}
function stat(row: any, name: string) {
  const found = (row?.stats ?? []).find((s: any) => s?.name === name)
  return n(found?.value ?? found?.displayValue)
}
async function espn(path: string) {
  const response = await fetch(`${ESPN_BASE}/${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`ESPN ${response.status} for ${path}`)
  return response.json()
}
function monthsFromStart() {
  const now = new Date()
  const result: string[] = []
  let year = 2026, month = 8
  const endYear = now.getUTCFullYear(), endMonth = now.getUTCMonth() + 1
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push(`${year}${String(month).padStart(2, "0")}`)
    month++
    if (month > 12) { month = 1; year++ }
  }
  return result
}
function minuteFromClock(event: any) {
  const seconds = Number(event?.clock?.value ?? NaN)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(90, Math.floor(seconds / 60)))
  const text = String(event?.clock?.displayValue ?? "")
  const match = text.match(/(\d+)/)
  return match ? Math.max(0, Math.min(90, Number(match[1]))) : null
}
function minuteMap(summary: any) {
  const minutes = new Map<string, number>()
  for (const section of summary?.rosters ?? []) {
    for (const row of section?.roster ?? []) {
      const id = String(row?.athlete?.id ?? "")
      if (!id) continue
      minutes.set(id, row?.starter === true ? 90 : 0)
    }
  }
  for (const event of summary?.keyEvents ?? []) {
    if (String(event?.type?.type ?? event?.type?.text ?? "").toLowerCase().replaceAll(" ", "-") !== "substitution") continue
    const minute = minuteFromClock(event)
    if (minute == null) continue
    const participants = event?.participants ?? []
    const incoming = String(participants?.[0]?.athlete?.id ?? "")
    const outgoing = String(participants?.[1]?.athlete?.id ?? "")
    if (outgoing) minutes.set(outgoing, minute)
    if (incoming) minutes.set(incoming, Math.max(0, 90 - minute))
  }
  for (const event of summary?.keyEvents ?? []) {
    const type = String(event?.type?.type ?? event?.type?.text ?? "").toLowerCase()
    if (!type.includes("red")) continue
    const minute = minuteFromClock(event)
    const id = String(event?.participants?.[0]?.athlete?.id ?? "")
    if (id && minute != null) minutes.set(id, Math.min(minutes.get(id) ?? 90, minute))
  }
  return minutes
}

async function completedEvents() {
  const byId = new Map<string, any>()
  for (const month of monthsFromStart()) {
    const data = await espn(`scoreboard?dates=${month}&limit=200`)
    for (const event of data?.events ?? []) {
      const id = String(event?.id ?? "")
      const date = String(event?.date ?? "").slice(0, 10)
      const completed = event?.status?.type?.completed === true || String(event?.status?.type?.state ?? "") === "post"
      if (!id || !completed || date < SEASON_START || date > new Date().toISOString().slice(0, 10)) continue
      byId.set(id, event)
    }
  }
  return [...byId.values()].sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")))
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected" }, { status: 503 })
  await ensureResearchSchema()

  const url = new URL(request.url)
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0)
  const limit = Math.max(1, Math.min(15, Number(url.searchParams.get("limit") ?? "10") || 10))

  try {
    const all = await completedEvents()
    if (offset === 0) {
      await db.delete(playerH2H).where(and(eq(playerH2H.competition, "Premier League"), gte(playerH2H.matchDate, SEASON_START)))
    }
    const selected = all.slice(offset, offset + limit)
    const results = await Promise.all(selected.map(async (event: any) => {
      const id = String(event?.id ?? "")
      const summary = await espn(`summary?event=${id}`)
      const headerComp = summary?.header?.competitions?.[0] ?? event?.competitions?.[0] ?? {}
      const competitors = headerComp?.competitors ?? []
      const homeRow = competitors.find((c: any) => c?.homeAway === "home")
      const awayRow = competitors.find((c: any) => c?.homeAway === "away")
      const home = String(homeRow?.team?.displayName ?? homeRow?.team?.name ?? "")
      const away = String(awayRow?.team?.displayName ?? awayRow?.team?.name ?? "")
      const date = String(event?.date ?? headerComp?.date ?? "").slice(0, 10)
      const minutes = minuteMap(summary)
      const rows: Array<typeof playerH2H.$inferInsert> = []

      for (const section of summary?.rosters ?? []) {
        const team = String(section?.team?.displayName ?? section?.team?.name ?? "")
        const opponent = team === home ? away : home
        for (const playerRow of section?.roster ?? []) {
          const name = String(playerRow?.athlete?.displayName ?? playerRow?.athlete?.fullName ?? "").trim()
          const playerId = String(playerRow?.athlete?.id ?? "")
          if (!name || !team || !opponent || !date) continue
          rows.push({
            playerName: name,
            team,
            opponent,
            matchDate: date,
            competition: "Premier League",
            venue: team === home ? "Home" : "Away",
            position: playerRow?.position?.abbreviation ?? playerRow?.position?.displayName ?? playerRow?.athlete?.position?.abbreviation ?? playerRow?.athlete?.position?.displayName ?? null,
            starter: playerRow?.starter === true,
            minutes: minutes.get(playerId) ?? (playerRow?.starter === true ? 90 : 0),
            foulsCommitted: stat(playerRow, "foulsCommitted"),
            foulsDrawn: stat(playerRow, "foulsSuffered"),
            shots: stat(playerRow, "totalShots"),
            shotsOnTarget: stat(playerRow, "shotsOnTarget"),
            yellowCard: stat(playerRow, "yellowCards") > 0,
            redCard: stat(playerRow, "redCards") > 0,
            goals: stat(playerRow, "totalGoals"),
            assists: stat(playerRow, "goalAssists"),
            externalPlayerId: playerId || null,
          })
        }
      }
      return { id, date, home, away, rows }
    }))

    let rowCount = 0
    for (const match of results) {
      for (let i = 0; i < match.rows.length; i += 250) {
        const rows = match.rows.slice(i, i + 250)
        if (!rows.length) continue
        rowCount += rows.length
        await db.insert(playerH2H).values(rows).onConflictDoNothing()
      }
    }

    const nextOffset = offset + selected.length
    return NextResponse.json({
      ok: true,
      competition: "Premier League",
      season: "2026/27",
      source: "ESPN match summaries",
      totalFixtures: all.length,
      offset,
      processedFixtures: selected.length,
      playerMatchRowsSeen: rowCount,
      matches: results.map((x) => ({ id: x.id, date: x.date, home: x.home, away: x.away, players: x.rows.length })),
      nextOffset,
      done: nextOffset >= all.length,
      refreshedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ESPN Premier League sync failed" }, { status: 502 })
  }
}
