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
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS competition text`)
    await pool.query(`ALTER TABLE player_referee_history ADD COLUMN IF NOT EXISTS season text`)

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
