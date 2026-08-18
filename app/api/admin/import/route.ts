import { db, isDatabaseConfigured } from "@/lib/db"
import {
  playerBaselines,
  playerH2H,
  playerRefereeHistory,
  referees,
} from "@/lib/db/schema"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Dataset = "player_baselines" | "h2h" | "referees" | "player_referee_history"

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

const int = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null)
const dec = (v: unknown) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? String(Number(v)) : null)
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim())
const bool = (v: unknown) => {
  if (v === "" || v == null) return null
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
        appearances: int(r.appearances), starts: int(r.starts), minutes: int(r.minutes),
        yellowCards: int(r.yellow_cards), redCards: int(r.red_cards),
        foulsCommitted: int(r.fouls_committed), foulsDrawn: int(r.fouls_drawn),
        foulsPer90: dec(r.fouls_per_90), cardsPer90: dec(r.cards_per_90),
        position: str(r.position), externalPlayerId: str(r.external_player_id),
      }))
    case "h2h":
      return rows.map((r) => ({
        playerName: str(r.player_name ?? r.player) ?? "",
        team: str(r.team), opponent: str(r.opponent) ?? "", matchDate: str(r.match_date) ?? "",
        competition: str(r.competition), venue: str(r.venue), minutes: int(r.minutes),
        foulsCommitted: int(r.fouls_committed), foulsDrawn: int(r.fouls_drawn),
        yellowCard: bool(r.yellow_card), redCard: bool(r.red_card), externalPlayerId: str(r.external_player_id),
      }))
    case "referees":
      return rows.map((r) => ({
        refereeName: str(r.referee_name ?? r.referee) ?? "",
        matchesRefereed: int(r.matches_refereed), yellowCards: int(r.yellow_cards), redCards: int(r.red_cards),
        yellowsPerGame: dec(r.yellows_per_game), foulsPerGame: dec(r.fouls_per_game),
        competition: str(r.competition), season: str(r.season), externalRefereeId: str(r.external_referee_id),
      }))
    case "player_referee_history":
      return rows.map((r) => ({
        refereeName: str(r.referee_name ?? r.referee) ?? "",
        playerName: str(r.player_name ?? r.player) ?? "",
        team: str(r.team), competition: str(r.competition), season: str(r.season),
        matchesTogether: int(r.matches_together), yellowCards: int(r.yellow_cards), redCards: int(r.red_cards),
        foulsCommitted: int(r.fouls_committed), externalRefereeId: str(r.external_referee_id), externalPlayerId: str(r.external_player_id),
      }))
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected." }, { status: 503 })
  await ensureResearchSchema()

  const body = (await request.json().catch(() => null)) as { dataset?: Dataset; format?: "csv" | "json"; content?: string } | null
  if (!body?.dataset || !body.content) return NextResponse.json({ ok: false, error: "Missing dataset or content." }, { status: 400 })
  if (!["player_baselines", "h2h", "referees", "player_referee_history"].includes(body.dataset)) {
    return NextResponse.json({ ok: false, error: "Unknown dataset." }, { status: 400 })
  }

  let raw: Record<string, unknown>[]
  try {
    if (body.format === "json") {
      const parsed = JSON.parse(body.content)
      raw = Array.isArray(parsed) ? parsed : parsed.rows ?? []
    } else raw = parseCSV(body.content)
  } catch {
    return NextResponse.json({ ok: false, error: "Could not parse the file." }, { status: 400 })
  }
  if (!raw.length) return NextResponse.json({ ok: false, error: "No rows found in file." }, { status: 400 })

  const mapped = mapRows(body.dataset, raw)
  const competitions = Array.from(new Set(raw.map((r) => str(r.competition)).filter((v): v is string => Boolean(v))))
  const seasons = Array.from(new Set(raw.map((r) => str(r.season)).filter((v): v is string => Boolean(v))))

  try {
    let processed = 0
    for (let i = 0; i < mapped.length; i += 200) {
      const chunk = mapped.slice(i, i + 200)
      if (body.dataset === "player_baselines") await db.insert(playerBaselines).values(chunk as never).onConflictDoNothing()
      if (body.dataset === "h2h") await db.insert(playerH2H).values(chunk as never)
      if (body.dataset === "referees") await db.insert(referees).values(chunk as never).onConflictDoNothing()
      if (body.dataset === "player_referee_history") await db.insert(playerRefereeHistory).values(chunk as never).onConflictDoNothing()
      processed += chunk.length
    }

    return NextResponse.json({ ok: true, dataset: body.dataset, rows: processed, competitions, seasons, importMode: "additive", replacedExisting: false })
  } catch (error) {
    console.log("[import] error", error)
    return NextResponse.json({ ok: false, error: "Import failed. Existing Premier League data was not intentionally deleted or replaced." }, { status: 500 })
  }
}

export async function GET() {
  if (!isDatabaseConfigured) return NextResponse.json({ connected: false, counts: null })
  await ensureResearchSchema()
  const [b, h, r, prh] = await Promise.all([
    db.$count(playerBaselines), db.$count(playerH2H), db.$count(referees), db.$count(playerRefereeHistory),
  ])
  return NextResponse.json({ connected: true, counts: { player_baselines: b, h2h: h, referees: r, player_referee_history: prh } })
}
