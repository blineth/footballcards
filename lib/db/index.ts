import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

// A single shared connection pool for the whole app.
// DATABASE_URL is provisioned by the Neon integration.
const globalForDb = globalThis as unknown as { pool?: Pool }

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  })

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool

export const db = drizzle(pool, { schema })

/** True when a database connection string is configured. */
export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL)
