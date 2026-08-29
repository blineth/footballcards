import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, playerRefereeHistory } from "@/lib/db/schema"
import { getRefereeByName } from "@/lib/historical"
import { and, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"
import { GET as espnGET } from "../fixture-radar-espn/route"

export const dynamic = "force-dynamic"

const CURRENT_SEASON_START = "2026-08-21"

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function csvDate(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return ""
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
}
async function footballDataReferee(date: string, home: string, away: string, competition: string) {
  if (competition !== "Premier League") return null
  try {
    const response = await fetch("https://www.football-data.co.uk/mmz4281/2627/E0.csv", { cache: "no-store", signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const lines = (await response.text()).split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    const headers = lines[0].split(",").map((value) => value.replace(/^\uFEFF/, "").trim())
    const dateIndex = headers.indexOf("Date"), homeIndex = headers.indexOf("HomeTeam"), awayIndex = headers.indexOf("AwayTeam"), refereeIndex = headers.indexOf("Referee")
    if ([dateIndex, homeIndex, awayIndex, refereeIndex].some((index) => index < 0)) return null
    for (const line of lines.slice(1)) {
      const cells = line.split(",")
      if (csvDate(cells[dateIndex] ?? "") !== date) continue
      if (!teamMatch(cells[homeIndex], home) || !teamMatch(cells[awayIndex], away)) continue
      const referee = String(cells[refereeIndex] ?? "").trim()
      if (referee) return referee
    }
  } catch {}
  return null
}
function confirmedAppointmentFallback(date: string, home: string, away: string, competition: string) {
  if (competition !== "Premier League") return null
  const appointments: Record<string, string> = { "2026-08-22|nottingham forest|leeds united": "Robert Jones" }
  return appointments[`${date}|${norm(home)}|${norm(away)}`] ?? null
}

async function addCurrentSeasonLayer(data: any, competition: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const names = Array.from(new Set(data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean))) as string[]
  const rows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), eq(playerH2H.competition, competition))) : []
  const currentRows = rows.filter((row) => String(row.matchDate ?? "") >= CURRENT_SEASON_START)
  data.candidates = data.candidates.map((candidate: any) => {
    const playerRows = currentRows.filter((row) => row.playerName === candidate.dbName)
    const games = playerRows.length
    const minutes = playerRows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const fouls = playerRows.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const yellows = playerRows.filter((row) => row.yellowCard === true).length
    const fouls90 = minutes > 0 ? (fouls * 90) / minutes : null
    const cards90 = minutes > 0 ? (yellows * 90) / minutes : null
    const recentScore = minutes > 0 ? Math.min(100, (Math.min(1, Number(fouls90) / 2.5) * 55) + (Math.min(1, Number(cards90) / 0.6) * 45)) : Number(candidate.score ?? 0)
    const recentWeight = Math.min(0.35, minutes / 900)
    const score = Math.round(((Number(candidate.score ?? 0) * (1 - recentWeight)) + (recentScore * recentWeight)) * 10) / 10
    return { ...candidate, score, band: score >= 70 ? "STRONG" : score >= 55 ? "GOOD" : "WATCH", currentSeason: { season: "2026/27", games, minutes, fouls, yellows, fouls90: fouls90 == null ? null : Math.round(fouls90 * 100) / 100, cards90: cards90 == null ? null : Math.round(cards90 * 100) / 100, evidenceWeight: Math.round(recentWeight * 100) } }
  })
  data.currentSeasonLayer = { season: "2026/27", from: CURRENT_SEASON_START, playerMatchRows: currentRows.length, weighting: "Recent season starts at about 10% after one full match and grows to a 35% cap" }
  return data
}

