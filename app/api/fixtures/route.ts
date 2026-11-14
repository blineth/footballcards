import { londonToday } from "@/lib/date"
import { getProvider } from "@/lib/providers"
import { getRefereeByName } from "@/lib/historical"
import type { Competition, Fixture, FixturesResponse, MatchStatus } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ESPN_LEAGUES: Record<Competition, string[]> = {
  "Premier League": ["eng.1"],
  Championship: ["eng.2"],
  "League One": ["eng.3"],
  "League Two": ["eng.4"],
  International: ["uefa.nations", "fifa.friendly", "fifa.world", "fifa.worldq.uefa", "uefa.euro", "uefa.euroq"],
}

function londonYmd(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d)
  const get = (type:string) => parts.find(p=>p.type===type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function mapEspnStatus(value: string | undefined): MatchStatus {
  const v = String(value ?? "").toLowerCase()
  if (v.includes("in") || v.includes("live")) return "live"
  if (v.includes("half")) return "halftime"
  if (v.includes("final") || v.includes("full")) return "finished"
  if (v.includes("postpon")) return "postponed"
  if (v.includes("pre") || v.includes("sched")) return "scheduled"
  return "unknown"
}

async function espnFixtures(date: string): Promise<Fixture[]> {
  const ymd = date.replaceAll("-", "")
  const requests: Array<Promise<Fixture[]>> = []
  for (const [competition, slugs] of Object.entries(ESPN_LEAGUES) as [Competition, string[]][]) {
    for (const slug of slugs) {
      requests.push((async () => {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd}&limit=300`,
          { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
        )
        if (!response.ok) return []
        const data = await response.json()
        const tournament = String(data?.leagues?.[0]?.name ?? data?.leagues?.[0]?.abbreviation ?? competition)
        return (data?.events ?? []).map((event: any): Fixture | null => {
          const contest = event?.competitions?.[0]
          const competitors = contest?.competitors ?? []
          const home = competitors.find((row: any) => row.homeAway === "home")
          const away = competitors.find((row: any) => row.homeAway === "away")
          if (!home?.team || !away?.team) return null
          const statusName = event?.status?.type?.name ?? event?.status?.type?.description ?? ""
          const kickoff = String(event.date ?? contest?.date ?? "")
          if (londonYmd(kickoff) !== date) return null
          return {
            id: `${slug}:${String(event.id)}`,
            competition,
            tournament,
            kickoff,
            status: mapEspnStatus(statusName),
            home: {
              id: String(home.team.id ?? ""),
              name: String(home.team.displayName ?? home.team.name ?? ""),
              shortName: home.team.shortDisplayName ?? undefined,
              crest: home.team.logo ?? undefined,
            },
            away: {
              id: String(away.team.id ?? ""),
              name: String(away.team.displayName ?? away.team.name ?? ""),
              shortName: away.team.shortDisplayName ?? undefined,
              crest: away.team.logo ?? undefined,
            },
            venue: contest?.venue?.fullName ?? null,
            referee: null,
            lineupStatus: "expected",
          }
        }).filter((row: Fixture | null): row is Fixture => Boolean(row))
      })())
    }
  }
  const all = await Promise.all(requests)
  return all.flat()
}

async function enrichReferees(fixtures: Fixture[]) {
  return Promise.all(
    fixtures.map(async (f) => {
      if (!f.referee?.name) return f
      const ref = await getRefereeByName(f.referee.name)
      if (!ref) return f
      return {
        ...f,
        referee: {
          id: f.referee.id,
          name: f.referee.name,
          yellowsPerGame: ref.yellowsPerGame ? Number(ref.yellowsPerGame) : null,
          foulsPerGame: ref.foulsPerGame ? Number(ref.foulsPerGame) : null,
          matchesRefereed: ref.matchesRefereed ?? null,
        },
      } satisfies Fixture
    }),
  )
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function fixtureKey(f: Fixture) {
  return [f.competition, f.kickoff.slice(0,10), f.home.name, f.away.name].join("|").toLowerCase()
}

async function fixturesForDate(date: string) {
  const provider = getProvider()
  let providerFixtures: Fixture[] = []
  let espn: Fixture[] = []

  if (provider.isConfigured()) {
    try {
      providerFixtures = await provider.getFixturesForDate(date)
    } catch (error) {
      console.log("[v0] API-Football fixture fetch failed:", error instanceof Error ? error.message : error)
    }
  }

  try {
    espn = await espnFixtures(date)
  } catch (error) {
    console.log("[v0] ESPN fixture fetch failed:", error instanceof Error ? error.message : error)
  }

  // Merge rather than only falling back when the primary provider is totally empty.
  // This prevents one competition disappearing when the provider has partial coverage.
  const merged = new Map<string, Fixture>()
  for (const f of espn) merged.set(fixtureKey(f), f)
  for (const f of providerFixtures) merged.set(fixtureKey(f), f)
  return [...merged.values()]
}

function groupFixtures(fixtures: Fixture[]) {
  const leagues: FixturesResponse["leagues"] = { "Premier League": [], Championship: [], "League One": [], "League Two": [], International: [] }
  for (const f of fixtures) {
    const league = f.competition as Competition
    if (leagues[league]) leagues[league].push(f)
  }
  for (const key of Object.keys(leagues) as Competition[]) {
    leagues[key].sort((a, b) => a.kickoff.localeCompare(b.kickoff))
  }
  return leagues
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedDate = url.searchParams.get("date") ?? londonToday()
  const targetCompetition = url.searchParams.get("competition") as Competition | null
  const nextIfEmpty = url.searchParams.get("nextIfEmpty") === "1"

  const base: FixturesResponse = {
    connected: true,
    updatedAt: new Date().toISOString(),
    date: requestedDate,
    leagues: { "Premier League": [], Championship: [], "League One": [], "League Two": [], International: [] },
  }

  try {
    let resolvedDate = requestedDate
    let fixtures = await fixturesForDate(resolvedDate)
    let leagues = groupFixtures(await enrichReferees(fixtures))

    if (nextIfEmpty && targetCompetition && leagues[targetCompetition]?.length === 0) {
      for (let offset = 1; offset <= 21; offset++) {
        const candidateDate = addDays(requestedDate, offset)
        const candidateFixtures = await fixturesForDate(candidateDate)
        const candidateLeagues = groupFixtures(await enrichReferees(candidateFixtures))
        if (candidateLeagues[targetCompetition]?.length) {
          resolvedDate = candidateDate
          fixtures = candidateFixtures
          leagues = candidateLeagues
          break
        }
      }
    }

    return NextResponse.json({
      ...base,
      date: resolvedDate,
      requestedDate,
      showingNextMatchday: resolvedDate !== requestedDate,
      leagues,
    })
  } catch (error) {
    console.log("[v0] /api/fixtures error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ...base, connected: false, error: "Failed to fetch fixtures from the live data sources." },
      { status: 502 },
    )
  }
}
