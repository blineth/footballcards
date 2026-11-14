import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { oddsSnapshots } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const revalidate = 0

const API_BASE = "https://v3.football.api-sports.io"
const UK_ODDS_BASE = "https://api.ukoddsapi.com"
const FREE_ODDS_CACHE_MS = 3 * 60 * 60 * 1000
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
async function saveSnapshots(input:{date:string;home:string;away:string;competition:string;bookmaker?:string;source?:string|null;capturedAt?:string|null;selections:Array<{market:string;kind:string;label:string;odd:number|null}>}) {
  if (!isDatabaseConfigured || !input.selections.length) return
  await ensureResearchSchema()
  const now = new Date()
  const bucket = new Date(Math.floor(now.getTime() / 300000) * 300000)
  const captured = input.capturedAt ? new Date(input.capturedAt) : now
  const capturedAt = Number.isNaN(captured.getTime()) ? now : captured
  const rows = input.selections
    .filter(s => s.odd != null && Number.isFinite(Number(s.odd)) && Number(s.odd) > 1)
    .map(s => ({
      competition: input.competition,
      fixtureDate: input.date,
      homeTeam: input.home,
      awayTeam: input.away,
      bookmaker: input.bookmaker ?? "Unknown",
      source: input.source ?? null,
      market: s.market,
      kind: s.kind,
      label: s.label,
      odds: String(Number(s.odd)),
      snapshotBucket: bucket,
      capturedAt,
    }))
  if (rows.length) await db.insert(oddsSnapshots).values(rows).onConflictDoNothing()
}

async function attachMovement(input:{date:string;home:string;away:string;competition:string;bookmaker?:string;selections:Array<{market:string;kind:string;label:string;odd:number|null}>}) {
  if (!isDatabaseConfigured || !input.selections.length || !input.bookmaker) return input.selections
  try {
    const rows = await db.select().from(oddsSnapshots)
      .where(and(
        eq(oddsSnapshots.competition, input.competition),
        eq(oddsSnapshots.fixtureDate, input.date),
        eq(oddsSnapshots.homeTeam, input.home),
        eq(oddsSnapshots.awayTeam, input.away),
        eq(oddsSnapshots.bookmaker, input.bookmaker),
      ))
      .orderBy(desc(oddsSnapshots.capturedAt))
      .limit(1000)

    return input.selections.map(selection => {
      if (selection.odd == null) return { ...selection, previousOdd:null, movement:null }
      const current = Number(selection.odd)
      const previous = rows.find(row =>
        norm(row.market) === norm(selection.market) &&
        norm(row.label) === norm(selection.label) &&
        Math.abs(Number(row.odds) - current) > 0.0001
      )
      const previousOdd = previous ? Number(previous.odds) : null
      return {
        ...selection,
        previousOdd,
        movement: previousOdd == null ? null : Math.round((current - previousOdd) * 1000) / 1000,
      }
    })
  } catch {
    return input.selections
  }
}


type MarketAvailabilityState = "available" | "unavailable" | "unknown"
type MarketAvailability = Record<"card"|"foul"|"fouled"|"shot"|"sot", MarketAvailabilityState>

function isPlayerPropSelection(selection:{market?:string;label?:string;kind:string}) {
  const market = norm(selection.market)
  const label = norm(selection.label)
  const text = (market + " " + label).trim()

  if (selection.kind === "card") {
    return /\bplayer\b/.test(market) || /\bto be booked\b|\bbooked\b|\bto receive a card\b|\bcarded\b/.test(text)
  }
  if (selection.kind === "foul") {
    return /\bplayer\b/.test(market) || /\bto commit\b|\bplayer fouls committed\b|\bfouls committed by\b/.test(text)
  }
  if (selection.kind === "fouled") {
    return /\bplayer\b/.test(market) || /\bto be fouled\b|\bfouls drawn\b|\bfouls won\b/.test(text)
  }
  if (selection.kind === "sot") {
    return /\bplayer\b/.test(market) || /\bplayer shots on target\b|\bshots on target by\b/.test(text)
  }
  if (selection.kind === "shot") {
    return /\bplayer\b/.test(market) || /\bplayer shots\b|\bshots by\b/.test(text)
  }
  return false
}

function marketAvailability(selections:Array<{market?:string;label?:string;kind:string}>, verified:boolean):MarketAvailability {
  const playerSelections = selections.filter(isPlayerPropSelection)
  const state = (kind:string):MarketAvailabilityState => playerSelections.some(s=>s.kind===kind) ? "available" : verified ? "unavailable" : "unknown"
  return {
    card:state("card"),
    foul:state("foul"),
    fouled:state("fouled"),
    shot:state("shot"),
    sot:state("sot"),
  }
}

