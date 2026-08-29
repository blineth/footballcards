"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Database, RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship"
type Fixture = { id: string; competition: Competition; dateIso: string; day: string; date: string; time: string; home: string; away: string }
type H2HMatch = { matchDate: string; opponent?: string | null; competition?: string | null; venue?: string | null; minutes?: number | null; foulsCommitted?: number | null; foulsDrawn?: number | null; yellowCard?: boolean | null; redCard?: boolean | null }
type CurrentSeason = { season?: string; games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; cards90?: number | null; evidenceWeight?: number }
type RadarCandidate = { name: string; dbName: string; team: string; dbTeam: string; historicalCompetition?: string | null; position?: string | null; yellows: number; cards90: number; fouls90: number; appearances: number; starts: number; minutes: number; startLikelihood: number; sampleLabel: string; h2hYellows: number; h2hFouls: number; h2hMatches?: H2HMatch[]; currentSeason?: CurrentSeason; score: number; band: "STRONG" | "GOOD" | "WATCH" }
type RadarResponse = { connected?: boolean; lineupsConfirmed?: boolean; referee?: { name: string; yellowsPerGame: number | null; foulsPerGame: number | null; matches: number | null } | null; candidates?: RadarCandidate[] }

const premierLeagueFixtures: Fixture[] = [
  { id: "pl-palace-city", competition: "Premier League", dateIso: "2026-08-28", day: "Friday", date: "28 Aug", time: "20:00", home: "Crystal Palace", away: "Manchester City" },
  { id: "pl-liverpool-forest", competition: "Premier League", dateIso: "2026-08-29", day: "Saturday", date: "29 Aug", time: "12:30", home: "Liverpool", away: "Nottingham Forest" },
  { id: "pl-bournemouth-everton", competition: "Premier League", dateIso: "2026-08-29", day: "Saturday", date: "29 Aug", time: "15:00", home: "AFC Bournemouth", away: "Everton" },
  { id: "pl-coventry-hull", competition: "Premier League", dateIso: "2026-08-29", day: "Saturday", date: "29 Aug", time: "15:00", home: "Coventry City", away: "Hull City" },
  { id: "pl-spurs-newcastle", competition: "Premier League", dateIso: "2026-08-29", day: "Saturday", date: "29 Aug", time: "17:30", home: "Tottenham Hotspur", away: "Newcastle United" },
  { id: "pl-chelsea-brighton", competition: "Premier League", dateIso: "2026-08-30", day: "Sunday", date: "30 Aug", time: "14:00", home: "Chelsea", away: "Brighton & Hove Albion" },
  { id: "pl-leeds-brentford", competition: "Premier League", dateIso: "2026-08-30", day: "Sunday", date: "30 Aug", time: "14:00", home: "Leeds United", away: "Brentford" },
  { id: "pl-sunderland-fulham", competition: "Premier League", dateIso: "2026-08-30", day: "Sunday", date: "30 Aug", time: "14:00", home: "Sunderland", away: "Fulham" },
  { id: "pl-man-utd-ipswich", competition: "Premier League", dateIso: "2026-08-30", day: "Sunday", date: "30 Aug", time: "16:30", home: "Manchester United", away: "Ipswich Town" },
  { id: "pl-villa-arsenal", competition: "Premier League", dateIso: "2026-08-31", day: "Monday", date: "31 Aug", time: "20:00", home: "Aston Villa", away: "Arsenal" },
]

