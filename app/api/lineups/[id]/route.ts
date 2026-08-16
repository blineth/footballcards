import { getProvider } from "@/lib/providers"
import type { LineupsResponse } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const provider = getProvider()

  const base: LineupsResponse = {
    connected: provider.isConfigured(),
    updatedAt: new Date().toISOString(),
    matchId: id,
    status: "unavailable",
    home: null,
    away: null,
  }

  if (!provider.isConfigured()) {
    return NextResponse.json(base)
  }

  try {
    const lineups = await provider.getLineups(id)
    return NextResponse.json({
      ...base,
      status: lineups.status,
      home: lineups.home,
      away: lineups.away,
    })
  } catch (error) {
    console.log("[v0] /api/lineups error:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ...base, connected: false }, { status: 502 })
  }
}
