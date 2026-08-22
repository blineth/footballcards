import { getRefereeByName } from "@/lib/historical"
import { NextResponse } from "next/server"
import { GET as espnGET } from "../fixture-radar-espn/route"

export const dynamic = "force-dynamic"

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

export async function GET(request: Request) {
  const response = await espnGET(request)
  if (!response.ok) return response

  try {
    const data = await response.json()
    const url = new URL(request.url)
    const date = url.searchParams.get("date") ?? ""
    const home = url.searchParams.get("home") ?? ""
    const away = url.searchParams.get("away") ?? ""
    const competition = url.searchParams.get("competition") ?? "Premier League"

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
