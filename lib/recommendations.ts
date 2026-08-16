import type {
  Candidate,
  ConfidenceBand,
  EvidenceItem,
  Fixture,
  LineupPlayer,
  LineupsResponse,
} from "@/lib/types"
import {
  getPlayerBaseline,
  getPlayerH2H,
  getPlayerRefereeHistory,
  getRefereeByName,
} from "@/lib/historical"

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function band(score: number): ConfidenceBand {
  if (score >= 75) return "STRONG"
  if (score >= 55) return "GOOD"
  return "WATCH"
}

interface BuiltCandidate extends Candidate {}

async function buildCandidate(
  player: LineupPlayer,
  team: string,
  opponent: string,
  refereeName: string | null,
  confirmed: boolean,
): Promise<BuiltCandidate> {
  const baseline = await getPlayerBaseline(player.name, team)
  const h2h = await getPlayerH2H(player.name, opponent)
  const referee = refereeName ? await getRefereeByName(refereeName) : null
  const refPlayer = refereeName ? await getPlayerRefereeHistory(refereeName, player.name) : null

  const foulsPer90 = baseline ? toNum(baseline.foulsPer90) : null
  const yellows = baseline ? toNum(baseline.yellowCards) : null
  const cardsPer90 = baseline ? toNum(baseline.cardsPer90) : null

  const h2hGames = h2h.length
  const h2hFoulsTotal = h2h.reduce((acc, m) => acc + (m.foulsCommitted ?? 0), 0)
  const h2hFoulsPerGame = h2hGames > 0 ? h2hFoulsTotal / h2hGames : null
  const h2hBookings = h2hGames > 0 ? h2h.filter((m) => m.yellowCard).length : null
  const refYellows = referee ? toNum(referee.yellowsPerGame) : null
  const refBookedPlayer = refPlayer ? (refPlayer.yellowCards ?? 0) > 0 : null

  const evidence = (extra: EvidenceItem[]): EvidenceItem[] => extra

  // Scoring. Weighted, and only from data we actually have. If we have no
  // historical data at all, confidence stays at 0 and the UI flags it.
  let score = 0
  let weightUsed = 0
  const add = (value: number | null, normalizeMax: number, weight: number) => {
    if (value === null) return
    const norm = Math.max(0, Math.min(1, value / normalizeMax))
    score += norm * weight
    weightUsed += weight
  }
  add(yellows, 12, 22)
  add(foulsPer90, 4, 24)
  add(h2hFoulsPerGame, 4, 16)
  add(h2hBookings, Math.max(1, h2hGames), 12)
  add(refYellows, 5, 14)
  add(cardsPer90, 0.6, 12)

  const researchConfidence = weightUsed > 0 ? Math.round((score / weightUsed) * 100) : 0
  const hasHistoricalData = weightUsed > 0

  const cardEvidence: EvidenceItem[] = [
    {
      key: "yellowsLastSeason",
      label: "Yellows last season",
      value: yellows,
      display: yellows === null ? "Not enough historical data" : `${yellows} yellows`,
      hasData: yellows !== null,
    },
    {
      key: "foulsPer90",
      label: "Fouls per 90",
      value: foulsPer90,
      display: foulsPer90 === null ? "Not enough historical data" : `${foulsPer90.toFixed(2)} fouls/90`,
      hasData: foulsPer90 !== null,
    },
    {
      key: "h2hFoulsPerGame",
      label: "H2H fouls/game",
      value: h2hFoulsPerGame,
      display:
        h2hFoulsPerGame === null
          ? "No H2H data"
          : `${h2hFoulsPerGame.toFixed(1)} H2H fouls/game`,
      hasData: h2hFoulsPerGame !== null,
    },
    {
      key: "h2hBookings",
      label: "H2H bookings",
      value: h2hBookings,
      display:
        h2hBookings === null
          ? "No H2H data"
          : `Booked in ${h2hBookings} of last ${h2hGames} H2Hs`,
      hasData: h2hBookings !== null,
    },
    {
      key: "refereeYellows",
      label: "Referee tendency",
      value: refYellows,
      display:
        refYellows === null
          ? "Referee data unavailable"
          : `Referee: ${refYellows.toFixed(2)} yellows/game`,
      hasData: refYellows !== null,
    },
  ]

  // Explanation from real signals only.
  const reasons: string[] = []
  if (yellows !== null && yellows >= 5) reasons.push(`${yellows} yellow cards on record`)
  if (foulsPer90 !== null && foulsPer90 >= 2) reasons.push(`a high ${foulsPer90.toFixed(2)} fouls per 90`)
  if (h2hFoulsPerGame !== null && h2hFoulsPerGame >= 1.5)
    reasons.push(`${h2hFoulsPerGame.toFixed(1)} fouls per game against ${opponent}`)
  if (refBookedPlayer) reasons.push(`this referee has booked them before`)
  const explanation = hasHistoricalData
    ? reasons.length > 0
      ? `Ranks highly on ${reasons.join(", ")}.`
      : "Included on available historical signals."
    : "Not enough historical data has been imported to rank this player."

  return {
    playerId: player.id,
    playerName: player.name,
    team,
    confirmed,
    researchConfidence,
    band: band(researchConfidence),
    explanation,
    evidence: evidence(cardEvidence),
    foulsPer90,
    yellowCards: yellows,
    h2hFoulsPerGame,
    hasHistoricalData,
  }
}

/**
 * Builds card & foul candidate lists for a fixture. When confirmed lineups are
 * available only confirmed starters are considered. When lineups are only
 * "expected" or unavailable, no invented players are used - the caller receives
 * empty lists and the UI explains why.
 */
export async function buildRecommendations(
  fixture: Fixture,
  lineups: Pick<LineupsResponse, "status" | "home" | "away">,
) {
  const confirmed = lineups.status === "confirmed"

  const pool: { player: LineupPlayer; team: string; opponent: string }[] = []
  if (confirmed && lineups.home && lineups.away) {
    for (const p of lineups.home.startingXI)
      pool.push({ player: p, team: lineups.home.team.name, opponent: lineups.away.team.name })
    for (const p of lineups.away.startingXI)
      pool.push({ player: p, team: lineups.away.team.name, opponent: lineups.home.team.name })
  }

  const refereeName = fixture.referee?.name ?? null

  const candidates = await Promise.all(
    pool.map((entry) =>
      buildCandidate(entry.player, entry.team, entry.opponent, refereeName, true),
    ),
  )

  const cardCandidates = [...candidates]
    .sort((a, b) => b.researchConfidence - a.researchConfidence)
    .slice(0, 5)

  const foulCandidates = [...candidates]
    .sort((a, b) => (b.foulsPer90 ?? -1) - (a.foulsPer90 ?? -1))
    .slice(0, 5)

  return { cardCandidates, foulCandidates, confirmed }
}
