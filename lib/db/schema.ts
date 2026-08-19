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
    foulsCommitted: integer("fouls_committed"),
    foulsDrawn: integer("fouls_drawn"),
    foulsPer90: numeric("fouls_per_90"),
    cardsPer90: numeric("cards_per_90"),
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
    minutes: integer("minutes"),
    foulsCommitted: integer("fouls_committed"),
    foulsDrawn: integer("fouls_drawn"),
    yellowCard: boolean("yellow_card"),
    redCard: boolean("red_card"),
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

export type PlayerBaseline = typeof playerBaselines.$inferSelect
export type PlayerH2H = typeof playerH2H.$inferSelect
export type Referee = typeof referees.$inferSelect
export type PlayerRefereeHistory = typeof playerRefereeHistory.$inferSelect
