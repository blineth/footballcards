import { NextResponse } from "next/server"
import { and, inArray, lt } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { playerH2H } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { GET as radarGET } from "../fixture-radar/route"
import { GET as oddsGET } from "../bet-builder-odds/route"
import calibrationSnapshot from "@/data/model/calibration.json"
import { buildSnapshotScorecard } from "@/lib/snapshot-scorecard"

export const dynamic = "force-dynamic"
export const revalidate = 0

type MarketKey = "goal1" | "assist1" | "foul1" | "foul2" | "foul3" | "foul4" | "foul5" | "fouled1" | "card" | "shot1" | "shot2" | "sot1" | "sot2"
type SlipMarketKey = MarketKey | `foul${number}`
type MatchRow = typeof playerH2H.$inferSelect
type MarketAvailabilityState = "available" | "unavailable" | "unknown"
type MarketAvailability = Record<"goal"|"assist"|"card"|"foul"|"fouled"|"shot"|"sot", MarketAvailabilityState>
type BookmakerAvailability = Record<string,MarketAvailability>

type OddSelection = {
  market: string
  kind: string
  label: string
  odd: number | null
  underOdd?: number | null
  noVigProbability?: number | null
  bookmaker?: string | null
  previousOdd?: number | null
  movement?: number | null
}

type OfferedFoulLine = {
  threshold: number
  label: string
  bookmakerMarket: string
  bookmakerLabel: string
  bookmakerOdds: number
  bookmaker: string
  previousBookmakerOdds: number | null
  bookmakerMovement: number | null
  impliedProbability: number
  probability: number
  fairOdds: number | null
  edge: number
  expectedValue: number
  calibrated: boolean
  sampleMatches: number
  confidence: "A" | "B" | "C" | "D"
  priceSource: "exact" | "estimated"
}

type OfferedCardLine = {
  bookmaker:string
  bookmakerOdds:number
  bookmakerMarket:string
  bookmakerLabel:string
  probability:number
  fairOdds:number|null
  edge:number
  expectedValue:number
  confidence:"A"|"B"|"C"|"D"
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
  bookmakerName: string | null
  previousBookmakerOdds: number | null
  bookmakerMovement: number | null
  bookmakerLabel: string | null
  impliedProbability: number | null
  bookmakerNoVigProbability?: number | null
  edge: number | null
  expectedValue: number | null
  sampleMatches: number
  recent5HitRate: number
  seasonHitRate: number
  h2hHitRate: number | null
  h2hMatches: number
  h2hLineupOverlap: number | null
  sameMatchupMeetings: number
  recommendationScore?: number
  reasons: string[]
}

type ScorePlayer = {
  name: string
  dbName: string
  team: string
  lineupStatus: "confirmed" | "predicted" | "squad"
  lineupConfidence: string | null
  position: string | null
  sampleMatches: number
  sampleMinutes: number
  expectedMinutes: number
  matchup: { name: string; role?: string | null; fouled90?: number | null } | null
  h2hContext: {
    matches:number
    cards:number
    fouls:number
    fouled:number
    shots:number
    shotsOnTarget:number
    averageLineupOverlap:number|null
    sameMatchupMeetings:number
    sameMatchupCards:number
    sameMatchupFouls:number
  }
  cardContext?: {
    rolePrior:number
    clubMatches:number
    clubYellows:number
    clubCardRate:number|null
    clubCompetitions:string[]
  }
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
  offeredFoulLines: OfferedFoulLine[]
  likelyFoulLines: OfferedFoulLine[]
  offeredCardLines: OfferedCardLine[]
}

type SlipLeg = {
  player: string
  dbPlayerName?: string | null
  team: string
  market: SlipMarketKey
  label: string
  probability: number
  fairOdds: number | null
  bookmakerOdds: number | null
  bookmakerName: string | null
  previousBookmakerOdds: number | null
  bookmakerMovement: number | null
  edge: number | null
  expectedValue: number | null
  confidence: "A" | "B" | "C" | "D"
  reason: string
  priceSource?: "exact" | "estimated" | null
  bookmakerProbability?: number | null
}

type FoulTargetSlip = {
  id: string
  bookmaker: string | null
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
  goal1: "Anytime goalscorer",
  assist1: "1+ assist",
  foul1: "1+ foul committed",
  foul2: "2+ fouls committed",
  foul3: "3+ fouls committed",
  foul4: "4+ fouls committed",
  foul5: "5+ fouls committed",
  fouled1: "1+ foul drawn",
  card: "Yellow card",
  shot1: "1+ shot",
  shot2: "2+ shots",
  sot1: "1+ shot on target",
  sot2: "2+ shots on target",
}

const PRIOR: Record<MarketKey, number> = {
  goal1: 0.24,
  assist1: 0.16,
  foul1: 0.70,
  foul2: 0.38,
  foul3: 0.17,
  foul4: 0.055,
  foul5: 0.018,
  fouled1: 0.62,
  card: 0.22,
  shot1: 0.62,
  shot2: 0.36,
  sot1: 0.34,
  sot2: 0.12,
}

