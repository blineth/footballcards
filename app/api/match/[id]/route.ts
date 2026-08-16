import { getProvider } from "@/lib/providers"
import { getRefereeByName } from "@/lib/historical"
import type { Fixture } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = getProvider()

  if (!provider.isConfigured()) {
    return NextResponse.json({ connected: false, match: null, updatedAt: new Date().toISOString() })
  }

  try {
    const fixture = await provider.getFixture(id)
    if (!fixture) {
      return NextResponse.json(
        { connected: true, match: null, updatedAt: new Date().toISOString() },
        { status: 404 },
      )
    }

    let match: Fixture = fixture
    if (fixture.referee?.name) {
      const ref = await getRefereeByName(fixture.referee.name)
      if (ref) {
        match = {
          ...fixture,
          referee: {
            id: fixture.referee.id,
            name: fixture.referee.name,
            yellowsPerGame: ref.yellowsPerGame ? Number(ref.yellowsPerGame) : null,
            foulsPerGame: ref.foulsPerGame ? Number(ref.foulsPerGame) : null,
            matchesRefereed: ref.matchesRefereed ?? null,
          },
        }
      }
    }

    return NextResponse.json({ connected: true, match, updatedAt: new Date().toISOString() })
  } catch (error) {
    console.log("[v0] /api/match error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { connected: false, match: null, updatedAt: new Date().toISOString() },
      { status: 502 },
    )
  }
}
