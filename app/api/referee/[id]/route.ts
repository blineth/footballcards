import { getRefereeByName } from "@/lib/historical"
import { isDatabaseConfigured } from "@/lib/db"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

// [id] here is the referee name (URL-encoded). Referees are keyed by name in the
// historical library since providers rarely expose stable referee ids.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const name = decodeURIComponent(id)

  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, referee: null, updatedAt: new Date().toISOString() })
  }

  try {
    const ref = await getRefereeByName(name)
    if (!ref) {
      return NextResponse.json({
        connected: true,
        referee: null,
        message: "Not enough historical data",
        updatedAt: new Date().toISOString(),
      })
    }
    return NextResponse.json({
      connected: true,
      referee: {
        name: ref.refereeName,
        matchesRefereed: ref.matchesRefereed,
        yellowCards: ref.yellowCards,
        redCards: ref.redCards,
        yellowsPerGame: ref.yellowsPerGame ? Number(ref.yellowsPerGame) : null,
        foulsPerGame: ref.foulsPerGame ? Number(ref.foulsPerGame) : null,
      },
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.log("[v0] /api/referee error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { connected: false, referee: null, updatedAt: new Date().toISOString() },
      { status: 502 },
    )
  }
}