function h2hRank(candidate: any) {
  if (Number(candidate.h2hYellows ?? 0) > 0) return 2
  if (Number(candidate.h2hFouls ?? 0) > 0) return 1
  return 0
}
function candidateOrder(a: any, b: any) {
  return h2hRank(b) - h2hRank(a) || Number(b.h2hYellows ?? 0) - Number(a.h2hYellows ?? 0) || Number(b.h2hFouls ?? 0) - Number(a.h2hFouls ?? 0) || Number(b.score ?? 0) - Number(a.score ?? 0)
}
async function addH2HMatchesAndBalance(data: any, home: string, away: string, competition: string, fixtureDate: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const names = Array.from(new Set(data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean))) as string[]
  const rows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), eq(playerH2H.competition, competition))) : []
  data.candidates = data.candidates.map((candidate: any) => {
    const opponent = teamMatch(candidate.team, home) ? away : home
    const matches = rows.filter((row) => row.playerName === candidate.dbName && teamMatch(row.opponent, opponent) && (!fixtureDate || String(row.matchDate) < fixtureDate)).sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate))).slice(0, 8)
    return { ...candidate, h2hYellows: matches.filter((row) => row.yellowCard === true).length, h2hFouls: matches.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0), h2hMatches: matches.map((row) => ({ matchDate: String(row.matchDate), opponent: row.opponent, venue: row.venue, competition: row.competition, minutes: row.minutes, foulsCommitted: row.foulsCommitted, foulsDrawn: row.foulsDrawn, yellowCard: row.yellowCard, redCard: row.redCard })) }
  })
  const homeCandidates = data.candidates.filter((c: any) => teamMatch(c.team, home)).sort(candidateOrder).slice(0, 5)
  const awayCandidates = data.candidates.filter((c: any) => teamMatch(c.team, away)).sort(candidateOrder).slice(0, 5)
  data.candidates = [...homeCandidates, ...awayCandidates].sort(candidateOrder)
  data.rankingMethod = "Top 10: five per team where data is available; H2H bookings first, then H2H fouls, then wider evidence"
  return data
}

function compatibleRole(position: string | null | undefined, opponentPosition: string | null | undefined) {
  const p = norm(position), o = norm(opponentPosition)
  if (!p || !o) return true
  if (p.includes("def")) return o.includes("for") || o.includes("mid")
  if (p.includes("for")) return o.includes("def")
  if (p.includes("mid")) return o.includes("mid") || o.includes("def")
  return true
}

