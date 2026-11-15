import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, referees } from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type EspnPlayer = { id?: string; displayName?: string; fullName?: string; position?: { abbreviation?: string; displayName?: string } }
type CurrentPlayer = { id?: string; name: string; position?: string; currentTeam: string }

const leagueSlug: Partial<Record<Competition, string>> = { "Premier League": "eng.1", Championship: "eng.2", "League One": "eng.3", "League Two": "eng.4" }
const internationalSlugs = ["uefa.nations", "fifa.friendly", "fifa.world", "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf", "fifa.worldq.afc", "fifa.worldq.caf"]
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
  const ttl = path.includes("/summary?") ? 30 : path.includes("/scoreboard?") ? 60 : path.includes("/roster") ? 21600 : 300
  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${path}`, {
    next:{revalidate:ttl},
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json" },
  })
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
  const data = await espn(`${league}/scoreboard?dates=${date.replaceAll("-", "")}&limit=300`)
  for (const event of data?.events ?? []) {
    const competitors = event?.competitions?.[0]?.competitors ?? []
    const h = competitors.find((row: any) => row.homeAway === "home")
    const a = competitors.find((row: any) => row.homeAway === "away")
    if (teamMatch(h?.team?.displayName, home) && teamMatch(a?.team?.displayName, away)) return { event, homeCompetitor: h, awayCompetitor: a, league }
  }
  return null
}
async function findEventForCompetition(competition: Competition, date: string, home: string, away: string) {
  const slugs = competition === "International" ? internationalSlugs : [leagueSlug[competition]].filter(Boolean) as string[]
  for (const slug of slugs) {
    try {
      const found = await findEvent(slug, date, home, away)
      if (found) return found
    } catch {}
  }
  return null
}

async function apiFootball(path:string,params:Record<string,string>,ttl=600){
  const key=process.env.API_FOOTBALL_KEY
  if(!key)return null
  try{
    const url=new URL("https://v3.football.api-sports.io"+path)
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v)
    const response=await fetch(url,{
      headers:{"x-apisports-key":key,accept:"application/json"},
      next:{revalidate:ttl},
      signal:AbortSignal.timeout(8000),
    })
    if(!response.ok)return null
    const json=await response.json()
    return Array.isArray(json?.response)?json.response:null
  }catch{return null}
}
async function apiFootballInternationalSquads(date:string,home:string,away:string){
  const fixtures=await apiFootball("/fixtures",{date,timezone:"Europe/London"},300)??[]
  const hit=fixtures.find((f:any)=>teamMatch(f?.teams?.home?.name,home)&&teamMatch(f?.teams?.away?.name,away))
  const homeId=hit?.teams?.home?.id
  const awayId=hit?.teams?.away?.id
  if(!homeId||!awayId)return {players:[] as CurrentPlayer[],usable:false}
  const [homeRows,awayRows]=await Promise.all([
    apiFootball("/players/squads",{team:String(homeId)},21600),
    apiFootball("/players/squads",{team:String(awayId)},21600),
  ])
  const parse=(rows:any[]|null,teamName:string)=>{
    const block=Array.isArray(rows)?rows[0]:null
    return (block?.players??[]).map((p:any)=>({
      id:String(p?.id??""),
      name:String(p?.name??"").trim(),
      position:String(p?.position??"")||undefined,
      currentTeam:teamName,
    })).filter((p:CurrentPlayer)=>p.name)
  }
  const homePlayers=parse(homeRows,home)
  const awayPlayers=parse(awayRows,away)
  return {
    players:[...homePlayers,...awayPlayers],
    usable:homePlayers.length>=12&&awayPlayers.length>=12,
    counts:{home:homePlayers.length,away:awayPlayers.length},
  }
}

async function currentRoster(league: string, teamId: string | number | undefined, teamName: string): Promise<CurrentPlayer[]> {
  if (!teamId) return []
  try {
    const data = await espn(`${league}/teams/${teamId}/roster`)
    return (data?.athletes ?? []).map((player: EspnPlayer) => ({ id: String(player.id ?? ""), name: String(player.displayName ?? player.fullName ?? ""), position: positionOf(player), currentTeam: teamName })).filter((row: CurrentPlayer) => row.name)
  } catch { return [] }
}

function rosterFromSummary(summary: any, home: string, away: string, startersOnly = false) {
  const result: CurrentPlayer[] = []
  let homeCount = 0, awayCount = 0
  for (const section of summary?.rosters ?? []) {
    const side = section?.homeAway === "home" ? "home" : section?.homeAway === "away" ? "away" : null
    if (!side) continue
    const currentTeam = side === "home" ? home : away
    for (const row of section?.roster ?? []) {
      if (startersOnly && row?.starter !== true) continue
      const player: EspnPlayer = row?.athlete ?? {}
      const name = String(player.displayName ?? player.fullName ?? "").trim()
      if (!name) continue
      result.push({ id: String(player.id ?? ""), name, position: positionOf(player) ?? row?.position?.displayName ?? row?.position?.abbreviation, currentTeam })
      if (side === "home") homeCount += 1
      else awayCount += 1
    }
  }
  return { players: result, homeCount, awayCount }
}
function startersFromSummary(summary: any, home: string, away: string) {
  const roster = rosterFromSummary(summary, home, away, true)
  return { players: roster.players, confirmed: roster.homeCount >= 11 && roster.awayCount >= 11 }
}
function matchdaySquadFromSummary(summary: any, home: string, away: string) {
  const roster = rosterFromSummary(summary, home, away, false)
  return { players: roster.players, usable: roster.homeCount >= 12 && roster.awayCount >= 12 }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date"), home = url.searchParams.get("home"), away = url.searchParams.get("away")
  const competition = (url.searchParams.get("competition") ?? "Premier League") as Competition
  if (!date || !home || !away || !["Premier League","Championship","League One","League Two","International"].includes(competition)) return NextResponse.json({ error: "Invalid fixture parameters" }, { status: 400 })
  if (!isDatabaseConfigured) return NextResponse.json({ connected: false, lineupsConfirmed: false, candidates: [] })
  await ensureResearchSchema()

  let eventInfo: any = null, summary: any = null
  try { eventInfo = await findEventForCompetition(competition, date, home, away) } catch {}
  const league = eventInfo?.league ?? leagueSlug[competition] ?? null
  if (eventInfo?.event?.id && league) { try { summary = await espn(`${league}/summary?event=${eventInfo.event.id}`) } catch {} }
  const official = startersFromSummary(summary, home, away)
  const confirmed = official.confirmed
  const matchdaySquad = matchdaySquadFromSummary(summary, home, away)
  const apiInternationalSquad = !confirmed && competition==="International" && !matchdaySquad.usable
    ? await apiFootballInternationalSquads(date,home,away)
    : {players:[] as CurrentPlayer[],usable:false,counts:{home:0,away:0}}

  // International team roster endpoints can contain a broad national-team pool.
  // Prefer the fixture's own matchday squad. When ESPN has not published it yet,
  // API-Football's current squad is the second verifier. If neither verifier is
  // available, the outer radar blocks player recommendations rather than guessing.
  let currentPlayers: CurrentPlayer[] = confirmed ? official.players : []
  if (!confirmed && matchdaySquad.usable) {
    currentPlayers = matchdaySquad.players
  } else if (!confirmed && competition==="International" && apiInternationalSquad.usable) {
    currentPlayers = apiInternationalSquad.players
  } else if (!confirmed && competition !== "International" && eventInfo && league) {
    const [homeRoster, awayRoster] = await Promise.all([
      currentRoster(league, eventInfo.homeCompetitor?.team?.id, home),
      currentRoster(league, eventInfo.awayCompetitor?.team?.id, away),
    ])
    currentPlayers = [...homeRoster, ...awayRoster]
  }

  const baselineSeason = "2026/27"
  const [allBaselines, previousBaselines, internationalRows] = await Promise.all([
    competition === "International"
      ? db.select().from(playerBaselines).where(eq(playerBaselines.season, baselineSeason)).orderBy(desc(playerBaselines.minutes))
      : db.select().from(playerBaselines).where(and(eq(playerBaselines.season, baselineSeason), eq(playerBaselines.competition, competition))).orderBy(desc(playerBaselines.minutes)),
    db.select().from(playerBaselines).where(eq(playerBaselines.season, "2025/26")).orderBy(desc(playerBaselines.minutes)),
    competition === "International"
      ? db.select().from(playerH2H).where(eq(playerH2H.competition, "International"))
      : Promise.resolve([]),
  ])
  const matched: Array<{ player: CurrentPlayer; baseline: (typeof allBaselines)[number] }> = []
  if (currentPlayers.length) {
    for (const current of currentPlayers) {
      let best: (typeof allBaselines)[number] | undefined, bestScore = 0
      for (const baseline of allBaselines) {
        const score = playerNameScore(current.name, baseline.playerName)
        if (score > bestScore || (score === bestScore && score > 0 && Number(baseline.minutes ?? 0) > Number(best?.minutes ?? 0))) {
          bestScore = score
          best = baseline
        }
      }
      if (best && bestScore >= 80) matched.push({ player: current, baseline: best })
    }
  } else if (competition !== "International") {
    const homeAliases = teamAliases[home] ?? [home], awayAliases = teamAliases[away] ?? [away], allowed = [...homeAliases, ...awayAliases]
    for (const baseline of allBaselines.filter((row) => allowed.includes(row.team))) matched.push({ player: { name: baseline.playerName, position: baseline.position ?? undefined, currentTeam: homeAliases.includes(baseline.team) ? home : away }, baseline })
  }

  const unique = new Map<string, (typeof matched)[number]>()
  for (const row of matched) {
    const key = `${norm(row.player.name)}|${norm(row.player.currentTeam)}`
    const old = unique.get(key)
    if (!old || Number(row.baseline.minutes ?? 0) > Number(old.baseline.minutes ?? 0)) unique.set(key, row)
  }
  let pool = [...unique.values()]
  if (competition === "International" && !pool.length) {
    const relevant = internationalRows.filter((r) => teamMatch(r.team, home) || teamMatch(r.team, away))
    const fixtureDay = new Date(date + "T12:00:00Z")
    fixtureDay.setUTCDate(fixtureDay.getUTCDate() - 240)
    const cutoff = fixtureDay.toISOString().slice(0,10)
    const recentRelevant = relevant.filter((r) => String(r.matchDate ?? "") >= cutoff && String(r.matchDate ?? "") < date)
    // A recent senior cap is a much safer eligibility gate than a generic ESPN
    // national-team roster. If the imported recent sample is too thin, retain the
    // wider senior history rather than introducing uncapped club players.
    const eligibleRows = new Set(recentRelevant.map((r) => norm(r.playerName))).size >= 16 ? recentRelevant : relevant
    const namesFromHistory = Array.from(new Set(eligibleRows.map((r) => r.playerName)))
    for (const name of namesFromHistory) {
      let best: (typeof allBaselines)[number] | undefined, bestScore = 0
      for (const baseline of allBaselines) {
        const score = playerNameScore(name, baseline.playerName)
        if (score > bestScore || (score === bestScore && score > 0 && Number(baseline.minutes ?? 0) > Number(best?.minutes ?? 0))) {
          bestScore = score
          best = baseline
        }
      }
      if (best && bestScore >= 80) {
        const latest = relevant.filter((r) => r.playerName === name).sort((a,b)=>String(b.matchDate).localeCompare(String(a.matchDate)))[0]
        pool.push({ player: { name, position: latest?.position ?? best.position ?? undefined, currentTeam: String(latest?.team ?? "") }, baseline: best })
      }
    }
  }
  const names = pool.map((row) => row.baseline.playerName)
  const opponentNames = Array.from(new Set([...(teamAliases[home] ?? [home]), ...(teamAliases[away] ?? [away])]))
  const h2hRows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), inArray(playerH2H.opponent, opponentNames))) : []

  const previousSeasonFor = (baseline: (typeof allBaselines)[number]) => {
    let rows = baseline.externalPlayerId
      ? previousBaselines.filter((r) => r.externalPlayerId && r.externalPlayerId === baseline.externalPlayerId)
      : []
    if (!rows.length) {
      const scored = previousBaselines.map((r) => ({ r, score: playerNameScore(baseline.playerName, r.playerName) })).filter((x) => x.score >= 90)
      const best = scored.sort((a,b) => b.score - a.score || Number(b.r.minutes ?? 0) - Number(a.r.minutes ?? 0))[0]
      rows = best ? previousBaselines.filter((r) => playerNameScore(best.r.playerName, r.playerName) >= 100) : []
    }
    if (!rows.length) return null
    const sum = (key: keyof (typeof rows)[number]) => rows.reduce((s,r) => s + Number(r[key] ?? 0), 0)
    const minutes = sum("minutes")
    const clubs = Array.from(new Set(rows.map((r) => r.team).filter(Boolean)))
    const competitions = Array.from(new Set(rows.map((r) => r.competition).filter(Boolean)))
    const yellows = sum("yellowCards")
    const fouls = sum("foulsCommitted")
    const shots = sum("shots")
    const sot = sum("shotsOnTarget")
    return {
      season: "2025/26",
      clubs,
      competitions,
      appearances: sum("appearances"),
      starts: sum("starts"),
      minutes,
      goals: sum("goals"),
      assists: sum("assists"),
      yellows,
      redCards: sum("redCards"),
      fouls,
      foulsDrawn: sum("foulsDrawn"),
      shots,
      shotsOnTarget: sot,
      fouls90: minutes > 0 ? Math.round(((fouls * 90) / minutes) * 100) / 100 : null,
      cards90: minutes > 0 ? Math.round(((yellows * 90) / minutes) * 100) / 100 : null,
      shots90: minutes > 0 ? Math.round(((shots * 90) / minutes) * 100) / 100 : null,
      shotsOnTarget90: minutes > 0 ? Math.round(((sot * 90) / minutes) * 100) / 100 : null,
    }
  }

  const ranked = pool.map(({ player, baseline }) => {
    const opponent = player.currentTeam === home ? away : home, aliases = teamAliases[opponent] ?? [opponent]
    const h2h = h2hRows.filter((row) => row.playerName === baseline.playerName && aliases.includes(row.opponent))
    const h2hYellows = h2h.filter((row) => row.yellowCard === true).length, h2hFouls = h2h.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const cards90 = Number(baseline.cardsPer90 ?? 0), fouls90 = Number(baseline.foulsPer90 ?? 0), yellows = Number(baseline.yellowCards ?? 0), minutes = Number(baseline.minutes ?? 0), starts = Number(baseline.starts ?? 0), apps = Number(baseline.appearances ?? 0)
    const score = scoreCandidate({ cards90, yellows, fouls90, minutes, starts, apps, h2hYellows, h2hFouls, confirmed })
    return { name: player.name, dbName: baseline.playerName, team: player.currentTeam, dbTeam: baseline.team, historicalCompetition: baseline.competition, baselineSeason, previousSeason: previousSeasonFor(baseline), position: player.position ?? baseline.position, yellows, redCards: Number(baseline.redCards ?? 0), goals: Number(baseline.goals ?? 0), assists: Number(baseline.assists ?? 0), shots: Number(baseline.shots ?? 0), shotsOnTarget: Number(baseline.shotsOnTarget ?? 0), cards90, fouls90, fouled90: minutes > 0 ? Math.round(((Number(baseline.foulsDrawn ?? 0) * 90) / minutes) * 100) / 100 : null, shots90: baseline.shotsPer90 == null ? null : Number(baseline.shotsPer90), shotsOnTarget90: baseline.shotsOnTargetPer90 == null ? null : Number(baseline.shotsOnTargetPer90), appearances: apps, starts, minutes, startLikelihood: confirmed ? 1 : startProbability(starts, apps), sampleLabel: sampleLabel(minutes, starts, apps, confirmed), h2hYellows, h2hFouls, score, band: band(score) }
  }).sort((a, b) => b.score - a.score || b.minutes - a.minutes)

  const officialName = summary?.gameInfo?.officials?.[0]?.displayName ?? summary?.gameInfo?.officials?.[0]?.fullName ?? null
  let referee = null as any
  if (officialName) {
    const rows = await db.select().from(referees).where(eq(referees.refereeName, officialName)).orderBy(desc(referees.season))
    const row = rows[0]
    referee = { name: officialName, yellowsPerGame: row?.yellowsPerGame != null ? Number(row.yellowsPerGame) : null, foulsPerGame: row?.foulsPerGame != null ? Number(row.foulsPerGame) : null, matches: row?.matchesRefereed ?? null, historicalCompetition: row?.competition ?? null }
  }

  const source = confirmed
    ? "ESPN confirmed starting XI + historical database"
    : matchdaySquad.usable
      ? "ESPN matchday squad + historical database"
      : apiInternationalSquad.usable
        ? "API-Football current senior squad + historical database"
        : competition === "International"
          ? "Recent senior international appearances + historical database"
          : eventInfo
            ? "ESPN current squad + historical database"
            : "historical database fallback"
  const squadVerified=confirmed||matchdaySquad.usable||apiInternationalSquad.usable
  return NextResponse.json({
    connected:true,source,liveProviderOk:Boolean(eventInfo),eventId:eventInfo?.event?.id??null,
    competition,date,home,away,lineupsConfirmed:confirmed,squadVerified,
    squadVerification:confirmed?"confirmed-lineup":matchdaySquad.usable?"espn-matchday":apiInternationalSquad.usable?"api-football-current":null,
    referee,candidates:ranked.slice(0,confirmed?24:50),
  })
}
