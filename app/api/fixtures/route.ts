import { londonToday } from "@/lib/date"
import { getProvider } from "@/lib/providers"
import { getRefereeByName } from "@/lib/historical"
import { isDatabaseConfigured, pool } from "@/lib/db"
import type { Competition, Fixture, FixturesResponse, MatchStatus } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ESPN_LEAGUES: Record<Competition, string[]> = {
  "Premier League": ["eng.1"],
  Championship: ["eng.2"],
  "League One": ["eng.3"],
  "League Two": ["eng.4"],
  International: ["uefa.nations", "fifa.friendly", "fifa.world", "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf", "fifa.worldq.afc", "fifa.worldq.caf", "uefa.euro", "uefa.euroq"],
}

type FixtureCacheEntry={fixtures:Fixture[];updatedAt:number}
const fixtureCache=new Map<string,FixtureCacheEntry>()
const fixtureLastPersist=new Map<string,number>()
const FIXTURE_CACHE_MS=18*60*60*1000
const FIXTURE_PERSIST_MS=30*60*1000
let fixtureCacheTableReady=false

async function ensureFixtureCacheTable(){
  if(!isDatabaseConfigured)return false
  if(fixtureCacheTableReady)return true
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS fixture_day_cache (
      fixture_date date PRIMARY KEY,
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`)
    fixtureCacheTableReady=true
    return true
  }catch{return false}
}

async function readPersistentFixtureCache(date:string):Promise<FixtureCacheEntry|null>{
  if(!(await ensureFixtureCacheTable()))return null
  try{
    const result=await pool.query(
      `SELECT payload,updated_at FROM fixture_day_cache
       WHERE fixture_date=$1 AND updated_at > now() - interval '18 hours'
       LIMIT 1`,[date],
    )
    const row=result.rows[0]
    const fixtures=Array.isArray(row?.payload)?row.payload as Fixture[]:[]
    if(!fixtures.length)return null
    const entry={fixtures,updatedAt:new Date(row.updated_at).getTime()}
    fixtureCache.set(date,entry)
    return entry
  }catch{return null}
}

async function writePersistentFixtureCache(date:string,fixtures:Fixture[]){
  if(!fixtures.length||!(await ensureFixtureCacheTable()))return
  try{
    await pool.query(
      `INSERT INTO fixture_day_cache (fixture_date,payload,updated_at)
       VALUES ($1,$2::jsonb,now())
       ON CONFLICT (fixture_date)
       DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,
      [date,JSON.stringify(fixtures)],
    )
  }catch{}
}

