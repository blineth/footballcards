import { NextResponse } from "next/server"
import { and, inArray, lt } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { playerH2H } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { GET as radarGET } from "../fixture-radar/route"
import { GET as oddsGET } from "../bet-builder-odds/route"
import calibrationSnapshot from "@/data/model/calibration.json"

export const dynamic = "force-dynamic"
export const revalidate = 0

type MarketKey = "foul1" | "foul2" | "foul3" | "fouled1" | "card" | "shot1" | "shot2" | "sot1" | "sot2"
type MatchRow = typeof playerH2H.$inferSelect
type MarketAvailabilityState = "available" | "unavailable" | "unknown"
type MarketAvailability = Record<"card"|"foul"|"fouled"|"shot"|"sot", MarketAvailabilityState>

type OddSelection = {
  market: string
  kind: string
  label: string
  odd: number | null
  previousOdd?: number | null
  movement?: number | null
}

type ScoreMarket = {
  key: MarketKey
  label: string
  probability: number
  rawProbability: number
  calibrationSample: number | null
  fairOdds: number | null
  confidence: "A" | "B" | "C" | "D"
  bookmakerOdds: number | null
  previousBookmakerOdds: number | null
  bookmakerMovement: number | null
  bookmakerLabel: string | null
  impliedProbability: number | null
  edge: number | null
  expectedValue: number | null
  sampleMatches: number
  recent5HitRate: number
  seasonHitRate: number
  h2hHitRate: number | null
  reasons: string[]
}

type ScorePlayer = {
  name: string
  dbName: string
  team: string
  position: string | null
  sampleMatches: number
  sampleMinutes: number
  expectedMinutes: number
  matchup: { name: string; role?: string | null; fouled90?: number | null } | null
  yellowConditionals: {
    overall: { matches: number; yellows: number; rate: number }
    zeroFouls: { matches: number; yellows: number; rate: number | null }
    exactly1Foul: { matches: number; yellows: number; rate: number | null }
    exactly2Fouls: { matches: number; yellows: number; rate: number | null }
    threePlusFouls: { matches: number; yellows: number; rate: number | null }
    after1PlusFouls: { matches: number; yellows: number; rate: number | null }
    after2PlusFouls: { matches: number; yellows: number; rate: number | null }
    after3PlusFouls: { matches: number; yellows: number; rate: number | null }
  }
  markets: Record<MarketKey, ScoreMarket>
}

type SlipLeg = {
  player: string
  team: string
  market: MarketKey
  label: string
  probability: number
  fairOdds: number | null
  bookmakerOdds: number | null
  previousBookmakerOdds: number | null
  bookmakerMovement: number | null
  edge: number | null
  expectedValue: number | null
  confidence: "A" | "B" | "C" | "D"
  reason: string
}

type FoulTargetSlip = {
  id: string
  targetFractional: string
  targetDecimal: number
  legs: SlipLeg[]
  referenceProductOdds: number | null
  averageLegProbability: number | null
  minimumLegProbability: number | null
  pricedLegs: number
  usesLivePrices: boolean
  withinTargetRange: boolean
  note: string
}

const MARKET_LABELS: Record<MarketKey, string> = {
  foul1: "1+ foul committed",
  foul2: "2+ fouls committed",
  foul3: "3+ fouls committed",
  fouled1: "1+ foul drawn",
  card: "Yellow card",
  shot1: "1+ shot",
  shot2: "2+ shots",
  sot1: "1+ shot on target",
  sot2: "2+ shots on target",
}

const PRIOR: Record<MarketKey, number> = {
  foul1: 0.70,
  foul2: 0.38,
  foul3: 0.17,
  fouled1: 0.62,
  card: 0.22,
  shot1: 0.62,
  shot2: 0.36,
  sot1: 0.34,
  sot2: 0.12,
}

