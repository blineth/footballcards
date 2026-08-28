import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines, playerH2H, playerRefereeHistory, referees } from "@/lib/db/schema"
import { and, eq, gte } from "drizzle-orm"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const LEAGUE = "eng.1"
const COMPETITION = "Premier League"
const SEASON = "2026/27"
const START = "2026-08-21"
const END = "2026-08-28"
const SYNC_KEY = "mw1-2026-27-7f4d9c2a"
const BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE}`

type AnyRow = Record<string, any>

async function getJson(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": "footballcards-research/4.0", Accept: "application/json" }, cache: "no-store" })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

function ymd(d: Date) { return d.toISOString().slice(0, 10).replaceAll("-", "") }
function datesBetween(a: string, b: string) {
  const out: string[] = []
  for (let d = new Date(`${a}T12:00:00Z`), end = new Date(`${b}T12:00:00Z`); d <= end; d = new Date(d.getTime() + 86400000)) out.push(ymd(d))
  return out
}
function statsMap(row: AnyRow) {
  const m: Record<string, number> = {}
  for (const s of row.stats ?? []) if (s?.name && s?.value != null && Number.isFinite(Number(s.value))) m[String(s.name)] = Number(s.value)
  return m
}
function clockMinute(play: AnyRow) {
  const v = play?.clock?.value
  return Number.isFinite(Number(v)) ? Math.max(0, Math.min(90, Math.floor(Number(v) / 60))) : null
}
function minutesMap(summary: AnyRow) {
  const entered = new Map<string, number>(), left = new Map<string, number>(), starters = new Set<string>()
  for (const sec of summary.rosters ?? []) for (const row of sec.roster ?? []) {
    const id = String(row?.athlete?.id ?? "")
    if (id && row.starter === true) { starters.add(id); entered.set(id, 0) }
  }
  for (const p of summary.keyEvents ?? summary.plays ?? []) {
    const type = String(p?.type?.type ?? "").toLowerCase(); const min = clockMinute(p); if (min == null) continue
    const ids = (p.participants ?? []).map((x: AnyRow) => String(x?.athlete?.id ?? "")).filter(Boolean)
    if (type === "substitution" && ids.length) { if (!entered.has(ids[0])) entered.set(ids[0], min); if (ids[1]) left.set(ids[1], min) }
    if (["red-card","red_card","second-yellow-card","second-yellow-red-card"].includes(type) && ids[0]) left.set(ids[0], min)
  }
  const result = new Map<string, number>()
  for (const id of new Set([...entered.keys(), ...starters])) result.set(id, Math.max(1, (left.get(id) ?? 90) - (entered.get(id) ?? 0)))
  return result
}
function referee(summary: AnyRow) {
  for (const o of summary?.gameInfo?.officials ?? summary?.officials ?? []) { const n = o?.displayName ?? o?.fullName; if (n) return String(n) }
  return ""
}
function teams(event: AnyRow) {
  const c = event?.competitions?.[0]?.competitors ?? []
  const home = c.find((x: AnyRow) => x.homeAway === "home")?.team?.displayName ?? ""
  const away = c.find((x: AnyRow) => x.homeAway === "away")?.team?.displayName ?? ""
  return [String(home), String(away)] as const
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get("key") !== SYNC_KEY) return NextResponse.json({ ok: false }, { status: 404 })
  if (!isDatabaseConfigured) return NextResponse.json({ ok: false, error: "Database not connected" }, { status: 503 })
  await ensureResearchSchema()

  try {
    const events = new Map<string, AnyRow>()
    for (const day of datesBetween(START, END)) {
      const board = await getJson(`${BASE}/scoreboard?dates=${day}`)
      for (const e of board.events ?? []) if (e?.id && e?.status?.type?.completed === true) events.set(String(e.id), e)
    }
    const ordered = [...events.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    const playerMatches: AnyRow[] = [], matchMeta: AnyRow[] = []

    for (const event of ordered) {
      const id = String(event.id), summary = await getJson(`${BASE}/summary?event=${id}`), [home, away] = teams(event)
      const date = String(event.date ?? "").slice(0, 10), mins = minutesMap(summary), ref = referee(summary)
      let matchY = 0, matchR = 0, matchF = 0
      for (const sec of summary.rosters ?? []) {
        const side = String(sec.homeAway ?? ""), team = String(sec?.team?.displayName ?? (side === "home" ? home : away)), opp = side === "home" ? away : home
        for (const row of sec.roster ?? []) {
          const athlete = row.athlete ?? {}, pid = String(athlete.id ?? ""), name = String(athlete.displayName ?? athlete.fullName ?? ""), stats = statsMap(row)
          const appeared = (stats.appearances ?? 0) > 0 || row.starter === true || row.subbedIn === true
          if (!pid || !name || !appeared) continue
          const fc = Math.trunc(stats.foulsCommitted ?? 0), fd = Math.trunc(stats.foulsSuffered ?? 0), yc = (stats.yellowCards ?? 0) > 0 ? 1 : 0, rc = (stats.redCards ?? 0) > 0 ? 1 : 0
          matchY += yc; matchR += rc; matchF += fc
          playerMatches.push({ playerName: name, team, opponent: opp, matchDate: date, competition: COMPETITION, venue: side === "home" ? "home" : "away", minutes: mins.get(pid) ?? (row.starter === true ? 90 : 1), foulsCommitted: fc, foulsDrawn: fd, yellowCard: !!yc, redCard: !!rc, externalPlayerId: pid, position: String(row?.position?.displayName ?? row?.position?.abbreviation ?? ""), starter: row.starter === true, referee: ref })
        }
      }
      matchMeta.push({ id, date, home, away, referee: ref, yellowCards: matchY, redCards: matchR, fouls: matchF })
    }
    if (ordered.length < 10 || playerMatches.length < 250) throw new Error(`Quality gate failed: ${ordered.length} matches, ${playerMatches.length} player rows`)

    const p = new Map<string, AnyRow>()
    for (const r of playerMatches) {
      const k = `${r.externalPlayerId}|${r.team}`
      const x = p.get(k) ?? { playerName:r.playerName, team:r.team, competition:COMPETITION, season:SEASON, appearances:0, starts:0, minutes:0, yellowCards:0, redCards:0, foulsCommitted:0, foulsDrawn:0, position:r.position, externalPlayerId:r.externalPlayerId }
      x.appearances++; x.starts += r.starter ? 1 : 0; x.minutes += r.minutes; x.yellowCards += r.yellowCard ? 1 : 0; x.redCards += r.redCard ? 1 : 0; x.foulsCommitted += r.foulsCommitted; x.foulsDrawn += r.foulsDrawn; p.set(k,x)
    }
    const baselineRows = [...p.values()].map(x => ({ ...x, foulsPer90: x.minutes ? String(Number((x.foulsCommitted * 90 / x.minutes).toFixed(4))) : null, cardsPer90: x.minutes ? String(Number((x.yellowCards * 90 / x.minutes).toFixed(4))) : null }))

    const rm = new Map<string, AnyRow>(), prm = new Map<string, AnyRow>()
    for (const m of matchMeta) if (m.referee) {
      const x = rm.get(m.referee) ?? { matchesRefereed:0, yellowCards:0, redCards:0, fouls:0 }; x.matchesRefereed++; x.yellowCards += m.yellowCards; x.redCards += m.redCards; x.fouls += m.fouls; rm.set(m.referee,x)
    }
    for (const r of playerMatches) if (r.referee) {
      const k = `${r.referee}|${r.externalPlayerId}`; const x = prm.get(k) ?? { refereeName:r.referee, playerName:r.playerName, team:r.team, competition:COMPETITION, season:SEASON, matchesTogether:0, yellowCards:0, redCards:0, foulsCommitted:0, externalRefereeId:null, externalPlayerId:r.externalPlayerId }
      x.matchesTogether++; x.yellowCards += r.yellowCard ? 1 : 0; x.redCards += r.redCard ? 1 : 0; x.foulsCommitted += r.foulsCommitted; prm.set(k,x)
    }
    const refRows = [...rm.entries()].map(([name,x]) => ({ refereeName:name, matchesRefereed:x.matchesRefereed, yellowCards:x.yellowCards, redCards:x.redCards, yellowsPerGame:String(Number((x.yellowCards/x.matchesRefereed).toFixed(4))), foulsPerGame:String(Number((x.fouls/x.matchesRefereed).toFixed(4))), competition:COMPETITION, season:SEASON, externalRefereeId:null }))
    const h2hRows = playerMatches.map(r => ({ playerName:r.playerName, team:r.team, opponent:r.opponent, matchDate:r.matchDate, competition:r.competition, venue:r.venue, minutes:r.minutes, foulsCommitted:r.foulsCommitted, foulsDrawn:r.foulsDrawn, yellowCard:r.yellowCard, redCard:r.redCard, externalPlayerId:r.externalPlayerId }))

    await db.transaction(async tx => {
      await tx.delete(playerBaselines).where(and(eq(playerBaselines.competition, COMPETITION), eq(playerBaselines.season, SEASON)))
      await tx.delete(referees).where(and(eq(referees.competition, COMPETITION), eq(referees.season, SEASON)))
      await tx.delete(playerRefereeHistory).where(and(eq(playerRefereeHistory.competition, COMPETITION), eq(playerRefereeHistory.season, SEASON)))
      await tx.delete(playerH2H).where(and(eq(playerH2H.competition, COMPETITION), gte(playerH2H.matchDate, START)))
      for (let i=0;i<baselineRows.length;i+=200) await tx.insert(playerBaselines).values(baselineRows.slice(i,i+200))
      for (let i=0;i<h2hRows.length;i+=200) await tx.insert(playerH2H).values(h2hRows.slice(i,i+200))
      if (refRows.length) await tx.insert(referees).values(refRows)
      for (const rows of Array.from(prm.values()).reduce<AnyRow[][]>((a,x,i)=>{ if(i%200===0)a.push([]); a[a.length-1].push(x); return a },[])) await tx.insert(playerRefereeHistory).values(rows)
    })

    return NextResponse.json({ ok:true, competition:COMPETITION, season:SEASON, preservedHistoricalSeason:"2025/26", matches:ordered.length, playerMatchRows:h2hRows.length, playerBaselines:baselineRows.length, referees:refRows.length, playerRefereeRows:prm.size, matchMeta })
  } catch (e) {
    console.error("[sync-premier-league-current]", e)
    return NextResponse.json({ ok:false, error:e instanceof Error ? e.message : String(e) }, { status:500 })
  }
}
