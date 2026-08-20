"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Database, RefreshCw, ShieldAlert } from "lucide-react"

type Competition = "Premier League" | "Championship"

type Fixture = {
  id: string
  competition: Competition
  dateIso: string
  day: string
  date: string
  time: string
  home: string
  away: string
}

type RadarCandidate = {
  name: string
  dbName: string
  team: string
  dbTeam: string
  historicalCompetition?: string | null
  position?: string | null
  yellows: number
  cards90: number
  fouls90: number
  appearances: number
  starts: number
  minutes: number
  startLikelihood: number
  sampleLabel: string
  h2hYellows: number
  h2hFouls: number
  score: number
  band: "STRONG" | "GOOD" | "WATCH"
}

type RadarResponse = {
  connected?: boolean
  source?: string
  eventId?: number | null
  competition?: string
  lineupsConfirmed?: boolean
  referee?: {
    name: string
    yellowsPerGame: number | null
    foulsPerGame: number | null
    matches: number | null
    historicalCompetition: string | null
  } | null
  candidates?: RadarCandidate[]
}

type PlayerDetail = {
  connected?: boolean
  baseline?: {
    season?: string | null
    competition?: string | null
    appearances?: number | null
    starts?: number | null
    minutes?: number | null
    yellowCards?: number | null
    redCards?: number | null
    foulsCommitted?: number | null
    foulsDrawn?: number | null
    foulsPer90?: number | null
    cardsPer90?: number | null
  } | null
  h2h?: Array<{
    matchDate: string
    competition?: string | null
    venue?: string | null
    foulsCommitted?: number | null
    foulsDrawn?: number | null
    yellowCard?: boolean | null
    redCard?: boolean | null
  }>
  refereeHistory?: {
    referee?: string
    competition?: string | null
    season?: string | null
    matchesTogether?: number | null
    yellowCards?: number | null
    redCards?: number | null
    foulsCommitted?: number | null
  } | null
}

