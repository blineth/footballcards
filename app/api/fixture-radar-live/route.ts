import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, referees } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const LIVE_SNAPSHOT = "https://raw.githubusercontent.com/blineth/footballcards/live-data/data/live/fixtures.json"

type LivePlayer = { id?: number | null; name?: string | null; shortName?: string | null; position?: string | null }
type LiveEvent = {
  eventId?: number
  competition?: string
  date?: string
  home?: { id?: number | null; name?: string | null }
  away?: { id?: number | null; name?: string | null }
  referee?: { id?: number | null; name?: string | null } | null
  lineupsConfirmed?: boolean
  homeStarters?: LivePlayer[]
  awayStarters?: LivePlayer[]
  homeRoster?: LivePlayer[]
  awayRoster?: LivePlayer[]
}
type LiveSnapshot = { providerOk?: boolean; events?: LiveEvent[]; health?: unknown }

const teamAliases: Record<string, string[]> = {
  Arsenal: ["Arsenal"], "Coventry City": ["Coventry", "Coventry City"], "Hull City": ["Hull", "Hull City"],
  "Manchester United": ["Man Utd", "Manchester United"], Everton: ["Everton"], "Crystal Palace": ["Crystal Palace"],
  "Ipswich Town": ["Ipswich", "Ipswich Town"], Sunderland: ["Sunderland"], "Nottingham Forest": ["Nott'm Forest", "Nottingham Forest"],
  "Leeds United": ["Leeds", "Leeds United"], Brentford: ["Brentford"], "Tottenham Hotspur": ["Spurs", "Tottenham", "Tottenham Hotspur"],
  "Brighton & Hove Albion": ["Brighton", "Brighton & Hove Albion"], "Aston Villa": ["Aston Villa"],
  "Manchester City": ["Man City", "Manchester City"], "AFC Bournemouth": ["Bournemouth", "AFC Bournemouth"],
  "Newcastle United": ["Newcastle", "Newcastle United"], Liverpool: ["Liverpool"], Fulham: ["Fulham"], Chelsea: ["Chelsea"],
  "Birmingham City": ["Birmingham City", "Birmingham"], "Bristol City": ["Bristol City"], "Lincoln City": ["Lincoln City"],
  Portsmouth: ["Portsmouth"], Millwall: ["Millwall"], "Norwich City": ["Norwich City", "Norwich"],
  "Blackburn Rovers": ["Blackburn Rovers", "Blackburn"], Middlesbrough: ["Middlesbrough"], "Derby County": ["Derby County", "Derby"],
  "Cardiff City": ["Cardiff City", "Cardiff"], "Preston North End": ["Preston North End", "Preston"],
  "Wolverhampton Wanderers": ["Wolves", "Wolverhampton Wanderers"], "Queens Park Rangers": ["Queens Park Rangers", "QPR"],
  "Bolton Wanderers": ["Bolton Wanderers", "Bolton"], Southampton: ["Southampton"], "Stoke City": ["Stoke City", "Stoke"],
  "Swansea City": ["Swansea City", "Swansea"], "Sheffield United": ["Sheffield United", "Sheffield Utd"],
  "West Ham United": ["West Ham", "West Ham United"], "Charlton Athletic": ["Charlton Athletic", "Charlton"],
  Wrexham: ["Wrexham"], Watford: ["Watford"], "West Bromwich Albion": ["West Brom", "West Bromwich Albion"], Burnley: ["Burnley"],
}

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}

function playerNameScore(current: string, historic: string) {
  const a = norm(current), b = norm(historic)
  if (!a || !b) return 0
  if (a === b) return 100
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 6) return 92
  const aa = a.split(" "), bb = b.split(" ")
  if (aa[0] === bb[0] && aa.at(-1) === bb.at(-1)) return 90
  if (aa.at(-1) === bb.at(-1) && aa[0]?.[0] === bb[0]?.[0]) return 80
  return 0
}

