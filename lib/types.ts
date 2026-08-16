// Shared domain types used across the provider layer, API routes and UI.

export type Competition = "Premier League" | "Championship"

export type LineupStatus = "expected" | "confirmed" | "unavailable"

export type MatchStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "finished"
  | "postponed"
  | "unknown"

export interface TeamRef {
  id: string
  name: string
  shortName?: string
  crest?: string
}

export interface RefereeSummary {
  id: string | null
  name: string | null
  /** Yellow cards per game, when known from the historical DB. null = unknown. */
  yellowsPerGame: number | null
  foulsPerGame: number | null
  matchesRefereed: number | null
}

export interface Fixture {
  id: string
  competition: Competition
  kickoff: string // ISO string, UTC
  status: MatchStatus
  home: TeamRef
  away: TeamRef
  venue: string | null
  referee: RefereeSummary | null
  lineupStatus: LineupStatus
}

export interface FixturesResponse {
  connected: boolean
  updatedAt: string
  date: string // yyyy-mm-dd in Europe/London
  leagues: {
    "Premier League": Fixture[]
    Championship: Fixture[]
  }
}

export interface LineupPlayer {
  id: string
  name: string
  number: number | null
  position: string | null
  isStarter: boolean
}

export interface TeamLineup {
  team: TeamRef
  status: LineupStatus
  startingXI: LineupPlayer[]
  substitutes: LineupPlayer[]
}

export interface LineupsResponse {
  connected: boolean
  updatedAt: string
  matchId: string
  status: LineupStatus
  home: TeamLineup | null
  away: TeamLineup | null
}

// A single piece of evidence backing a recommendation. `value` is null when the
// underlying historical data has not been imported.
export interface EvidenceItem {
  key:
    | "yellowsLastSeason"
    | "foulsPer90"
    | "h2hFoulsPerGame"
    | "h2hBookings"
    | "refereeYellows"
    | "cardsPer90"
    | "recentForm"
  label: string
  value: number | null
  display: string
  hasData: boolean
}

export type ConfidenceBand = "STRONG" | "GOOD" | "WATCH"

export interface Candidate {
  playerId: string
  playerName: string
  team: string
  confirmed: boolean
  /** Research confidence 0-100. Never a probability. */
  researchConfidence: number
  band: ConfidenceBand
  explanation: string
  evidence: EvidenceItem[]
  // convenience sort keys (null when unknown)
  foulsPer90: number | null
  yellowCards: number | null
  h2hFoulsPerGame: number | null
  hasHistoricalData: boolean
}

export interface RecommendationsResponse {
  connected: boolean
  updatedAt: string
  matchId: string
  lineupStatus: LineupStatus
  cardCandidates: Candidate[]
  foulCandidates: Candidate[]
  /** Set when the DB has no imported historical data yet. */
  historicalDataAvailable: boolean
}
