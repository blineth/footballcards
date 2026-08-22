import fs from "node:fs/promises"
import path from "node:path"
import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines } from "@/lib/db/schema"

export const dynamic = "force-dynamic"

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = "", row: string[] = [], inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field); field = ""
      if (row.some((v) => v.trim() !== "")) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v.trim() !== "")) rows.push(row) }
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""))
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])))
}

const int = (v: string | undefined) => (!v ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
const dec = (v: string | undefined) => (!v ? null : Number.isFinite(Number(v)) ? String(Number(v)) : null)
const str = (v: string | undefined) => (!v?.trim() ? null : v.trim())

export async function GET() {
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 })
  await ensureResearchSchema()

  const file = path.join(process.cwd(), "data", "championship", "current_player_baselines.csv")
  let text: string
  try { text = await fs.readFile(file, "utf8") }
  catch { return NextResponse.json({ ok: false, ready: false, error: "Validated Championship player file is not deployed yet." }, { status: 404 }) }

  const rows = parseCSV(text)
  if (rows.length < 300) return NextResponse.json({ ok: false, error: `Safety check failed: only ${rows.length} player rows.` }, { status: 409 })
  const clubs = new Set(rows.map((r) => r.current_team).filter(Boolean))
  if (clubs.size !== 24) return NextResponse.json({ ok: false, error: `Safety check failed: expected 24 Championship clubs, found ${clubs.size}.` }, { status: 409 })

  const values = rows.map((r) => ({
    playerName: r.player_name,
    team: r.current_team,
    competition: "Championship",
    season: "2026/27",
    appearances: int(r.appearances),
    starts: int(r.starts),
    minutes: int(r.minutes),
    yellowCards: int(r.yellow_cards),
    redCards: int(r.red_cards),
    foulsCommitted: int(r.fouls_committed),
    foulsDrawn: int(r.fouls_drawn),
    foulsPer90: dec(r.fouls_per_90),
    cardsPer90: dec(r.yellow_cards_per_90),
    position: str(r.position),
    externalPlayerId: null,
  }))

  // Replace ONLY Championship 2026/27 player baseline rows.
  await db.delete(playerBaselines).where(and(
    eq(playerBaselines.competition, "Championship"),
    eq(playerBaselines.season, "2026/27"),
  ))
  await db.insert(playerBaselines).values(values as never)

  return NextResponse.json({
    ok: true,
    imported: values.length,
    clubs: clubs.size,
    competition: "Championship",
    season: "2026/27",
    h2hTouched: false,
    refereesTouched: false,
    premierLeagueTouched: false,
  })
}