const championshipFixtures: Fixture[] = [
  { id: "ch-birmingham-bristol-city", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "12:30", home: "Birmingham City", away: "Bristol City" },
  { id: "ch-lincoln-portsmouth", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "12:30", home: "Lincoln City", away: "Portsmouth" },
  { id: "ch-millwall-norwich", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "12:30", home: "Millwall", away: "Norwich City" },
  { id: "ch-blackburn-boro", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Blackburn Rovers", away: "Middlesbrough" },
  { id: "ch-derby-cardiff", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Derby County", away: "Cardiff City" },
  { id: "ch-preston-wolves", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Preston North End", away: "Wolverhampton Wanderers" },
  { id: "ch-qpr-bolton", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Queens Park Rangers", away: "Bolton Wanderers" },
  { id: "ch-southampton-stoke", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Southampton", away: "Stoke City" },
  { id: "ch-swansea-sheff-utd", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Swansea City", away: "Sheffield United" },
  { id: "ch-west-ham-charlton", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "West Ham United", away: "Charlton Athletic" },
  { id: "ch-wrexham-watford", competition: "Championship", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Wrexham", away: "Watford" },
  { id: "ch-west-brom-burnley", competition: "Championship", dateIso: "2026-08-23", day: "Sunday", date: "23 Aug", time: "12:00", home: "West Bromwich Albion", away: "Burnley" },
]

const fixturesByCompetition: Record<Competition, Fixture[]> = { "Premier League": premierLeagueFixtures, Championship: championshipFixtures }

function fixtureQuery(fixture: Fixture) {
  const params = new URLSearchParams({ date: fixture.dateIso, home: fixture.home, away: fixture.away, competition: fixture.competition })
  return `/api/fixture-radar?${params.toString()}`
}

function opponentFor(fixture: Fixture, candidate: RadarCandidate) { return candidate.team === fixture.home ? fixture.away : fixture.home }
function formatDate(value: string) { const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date) }
function minutesLabel(minutes: number | null | undefined) { if (minutes == null) return "Minutes unknown"; if (minutes === 0) return "Did not play"; return `${minutes} min played` }
function bandClass(band: RadarCandidate["band"]) { return band === "STRONG" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : band === "GOOD" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700" }

export default function HomePage() {
  const [competition, setCompetition] = useState<Competition>("Premier League")
  const [openFixture, setOpenFixture] = useState<string | null>(null)
  const [radar, setRadar] = useState<Record<string, RadarResponse>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const fixtures = useMemo(() => fixturesByCompetition[competition], [competition])

  const refreshCompetition = useCallback(async (target: Competition) => {
    const targetFixtures = fixturesByCompetition[target]
    setLoading((current) => ({ ...current, ...Object.fromEntries(targetFixtures.map((fixture) => [fixture.id, true])) }))
    await Promise.all(targetFixtures.map(async (fixture) => {
      try {
        const response = await fetch(fixtureQuery(fixture), { cache: "no-store" })
        if (response.ok) setRadar((current) => ({ ...current, [fixture.id]: response.json ? undefined as never : current[fixture.id] }))
        if (response.ok) {
          const data = await response.json() as RadarResponse
          setRadar((current) => ({ ...current, [fixture.id]: data }))
        }
      } catch {} finally { setLoading((current) => ({ ...current, [fixture.id]: false })) }
    }))
  }, [])

  useEffect(() => { void refreshCompetition(competition); const timer = window.setInterval(() => void refreshCompetition(competition), 60_000); return () => window.clearInterval(timer) }, [competition, refreshCompetition])

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground shadow-sm">
        <div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-bold">Football Cards</h1><p className="mt-0.5 text-sm text-navy-foreground/70">{competition} card radar · 2026/27</p></div><a href="/admin/import" className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">Import</a></div>
          <div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">{(["Premier League", "Championship"] as Competition[]).map((item) => <button key={item} type="button" onClick={() => { setCompetition(item); setOpenFixture(null) }} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition === item ? "bg-white text-slate-950" : "text-white/75"}`}>{item}</button>)}</div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="flex gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary"><Database className="size-5" /></div><div><p className="font-bold">Fixture radar</p><p className="mt-1 text-sm text-muted-foreground">Top 10 candidates are balanced five per team where possible. H2H bookings are ranked first, then H2H fouls, then the wider card profile. Previous meetings now always show how many minutes the player actually played.</p></div></div></section>

        {fixtures.map((fixture) => {
          const data = radar[fixture.id]
          const open = openFixture === fixture.id
          const candidates = data?.candidates ?? []
          return (
            <section key={fixture.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <button type="button" onClick={() => setOpenFixture((current) => current === fixture.id ? null : fixture.id)} className="w-full p-4 text-left">
                <div className="flex items-center justify-between gap-3"><div><p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{fixture.day} · {fixture.date} · {fixture.time}</p><p className="mt-1 font-bold">{fixture.home} v {fixture.away}</p><p className="mt-1 text-xs font-semibold text-yellow-500">{open ? "Hide yellow card potentials" : "View yellow card potentials"}</p></div>{open ? <ChevronUp className="size-5 text-muted-foreground" /> : <ChevronDown className="size-5 text-muted-foreground" />}</div>
              </button>

              {open ? <div className="border-t border-border bg-secondary/20 p-3">
                <div className="mb-3 flex items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top 10 yellow card candidates · 5 per team</p><p className="mt-0.5 text-[0.67rem] text-muted-foreground">{data?.lineupsConfirmed ? "Confirmed XI" : "Pre-lineup"} · H2H evidence prioritised</p></div><button type="button" onClick={() => void refreshCompetition(competition)} className="rounded-lg border border-border bg-card p-2"><RefreshCw className={`size-4 ${loading[fixture.id] ? "animate-spin" : ""}`} /></button></div>
                {data?.referee ? <div className="mb-3 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold">Referee · {data.referee.name}{data.referee.yellowsPerGame != null ? ` · ${data.referee.yellowsPerGame.toFixed(2)} yellows/game` : ""}</div> : null}
                <div className="space-y-2">{candidates.slice(0, 10).map((candidate, index) => <div key={`${fixture.id}-${candidate.dbName}`} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold">{index + 1}</span><div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{candidate.name}</p><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${bandClass(candidate.band)}`}>{candidate.band}</span></div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{candidate.team} · {candidate.sampleLabel}</p>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-center"><div className="rounded-lg border border-yellow-300 bg-yellow-50 p-2"><p className="font-mono font-bold text-slate-900">{candidate.yellows}</p><p className="text-[0.55rem] font-semibold uppercase text-slate-700">25/26 YC</p></div><div className="rounded-lg bg-secondary p-2"><p className="font-mono font-bold">{candidate.cards90.toFixed(2)}</p><p className="text-[0.55rem] uppercase text-muted-foreground">cards/90</p></div><div className="rounded-lg bg-secondary p-2"><p className="font-mono font-bold">{candidate.fouls90.toFixed(2)}</p><p className="text-[0.55rem] uppercase text-muted-foreground">fouls/90</p></div><div className="rounded-lg bg-secondary p-2"><p className="font-mono font-bold">{candidate.score.toFixed(0)}</p><p className="text-[0.55rem] uppercase text-muted-foreground">score</p></div></div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{candidate.h2hYellows > 0 ? <span className="rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1 font-semibold text-slate-900">{candidate.h2hYellows} H2H booking{candidate.h2hYellows === 1 ? "" : "s"}</span> : null}{candidate.h2hFouls > 0 ? <span className="rounded-lg bg-secondary px-2 py-1">{candidate.h2hFouls} H2H fouls</span> : null}{candidate.currentSeason?.games ? <span className="rounded-lg bg-secondary px-2 py-1">26/27: {candidate.currentSeason.yellows ?? 0} YC · {candidate.currentSeason.fouls ?? 0} fouls</span> : null}</div>
                    {candidate.h2hMatches?.length ? <div className="mt-2 rounded-xl border border-border bg-secondary/40 p-2"><p className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-wide text-muted-foreground">H2H match evidence vs {opponentFor(fixture, candidate)}</p><div className="space-y-1">{candidate.h2hMatches.map((match, matchIndex) => <div key={`${match.matchDate}-${matchIndex}`} className="rounded-lg bg-card px-2.5 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{formatDate(match.matchDate)} · {minutesLabel(match.minutes)}</span><span className="text-muted-foreground">{match.foulsCommitted ?? 0} fouls{match.yellowCard === true ? " · booked" : ""}{match.redCard === true ? " · sent off" : ""}</span></div></div>)}</div></div> : null}
                  </div></div>
                </div>)}</div>
              </div> : null}
            </section>
          )
        })}
      </div>
    </main>
  )
}
