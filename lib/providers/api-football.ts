import type { Competition, Fixture, LineupPlayer, LineupStatus, MatchStatus, TeamLineup } from "@/lib/types"
import { type FootballDataProvider, ProviderNotConfiguredError } from "./types"

// API-Football (api-sports.io) league ids.
const LEAGUE_IDS: Record<number, Competition> = {
  39: "Premier League",
  40: "Championship",
}

const API_BASE = "https://v3.football.api-sports.io"

function mapStatus(short: string): MatchStatus {
  switch (short) {
    case "NS":
    case "TBD":
      return "scheduled"
    case "1H":
    case "2H":
    case "ET":
    case "P":
    case "LIVE":
      return "live"
    case "HT":
      return "halftime"
    case "FT":
    case "AET":
    case "PEN":
      return "finished"
    case "PST":
    case "CANC":
    case "SUSP":
      return "postponed"
    default:
      return "unknown"
  }
}

interface ApiFixtureItem {
  fixture: {
    id: number
    date: string
    venue: { name: string | null }
    status: { short: string }
    referee: string | null
  }
  league: { id: number; season: number }
  teams: {
    home: { id: number; name: string; logo: string }
    away: { id: number; name: string; logo: string }
  }
}

function toFixture(item: ApiFixtureItem): Fixture | null {
  const competition = LEAGUE_IDS[item.league.id]
  if (!competition) return null
  return {
    id: String(item.fixture.id),
    competition,
    kickoff: item.fixture.date,
    status: mapStatus(item.fixture.status.short),
    home: { id: String(item.teams.home.id), name: item.teams.home.name, crest: item.teams.home.logo },
    away: { id: String(item.teams.away.id), name: item.teams.away.name, crest: item.teams.away.logo },
    venue: item.fixture.venue?.name ?? null,
    referee: item.fixture.referee
      ? { id: null, name: item.fixture.referee, yellowsPerGame: null, foulsPerGame: null, matchesRefereed: null }
      : null,
    lineupStatus: "expected",
  }
}

export class ApiFootballProvider implements FootballDataProvider {
  readonly name = "API-Football"
  private readonly apiKey: string | undefined

  constructor(apiKey = process.env.API_FOOTBALL_KEY) {
    this.apiKey = apiKey
  }

  isConfigured() {
    return Boolean(this.apiKey)
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.name)
    const url = new URL(`${API_BASE}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      headers: { "x-apisports-key": this.apiKey },
      // Fixtures/lineups change often; let route-level revalidation control caching.
      cache: "no-store",
    })
    if (!res.ok) {
      throw new Error(`${this.name} request failed: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as { response: T }
    return json.response
  }

  private currentSeason(): string {
    // European season starts in August. Use London-anchored year math.
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = now.getUTCMonth() // 0-based
    return String(month >= 7 ? year : year - 1)
  }

  async getFixturesForDate(date: string): Promise<Fixture[]> {
    const season = this.currentSeason()
    const results = await Promise.all(
      Object.keys(LEAGUE_IDS).map((leagueId) =>
        this.request<ApiFixtureItem[]>("/fixtures", {
          date,
          league: leagueId,
          season,
          timezone: "Europe/London",
        }),
      ),
    )
    return results.flat().map(toFixture).filter((f): f is Fixture => f !== null)
  }

  async getFixture(matchId: string): Promise<Fixture | null> {
    const items = await this.request<ApiFixtureItem[]>("/fixtures", { id: matchId })
    const first = items[0]
    return first ? toFixture(first) : null
  }

  async getLineups(matchId: string): Promise<{ status: LineupStatus; home: TeamLineup | null; away: TeamLineup | null }> {
    interface ApiLineupItem {
      team: { id: number; name: string; logo: string }
      startXI: { player: { id: number; name: string; number: number | null; pos: string | null } }[]
      substitutes: { player: { id: number; name: string; number: number | null; pos: string | null } }[]
    }
    const items = await this.request<ApiLineupItem[]>("/fixtures/lineups", { fixture: matchId })

    if (items.length === 0) {
      return { status: "expected", home: null, away: null }
    }

    const mapPlayer = (p: ApiLineupItem["startXI"][number]["player"], isStarter: boolean): LineupPlayer => ({
      id: String(p.id),
      name: p.name,
      number: p.number,
      position: p.pos,
      isStarter,
    })

    const toTeamLineup = (item: ApiLineupItem): TeamLineup => ({
      team: { id: String(item.team.id), name: item.team.name, crest: item.team.logo },
      status: "confirmed",
      startingXI: item.startXI.map((s) => mapPlayer(s.player, true)),
      substitutes: item.substitutes.map((s) => mapPlayer(s.player, false)),
    })

    // API-Football only returns lineups once they are confirmed.
    return {
      status: "confirmed",
      home: items[0] ? toTeamLineup(items[0]) : null,
      away: items[1] ? toTeamLineup(items[1]) : null,
    }
  }
}
