import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const target = "https://www.sofascore.com/api/v1/sport/football/scheduled-events/2026-08-21"
const urls = [
  target,
  "https://api.sofascore.com/api/v1/sport/football/scheduled-events/2026-08-21",
  `https://r.jina.ai/${target}`,
  `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
]

export async function GET() {
  const results = []
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json,text/plain,*/*", "user-agent": "Mozilla/5.0", referer: "https://www.sofascore.com/" },
        signal: AbortSignal.timeout(12000),
      })
      const text = await response.text()
      results.push({ url, status: response.status, ok: response.ok, sample: text.slice(0, 300) })
    } catch (error) {
      results.push({ url, status: null, ok: false, sample: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ results })
}