function clamp(value: number, min = 0.01, max = 0.99) {
  return Math.max(min, Math.min(max, value))
}
function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function played(row: MatchRow) {
  return Number(row.minutes ?? 0) > 0
}
function starterRows(rows: MatchRow[]) {
  const starters = rows.filter(row => row.starter === true)
  return starters.length >= 3 ? starters : rows
}
function hit(market: MarketKey, row: MatchRow) {
  if (market === "foul1") return Number(row.foulsCommitted ?? 0) >= 1
  if (market === "foul2") return Number(row.foulsCommitted ?? 0) >= 2
  if (market === "foul3") return Number(row.foulsCommitted ?? 0) >= 3
  if (market === "fouled1") return Number(row.foulsDrawn ?? 0) >= 1
  if (market === "card") return row.yellowCard === true
  if (market === "shot1") return Number(row.shots ?? 0) >= 1
  if (market === "shot2") return Number(row.shots ?? 0) >= 2
  if (market === "sot1") return Number(row.shotsOnTarget ?? 0) >= 1
  return Number(row.shotsOnTarget ?? 0) >= 2
}
function hitRate(rows: MatchRow[], market: MarketKey) {
  if (!rows.length) return 0
  return rows.filter(row => hit(market, row)).length / rows.length
}
function betaSmoothed(hits: number, total: number, prior: number, priorStrength = 6) {
  return (hits + prior * priorStrength) / (total + priorStrength)
}
function empiricalProbability(rows: MatchRow[], market: MarketKey) {
  const ordered = [...rows].sort((a, b) => String(a.matchDate).localeCompare(String(b.matchDate)))
  const recent5 = ordered.slice(-5)
  const recent10 = ordered.slice(-10)
  const allHits = ordered.filter(row => hit(market, row)).length
  const all = betaSmoothed(allHits, ordered.length, PRIOR[market], 6)
  const ten = betaSmoothed(recent10.filter(row => hit(market, row)).length, recent10.length, all, 5)
  const five = betaSmoothed(recent5.filter(row => hit(market, row)).length, recent5.length, ten, 4)
  return clamp(all * 0.48 + ten * 0.27 + five * 0.25)
}
function poissonAtLeast(lambda: number, threshold: number) {
  if (!(lambda > 0)) return 0
  let cumulative = 0
  for (let k = 0; k < threshold; k += 1) {
    let factorial = 1
    for (let i = 2; i <= k; i += 1) factorial *= i
    cumulative += Math.exp(-lambda) * Math.pow(lambda, k) / factorial
  }
  return clamp(1 - cumulative)
}
function blend(base: number, other: number | null, weight: number) {
  if (other == null || !Number.isFinite(other) || weight <= 0) return base
  return clamp(base * (1 - weight) + other * weight)
}
function logitAdjust(probability: number, delta: number) {
  const p = clamp(probability, 0.02, 0.98)
  const logit = Math.log(p / (1 - p)) + delta
  return clamp(1 / (1 + Math.exp(-logit)))
}
function conditional(rows: MatchRow[], foulThreshold: number) {
  const subset = rows.filter(row => Number(row.foulsCommitted ?? 0) >= foulThreshold)
  if (!subset.length) return { matches: 0, yellows: 0, rate: null as number | null }
  const yellows = subset.filter(row => row.yellowCard === true).length
  return { matches: subset.length, yellows, rate: yellows / subset.length }
}
function conditionalExact(rows: MatchRow[], predicate: (fouls: number) => boolean) {
  const subset = rows.filter(row => predicate(Number(row.foulsCommitted ?? 0)))
  if (!subset.length) return { matches: 0, yellows: 0, rate: null as number | null }
  const yellows = subset.filter(row => row.yellowCard === true).length
  return { matches: subset.length, yellows, rate: yellows / subset.length }
}
type CalibrationBand = { from:number; to:number; sample:number; hits:number; calibratedProbability:number }
function calibrationFor(competition: string, market: MarketKey, rawProbability: number) {
  const snapshot:any = calibrationSnapshot as any
  const leagueMarket = snapshot?.competitions?.[competition]?.[market]
  const globalMarket = snapshot?.global?.[market]
  const source = leagueMarket?.bands?.length === 20 ? leagueMarket : globalMarket
  const bands:CalibrationBand[] = Array.isArray(source?.bands) ? source.bands : []
  if (!bands.length) return { probability: rawProbability, sample: null as number | null }
  const index = Math.max(0, Math.min(19, Math.floor(clamp(rawProbability,0,0.999999)/0.05)))
  const band = bands[index]
  const probability = Number(band?.calibratedProbability)
  return {
    probability: Number.isFinite(probability) ? clamp(probability) : rawProbability,
    sample: Number.isFinite(Number(source?.sample)) ? Number(source.sample) : null,
  }
}
function confidenceGrade(input: { matches: number; minutes: number; confirmed: boolean; matchup: boolean; h2h: number }) {
  let score = Math.min(45, input.matches * 2.5)
  score += Math.min(15, input.minutes / 120)
  if (input.confirmed) score += 20
  if (input.matchup) score += 10
  if (input.h2h >= 2) score += 5
  if (score >= 82) return "A" as const
  if (score >= 66) return "B" as const
  if (score >= 50) return "C" as const
  return "D" as const
}
function thresholdForMarket(market: MarketKey) {
  if (market.endsWith("3")) return 3
  if (market.endsWith("2")) return 2
  return 1
}

