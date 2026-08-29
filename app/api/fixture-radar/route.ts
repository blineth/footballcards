import { db, isDatabaseConfigured } from "@/lib/db"
import { playerH2H } from "@/lib/db/schema"
import { getRefereeByName } from "@/lib/historical"
import { and, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"
import { GET as espnGET } from "../fixture-radar-espn/route"

export const dynamic = "force-dynamic"

const CURRENT_SEASON_START = "2026-08-21"

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

function csvDate(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return ""
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

async function footballDataReferee(date: string, home: string, away: string, competition: string) {
  if (competition !== "Premier League") return null
  try {
    const response = await fetch("https://www.football-data.co.uk/mmz4281/2627/E0.csv", {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return null
    const text = await response.text()
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    const headers = lines[0].split(",").map((value) => value.replace(/^\uFEFF/, "").trim())
    const dateIndex = headers.indexOf("Date")
    const homeIndex = headers.indexOf("HomeTeam")
    const awayIndex = headers.indexOf("AwayTeam")
    const refereeIndex = headers.indexOf("Referee")
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
  const key = `${date}|${norm(home)}|${norm(away)}`
  const appointments: Record<string, string> = {
    "2026-08-22|nottingham forest|leeds united": "Robert Jones",
  }
  return appointments[key] ?? null
}

async function addCurrentSeasonLayer(data: any, competition: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data

  const names = Array.from(new Set(data.candidates.map((candidate: any) => String(candidate.dbName ?? "")).filter(Boolean))) as string[]
  if (!names.length) return data

  const rows = await db
    .select()
    .from(playerH2H)
    .where(and(inArray(playerH2H.playerName, names), eq(playerH2H.competition, competition)))

  const currentRows = rows.filter((row) => String(row.matchDate ?? "") >= CURRENT_SEASON_START)

  data.candidates = data.candidates.map((candidate: any) => {
    const playerRows = currentRows.filter((row) => row.playerName === candidate.dbName)
    if (!playerRows.length) {
      return {
        ...candidate,
        currentSeason: { games: 0, minutes: 0, fouls: 0, yellows: 0, fouls90: null, cards90: null },
      }
    }

    const games = playerRows.length
    const minutes = playerRows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const fouls = playerRows.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const yellows = playerRows.filter((row) => row.yellowCard === true).length
    const fouls90 = minutes > 0 ? (fouls * 90) / minutes : 0
    const cards90 = minutes > 0 ? (yellows * 90) / minutes : 0

    const foulSignal = Math.min(1, Math.max(0, fouls90 / 2.5))
    const cardSignal = Math.min(1, Math.max(0, cards90 / 0.6))
    const recentScore = (foulSignal * 55) + (cardSignal * 45)

    // GW1 should matter, but it should not outweigh a full 2025/26 sample.
    // One full match contributes about 10% of the live evidence score; the
    // current-season layer grows gradually and is capped at 35%.
    const recentWeight = Math.min(0.35, minutes / 900)
    const baselineScore = Number(candidate.score ?? 0)
    const score = Math.round(((baselineScore * (1 - recentWeight)) + (recentScore * recentWeight)) * 10) / 10
    const band = score >= 70 ? "STRONG" : score >= 55 ? "GOOD" : "WATCH"

    return {
      ...candidate,
      score,
      band,
      currentSeason: {
        season: "2026/27",
        games,
        minutes,
        fouls,
        yellows,
        fouls90: Math.round(fouls90 * 100) / 100,
        cards90: Math.round(cards90 * 100) / 100,
        evidenceWeight: Math.round(recentWeight * 100),
      },
    }
  }).sort((a: any, b: any) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.minutes ?? 0) - Number(a.minutes ?? 0))

  data.source = `${data.source ?? "live radar"} + 2026/27 current-season match evidence`
  data.currentSeasonLayer = {
    season: "2026/27",
    from: CURRENT_SEASON_START,
    matchesLoaded: Array.from(new Set(currentRows.map((row) => String(row.matchDate)))).length,
    playerMatchRows: currentRows.length,
    weighting: "Recent season starts at ~10% after one full match and grows to a 35% cap",
  }
  return data
}

export async function GET(request: Request) {
  const response = await espnGET(request)
  if (!response.ok) return response

  try {
    let data = await response.json()
    const url = new URL(request.url)
    const date = url.searchParams.get("date") ?? ""
    const home = url.searchParams.get("home") ?? ""
    const away = url.searchParams.get("away") ?? ""
    const competition = url.searchParams.get("competition") ?? "Premier League"

    data = await addCurrentSeasonLayer(data, competition)

    let refereeName = data?.referee?.name ?? null
    let refereeSource = refereeName ? "ESPN" : null

    if (!refereeName && date && home && away) {
      refereeName = await footballDataReferee(date, home, away, competition)
      if (refereeName) refereeSource = "Football-Data"
    }

    if (!refereeName && date && home && away) {
      refereeName = confirmedAppointmentFallback(date, home, away, competition)
      if (refereeName) refereeSource = "confirmed appointment fallback"
    }

    if (refereeName) {
      const historical = await getRefereeByName(refereeName)
      data.referee = {
        ...(data.referee ?? {}),
        name: refereeName,
        source: refereeSource,
        matchedHistoricalName: historical?.refereeName ?? null,
        yellowsPerGame: historical?.yellowsPerGame != null ? Number(historical.yellowsPerGame) : data.referee?.yellowsPerGame ?? null,
        foulsPerGame: historical?.foulsPerGame != null ? Number(historical.foulsPerGame) : data.referee?.foulsPerGame ?? null,
        matches: historical?.matchesRefereed ?? data.referee?.matches ?? null,
        historicalCompetition: historical?.competition ?? data.referee?.historicalCompetition ?? null,
      }
    }

    return NextResponse.json(data)
  } catch {
    return response
  }
}
