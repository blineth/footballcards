import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, referees } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const SOFA = "https://www.sofascore.com/api/v1"

type SofaPlayer = { id?: number; name?: string; position?: string; shortName?: string }
type SofaRosterEntry = { player?: SofaPlayer }
type SofaLineupEntry = { player?: SofaPlayer; substitute?: boolean }

type SofaEvent = {
  id?: number
  homeTeam?: { id?: number; name?: string; shortName?: string }
  awayTeam?: { id?: number; name?: string; shortName?: string }
  tournament?: { name?: string; uniqueTournament?: { name?: string } }
  referee?: { id?: number; name?: string }
}

const teamAliases: Record<string, string[]> = {
  Arsenal: ["Arsenal"],
  "Coventry City": ["Coventry", "Coventry City"],
  "Hull City": ["Hull", "Hull City"],
  "Manchester United": ["Man Utd", "Manchester United"],
  Everton: ["Everton"],
  "Crystal Palace": ["Crystal Palace"],
  "Ipswich Town": ["Ipswich", "Ipswich Town"],
  Sunderland: ["Sunderland"],
  "Nottingham Forest": ["Nott'm Forest", "Nottingham Forest"],
  "Leeds United": ["Leeds", "Leeds United"],
  Brentford: ["Brentford"],
  "Tottenham Hotspur": ["Spurs", "Tottenham", "Tottenham Hotspur"],
  "Brighton & Hove Albion": ["Brighton", "Brighton & Hove Albion"],
  "Aston Villa": ["Aston Villa"],
  "Manchester City": ["Man City", "Manchester City"],
  "AFC Bournemouth": ["Bournemouth", "AFC Bournemouth"],
  "Newcastle United": ["Newcastle", "Newcastle United"],
  Liverpool: ["Liverpool"],
  Fulham: ["Fulham"],
  Chelsea: ["Chelsea"],
  "Birmingham City": ["Birmingham City", "Birmingham"],
  "Bristol City": ["Bristol City"],
  "Lincoln City": ["Lincoln City"],
  Portsmouth: ["Portsmouth"],
  Millwall: ["Millwall"],
  "Norwich City": ["Norwich City", "Norwich"],
  "Blackburn Rovers": ["Blackburn Rovers", "Blackburn"],
  Middlesbrough: ["Middlesbrough"],
  "Derby County": ["Derby County", "Derby"],
  "Cardiff City": ["Cardiff City", "Cardiff"],
  "Preston North End": ["Preston North End", "Preston"],
  "Wolverhampton Wanderers": ["Wolves", "Wolverhampton Wanderers"],
  "Queens Park Rangers": ["Queens Park Rangers", "QPR"],
  "Bolton Wanderers": ["Bolton Wanderers", "Bolton"],
  Southampton: ["Southampton"],
  "Stoke City": ["Stoke City", "Stoke"],
  "Swansea City": ["Swansea City", "Swansea"],
  "Sheffield United": ["Sheffield United", "Sheffield Utd"],
  "West Ham United": ["West Ham", "West Ham United"],
  "Charlton Athletic": ["Charlton Athletic", "Charlton"],
  Wrexham: ["Wrexham"],
  Watford: ["Watford"],
  "West Bromwich Albion": ["West Brom", "West Bromwich Albion"],
  Burnley: ["Burnley"],
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

function namesMatch(a: string | null | undefined, b: string | null | undefined) {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return Math.min(na.length, nb.length) >= 5
  const aa = na.split(" ")
  const bb = nb.split(" ")
  return aa.at(-1) === bb.at(-1) && aa[0]?.[0] === bb[0]?.[0]
}

function playerNameScore(current: string, historic: string) {
  const a = norm(current)
  const b = norm(historic)
  if (!a || !b) return 0
  if (a === b) return 100
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 6) return 92
  const aa = a.split(" ")
  const bb = b.split(" ")
  const aFirst = aa[0]
  const bFirst = bb[0]
  const aLast = aa.at(-1)
  const bLast = bb.at(-1)
  if (aFirst === bFirst && aLast === bLast) return 90
  if (aLast === bLast && aFirst?.[0] === bFirst?.[0]) return 80
  return 0
}

async function sofaFetch(path: string) {
  const response = await fetch(`${SOFA}${path}`, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
      "accept-language": "en-GB,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; footballcards/2.0)",
      referer: "https://www.sofascore.com/",
    },
    signal: AbortSignal.timeout(9000),
  })
  if (!response.ok) throw new Error(`SofaScore ${response.status}`)
  return response.json()
}

async function findEvent(date: string, home: string, away: string): Promise<SofaEvent | null> {
  try {
    const data = await sofaFetch(`/sport/football/scheduled-events/${date}`)
    const events: SofaEvent[] = data?.events ?? []
    return events.find((event) =>
      namesMatch(event.homeTeam?.name, home) && namesMatch(event.awayTeam?.name, away),
    ) ?? null
  } catch {
    return null
  }
}

