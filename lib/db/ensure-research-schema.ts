import { isDatabaseConfigured, pool } from "@/lib/db"

let migration: Promise<void> | null = null

/**
 * Keep Neon compatible with the research schema without requiring a manual SQL
 * step after deploy. Existing Premier League rows are preserved and labelled;
 * Championship rows can coexist safely and repeated imports stay idempotent.
 */
export function ensureResearchSchema() {
  if (!isDatabaseConfigured) return Promise.resolve()
  if (migration) return migration

  migration = (async () => {
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS venue text`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS position text`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS starter boolean`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS external_match_id text`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS referee_name text`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS shots integer`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS shots_on_target integer`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS goals integer`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS assists integer`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS booking_reason text`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS yellow_card_minute integer`)
    await pool.query(`ALTER TABLE player_h2h ADD COLUMN IF NOT EXISTS fouls_stat_verified boolean`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS shots integer`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS shots_on_target integer`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS goals integer`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS assists integer`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS shots_per_90 numeric`)
    await pool.query(`ALTER TABLE player_baselines ADD COLUMN IF NOT EXISTS shots_on_target_per_90 numeric`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS competition text`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS season text`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS fouls_drawn integer`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS minutes integer`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS card_rate numeric`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS fouls_per_match numeric`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS cards_per_foul numeric`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`)

    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS fouls_called integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS penalties_awarded integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS first_half_yellows integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS second_half_yellows integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS zero_card_matches integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS five_plus_card_matches integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS seven_plus_card_matches integer`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS reds_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS cards_per_foul numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS fouls_per_card numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS penalties_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS first_half_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS second_half_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS average_first_card_minute numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS home_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS away_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS home_card_share numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS zero_card_rate numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS five_plus_card_rate numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS seven_plus_card_rate numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent10_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent10_fouls_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent10_cards_per_foul numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent25_yellows_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent25_fouls_per_game numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS recent25_cards_per_foul numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS strictness_score numeric`)
    await pool.query(`ALTER TABLE referees ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referee_match_history (
        id serial PRIMARY KEY,
        fixture_id text NOT NULL UNIQUE,
        referee_name text NOT NULL,
        fixture_date date NOT NULL,
        competition text,
        league_id integer,
        season text,
        round text,
        home_team text,
        away_team text,
        home_score integer,
        away_score integer,
        home_fouls integer,
        away_fouls integer,
        total_fouls integer,
        home_yellows integer,
        away_yellows integer,
        total_yellows integer,
        home_reds integer,
        away_reds integer,
        total_reds integer,
        first_half_yellows integer,
        second_half_yellows integer,
        first_card_minute integer,
        last_card_minute integer,
        home_penalties integer,
        away_penalties integer,
        total_penalties integer,
        source text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS referee_match_history_ref_idx ON referee_match_history (referee_name, fixture_date DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS referee_match_history_comp_idx ON referee_match_history (competition, season, fixture_date DESC)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS player_referee_match_history (
        id serial PRIMARY KEY,
        fixture_id text NOT NULL,
        referee_name text NOT NULL,
        fixture_date date NOT NULL,
        player_name text NOT NULL,
        team text,
        opponent text,
        competition text,
        season text,
        minutes integer,
        starter boolean,
        position text,
        fouls_committed integer,
        fouls_drawn integer,
        yellow_card boolean,
        red_card boolean,
        tackles integer,
        duels_total integer,
        duels_won integer,
        external_player_id text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS player_referee_match_history_unique ON player_referee_match_history (fixture_id, player_name, team)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS player_referee_match_history_ref_player_idx ON player_referee_match_history (referee_name, player_name, fixture_date DESC)`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS odds_snapshots (
        id serial PRIMARY KEY,
        competition text NOT NULL,
        fixture_date date NOT NULL,
        home_team text NOT NULL,
        away_team text NOT NULL,
        bookmaker text NOT NULL,
        source text,
        market text NOT NULL,
        kind text NOT NULL,
        label text NOT NULL,
        odds numeric NOT NULL,
        snapshot_bucket timestamptz NOT NULL,
        captured_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS odds_snapshots_market_bucket_unique
      ON odds_snapshots (competition, fixture_date, home_team, away_team, bookmaker, market, label, snapshot_bucket)
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendation_snapshots (
        id serial PRIMARY KEY,
        recommendation_key text NOT NULL,
        fixture_id text NOT NULL,
        competition text NOT NULL,
        fixture_date date NOT NULL,
        kickoff timestamptz NOT NULL,
        home_team text NOT NULL,
        away_team text NOT NULL,
        slip_id text NOT NULL,
        slip_title text NOT NULL,
        recommendation_rank integer,
        is_top_pick boolean NOT NULL DEFAULT false,
        bookmaker text,
        player_name text NOT NULL,
        db_player_name text,
        player_team text,
        opponent_team text,
        market text NOT NULL,
        threshold integer,
        label text NOT NULL,
        model_probability numeric NOT NULL,
        fair_odds numeric,
        bookmaker_odds numeric,
        edge numeric,
        price_source text,
        confidence text,
        lineup_confirmed boolean NOT NULL DEFAULT false,
        placeable boolean NOT NULL DEFAULT false,
        outcome boolean,
        result_value integer,
        graded_at timestamptz,
        captured_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS recommendation_snapshots_unique
      ON recommendation_snapshots (recommendation_key, player_name, market, COALESCE(bookmaker, ''))
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS recommendation_snapshots_ungraded_idx
      ON recommendation_snapshots (fixture_date, graded_at)
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS prediction_runs (
        id serial PRIMARY KEY,
        snapshot_key text NOT NULL UNIQUE,
        surface text NOT NULL,
        fixture_id text,
        competition text,
        fixture_date date,
        kickoff timestamptz,
        home_team text,
        away_team text,
        slip_id text NOT NULL,
        slip_title text,
        tier text,
        odds_target text,
        combined_odds numeric,
        model_joint_probability numeric,
        bookmaker text,
        lineup_confirmed boolean NOT NULL DEFAULT false,
        live boolean NOT NULL DEFAULT false,
        live_minute integer,
        referee_name text,
        referee_strictness numeric,
        fully_graded boolean NOT NULL DEFAULT false,
        won boolean,
        captured_at timestamptz NOT NULL DEFAULT now(),
        graded_at timestamptz
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS prediction_runs_time_idx
      ON prediction_runs (captured_at DESC)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS prediction_runs_surface_idx
      ON prediction_runs (surface, captured_at DESC)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prediction_legs (
        id serial PRIMARY KEY,
        run_id integer NOT NULL REFERENCES prediction_runs(id) ON DELETE CASCADE,
        leg_index integer NOT NULL,
        fixture_id text,
        competition text,
        fixture_date date,
        kickoff timestamptz,
        home_team text,
        away_team text,
        player_name text,
        db_player_name text,
        player_team text,
        opponent_team text,
        market text NOT NULL,
        threshold integer,
        label text NOT NULL,
        model_probability numeric NOT NULL,
        fair_odds numeric,
        bookmaker_odds numeric,
        confidence text,
        recent5_hit_rate numeric,
        season_hit_rate numeric,
        h2h_hit_rate numeric,
        h2h_matches integer,
        sample_matches integer,
        discipline_heat numeric,
        recent_fouls_10 integer,
        live_current_count integer,
        live_fouls integer,
        live_fouled integer,
        live_shots integer,
        live_sot integer,
        result_value numeric,
        outcome boolean,
        graded_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (run_id, leg_index)
      )
    `)
    // Preserve the exact evidence available when future predictions are published.
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS aggression_signals text[]`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS aggression_event_minute integer`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS live_feed_source text`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS live_feed_updated_at timestamptz`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS live_model_minute integer`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS fixture_id text`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS competition text`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS fixture_date date`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS kickoff timestamptz`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS home_team text`)
    await pool.query(`ALTER TABLE prediction_legs ADD COLUMN IF NOT EXISTS away_team text`)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS prediction_legs_ungraded_idx
      ON prediction_legs (graded_at, market)
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS prediction_legs_market_idx
      ON prediction_legs (market, graded_at)
    `)

    await pool.query(`
      UPDATE player_referee_history
      SET competition = COALESCE(competition, 'Premier League'),
          season = COALESCE(season, '2025/26')
      WHERE competition IS NULL OR season IS NULL
    `)

    await pool.query(`
      DO $$
      DECLARE constraint_name text;
      BEGIN
        SELECT c.conname INTO constraint_name
        FROM pg_constraint c
        WHERE c.conrelid = 'player_referee_history'::regclass
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) = 'UNIQUE (referee_name, player_name)'
        LIMIT 1;

        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE player_referee_history DROP CONSTRAINT %I', constraint_name);
        END IF;
      END $$;
    `)

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS player_referee_history_competition_unique
      ON player_referee_history (referee_name, player_name, competition, season)
    `)

    // Remove only exact duplicate H2H imports before adding the idempotency key.
    await pool.query(`
      DELETE FROM player_h2h a
      USING player_h2h b
      WHERE a.id > b.id
        AND a.player_name = b.player_name
        AND COALESCE(a.team, '') = COALESCE(b.team, '')
        AND a.opponent = b.opponent
        AND a.match_date = b.match_date
        AND COALESCE(a.competition, '') = COALESCE(b.competition, '')
    `)

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS player_h2h_competition_unique
      ON player_h2h (player_name, COALESCE(team, ''), opponent, match_date, COALESCE(competition, ''))
    `)
  })().catch((error) => {
    migration = null
    throw error
  })

  return migration
}
