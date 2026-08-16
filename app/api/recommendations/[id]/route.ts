import { getProvider } from "@/lib/providers"
import { buildRecommendations } from "@/lib/recommendations"
import { hasAnyHistoricalData } from "@/lib/historical"
import type { RecommendationsResponse } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = getProvider()

  const base: RecommendationsResponse = {
    connected: provider.isConfigured(),
    updatedAt: new Date().toISOString(),
    matchId: id,
    lineupStatus: "unavailable",
    cardCandidates: [],
    foulCandidates: [],
    historicalDataAvailable: false,
  }

  if (!provider.isConfigured()) {
    return NextResponse.json(base)
  }

  try {
    const [fixture, lineups, historicalDataAvailable] = await Promise.all([
      provider.getFixture(id),
      provider.getLineups(id),
      hasAnyHistoricalData(),
    ])

    if (!fixture) {
      return NextResponse.json({ ...base, historicalDataAvailable }, { status: 404 })
    }

    const { cardCandidates, foulCandidates } = await buildRecommendations(fixture, lineups)

    return NextResponse.json({
      ...base,
      lineupStatus: lineups.status,
      cardCandidates,
      foulCandidates,
      historicalDataAvailable,
    })
  } catch (error) {
    console.log("[v0] /api/recommendations error:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ...base, connected: false }, { status: 502 })
  }
}