async function getRoster(teamId?: number): Promise<SofaPlayer[]> {
  if (!teamId) return []
  try {
    const data = await sofaFetch(`/team/${teamId}/players`)
    const entries: SofaRosterEntry[] = data?.players ?? []
    return entries.map((entry) => entry.player).filter((player): player is SofaPlayer => Boolean(player?.name))
  } catch {
    return []
  }
}

async function getOfficialStarters(eventId?: number) {
  if (!eventId) return { confirmed: false, home: [] as SofaPlayer[], away: [] as SofaPlayer[] }
  try {
    const data = await sofaFetch(`/event/${eventId}/lineups`)
    const homeRows: SofaLineupEntry[] = data?.home?.players ?? []
    const awayRows: SofaLineupEntry[] = data?.away?.players ?? []
    const home = homeRows.filter((row) => row.substitute === false).map((row) => row.player).filter((p): p is SofaPlayer => Boolean(p?.name))
    const away = awayRows.filter((row) => row.substitute === false).map((row) => row.player).filter((p): p is SofaPlayer => Boolean(p?.name))
    return { confirmed: home.length >= 11 && away.length >= 11, home, away }
  } catch {
    return { confirmed: false, home: [] as SofaPlayer[], away: [] as SofaPlayer[] }
  }
}

async function getEventReferee(event: SofaEvent | null) {
  if (!event?.id) return event?.referee ?? null
  if (event.referee?.name) return event.referee
  try {
    const detail = await sofaFetch(`/event/${event.id}`)
    return detail?.event?.referee ?? detail?.referee ?? null
  } catch {
    return null
  }
}

function baselineReliability(minutes: number | null | undefined) {
  return Math.max(0, Math.min(1, Number(minutes ?? 0) / 1800))
}

function startProbability(starts: number | null | undefined, apps: number | null | undefined) {
  const a = Number(apps ?? 0)
  if (!a) return 0.35
  const ratio = Math.max(0, Math.min(1, Number(starts ?? 0) / a))
  return 0.25 + ratio * 0.7
}

function scoreCandidate(input: {
  cards90: number
  yellows: number
  fouls90: number
  minutes: number
  starts: number
  apps: number
  h2hYellows: number
  h2hFouls: number
  confirmed: boolean
}) {
  const reliability = baselineReliability(input.minutes)
  const shrunkCards90 = 0.22 + reliability * (input.cards90 - 0.22)
  const cardRate = Math.min(1, Math.max(0, shrunkCards90 / 0.6))
  const yellowVolume = Math.min(1, input.yellows / 10)
  const foulRate = Math.min(1, input.fouls90 / 2.5)
  const start = input.confirmed ? 1 : startProbability(input.starts, input.apps)
  const h2h = Math.min(1, input.h2hYellows / 2) * 0.7 + Math.min(1, input.h2hFouls / 8) * 0.3
  return Math.round((cardRate * 30 + yellowVolume * 18 + foulRate * 15 + start * 20 + reliability * 7 + h2h * 10) * 10) / 10
}

function band(score: number) {
  if (score >= 70) return "STRONG"
  if (score >= 55) return "GOOD"
  return "WATCH"
}