async function addDeepEvidence(data: any, home: string, away: string, competition: string, refereeName: string | null) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const names = Array.from(new Set(data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean))) as string[]
  const [baselines, matchRows, refereeRows] = await Promise.all([
    db.select().from(playerBaselines).where(and(inArray(playerBaselines.playerName, names), eq(playerBaselines.season, "2025/26"))),
    db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), eq(playerH2H.competition, competition))),
    refereeName ? db.select().from(playerRefereeHistory).where(and(inArray(playerRefereeHistory.playerName, names), eq(playerRefereeHistory.refereeName, refereeName))) : Promise.resolve([]),
  ])

  let enriched = data.candidates.map((candidate: any) => {
    const baseline = baselines.find((row) => row.playerName === candidate.dbName)
    const baselineMinutes = Number(baseline?.minutes ?? candidate.minutes ?? 0)
    const foulsDrawn = Number(baseline?.foulsDrawn ?? 0)
    const fouled90 = baselineMinutes > 0 ? Math.round(((foulsDrawn * 90) / baselineMinutes) * 100) / 100 : null
    const recent = matchRows.filter((row) => row.playerName === candidate.dbName).sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate))).slice(0, 5)
    const recentMinutes = recent.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const recentFouls = recent.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const recentYellows = recent.filter((row) => row.yellowCard === true).length
    const recentFouls90 = recentMinutes > 0 ? Math.round(((recentFouls * 90) / recentMinutes) * 100) / 100 : null
    const ref = refereeRows.find((row: any) => row.playerName === candidate.dbName)
    const refMatches = Number(ref?.matchesTogether ?? 0)
    const refYellows = Number(ref?.yellowCards ?? 0)
    const refereeCardRate = refMatches > 0 ? Math.round((refYellows / refMatches) * 100) / 100 : null
    return { ...candidate, fouled90, recentFive: { games: recent.length, minutes: recentMinutes, fouls: recentFouls, yellows: recentYellows, fouls90: recentFouls90, matches: recent.map((row) => ({ matchDate: String(row.matchDate), opponent: row.opponent, minutes: row.minutes, foulsCommitted: row.foulsCommitted, foulsDrawn: row.foulsDrawn, yellowCard: row.yellowCard })) }, refereePlayer: ref ? { matches: refMatches, yellows: refYellows, fouls: Number(ref.foulsCommitted ?? 0), cardRate: refereeCardRate } : null }
  })

  enriched = enriched.map((candidate: any) => {
    const opposing = enriched.filter((other: any) => !teamMatch(other.team, candidate.team) && compatibleRole(candidate.position, other.position))
    const matchup = opposing.sort((a: any, b: any) => Number(b.fouled90 ?? -1) - Number(a.fouled90 ?? -1))[0] ?? null
    const repeatedH2H = Number(candidate.h2hYellows ?? 0)
    const recentYC = Number(candidate.recentFive?.yellows ?? 0)
    const recentF90 = Number(candidate.recentFive?.fouls90 ?? 0)
    const matchupPressure = Number(matchup?.fouled90 ?? 0)
    const refPlayerRate = Number(candidate.refereePlayer?.cardRate ?? 0)
    const base = Number(candidate.score ?? 0)
    const deepScore = Math.min(100, Math.round((base * 0.58 + Math.min(24, repeatedH2H * 12) + Math.min(10, Number(candidate.h2hFouls ?? 0) * 1.5) + Math.min(10, recentYC * 5) + Math.min(8, recentF90 * 3) + Math.min(7, matchupPressure * 2.5) + Math.min(7, refPlayerRate * 7)) * 10) / 10)
    const reasons: string[] = []
    if (repeatedH2H >= 2) reasons.push(`Booked in ${repeatedH2H} previous H2Hs`)
    else if (repeatedH2H === 1) reasons.push("Has a previous H2H booking")
    if (Number(candidate.h2hFouls ?? 0) >= 3) reasons.push(`${candidate.h2hFouls} fouls in previous H2Hs`)
    if (recentYC >= 2) reasons.push(`${recentYC} yellows in last ${candidate.recentFive?.games ?? 5} matches`)
    else if (recentYC === 1) reasons.push("Booked in recent 5-match sample")
    if (recentF90 >= 1.5) reasons.push(`${recentF90.toFixed(2)} fouls/90 over recent matches`)
    if (Number(candidate.cards90 ?? 0) >= 0.3) reasons.push(`${Number(candidate.cards90).toFixed(2)} cards/90 last season`)
    if (matchup && matchupPressure >= 1.5) reasons.push(`Likely matchup ${matchup.name} draws ${matchupPressure.toFixed(2)} fouls/90`)
    if (candidate.refereePlayer?.matches >= 2 && refPlayerRate >= 0.4) reasons.push(`Booked in ${candidate.refereePlayer.yellows}/${candidate.refereePlayer.matches} games under this referee`)
    return { ...candidate, likelyMatchup: matchup ? { name: matchup.name, position: matchup.position ?? null, fouled90: matchup.fouled90 } : null, cardRiskScore: deepScore, shortlistReasons: reasons.slice(0, 4) }
  }).sort((a: any, b: any) => Number(b.cardRiskScore ?? 0) - Number(a.cardRiskScore ?? 0))

  data.candidates = enriched
  data.deepEvidence = { description: "Card evidence combines historical cards/fouls, H2H, recent-five form, foul-drawn matchup pressure, current-season evidence and player-referee history when available. Likely matchup is a role-based proxy before confirmed tactical assignments." }
  return data
}

export async function GET(request: Request) {
  const response = await espnGET(request)
  if (!response.ok) return response
  try {
    let data = await response.json()
    const url = new URL(request.url)
    const date = url.searchParams.get("date") ?? "", home = url.searchParams.get("home") ?? "", away = url.searchParams.get("away") ?? "", competition = url.searchParams.get("competition") ?? "Premier League"
    data = await addCurrentSeasonLayer(data, competition)
    data = await addH2HMatchesAndBalance(data, home, away, competition, date)

    let refereeName = data?.referee?.name ?? null
    let refereeSource = refereeName ? "ESPN" : null
    if (!refereeName && date && home && away) { refereeName = await footballDataReferee(date, home, away, competition); if (refereeName) refereeSource = "Football-Data" }
    if (!refereeName && date && home && away) { refereeName = confirmedAppointmentFallback(date, home, away, competition); if (refereeName) refereeSource = "confirmed appointment fallback" }
    if (refereeName) {
      const historical = await getRefereeByName(refereeName)
      data.referee = { ...(data.referee ?? {}), name: refereeName, source: refereeSource, yellowsPerGame: historical?.yellowsPerGame != null ? Number(historical.yellowsPerGame) : data.referee?.yellowsPerGame ?? null, foulsPerGame: historical?.foulsPerGame != null ? Number(historical.foulsPerGame) : data.referee?.foulsPerGame ?? null, matches: historical?.matchesRefereed ?? data.referee?.matches ?? null }
    }
    data = await addDeepEvidence(data, home, away, competition, refereeName)
    return NextResponse.json(data)
  } catch {
    return response
  }
}
