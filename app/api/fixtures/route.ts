import { londonToday } from "@/lib/date"
import { getProvider } from "@/lib/providers"
import { getRefereeByName } from "@/lib/historical"
import type { Competition, Fixture, FixturesResponse, MatchStatus } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ESPN_LEAGUES: Record<Competition, string> = {
  "Premier League": "eng.1",
  Championship: "eng.2",
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
  const all = await Promise.all(
    (Object.entries(ESPN_LEAGUES) as [Competition, string][]).map(async ([competition, slug]) => {
      const response = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd}`,
        { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
      )
      if (!response.ok) throw new Error(`ESPN ${slug} ${response.status}`)
      const data = await response.json()
      return (data?.events ?? []).map((event: any): Fixture | null => {
        const contest = event?.competitions?.[0]
        const competitors = contest?.competitors ?? []
        const home = competitors.find((row: any) => row.homeAway === "home")
        const away = competitors.find((row: any) => row.homeAway === "away")
        if (!home?.team || !away?.team) return null
        const statusName = event?.status?.type?.name ?? event?.status?.type?.description ?? ""
        return {
          id: String(event.id),
          competition,
          kickoff: String(event.date ?? contest?.date ?? ""),
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
    }),
  )
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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? londonToday()
  const provider = getProvider()

  const base: FixturesResponse = {
    connected: true,
    updatedAt: new Date().toISOString(),
    date,
    leagues: { "Premier League": [], Championship: [] },
  }

  try {
    let fixtures: Fixture[] = []

    if (provider.isConfigured()) {
      try {
        fixtures = await provider.getFixturesForDate(date)
      } catch (error) {
        console.log("[v0] API-Football fixture fetch failed, falling back to ESPN:", error instanceof Error ? error.message : error)
      }
    }

    // API-Football can return an empty array for newer seasons on some plans.
    // ESPN is used as a live public fallback so real matchdays never appear empty.
    if (fixtures.length === 0) {
      fixtures = await espnFixtures(date)
    }

    const enriched = await enrichReferees(fixtures)
    const leagues: FixturesResponse["leagues"] = { "Premier League": [], Championship: [] }

    for (const f of enriched) {
      const league = f.competition as Competition
      if (leagues[league]) leagues[league].push(f)
    }

    for (const key of Object.keys(leagues) as Competition[]) {
      leagues[key].sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    }

    return NextResponse.json({ ...base, leagues })
  } catch (error) {
    console.log("[v0] /api/fixtures error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ...base, connected: false, error: "Failed to fetch fixtures from the live data sources." },
      { status: 502 },
    )
  }
}