const premierLeagueFixtures: Fixture[] = [
  { id: "pl-arsenal-coventry", competition: "Premier League", dateIso: "2026-08-21", day: "Friday", date: "21 Aug", time: "20:00", home: "Arsenal", away: "Coventry City" },
  { id: "pl-hull-man-utd", competition: "Premier League", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "12:30", home: "Hull City", away: "Manchester United" },
  { id: "pl-everton-palace", competition: "Premier League", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Everton", away: "Crystal Palace" },
  { id: "pl-ipswich-sunderland", competition: "Premier League", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Ipswich Town", away: "Sunderland" },
  { id: "pl-forest-leeds", competition: "Premier League", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "15:00", home: "Nottingham Forest", away: "Leeds United" },
  { id: "pl-brentford-spurs", competition: "Premier League", dateIso: "2026-08-22", day: "Saturday", date: "22 Aug", time: "17:30", home: "Brentford", away: "Tottenham Hotspur" },
  { id: "pl-brighton-villa", competition: "Premier League", dateIso: "2026-08-23", day: "Sunday", date: "23 Aug", time: "14:00", home: "Brighton & Hove Albion", away: "Aston Villa" },
  { id: "pl-city-bournemouth", competition: "Premier League", dateIso: "2026-08-23", day: "Sunday", date: "23 Aug", time: "14:00", home: "Manchester City", away: "AFC Bournemouth" },
  { id: "pl-newcastle-liverpool", competition: "Premier League", dateIso: "2026-08-23", day: "Sunday", date: "23 Aug", time: "16:30", home: "Newcastle United", away: "Liverpool" },
  { id: "pl-fulham-chelsea", competition: "Premier League", dateIso: "2026-08-24", day: "Monday", date: "24 Aug", time: "20:00", home: "Fulham", away: "Chelsea" },
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

const fixturesByCompetition: Record<Competition, Fixture[]> = {
  "Premier League": premierLeagueFixtures,
  Championship: championshipFixtures,
}

const clubDomains: Record<string, string> = {
  Arsenal: "arsenal.com", "Coventry City": "ccfc.co.uk", "Hull City": "wearehullcity.co.uk", "Manchester United": "manutd.com",
  Everton: "evertonfc.com", "Crystal Palace": "cpfc.co.uk", "Ipswich Town": "itfc.co.uk", Sunderland: "safc.com",
  "Nottingham Forest": "nottinghamforest.co.uk", "Leeds United": "leedsunited.com", Brentford: "brentfordfc.com", "Tottenham Hotspur": "tottenhamhotspur.com",
  "Brighton & Hove Albion": "brightonandhovealbion.com", "Aston Villa": "avfc.co.uk", "Manchester City": "mancity.com", "AFC Bournemouth": "afcb.co.uk",
  "Newcastle United": "newcastleunited.com", Liverpool: "liverpoolfc.com", Fulham: "fulhamfc.com", Chelsea: "chelseafc.com",
  "Birmingham City": "bcfc.com", "Bristol City": "bcfc.co.uk", "Lincoln City": "weareimps.com", Portsmouth: "portsmouthfc.co.uk",
  Millwall: "millwallfc.co.uk", "Norwich City": "canaries.co.uk", "Blackburn Rovers": "rovers.co.uk", Middlesbrough: "mfc.co.uk",
  "Derby County": "dcfc.co.uk", "Cardiff City": "cardiffcityfc.co.uk", "Preston North End": "pnefc.net", "Wolverhampton Wanderers": "wolves.co.uk",
  "Queens Park Rangers": "qpr.co.uk", "Bolton Wanderers": "bwfc.co.uk", Southampton: "southamptonfc.com", "Stoke City": "stokecityfc.com",
  "Swansea City": "swanseacity.com", "Sheffield United": "sufc.co.uk", "West Ham United": "whufc.com", "Charlton Athletic": "cafc.co.uk",
  Wrexham: "wrexhamafc.co.uk", Watford: "watfordfc.com", "West Bromwich Albion": "wba.co.uk", Burnley: "burnleyfootballclub.com",
}

function fixtureQuery(fixture: Fixture) {
  const p = new URLSearchParams({
    date: fixture.dateIso,
    home: fixture.home,
    away: fixture.away,
    competition: fixture.competition,
  })
  return `/api/fixture-radar?${p.toString()}`
}

function opponentFor(fixture: Fixture, candidate: RadarCandidate) {
  return candidate.team === fixture.home ? fixture.away : fixture.home
}

function bandClass(band: RadarCandidate["band"]) {
  if (band === "STRONG") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (band === "GOOD") return "border-amber-200 bg-amber-50 text-amber-800"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

function sampleClass(label: string) {
  if (label === "Confirmed starter" || label === "Likely starter") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (label === "Limited sample" || label === "Rotation risk") return "border-rose-200 bg-rose-50 text-rose-800"
  return "border-amber-200 bg-amber-50 text-amber-800"
}

function TeamLogo({ team }: { team: string }) {
  const domain = clubDomains[team]
  const initials = team
    .replace("AFC ", "")
    .replace(" & Hove Albion", "")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-white text-[0.65rem] font-black text-slate-700 shadow-sm">
      <span>{initials}</span>
      {domain ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
          alt=""
          className="absolute inset-1 size-8 object-contain"
          onError={(event) => { event.currentTarget.style.display = "none" }}
        />
      ) : null}
    </span>
  )
}

function LineupStatusPill({ confirmed, loading = false }: { confirmed?: boolean; loading?: boolean }) {
  if (loading) {
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-muted-foreground"><RefreshCw className="size-3 animate-spin" />Checking lineups</span>
  }
  return confirmed ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-emerald-800"><span className="size-1.5 rounded-full bg-emerald-500" />Lineups confirmed</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-red-800"><span className="size-1.5 rounded-full bg-red-500" />Lineups not confirmed</span>
  )
}

function YellowMetric({ yellows }: { yellows: number }) {
  return (
    <div className="flex min-w-[104px] items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-2.5 py-2 text-slate-950">
      <span className="block h-5 w-3.5 shrink-0 rounded-[2px] bg-yellow-400 shadow-sm" />
      <div>
        <p className="font-mono text-base font-black leading-none text-slate-950">{yellows}</p>
        <p className="mt-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-slate-700">2025/26 yellows</p>
      </div>
    </div>
  )
}

function VenueBadge({ venue }: { venue?: string | null }) {
  if (!venue) return null
  return <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-muted-foreground">{venue.toLowerCase() === "home" ? "Home" : "Away"}</span>
}

function Stat({ label, value, decimals = false, yellow = false }: { label: string; value: number | null | undefined; decimals?: boolean; yellow?: boolean }) {
  const display = value == null ? "—" : decimals ? Number(value).toFixed(2) : Math.round(Number(value)).toString()
  return (
    <div className={`rounded-xl px-2 py-2 text-center ${yellow ? "border border-yellow-300 bg-yellow-50 text-slate-950" : "bg-card"}`}>
      <p className={`font-mono text-base font-bold ${yellow ? "text-slate-950" : ""}`}>{display}</p>
      <p className={`mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${yellow ? "text-slate-700" : "text-muted-foreground"}`}>{label}</p>
    </div>
  )
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

export default function HomePage() {
  const [competition, setCompetition] = useState<Competition>("Premier League")
  const [openFixture, setOpenFixture] = useState<string | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [radar, setRadar] = useState<Record<string, RadarResponse>>({})
  const [radarLoading, setRadarLoading] = useState<Record<string, boolean>>({})
  const [details, setDetails] = useState<Record<string, PlayerDetail>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)

  const fixtures = useMemo(() => fixturesByCompetition[competition], [competition])

  const refreshCompetition = useCallback(async (target: Competition) => {
    const targetFixtures = fixturesByCompetition[target]
    setRadarLoading((current) => ({ ...current, ...Object.fromEntries(targetFixtures.map((fixture) => [fixture.id, true])) }))
    await Promise.all(targetFixtures.map(async (fixture) => {
      try {
        const response = await fetch(fixtureQuery(fixture), { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json() as RadarResponse
        setRadar((current) => ({ ...current, [fixture.id]: data }))
      } catch {
        // Keep the last good radar snapshot if a live-source request briefly fails.
      } finally {
        setRadarLoading((current) => ({ ...current, [fixture.id]: false }))
      }
    }))
  }, [])

  useEffect(() => {
    void refreshCompetition(competition)
    const timer = window.setInterval(() => void refreshCompetition(competition), 60_000)
    return () => window.clearInterval(timer)
  }, [competition, refreshCompetition])

  function switchCompetition(next: Competition) {
    setCompetition(next)
    setOpenFixture(null)
    setSelectedPlayer(null)
  }

  function toggleFixture(id: string) {
    setOpenFixture((current) => current === id ? null : id)
    setSelectedPlayer(null)
  }

  async function togglePlayer(fixture: Fixture, candidate: RadarCandidate, index: number) {
    const key = `${fixture.id}-${candidate.dbName}-${index}`
    if (selectedPlayer === key) {
      setSelectedPlayer(null)
      return
    }
    setSelectedPlayer(key)
    if (details[key]) return
    const currentRadar = radar[fixture.id]
    const params = new URLSearchParams({
      name: candidate.dbName,
      team: candidate.dbTeam,
      opponent: opponentFor(fixture, candidate),
    })
    if (currentRadar?.referee?.name) params.set("referee", currentRadar.referee.name)
    setDetailLoading(key)
    try {
      const response = await fetch(`/api/player?${params.toString()}`, { cache: "no-store" })
      if (response.ok) {
        const data = await response.json() as PlayerDetail
        setDetails((current) => ({ ...current, [key]: data }))
      }
    } finally {
      setDetailLoading(null)
    }
  }

  return (
    <main className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground shadow-sm">
        <div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Football Cards</h1>
              <p className="mt-0.5 text-sm text-navy-foreground/70">{competition} card radar · 2026/27</p>
            </div>
            <a href="/admin/import" className="rounded-full bg-navy-foreground/10 px-3 py-1.5 text-xs font-semibold hover:bg-navy-foreground/20">Import</a>
          </div>
          <div className="mt-3 grid grid-cols-2 rounded-xl bg-navy-foreground/10 p-1">
            {(["Premier League", "Championship"] as Competition[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchCompetition(item)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition ${competition === item ? "bg-white text-slate-950 shadow-sm" : "text-navy-foreground/75 hover:text-navy-foreground"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary"><Database className="size-5" /></div>
            <div>
              <p className="font-bold">{competition} fixtures</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Pre-lineup rankings use historical card/foul evidence, H2H, sample size and previous starting frequency. The app checks SofaScore every minute; once both official XIs appear, the fixture turns green and the ranking switches to confirmed starters only.</p>
            </div>
          </div>
        </section>

        {fixtures.map((fixture) => {
          const open = openFixture === fixture.id
          const fixtureRadar = radar[fixture.id]
          const loading = radarLoading[fixture.id] && !fixtureRadar
          const candidates = fixtureRadar?.candidates ?? []
          return (
            <section key={fixture.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <button type="button" onClick={() => toggleFixture(fixture.id)} className="w-full p-4 text-left transition-colors hover:bg-secondary/30" aria-expanded={open}>
                <div className="flex items-center gap-3">
                  <TeamLogo team={fixture.home} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{fixture.day} · {fixture.date} · {fixture.time}</p>
                    <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm font-bold sm:text-base">{fixture.home}</p><span className="text-xs text-muted-foreground">v</span><p className="truncate text-sm font-bold sm:text-base">{fixture.away}</p></div>
                    <p className="mt-1 text-xs font-semibold text-yellow-500">{open ? "Hide yellow card potentials" : "View yellow card potentials"}</p>
                    <div className="mt-2"><LineupStatusPill confirmed={fixtureRadar?.lineupsConfirmed} loading={loading} /></div>
                  </div>
                  <TeamLogo team={fixture.away} />
                  {open ? <ChevronUp className="size-5 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-5 shrink-0 text-muted-foreground" />}
                </div>
              </button>

              {open ? (
                <div className="border-t border-border bg-secondary/20 p-3">
                  <div className="mb-3 flex items-start justify-between gap-2 px-1">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top 5 yellow card candidates</p>
                      <p className="mt-0.5 text-[0.67rem] font-semibold text-muted-foreground">{fixtureRadar?.lineupsConfirmed ? "Confirmed XI · starters only" : "Pre-lineup · start-risk and sample adjusted"}</p>
                    </div>
                    <button type="button" onClick={() => void refreshCompetition(competition)} className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground" aria-label="Refresh fixture data"><RefreshCw className={`size-4 ${radarLoading[fixture.id] ? "animate-spin" : ""}`} /></button>
                  </div>

                  {fixtureRadar?.referee ? (
                    <div className="mb-3 rounded-xl border border-border bg-card px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">Referee · {fixtureRadar.referee.name}</p>{fixtureRadar.referee.yellowsPerGame != null ? <span className="rounded-full bg-secondary px-2 py-1 text-[0.65rem] font-bold">{fixtureRadar.referee.yellowsPerGame.toFixed(2)} yellows/game</span> : null}</div>
                    </div>
                  ) : null}

                  {loading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />Building the fixture radar…</div>
                  ) : candidates.length ? (
                    <div className="space-y-2">
                      {candidates.slice(0, 5).map((candidate, index) => {
                        const key = `${fixture.id}-${candidate.dbName}-${index}`
                        const playerOpen = selectedPlayer === key
                        const detail = details[key]
                        const transferred = candidate.team !== candidate.dbTeam
                        return (
                          <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
                            <button type="button" onClick={() => void togglePlayer(fixture, candidate, index)} className="w-full p-3 text-left transition-colors hover:bg-secondary/40">
                              <div className="flex items-start gap-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold">{index + 1}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{candidate.name}</p><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${bandClass(candidate.band)}`}>{candidate.band}</span><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${sampleClass(candidate.sampleLabel)}`}>{candidate.sampleLabel}</span></div>
                                  <p className="mt-0.5 text-xs text-muted-foreground">{candidate.team}{transferred ? ` · 2025/26 data from ${candidate.dbTeam}` : ""}{candidate.historicalCompetition && candidate.historicalCompetition !== competition ? ` · ${candidate.historicalCompetition}` : ""}</p>
                                  <div className="mt-2 flex flex-wrap items-stretch gap-2">
                                    <YellowMetric yellows={candidate.yellows} />
                                    <div className="rounded-xl bg-secondary px-2.5 py-2"><p className="font-mono text-sm font-bold">{candidate.cards90.toFixed(2)}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">cards/90</p></div>
                                    <div className="rounded-xl bg-secondary px-2.5 py-2"><p className="font-mono text-sm font-bold">{candidate.fouls90.toFixed(2)}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">fouls/90</p></div>
                                    <div className="rounded-xl bg-secondary px-2.5 py-2"><p className="font-mono text-sm font-bold">{candidate.score.toFixed(0)}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">evidence score</p></div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {candidate.h2hFouls > 0 ? <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium">{candidate.h2hFouls} H2H fouls</span> : null}
                                    {candidate.h2hYellows > 0 ? <span className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs font-semibold text-slate-950"><span className="h-3.5 w-2.5 rounded-[1px] bg-yellow-400" />{candidate.h2hYellows} H2H {candidate.h2hYellows === 1 ? "booking" : "bookings"}</span> : null}
                                  </div>
                                </div>
                                {playerOpen ? <ChevronUp className="mt-1 size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />}
                              </div>
                            </button>

                            {playerOpen ? (
                              <div className="border-t border-border bg-secondary/30 p-3">
                                {detailLoading === key ? (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />Loading player evidence…</div>
                                ) : detail?.connected ? (
                                  <div className="space-y-3">
                                    {detail.baseline ? (
                                      <div className="grid grid-cols-3 gap-2"><Stat label="Apps" value={detail.baseline.appearances} /><Stat label="Starts" value={detail.baseline.starts} /><Stat label="Yellows" value={detail.baseline.yellowCards} yellow /><Stat label="Cards/90" value={detail.baseline.cardsPer90} decimals /><Stat label="Fouls/90" value={detail.baseline.foulsPer90} decimals /><Stat label="Minutes" value={detail.baseline.minutes} /></div>
                                    ) : null}

                                    {detail.refereeHistory ? (
                                      <div className="rounded-xl bg-card p-3"><p className="text-xs font-bold">Under {detail.refereeHistory.referee}</p><p className="mt-1 text-xs text-muted-foreground">{detail.refereeHistory.matchesTogether ?? 0} matches · {detail.refereeHistory.yellowCards ?? 0} yellows · {detail.refereeHistory.foulsCommitted ?? 0} fouls</p></div>
                                    ) : null}

                                    {detail.h2h?.length ? (
                                      <div>
                                        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Previous meetings vs {opponentFor(fixture, candidate)}</p>
                                        <div className="space-y-1.5">
                                          {detail.h2h.slice(0, 8).map((match, matchIndex) => {
                                            const booked = match.yellowCard === true
                                            const sentOff = match.redCard === true
                                            return (
                                              <div key={`${match.matchDate}-${matchIndex}`} className="rounded-lg bg-card px-3 py-2 text-xs">
                                                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="font-medium">{formatDate(match.matchDate)}</span><VenueBadge venue={match.venue} /></div><span className={`inline-flex items-center gap-1.5 font-semibold ${sentOff ? "text-red-600" : booked ? "text-amber-600" : "text-muted-foreground"}`}>{sentOff ? "🟥 Sent off" : booked ? <><span className="h-4 w-3 rounded-[2px] bg-yellow-400" />Booked</> : match.yellowCard === false ? "No card" : "Card data missing"}</span></div>
                                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>{match.foulsCommitted ?? "—"} fouls committed</span><span>{match.foulsDrawn ?? "—"} fouls drawn</span>{match.competition ? <span>{match.competition}</span> : null}</div>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ) : <p className="text-xs text-muted-foreground">No imported player H2H rows for this opponent.</p>}
                                  </div>
                                ) : (
                                  <div className="flex gap-2 text-sm text-muted-foreground"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Detailed historical evidence was not returned for this player.</div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-card p-4"><p className="text-sm font-bold">No ranked players available yet</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">The fixture is live in the app, but the current squad could not yet be matched to enough 2025/26 historical rows. Championship coverage will fill automatically as the new database sync completes; promoted-club players with no PL/Championship history stay unranked rather than being given invented zeros.</p></div>
                  )}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </main>
  )
}
