import { isDatabaseConfigured } from "@/lib/db"
import {
  getPlayerBaseline,
  getPlayerH2H,
  getPlayerRefereeHistory,
} from "@/lib/historical"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const name = url.searchParams.get("name")
  const team = url.searchParams.get("team") ?? undefined
  const opponent = url.searchParams.get("opponent") ?? undefined
  const referee = url.searchParams.get("referee") ?? undefined

  if (!name) {
    return NextResponse.json({ error: "Missing player name" }, { status: 400 })
  }

  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, player: name, team, baseline: null, h2h: [], refereeHistory: null })
  }

  const [baseline, h2h, refereeHistory] = await Promise.all([
    getPlayerBaseline(name, team),
    opponent ? getPlayerH2H(name, opponent) : Promise.resolve([]),
    referee ? getPlayerRefereeHistory(referee, name) : Promise.resolve(null),
  ])

  return NextResponse.json({
    connected: true,
    player: name,
    team,
    opponent,
    referee,
    baseline: baseline
      ? {
          season: baseline.season,
          competition: baseline.competition,
          appearances: baseline.appearances,
          starts: baseline.starts,
          minutes: baseline.minutes,
          yellowCards: baseline.yellowCards,
          redCards: baseline.redCards,
          foulsCommitted: baseline.foulsCommitted,
          foulsDrawn: baseline.foulsDrawn,
          foulsPer90: baseline.foulsPer90 != null ? Number(baseline.foulsPer90) : null,
          cardsPer90: baseline.cardsPer90 != null ? Number(baseline.cardsPer90) : null,
        }
      : null,
    h2h: h2h.map((m) => ({
      matchDate: m.matchDate,
      opponent: m.opponent,
      competition: m.competition,
      venue: m.venue,
      minutes: m.minutes,
      foulsCommitted: m.foulsCommitted,
      foulsDrawn: m.foulsDrawn,
      yellowCard: m.yellowCard,
      redCard: m.redCard,
    })),
    refereeHistory: refereeHistory
      ? {
          referee: refereeHistory.refereeName,
          competition: refereeHistory.competition,
          season: refereeHistory.season,
          matchesTogether: refereeHistory.matchesTogether,
          yellowCards: refereeHistory.yellowCards,
          redCards: refereeHistory.redCards,
          foulsCommitted: refereeHistory.foulsCommitted,
        }
      : null,
  })
}
