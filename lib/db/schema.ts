import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

export const playerBaselines = pgTable(
  "player_baselines",
  {
    id: serial("id").primaryKey(),
    playerName: text("player_name").notNull(),
    team: text("team").notNull(),
    competition: text("competition").notNull(),
    season: text("season").notNull(),
    appearances: integer("appearances"),
    starts: integer("starts"),
    minutes: integer("minutes"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    goals: integer("goals"),
    assists: integer("assists"),
    foulsCommitted: integer("fouls_committed"),
    foulsDrawn: integer("fouls_drawn"),
    shots: integer("shots"),
    shotsOnTarget: integer("shots_on_target"),
    foulsPer90: numeric("fouls_per_90"),
    cardsPer90: numeric("cards_per_90"),
    shotsPer90: numeric("shots_per_90"),
    shotsOnTargetPer90: numeric("shots_on_target_per_90"),
    position: text("position"),
    externalPlayerId: text("external_player_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.playerName, t.team, t.competition, t.season),
  }),
)

export const playerH2H = pgTable(
  "player_h2h",
  {
    id: serial("id").primaryKey(),
    playerName: text("player_name").notNull(),
    team: text("team"),
    opponent: text("opponent").notNull(),
    matchDate: date("match_date").notNull(),
    competition: text("competition"),
    venue: text("venue"),
    position: text("position"),
    starter: boolean("starter"),
    minutes: integer("minutes"),
    foulsCommitted: integer("fouls_committed"),
    foulsDrawn: integer("fouls_drawn"),
    shots: integer("shots"),
    shotsOnTarget: integer("shots_on_target"),
    yellowCard: boolean("yellow_card"),
    redCard: boolean("red_card"),
    goals: integer("goals"),
    assists: integer("assists"),
    externalPlayerId: text("external_player_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.playerName, t.team, t.opponent, t.matchDate, t.competition),
  }),
)

export const referees = pgTable(
  "referees",
  {
    id: serial("id").primaryKey(),
    refereeName: text("referee_name").notNull(),
    matchesRefereed: integer("matches_refereed"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    yellowsPerGame: numeric("yellows_per_game"),
    foulsPerGame: numeric("fouls_per_game"),
    competition: text("competition"),
    season: text("season"),
    externalRefereeId: text("external_referee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.refereeName, t.competition, t.season),
  }),
)

export const playerRefereeHistory = pgTable(
  "player_referee_history",
  {
    id: serial("id").primaryKey(),
    refereeName: text("referee_name").notNull(),
    playerName: text("player_name").notNull(),
    team: text("team"),
    competition: text("competition"),
    season: text("season"),
    matchesTogether: integer("matches_together"),
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),
    foulsCommitted: integer("fouls_committed"),
    externalRefereeId: text("external_referee_id"),
    externalPlayerId: text("external_player_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.refereeName, t.playerName, t.competition, t.season),
  }),
)

export const oddsSnapshots = pgTable(
  "odds_snapshots",
  {
    id: serial("id").primaryKey(),
    competition: text("competition").notNull(),
    fixtureDate: date("fixture_date").notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    bookmaker: text("bookmaker").notNull(),
    source: text("source"),
    market: text("market").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    odds: numeric("odds").notNull(),
    snapshotBucket: timestamp("snapshot_bucket", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.competition, t.fixtureDate, t.homeTeam, t.awayTeam, t.bookmaker, t.market, t.label, t.snapshotBucket),
  }),
)

export type OddsSnapshot = typeof oddsSnapshots.$inferSelect

export type PlayerBaseline = typeof playerBaselines.$inferSelect
export type PlayerH2H = typeof playerH2H.$inferSelect
export type Referee = typeof referees.$inferSelect
export type PlayerRefereeHistory = typeof playerRefereeHistory.$inferSelect


export const recommendationSnapshots = pgTable(
  "recommendation_snapshots",
  {
    id: serial("id").primaryKey(),
    recommendationKey: text("recommendation_key").notNull(),
    fixtureId: text("fixture_id").notNull(),
    competition: text("competition").notNull(),
    fixtureDate: date("fixture_date").notNull(),
    kickoff: timestamp("kickoff", { withTimezone: true }).notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    slipId: text("slip_id").notNull(),
    slipTitle: text("slip_title").notNull(),
    recommendationRank: integer("recommendation_rank"),
    isTopPick: boolean("is_top_pick").notNull().default(false),
    bookmaker: text("bookmaker"),
    playerName: text("player_name").notNull(),
    dbPlayerName: text("db_player_name"),
    playerTeam: text("player_team"),
    opponentTeam: text("opponent_team"),
    market: text("market").notNull(),
    threshold: integer("threshold"),
    label: text("label").notNull(),
    modelProbability: numeric("model_probability").notNull(),
    fairOdds: numeric("fair_odds"),
    bookmakerOdds: numeric("bookmaker_odds"),
    edge: numeric("edge"),
    priceSource: text("price_source"),
    confidence: text("confidence"),
    lineupConfirmed: boolean("lineup_confirmed").notNull().default(false),
    placeable: boolean("placeable").notNull().default(false),
    outcome: boolean("outcome"),
    resultValue: integer("result_value"),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.recommendationKey, t.playerName, t.market, t.bookmaker),
  }),
)

export type RecommendationSnapshot = typeof recommendationSnapshots.$inferSelect
