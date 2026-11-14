import { NextResponse } from "next/server"
import { and, asc, eq } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { oddsSnapshots } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  if (!isDatabaseConfigured) return NextResponse.json({ ok:false, error:"Database not connected" }, { status:503 })
  await ensureResearchSchema()

  const url = new URL(request.url)
  const competition = url.searchParams.get("competition") ?? "Premier League"
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  if (!date || !home || !away) return NextResponse.json({ ok:false, error:"date, home and away are required" }, { status:400 })

  const rows = await db.select().from(oddsSnapshots)
    .where(and(
      eq(oddsSnapshots.competition, competition),
      eq(oddsSnapshots.fixtureDate, date),
      eq(oddsSnapshots.homeTeam, home),
      eq(oddsSnapshots.awayTeam, away),
    ))
    .orderBy(asc(oddsSnapshots.snapshotBucket))

  const grouped = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.bookmaker}|${row.market}|${row.label}`
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }

  const selections = [...grouped.values()].map(series => {
    const open = series[0], current = series[series.length - 1]
    const prices = series.map(r => Number(r.odds)).filter(Number.isFinite)
    const openOdds = Number(open.odds), currentOdds = Number(current.odds)
    const openProb = openOdds > 0 ? 1 / openOdds : null
    const currentProb = currentOdds > 0 ? 1 / currentOdds : null
    return {
      bookmaker: current.bookmaker,
      source: current.source,
      market: current.market,
      kind: current.kind,
      label: current.label,
      snapshots: series.length,
      openOdds,
      currentOdds,
      highestOdds: prices.length ? Math.max(...prices) : null,
      lowestOdds: prices.length ? Math.min(...prices) : null,
      openImpliedProbability: openProb,
      currentImpliedProbability: currentProb,
      impliedProbabilityMove: openProb != null && currentProb != null ? currentProb - openProb : null,
      oddsMovePct: openOdds > 0 ? (currentOdds / openOdds) - 1 : null,
      openedAt: open.snapshotBucket,
      latestAt: current.snapshotBucket,
    }
  }).sort((a,b)=>Math.abs(Number(b.impliedProbabilityMove??0))-Math.abs(Number(a.impliedProbabilityMove??0)))

  return NextResponse.json({
    ok:true, competition, date, home, away,
    note:"Raw bookmaker implied probabilities include margin. Fair/no-vig probabilities require complementary outcomes from the same market.",
    selections,
    snapshots:rows.length,
    generatedAt:new Date().toISOString(),
  })
}