async function cachedSnapshot(input:{date:string;home:string;away:string;competition:string}) {
  if (!isDatabaseConfigured) return null
  try {
    await ensureResearchSchema()
    const rows = await db.select().from(oddsSnapshots)
      .where(and(
        eq(oddsSnapshots.competition,input.competition),
        eq(oddsSnapshots.fixtureDate,input.date),
        eq(oddsSnapshots.homeTeam,input.home),
        eq(oddsSnapshots.awayTeam,input.away),
      ))
      .orderBy(desc(oddsSnapshots.capturedAt))
      .limit(1000)
    if (!rows.length) return null

    const latest = rows[0]
    const capturedAt = latest.capturedAt instanceof Date ? latest.capturedAt : new Date(latest.capturedAt)
    if (Number.isNaN(capturedAt.getTime())) return null
    const ageMs = Date.now() - capturedAt.getTime()
    if (ageMs > FREE_ODDS_CACHE_MS) return null

    const latestBucket = new Date(latest.snapshotBucket).getTime()
    const sameBucket = rows.filter(row =>
      row.bookmaker === latest.bookmaker &&
      new Date(row.snapshotBucket).getTime() === latestBucket
    )
    const rawSelections = sameBucket.map(row => ({
      market:row.market,
      kind:row.kind,
      label:row.label,
      odd:Number(row.odds),
    }))
    const selections = await attachMovement({
      date:input.date,
      home:input.home,
      away:input.away,
      competition:input.competition,
      bookmaker:latest.bookmaker,
      selections:rawSelections,
    })
    return {
      connected:true,
      bookmaker:latest.bookmaker,
      source:(latest.source ?? "free odds feed")+" · cache",
      capturedAt:capturedAt.toISOString(),
      selections,
      priceAvailable:selections.length>0,
      freeTier:true,
      cached:true,
      maxUsableAgeSeconds:10800,
      marketAvailability:marketAvailability(selections,true),
    }
  } catch {
    return null
  }
}

function marketKind(name: string) {
  const n = norm(name)
  if (/shot.*target|target.*shot/.test(n)) return "sot"
  if (/fouled|fouls won|fouls drawn/.test(n)) return "fouled"
  if (/foul/.test(n)) return "foul"
  if (/card|book/.test(n)) return "card"
  if (/shot/.test(n)) return "shot"
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

  if (!date || !home || !away) {
    return NextResponse.json({ connected: false, selections: [], error: "Invalid fixture parameters" }, { status: 400 })
  }

  try {
    // Free-tier policy: reuse a recent stored bookmaker snapshot before spending API quota.
    const cached = await cachedSnapshot({ date, home, away, competition })
    if (cached) return NextResponse.json(cached)

    // API-Football remains the free bookmaker-data fallback where the free plan supports the league.
    const apiKey = process.env.API_FOOTBALL_KEY
    if (apiKey && LEAGUE_IDS[competition]) {
      try {
        const fallback = await fromApiFootball({ date, home, away, competition, key: apiKey })
        if (fallback) {
          await saveSnapshots({
            date, home, away, competition,
            bookmaker:fallback.bookmaker,
            source:fallback.source,
            capturedAt:fallback.capturedAt,
            selections:fallback.selections,
          })
          const selections = await attachMovement({
            date, home, away, competition,
            bookmaker:fallback.bookmaker,
            selections:fallback.selections,
          })
          return NextResponse.json({
            ...fallback,
            selections,
            priceAvailable:selections.length > 0,
            freeTier:true,
            cached:false,
            maxUsableAgeSeconds:10800,
            marketAvailability:marketAvailability(selections,true),
          })
        }
      } catch (error) {
        console.log("[bet-builder-odds] free API-Football fallback:", error instanceof Error ? error.message : error)
      }
    }

    // No paid odds dependency is required. The prediction engine still works from calibrated fair odds.
    return NextResponse.json({
      connected:Boolean(apiKey && LEAGUE_IDS[competition]),
      bookmaker:"Bet365",
      source:apiKey && LEAGUE_IDS[competition] ? "API-Football free tier" : null,
      selections:[],
      priceAvailable:false,
      freeTier:true,
      cached:false,
      maxUsableAgeSeconds:10800,
      marketAvailability:marketAvailability([],false),
      note:"No free bookmaker player-prop snapshot is available for this fixture. Model probabilities and fair odds remain available.",
    })
  } catch (error) {
    console.log("[bet-builder-odds]", error instanceof Error ? error.message : error)
    return NextResponse.json({
      connected:false,
      bookmaker:"Bet365",
      selections:[],
      priceAvailable:false,
      freeTier:true,
      marketAvailability:marketAvailability([],false),
    })
  }
}
