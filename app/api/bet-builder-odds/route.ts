import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const API_BASE = "https://v3.football.api-sports.io"
const UK_ODDS_BASE = "https://api.ukoddsapi.com"
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
function marketKind(name: string) {
  const n = norm(name)
  if (/shot.*target|target.*shot/.test(n)) return "sot"
  if (/foul/.test(n)) return "foul"
  if (/card|book/.test(n)) return "card"
  return "other"
}
async function apiFootball(path: string, params: Record<string, string>, key: string) {
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
async function ukOdds(path: string, params: Record<string, string>, key: string) {
  const url = new URL(UK_ODDS_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    headers: { "X-Api-Key": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`UK Odds API ${path} ${response.status}`)
  return response.json()
}
function eventRows(payload: any) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.events)) return payload.events
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.results)) return payload.results
  return []
}
function eventTeam(row: any, side: "home" | "away") {
  return row?.[side + "_team"]?.name ?? row?.[side + "_team"] ?? row?.[side]?.name ?? row?.[side] ?? ""
}
function eventId(row: any) {
  return row?.event_id ?? row?.id ?? row?.eventId ?? ""
}
function flattenUkSelections(payload: any) {
  const out: Array<{ market: string; kind: string; label: string; odd: number | null }> = []
  for (const market of payload?.markets ?? []) {
    const marketName = String(market?.market_name ?? market?.name ?? market?.market_key ?? "")
    const kind = marketKind(marketName)
    if (kind === "other") continue
    for (const selection of market?.selections ?? []) {
      const label = String(selection?.selection_name ?? selection?.name ?? selection?.label ?? "")
      const rows = Array.isArray(selection?.odds) ? selection.odds : [selection]
      for (const row of rows) {
        const bookmakerCode = String(row?.bookmaker_code ?? selection?.bookmaker_code ?? "")
        const bookmakerName = String(row?.bookmaker_name ?? selection?.bookmaker_name ?? "")
        if (bookmakerCode && bookmakerCode !== "UO004") continue
        if (bookmakerName && !norm(bookmakerName).includes("bet365")) continue
        const raw = Number(row?.odds ?? row?.price ?? selection?.odds)
        out.push({ market: marketName, kind, label, odd: Number.isFinite(raw) ? raw : null })
      }
    }
  }
  return out
}
async function fromUkOdds(input: { date: string; home: string; away: string; key: string }) {
  const eventsPayload = await ukOdds("/v1/football/events", { schedule_date: input.date, per_page: "200" }, input.key)
  const event = eventRows(eventsPayload).find((row: any) => teamMatch(eventTeam(row, "home"), input.home) && teamMatch(eventTeam(row, "away"), input.away))
  const id = eventId(event)
  if (!id) return null
  const oddsPayload = await ukOdds(`/v1/football/events/${id}/odds`, {
    package: "full",
    bookmakers: "bet365",
    odds_format: "decimal",
  }, input.key)
  return {
    connected: true,
    bookmaker: "Bet365",
    source: "UK Odds API",
    capturedAt: oddsPayload?.captured_at ?? oddsPayload?.capturedAt ?? null,
    eventId: String(id),
    selections: flattenUkSelections(oddsPayload),
  }
}
async function fromApiFootball(input: { date: string; home: string; away: string; competition: string; key: string }) {
  const league = LEAGUE_IDS[input.competition]
  if (!league) return null
  const bookmakers = await apiFootball("/odds/bookmakers", { search: "Bet365" }, input.key)
  const bookmaker = bookmakers.find((b: any) => norm(b?.name).includes("bet365")) ?? bookmakers[0]
  if (!bookmaker?.id) return null
  const fixtures = await apiFootball("/fixtures", {
    date: input.date,
    league,
    season: seasonFor(input.date),
    timezone: "Europe/London",
  }, input.key)
  const fixture = fixtures.find((row: any) => teamMatch(row?.teams?.home?.name, input.home) && teamMatch(row?.teams?.away?.name, input.away))
  if (!fixture?.fixture?.id) return null
  const oddsRows = await apiFootball("/odds", {
    fixture: String(fixture.fixture.id),
    bookmaker: String(bookmaker.id),
  }, input.key)

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
  return {
    connected: true,
    bookmaker: bookmaker.name ?? "Bet365",
    source: "API-Football",
    capturedAt: null,
    fixtureId: String(fixture.fixture.id),
    selections,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"

  if (!date || !home || !away || !LEAGUE_IDS[competition]) {
    return NextResponse.json({ connected: false, selections: [], error: "Invalid fixture parameters" }, { status: 400 })
  }

  try {
    const ukKey = process.env.UK_ODDS_API_KEY
    if (ukKey) {
      try {
        const fresh = await fromUkOdds({ date, home, away, key: ukKey })
        if (fresh) return NextResponse.json({ ...fresh, priceAvailable: fresh.selections.length > 0 })
      } catch (error) {
        console.log("[bet-builder-odds] UK Odds fallback:", error instanceof Error ? error.message : error)
      }
    }

    const apiKey = process.env.API_FOOTBALL_KEY
    if (apiKey) {
      const fallback = await fromApiFootball({ date, home, away, competition, key: apiKey })
      if (fallback) return NextResponse.json({ ...fallback, priceAvailable: fallback.selections.length > 0 })
    }

    return NextResponse.json({
      connected: Boolean(ukKey || apiKey),
      bookmaker: "Bet365",
      source: ukKey ? "UK Odds API" : apiKey ? "API-Football" : null,
      selections: [],
      priceAvailable: false,
      note: "No Bet365 player-prop prices are available from the configured feed for this fixture.",
    })
  } catch (error) {
    console.log("[bet-builder-odds]", error instanceof Error ? error.message : error)
    return NextResponse.json({ connected: false, bookmaker: "Bet365", selections: [], priceAvailable: false })
  }
}
