import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const urls = [
  "https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-08-21",
  "https://api.sofascore.com/api/v1/sport/football/scheduled-events/2026-08-21",
  "https://www.sofascore.com/api/v1/unique-tournament/17/season/96668/events/round/1",
  "https://api.sofascore.com/api/v1/unique-tournament/17/season/96668/events/round/1",
]

export async function GET() {
  const results = []
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0", referer: "https://www.sofascore.com/" },
        signal: AbortSignal.timeout(8000),
      })
      const text = await response.text()
      results.push({ url, status: response.status, ok: response.ok, sample: text.slice(0, 180) })
    } catch (error) {
      results.push({ url, status: null, ok: false, sample: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ results })
}
