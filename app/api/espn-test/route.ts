import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const results = []
  for (const league of ["eng.1", "eng.2"]) {
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=20260822`
    try {
      const response = await fetch(scoreboardUrl, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      const data = response.ok ? await response.json() : null
      const events = data?.events ?? []
      const first = events[0]
      let summary = null
      if (first?.id) {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${first.id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
        if (r.ok) {
          const d = await r.json()
          summary = {
            rosterSections: (d.rosters ?? []).map((section: any) => ({
              keys: Object.keys(section),
              homeAway: section.homeAway,
              team: section.team?.displayName,
              count: section.roster?.length ?? 0,
              sample: (section.roster ?? []).slice(0, 3).map((row: any) => ({
                keys: Object.keys(row),
                starter: row.starter,
                active: row.active,
                athlete: { id: row.athlete?.id, displayName: row.athlete?.displayName, position: row.athlete?.position?.abbreviation },
              })),
            })),
            gameInfoKeys: Object.keys(d.gameInfo ?? {}),
            officials: d.gameInfo?.officials ?? d.officials ?? null,
          }
        }
      }
      const firstTeamId = first?.competitions?.[0]?.competitors?.[0]?.team?.id
      let teamRoster = null
      if (firstTeamId) {
        const rr = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams/${firstTeamId}/roster`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
        if (rr.ok) {
          const rd = await rr.json()
          teamRoster = { keys: Object.keys(rd), athleteCount: rd.athletes?.length ?? 0, sample: (rd.athletes ?? []).slice(0, 3).map((a: any) => ({ id: a.id, displayName: a.displayName, position: a.position?.abbreviation })) }
        }
      }
      results.push({ league, status: response.status, events: events.slice(0, 3).map((e: any) => ({ id: e.id, name: e.name, date: e.date })), summary, teamRoster })
    } catch (error) {
      results.push({ league, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return NextResponse.json({ results })
}
