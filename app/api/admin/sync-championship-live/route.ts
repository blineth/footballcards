import { NextResponse } from "next/server"
import { and, eq, gte } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const API_BASE = "https://v3.football.api-sports.io"
const LEAGUE_ID = "40"
const API_SEASON = "2026"
const DB_SEASON = "2026/27"
const CURRENT_SEASON_START = "2026-08-01"

type ApiEnvelope<T> = { response: T; paging?: { current?: number; total?: number }; errors?: unknown }

async function api<T>(path: string, params: Record<string, string>) {
  const key = process.env.API_FOOTBALL_KEY
  if (!key) throw new Error("API_FOOTBALL_KEY is not configured")
  const url = new URL(API_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    headers: { "x-apisports-key": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`API-Football ${path} failed: ${response.status}`)
  return (await response.json()) as ApiEnvelope<T>
}

function n(value: unknown) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}
function dec(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : null
}
function ymd(value: string) {
  return String(value ?? "").slice(0, 10)
}

async function syncAggregate() {
  type PlayerItem = {
    player?: { id?: number; name?: string }
    statistics?: Array<{
      team?: { id?: number; name?: string }
      league?: { id?: number; name?: string; season?: number }
      games?: { appearences?: number | null; lineups?: number | null; minutes?: number | null; position?: string | null }
      shots?: { total?: number | null; on?: number | null }
      goals?: { total?: number | null; assists?: number | null }
      fouls?: { drawn?: number | null; committed?: number | null }
      cards?: { yellow?: number | null; yellowred?: number | null; red?: number | null }
    }>
  }

  const first = await api<PlayerItem[]>("/players", { league: LEAGUE_ID, season: API_SEASON, page: "1" })
  const pages = Math.max(1, Number(first.paging?.total ?? 1))
  const all: PlayerItem[] = [...(first.response ?? [])]

  for (let page = 2; page <= pages; page++) {
    const next = await api<PlayerItem[]>("/players", { league: LEAGUE_ID, season: API_SEASON, page: String(page) })
    all.push(...(next.response ?? []))
  }

  const values: Array<typeof playerBaselines.$inferInsert> = []
  for (const item of all) {
    const playerName = String(item.player?.name ?? "").trim()
    if (!playerName) continue
    for (const stat of item.statistics ?? []) {
      if (Number(stat.league?.id ?? 0) !== Number(LEAGUE_ID)) continue
      const team = String(stat.team?.name ?? "").trim()
      if (!team) continue
      const minutes = n(stat.games?.minutes)
      const fouls = n(stat.fouls?.committed)
      const yellows = n(stat.cards?.yellow) + n(stat.cards?.yellowred)
      const shots = n(stat.shots?.total)
      const sot = n(stat.shots?.on)
      values.push({
        playerName,
        team,
        competition: "Championship",
        season: DB_SEASON,
        appearances: n(stat.games?.appearences),
        starts: n(stat.games?.lineups),
        minutes,
        yellowCards: yellows,
        redCards: n(stat.cards?.red) + n(stat.cards?.yellowred),
        goals: n(stat.goals?.total),
        assists: n(stat.goals?.assists),
        foulsCommitted: fouls,
        foulsDrawn: n(stat.fouls?.drawn),
        shots,
        shotsOnTarget: sot,
        foulsPer90: minutes > 0 ? dec((fouls * 90) / minutes) : null,
        cardsPer90: minutes > 0 ? dec((yellows * 90) / minutes) : null,
        shotsPer90: minutes > 0 ? dec((shots * 90) / minutes) : null,
        shotsOnTargetPer90: minutes > 0 ? dec((sot * 90) / minutes) : null,
        position: stat.games?.position ?? null,
        externalPlayerId: item.player?.id != null ? String(item.player.id) : null,
      })
    }
  }

  if (!values.length) throw new Error("No Championship player rows returned")
  await db.delete(playerBaselines).where(and(eq(playerBaselines.competition, "Championship"), eq(playerBaselines.season, DB_SEASON)))
  const chunkSize = 500
  for (let i = 0; i < values.length; i += chunkSize) {
    await db.insert(playerBaselines).values(values.slice(i, i + chunkSize))
  }

  return { players: values.length, pages }
}

