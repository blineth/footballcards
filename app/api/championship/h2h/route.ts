import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60

const API_BASE = "https://v3.football.api-sports.io"
const CHAMPIONSHIP_ID = 40

type Envelope<T> = { response: T }

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
  return (await response.json()) as Envelope<T>
}

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function n(value: unknown) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  if (!home || !away) return NextResponse.json({ ok: false, matches: [], error: "home and away are required" }, { status: 400 })

  try {
    type TeamItem = { team?: { id?: number; name?: string } }
    const teamPayload = await api<TeamItem[]>("/teams", { league: String(CHAMPIONSHIP_ID), season: "2026" })
    const teams = teamPayload.response ?? []
    const homeTeam = teams.find((x) => teamMatch(x.team?.name, home))?.team
    const awayTeam = teams.find((x) => teamMatch(x.team?.name, away))?.team
    if (!homeTeam?.id || !awayTeam?.id) {
      return NextResponse.json({ ok: false, matches: [], error: "Could not match both Championship teams to API-Football" }, { status: 404 })
    }

    type FixtureItem = {
      fixture?: { id?: number; date?: string; referee?: string | null }
      league?: { id?: number; name?: string; season?: number }
      teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } }
      goals?: { home?: number; away?: number }
    }
    const h2hPayload = await api<FixtureItem[]>("/fixtures/headtohead", {
      h2h: `${homeTeam.id}-${awayTeam.id}`,
      from: "2025-08-01",
      to: "2026-06-30",
      timezone: "Europe/London",
    })
    const fixtures = (h2hPayload.response ?? [])
      .filter((f) => f.fixture?.id && String(f.fixture?.date ?? "") >= "2025-08-01" && String(f.fixture?.date ?? "") <= "2026-06-30")
      .sort((a, b) => String(b.fixture?.date).localeCompare(String(a.fixture?.date)))
      .slice(0, 6)

    type PlayerTeam = {
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

    const detailed = await Promise.all(fixtures.map(async (fixture) => {
      const id = String(fixture.fixture?.id ?? "")
      const payload = await api<PlayerTeam[]>("/fixtures/players", { fixture: id })
      const rows: Array<{
        name: string; team: string; opponent: string; position: string | null; minutes: number;
        goals: number; assists: number; shots: number; shotsOnTarget: number;
        foulsCommitted: number; foulsDrawn: number; yellowCard: boolean; redCard: boolean; externalPlayerId: string | null;
      }> = []
      const fixtureHome = String(fixture.teams?.home?.name ?? "")
      const fixtureAway = String(fixture.teams?.away?.name ?? "")
      const fixtureHomeId = String(fixture.teams?.home?.id ?? "")
      for (const block of payload.response ?? []) {
        const team = String(block.team?.name ?? "")
        const teamId = String(block.team?.id ?? "")
        const opponent = teamId === fixtureHomeId || team === fixtureHome ? fixtureAway : fixtureHome
        for (const p of block.players ?? []) {
          const stat = p.statistics?.[0]
          const name = String(p.player?.name ?? "").trim()
          if (!name || !stat) continue
          rows.push({
            name,
            team,
            opponent,
            position: stat.games?.position ?? null,
            minutes: n(stat.games?.minutes),
            goals: n(stat.goals?.total),
            assists: n(stat.goals?.assists),
            shots: n(stat.shots?.total),
            shotsOnTarget: n(stat.shots?.on),
            foulsCommitted: n(stat.fouls?.committed),
            foulsDrawn: n(stat.fouls?.drawn),
            yellowCard: n(stat.cards?.yellow) > 0,
            redCard: n(stat.cards?.red) > 0,
            externalPlayerId: p.player?.id != null ? String(p.player.id) : null,
          })
        }
      }
      return {
        id,
        date: String(fixture.fixture?.date ?? "").slice(0, 10),
        competition: String(fixture.league?.name ?? "Unknown"),
        leagueId: Number(fixture.league?.id ?? 0),
        season: fixture.league?.season ?? null,
        home: fixtureHome,
        away: fixtureAway,
        homeGoals: n(fixture.goals?.home),
        awayGoals: n(fixture.goals?.away),
        referee: fixture.fixture?.referee ?? null,
        players: rows,
      }
    }))

    if (isDatabaseConfigured && detailed.length) {
      await ensureResearchSchema()
      const inserts: Array<typeof playerH2H.$inferInsert> = []
      for (const match of detailed) {
        for (const p of match.players) {
          const venue = teamMatch(p.team, match.home) ? "Home" : "Away"
          inserts.push({
            playerName: p.name,
            team: p.team,
            opponent: p.opponent,
            matchDate: match.date,
            competition: match.leagueId === CHAMPIONSHIP_ID ? "Championship" : match.competition,
            venue,
            minutes: p.minutes,
            foulsCommitted: p.foulsCommitted,
            foulsDrawn: p.foulsDrawn,
            shots: p.shots,
            shotsOnTarget: p.shotsOnTarget,
            yellowCard: p.yellowCard,
            redCard: p.redCard,
            goals: p.goals,
            assists: p.assists,
            externalPlayerId: p.externalPlayerId,
          })
        }
      }
      for (let i = 0; i < inserts.length; i += 400) {
        await db.insert(playerH2H).values(inserts.slice(i, i + 400)).onConflictDoNothing()
      }
    }

    return NextResponse.json({
      ok: true,
      source: "API-Football fixture player statistics",
      period: "2025/26",
      home,
      away,
      matches: detailed,
      matchCount: detailed.length,
      loadedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, matches: [], error: error instanceof Error ? error.message : "H2H lookup failed" }, { status: 502 })
  }
}
