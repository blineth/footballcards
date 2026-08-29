import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, referees } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Competition = "Premier League" | "Championship"
type EspnPlayer = { id?: string; displayName?: string; fullName?: string; position?: { abbreviation?: string; displayName?: string } }
type CurrentPlayer = { id?: string; name: string; position?: string; currentTeam: string }

const leagueSlug: Record<Competition, string> = { "Premier League": "eng.1", Championship: "eng.2" }
const teamAliases: Record<string, string[]> = {
  Arsenal: ["Arsenal"], "Coventry City": ["Coventry", "Coventry City"], "Hull City": ["Hull", "Hull City"], "Manchester United": ["Man Utd", "Manchester United"], Everton: ["Everton"], "Crystal Palace": ["Crystal Palace"], "Ipswich Town": ["Ipswich", "Ipswich Town"], Sunderland: ["Sunderland"], "Nottingham Forest": ["Nott'm Forest", "Nottingham Forest"], "Leeds United": ["Leeds", "Leeds United"], Brentford: ["Brentford"], "Tottenham Hotspur": ["Spurs", "Tottenham", "Tottenham Hotspur"], "Brighton & Hove Albion": ["Brighton", "Brighton & Hove Albion"], "Aston Villa": ["Aston Villa"], "Manchester City": ["Man City", "Manchester City"], "AFC Bournemouth": ["Bournemouth", "AFC Bournemouth"], "Newcastle United": ["Newcastle", "Newcastle United"], Liverpool: ["Liverpool"], Fulham: ["Fulham"], Chelsea: ["Chelsea"], "Birmingham City": ["Birmingham City", "Birmingham"], "Bristol City": ["Bristol City"], "Lincoln City": ["Lincoln City"], Portsmouth: ["Portsmouth"], Millwall: ["Millwall"], "Norwich City": ["Norwich City", "Norwich"], "Blackburn Rovers": ["Blackburn Rovers", "Blackburn"], Middlesbrough: ["Middlesbrough"], "Derby County": ["Derby County", "Derby"], "Cardiff City": ["Cardiff City", "Cardiff"], "Preston North End": ["Preston North End", "Preston"], "Wolverhampton Wanderers": ["Wolves", "Wolverhampton Wanderers"], "Queens Park Rangers": ["Queens Park Rangers", "QPR"], "Bolton Wanderers": ["Bolton Wanderers", "Bolton"], Southampton: ["Southampton"], "Stoke City": ["Stoke City", "Stoke"], "Swansea City": ["Swansea City"], "Sheffield United": ["Sheffield United", "Sheffield Utd"], "West Ham United": ["West Ham", "West Ham United"], "Charlton Athletic": ["Charlton Athletic", "Charlton"], Wrexham: ["Wrexham"], Watford: ["Watford"], "West Bromwich Albion": ["West Brom", "West Bromwich Albion"], Burnley: ["Burnley"],
}

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
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
  return 0
}
async function espn(path: string) {
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`ESPN ${response.status}`)
  return response.json()
}
function positionOf(player: EspnPlayer) { return player.position?.displayName ?? player.position?.abbreviation }
function reliability(minutes: number) { return Math.max(0, Math.min(1, minutes / 1800)) }
function startProbability(starts: number, apps: number) { return apps ? 0.25 + Math.max(0, Math.min(1, starts / apps)) * 0.7 : 0.35 }
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

async function findEvent(league: string, date: string, home: string, away: string) {
  const data = await espn(`${league}/scoreboard?dates=${date.replaceAll("-", "")}`)
  for (const event of data?.events ?? []) {
    const competitors = event?.competitions?.[0]?.competitors ?? []
    const h = competitors.find((row: any) => row.homeAway === "home")
    const a = competitors.find((row: any) => row.homeAway === "away")
    if (teamMatch(h?.team?.displayName, home) && teamMatch(a?.team?.displayName, away)) return { event, homeCompetitor: h, awayCompetitor: a }
  }
  return null
}

async function currentRoster(league: string, teamId: string | number | undefined, teamName: string): Promise<CurrentPlayer[]> {
  if (!teamId) return []
  try {
    const data = await espn(`${league}/teams/${teamId}/roster`)
    return (data?.athletes ?? []).map((player: EspnPlayer) => ({ id: String(player.id ?? ""), name: String(player.displayName ?? player.fullName ?? ""), position: positionOf(player), currentTeam: teamName })).filter((row: CurrentPlayer) => row.name)
  } catch { return [] }
}