function availabilityForMarket(availability:MarketAvailability, market:MarketKey):MarketAvailabilityState {
  if (market === "card") return availability.card
  if (market.startsWith("fouled")) return availability.fouled
  if (market.startsWith("foul")) return availability.foul
  if (market.startsWith("sot")) return availability.sot
  return availability.shot
}
function oddsKind(market: MarketKey) {
  if (market.startsWith("fouled")) return "fouled"
  if (market.startsWith("foul")) return "foul"
  if (market === "card") return "card"
  if (market.startsWith("sot")) return "sot"
  return "shot"
}
function playerInLabel(selection: OddSelection, player: string) {
  const hay = norm(selection.market + " " + selection.label)
  const p = norm(player)
  const surname = p.split(" ").at(-1) ?? p
  return Boolean(p && (hay.includes(p) || (surname.length >= 4 && hay.includes(surname))))
}
function selectionThreshold(selection: OddSelection) {
  const raw = (selection.market + " " + selection.label).toLowerCase()
  const plus = raw.match(/(?:^|\s)([123])\s*\+/)
  if (plus) return Number(plus[1])
  const over = raw.match(/over\s*([012])(?:\.5)?/)
  if (over) return Number(over[1]) + 1
  return null
}
function findOdds(selections: OddSelection[], player: string, market: MarketKey) {
  const desiredKind = oddsKind(market)
  const threshold = thresholdForMarket(market)
  const candidates = selections
    .filter(s => s.odd != null && Number(s.odd) > 1 && s.kind === desiredKind && playerInLabel(s, player))
    .map(s => ({ ...s, detectedThreshold: selectionThreshold(s) }))
    .filter(s => market === "card" || s.detectedThreshold == null || s.detectedThreshold === threshold)
    .sort((a, b) => Number(b.odd ?? 0) - Number(a.odd ?? 0))
  return candidates[0] ?? null
}
function fairOdds(probability: number) {
  return probability > 0 ? Math.round((1 / probability) * 100) / 100 : null
}
function marketReasons(input: {
  market: MarketKey
  probability: number
  recent5: number
  season: number
  h2hRate: number | null
  h2hN: number
  matchupName?: string | null
  matchupFouled90?: number | null
  conditional2?: { matches: number; yellows: number; rate: number | null }
}) {
  const reasons: string[] = []
  if (input.recent5 >= input.season + 0.12) reasons.push("Recent form is above longer-run rate")
  if (input.season >= 0.65 && input.market !== "card") reasons.push("Strong historical hit rate")
  if (input.market === "card" && input.conditional2 && input.conditional2.matches >= 3 && Number(input.conditional2.rate ?? 0) >= 0.45) {
    reasons.push("Booked in " + input.conditional2.yellows + "/" + input.conditional2.matches + " matches with 2+ fouls")
  }
  if (input.h2hRate != null && input.h2hN >= 2 && input.h2hRate >= 0.5) reasons.push("Strong H2H hit pattern")
  if ((input.market === "foul1" || input.market === "foul2" || input.market === "foul3" || input.market === "card") && input.matchupName) {
    const extra = input.matchupFouled90 != null ? " (" + Number(input.matchupFouled90).toFixed(2) + " fouls drawn/90)" : ""
    reasons.push("Direct pressure from " + input.matchupName + extra)
  }
  if (!reasons.length) reasons.push("Probability led by player history and recent matches")
  return reasons.slice(0, 3)
}

