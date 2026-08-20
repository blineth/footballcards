import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

async function inspectSummary(league: string, eventId: string) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${eventId}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
  if (!r.ok) return { status: r.status }
  const d = await r.json()
  return {
    keys: Object.keys(d),
    rosterSections: (d.rosters ?? []).map((section: any) => ({
      keys: Object.keys(section),
      homeAway: section.homeAway,
      team: section.team?.displayName,
      count: section.roster?.length ?? 0,
      sample: (section.roster ?? []).slice(0, 4).map((row: any) => ({
        keys: Object.keys(row),
        starter: row.starter,
        active: row.active,
        subbedIn: row.subbedIn,
        subbedOut: row.subbedOut,
        athlete: { id: row.athlete?.id, displayName: row.athlete?.displayName, position: row.athlete?.position?.abbreviation },
        stats: row.stats,
      })),
    })),
    boxscoreKeys: Object.keys(d.boxscore ?? {}),
    playerStats: (d.boxscore?.players ?? []).slice(0, 2),
    gameInfo: d.gameInfo,
    keyEvents: (d.keyEvents ?? d.plays ?? []).slice?.(0, 8) ?? null,
  }
}

export async function GET() {
  const current = []
  for (const league of ["eng.1", "eng.2"]) {
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=20260822`
    const response = await fetch(scoreboardUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    const data = response.ok ? await response.json() : null
    const events = data?.events ?? []
    const first = events[0]
    const firstTeamId = first?.competitions?.[0]?.competitors?.[0]?.team?.id
    let teamRoster = null
    if (firstTeamId) {
      const rr = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${firstTeamId}/roster`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      if (rr.ok) {
        const rd = await rr.json()
        teamRoster = { athleteCount: rd.athletes?.length ?? 0, sample: (rd.athletes ?? []).slice(0, 3).map((a: any) => ({ id: a.id, displayName: a.displayName, position: a.position?.abbreviation })) }
      }
    }
    current.push({ league, status: response.status, events: events.slice(0, 3).map((e: any) => ({ id: e.id, name: e.name, date: e.date })), futureSummary: first?.id ? await inspectSummary(league, first.id) : null, teamRoster })
  }

  const historicalScoreboard = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.2/scoreboard?dates=20250809", { cache: "no-store", signal: AbortSignal.timeout(8000) })
  const historicalData = historicalScoreboard.ok ? await historicalScoreboard.json() : null
  const historicalEvent = historicalData?.events?.[0]
  const historical = historicalEvent ? { event: { id: historicalEvent.id, name: historicalEvent.name, date: historicalEvent.date }, summary: await inspectSummary("eng.2", historicalEvent.id) } : null

  return NextResponse.json({ current, historical })
}
