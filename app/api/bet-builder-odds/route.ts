import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const API_BASE = "https://v3.football.api-sports.io"
const LEAGUE_IDS: Record<string, string> = {
  "Premier League": "39",
  Championship: "40",
}

function norm(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(afc|fc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function seasonFor(date: string) {
  const d = new Date(date + "T12:00:00Z")
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  return String(month >= 7 ? year : year - 1)
}
async function api(path: string, params: Record<string, string>, key: string) {
  const url = new URL(API_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`API-Football ${path} ${response.status}`)
  const json = await response.json()
  return json?.response ?? []
}
function marketKind(name: string) {
  const n = norm(name)
  if (/shot.*target|target.*shot/.test(n)) return "sot"
  if (/foul/.test(n)) return "foul"
  if (/card|book/.test(n)) return "card"
  return "other"
}

export async function GET(request: Request) {
  const key = process.env.API_FOOTBALL_KEY
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"
  const league = LEAGUE_IDS[competition]

  if (!date || !home || !away || !league) {
    return NextResponse.json({ connected: Boolean(key), selections: [], error: "Invalid fixture parameters" }, { status: 400 })
  }
  if (!key) return NextResponse.json({ connected: false, selections: [], bookmaker: "Bet365" })

  try {
    const bookmakers = await api("/odds/bookmakers", { search: "Bet365" }, key)
    const bookmaker = bookmakers.find((b: any) => norm(b?.name).includes("bet365")) ?? bookmakers[0]
    if (!bookmaker?.id) return NextResponse.json({ connected: true, bookmaker: "Bet365", selections: [], priceAvailable: false })

    const fixtures = await api("/fixtures", {
      date,
      league,
      season: seasonFor(date),
      timezone: "Europe/London",
    }, key)
    const fixture = fixtures.find((row: any) => teamMatch(row?.teams?.home?.name, home) && teamMatch(row?.teams?.away?.name, away))
    if (!fixture?.fixture?.id) {
      return NextResponse.json({ connected: true, bookmaker: bookmaker.name ?? "Bet365", selections: [], priceAvailable: false })
    }

    const oddsRows = await api("/odds", {
      fixture: String(fixture.fixture.id),
      bookmaker: String(bookmaker.id),
    }, key)

    const selections: Array<{ market: string; kind: string; label: string; odd: number | null }> = []
    for (const row of oddsRows) {
      for (const book of row?.bookmakers ?? []) {
        if (String(book?.id) !== String(bookmaker.id)) continue
        for (const bet of book?.bets ?? []) {
          const kind = marketKind(String(bet?.name ?? ""))
          if (kind === "other") continue
          for (const value of bet?.values ?? []) {
            const raw = Number(value?.odd)
            selections.push({
              market: String(bet?.name ?? ""),
              kind,
              label: String(value?.value ?? ""),
              odd: Number.isFinite(raw) ? raw : null,
            })
          }
        }
      }
    }

    return NextResponse.json({
      connected: true,
      bookmaker: bookmaker.name ?? "Bet365",
      fixtureId: String(fixture.fixture.id),
      priceAvailable: selections.length > 0,
      selections,
    })
  } catch (error) {
    console.log("[bet-builder-odds]", error instanceof Error ? error.message : error)
    return NextResponse.json({ connected: false, bookmaker: "Bet365", selections: [], priceAvailable: false })
  }
}
