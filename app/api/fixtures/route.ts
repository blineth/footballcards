import { londonToday } from "@/lib/date"
import { getProvider } from "@/lib/providers"
import { getRefereeByName } from "@/lib/historical"
import type { Competition, Fixture, FixturesResponse } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? londonToday()
  const provider = getProvider()

  const base: FixturesResponse = {
    connected: provider.isConfigured(),
    updatedAt: new Date().toISOString(),
    date,
    leagues: { "Premier League": [], Championship: [] },
  }

  if (!provider.isConfigured()) {
    // Do NOT invent fixtures. Signal a missing live data source instead.
    return NextResponse.json(base)
  }

  try {
    const fixtures = await provider.getFixturesForDate(date)

    // Enrich referees with historical tendencies when we have them imported.
    const enriched = await Promise.all(
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

    const leagues: FixturesResponse["leagues"] = { "Premier League": [], Championship: [] }
    for (const f of enriched) {
      const league = f.competition as Competition
      leagues[league].push(f)
    }
    for (const key of Object.keys(leagues) as Competition[]) {
      leagues[key].sort((a, b) => a.kickoff.localeCompare(b.kickoff))
    }

    return NextResponse.json({ ...base, leagues })
  } catch (error) {
    console.log("[v0] /api/fixtures error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ...base, connected: false, error: "Failed to fetch fixtures from the live data source." },
      { status: 502 },
    )
  }
}