function marketLeg(player: ScorePlayer, market: MarketKey): SlipLeg {
  const m = player.markets[market]
  return {
    player: player.name,
    team: player.team,
    market,
    label: m.label,
    probability: m.probability,
    fairOdds: m.fairOdds,
    bookmakerOdds: m.bookmakerOdds,
    previousBookmakerOdds: m.previousBookmakerOdds,
    bookmakerMovement: m.bookmakerMovement,
    edge: m.edge,
    expectedValue: m.expectedValue,
    confidence: m.confidence,
    reason: m.reasons[0] ?? "",
  }
}
function legRank(leg: SlipLeg) {
  const confidenceBonus = leg.confidence === "A" ? 0.08 : leg.confidence === "B" ? 0.05 : leg.confidence === "C" ? 0.02 : 0
  const edgeBonus = Math.max(0, Number(leg.edge ?? 0)) * 0.35
  return leg.probability + confidenceBonus + edgeBonus
}
function bestLeg(players: ScorePlayer[], market: MarketKey, used = new Set<string>()) {
  return players
    .map(player => marketLeg(player, market))
    .filter(leg => !used.has(norm(leg.player)) && leg.confidence !== "D")
    .filter(leg => leg.expectedValue == null || leg.expectedValue >= -0.08)
    .sort((a, b) => legRank(b) - legRank(a))[0] ?? null
}
function makeSlip(id: string, title: string, risk: string, legs: SlipLeg[], note: string) {
  return {
    id,
    title,
    risk,
    legs,
    combinedOdds: null,
    averageLegProbability: legs.length ? Math.round((legs.reduce((s, leg) => s + leg.probability, 0) / legs.length) * 1000) / 1000 : null,
    note: note + " Same-match Bet Builder legs are not multiplied into a fake combined price; an explicit bookmaker combo price is required.",
  }
}

function referenceOdd(leg: SlipLeg) {
  return Number(leg.bookmakerOdds ?? leg.fairOdds ?? (leg.probability > 0 ? 1 / leg.probability : 0))
}
function buildFoulTargetSlips(players: ScorePlayer[]): FoulTargetSlip[] {
  const targets = [
    { id:"foul-3-1", fractional:"3/1", decimal:4, minProbability:0.66 },
    { id:"foul-10-1", fractional:"10/1", decimal:11, minProbability:0.62 },
    { id:"foul-20-1", fractional:"20/1", decimal:21, minProbability:0.58 },
    { id:"foul-50-1", fractional:"50/1", decimal:51, minProbability:0.54 },
    { id:"foul-100-1", fractional:"100/1", decimal:101, minProbability:0.50 },
  ] as const

  const pool = players
    .map(player => marketLeg(player, "foul1"))
    .filter(leg => leg.confidence !== "D")
    .filter(leg => Number.isFinite(referenceOdd(leg)) && referenceOdd(leg) > 1)
    .sort((a,b) => {
      const qualityA = a.probability + Math.max(0, Number(a.edge ?? 0)) * 0.25
      const qualityB = b.probability + Math.max(0, Number(b.edge ?? 0)) * 0.25
      return qualityB - qualityA
    })

  return targets.map(target => {
    const candidates = pool.filter(leg => leg.probability >= target.minProbability)
    type State = { legs:SlipLeg[]; product:number; teamCounts:Record<string,number>; quality:number }
    let states:State[] = [{legs:[], product:1, teamCounts:{}, quality:0}]

    for (const leg of candidates) {
      const next = [...states]
      for (const state of states) {
        if (state.legs.length >= 12) continue
        const count = state.teamCounts[leg.team] ?? 0
        if (count >= 6) continue
        if (state.legs.some(existing => existing.player === leg.player)) continue
        const product = state.product * referenceOdd(leg)
        if (product > target.decimal * 2.25 && state.legs.length >= 2) continue
        next.push({
          legs:[...state.legs, leg],
          product,
          teamCounts:{...state.teamCounts,[leg.team]:count+1},
          quality:state.quality + leg.probability,
        })
      }
      states = next
        .filter(state => state.legs.length <= 12)
        .sort((a,b) => {
          const score = (state:State) => {
            if (!state.legs.length) return Number.POSITIVE_INFINITY
            const distance = Math.abs(Math.log(Math.max(1.01,state.product)) - Math.log(target.decimal))
            const avg = state.quality / state.legs.length
            const underPenalty = state.product < target.decimal * 0.72 ? 0.7 : 0
            return distance * 1.7 + underPenalty - avg * 0.55
          }
          return score(a)-score(b)
        })
        .slice(0,180)
    }

    const viable = states
      .filter(state => state.legs.length >= 2)
      .sort((a,b) => {
        const distanceA = Math.abs(Math.log(a.product)-Math.log(target.decimal))
        const distanceB = Math.abs(Math.log(b.product)-Math.log(target.decimal))
        const avgA = a.quality/a.legs.length
        const avgB = b.quality/b.legs.length
        return (distanceA*1.8-avgA*0.5)-(distanceB*1.8-avgB*0.5)
      })
    const best = viable[0]
    if (!best) {
      return {
        id:target.id,
        targetFractional:target.fractional,
        targetDecimal:target.decimal,
        legs:[],
        referenceProductOdds:null,
        averageLegProbability:null,
        minimumLegProbability:null,
        pricedLegs:0,
        usesLivePrices:false,
        withinTargetRange:false,
        note:"Not enough qualifying 1+ foul selections for this target while respecting Bet365's 12-selection and six-players-per-team limits.",
      }
    }

    const pricedLegs = best.legs.filter(leg=>leg.bookmakerOdds!=null).length
    const avg = best.legs.reduce((s,l)=>s+l.probability,0)/best.legs.length
    const min = Math.min(...best.legs.map(l=>l.probability))
    const within = best.product >= target.decimal*0.72 && best.product <= target.decimal*1.45
    return {
      id:target.id,
      targetFractional:target.fractional,
      targetDecimal:target.decimal,
      legs:best.legs,
      referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:Math.round(avg*1000)/1000,
      minimumLegProbability:Math.round(min*1000)/1000,
      pricedLegs,
      usesLivePrices:pricedLegs===best.legs.length,
      withinTargetRange:within,
      note:"Built from calibrated 1+ foul probabilities, with a maximum of 12 selections and no more than six players from either team. The reference product uses individual live prices where available, otherwise fair odds. Bet365's actual Bet Builder price is correlation-adjusted and must be taken from the bookmaker rather than by multiplying these legs.",
    }
  })
}

