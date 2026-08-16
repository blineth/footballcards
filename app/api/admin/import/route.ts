import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Dataset = "player_baselines" | "h2h" | "referees" | "player_referee_history"

// --- lightweight CSV parser (handles quoted fields and commas) ---
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
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
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
  if (field !== "" || row.length > 0) {
    row.push(field)
    if (row.some((v) => v.trim() !== "")) rows.push(row)
  }
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? "").trim()))
    return obj
  })
}

const int = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}
const dec = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : null
}
const str = (v: unknown) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === "" ? null : s
}
const bool = (v: unknown) => {
  if (v === "" || v === null || v === undefined) return null
  const s = String(v).toLowerCase().trim()
  if (["1", "true", "yes", "y"].includes(s)) return true
  if (["0", "false", "no", "n"].includes(s)) return false
  return null
}

function mapRows(dataset: Dataset, rows: Record<string, unknown>[]) {
  switch (dataset) {
    case "player_baselines":
      return rows.map((r) => ({
        playerName: str(r.player_name ?? r.player) ?? "",
        team: str(r.team) ?? "",
        competition: str(r.competition) ?? "",
        season: str(r.season) ?? "",
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
      }))
    case "h2h":
      return rows.map((r) => ({
        playerName: str(r.player_name ?? r.player) ?? "",
        team: str(r.team),
        opponent: str(r.opponent) ?? "",
        matchDate: str(r.match_date) ?? "",
        competition: str(r.competition),
        minutes: int(r.minutes),
        foulsCommitted: int(r.fouls_committed),
        foulsDrawn: int(r.fouls_drawn),
        yellowCard: bool(r.yellow_card),
        redCard: bool(r.red_card),
        externalPlayerId: str(r.external_player_id),
      }))
    case "referees":
      return rows.map((r) => ({
        refereeName: str(r.referee_name ?? r.referee) ?? "",
        matchesRefereed: int(r.matches_refereed),
        yellowCards: int(r.yellow_cards),
        redCards: int(r.red_cards),
        yellowsPerGame: dec(r.yellows_per_game),
        foulsPerGame: dec(r.fouls_per_game),
        competition: str(r.competition),
        season: str(r.season),
        externalRefereeId: str(r.external_referee_id),
      }))
    case "player_referee_history":
      return rows.map((r) => ({
        refereeName: str(r.referee_name ?? r.referee) ?? "",
        playerName: str(r.player_name ?? r.player) ?? "",
        team: str(r.team),
        matchesTogether: int(r.matches_together),
        yellowCards: int(r.yellow_cards),
        redCards: int(r.red_cards),
        foulsCommitted: int(r.fouls_committed),
        externalRefereeId: str(r.external_referee_id),
        externalPlayerId: str(r.external_player_id),
      }))
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 })
  }

  const body = (await request.json().catch(() => null)) as {
    dataset?: Dataset
    format?: "csv" | "json"
    content?: string
  } | null

  if (!body?.dataset || !body?.content) {
    return NextResponse.json({ ok: false, error: "Missing dataset or content." }, { status: 400 })
  }

  const validDatasets: Dataset[] = ["player_baselines", "h2h", "referees", "player_referee_history"]
  if (!validDatasets.includes(body.dataset)) {
    return NextResponse.json({ ok: false, error: "Unknown dataset." }, { status: 400 })
  }

  let raw: Record<string, unknown>[]
  try {
    if (body.format === "json") {
      const parsed = JSON.parse(body.content)
      raw = Array.isArray(parsed) ? parsed : parsed.rows ?? []
    } else {
      raw = parseCSV(body.content)
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Could not parse the file." }, { status: 400 })
  }

  if (raw.length === 0) {
    return NextResponse.json({ ok: false, error: "No rows found in file." }, { status: 400 })
  }

  const mapped = mapRows(body.dataset, raw)

  try {
    let inserted = 0
    // Chunk inserts to keep statements reasonable.
    const chunkSize = 200
    for (let i = 0; i < mapped.length; i += chunkSize) {
      const chunk = mapped.slice(i, i + chunkSize)
      if (chunk.length === 0) continue
      switch (body.dataset) {
        case "player_baselines":
          await db
            .insert(playerBaselines)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .values(chunk as any)
            .onConflictDoNothing()
          break
        case "h2h":
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.insert(playerH2H).values(chunk as any)
          break
        case "referees":
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.insert(referees).values(chunk as any).onConflictDoNothing()
          break
        case "player_referee_history":
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await db.insert(playerRefereeHistory).values(chunk as any).onConflictDoNothing()
          break
      }
      inserted += chunk.length
    }
    return NextResponse.json({ ok: true, dataset: body.dataset, rows: inserted })
  } catch (error) {
    console.log("[v0] import error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ok: false, error: "Insert failed. Check your column headers match the template." },
      { status: 500 },
    )
  }
}

export async function GET() {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ connected: false, counts: null })
  }
  const [b, h, r, prh] = await Promise.all([
    db.$count(playerBaselines),
    db.$count(playerH2H),
    db.$count(referees),
    db.$count(playerRefereeHistory),
  ])
  return NextResponse.json({
    connected: true,
    counts: { player_baselines: b, h2h: h, referees: r, player_referee_history: prh },
  })
}
