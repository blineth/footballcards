import fs from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import {
  playerBaselines,
  playerH2H,
  playerRefereeHistory,
  referees,
} from "@/lib/db/schema"

export const dynamic = "force-dynamic"

type Dataset = "player_baselines" | "h2h" | "referees" | "player_referee_history"

const files: Record<Dataset, string> = {
  player_baselines: "player_baselines.csv",
  h2h: "h2h.csv",
  referees: "referees.csv",
  player_referee_history: "player_referee_history.csv",
}

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      field = ""
      if (row.some((v) => v.trim() !== "")) rows.push(row)
      row = []
    } else field += c
  }

  if (field !== "" || row.length) {
    row.push(field)
    if (row.some((v) => v.trim() !== "")) rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ""))
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])))
}

const int = (v: string | undefined) => (!v ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
const dec = (v: string | undefined) => (!v ? null : Number.isFinite(Number(v)) ? String(Number(v)) : null)
const str = (v: string | undefined) => (!v?.trim() ? null : v.trim())
const bool = (v: string | undefined) => {
  if (!v?.trim()) return null
  const s = v.toLowerCase().trim()
  if (["1", "true", "yes", "y"].includes(s)) return true
  if (["0", "false", "no", "n"].includes(s)) return false
  return null
}

function mapped(dataset: Dataset, r: Record<string, string>) {
  switch (dataset) {
    case "player_baselines":
      return {
        playerName: r.player_name,
        team: r.team,
        competition: r.competition,
        season: r.season,
        appearances: int(r.appearances),
        starts: int(r.starts),
        minutes: int(r.minutes),
        yellowCards: int(r.yellow_cards),
        redCards: int(r.red_cards),
        foulsCommitted: int(r.fouls_committed),
        foulsDrawn: int(r.fouls_drawn),
        foulsPer90: dec(r.fouls_per_90),
        cardsPer90: dec(r.cards_per_90),
        position: str(r.position),
        externalPlayerId: str(r.external_player_id),
      }
    case "h2h":
      return {
        playerName: r.player_name,
        team: str(r.team),
        opponent: r.opponent,
        matchDate: r.match_date,
        competition: str(r.competition),
        venue: str(r.venue),
        minutes: int(r.minutes),
        foulsCommitted: int(r.fouls_committed),
        foulsDrawn: int(r.fouls_drawn),
        yellowCard: bool(r.yellow_card),
        redCard: bool(r.red_card),
        externalPlayerId: str(r.external_player_id),
      }
    case "referees":
      return {
        refereeName: r.referee_name,
        matchesRefereed: int(r.matches_refereed),
        yellowCards: int(r.yellow_cards),
        redCards: int(r.red_cards),
        yellowsPerGame: dec(r.yellows_per_game),
        foulsPerGame: dec(r.fouls_per_game),
        competition: str(r.competition),
        season: str(r.season),
        externalRefereeId: str(r.external_referee_id),
      }
    case "player_referee_history":
      return {
        refereeName: r.referee_name,
        playerName: r.player_name,
        team: str(r.team),
        competition: str(r.competition),
        season: str(r.season),
        matchesTogether: int(r.matches_together),
        yellowCards: int(r.yellow_cards),
        redCards: int(r.red_cards),
        foulsCommitted: int(r.fouls_committed),
        externalRefereeId: str(r.external_referee_id),
        externalPlayerId: str(r.external_player_id),
      }
  }
}

export async function GET(request: Request) {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 })
  }

  const url = new URL(request.url)
  const dataset = url.searchParams.get("dataset") as Dataset | null
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0)
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 500) || 500))

  if (!dataset || !(dataset in files)) {
    return NextResponse.json({
      ok: false,
      error: "Choose dataset=player_baselines|h2h|referees|player_referee_history",
    }, { status: 400 })
  }

  await ensureResearchSchema()

  const file = path.join(process.cwd(), "data", "championship", files[dataset])
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch {
    return NextResponse.json({ ok: false, ready: false, error: `Championship file not deployed yet: ${files[dataset]}` }, { status: 404 })
  }

  const all = parseCSV(text)
  const sourceCompetition = new Set(all.map((r) => r.competition).filter(Boolean))
  if (sourceCompetition.size !== 1 || !sourceCompetition.has("Championship")) {
    return NextResponse.json({ ok: false, error: "Safety check failed: file is not Championship-only." }, { status: 409 })
  }

  const slice = all.slice(offset, offset + limit)
  if (!slice.length) {
    return NextResponse.json({ ok: true, ready: true, dataset, total: all.length, offset, processed: 0, done: true })
  }

  const values = slice.map((r) => mapped(dataset, r))
  if (dataset === "player_baselines") await db.insert(playerBaselines).values(values as never).onConflictDoNothing()
  if (dataset === "h2h") await db.insert(playerH2H).values(values as never).onConflictDoNothing()
  if (dataset === "referees") await db.insert(referees).values(values as never).onConflictDoNothing()
  if (dataset === "player_referee_history") await db.insert(playerRefereeHistory).values(values as never).onConflictDoNothing()

  const nextOffset = offset + slice.length
  return NextResponse.json({
    ok: true,
    ready: true,
    dataset,
    total: all.length,
    offset,
    processed: slice.length,
    nextOffset,
    done: nextOffset >= all.length,
    competition: "Championship",
    season: "2025/26",
    replacedPremierLeague: false,
  })
}