const INTERNATIONAL_COMPETITIONS=new Set([
  "International",
  "UEFA European Championship",
  "UEFA European Championship Qualifying",
  "UEFA Nations League",
  "FIFA World Cup",
  "FIFA World Cup Qualifying - UEFA",
  "FIFA World Cup Qualifying - CONMEBOL",
  "FIFA World Cup Qualifying - CONCACAF",
  "FIFA World Cup Qualifying - AFC",
  "FIFA World Cup Qualifying - CAF",
  "FIFA World Cup Qualifying - OFC",
  "International Friendly",
])
function isInternationalHistoryCompetition(value:unknown){
  return INTERNATIONAL_COMPETITIONS.has(String(value??""))
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
  if (market === "goal1") return Number(row.goals ?? 0) >= 1
  if (market === "assist1") return Number(row.assists ?? 0) >= 1
  if (market === "foul1") return Number(row.foulsCommitted ?? 0) >= 1
  if (market === "foul2") return Number(row.foulsCommitted ?? 0) >= 2
  if (market === "foul3") return Number(row.foulsCommitted ?? 0) >= 3
  if (market === "foul4") return Number(row.foulsCommitted ?? 0) >= 4
  if (market === "foul5") return Number(row.foulsCommitted ?? 0) >= 5
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
function rowDate(row:MatchRow){return String(row.matchDate??"").slice(0,10)}
function playerNameMatch(a:string|null|undefined,b:string|null|undefined){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function weightedH2HContext(input:{
  candidate:any
  opponent:string
  h2hRows:MatchRow[]
  allHistory:MatchRow[]
  currentCandidates:any[]
  matchupCandidate:any|null
  targetDate:string
}){
  const currentOpponents=input.currentCandidates.filter(c=>teamMatch(c.team,input.opponent))
  let weightedOverlap=0,totalWeight=0
  let sameMatchupMeetings=0,sameMatchupCards=0,sameMatchupFouls=0
  const weightedRows:Array<{row:MatchRow;weight:number;overlap:number;sameMatchup:boolean}>=[]
  for(const row of input.h2hRows){
    const d=rowDate(row)
    const pastCurrentOpponents=input.allHistory.filter(r=>
      rowDate(r)===d &&
      teamMatch(r.team,input.opponent) &&
      teamMatch(r.opponent,input.candidate.team) &&
      played(r)
    )
    const pastNames=pastCurrentOpponents.map(r=>String(r.playerName??""))
    const overlapCount=currentOpponents.filter(c=>pastNames.some(name=>playerNameMatch(name,c.dbName??c.name))).length
    const overlap=Math.max(0,Math.min(1,overlapCount/Math.max(1,Math.min(11,currentOpponents.length||11))))
    const sameMatchup=Boolean(input.matchupCandidate&&pastNames.some(name=>playerNameMatch(name,input.matchupCandidate.dbName??input.matchupCandidate.name)))
    if(sameMatchup){
      sameMatchupMeetings++
      if(row.yellowCard===true)sameMatchupCards++
      sameMatchupFouls+=Number(row.foulsCommitted??0)
    }
    const targetMs=new Date(input.targetDate+"T12:00:00Z").getTime()
    const rowMs=new Date(d+"T12:00:00Z").getTime()
    const days=Number.isFinite(targetMs)&&Number.isFinite(rowMs)?Math.max(0,(targetMs-rowMs)/86400000):9999
    const recency=days<=180?.30:days<=365?.18:days<=730?.08:0
    const weight=1+overlap*1.15+(sameMatchup?.65:0)+recency
    weightedRows.push({row,weight,overlap,sameMatchup})
    weightedOverlap+=overlap*weight
    totalWeight+=weight
  }
  const weightedRate=(market:MarketKey)=>{
    let numerator=0,denominator=0
    for(const item of weightedRows){
      numerator+=(hit(market,item.row)?1:0)*item.weight
      denominator+=item.weight
    }
    return denominator>0?numerator/denominator:null
  }
  return {
    weightedRate,
    averageLineupOverlap:totalWeight>0?weightedOverlap/totalWeight:null,
    sameMatchupMeetings,
    sameMatchupCards,
    sameMatchupFouls,
    cards:input.h2hRows.filter(r=>r.yellowCard===true).length,
    fouls:input.h2hRows.reduce((s,r)=>s+Number(r.foulsCommitted??0),0),
    fouled:input.h2hRows.reduce((s,r)=>s+Number(r.foulsDrawn??0),0),
    shots:input.h2hRows.reduce((s,r)=>s+Number(r.shots??0),0),
    shotsOnTarget:input.h2hRows.reduce((s,r)=>s+Number(r.shotsOnTarget??0),0),
  }
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
function cardRolePrior(position:string|null|undefined){
  const p=norm(position)
  const compact=p.replace(/\s+/g,"")
  if(p.includes("goal")||compact==="gk"||compact==="g")return 0.055
  if(compact.includes("cdm")||compact==="dm"||p.includes("defensive mid"))return 0.22
  if(p.includes("back")||p.includes("def")||compact.startsWith("cd")||["cb","lb","rb","lwb","rwb"].includes(compact))return 0.20
  if(compact==="cm"||p.includes("central mid")||p==="midfielder")return 0.17
  if(compact.startsWith("am")||["lm","rm","lw","rw","lf","rf"].includes(compact)||p.includes("attacking mid")||p.includes("wing"))return 0.125
  if(compact==="f"||compact.startsWith("st")||compact.startsWith("cf")||p.includes("forward")||p.includes("striker"))return 0.095
  return 0.15
}
function cardEmpiricalProbability(rows:MatchRow[],prior:number){
  const ordered=[...rows].sort((a,b)=>String(a.matchDate).localeCompare(String(b.matchDate)))
  if(!ordered.length)return prior
  const recent5=ordered.slice(-5)
  const recent10=ordered.slice(-10)
  const all=betaSmoothed(ordered.filter(r=>r.yellowCard===true).length,ordered.length,prior,9)
  const ten=betaSmoothed(recent10.filter(r=>r.yellowCard===true).length,recent10.length,all,7)
  const five=betaSmoothed(recent5.filter(r=>r.yellowCard===true).length,recent5.length,ten,5)
  return clamp(all*.56+ten*.28+five*.16)
}
function cardRecommendationScore(input:{
  probability:number
  recent5:number
  season:number
  h2hN:number
  h2hCards:number
  conditional2:{matches:number;yellows:number;rate:number|null}
  foulPer90:number
  clubMatches:number
  clubCardRate:number|null
}){
  let score=input.probability
  if(input.h2hN>=2){
    const rel=Math.min(1,input.h2hN/4)
    const rate=input.h2hCards/input.h2hN
    score+=(rate-.14)*.18*rel
  }
  if(input.recent5>=.40)score+=.035
  else if(input.recent5===0)score-=.012
  if(input.season>=.28)score+=.03
  else if(input.season===0)score-=.008
  if(input.conditional2.matches>=3&&Number(input.conditional2.rate??0)>=.45)score+=.035
  if(input.foulPer90>=1.8)score+=.02
  else if(input.foulPer90<.8)score-=.012
  if(input.clubMatches>=6&&input.clubCardRate!=null){
    if(input.clubCardRate>=.20)score+=.025
    else if(input.clubCardRate<=.08)score-=.02
  }
  return clamp(score,0.01,0.99)
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
function negativeBinomialAtLeast(mean:number,dispersion:number,threshold:number){
  if(!(mean>0)||!(dispersion>0))return poissonAtLeast(mean,threshold)
  const r=dispersion
  const p=r/(r+mean)
  const logGamma=(z:number)=>{
    const x=z
    if(x<=0)return 0
    return (x-0.5)*Math.log(x)-x+0.5*Math.log(2*Math.PI)+1/(12*x)
  }
  let cumulative=0
  for(let k=0;k<threshold;k++){
    const logP=logGamma(k+r)-logGamma(r)-logGamma(k+1)+r*Math.log(p)+k*Math.log(1-p)
    cumulative+=Math.exp(logP)
  }
  return clamp(1-cumulative)
}
function foulDispersion(rows:MatchRow[]){
  const values=rows.map(r=>Number(r.foulsCommitted??0))
  if(values.length<6)return 20
  const mean=values.reduce((a,b)=>a+b,0)/values.length
  const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,values.length-1)
  if(variance<=mean+0.05)return 30
  return Math.max(0.6,Math.min(30,(mean*mean)/(variance-mean)))
}
function estimateExpectedMinutes(rows:MatchRow[],confirmed:boolean){
  const ordered=[...rows].sort((a,b)=>String(a.matchDate).localeCompare(String(b.matchDate)))
  const starters=ordered.filter(r=>r.starter===true).slice(-8)
  const recent=(confirmed&&starters.length>=3?starters:ordered.slice(-8)).filter(r=>Number(r.minutes??0)>0)
  if(!recent.length)return confirmed?78:65
  let weighted=0,weight=0
  recent.forEach((r,i)=>{
    const w=i+1
    weighted+=Number(r.minutes??0)*w
    weight+=w
  })
  const average=weighted/Math.max(1,weight)
  const low=confirmed?50:30
  return Math.round(Math.max(low,Math.min(90,average)))
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
  // A confirmed XI removes the biggest availability uncertainty. When historical
  // coverage is thin, keep the player at C rather than dropping a real starter
  // completely; the probability itself remains shrunk toward calibrated priors.
  if (input.confirmed) score = Math.max(score,50)
  if (score >= 82) return "A" as const
  if (score >= 66) return "B" as const
  if (score >= 50) return "C" as const
  return "D" as const
}
function thresholdForMarket(market: MarketKey) {
  const match=market.match(/([1-9])$/)
  return match?Number(match[1]):1
}

function availabilityForMarket(availability:MarketAvailability, market:SlipMarketKey):MarketAvailabilityState {
  if (market.startsWith("goal")) return availability.goal
  if (market.startsWith("assist")) return availability.assist
  if (market === "card") return availability.card
  if (market.startsWith("fouled")) return availability.fouled
  if (market.startsWith("foul")) return availability.foul
  if (market.startsWith("sot")) return availability.sot
  return availability.shot
}
function oddsKind(market: SlipMarketKey) {
  if (market.startsWith("goal")) return "goal"
  if (market.startsWith("assist")) return "assist"
  if (market.startsWith("fouled")) return "fouled"
  if (market.startsWith("foul")) return "foul"
  if (market === "card") return "card"
  if (market.startsWith("sot")) return "sot"
  return "shot"
}
function playerInLabel(selection: OddSelection, player: string, allPlayers:string[] = []) {
  const p=norm(player)
  if(!p)return false
  const label=norm(selection.label)
  if(label.includes(p))return true

  const parts=p.split(" ")
  const first=parts[0]??""
  const surname=parts.at(-1)??p
  if(surname.length<4||!label.includes(surname))return false

  // Surname fallback is only safe when that surname is unique among eligible
  // players AND the bookmaker did not provide a conflicting full first name.
  const sameSurname=allPlayers.filter(name=>{
    const n=norm(name)
    return (n.split(" ").at(-1)??n)===surname
  })
  if(sameSurname.length!==1)return false

  const tokens=label.split(" ")
  const surnameIndex=tokens.indexOf(surname)
  if(surnameIndex<0)return false
  if(surnameIndex===0)return true // genuine surname-only bookmaker label

  const preceding=tokens[surnameIndex-1]??""
  const initial=first.slice(0,1)
  if(preceding.length===1)return Boolean(initial&&preceding===initial)

  // If Bet365 supplied a full first name, it must actually match. This blocks
  // Jude Bellingham from inheriting Jobe Bellingham's price (and equivalents).
  if(/^[a-z]+$/.test(preceding)&&preceding!==first)return false
  return true
}
function selectionThreshold(selection: OddSelection) {
  const raw = (selection.market + " " + selection.label).toLowerCase()
  const normalized = norm(raw)

  const plus = raw.match(/(?:^|\s)([1-9])\s*\+/)
  if (plus) return Number(plus[1])

  const overHalf = raw.match(/\bover\s*([0-8])(?:\.5|,5)\b/)
  if (overHalf) return Number(overHalf[1]) + 1

  const orMore = normalized.match(/\b([1-9])\s*(?:or more|or over|and over|and above)\b/)
  if (orMore) return Number(orMore[1])

  const atLeast = normalized.match(/\b(?:at least|minimum)\s*([1-9])\b/)
  if (atLeast) return Number(atLeast[1])

  if (/\bto commit (?:a|one) foul\b|\b1 foul committed\b|\bone foul committed\b/.test(normalized)) return 1
  return null
}
function findOdds(selections: OddSelection[], player: string, market: MarketKey, allPlayers:string[] = []) {
  const desiredKind = oddsKind(market)
  const threshold = thresholdForMarket(market)
  const candidates = selections
    .filter(s => s.odd != null && Number(s.odd) > 1 && s.kind === desiredKind && playerInLabel(s, player, allPlayers))
    .map(s => ({ ...s, detectedThreshold: selectionThreshold(s) }))
    .filter(s => {
      if (market === "card" || market.startsWith("goal")) return true
      // Never attach a bookmaker price to a count market unless the exact line
      // can be read from the bookmaker feed. This prevents a generic foul price
      // being displayed as 1+, 2+ or 3+ by mistake.
      return s.detectedThreshold === threshold
    })
    .sort((a, b) => Number(b.odd ?? 0) - Number(a.odd ?? 0))
  return candidates[0] ?? null
}
function exactCardSelections(selections:OddSelection[],player:string,allPlayers:string[]=[]){
  const byBook=new Map<string,OddSelection>()
  for(const selection of selections){
    if(selection.kind!=="card"||selection.odd==null||Number(selection.odd)<=1||!selection.bookmaker||!playerInLabel(selection,player,allPlayers))continue
    const existing=byBook.get(selection.bookmaker)
    if(!existing||Number(selection.odd)>Number(existing.odd??0))byBook.set(selection.bookmaker,selection)
  }
  return [...byBook.values()]
}

function exactFoulSelections(selections: OddSelection[], player: string, allPlayers:string[] = []) {
  const byBookThreshold = new Map<string,{threshold:number;selection:OddSelection}>()
  for (const selection of selections) {
    if (selection.kind !== "foul" || selection.odd == null || Number(selection.odd) <= 1 || !selection.bookmaker || !playerInLabel(selection, player, allPlayers)) continue
    const threshold = selectionThreshold(selection)
    if (threshold == null || threshold>8) continue
    const key=selection.bookmaker+"|"+threshold
    const existing=byBookThreshold.get(key)
    if (!existing || Number(selection.odd) > Number(existing.selection.odd ?? 0)) byBookThreshold.set(key,{threshold,selection})
  }

  // Sanity-check each bookmaker ladder: higher thresholds should not have shorter prices.
  const grouped=new Map<string,Array<{threshold:number;selection:OddSelection}>>()
  for(const row of byBookThreshold.values()){
    const book=row.selection.bookmaker!
    grouped.set(book,[...(grouped.get(book)??[]),row])
  }
  const clean:Array<{threshold:number;selection:OddSelection}>=[]
  for(const rows of grouped.values()){
    rows.sort((a,b)=>a.threshold-b.threshold)
    let previous=1
    for(const row of rows){
      const price=Number(row.selection.odd)
      if(price+0.03<previous)continue
      clean.push(row)
      previous=Math.max(previous,price)
    }
  }
  return clean.sort((a,b)=>a.threshold-b.threshold||String(a.selection.bookmaker).localeCompare(String(b.selection.bookmaker)))
}

function dynamicFoulProbability(input:{
  rows:MatchRow[]
  threshold:number
  per90:number
  expectedMinutes:number
  matchupFouled90:number|null
}) {
  const ordered=[...input.rows].sort((a,b)=>String(a.matchDate).localeCompare(String(b.matchDate)))
  const hitFor=(row:MatchRow)=>Number(row.foulsCommitted??0)>=input.threshold
  const recent10=ordered.slice(-10)
  const recent5=ordered.slice(-5)
  const lambda=Math.max(0.01,input.per90*input.expectedMinutes/90)
  const poisson=poissonAtLeast(lambda,input.threshold)
  const nb=negativeBinomialAtLeast(lambda,foulDispersion(input.rows),input.threshold)
  const countModel=Math.max(poisson,Math.min(0.99,nb))
  const prior=Math.max(0.01,Math.min(0.99,countModel))
  const all=betaSmoothed(ordered.filter(hitFor).length,ordered.length,prior,7)
  const ten=betaSmoothed(recent10.filter(hitFor).length,recent10.length,all,5)
  const five=betaSmoothed(recent5.filter(hitFor).length,recent5.length,ten,4)
  let probability=clamp(all*0.48+ten*0.24+five*0.14+countModel*0.14)
  if(input.matchupFouled90!=null&&input.matchupFouled90>0){
    probability=logitAdjust(probability,(input.matchupFouled90-1.35)*0.12)
  }
  return probability
}

function fairOdds(probability: number) {
  return probability > 0 ? Math.round((1 / probability) * 100) / 100 : null
}
function roundLikelyBookOdds(value:number){
  if(!Number.isFinite(value)||value<=1)return 1.01
  const step=value<2?0.01:value<4?0.02:value<8?0.05:0.1
  return Math.max(1.01,Math.round(value/step)*step)
}
function median(values:number[]){
  if(!values.length)return null
  const sorted=[...values].sort((a,b)=>a-b)
  const mid=Math.floor(sorted.length/2)
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2
}
function marketReasons(input: {
  market: MarketKey
  probability: number
  recent5: number
  season: number
  h2hRate: number | null
  h2hN: number
  h2hCards?: number
  h2hLineupOverlap?: number | null
  sameMatchupMeetings?: number
  sameMatchupCards?: number
  sameMatchupFouls?: number
  matchupName?: string | null
  matchupFouled90?: number | null
  conditional2?: { matches: number; yellows: number; rate: number | null }
  countryH2H?: { matches:number; playerSamples:number; cardRate:number|null; foulsPerPlayer:number|null } | null
}) {
  const reasons: string[] = []
  if(input.market==="card"&&input.h2hN>=2&&Number(input.h2hCards??0)===0){
    reasons.push("No bookings in "+input.h2hN+" previous meetings")
  }
  if(input.market==="card"&&Number(input.clubMatches??0)>=5){
    reasons.push("Current club season: "+Number(input.clubYellows??0)+"/"+Number(input.clubMatches??0)+" booked")
  }
  if(input.market==="card"&&Number(input.h2hCards??0)>0){
    const overlap=input.h2hLineupOverlap==null?"":" · "+Math.round(Number(input.h2hLineupOverlap)*100)+"% current-opponent lineup overlap"
    reasons.push("Booked in "+input.h2hCards+"/"+input.h2hN+" previous meetings"+overlap)
  }
  if((input.market.startsWith("foul")&&!input.market.startsWith("fouled"))&&Number(input.sameMatchupMeetings??0)>0&&Number(input.sameMatchupFouls??0)>0){
    reasons.push("Same likely direct opponent appeared in "+input.sameMatchupMeetings+" H2H meeting"+(input.sameMatchupMeetings===1?"":"s")+" · "+input.sameMatchupFouls+" fouls committed")
  }
  if(input.market==="card"&&Number(input.sameMatchupCards??0)>0){
    reasons.push("Booked with the same likely direct matchup on the pitch before")
  }
  if (input.recent5 >= input.season + 0.12) reasons.push("Recent form is above longer-run rate")
  if (input.season >= 0.65 && input.market !== "card") reasons.push("Strong historical hit rate")
  if (input.market === "card" && input.conditional2 && input.conditional2.matches >= 3 && Number(input.conditional2.rate ?? 0) >= 0.45) {
    reasons.push("Booked in " + input.conditional2.yellows + "/" + input.conditional2.matches + " matches with 2+ fouls")
  }
  if (input.h2hRate != null && input.h2hN >= 2 && input.h2hRate >= 0.5) {
    const hits=Math.round(input.h2hRate*input.h2hN)
    reasons.push("Personal H2H: "+hits+"/"+input.h2hN+" hit this market")
  }
  if (input.market==="card" && input.countryH2H && input.countryH2H.matches>=2 && input.countryH2H.playerSamples>=12 && Number(input.countryH2H.cardRate??0)>=0.26) {
    reasons.push("Country H2H has elevated booking intensity ("+Math.round(Number(input.countryH2H.cardRate)*100)+"% of tracked player appearances)")
  }
  if ((input.market === "foul1" || input.market === "foul2" || input.market === "foul3" || input.market === "card") && input.matchupName) {
    const extra = input.matchupFouled90 != null ? " (" + Number(input.matchupFouled90).toFixed(2) + " fouls drawn/90)" : ""
    reasons.push("Direct pressure from " + input.matchupName + extra)
  }
  if (!reasons.length) reasons.push("Probability led by player history and recent matches")
  return reasons.slice(0, 3)
}

function marketLeg(player: ScorePlayer, market: MarketKey): SlipLeg {
  const m = player.markets?.[market]
  if(!m){
    return {
      player:player.name,dbPlayerName:player.dbName,team:player.team,market,label:MARKET_LABELS[market],
      probability:0,fairOdds:null,bookmakerOdds:null,bookmakerName:null,previousBookmakerOdds:null,
      bookmakerMovement:null,edge:null,expectedValue:null,confidence:"D",reason:"Market unavailable",priceSource:null,bookmakerProbability:null,
    }
  }
  return {
    player: player.name,
    dbPlayerName: player.dbName,
    team: player.team,
    market,
    label: m.label,
    probability: m.probability,
    fairOdds: m.fairOdds,
    bookmakerOdds: m.bookmakerOdds,
    bookmakerName: m.bookmakerName,
    previousBookmakerOdds: m.previousBookmakerOdds,
    bookmakerMovement: m.bookmakerMovement,
    edge: m.edge,
    expectedValue: m.expectedValue,
    confidence: m.confidence,
    reason: m.reasons[0] ?? "",
    priceSource: m.bookmakerOdds!=null && m.bookmakerName==="Bet365" ? "exact" : null,
    bookmakerProbability:m.bookmakerNoVigProbability??m.impliedProbability,
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
    { id:"foul-10-1", fractional:"10/1", decimal:11, minProbability:0.60 },
    { id:"foul-20-1", fractional:"20/1", decimal:21, minProbability:0.55 },
    { id:"foul-50-1", fractional:"50/1", decimal:51, minProbability:0.48 },
    { id:"foul-100-1", fractional:"100/1", decimal:101, minProbability:0.42 },
  ] as const

  const pool:SlipLeg[] = players.flatMap(player =>
    player.likelyFoulLines.map(line => ({
      player:player.name,
      dbPlayerName:player.dbName,
      team:player.team,
      market:(("foul"+line.threshold) as SlipMarketKey),
      label:line.label,
      probability:line.probability,
      fairOdds:line.fairOdds,
      bookmakerOdds:line.bookmakerOdds,
      bookmakerName:line.bookmaker,
      previousBookmakerOdds:line.previousBookmakerOdds,
      bookmakerMovement:line.bookmakerMovement,
      edge:line.edge,
      expectedValue:line.expectedValue,
      confidence:line.confidence,
      reason:(line.priceSource==="exact"?"Exact":"Estimated")+" "+line.threshold+"+ foul price at "+line.bookmaker+" "+line.bookmakerOdds.toFixed(2),
      priceSource:line.priceSource,
    }))
  )
    .filter(leg=>leg.confidence!=="D")
    .filter(leg=>leg.bookmakerOdds!=null&&Number(leg.bookmakerOdds)>1)

  const books=[...new Set(pool.map(l=>l.bookmakerName).filter(Boolean))] as string[]

  return targets.map(target=>{
    type State={legs:SlipLeg[];product:number;teamCounts:Record<string,number>;quality:number;bookmaker:string}
    const finals:State[]=[]

    for(const bookmaker of books){
      const candidates=pool
        .filter(leg=>leg.bookmakerName===bookmaker&&leg.probability>=target.minProbability)
        .sort((a,b)=>{
          const qa=a.probability+Math.max(0,Number(a.edge??0))*0.35
          const qb=b.probability+Math.max(0,Number(b.edge??0))*0.35
          return qb-qa
        })
      let states:State[]=[{legs:[],product:1,teamCounts:{},quality:0,bookmaker}]
      for(const leg of candidates){
        const next=[...states]
        for(const state of states){
          if(state.legs.length>=12)continue
          if(state.legs.some(existing=>existing.player===leg.player))continue
          const count=state.teamCounts[leg.team]??0
          if(count>=6)continue
          const product=state.product*Number(leg.bookmakerOdds)
          if(product>target.decimal*2.5&&state.legs.length>=2)continue
          next.push({
            legs:[...state.legs,leg],
            product,
            teamCounts:{...state.teamCounts,[leg.team]:count+1},
            quality:state.quality+leg.probability+Math.max(0,Number(leg.edge??0))*0.25,
            bookmaker,
          })
        }
        states=next.sort((a,b)=>{
          const score=(state:State)=>{
            if(!state.legs.length)return Number.POSITIVE_INFINITY
            const distance=Math.abs(Math.log(Math.max(1.01,state.product))-Math.log(target.decimal))
            const avg=state.quality/state.legs.length
            const under=state.product<target.decimal*0.80?0.7:0
            return distance*1.8+under-avg*0.5
          }
          return score(a)-score(b)
        }).slice(0,220)
      }
      finals.push(...states.filter(s=>s.legs.length>=2))
    }

    const best=finals.sort((a,b)=>{
      const da=Math.abs(Math.log(a.product)-Math.log(target.decimal))
      const db=Math.abs(Math.log(b.product)-Math.log(target.decimal))
      const qa=a.quality/Math.max(1,a.legs.length)
      const qb=b.quality/Math.max(1,b.legs.length)
      return (da-qa*0.15)-(db-qb*0.15)
    })[0]

    if(!best){
      return {
        id:target.id,bookmaker:null,targetFractional:target.fractional,targetDecimal:target.decimal,
        legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,
        pricedLegs:0,usesLivePrices:false,withinTargetRange:false,
        note:"No single preferred bookmaker has enough exact foul lines that meet the model threshold for this target.",
      }
    }

    const avg=best.legs.reduce((s,l)=>s+l.probability,0)/best.legs.length
    const min=Math.min(...best.legs.map(l=>l.probability))
    return {
      id:target.id,
      bookmaker:best.bookmaker,
      targetFractional:target.fractional,
      targetDecimal:target.decimal,
      legs:best.legs,
      referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:Math.round(avg*1000)/1000,
      minimumLegProbability:Math.round(min*1000)/1000,
      pricedLegs:best.legs.length,
      usesLivePrices:best.legs.every(leg=>leg.priceSource==="exact"),
      withinTargetRange:best.product>=target.decimal*0.80&&best.product<=target.decimal*1.35,
      note:(best.legs.every(leg=>leg.priceSource==="exact")
        ?"Every leg in this builder is an exact offered line from "+best.bookmaker+". "
        :"This builder contains one or more estimated prices for "+best.bookmaker+" and must be checked in the bookmaker before placing. ")
        +"The displayed reference product multiplies individual prices only; the bookmaker's same-game correlation adjustment may change the final Bet Builder price.",
    }
  })
}
function buildSlips(players: ScorePlayer[]) {
  const used = new Set<string>()
  const safeMarkets: MarketKey[] = ["goal1", "foul1", "fouled1", "shot1", "sot1", "card"]
  const safe: SlipLeg[] = []
  for (const market of safeMarkets) {
    const leg = bestLeg(players, market, used)
    if (leg) {
      safe.push(leg)
      used.add(norm(leg.player))
    }
  }

  const cardLegs = players.map(player => ({leg:marketLeg(player, "card"),score:Number(player.markets.card.recommendationScore??player.markets.card.probability)}))
    .filter(x => x.leg.confidence !== "D")
    .filter(x => x.leg.expectedValue == null || x.leg.expectedValue >= -0.08)
    .sort((a,b)=>b.score-a.score||legRank(b.leg)-legRank(a.leg))
    .map(x=>x.leg)
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


type RiskBuilder = {
  id:string
  title:string
  risk:"Safe"|"Balanced"|"High Risk"
  targetFractional:string
  targetDecimal:number
  legs:SlipLeg[]
  referenceProductOdds:number|null
  averageLegProbability:number|null
  minimumLegProbability:number|null
  modelAllHitProbability:number|null
  conservativeAllHitProbability:number|null
  safetyScore:number|null
  exactPriced:boolean
  bookmaker:string|null
  verifiedBet365LegPrices:boolean
  exactBet365BuilderPrice:boolean
  pricingBasis:"bet365_singles_product"|"none"
  note:string
}

function buildRiskBuilders(players:ScorePlayer[],scope:"all"|"discipline"="all"):RiskBuilder[]{
  const configs=scope==="discipline"
    ?[
      {id:"discipline-safe-3-1",title:"Fouls & Cards 3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4,minSafety:.42,maxLegs:12},
      {id:"discipline-balanced-10-1",title:"Fouls & Cards 10/1",risk:"Balanced" as const,targetFractional:"10/1",targetDecimal:11,minSafety:.30,maxLegs:12},
      {id:"discipline-high-20-1",title:"Fouls & Cards 20/1+",risk:"High Risk" as const,targetFractional:"20/1+",targetDecimal:21,minSafety:.20,maxLegs:12},
    ]
    :[
      {id:"safe-3-1",title:"Safe 3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4,minSafety:.50,maxLegs:12},
      {id:"balanced-10-1",title:"Balanced 10/1",risk:"Balanced" as const,targetFractional:"10/1",targetDecimal:11,minSafety:.38,maxLegs:12},
      {id:"high-20-1",title:"High Risk 20/1+",risk:"High Risk" as const,targetFractional:"20/1+",targetDecimal:21,minSafety:.28,maxLegs:12},
    ]
  const baseMarkets:MarketKey[]=["goal1","assist1","shot1","sot1","foul1","fouled1","card"]
  const allPricedMarkets:MarketKey[]=scope==="discipline"
    ?["foul1","foul2","foul3","foul4","foul5","fouled1","card"]
    :["goal1","assist1","shot1","shot2","sot1","sot2","foul1","foul2","foul3","foul4","foul5","fouled1","card"]
  const familyLines:Record<string,MarketKey[]>={
    goal:["goal1"],assist:["assist1"],shot:["shot1","shot2"],sot:["sot1","sot2"],
    foul:["foul1","foul2","foul3","foul4","foul5"],fouled:["fouled1"],card:["card"],
  }
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const floor=(market:string)=>{
    if(market==="card")return {green:.20,amber:.14}
    if(market==="goal1")return {green:.32,amber:.18}
    if(market==="assist1")return {green:.24,amber:.14}
    if(market==="shot1")return {green:.72,amber:.48}
    if(market==="sot1")return {green:.42,amber:.25}
    if(market==="foul1")return {green:.68,amber:.48}
    if(market==="fouled1")return {green:.62,amber:.42}
    return {green:.30,amber:.15}
  }
  const percentile=(values:number[],value:number)=>{
    if(values.length<=1)return .5
    const below=values.filter(v=>v<value).length
    const equal=values.filter(v=>v===value).length
    return Math.max(0,Math.min(1,(below+equal*.5)/values.length))
  }

  const isVerifiedBet365Leg=(leg:SlipLeg)=>leg.priceSource==="exact"&&leg.bookmakerName==="Bet365"&&leg.bookmakerOdds!=null&&Number(leg.bookmakerOdds)>1
  const bet365Odd=(leg:SlipLeg)=>isVerifiedBet365Leg(leg)?Number(leg.bookmakerOdds):0
  const automaticEvidenceEligible=(leg:SlipLeg)=>{
    if(leg.market!=="card")return true
    const player=players.find(p=>norm(p.name)===norm(leg.player))
    const market=player?.markets?.card
    if(!player||!market)return false
    const h2hN=Number(market.h2hMatches??0)
    const h2hRate=Number(market.h2hHitRate??0)
    const recent=Number(market.recent5HitRate??0)
    const season=Number(market.seasonHitRate??0)
    const sample=Number(market.sampleMatches??player.sampleMatches??0)
    const after2=player.yellowConditionals?.after2PlusFouls
    const strongH2H=h2hN>=2&&h2hRate>=0.50
    const strongCurrent=recent>=0.40&&season>=0.20
    const strongSeason=sample>=8&&season>=0.30
    const foulPressure=Number(after2?.matches??0)>=3&&Number(after2?.rate??0)>=0.45
    // Cards are high-variance. Do not auto-build them merely because their price
    // helps reach a target: require a repeat opponent pattern or strong behaviour.
    return leg.probability>=0.16&&(strongH2H||strongCurrent||strongSeason||foulPressure)
  }

  const baseLegs=players.flatMap(player=>baseMarkets.map(m=>marketLeg(player,m)))
    .filter(leg=>leg.confidence!=="D"&&leg.probability>=.05)
    .filter(isVerifiedBet365Leg)
    .filter(automaticEvidenceEligible)
  const peers=new Map<string,number[]>()
  for(const leg of baseLegs){
    const arr=peers.get(leg.market)??[]
    arr.push(leg.probability)
    peers.set(leg.market,arr)
  }
  const signal=(leg:SlipLeg)=>{
    const f=floor(leg.market)
    const rel=Math.max(-.5,Math.min(1.5,(leg.probability-f.amber)/Math.max(.04,f.green-f.amber)))
    const pct=percentile(peers.get(leg.market)??[],leg.probability)
    const confidence=leg.confidence==="A"?.08:leg.confidence==="B"?.05:leg.confidence==="C"?.02:0
    const edge=Math.max(0,Number(leg.edge??0))*.20
    return pct*.55+Math.max(0,rel)*.25+leg.probability*.12+confidence+edge
  }
  const confidenceReliability=(leg:SlipLeg)=>leg.confidence==="A"?1:leg.confidence==="B"?.96:leg.confidence==="C"?.88:.74
  const marketReliability=(leg:SlipLeg)=>{
    const f=family(leg.market)
    if(f==="foul")return .995
    if(f==="fouled")return .992
    if(f==="shot")return .99
    if(f==="sot")return .975
    if(f==="card")return .95
    if(f==="goal")return .95
    if(f==="assist")return .93
    return .97
  }
  const safetyLegProbability=(leg:SlipLeg)=>{
    const model=clamp(Number(leg.probability??0),.01,.99)
    const price=bet365Odd(leg)
    if(!(price>1))return model
    const book=clamp(Number(leg.bookmakerProbability??(1/price)),.01,.99)
    const modelWeight=leg.confidence==="A"?.66:leg.confidence==="B"?.58:leg.confidence==="C"?.50:.42
    let consensus=model*modelWeight+book*(1-modelWeight)
    // Large disagreement is uncertainty, not free edge. Penalise only the
    // excess disagreement beyond eight percentage points.
    const disagreement=Math.abs(model-book)
    consensus-=Math.max(0,disagreement-.08)*.32
    return clamp(consensus,.01,.99)
  }
  const conservativeJoint=(legs:SlipLeg[],_raw:number)=>{
    if(!legs.length)return 0
    const counts:Record<string,number>={}
    let conservative=1
    for(const leg of legs){
      const f=family(leg.market)
      counts[f]=(counts[f]??0)+1
      conservative*=safetyLegProbability(leg)*confidenceReliability(leg)*marketReliability(leg)
    }
    // Raw probability multiplication already penalises extra legs heavily.
    // Only a light concentration penalty is applied so five genuinely strong
    // foul/shot legs can beat one speculative scorer/defender shot.
    let concentrationPenalty=1
    for(const [f,count] of Object.entries(counts)){
      if(count<=1)continue
      const perExtra=f==="foul"||f==="fouled"?.992:f==="shot"?.988:.98
      concentrationPenalty*=Math.pow(perExtra,count-1)
    }
    return Math.max(0,Math.min(.99,conservative*concentrationPenalty))
  }

  // Choose the action family where each player stands out most versus the other
  // players in that same market. A 22% card can therefore outrank a 40% shot
  // when the card is elite for cards and the shot is weak for shots.
  const preferredFamily=new Map<string,{family:string;signal:number}>()
  for(const player of players){
    const options=baseMarkets.map(m=>marketLeg(player,m))
      .filter(l=>l.confidence!=="D"&&l.probability>=.05)
      .filter(isVerifiedBet365Leg)
      .filter(automaticEvidenceEligible)
      .map(l=>({family:family(l.market),signal:signal(l)}))
      .sort((a,b)=>b.signal-a.signal)
    if(options[0])preferredFamily.set(norm(player.name),options[0])
  }

  const preferredCandidates=players.flatMap(player=>{
    const preferred=preferredFamily.get(norm(player.name))
    if(!preferred)return []
    return (familyLines[preferred.family]??[]).map(m=>({leg:marketLeg(player,m),family:preferred.family,signal:preferred.signal}))
  })
    .filter(x=>x.leg.confidence!=="D"&&x.leg.probability>=.08)
    .filter(x=>isVerifiedBet365Leg(x.leg))
    .sort((a,b)=>(b.signal-a.signal)||(legRank(b.leg)-legRank(a.leg)))

  const safeCandidates=players.flatMap(player=>
    allPricedMarkets.map(m=>{
      const leg=marketLeg(player,m)
      return {leg,family:family(m),signal:signal(leg),safeP:safetyLegProbability(leg)}
    })
  )
    .filter(x=>x.leg.confidence!=="D"&&x.leg.probability>=.08)
    .filter(x=>isVerifiedBet365Leg(x.leg))
    .filter(x=>automaticEvidenceEligible(x.leg))
    .sort((a,b)=>(b.safeP-a.safeP)||(b.leg.probability-a.leg.probability))

  return configs.map(config=>{
    const sourceCandidates=safeCandidates
    const safeFloors=[config.minSafety]
    type State={legs:SlipLeg[];product:number;quality:number;prob:number;conservative:number;players:Set<string>;families:Record<string,number>;teamCounts:Record<string,number>}
    let best:State|undefined
    let usedSafeFloor:number|null=null

    for(const safeFloor of safeFloors){
      const candidates=sourceCandidates.filter(x=>safetyLegProbability(x.leg)>=safeFloor)
      let states:State[]=[{legs:[],product:1,quality:0,prob:1,conservative:1,players:new Set(),families:{},teamCounts:{}}]

      for(const option of candidates){
        const next=[...states]
        for(const state of states){
          if(state.legs.length>=config.maxLegs)continue
          const pkey=norm(option.leg.player)
          if(state.players.has(pkey))continue
          const teamKey=norm(option.leg.team)
          const teamCount=state.teamCounts[teamKey]??0
          if(teamCount>=6)continue
          const familyCount=state.families[option.family]??0
          const odd=bet365Odd(option.leg)
          if(!(odd>1))continue
          const product=state.product*odd
          if(product>config.targetDecimal*1.65&&state.legs.length>=1)continue
          const legs=[...state.legs,option.leg]
          const rawProb=state.prob*option.leg.probability
          next.push({
            legs,
            product,
            quality:state.quality+option.signal+legRank(option.leg)*.35,
            prob:rawProb,
            conservative:conservativeJoint(legs,rawProb),
            players:new Set([...state.players,pkey]),
            families:{...state.families,[option.family]:familyCount+1},
            teamCounts:{...state.teamCounts,[teamKey]:teamCount+1},
          })
        }
        const score=(state:State)=>{
          if(!state.legs.length)return 999
          const distance=Math.abs(Math.log(Math.max(1.01,state.product))-Math.log(config.targetDecimal))
          const diversity=Object.keys(state.families).length
          const avg=state.quality/state.legs.length
          const weakest=Math.min(...state.legs.map(l=>safetyLegProbability(l)))
          const under=state.product<config.targetDecimal?1:0
          return under*1.25+distance*.12-state.conservative*5.5-weakest*.55-avg*.05+state.legs.length*.001
        }
        // Preserve the best probability states across the whole odds range.
        // This is essential: a longer set of very likely foul/shot legs must be
        // allowed to beat a shorter speculative scorer/card route.
        const buckets=new Map<string,State[]>()
        for(const state of next){
          const oddsBucket=Math.floor(Math.log(Math.max(1,state.product))*120)
          const key=oddsBucket+"|"+state.legs.length
          const rows=buckets.get(key)??[]
          rows.push(state)
          rows.sort((a,b)=>b.conservative-a.conservative||score(a)-score(b))
          buckets.set(key,rows.slice(0,12))
        }
        states=[...buckets.values()].flat()
          .sort((a,b)=>score(a)-score(b))
          .slice(0,7000)
      }

      const valid=states.filter(state=>
        state.legs.length>=2&&
        state.product>=config.targetDecimal&&
        true
      )
      const candidateBest=valid.sort((a,b)=>{
        if(Math.abs(a.conservative-b.conservative)>.0005)return b.conservative-a.conservative
        const weakA=Math.min(...a.legs.map(l=>safetyLegProbability(l)))
        const weakB=Math.min(...b.legs.map(l=>safetyLegProbability(l)))
        if(Math.abs(weakA-weakB)>.005)return weakB-weakA
        const da=Math.abs(Math.log(a.product)-Math.log(config.targetDecimal))
        const db=Math.abs(Math.log(b.product)-Math.log(config.targetDecimal))
        if(Math.abs(da-db)>.015)return da-db
        return a.legs.length-b.legs.length
      })[0]

      if(candidateBest){
        best=candidateBest
        usedSafeFloor=config.risk==="Safe"?safeFloor:null
        break
      }
    }

    if(!best)return {
      id:config.id,title:config.title,risk:config.risk,targetFractional:config.targetFractional,targetDecimal:config.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,modelAllHitProbability:null,conservativeAllHitProbability:null,safetyScore:null,
      exactPriced:false,bookmaker:null,verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:scope==="discipline"
        ?"No verified Bet365 combination of cards, fouls committed or fouls drawn reaches this target at the required safety level yet."
        :config.risk==="Safe"
          ?"No combination of verified Bet365 legs reaches the 3/1 target at the required consensus-safety level."
          :"No combination of verified Bet365 player prices reaches this target with the required model strength yet."
    }
    const avg=best.legs.reduce((sum,leg)=>sum+leg.probability,0)/best.legs.length
    const min=Math.min(...best.legs.map(leg=>leg.probability))
    const families=[...new Set(best.legs.map(leg=>family(leg.market)))]
    const verifiedBet365LegPrices=best.legs.every(isVerifiedBet365Leg)
    return {
      id:config.id,title:config.title,risk:config.risk,targetFractional:config.targetFractional,targetDecimal:config.targetDecimal,
      legs:best.legs,referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:Math.round(avg*1000)/1000,minimumLegProbability:Math.round(min*1000)/1000,
      modelAllHitProbability:Math.round(best.prob*10000)/10000,
      conservativeAllHitProbability:Math.round(best.conservative*10000)/10000,
      safetyScore:Math.round(best.conservative*1000)/1000,
      exactPriced:verifiedBet365LegPrices,
      bookmaker:verifiedBet365LegPrices?"Bet365":null,
      verifiedBet365LegPrices,
      exactBet365BuilderPrice:false,
      pricingBasis:"bet365_singles_product" as const,
      note:scope==="discipline"
        ?"This slip searches only verified Bet365 yellow-card, foul-committed and foul-drawn markets. It may use up to Bet365's 12-selection limit, with no more than six players from either team, and chooses the combination with the highest conservative all-hit probability that reaches the target. Cards are not forced in when higher-probability foul legs are safer."
        :config.risk==="Safe"
          ?"Every verified Bet365 player market is searched. Safe chooses the highest conservative all-hit probability that reaches the target; several short-priced fouls/shots can beat a speculative two-leg route."
          :"Every verified Bet365 player market is searched across goals, assists, cards, fouls, fouls drawn, shots and SOT. The model chooses the combination with the highest conservative all-hit probability that reaches the target; market type and leg count do not get preference. Bet365 can reprice correlated legs inside Bet Builder, so this is not labelled as the final Builder quote."
    }
  })
}

async function buildVerifiedBet365SnapshotFallback(input:{request:Request;date:string;home:string;away:string;competition:string}){
  const fallback:any=await buildSnapshotScorecard({
    date:input.date,home:input.home,away:input.away,competition:input.competition as any,
  })
  let odds:any={selections:[],priceAvailable:false}
  try{
    const oddsResponse=await oddsGET(input.request)
    if(oddsResponse.ok)odds=await oddsResponse.json()
  }catch{}
  const selections:OddSelection[]=Array.isArray(odds?.selections)?odds.selections:[]
  const capturedAt=odds?.capturedAt?String(odds.capturedAt):null
  const capturedMs=capturedAt?new Date(capturedAt).getTime():Number.NaN
  const ageSeconds=Number.isFinite(capturedMs)?Math.max(0,Math.round((Date.now()-capturedMs)/1000)):null
  const maxAge=Math.max(300,Number(odds?.maxUsableAgeSeconds??300))
  const freshness=ageSeconds==null?"UNKNOWN":ageSeconds<120?"LIVE":ageSeconds<maxAge?(odds?.cached?"CACHED":"SLIGHTLY STALE"):"STALE"
  const usable=freshness==="STALE"?[]:selections.filter(s=>s.bookmaker==="Bet365")
  const fallbackPlayers:Array<any>=Array.isArray(fallback?.players)?fallback.players:[]
  const names=fallbackPlayers.map(p=>String(p?.name??"")).filter(Boolean)
  for(const player of fallbackPlayers){
    for(const [marketKey,marketRow] of Object.entries(player?.markets??{}) as Array<[MarketKey,any]>){
      const odd=findOdds(usable,String(player?.name??""),marketKey,names)
      if(!odd||odd.bookmaker!=="Bet365"||odd.odd==null||Number(odd.odd)<=1)continue
      const price=Number(odd.odd)
      const probability=Number(marketRow?.probability??0)
      marketRow.bookmakerOdds=price
      marketRow.bookmakerName="Bet365"
      marketRow.previousBookmakerOdds=odd.previousOdd==null?null:Number(odd.previousOdd)
      marketRow.bookmakerMovement=odd.movement==null?null:Number(odd.movement)
      marketRow.bookmakerLabel=odd.label??null
      marketRow.impliedProbability=Math.round((1/price)*1000)/1000
      marketRow.bookmakerNoVigProbability=odd.noVigProbability==null?null:Math.round(Number(odd.noVigProbability)*1000)/1000
      const bookmakerConsensus=marketRow.bookmakerNoVigProbability??marketRow.impliedProbability
      marketRow.edge=Math.round((probability-bookmakerConsensus)*1000)/1000
      marketRow.expectedValue=Math.round((probability*price-1)*1000)/1000
    }
  }
  const bookmakerAvailability:BookmakerAvailability=odds?.bookmakerAvailability??{}
  const eligibleBooks=Object.entries(bookmakerAvailability)
    .filter(([book,a])=>book==="Bet365"&&a.card==="available"&&a.foul==="available")
    .map(([book])=>book)
  return {
    ...fallback,
    bookmaker:odds?.bookmaker==="Bet365"?"Bet365":null,
    oddsSource:odds?.source??null,
    oddsCapturedAt:capturedAt,
    oddsAgeSeconds:ageSeconds,
    oddsFreshness:freshness,
    freeTier:odds?.freeTier!==false,
    marketAvailability:odds?.marketAvailability??fallback?.marketAvailability??{},
    availableBets:Array.isArray(odds?.availableBets)?odds.availableBets:[],
    oddsSelections:Array.isArray(odds?.selections)?odds.selections:[],
    bookmakerAvailability,
    eligibleBooks,
    priceAvailable:Boolean(odds?.priceAvailable)&&freshness!=="STALE",
    players:fallbackPlayers,
    riskBuilders:buildRiskBuilders(fallbackPlayers as ScorePlayer[]),
    foulCardBuilders:buildRiskBuilders(fallbackPlayers as ScorePlayer[],"discipline"),
    fallbackReason:"Live research database is temporarily unavailable; snapshot probabilities are combined with verified Bet365 prices.",
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"
  if (!date || !home || !away) return NextResponse.json({ ok: false, error: "Invalid fixture parameters" }, { status: 400 })
  if (!isDatabaseConfigured) {
    try {
      return NextResponse.json(await buildVerifiedBet365SnapshotFallback({request,date,home,away,competition}))
    } catch {
      return NextResponse.json({ ok: false, error: "Database not connected and snapshot fallback unavailable" }, { status: 503 })
    }
  }

  try {
    await ensureResearchSchema()
  } catch (error) {
    try {
      return NextResponse.json(await buildVerifiedBet365SnapshotFallback({request,date,home,away,competition}))
    } catch {
      return NextResponse.json({
        ok:false,
        error:"Live research database is temporarily unavailable and the Bet365-enriched snapshot fallback could not be loaded.",
        fallbackAvailable:false,
      },{status:503})
    }
  }

  let radarResponse:Response
  try {
    radarResponse = await radarGET(request)
  } catch (error) {
    try {
      return NextResponse.json(await buildVerifiedBet365SnapshotFallback({request,date,home,away,competition}))
    } catch {
      return NextResponse.json({
        ok:false,
        error:"Live player research is temporarily unavailable and the snapshot fallback could not be loaded.",
        fallbackAvailable:false,
      },{status:503})
    }
  }
  if (!radarResponse.ok) return radarResponse
  const radar = await radarResponse.json()
  const candidates: any[] = Array.isArray(radar?.candidates) ? radar.candidates : []

  // International confirmed XIs can be much better covered by the dedicated
  // national-team snapshot than by club-baseline matching. If the live research
  // path only matches a small portion of the 22 starters, use the confirmed-XI
  // snapshot as the probability layer and then overlay verified Bet365 prices.
  if(competition==="International"&&radar?.lineupsConfirmed===true&&candidates.length<18){
    try{
      const expanded:any=await buildVerifiedBet365SnapshotFallback({request,date,home,away,competition})
      if(expanded?.lineupsConfirmed===true&&Number(expanded?.playerCount??0)>candidates.length){
        return NextResponse.json({
          ...expanded,
          fallbackReason:"Confirmed international XI coverage expanded with the national-team snapshot; verified Bet365 prices remain the only bookmaker prices shown.",
        })
      }
    }catch{}
  }

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
    goal: odds?.marketAvailability?.goal ?? "unknown",
    assist: odds?.marketAvailability?.assist ?? "unknown",
    card: odds?.marketAvailability?.card ?? "unknown",
    foul: odds?.marketAvailability?.foul ?? "unknown",
    fouled: odds?.marketAvailability?.fouled ?? "unknown",
    shot: odds?.marketAvailability?.shot ?? "unknown",
    sot: odds?.marketAvailability?.sot ?? "unknown",
  }
  const bookmakerAvailability:BookmakerAvailability = odds?.bookmakerAvailability ?? {}
  const eligibleBooks=Object.entries(bookmakerAvailability)
    .filter(([,a])=>a.card==="available"&&a.foul==="available")
    .map(([book])=>book)

  let history: MatchRow[] = []
  if(names.length){
    try {
      history = await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), lt(playerH2H.matchDate, date)))
    } catch (error) {
      try {
        const fallback:any=await buildSnapshotScorecard({date,home,away,competition:competition as any})
        const fallbackPlayers:Array<any>=Array.isArray(fallback?.players)?fallback.players:[]
        const fallbackNames=fallbackPlayers.map(p=>String(p?.name??"")).filter(Boolean)
        for(const player of fallbackPlayers){
          for(const [marketKey,marketRow] of Object.entries(player?.markets??{}) as Array<[MarketKey,any]>){
            const odd=findOdds(usableSelections,String(player?.name??""),marketKey,fallbackNames)
            if(!odd||odd.bookmaker!=="Bet365"||odd.odd==null||Number(odd.odd)<=1)continue
            const price=Number(odd.odd)
            const probability=Number(marketRow?.probability??0)
            marketRow.bookmakerOdds=price
            marketRow.bookmakerName="Bet365"
            marketRow.previousBookmakerOdds=odd.previousOdd==null?null:Number(odd.previousOdd)
            marketRow.bookmakerMovement=odd.movement==null?null:Number(odd.movement)
            marketRow.bookmakerLabel=odd.label??null
            marketRow.impliedProbability=price>0?Math.round((1/price)*1000)/1000:null
            marketRow.bookmakerNoVigProbability=odd.noVigProbability==null?null:Math.round(Number(odd.noVigProbability)*1000)/1000
            const bookmakerConsensus=marketRow.bookmakerNoVigProbability??marketRow.impliedProbability
            marketRow.edge=bookmakerConsensus==null?null:Math.round((probability-bookmakerConsensus)*1000)/1000
            marketRow.expectedValue=price>0?Math.round((probability*price-1)*1000)/1000:null
          }
        }
        const verifiedRiskBuilders=buildRiskBuilders(fallbackPlayers as ScorePlayer[])
        return NextResponse.json({
          ...fallback,
          bookmaker:odds?.bookmaker==="Bet365"?"Bet365":null,
          oddsSource:odds?.source??null,
          oddsCapturedAt,
          oddsAgeSeconds,
          oddsFreshness,
          freeTier:odds?.freeTier!==false,
          marketAvailability,
          availableBets:Array.isArray(odds?.availableBets)?odds.availableBets:[],
          oddsSelections:Array.isArray(odds?.selections)?odds.selections:[],
          bookmakerAvailability,
          eligibleBooks,
          priceAvailable:Boolean(odds?.priceAvailable)&&oddsFreshness!=="STALE",
          players:fallbackPlayers,
          riskBuilders:verifiedRiskBuilders,
          foulCardBuilders:buildRiskBuilders(fallbackPlayers as ScorePlayer[],"discipline"),
          fallbackReason:"Live history database is temporarily unavailable; snapshot probabilities are being combined with verified Bet365 prices.",
        })
      } catch {
        return NextResponse.json({
          ok:false,
          error:"Live player-history database quota is temporarily unavailable and the snapshot fallback could not be loaded.",
          fallbackAvailable:false,
        },{status:503})
      }
    }
  }

  const countryH2HDates=new Set<string>()
  let countryH2HPlayerSamples=0
  let countryH2HYellows=0
  let countryH2HFouls=0
  if(competition==="International"){
    for(const candidate of candidates){
      const matches=Array.isArray(candidate?.h2hMatches)?candidate.h2hMatches:[]
      for(const row of matches){
        const matchDate=String(row?.matchDate??"")
        if(matchDate)countryH2HDates.add(matchDate)
        countryH2HPlayerSamples+=1
        countryH2HYellows+=row?.yellowCard===true?1:0
        countryH2HFouls+=Number(row?.foulsCommitted??0)
      }
    }
  }
  const countryH2HContext=competition==="International"&&countryH2HPlayerSamples>0 ? {
    matches:countryH2HDates.size,
    playerSamples:countryH2HPlayerSamples,
    cardRate:countryH2HYellows/countryH2HPlayerSamples,
    foulsPerPlayer:countryH2HFouls/countryH2HPlayerSamples,
  } : null

  const confirmed = radar?.lineupsConfirmed === true
  const lineupMode: "confirmed" | "predicted" | "squad" = confirmed ? "confirmed" : radar?.lineupMode === "predicted" ? "predicted" : "squad"
  const predicted = lineupMode === "predicted"
  const recommendationsAllowed = confirmed || predicted
  const players: ScorePlayer[] = candidates.map(candidate => {
    const allRows = history.filter(row => row.playerName === candidate.dbName && played(row))
    const internationalRows = competition==="International"
      ? allRows.filter(row=>isInternationalHistoryCompetition(row.competition)&&String(row.matchDate??"")>="2026-01-01")
      : []
    // National-team role first. Club rows only rescue a genuinely tiny international sample.
    const primaryRows = competition==="International"&&internationalRows.length>=2 ? internationalRows : allRows
    const rows = recommendationsAllowed ? starterRows(primaryRows) : primaryRows
    const opponent = teamMatch(candidate.team, home) ? away : home
    const h2hRows = competition==="International"
      ? allRows.filter(row=>
          isInternationalHistoryCompetition(row.competition) &&
          String(row.matchDate??"")>="2021-06-01" &&
          teamMatch(row.opponent,opponent)
        )
      : rows.filter(row => teamMatch(row.opponent, opponent))
    const recent5Rows = [...rows].sort((a, b) => String(a.matchDate).localeCompare(String(b.matchDate))).slice(-5)
    const sampleMinutes = rows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const intlStarts=internationalRows.filter(row=>row.starter===true).length
    const intlMinutes=internationalRows.reduce((sum,row)=>sum+Number(row.minutes??0),0)
    const intlExpectedMinutes=internationalRows.length
      ? Math.max(35,Math.min(90,(intlMinutes/internationalRows.length)*.65+(55+35*(intlStarts/internationalRows.length))*.35))
      : null
    const expectedMinutes = competition==="International"&&intlExpectedMinutes!=null
      ? intlExpectedMinutes
      : estimateExpectedMinutes(allRows,recommendationsAllowed)

    const matchupCandidate = candidates.find(other => norm(other.name) === norm(candidate?.likelyMatchup?.name) || norm(other.dbName) === norm(candidate?.likelyMatchup?.name))
    const matchupFouls90 = Number(matchupCandidate?.fouls90 ?? 0)
    const matchupFouledRaw = candidate?.likelyMatchup?.pressureFouled90 ?? candidate?.likelyMatchup?.fouled90
    const matchupFouled90 = matchupFouledRaw == null ? null : Number(matchupFouledRaw)
    const directMatchup = candidate?.likelyMatchup?.type === "direct-predicted-role"
    const matchupConfidence = Number(candidate?.likelyMatchup?.confidence ?? 0)
    const h2hContext=weightedH2HContext({
      candidate,
      opponent,
      h2hRows,
      allHistory:history,
      currentCandidates:candidates,
      matchupCandidate:matchupCandidate??null,
      targetDate:date,
    })

    const rolePrior=cardRolePrior(candidate.position)
    const domesticCurrent=candidate?.domesticCurrent??null
    const domesticCompetition=norm(String(domesticCurrent?.competition??""))
    const currentClubRows=allRows.filter(row=>
      !isInternationalHistoryCompetition(row.competition) &&
      rowDate(row)>="2026-08-01" &&
      (!domesticCompetition||norm(String(row.competition??""))!==domesticCompetition)
    )
    const clubMatches=Number(domesticCurrent?.appearances??0)+currentClubRows.length
    const clubYellows=Number(domesticCurrent?.yellowCards??0)+currentClubRows.filter(row=>row.yellowCard===true).length
    const clubCardRate=clubMatches>0?clubYellows/clubMatches:null
    const clubCompetitions=[...new Set([
      String(domesticCurrent?.competition??""),
      ...currentClubRows.map(row=>String(row.competition??"")),
    ].filter(Boolean))]
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
      let probability = market==="card"
        ? cardEmpiricalProbability(rows,rolePrior)
        : empiricalProbability(rows, market)
      const recent5HitRate = hitRate(recent5Rows, market)
      const seasonHitRate = hitRate(rows, market)
      const h2hHitRate = h2hRows.length ? hitRate(h2hRows, market) : null
      const weightedH2HRate=h2hContext.weightedRate(market)
      const overlap=h2hContext.averageLineupOverlap??0
      const sampleReliability=h2hRows.length/(h2hRows.length+3)
      const sameMatchupBoost=h2hContext.sameMatchupMeetings>0?0.06:0
      // Repeat H2H patterns matter more than a generic one-off meeting. A 2/2,
      // 2/3 or 3/3 pattern should materially move the estimate, especially for
      // fouls/cards, while still being shrunk by sample size and lineup overlap.
      const repeatPatternBoost=h2hRows.length>=2&&Number(h2hHitRate??0)>=0.66
        ? (market==="card"||market.startsWith("foul")?0.13:0.08)
        : h2hRows.length>=2&&Number(h2hHitRate??0)>=0.50
          ? (market==="card"||market.startsWith("foul")?0.07:0.04)
          : 0
      const maxWeight=market==="card"||market.startsWith("foul")?0.48:market.startsWith("shot")||market.startsWith("sot")?0.34:0.28
      const h2hWeight=Math.min(maxWeight,(0.11+overlap*0.18+sameMatchupBoost+repeatPatternBoost)*sampleReliability)
      probability = blend(probability, weightedH2HRate??h2hHitRate, h2hWeight)

      const threshold = thresholdForMarket(market)
      const minutesScale = expectedMinutes / 90
      const historicGoal90 = sampleMinutes>0 ? (rows.reduce((sum,row)=>sum+Number(row.goals??0),0)*90)/sampleMinutes : 0
      const historicAssist90 = sampleMinutes>0 ? (rows.reduce((sum,row)=>sum+Number(row.assists??0),0)*90)/sampleMinutes : 0
      const rowPer90=(key:"shots"|"shotsOnTarget"|"foulsDrawn"|"foulsCommitted")=>
        sampleMinutes>0?(rows.reduce((sum,row)=>sum+Number((row as any)?.[key]??0),0)*90)/sampleMinutes:0
      const internationalFirst=competition==="International"&&internationalRows.length>=2
      const per90 = market.startsWith("goal")
        ? historicGoal90
        : market.startsWith("assist")
          ? historicAssist90
        : market.startsWith("sot")
          ? (internationalFirst?rowPer90("shotsOnTarget"):Number(candidate.shotsOnTarget90 ?? 0))
          : market.startsWith("shot")
            ? (internationalFirst?rowPer90("shots"):Number(candidate.shots90 ?? 0))
            : market.startsWith("fouled")
              ? (internationalFirst?rowPer90("foulsDrawn"):Number(candidate.fouled90 ?? 0))
              : market.startsWith("foul")
                ? (internationalFirst?rowPer90("foulsCommitted"):Number(candidate.fouls90 ?? 0))
                : 0

      if (market !== "card" && per90 > 0) {
        const mean=per90*minutesScale
        const poisson = poissonAtLeast(mean, threshold)
        const countProbability = market.startsWith("foul")
          ? Math.max(poisson,negativeBinomialAtLeast(mean,foulDispersion(rows),threshold))
          : poisson
        const countWeight = rows.length < 5 ? 0.42 : rows.length < 10 ? 0.28 : 0.18
        probability = blend(probability, countProbability, countWeight)
      }

      if (market.startsWith("foul") && !market.startsWith("fouled")) {
        if(market==="foul1"&&h2hRows.length>=2&&Number(h2hHitRate??0)>=0.66){
          const repeatReliability=Math.min(1,h2hRows.length/4)
          probability=logitAdjust(probability,0.12*repeatReliability)
        }
        if(h2hContext.sameMatchupMeetings>0&&h2hContext.sameMatchupFouls>0){
          const perMeeting=h2hContext.sameMatchupFouls/Math.max(1,h2hContext.sameMatchupMeetings)
          const reliability=Math.min(1,h2hContext.sameMatchupMeetings/3)
          probability=logitAdjust(probability,Math.min(.22,(perMeeting-1)*.10*reliability))
        }
        if (matchupFouled90 != null && matchupFouled90 > 0) {
          const roleWeight=directMatchup ? 0.17 : 0.10
          const confidenceWeight=directMatchup ? Math.max(0.78,Math.min(1.08,matchupConfidence||0.9)) : 0.82
          const thresholdWeight=Math.min(1.35,0.92+threshold*0.08)
          probability = logitAdjust(probability, (matchupFouled90 - 1.35) * roleWeight * confidenceWeight * thresholdWeight)
        }
      }
      if (market === "fouled1" && matchupFouls90 > 0) {
        probability = logitAdjust(probability, (matchupFouls90 - 1.35) * 0.12)
      }
      if (market === "card") {
        const overallRate = rows.length ? yellowOverall / rows.length : rolePrior
        if(clubMatches>=3&&clubCardRate!=null){
          const clubSmoothed=betaSmoothed(clubYellows,clubMatches,rolePrior,8)
          const clubWeight=.08+.14*Math.min(1,clubMatches/12)
          probability=blend(probability,clubSmoothed,clubWeight)
        }
        if(h2hRows.length>=2&&h2hContext.cards===0){
          const reliability=Math.min(1,h2hRows.length/4)
          const overlapWeight=.78+.45*(h2hContext.averageLineupOverlap??0)
          probability=logitAdjust(probability,-.16*reliability*overlapWeight)
        }
        if(h2hRows.length>=2&&Number(h2hHitRate??0)>=0.66){
          const repeatReliability=Math.min(1,h2hRows.length/4)
          probability=logitAdjust(probability,0.16*repeatReliability)
        }
        if(h2hRows.length>0&&h2hContext.cards>0){
          const cardRate=h2hContext.cards/h2hRows.length
          const overlap=h2hContext.averageLineupOverlap??0
          const reliability=Math.min(1,h2hRows.length/4)
          probability=logitAdjust(probability,Math.min(.34,(cardRate-overallRate)*(.38+.32*overlap)*reliability))
        }
        if(h2hContext.sameMatchupCards>0){
          probability=logitAdjust(probability,Math.min(.20,.10*h2hContext.sameMatchupCards))
        }
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
        if (matchupFouled90 != null && matchupFouled90 > 0) {
          const cardMatchupWeight=directMatchup ? 0.10 : 0.055
          probability = logitAdjust(probability, (matchupFouled90 - 1.35) * cardMatchupWeight)
        }
        const playerFouls90=rowPer90("foulsCommitted")
        if(playerFouls90>0){
          if(playerFouls90>=1.8)probability=logitAdjust(probability,Math.min(.12,(playerFouls90-1.8)*.08))
          else if(playerFouls90<.8)probability=logitAdjust(probability,-Math.min(.10,(.8-playerFouls90)*.10))
        }
        const refYellows = Number(radar?.referee?.yellowsPerGame ?? 0)
        if (refYellows > 0) probability = logitAdjust(probability, (refYellows - 4.2) * 0.055)
        if(countryH2HContext&&countryH2HContext.matches>=2&&countryH2HContext.playerSamples>=12){
          const reliability=Math.min(1,countryH2HContext.playerSamples/36)
          probability=logitAdjust(probability,(countryH2HContext.cardRate-0.22)*0.70*reliability)
          probability=logitAdjust(probability,(countryH2HContext.foulsPerPlayer-1.35)*0.035*reliability)
        }
      }

      const rawProbability = probability
      const calibrated = calibrationFor(competition, market, rawProbability)
      probability = market==="card"
        ? blend(rawProbability,calibrated.probability,.45)
        : calibrated.probability

      const odd = findOdds(usableSelections, candidate.name, market, candidates.map(x=>String(x.name??"")))
      const bookmakerOdds = odd?.odd == null ? null : Number(odd.odd)
      const previousBookmakerOdds = odd?.previousOdd == null ? null : Number(odd.previousOdd)
      const bookmakerMovement = odd?.movement == null ? null : Number(odd.movement)
      const impliedProbability = bookmakerOdds ? 1 / bookmakerOdds : null
      const bookmakerNoVigProbability = odd?.noVigProbability==null?null:clamp(Number(odd.noVigProbability))
      const bookmakerConsensus = bookmakerNoVigProbability??impliedProbability
      const edge = bookmakerConsensus == null ? null : probability - bookmakerConsensus
      const expectedValue = bookmakerOdds == null ? null : probability * bookmakerOdds - 1

      const recommendationScore=market==="card"
        ? cardRecommendationScore({
            probability,
            recent5:recent5HitRate,
            season:seasonHitRate,
            h2hN:h2hRows.length,
            h2hCards:h2hContext.cards,
            conditional2:cond2,
            foulPer90:rowPer90("foulsCommitted"),
            clubMatches,
            clubCardRate,
          })
        : probability

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
        bookmakerName: odd?.bookmaker ?? odds?.bookmaker ?? null,
        impliedProbability: impliedProbability == null ? null : Math.round(impliedProbability * 1000) / 1000,
        edge: edge == null ? null : Math.round(edge * 1000) / 1000,
        expectedValue: expectedValue == null ? null : Math.round(expectedValue * 1000) / 1000,
        sampleMatches: rows.length,
        recent5HitRate: Math.round(recent5HitRate * 1000) / 1000,
        seasonHitRate: Math.round(seasonHitRate * 1000) / 1000,
        h2hHitRate: h2hHitRate == null ? null : Math.round(h2hHitRate * 1000) / 1000,
        h2hMatches:h2hRows.length,
        h2hLineupOverlap:h2hContext.averageLineupOverlap==null?null:Math.round(h2hContext.averageLineupOverlap*1000)/1000,
        sameMatchupMeetings:h2hContext.sameMatchupMeetings,
        reasons: marketReasons({
          market,
          probability,
          recent5: recent5HitRate,
          season: seasonHitRate,
          h2hRate: h2hHitRate,
          h2hN: h2hRows.length,
          h2hCards:h2hContext.cards,
          h2hLineupOverlap:h2hContext.averageLineupOverlap,
          sameMatchupMeetings:h2hContext.sameMatchupMeetings,
          sameMatchupCards:h2hContext.sameMatchupCards,
          sameMatchupFouls:h2hContext.sameMatchupFouls,
          matchupName: candidate?.likelyMatchup?.name ?? null,
          matchupFouled90,
          conditional2: cond2,
          countryH2H:countryH2HContext,
          clubMatches,
          clubYellows,
          clubCardRate,
        }),
      }
    }

    const offeredCardLines=exactCardSelections(usableSelections,candidate.name,candidates.map(x=>String(x.name??""))).map(selection=>{
      const probability=markets.card.probability
      const bookmakerOdds=Number(selection.odd)
      const impliedProbability=1/bookmakerOdds
      return {
        bookmaker:selection.bookmaker ?? "UK bookmaker",
        bookmakerOdds,
        bookmakerMarket:selection.market,
        bookmakerLabel:selection.label,
        probability,
        fairOdds:fairOdds(probability),
        edge:Math.round((probability-impliedProbability)*1000)/1000,
        expectedValue:Math.round((probability*bookmakerOdds-1)*1000)/1000,
        confidence,
      }
    })

    const offeredFoulLines:OfferedFoulLine[]=exactFoulSelections(usableSelections, candidate.name, candidates.map(x=>String(x.name??""))).map(({threshold,selection})=>{
      const standardKey = threshold>=1&&threshold<=5 ? ("foul"+threshold) as MarketKey : null
      const probability = standardKey
        ? markets[standardKey].probability
        : dynamicFoulProbability({rows,threshold,per90:Number(candidate.fouls90??0),expectedMinutes,matchupFouled90})
      const bookmakerOdds=Number(selection.odd)
      const impliedProbability=1/bookmakerOdds
      return {
        threshold,
        label:threshold+"+ fouls committed",
        bookmakerMarket:selection.market,
        bookmakerLabel:selection.label,
        bookmakerOdds,
        previousBookmakerOdds:selection.previousOdd==null?null:Number(selection.previousOdd),
        bookmakerMovement:selection.movement==null?null:Number(selection.movement),
        bookmaker:selection.bookmaker ?? odds?.bookmaker ?? "UK bookmaker",
        impliedProbability:Math.round(impliedProbability*1000)/1000,
        probability:Math.round(probability*1000)/1000,
        fairOdds:fairOdds(probability),
        edge:Math.round((probability-impliedProbability)*1000)/1000,
        expectedValue:Math.round((probability*bookmakerOdds-1)*1000)/1000,
        calibrated:Boolean(standardKey && (calibrationSnapshot as any)?.global?.[standardKey]),
        sampleMatches:rows.length,
        confidence,
        priceSource:"exact" as const,
      }
    })

    const likelyFoulLines:OfferedFoulLine[]=[...offeredFoulLines]
    for(const bookmaker of eligibleBooks){
      const exactForBook=offeredFoulLines.filter(line=>line.bookmaker===bookmaker)
      const marginSamples=exactForBook
        .map(line=>line.probability>0?(1/line.bookmakerOdds)/line.probability:0)
        .filter(v=>v>=0.95&&v<=1.35)
      const margin=Math.max(1.02,Math.min(1.18,median(marginSamples)??1.075))
      for(let threshold=1;threshold<=5;threshold++){
        if(exactForBook.some(line=>line.threshold===threshold))continue
        const key=("foul"+threshold) as MarketKey
        const probability=markets[key].probability
        const bookmakerOdds=roundLikelyBookOdds(1/Math.min(.985,probability*margin))
        const impliedProbability=1/bookmakerOdds
        likelyFoulLines.push({
          threshold,
          label:threshold+"+ fouls committed",
          bookmakerMarket:"Estimated player fouls",
          bookmakerLabel:threshold+"+ fouls committed",
          bookmakerOdds,
          previousBookmakerOdds:null,
          bookmakerMovement:null,
          bookmaker,
          impliedProbability:Math.round(impliedProbability*1000)/1000,
          probability,
          fairOdds:fairOdds(probability),
          edge:Math.round((probability-impliedProbability)*1000)/1000,
          expectedValue:Math.round((probability*bookmakerOdds-1)*1000)/1000,
          calibrated:Boolean((calibrationSnapshot as any)?.global?.[key]),
          sampleMatches:rows.length,
          confidence,
          priceSource:"estimated",
        })
      }
    }

    // Keep estimated bookmaker ladders monotonic. Exact feed prices are never rewritten.
    for(const bookmaker of eligibleBooks){
      const ladder=likelyFoulLines.filter(line=>line.bookmaker===bookmaker).sort((a,b)=>a.threshold-b.threshold)
      let previous=1
      for(const line of ladder){
        if(line.priceSource==="estimated" && line.bookmakerOdds<=previous){
          const step=previous<2?0.01:previous<4?0.02:previous<8?0.05:0.1
          line.bookmakerOdds=Math.round((previous+step)*100)/100
          line.impliedProbability=Math.round((1/line.bookmakerOdds)*1000)/1000
          line.edge=Math.round((line.probability-line.impliedProbability)*1000)/1000
          line.expectedValue=Math.round((line.probability*line.bookmakerOdds-1)*1000)/1000
        }
        previous=Math.max(previous,line.bookmakerOdds)
      }
    }

    return {
      name: candidate.name,
      dbName: candidate.dbName,
      team: candidate.team,
      lineupStatus: lineupMode,
      lineupConfidence: confirmed ? "official" : String(candidate?.predictedLineupConfidence ?? candidate?.sampleLabel ?? "predicted"),
      position: candidate.position ?? null,
      sampleMatches: rows.length,
      sampleMinutes,
      expectedMinutes,
      matchup: candidate?.likelyMatchup ? { name: candidate.likelyMatchup.name, role: candidate.likelyMatchup.role ?? null, fouled90: matchupFouled90, type:candidate.likelyMatchup.type ?? null, seasonFouled90:candidate.likelyMatchup.seasonFouled90 ?? null, recentFouled90:candidate.likelyMatchup.recentFouled90 ?? null } : null,
      cardContext:{
        rolePrior:Math.round(rolePrior*1000)/1000,
        clubMatches,
        clubYellows,
        clubCardRate:clubCardRate==null?null:Math.round(clubCardRate*1000)/1000,
        clubCompetitions,
      },
      h2hContext:{
        matches:h2hRows.length,
        cards:h2hContext.cards,
        fouls:h2hContext.fouls,
        fouled:h2hContext.fouled,
        shots:h2hContext.shots,
        shotsOnTarget:h2hContext.shotsOnTarget,
        averageLineupOverlap:h2hContext.averageLineupOverlap==null?null:Math.round(h2hContext.averageLineupOverlap*1000)/1000,
        sameMatchupMeetings:h2hContext.sameMatchupMeetings,
        sameMatchupCards:h2hContext.sameMatchupCards,
        sameMatchupFouls:h2hContext.sameMatchupFouls,
      },
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
      offeredCardLines,
      offeredFoulLines,
      likelyFoulLines,
    }
  }).sort((a, b) => b.markets.foul1.probability - a.markets.foul1.probability)

  const recommendationSlips = buildSlips(players)
  const enrichedRecommendationSlips = recommendationSlips.map(slip => {
    const books=[...new Set(slip.legs.map(leg=>leg.bookmakerName).filter(Boolean))] as string[]
    const bookmaker=books.length===1?books[0]:null
    return {
      ...slip,
      bookmaker,
      placeable: recommendationsAllowed && Boolean(bookmaker) && eligibleBooks.includes(bookmaker!) && slip.legs.every(leg=>leg.bookmakerOdds!=null),
      marketAvailability: slip.legs.map(leg => ({
        player: leg.player,
        market: leg.market,
        status: bookmaker ? availabilityForMarket(bookmakerAvailability[bookmaker]??marketAvailability, leg.market) : "unknown",
      })),
    }
  })
  // Before official teams, use the probable XI. Once official lineups arrive,
  // the radar swaps the candidate pool to confirmed starters and this scorecard rebuilds.
  const slips = recommendationsAllowed ? enrichedRecommendationSlips : []
  const previewSlips: typeof enrichedRecommendationSlips = []
  const riskBuilders = recommendationsAllowed ? buildRiskBuilders(players) : []
  const foulRecommendations = buildFoulTargetSlips(players).map(slip => ({
    ...slip,
    placeable: recommendationsAllowed && slip.legs.length > 0 && Boolean(slip.bookmaker) && eligibleBooks.includes(slip.bookmaker!) && slip.usesLivePrices && slip.withinTargetRange,
    marketStatus: slip.bookmaker ? (bookmakerAvailability[slip.bookmaker]?.foul ?? "unknown") : "unknown",
  }))
  const foulTargetSlips = recommendationsAllowed ? foulRecommendations : []
  const previewFoulTargetSlips: typeof foulRecommendations = []

  return NextResponse.json({
    ok: true,
    competition,
    date,
    home,
    away,
    lineupsConfirmed: confirmed,
    lineupMode,
    lineupSource: radar?.lineupSource ?? (confirmed ? "Official starting XI" : predicted ? "Probable XI" : "Current squad"),
    predictedLineups: radar?.predictedLineups ?? null,
    status: confirmed ? "confirmed-lineup-scorecard" : predicted ? "predicted-lineup-scorecard" : "pre-lineup-research",
    bookmaker: odds?.bookmaker ?? null,
    oddsSource: odds?.source ?? null,
    oddsCapturedAt,
    oddsAgeSeconds,
    oddsFreshness,
    freeTier: odds?.freeTier !== false,
    marketAvailability,
    availableBets:Array.isArray(odds?.availableBets)?odds.availableBets:[],
    oddsSelections:Array.isArray(odds?.selections)?odds.selections:[],
    bookmakerAvailability,
    eligibleBooks,
    priceAvailable: Boolean(odds?.priceAvailable) && oddsFreshness !== "STALE",
    referee: radar?.referee ?? null,
    countryH2HContext:countryH2HContext ? {
      matches:countryH2HContext.matches,
      playerSamples:countryH2HContext.playerSamples,
      cardRate:Math.round(countryH2HContext.cardRate*1000)/1000,
      foulsPerPlayer:Math.round(countryH2HContext.foulsPerPlayer*100)/100,
    } : null,
    playerCount: players.length,
    players,
    exactCardOffers: players.flatMap(player => player.offeredCardLines.map(line => ({
      player:player.name,
      team:player.team,
      position:player.position,
      ...line,
    }))).sort((a,b)=>(b.edge-a.edge)||(b.probability-a.probability)),
    estimatedFoulOffers: players.flatMap(player => player.likelyFoulLines.filter(line=>line.priceSource==="estimated").map(line => ({
      player:player.name,
      team:player.team,
      position:player.position,
      ...line,
    }))).sort((a,b)=>(b.edge-a.edge)||(b.probability-a.probability)),
    exactFoulOffers: players.flatMap(player => player.offeredFoulLines.map(line => ({
      player: player.name,
      team: player.team,
      position: player.position,
      ...line,
    }))).sort((a,b) => (b.edge-a.edge) || (b.probability-a.probability)),
    slips,
    previewSlips,
    riskBuilders,
    foulTargetSlips,
    previewFoulTargetSlips,
    methodology: {
      version: "scorecard-v2-calibrated",
      description: "Player-level pre-match probabilities use only match rows dated before the target fixture. Before official teams are released, the model uses a probable XI built from current squad availability, start rate, minutes and any stronger published predicted-XI source available. Once official lineups arrive, predicted starters are discarded and the scorecard is rebuilt from the confirmed XI. For international fixtures, senior international appearances from Euro 2024 onward are the primary player sample for minutes, shots, SOT, fouls, fouls drawn, goals, assists and cards; club form only stabilises thin national-team samples. Domestic fixtures use club history. All probabilities also incorporate recency, opponent H2H, expected minutes, matchup pressure, count-rate checks, referee/card context and walk-forward calibration. H2H is lineup-aware: previous meetings receive more weight when more of today's predicted/confirmed opponents also played, and the strongest extra weight is reserved for a returning likely direct matchup.",
      cardConditional: "Yellow-card estimates measure each player's booking rate at 0 fouls, exactly 1, exactly 2, 3+, 1+ and 2+ foul states, with sample-size reliability. Match-level data still cannot identify the exact foul that triggered the booking.",
      calibrationWarning: "Displayed probabilities are adjusted through walk-forward calibration built from earlier-match-only predictions across 30 competitions. They remain estimates, not guarantees.",
      slipWarning: "Same-player and same-match legs can be correlated. Exact individual bookmaker foul lines are mirrored only when their threshold is explicitly present in the feed. Bet365's same-game Builder price is proprietary and is not labelled exact unless a bookmaker builder quote is supplied.",
      priceFreshness: "Exact prices come from the preferred bookmaker feed. When a bookmaker's foul market is verified but a specific threshold price is missing, a clearly labelled estimate is derived from the model probability and that bookmaker's observed margin on the player's other foul lines.",
    },
    generatedAt: new Date().toISOString(),
  })
}
