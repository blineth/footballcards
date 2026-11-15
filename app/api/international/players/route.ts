import { NextResponse } from "next/server"
import { desc, eq, inArray } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

const INTERNATIONAL_COMPETITIONS=[
  "International",
  "UEFA European Championship",
  "UEFA European Championship Qualifying",
  "UEFA Nations League",
  "FIFA World Cup",
  "FIFA World Cup Qualifying - UEFA",
  "FIFA World Cup Qualifying - CONMEBOL",
  "FIFA World Cup Qualifying - CONCACAF",
  "FIFA World Cup Qualifying - AFC",
  "FIFA World Cup Qualifying - CAF",
  "FIFA World Cup Qualifying - OFC",
  "International Friendly",
]

function norm(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}
function per90(value: number, minutes: number) {
  return minutes > 0 ? Math.round(((value * 90) / minutes) * 100) / 100 : null
}
function reliability(minutes: number, full = 1800) {
  return Math.max(0, Math.min(1, minutes / full))
}
function statsFromInternational(rows: Array<typeof playerH2H.$inferSelect>) {
  const sum = (key: keyof (typeof rows)[number]) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0)
  const minutes = sum("minutes")
  const fouls = sum("foulsCommitted")
  const fouled = sum("foulsDrawn")
  const yellows = rows.filter((row) => row.yellowCard === true).length
  const reds = rows.filter((row) => row.redCard === true).length
  const shots = sum("shots")
  const sot = sum("shotsOnTarget")
  return {
    matches: rows.length,
    starts: rows.filter((row) => row.starter === true).length,
    minutes,
    goals: sum("goals"),
    assists: sum("assists"),
    yellowCards: yellows,
    redCards: reds,
    foulsCommitted: fouls,
    foulsDrawn: fouled,
    shots,
    shotsOnTarget: sot,
    fouls90: per90(fouls, minutes),
    fouled90: per90(fouled, minutes),
    cards90: per90(yellows + reds, minutes),
    shots90: per90(shots, minutes),
    shotsOnTarget90: per90(sot, minutes),
  }
}
function baselineStats(row: typeof playerBaselines.$inferSelect | null) {
  if (!row) return null
  const minutes = Number(row.minutes ?? 0)
  return {
    club: row.team,
    competition: row.competition,
    season: row.season,
    appearances: Number(row.appearances ?? 0),
    starts: Number(row.starts ?? 0),
    minutes,
    goals: Number(row.goals ?? 0),
    assists: Number(row.assists ?? 0),
    yellowCards: Number(row.yellowCards ?? 0),
    redCards: Number(row.redCards ?? 0),
    foulsCommitted: Number(row.foulsCommitted ?? 0),
    foulsDrawn: Number(row.foulsDrawn ?? 0),
    shots: Number(row.shots ?? 0),
    shotsOnTarget: Number(row.shotsOnTarget ?? 0),
    fouls90: row.foulsPer90 == null ? per90(Number(row.foulsCommitted ?? 0), minutes) : Number(row.foulsPer90),
    fouled90: per90(Number(row.foulsDrawn ?? 0), minutes),
    cards90: row.cardsPer90 == null ? per90(Number(row.yellowCards ?? 0) + Number(row.redCards ?? 0), minutes) : Number(row.cardsPer90),
    shots90: row.shotsPer90 == null ? per90(Number(row.shots ?? 0), minutes) : Number(row.shotsPer90),
    shotsOnTarget90: row.shotsOnTargetPer90 == null ? per90(Number(row.shotsOnTarget ?? 0), minutes) : Number(row.shotsOnTargetPer90),
    position: row.position,
    externalPlayerId: row.externalPlayerId,
  }
}
function previousStats(rows: Array<typeof playerBaselines.$inferSelect>) {
  if (!rows.length) return null
  const sum = (key: keyof (typeof rows)[number]) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0)
  const minutes = sum("minutes")
  const fouls = sum("foulsCommitted")
  const fouled = sum("foulsDrawn")
  const yellows = sum("yellowCards")
  const reds = sum("redCards")
  const shots = sum("shots")
  const sot = sum("shotsOnTarget")
  return {
    season: "2025/26",
    clubs: Array.from(new Set(rows.map((row) => row.team).filter(Boolean))),
    competitions: Array.from(new Set(rows.map((row) => row.competition).filter(Boolean))),
    appearances: sum("appearances"),
    starts: sum("starts"),
    minutes,
    goals: sum("goals"),
    assists: sum("assists"),
    yellowCards: yellows,
    redCards: reds,
    foulsCommitted: fouls,
    foulsDrawn: fouled,
    shots,
    shotsOnTarget: sot,
    fouls90: per90(fouls, minutes),
    fouled90: per90(fouled, minutes),
    cards90: per90(yellows + reds, minutes),
    shots90: per90(shots, minutes),
    shotsOnTarget90: per90(sot, minutes),
  }
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured) return NextResponse.json({ connected: false, players: [], error: "Database not connected" }, { status: 503 })
  await ensureResearchSchema()

  const url = new URL(request.url)
  const teamFilter = norm(url.searchParams.get("team"))
  const [internationalRows, currentBaselines, previousBaselines] = await Promise.all([
    db.select().from(playerH2H).where(inArray(playerH2H.competition, INTERNATIONAL_COMPETITIONS)).orderBy(desc(playerH2H.matchDate)),
    db.select().from(playerBaselines).where(eq(playerBaselines.season, "2026/27")).orderBy(desc(playerBaselines.minutes)),
    db.select().from(playerBaselines).where(eq(playerBaselines.season, "2025/26")).orderBy(desc(playerBaselines.minutes)),
  ])

  const groups = new Map<string, Array<typeof playerH2H.$inferSelect>>()
  // Historical Euros/Nations League/World Cup rows are H2H evidence only.
  // Current national-team profiles and probable-XI eligibility must be based on
  // genuinely recent senior usage, otherwise retired/out-of-squad players can
  // re-enter the candidate pool because of old tournament appearances.
  const currentInternationalRows=internationalRows.filter(row=>String(row.matchDate??"")>="2026-01-01")
  for (const row of currentInternationalRows) {
    if (teamFilter && norm(row.team) !== teamFilter) continue
    const key = `${norm(row.playerName)}|${norm(row.team)}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  const profiles = [...groups.values()].map((rows) => {
    const latest = rows[0]
    const international = statsFromInternational(rows)
    const externalId = latest.externalPlayerId

    let currentMatches = externalId ? currentBaselines.filter((row) => row.externalPlayerId === externalId) : []
    if (!currentMatches.length) currentMatches = currentBaselines.filter((row) => norm(row.playerName) === norm(latest.playerName))
    currentMatches = currentMatches.filter((row) => row.competition !== "International")
    const current = currentMatches.sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0))[0] ?? null

    let previousMatches = previousBaselines.filter((row) => norm(row.playerName) === norm(latest.playerName))
    if (!previousMatches.length && current?.externalPlayerId) previousMatches = previousBaselines.filter((row) => row.externalPlayerId === current.externalPlayerId)

    const domestic = baselineStats(current)
    const previous = previousStats(previousMatches)

    const intlFouls90 = Number(international.fouls90 ?? 0)
    const domesticFouls90 = Number(domestic?.fouls90 ?? 0)
    const previousFouls90 = Number(previous?.fouls90 ?? 0)
    const intlWeight = 0.25 * reliability(international.minutes, 900)
    const domesticWeight = domestic ? 0.6 * reliability(domestic.minutes, 1800) : 0
    const previousWeight = previous ? 0.15 * reliability(previous.minutes, 1800) : 0
    const weightTotal = intlWeight + domesticWeight + previousWeight
    const blendedFouls90 = weightTotal > 0
      ? Math.round(((intlFouls90 * intlWeight + domesticFouls90 * domesticWeight + previousFouls90 * previousWeight) / weightTotal) * 100) / 100
      : null
    const foulResearchScore = blendedFouls90 == null ? null : Math.round(Math.min(100, (blendedFouls90 / 2.5) * 100) * 10) / 10

    return {
      name: latest.playerName,
      nationalTeam: latest.team,
      position: latest.position ?? domestic?.position ?? null,
      international,
      domesticCurrent: domestic,
      domesticPrevious: previous,
      blended: {
        fouls90: blendedFouls90,
        foulResearchScore,
        note: "Research score is not a probability. 2026 senior international form and current domestic club form drive the profile; older tournament rows are reserved for H2H evidence.",
        weights: {
          domesticCurrent: Math.round(domesticWeight * 100),
          international: Math.round(intlWeight * 100),
          previousSeason: Math.round(previousWeight * 100),
        },
      },
      coverage: domestic ? "international+domestic-current" : previous ? "international+previous-domestic" : "international-only",
    }
  }).sort((a, b) => Number(b.blended.foulResearchScore ?? -1) - Number(a.blended.foulResearchScore ?? -1))

  return NextResponse.json({
    connected: true,
    team: url.searchParams.get("team") || null,
    players: profiles,
    playerCount: profiles.length,
    domesticCoverage: {
      current: profiles.filter((p) => p.domesticCurrent).length,
      previousOnly: profiles.filter((p) => !p.domesticCurrent && p.domesticPrevious).length,
      internationalOnly: profiles.filter((p) => !p.domesticCurrent && !p.domesticPrevious).length,
    },
    generatedAt: new Date().toISOString(),
  })
}