function buildSlips(players: ScorePlayer[]) {
  const used = new Set<string>()
  const safeMarkets: MarketKey[] = ["foul1", "fouled1", "shot1", "sot1", "card"]
  const safe: SlipLeg[] = []
  for (const market of safeMarkets) {
    const leg = bestLeg(players, market, used)
    if (leg) {
      safe.push(leg)
      used.add(norm(leg.player))
    }
  }

  const cardLegs = players.map(player => marketLeg(player, "card")).filter(leg => leg.confidence !== "D").filter(leg => leg.expectedValue == null || leg.expectedValue >= -0.08).sort((a, b) => legRank(b) - legRank(a))
  const twoCard = cardLegs.slice(0, 2)
  const threeCard = cardLegs.slice(0, 3)

  const comboPlayers = [...players].sort((a, b) => {
    const aScore = a.markets.card.probability * 0.55 + a.markets.foul1.probability * 0.45
    const bScore = b.markets.card.probability * 0.55 + b.markets.foul1.probability * 0.45
    return bScore - aScore
  }).filter(p => p.markets.card.confidence !== "D").slice(0, 2)
  const yellowFoul = comboPlayers.flatMap(player => [marketLeg(player, "foul1"), marketLeg(player, "card")])

  const pressurePool = players.flatMap(player => [marketLeg(player, "foul2"), marketLeg(player, "sot1"), marketLeg(player, "shot2")])
    .filter(leg => leg.confidence !== "D")
    .filter(leg => leg.expectedValue == null || leg.expectedValue >= -0.08)
    .sort((a, b) => legRank(b) - legRank(a))
  const mixed: SlipLeg[] = []
  const mixedPlayers = new Set<string>()
  for (const leg of pressurePool) {
    if (mixed.length >= 5) break
    if (mixedPlayers.has(norm(leg.player))) continue
    mixed.push(leg)
    mixedPlayers.add(norm(leg.player))
  }

  return [
    makeSlip("main-safe", "Main safer mix", "Lower", safe, "One high-ranked leg from fouls committed, fouls drawn, shots, SOT and cards. Player duplicates are avoided."),
    makeSlip("two-cards", "2-card builder", "Medium", twoCard, "Two highest-rated yellow-card candidates from the confirmed starters."),
    makeSlip("three-cards", "3-card builder", "Higher", threeCard, "Three highest-rated yellow-card candidates. Higher return, materially higher variance."),
    makeSlip("yellow-foul", "Yellow + foul pressure", "Higher", yellowFoul, "Pairs 1+ foul with a yellow for the same high-pressure players. These legs are correlated, so their probabilities should not be multiplied as if independent."),
    makeSlip("fouls-shots", "Fouls + shots mix", "Medium", mixed, "Best 2+ foul, 2+ shot and 1+ SOT opportunities, limited to one leg per player."),
  ]
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"
  if (!date || !home || !away) return NextResponse.json({ ok: false, error: "Invalid fixture parameters" }, { status: 400 })
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected" }, { status: 503 })

  await ensureResearchSchema()
  const radarResponse = await radarGET(request)
  if (!radarResponse.ok) return radarResponse
  const radar = await radarResponse.json()
  const candidates: any[] = Array.isArray(radar?.candidates) ? radar.candidates : []
  const names = Array.from(new Set(candidates.map(c => String(c.dbName ?? "")).filter(Boolean))) as string[]

  let odds: any = { selections: [], priceAvailable: false }
  try {
    const oddsResponse = await oddsGET(request)
    if (oddsResponse.ok) odds = await oddsResponse.json()
  } catch {}
  const selections: OddSelection[] = Array.isArray(odds?.selections) ? odds.selections : []
  const oddsCapturedAt = odds?.capturedAt ? String(odds.capturedAt) : null
  const capturedMs = oddsCapturedAt ? new Date(oddsCapturedAt).getTime() : Number.NaN
  const oddsAgeSeconds = Number.isFinite(capturedMs) ? Math.max(0, Math.round((Date.now() - capturedMs) / 1000)) : null
  const maxUsableAgeSeconds = Math.max(300, Number(odds?.maxUsableAgeSeconds ?? 300))
  const oddsFreshness = oddsAgeSeconds == null
    ? "UNKNOWN"
    : oddsAgeSeconds < 120
      ? "LIVE"
      : oddsAgeSeconds < maxUsableAgeSeconds
        ? (odds?.cached ? "CACHED" : "SLIGHTLY STALE")
        : "STALE"
  const usableSelections = oddsFreshness === "STALE" ? [] : selections
  const marketAvailability:MarketAvailability = {
    card: odds?.marketAvailability?.card ?? "unknown",
    foul: odds?.marketAvailability?.foul ?? "unknown",
    fouled: odds?.marketAvailability?.fouled ?? "unknown",
    shot: odds?.marketAvailability?.shot ?? "unknown",
    sot: odds?.marketAvailability?.sot ?? "unknown",
  }

  const history = names.length
    ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), lt(playerH2H.matchDate, date)))
    : []

  const confirmed = radar?.lineupsConfirmed === true
  const players: ScorePlayer[] = candidates.map(candidate => {
    const allRows = history.filter(row => row.playerName === candidate.dbName && played(row))
    const rows = confirmed ? starterRows(allRows) : allRows
    const opponent = teamMatch(candidate.team, home) ? away : home
    const h2hRows = rows.filter(row => teamMatch(row.opponent, opponent))
    const recent5Rows = [...rows].sort((a, b) => String(a.matchDate).localeCompare(String(b.matchDate))).slice(-5)
    const sampleMinutes = rows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const expectedMinutes = confirmed
      ? Math.round(Math.max(55, Math.min(90, rows.filter(r => r.starter === true).reduce((s, r) => s + Number(r.minutes ?? 0), 0) / Math.max(1, rows.filter(r => r.starter === true).length) || 80)))
      : Math.round(Math.max(35, Math.min(90, sampleMinutes / Math.max(1, rows.length) || 70)))

    const matchupCandidate = candidates.find(other => norm(other.name) === norm(candidate?.likelyMatchup?.name) || norm(other.dbName) === norm(candidate?.likelyMatchup?.name))
    const matchupFouls90 = Number(matchupCandidate?.fouls90 ?? 0)
    const matchupFouled90 = candidate?.likelyMatchup?.fouled90 == null ? null : Number(candidate.likelyMatchup.fouled90)

    const yellowOverall = rows.filter(row => row.yellowCard === true).length
    const cond0 = conditionalExact(rows, fouls => fouls === 0)
    const condExact1 = conditionalExact(rows, fouls => fouls === 1)
    const condExact2 = conditionalExact(rows, fouls => fouls === 2)
    const cond3Plus = conditionalExact(rows, fouls => fouls >= 3)
    const cond1 = conditional(rows, 1)
    const cond2 = conditional(rows, 2)
    const cond3 = conditional(rows, 3)
    const confidence = confidenceGrade({ matches: rows.length, minutes: sampleMinutes, confirmed, matchup: Boolean(candidate?.likelyMatchup?.name), h2h: h2hRows.length })

    const markets = {} as Record<MarketKey, ScoreMarket>
    const keys = Object.keys(MARKET_LABELS) as MarketKey[]

    for (const market of keys) {
      let probability = empiricalProbability(rows, market)
      const recent5HitRate = hitRate(recent5Rows, market)
      const seasonHitRate = hitRate(rows, market)
      const h2hHitRate = h2hRows.length ? hitRate(h2hRows, market) : null
      const h2hWeight = Math.min(0.18, h2hRows.length / 30)
      probability = blend(probability, h2hHitRate, h2hWeight)

      const threshold = thresholdForMarket(market)
      const minutesScale = expectedMinutes / 90
      const per90 = market.startsWith("sot")
        ? Number(candidate.shotsOnTarget90 ?? 0)
        : market.startsWith("shot")
          ? Number(candidate.shots90 ?? 0)
          : market.startsWith("fouled")
            ? Number(candidate.fouled90 ?? 0)
            : market.startsWith("foul")
              ? Number(candidate.fouls90 ?? 0)
              : 0

      if (market !== "card" && per90 > 0) {
        const poisson = poissonAtLeast(per90 * minutesScale, threshold)
        const poissonWeight = rows.length < 5 ? 0.42 : rows.length < 10 ? 0.28 : 0.16
        probability = blend(probability, poisson, poissonWeight)
      }

      if (market === "foul1" || market === "foul2" || market === "foul3") {
        if (matchupFouled90 != null && matchupFouled90 > 0) probability = logitAdjust(probability, (matchupFouled90 - 1.35) * 0.14)
      }
      if (market === "fouled1" && matchupFouls90 > 0) {
        probability = logitAdjust(probability, (matchupFouls90 - 1.35) * 0.12)
      }
      if (market === "card") {
        const overallRate = rows.length ? yellowOverall / rows.length : PRIOR.card
        const foul1Probability = empiricalProbability(rows, "foul1")
        const foul2Probability = empiricalProbability(rows, "foul2")
        const foul3Probability = empiricalProbability(rows, "foul3")
        const behaviourAdjustments = [
          { bucket: cond1, probability: foul1Probability, weight: 0.12, reliabilityMatches: 10 },
          { bucket: cond2, probability: foul2Probability, weight: 0.28, reliabilityMatches: 8 },
          { bucket: condExact2, probability: Math.max(0, foul2Probability - foul3Probability), weight: 0.18, reliabilityMatches: 6 },
          { bucket: cond3Plus, probability: foul3Probability, weight: 0.24, reliabilityMatches: 5 },
        ]
        for (const item of behaviourAdjustments) {
          if (item.bucket.rate == null) continue
          const reliability = Math.min(1, item.bucket.matches / item.reliabilityMatches)
          probability += (item.bucket.rate - overallRate) * item.probability * reliability * item.weight
        }
        probability = clamp(probability)
        if (matchupFouled90 != null && matchupFouled90 > 0) probability = logitAdjust(probability, (matchupFouled90 - 1.35) * 0.08)
        const refYellows = Number(radar?.referee?.yellowsPerGame ?? 0)
        if (refYellows > 0) probability = logitAdjust(probability, (refYellows - 4.2) * 0.055)
      }

      const rawProbability = probability
      const calibrated = calibrationFor(competition, market, rawProbability)
      probability = calibrated.probability

      const odd = findOdds(usableSelections, candidate.name, market)
      const bookmakerOdds = odd?.odd == null ? null : Number(odd.odd)
      const previousBookmakerOdds = odd?.previousOdd == null ? null : Number(odd.previousOdd)
      const bookmakerMovement = odd?.movement == null ? null : Number(odd.movement)
      const impliedProbability = bookmakerOdds ? 1 / bookmakerOdds : null
      const edge = impliedProbability == null ? null : probability - impliedProbability
      const expectedValue = bookmakerOdds == null ? null : probability * bookmakerOdds - 1

      markets[market] = {
        key: market,
        label: MARKET_LABELS[market],
        probability: Math.round(probability * 1000) / 1000,
        rawProbability: Math.round(rawProbability * 1000) / 1000,
        calibrationSample: calibrated.sample,
        fairOdds: fairOdds(probability),
        confidence,
        bookmakerOdds,
        previousBookmakerOdds,
        bookmakerMovement,
        bookmakerLabel: odd?.label ?? null,
        impliedProbability: impliedProbability == null ? null : Math.round(impliedProbability * 1000) / 1000,
        edge: edge == null ? null : Math.round(edge * 1000) / 1000,
        expectedValue: expectedValue == null ? null : Math.round(expectedValue * 1000) / 1000,
        sampleMatches: rows.length,
        recent5HitRate: Math.round(recent5HitRate * 1000) / 1000,
        seasonHitRate: Math.round(seasonHitRate * 1000) / 1000,
        h2hHitRate: h2hHitRate == null ? null : Math.round(h2hHitRate * 1000) / 1000,
        reasons: marketReasons({
          market,
          probability,
          recent5: recent5HitRate,
          season: seasonHitRate,
          h2hRate: h2hHitRate,
          h2hN: h2hRows.length,
          matchupName: candidate?.likelyMatchup?.name ?? null,
          matchupFouled90,
          conditional2: cond2,
        }),
      }
    }

    return {
      name: candidate.name,
      dbName: candidate.dbName,
      team: candidate.team,
      position: candidate.position ?? null,
      sampleMatches: rows.length,
      sampleMinutes,
      expectedMinutes,
      matchup: candidate?.likelyMatchup ? { name: candidate.likelyMatchup.name, role: candidate.likelyMatchup.role ?? null, fouled90: matchupFouled90 } : null,
      yellowConditionals: {
        overall: { matches: rows.length, yellows: yellowOverall, rate: rows.length ? Math.round((yellowOverall / rows.length) * 1000) / 1000 : 0 },
        zeroFouls: cond0,
        exactly1Foul: condExact1,
        exactly2Fouls: condExact2,
        threePlusFouls: cond3Plus,
        after1PlusFouls: cond1,
        after2PlusFouls: cond2,
        after3PlusFouls: cond3,
      },
      markets,
    }
  }).sort((a, b) => b.markets.foul1.probability - a.markets.foul1.probability)

  const allSlips = confirmed ? buildSlips(players) : []
  const slips = allSlips.map(slip => ({
    ...slip,
    placeable: slip.legs.every(leg => availabilityForMarket(marketAvailability, leg.market) === "available"),
    marketAvailability: slip.legs.map(leg => ({
      player: leg.player,
      market: leg.market,
      status: availabilityForMarket(marketAvailability, leg.market),
    })),
  }))
  const foulTargetSlips = (confirmed ? buildFoulTargetSlips(players) : []).map(slip => ({
    ...slip,
    placeable: slip.legs.length > 0 && marketAvailability.foul === "available",
    marketStatus: marketAvailability.foul,
  }))

  return NextResponse.json({
    ok: true,
    competition,
    date,
    home,
    away,
    lineupsConfirmed: confirmed,
    status: confirmed ? "confirmed-lineup-scorecard" : "pre-lineup-research",
    bookmaker: odds?.bookmaker ?? null,
    oddsSource: odds?.source ?? null,
    oddsCapturedAt,
    oddsAgeSeconds,
    oddsFreshness,
    freeTier: odds?.freeTier !== false,
    marketAvailability,
    priceAvailable: Boolean(odds?.priceAvailable) && oddsFreshness !== "STALE",
    referee: radar?.referee ?? null,
    playerCount: players.length,
    players,
    slips,
    foulTargetSlips,
    methodology: {
      version: "scorecard-v2-calibrated",
      description: "Player-level pre-match probabilities use only match rows dated before the target fixture. They combine smoothed historical hit rates, recency, H2H, expected minutes, direct matchup pressure, count-rate cross-checks, referee/card context and walk-forward calibration.",
      cardConditional: "Yellow-card estimates measure each player's booking rate at 0 fouls, exactly 1, exactly 2, 3+, 1+ and 2+ foul states, with sample-size reliability. Match-level data still cannot identify the exact foul that triggered the booking.",
      calibrationWarning: "Displayed probabilities are adjusted through walk-forward calibration built from earlier-match-only predictions across 30 competitions. They remain estimates, not guarantees.",
      slipWarning: "Same-player and same-match legs can be correlated. Combined slip probability is deliberately not calculated by multiplying leg probabilities.",
      priceFreshness: "Free-tier bookmaker snapshots are cached to protect API quotas. Fresh snapshots under two minutes are LIVE; recent cached snapshots remain usable for market availability and reference pricing until their free-tier cache window expires.",
    },
    generatedAt: new Date().toISOString(),
  })
}