function londonYmd(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d)
  const get = (type:string) => parts.find(p=>p.type===type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

function mapEspnStatus(value: string | undefined): MatchStatus {
  const v = String(value ?? "").toLowerCase()
  if (v.includes("in") || v.includes("live")) return "live"
  if (v.includes("half")) return "halftime"
  if (v.includes("final") || v.includes("full")) return "finished"
  if (v.includes("postpon")) return "postponed"
  if (v.includes("pre") || v.includes("sched")) return "scheduled"
  return "unknown"
}

async function espnFixtures(date: string): Promise<Fixture[]> {
  const ymd = date.replaceAll("-", "")
  const requests: Array<Promise<Fixture[]>> = []
  for (const [competition, slugs] of Object.entries(ESPN_LEAGUES) as [Competition, string[]][]) {
    for (const slug of slugs) {
      requests.push((async () => {
        const response = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd}&limit=300`,
          { cache: "no-store", signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
        )
        if (!response.ok) return []
        const data = await response.json()
        const tournament = String(data?.leagues?.[0]?.name ?? data?.leagues?.[0]?.abbreviation ?? competition)
        return (data?.events ?? []).map((event: any): Fixture | null => {
          const contest = event?.competitions?.[0]
          const competitors = contest?.competitors ?? []
          const home = competitors.find((row: any) => row.homeAway === "home")
          const away = competitors.find((row: any) => row.homeAway === "away")
          if (!home?.team || !away?.team) return null
          const statusName = event?.status?.type?.name ?? event?.status?.type?.description ?? ""
          const kickoff = String(event.date ?? contest?.date ?? "")
          const elapsedRaw = String(event?.status?.displayClock ?? event?.status?.type?.detail ?? "")
          const elapsedMatch = elapsedRaw.match(/(\d{1,3})/)
          const elapsed = elapsedMatch ? Number(elapsedMatch[1]) : null
          const homeScoreRaw = Number(home?.score)
          const awayScoreRaw = Number(away?.score)
          if (londonYmd(kickoff) !== date) return null
          return {
            id: `${slug}:${String(event.id)}`,
            competition,
            tournament,
            kickoff,
            status: mapEspnStatus(statusName),
            score: {
              home: Number.isFinite(homeScoreRaw) ? homeScoreRaw : null,
              away: Number.isFinite(awayScoreRaw) ? awayScoreRaw : null,
            },
            elapsed,
            home: {
              id: String(home.team.id ?? ""),
              name: String(home.team.displayName ?? home.team.name ?? ""),
              shortName: home.team.shortDisplayName ?? undefined,
              crest: home.team.logo ?? undefined,
            },
            away: {
              id: String(away.team.id ?? ""),
              name: String(away.team.displayName ?? away.team.name ?? ""),
              shortName: away.team.shortDisplayName ?? undefined,
              crest: away.team.logo ?? undefined,
            },
            venue: contest?.venue?.fullName ?? null,
            referee: null,
            lineupStatus: "expected",
          }
        }).filter((row: Fixture | null): row is Fixture => Boolean(row))
      })())
    }
  }
  const all = await Promise.all(requests)
  return all.flat()
}

async function enrichReferees(fixtures: Fixture[]) {
  return Promise.all(
    fixtures.map(async (f) => {
      if (!f.referee?.name) return f
      const ref = await getRefereeByName(f.referee.name,f.competition)
      if (!ref) return f
      return {
        ...f,
        referee: {
          id: f.referee.id,
          name: f.referee.name,
          yellowsPerGame: ref.yellowsPerGame ? Number(ref.yellowsPerGame) : null,
          foulsPerGame: ref.foulsPerGame ? Number(ref.foulsPerGame) : null,
          matchesRefereed: ref.matchesRefereed ?? null,
        },
      } satisfies Fixture
    }),
  )
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function fixtureKey(f: Fixture) {
  const clean=(value:string)=>value.toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()
  return [f.competition, londonYmd(f.kickoff), clean(f.home.name), clean(f.away.name)].join("|")
}

function stateRank(status:MatchStatus|undefined){
  if(status==="finished")return 5
  if(status==="halftime")return 4
  if(status==="live")return 4
  if(status==="postponed")return 3
  if(status==="scheduled")return 1
  return 0
}

function mergeFixture(existing:Fixture|undefined,incoming:Fixture){
  if(!existing)return incoming
  const richer=stateRank(incoming.status)>=stateRank(existing.status)?incoming:existing
  const incomingScore=(incoming.score?.home!=null||incoming.score?.away!=null)?incoming.score:null
  const existingScore=(existing.score?.home!=null||existing.score?.away!=null)?existing.score:null
  return {
    ...existing,
    ...incoming,
    status:richer.status,
    score:incomingScore??existingScore??richer.score,
    elapsed:incoming.elapsed??existing.elapsed??null,
    home:{...existing.home,...incoming.home,name:incoming.home.name||existing.home.name},
    away:{...existing.away,...incoming.away,name:incoming.away.name||existing.away.name},
    venue:incoming.venue??existing.venue??null,
    referee:incoming.referee??existing.referee??null,
    lineupStatus:incoming.lineupStatus==="confirmed"||existing.lineupStatus!=="confirmed"?incoming.lineupStatus:existing.lineupStatus,
  } satisfies Fixture
}

async function fixturesForDate(date: string) {
  const provider = getProvider()
  let providerFixtures: Fixture[] = []
  let espn: Fixture[] = []

  if (provider.isConfigured()) {
    try {
      providerFixtures = await provider.getFixturesForDate(date)
    } catch (error) {
      console.log("[v0] API-Football fixture fetch failed:", error instanceof Error ? error.message : error)
    }
  }

  try {
    espn = await espnFixtures(date)
  } catch (error) {
    console.log("[v0] ESPN fixture fetch failed:", error instanceof Error ? error.message : error)
  }

  // Merge all live sources, then merge the last-good same-day snapshot.
  // A provider can briefly drop a competition or revert a live row back to scheduled;
  // neither should make a match disappear from the product.
  const merged = new Map<string, Fixture>()
  for (const f of espn) merged.set(fixtureKey(f), mergeFixture(merged.get(fixtureKey(f)),f))
  for (const f of providerFixtures) merged.set(fixtureKey(f), mergeFixture(merged.get(fixtureKey(f)),f))

  const hasFresh=espn.length+providerFixtures.length>0
  let cached=fixtureCache.get(date)??null

  // When live providers answered, do not read Neon just to rebuild the same fixture
  // list. Persistent storage is a disaster-recovery fallback, not the hot path.
  if(!hasFresh&&(!cached||Date.now()-cached.updatedAt>=FIXTURE_CACHE_MS)&&isDatabaseConfigured){
    cached=await readPersistentFixtureCache(date)
  }
  if(cached&&Date.now()-cached.updatedAt<FIXTURE_CACHE_MS){
    for(const f of cached.fixtures){
      const key=fixtureKey(f)
      merged.set(key,mergeFixture(f,merged.get(key)??f))
    }
  }

  const fixtures=[...merged.values()]
  if(fixtures.length){
    const now=Date.now()
    const entry={fixtures,updatedAt:now}
    fixtureCache.set(date,entry)

    // Persist a last-good copy at most twice an hour per warm instance instead of
    // writing on every page refresh / scorecard request.
    if(hasFresh&&isDatabaseConfigured&&now-(fixtureLastPersist.get(date)??0)>=FIXTURE_PERSIST_MS){
      fixtureLastPersist.set(date,now)
      await writePersistentFixtureCache(date,fixtures)
    }
    return fixtures
  }
  if(cached&&Date.now()-cached.updatedAt<FIXTURE_CACHE_MS)return cached.fixtures
  return []
}

function groupFixtures(fixtures: Fixture[]) {
  const leagues: FixturesResponse["leagues"] = { "Premier League": [], Championship: [], "League One": [], "League Two": [], International: [] }
  for (const f of fixtures) {
    const league = f.competition as Competition
    if (leagues[league]) leagues[league].push(f)
  }
  for (const key of Object.keys(leagues) as Competition[]) {
    leagues[key].sort((a, b) => a.kickoff.localeCompare(b.kickoff))
  }
  return leagues
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestedDate = url.searchParams.get("date") ?? londonToday()
  const targetCompetition = url.searchParams.get("competition") as Competition | null
  const nextIfEmpty = url.searchParams.get("nextIfEmpty") === "1"

  const base: FixturesResponse = {
    connected: true,
    updatedAt: new Date().toISOString(),
    date: requestedDate,
    leagues: { "Premier League": [], Championship: [], "League One": [], "League Two": [], International: [] },
  }

  try {
    let resolvedDate = requestedDate
    let fixtures = await fixturesForDate(resolvedDate)
    let leagues = groupFixtures(await enrichReferees(fixtures))

    if (nextIfEmpty && targetCompetition && leagues[targetCompetition]?.length === 0) {
      for (let offset = 1; offset <= 21; offset++) {
        const candidateDate = addDays(requestedDate, offset)
        const candidateFixtures = await fixturesForDate(candidateDate)
        const candidateLeagues = groupFixtures(await enrichReferees(candidateFixtures))
        if (candidateLeagues[targetCompetition]?.length) {
          resolvedDate = candidateDate
          fixtures = candidateFixtures
          leagues = candidateLeagues
          break
        }
      }
    }

    return NextResponse.json({
      ...base,
      date: resolvedDate,
      requestedDate,
      showingNextMatchday: resolvedDate !== requestedDate,
      leagues,
    })
  } catch (error) {
    console.log("[v0] /api/fixtures error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ...base, connected: false, error: "Failed to fetch fixtures from the live data sources." },
      { status: 502 },
    )
  }
}