async function syncRecent(limit: number) {
  type FixtureItem = {
    fixture?: { id?: number; date?: string }
    league?: { id?: number; name?: string; season?: number }
    teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } }
  }
  type FixturePlayersTeam = {
    team?: { id?: number; name?: string }
    players?: Array<{
      player?: { id?: number; name?: string }
      statistics?: Array<{
        games?: { minutes?: number | null; position?: string | null }
        shots?: { total?: number | null; on?: number | null }
        goals?: { total?: number | null; assists?: number | null }
        fouls?: { drawn?: number | null; committed?: number | null }
        cards?: { yellow?: number | null; red?: number | null }
      }>
    }>
  }

  const fx = await api<FixtureItem[]>("/fixtures", {
    league: LEAGUE_ID,
    season: API_SEASON,
    status: "FT",
    timezone: "Europe/London",
  })
  const fixtures = [...(fx.response ?? [])]
    .filter((f) => f.fixture?.id && f.fixture?.date)
    .sort((a, b) => String(b.fixture?.date).localeCompare(String(a.fixture?.date)))
    .slice(0, Math.max(12, Math.min(72, limit)))

  const rows: Array<typeof playerH2H.$inferInsert> = []
  for (let i = 0; i < fixtures.length; i += 4) {
    const batch = fixtures.slice(i, i + 4)
    const results = await Promise.all(batch.map(async (fixture) => {
      const id = String(fixture.fixture?.id ?? "")
      const payload = await api<FixturePlayersTeam[]>("/fixtures/players", { fixture: id })
      return { fixture, teams: payload.response ?? [] }
    }))

    for (const { fixture, teams } of results) {
      const home = String(fixture.teams?.home?.name ?? "")
      const away = String(fixture.teams?.away?.name ?? "")
      const homeId = String(fixture.teams?.home?.id ?? "")
      const date = ymd(String(fixture.fixture?.date ?? ""))
      if (!date) continue

      for (const teamBlock of teams) {
        const team = String(teamBlock.team?.name ?? "")
        const teamId = String(teamBlock.team?.id ?? "")
        const opponent = teamId === homeId || team === home ? away : home
        const venue = teamId === homeId || team === home ? "Home" : "Away"
        for (const p of teamBlock.players ?? []) {
          const stat = p.statistics?.[0]
          const playerName = String(p.player?.name ?? "").trim()
          if (!playerName || !stat) continue
          rows.push({
            playerName,
            team,
            opponent,
            matchDate: date,
            competition: "Championship",
            venue,
            minutes: n(stat.games?.minutes),
            foulsCommitted: n(stat.fouls?.committed),
            foulsDrawn: n(stat.fouls?.drawn),
            shots: n(stat.shots?.total),
            shotsOnTarget: n(stat.shots?.on),
            yellowCard: n(stat.cards?.yellow) > 0,
            redCard: n(stat.cards?.red) > 0,
            goals: n(stat.goals?.total),
            assists: n(stat.goals?.assists),
            externalPlayerId: p.player?.id != null ? String(p.player.id) : null,
          })
        }
      }
    }
  }

  await db.delete(playerH2H).where(and(eq(playerH2H.competition, "Championship"), gte(playerH2H.matchDate, CURRENT_SEASON_START)))
  const chunkSize = 500
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(playerH2H).values(rows.slice(i, i + chunkSize)).onConflictDoNothing()
  }

  return { fixtures: fixtures.length, playerMatchRows: rows.length }
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected" }, { status: 503 })
  await ensureResearchSchema()

  const url = new URL(request.url)
  const scope = url.searchParams.get("scope") ?? "aggregate"
  const recentLimit = Number(url.searchParams.get("recentFixtures") ?? "60")

  try {
    const aggregate = scope === "aggregate" || scope === "both" ? await syncAggregate() : null
    const recent = scope === "recent" || scope === "both" ? await syncRecent(recentLimit) : null
    return NextResponse.json({
      ok: true,
      competition: "Championship",
      season: DB_SEASON,
      source: "API-Football live Championship data",
      crossCheck: {
        fbref: [
          "https://fbref.com/en/comps/10/stats/Championship-Stats",
          "https://fbref.com/en/comps/10/shooting/Championship-Stats",
          "https://fbref.com/en/comps/10/misc/Championship-Stats",
        ],
      },
      aggregate,
      recent,
      refreshedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Championship sync failed" }, { status: 502 })
  }
}