function sampleLabel(minutes: number, starts: number, apps: number, confirmed: boolean) {
  if (confirmed) return "Confirmed starter"
  if (minutes < 900) return "Limited sample"
  const ratio = apps ? starts / apps : 0
  if (ratio >= 0.7) return "Likely starter"
  if (ratio >= 0.45) return "Possible starter"
  return "Rotation risk"
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date")
  const home = url.searchParams.get("home")
  const away = url.searchParams.get("away")
  const competition = url.searchParams.get("competition") ?? "Premier League"

  if (!date || !home || !away) {
    return NextResponse.json({ error: "Missing date, home or away" }, { status: 400 })
  }
  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, lineupsConfirmed: false, candidates: [] })
  }

  await ensureResearchSchema()
  const event = await findEvent(date, home, away)
  const [homeRoster, awayRoster, official, refereeInfo] = await Promise.all([
    getRoster(event?.homeTeam?.id),
    getRoster(event?.awayTeam?.id),
    getOfficialStarters(event?.id),
    getEventReferee(event),
  ])

  const confirmed = official.confirmed
  const currentPlayers = confirmed
    ? [
        ...official.home.map((player) => ({ ...player, currentTeam: home })),
        ...official.away.map((player) => ({ ...player, currentTeam: away })),
      ]
    : [
        ...homeRoster.map((player) => ({ ...player, currentTeam: home })),
        ...awayRoster.map((player) => ({ ...player, currentTeam: away })),
      ]

  // If SofaScore roster lookup is unavailable, retain a DB-only fallback rather
  // than turning the whole fixture blank.
  const allBaselines = await db
    .select()
    .from(playerBaselines)
    .where(eq(playerBaselines.season, "2025/26"))
    .orderBy(desc(playerBaselines.minutes))

  const candidates = [] as Array<{
    player: SofaPlayer
    currentTeam: string
    baseline: (typeof allBaselines)[number]
  }>

  if (currentPlayers.length) {
    for (const current of currentPlayers) {
      let best: (typeof allBaselines)[number] | undefined
      let bestScore = 0
      for (const baseline of allBaselines) {
        const score = playerNameScore(current.name ?? "", baseline.playerName)
        if (score > bestScore) {
          bestScore = score
          best = baseline
        }
      }
      if (best && bestScore >= 80) candidates.push({ player: current, currentTeam: current.currentTeam, baseline: best })
    }
  } else {
    const allowedTeams = [...(teamAliases[home] ?? [home]), ...(teamAliases[away] ?? [away])]
    for (const baseline of allBaselines.filter((row) => allowedTeams.includes(row.team))) {
      const currentTeam = (teamAliases[home] ?? [home]).includes(baseline.team) ? home : away
      candidates.push({ player: { name: baseline.playerName, position: baseline.position ?? undefined }, currentTeam, baseline })
    }
  }

  const unique = new Map<string, (typeof candidates)[number]>()
  for (const row of candidates) {
    const key = `${norm(row.player.name)}|${norm(row.currentTeam)}`
    const existing = unique.get(key)
    if (!existing || Number(row.baseline.minutes ?? 0) > Number(existing.baseline.minutes ?? 0)) unique.set(key, row)
  }
  const pool = [...unique.values()]
  const names = pool.map((row) => row.baseline.playerName)
  const opponentNames = Array.from(new Set([...(teamAliases[home] ?? [home]), ...(teamAliases[away] ?? [away])]))
  const h2hRows = names.length
    ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), inArray(playerH2H.opponent, opponentNames)))
    : []

  const ranked = pool.map(({ player, currentTeam, baseline }) => {
    const opponent = currentTeam === home ? away : home
    const oppAliases = teamAliases[opponent] ?? [opponent]
    const h2h = h2hRows.filter((row) => row.playerName === baseline.playerName && oppAliases.includes(row.opponent))
    const h2hYellows = h2h.filter((row) => row.yellowCard === true).length
    const h2hFouls = h2h.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const cards90 = Number(baseline.cardsPer90 ?? 0)
    const fouls90 = Number(baseline.foulsPer90 ?? 0)
    const yellows = Number(baseline.yellowCards ?? 0)
    const minutes = Number(baseline.minutes ?? 0)
    const starts = Number(baseline.starts ?? 0)
    const apps = Number(baseline.appearances ?? 0)
    const score = scoreCandidate({ cards90, yellows, fouls90, minutes, starts, apps, h2hYellows, h2hFouls, confirmed })
    return {
      name: player.name ?? baseline.playerName,
      dbName: baseline.playerName,
      team: currentTeam,
      dbTeam: baseline.team,
      historicalCompetition: baseline.competition,
      position: player.position ?? baseline.position,
      yellows,
      cards90,
      fouls90,
      appearances: apps,
      starts,
      minutes,
      startLikelihood: confirmed ? 1 : startProbability(starts, apps),
      sampleLabel: sampleLabel(minutes, starts, apps, confirmed),
      h2hYellows,
      h2hFouls,
      score,
      band: band(score),
    }
  }).sort((a, b) => b.score - a.score || b.minutes - a.minutes)

  let referee = null as null | {
    name: string
    yellowsPerGame: number | null
    foulsPerGame: number | null
    matches: number | null
    historicalCompetition: string | null
  }
  if (refereeInfo?.name) {
    const refs = await db.select().from(referees).where(eq(referees.refereeName, refereeInfo.name)).orderBy(desc(referees.season))
    const r = refs[0]
    referee = {
      name: refereeInfo.name,
      yellowsPerGame: r?.yellowsPerGame != null ? Number(r.yellowsPerGame) : null,
      foulsPerGame: r?.foulsPerGame != null ? Number(r.foulsPerGame) : null,
      matches: r?.matchesRefereed ?? null,
      historicalCompetition: r?.competition ?? null,
    }
  }

  return NextResponse.json({
    connected: true,
    source: event ? "Sofascore live fixture + historical database" : "historical database fallback",
    eventId: event?.id ?? null,
    competition,
    date,
    home,
    away,
    lineupsConfirmed: confirmed,
    referee,
    candidates: ranked.slice(0, 8),
  })
}