function startersFromSummary(summary: any, home: string, away: string) {
  const result: CurrentPlayer[] = []
  let homeCount = 0, awayCount = 0
  for (const section of summary?.rosters ?? []) {
    const currentTeam = section.homeAway === "home" ? home : away
    for (const row of section.roster ?? []) {
      if (row.starter !== true) continue
      const player: EspnPlayer = row.athlete ?? {}
      const name = String(player.displayName ?? player.fullName ?? "")
      if (!name) continue
      result.push({ id: String(player.id ?? ""), name, position: positionOf(player) ?? row.position?.displayName ?? row.position?.abbreviation, currentTeam })
      if (section.homeAway === "home") homeCount += 1
      else awayCount += 1
    }
  }
  return { players: result, confirmed: homeCount >= 11 && awayCount >= 11 }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date"), home = url.searchParams.get("home"), away = url.searchParams.get("away")
  const competition = (url.searchParams.get("competition") ?? "Premier League") as Competition
  if (!date || !home || !away || !(competition in leagueSlug)) return NextResponse.json({ error: "Invalid fixture parameters" }, { status: 400 })
  if (!isDatabaseConfigured) return NextResponse.json({ connected: false, lineupsConfirmed: false, candidates: [] })
  await ensureResearchSchema()

  const league = leagueSlug[competition]
  let eventInfo: any = null, summary: any = null
  try { eventInfo = await findEvent(league, date, home, away) } catch {}
  if (eventInfo?.event?.id) { try { summary = await espn(`${league}/summary?event=${eventInfo.event.id}`) } catch {} }
  const official = startersFromSummary(summary, home, away)
  const confirmed = official.confirmed

  let currentPlayers: CurrentPlayer[] = official.players
  if (!confirmed && eventInfo) {
    const [homeRoster, awayRoster] = await Promise.all([
      currentRoster(league, eventInfo.homeCompetitor?.team?.id, home),
      currentRoster(league, eventInfo.awayCompetitor?.team?.id, away),
    ])
    currentPlayers = [...homeRoster, ...awayRoster]
  }

  const allBaselines = await db.select().from(playerBaselines).where(eq(playerBaselines.season, "2025/26")).orderBy(desc(playerBaselines.minutes))
  const matched: Array<{ player: CurrentPlayer; baseline: (typeof allBaselines)[number] }> = []
  if (currentPlayers.length) {
    for (const current of currentPlayers) {
      let best: (typeof allBaselines)[number] | undefined, bestScore = 0
      for (const baseline of allBaselines) {
        const score = playerNameScore(current.name, baseline.playerName)
        if (score > bestScore) { bestScore = score; best = baseline }
      }
      if (best && bestScore >= 80) matched.push({ player: current, baseline: best })
    }
  } else {
    const homeAliases = teamAliases[home] ?? [home], awayAliases = teamAliases[away] ?? [away], allowed = [...homeAliases, ...awayAliases]
    for (const baseline of allBaselines.filter((row) => allowed.includes(row.team))) matched.push({ player: { name: baseline.playerName, position: baseline.position ?? undefined, currentTeam: homeAliases.includes(baseline.team) ? home : away }, baseline })
  }

  const unique = new Map<string, (typeof matched)[number]>()
  for (const row of matched) {
    const key = `${norm(row.player.name)}|${norm(row.player.currentTeam)}`
    const old = unique.get(key)
    if (!old || Number(row.baseline.minutes ?? 0) > Number(old.baseline.minutes ?? 0)) unique.set(key, row)
  }
  const pool = [...unique.values()]
  const names = pool.map((row) => row.baseline.playerName)
  const opponentNames = Array.from(new Set([...(teamAliases[home] ?? [home]), ...(teamAliases[away] ?? [away])]))
  const h2hRows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), inArray(playerH2H.opponent, opponentNames))) : []

  const ranked = pool.map(({ player, baseline }) => {
    const opponent = player.currentTeam === home ? away : home, aliases = teamAliases[opponent] ?? [opponent]
    const h2h = h2hRows.filter((row) => row.playerName === baseline.playerName && aliases.includes(row.opponent))
    const h2hYellows = h2h.filter((row) => row.yellowCard === true).length, h2hFouls = h2h.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const cards90 = Number(baseline.cardsPer90 ?? 0), fouls90 = Number(baseline.foulsPer90 ?? 0), yellows = Number(baseline.yellowCards ?? 0), minutes = Number(baseline.minutes ?? 0), starts = Number(baseline.starts ?? 0), apps = Number(baseline.appearances ?? 0)
    const score = scoreCandidate({ cards90, yellows, fouls90, minutes, starts, apps, h2hYellows, h2hFouls, confirmed })
    return { name: player.name, dbName: baseline.playerName, team: player.currentTeam, dbTeam: baseline.team, historicalCompetition: baseline.competition, position: player.position ?? baseline.position, yellows, cards90, fouls90, appearances: apps, starts, minutes, startLikelihood: confirmed ? 1 : startProbability(starts, apps), sampleLabel: sampleLabel(minutes, starts, apps, confirmed), h2hYellows, h2hFouls, score, band: band(score) }
  }).sort((a, b) => b.score - a.score || b.minutes - a.minutes)

  const officialName = summary?.gameInfo?.officials?.[0]?.displayName ?? summary?.gameInfo?.officials?.[0]?.fullName ?? null
  let referee = null as any
  if (officialName) {
    const rows = await db.select().from(referees).where(eq(referees.refereeName, officialName)).orderBy(desc(referees.season))
    const row = rows[0]
    referee = { name: officialName, yellowsPerGame: row?.yellowsPerGame != null ? Number(row.yellowsPerGame) : null, foulsPerGame: row?.foulsPerGame != null ? Number(row.foulsPerGame) : null, matches: row?.matchesRefereed ?? null, historicalCompetition: row?.competition ?? null }
  }

  return NextResponse.json({ connected: true, source: eventInfo ? "ESPN current squads/lineups + historical database" : "historical database fallback", liveProviderOk: Boolean(eventInfo), eventId: eventInfo?.event?.id ?? null, competition, date, home, away, lineupsConfirmed: confirmed, referee, candidates: ranked.slice(0, 20) })
}
