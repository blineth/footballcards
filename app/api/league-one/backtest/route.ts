import { NextResponse } from "next/server"
import { and, asc, eq, gte } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

const SEASON_START = "2026-08-01"

type Row = typeof playerH2H.$inferSelect
type Market = "card" | "foul1" | "foul2" | "sot1"

function norm(v: string | null | undefined) {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function playerKey(r: Row) { return `${norm(r.playerName)}|${norm(r.team)}` }
function fixtureKey(r: Row) {
  const teams = [norm(r.team), norm(r.opponent)].sort()
  return `${String(r.matchDate)}|${teams[0]}|${teams[1]}`
}
function played(r: Row) { return Number(r.minutes ?? 0) > 0 }
function recent<T>(rows: T[], n = 5) { return rows.slice(Math.max(0, rows.length - n)) }
function rate(rows: Row[], fn: (r: Row) => boolean) {
  return rows.length ? rows.filter(fn).length / rows.length : 0
}
function per90(rows: Row[], fn: (r: Row) => number) {
  const minutes = rows.reduce((s, r) => s + Number(r.minutes ?? 0), 0)
  const total = rows.reduce((s, r) => s + fn(r), 0)
  return minutes > 0 ? (total * 90) / minutes : 0
}
function outcome(market: Market, r: Row) {
  if (market === "card") return r.yellowCard === true
  if (market === "foul1") return Number(r.foulsCommitted ?? 0) >= 1
  if (market === "foul2") return Number(r.foulsCommitted ?? 0) >= 2
  return Number(r.shotsOnTarget ?? 0) >= 1
}
function signal(market: Market, history: Row[]) {
  const last5 = recent(history, 5)
  if (market === "card") {
    const seasonHit = rate(history, r => r.yellowCard === true)
    const recentHit = rate(last5, r => r.yellowCard === true)
    const foulPressure = Math.min(1, per90(last5.length ? last5 : history, r => Number(r.foulsCommitted ?? 0)) / 2.5)
    return seasonHit * 0.45 + recentHit * 0.35 + foulPressure * 0.20
  }
  if (market === "foul1" || market === "foul2") {
    const threshold = market === "foul1" ? 1 : 2
    const seasonHit = rate(history, r => Number(r.foulsCommitted ?? 0) >= threshold)
    const recentHit = rate(last5, r => Number(r.foulsCommitted ?? 0) >= threshold)
    const foulPressure = Math.min(1, per90(last5.length ? last5 : history, r => Number(r.foulsCommitted ?? 0)) / (market === "foul1" ? 2.2 : 3.2))
    return seasonHit * 0.35 + recentHit * 0.45 + foulPressure * 0.20
  }
  const seasonHit = rate(history, r => Number(r.shotsOnTarget ?? 0) >= 1)
  const recentHit = rate(last5, r => Number(r.shotsOnTarget ?? 0) >= 1)
  const sotPressure = Math.min(1, per90(last5.length ? last5 : history, r => Number(r.shotsOnTarget ?? 0)) / 1.4)
  return seasonHit * 0.35 + recentHit * 0.45 + sotPressure * 0.20
}

export async function GET() {
  if (!isDatabaseConfigured) return NextResponse.json({ ok:false, error:"Database not connected" }, { status:503 })
  await ensureResearchSchema()

  const rows = await db.select().from(playerH2H)
    .where(and(eq(playerH2H.competition, "League One"), gte(playerH2H.matchDate, SEASON_START)))
    .orderBy(asc(playerH2H.matchDate), asc(playerH2H.team), asc(playerH2H.playerName))

  const fixtures = new Map<string, Row[]>()
  for (const row of rows) {
    const key = fixtureKey(row)
    const list = fixtures.get(key) ?? []
    list.push(row)
    fixtures.set(key, list)
  }

  const history = new Map<string, Row[]>()
  const markets: Market[] = ["card","foul1","foul2","sot1"]
  const stats = Object.fromEntries(markets.map(m => [m, {
    top1Selections:0, top1Hits:0, top3Selections:0, top3Hits:0,
    eligiblePlayerRows:0, eligibleHits:0, testedFixtures:0,
  }])) as Record<Market, {top1Selections:number;top1Hits:number;top3Selections:number;top3Hits:number;eligiblePlayerRows:number;eligibleHits:number;testedFixtures:number}>

  const fixtureList = [...fixtures.entries()].sort((a,b)=>a[0].localeCompare(b[0]))

  for (const [, fixtureRows] of fixtureList) {
    const active = fixtureRows.filter(played)
    for (const market of markets) {
      const ranked = active.map(row => {
        const prior = history.get(playerKey(row)) ?? []
        const priorPlayed = prior.filter(played)
        const priorMinutes = priorPlayed.reduce((s,r)=>s+Number(r.minutes??0),0)
        if (priorPlayed.length < 3 || priorMinutes < 180) return null
        return { row, score: signal(market, priorPlayed), hit: outcome(market, row) }
      }).filter((x): x is {row:Row;score:number;hit:boolean} => Boolean(x))
        .sort((a,b)=>b.score-a.score)

      if (ranked.length) {
        stats[market].testedFixtures += 1
        stats[market].eligiblePlayerRows += ranked.length
        stats[market].eligibleHits += ranked.filter(x=>x.hit).length
        const top1 = ranked.slice(0,1)
        const top3 = ranked.slice(0,3)
        stats[market].top1Selections += top1.length
        stats[market].top1Hits += top1.filter(x=>x.hit).length
        stats[market].top3Selections += top3.length
        stats[market].top3Hits += top3.filter(x=>x.hit).length
      }
    }

    for (const row of active) {
      const key = playerKey(row)
      const list = history.get(key) ?? []
      list.push(row)
      history.set(key, list)
    }
  }

  const metrics = Object.fromEntries(markets.map(market => {
    const s = stats[market]
    const baseRate = s.eligiblePlayerRows ? s.eligibleHits / s.eligiblePlayerRows : 0
    const top1Rate = s.top1Selections ? s.top1Hits / s.top1Selections : 0
    const top3Rate = s.top3Selections ? s.top3Hits / s.top3Selections : 0
    return [market, {
      testedFixtures:s.testedFixtures,
      eligiblePlayerRows:s.eligiblePlayerRows,
      baseRate:Math.round(baseRate*1000)/1000,
      top1:{selections:s.top1Selections,hits:s.top1Hits,hitRate:Math.round(top1Rate*1000)/1000,lift:baseRate?Math.round((top1Rate/baseRate)*100)/100:null},
      top3:{selections:s.top3Selections,hits:s.top3Hits,hitRate:Math.round(top3Rate*1000)/1000,lift:baseRate?Math.round((top3Rate/baseRate)*100)/100:null},
    }]
  }))

  const playedRows = rows.filter(played)
  const positionRows = playedRows.filter(r => Boolean(r.position)).length
  const starterRows = playedRows.filter(r => r.starter === true).length

  return NextResponse.json({
    ok:true,
    competition:"League One",
    season:"2026/27",
    methodology:"Walk-forward only: every test prediction uses that player's earlier League One matches, never the target match or a later match. Minimum 3 prior appearances and 180 prior minutes.",
    warning:"This validates ranking signal, not bookmaker profitability. Odds and closing-line data are required before ROI can be measured.",
    fixturesInDatabase:fixtureList.length,
    playerMatchRows:rows.length,
    dataQuality:{
      playedRows:playedRows.length,
      positionRows,
      positionCoverage:playedRows.length?Math.round((positionRows/playedRows.length)*1000)/1000:0,
      starterRows,
    },
    metrics,
    generatedAt:new Date().toISOString(),
  })
}
