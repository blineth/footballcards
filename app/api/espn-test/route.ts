import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const results = []
  for (const league of ["eng.1", "eng.2"]) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=20260822`
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      const data = response.ok ? await response.json() : null
      const events = data?.events ?? []
      const first = events[0]
      let summary = null
      if (first?.id) {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${first.id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
        if (r.ok) {
          const d = await r.json()
          summary = { keys: Object.keys(d), rosters: d.rosters?.slice?.(0, 2), officials: d.gameInfo?.officials ?? d.officials ?? null }
        }
      }
      results.push({ league, status: response.status, events: events.slice(0, 3).map((e: any) => ({ id: e.id, name: e.name, date: e.date })), summary })
    } catch (error) {
      results.push({ league, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ results })
}