async function getSnapshot(): Promise<LiveSnapshot | null> {
  try {
    const response = await fetch(`${LIVE_SNAPSHOT}?v=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "footballcards-app/1.0" },
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function findLiveEvent(snapshot: LiveSnapshot | null, date: string, home: string, away: string, competition: string) {
  return (snapshot?.events ?? []).find((event) =>
    event.date === date && event.competition === competition && teamMatch(event.home?.name, home) && teamMatch(event.away?.name, away),
  ) ?? null
}

function reliability(minutes: number) { return Math.max(0, Math.min(1, minutes / 1800)) }
function startProbability(starts: number, apps: number) {
  if (!apps) return 0.35
  return 0.25 + Math.max(0, Math.min(1, starts / apps)) * 0.7
}
function scoreCandidate(input: { cards90: number; yellows: number; fouls90: number; minutes: number; starts: number; apps: number; h2hYellows: number; h2hFouls: number; confirmed: boolean }) {
  const rel = reliability(input.minutes)
  const shrunkCards90 = 0.22 + rel * (input.cards90 - 0.22)
  const cardRate = Math.min(1, Math.max(0, shrunkCards90 / 0.6))
  const yellowVolume = Math.min(1, input.yellows / 10)
  const foulRate = Math.min(1, input.fouls90 / 2.5)
  const start = input.confirmed ? 1 : startProbability(input.starts, input.apps)
  const h2h = Math.min(1, input.h2hYellows / 2) * 0.7 + Math.min(1, input.h2hFouls / 8) * 0.3
  return Math.round((cardRate * 30 + yellowVolume * 18 + foulRate * 15 + start * 20 + rel * 7 + h2h * 10) * 10) / 10
}
function band(score: number) { return score >= 70 ? "STRONG" : score >= 55 ? "GOOD" : "WATCH" }
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
  if (!date || !home || !away) return NextResponse.json({ error: "Missing date, home or away" }, { status: 400 })
  if (!isDatabaseConfigured) return NextResponse.json({ connected: false, lineupsConfirmed: false, candidates: [] })

  await ensureResearchSchema()
  const snapshot = await getSnapshot()
  const live = findLiveEvent(snapshot, date, home, away, competition)
  const confirmed = Boolean(live?.lineupsConfirmed)
  const currentPlayers = confirmed
    ? [ ...(live?.homeStarters ?? []).map((player) => ({ ...player, currentTeam: home })), ...(live?.awayStarters ?? []).map((player) => ({ ...player, currentTeam: away })) ]
    : [ ...(live?.homeRoster ?? []).map((player) => ({ ...player, currentTeam: home })), ...(live?.awayRoster ?? []).map((player) => ({ ...player, currentTeam: away })) ]

  const allBaselines = await db.select().from(playerBaselines).where(eq(playerBaselines.season, "2025/26")).orderBy(desc(playerBaselines.minutes))
  const matched: Array<{ player: LivePlayer; currentTeam: string; baseline: (typeof allBaselines)[number] }> = []

  if (currentPlayers.length) {
    for (const current of currentPlayers) {
      let best: (typeof allBaselines)[number] | undefined
      let bestScore = 0
      for (const baseline of allBaselines) {
        const score = playerNameScore(String(current.name ?? ""), baseline.playerName)
        if (score > bestScore) { bestScore = score; best = baseline }
      }
      if (best && bestScore >= 80) matched.push({ player: current, currentTeam: current.currentTeam, baseline: best })
    }
  } else {
    const homeAliases = teamAliases[home] ?? [home]
    const awayAliases = teamAliases[away] ?? [away]
    const allowed = [...homeAliases, ...awayAliases]
    for (const baseline of allBaselines.filter((row) => allowed.includes(row.team))) {
      matched.push({ player: { name: baseline.playerName, position: baseline.position }, currentTeam: homeAliases.includes(baseline.team) ? home : away, baseline })
    }
  }

  const unique = new Map<string, (typeof matched)[number]>()
  for (const row of matched) {
    const key = `${norm(row.player.name)}|${norm(row.currentTeam)}`
    const old = unique.get(key)
    if (!old || Number(row.baseline.minutes ?? 0) > Number(old.baseline.minutes ?? 0)) unique.set(key, row)
  }
  const pool = [...unique.values()]
  const names = pool.map((row) => row.baseline.playerName)
  const opponentNames = Array.from(new Set([...(teamAliases[home] ?? [home]), ...(teamAliases[away] ?? [away])]))
  const h2hRows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), inArray(playerH2H.opponent, opponentNames))) : []

  const ranked = pool.map(({ player, currentTeam, baseline }) => {
    const opponent = currentTeam === home ? away : home
    const aliases = teamAliases[opponent] ?? [opponent]
    const h2h = h2hRows.filter((row) => row.playerName === baseline.playerName && aliases.includes(row.opponent))
    const h2hYellows = h2h.filter((row) => row.yellowCard === true).length
    const h2hFouls = h2h.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const cards90 = Number(baseline.cardsPer90 ?? 0), fouls90 = Number(baseline.foulsPer90 ?? 0), yellows = Number(baseline.yellowCards ?? 0)
    const minutes = Number(baseline.minutes ?? 0), starts = Number(baseline.starts ?? 0), apps = Number(baseline.appearances ?? 0)
    const score = scoreCandidate({ cards90, yellows, fouls90, minutes, starts, apps, h2hYellows, h2hFouls, confirmed })
    return {
      name: player.name ?? baseline.playerName, dbName: baseline.playerName, team: currentTeam, dbTeam: baseline.team,
      historicalCompetition: baseline.competition, position: player.position ?? baseline.position, yellows, cards90, fouls90,
      appearances: apps, starts, minutes, startLikelihood: confirmed ? 1 : startProbability(starts, apps),
      sampleLabel: sampleLabel(minutes, starts, apps, confirmed), h2hYellows, h2hFouls, score, band: band(score),
    }
  }).sort((a, b) => b.score - a.score || b.minutes - a.minutes)

  let referee = null as null | { name: string; yellowsPerGame: number | null; foulsPerGame: number | null; matches: number | null; historicalCompetition: string | null }
  const refereeName = live?.referee?.name
  if (refereeName) {
    const rows = await db.select().from(referees).where(eq(referees.refereeName, refereeName)).orderBy(desc(referees.season))
    const row = rows[0]
    referee = { name: refereeName, yellowsPerGame: row?.yellowsPerGame != null ? Number(row.yellowsPerGame) : null, foulsPerGame: row?.foulsPerGame != null ? Number(row.foulsPerGame) : null, matches: row?.matchesRefereed ?? null, historicalCompetition: row?.competition ?? null }
  }

  return NextResponse.json({
    connected: true,
    source: live ? "live-data snapshot + historical database" : "historical database fallback",
    liveProviderOk: Boolean(snapshot?.providerOk),
    eventId: live?.eventId ?? null,
    competition, date, home, away,
    lineupsConfirmed: confirmed,
    referee,
    candidates: ranked.slice(0, 8),
  })
}
