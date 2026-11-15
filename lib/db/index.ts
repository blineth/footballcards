import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// A small shared pool is enough for this app and avoids opening a burst of
// Neon connections when several serverless routes run in parallel.
const globalForDb = globalThis as unknown as { pool?: Pool }

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    min: 0,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  })

// Reuse the pool for the lifetime of a warm serverless instance in production too.
if (!globalForDb.pool) globalForDb.pool = pool

export const db = drizzle(pool, { schema })

/** True when a database connection string is configured. */
export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL)
