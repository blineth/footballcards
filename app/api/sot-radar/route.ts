import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"
import { and, eq, gte, lt } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"

  if (!date || !home || !away) {
    return NextResponse.json({ connected: false, players: [], error: "Invalid fixture parameters" }, { status: 400 })
  }
  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, players: [], error: "Database not connected" }, { status: 503 })
  }

  await ensureResearchSchema()

  const rows = await db
    .select()
    .from(playerH2H)
    .where(and(
      eq(playerH2H.competition, competition),
      gte(playerH2H.matchDate, "2026-08-01"),
      lt(playerH2H.matchDate, date),
    ))

  const relevant = rows.filter((r) => teamMatch(r.team, home) || teamMatch(r.team, away))
  const grouped = new Map<string, typeof relevant>()

  for (const row of relevant) {
    const key = `${norm(row.playerName)}|${norm(row.team)}`
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }

  const players = [...grouped.values()].map((all) => {
    const ordered = [...all].sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate)))
    const recent = ordered.slice(0, 5)
    const minutes = recent.reduce((s, r) => s + Number(r.minutes ?? 0), 0)
    const sot = recent.reduce((s, r) => s + Number(r.shotsOnTarget ?? 0), 0)
    const shots = recent.reduce((s, r) => s + Number(r.shots ?? 0), 0)
    const onePlus = recent.filter((r) => Number(r.shotsOnTarget ?? 0) >= 1).length
    const twoPlus = recent.filter((r) => Number(r.shotsOnTarget ?? 0) >= 2).length
    const games = recent.length
    const sot90 = minutes ? (sot / minutes) * 90 : 0
    const onePlusRate = games ? onePlus / games : 0
    const twoPlusRate = games ? twoPlus / games : 0
    const score = Math.round((
      Math.min(1, sot90 / 1.2) * 45 +
      onePlusRate * 35 +
      twoPlusRate * 20
    ) * 10) / 10

    return {
      name: recent[0]?.playerName ?? all[0]?.playerName ?? "",
      team: recent[0]?.team ?? all[0]?.team ?? "",
      games,
      minutes,
      shots,
      sot,
      onePlus,
      twoPlus,
      sot90,
      onePlusRate,
      twoPlusRate,
      score,
      matches: recent.map((r) => ({
        date: String(r.matchDate),
        opponent: r.opponent,
        shots: Number(r.shots ?? 0),
        sot: Number(r.shotsOnTarget ?? 0),
        minutes: Number(r.minutes ?? 0),
      })),
    }
  })
    .filter((p) => p.games >= 2 && p.minutes >= 90)
    .sort((a, b) => b.score - a.score || b.sot90 - a.sot90 || b.sot - a.sot)
    .slice(0, 20)

  return NextResponse.json({
    connected: true,
    source: "Neon 2026/27 player match database",
    season: "2026/27",
    updatedAt: new Date().toISOString(),
    players,
    rowsConsidered: relevant.length,
  })
}
