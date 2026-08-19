"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, Database, RefreshCw, ShieldAlert } from "lucide-react"

type Candidate = {
  name: string
  dbName: string
  team: string
  currentTeamDb: string
  dbTeam: string
  yellows: number
  cards90: number
  fouls90: number
}

type Fixture = {
  id: string
  day: string
  date: string
  time: string
  home: string
  away: string
  homeDb: string
  awayDb: string
  candidates: Candidate[]
  noLeagueH2HReason?: string
}

type PlayerDetail = {
  connected?: boolean
  baseline?: {
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
}

const fixtures: Fixture[] = [
  {
    id: "arsenal-coventry", day: "Friday", date: "21 Aug", time: "20:00",
    home: "Arsenal", away: "Coventry City", homeDb: "Arsenal", awayDb: "Coventry",
    noLeagueH2HReason: "No 2025/26 Premier League H2H because Coventry were not in the Premier League.",
    candidates: [
      { name: "Gabriel Jesus", dbName: "Gabriel Fernando de Jesus", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 3, cards90: 0.65, fouls90: 1.94 },
      { name: "Cristhian Mosquera", dbName: "Cristhian Mosquera", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 4, cards90: 0.37, fouls90: 1.55 },
      { name: "Myles Lewis-Skelly", dbName: "Myles Lewis-Skelly", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 3, cards90: 0.39, fouls90: 1.29 },
      { name: "Bruno Guimarães", dbName: "Bruno Guimarães Rodriguez Moura", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Newcastle", yellows: 6, cards90: 0.22, fouls90: 1.65 },
      { name: "Riccardo Calafiori", dbName: "Riccardo Calafiori", team: "Arsenal", currentTeamDb: "Arsenal", dbTeam: "Arsenal", yellows: 5, cards90: 0.27, fouls90: 1.38 }
    ]
  },
  {
    id: "hull-man-utd", day: "Saturday", date: "22 Aug", time: "12:30",
    home: "Hull City", away: "Manchester United", homeDb: "Hull", awayDb: "Man Utd",
    noLeagueH2HReason: "No 2025/26 Premier League H2H because Hull were not in the Premier League.",
    candidates: [
      { name: "Luke Shaw", dbName: "Luke Shaw", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 9, cards90: 0.25, fouls90: 1.34 },
      { name: "Joshua Zirkzee", dbName: "Joshua Zirkzee", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 3, cards90: 0.44, fouls90: 1.19 },
      { name: "Patrick Dorgu", dbName: "Patrick Dorgu", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 5, cards90: 0.31, fouls90: 1.44 },
      { name: "Andrey Santos", dbName: "Andrey Nascimento dos Santos", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Chelsea", yellows: 4, cards90: 0.29, fouls90: 0.94 },
      { name: "Noussair Mazraoui", dbName: "Noussair Mazraoui", team: "Manchester United", currentTeamDb: "Man Utd", dbTeam: "Man Utd", yellows: 3, cards90: 0.28, fouls90: 1.11 }
    ]
  },
  {
    id: "everton-palace", day: "Saturday", date: "22 Aug", time: "15:00",
    home: "Everton", away: "Crystal Palace", homeDb: "Everton", awayDb: "Crystal Palace",
    candidates: [
      { name: "James Garner", dbName: "James Garner", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 12, cards90: 0.32, fouls90: 1.03 },
      { name: "Tim Iroegbunam", dbName: "Tim Iroegbunam", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 9, cards90: 0.55, fouls90: 1.77 },
      { name: "Tyler Dibling", dbName: "Tyler Dibling", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 2, cards90: 0.52, fouls90: 2.84 },
      { name: "Daniel Muñoz", dbName: "Daniel Muñoz Mejía", team: "Crystal Palace", currentTeamDb: "Crystal Palace", dbTeam: "Crystal Palace", yellows: 7, cards90: 0.26, fouls90: 1.27 },
      { name: "Tyrique George", dbName: "Tyrique George", team: "Everton", currentTeamDb: "Everton", dbTeam: "Everton", yellows: 2, cards90: 0.51, fouls90: 2.31 }
    ]
  },
  {
    id: "ipswich-sunderland", day: "Saturday", date: "22 Aug", time: "15:00",
    home: "Ipswich Town", away: "Sunderland", homeDb: "Ipswich", awayDb: "Sunderland",
    noLeagueH2HReason: "No 2025/26 Premier League Ipswich v Sunderland H2H because Ipswich were not in the Premier League. Individual players can still show opponent history from previous clubs.",
    candidates: [
      { name: "Saša Lukić", dbName: "Saša Lukić", team: "Ipswich Town", currentTeamDb: "Ipswich", dbTeam: "Fulham", yellows: 9, cards90: 0.47, fouls90: 2.76 },
      { name: "Reinildo", dbName: "Reinildo Mandava", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 7, cards90: 0.32, fouls90: 1.46 },
      { name: "Habib Diarra", dbName: "Habib Diarra", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 6, cards90: 0.38, fouls90: 1.28 },
      { name: "Florentino", dbName: "Florentino Ibrain Morris Luís", team: "Ipswich Town", currentTeamDb: "Ipswich", dbTeam: "Burnley", yellows: 6, cards90: 0.26, fouls90: 1.71 },
      { name: "Noah Sadiki", dbName: "Noah Sadiki", team: "Sunderland", currentTeamDb: "Sunderland", dbTeam: "Sunderland", yellows: 9, cards90: 0.28, fouls90: 1.0 }
    ]
  },
  {
    id: "forest-leeds", day: "Saturday", date: "22 Aug", time: "15:00",
    home: "Nottingham Forest", away: "Leeds United", homeDb: "Nott'm Forest", awayDb: "Leeds",
    candidates: [
      { name: "Ibrahim Sangaré", dbName: "Ibrahim Sangaré", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 5, cards90: 0.22, fouls90: 1.82 },
      { name: "Ethan Ampadu", dbName: "Ethan Ampadu", team: "Leeds United", currentTeamDb: "Leeds", dbTeam: "Leeds", yellows: 10, cards90: 0.29, fouls90: 1.44 },
      { name: "Ryan Yates", dbName: "Ryan Yates", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 3, cards90: 0.45, fouls90: 1.94 },
      { name: "Murillo", dbName: "Murillo Costa dos Santos", team: "Nottingham Forest", currentTeamDb: "Nott'm Forest", dbTeam: "Nott'm Forest", yellows: 5, cards90: 0.21, fouls90: 0.97 },
      { name: "Wilfried Gnonto", dbName: "Wilfried Gnonto", team: "Leeds United", currentTeamDb: "Leeds", dbTeam: "Leeds", yellows: 3, cards90: 0.52, fouls90: 1.21 }
    ]
  },
  {
    id: "brentford-spurs", day: "Saturday", date: "22 Aug", time: "17:30",
    home: "Brentford", away: "Tottenham Hotspur", homeDb: "Brentford", awayDb: "Spurs",
    candidates: [
      { name: "Vitaly Janelt", dbName: "Vitaly Janelt", team: "Brentford", currentTeamDb: "Brentford", dbTeam: "Brentford", yellows: 8, cards90: 0.50, fouls90: 1.26 },
      { name: "Kevin Danso", dbName: "Kevin Danso", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Spurs", yellows: 8, cards90: 0.48, fouls90: 1.27 },
      { name: "Pedro Porro", dbName: "Pedro Porro Sauceda", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Spurs", yellows: 10, cards90: 0.32, fouls90: 1.03 },
      { name: "Yehor Yarmoliuk", dbName: "Yehor Yarmoliuk", team: "Brentford", currentTeamDb: "Brentford", dbTeam: "Brentford", yellows: 7, cards90: 0.24, fouls90: 1.26 },
      { name: "Marcos Senesi", dbName: "Marcos Senesi Barón", team: "Tottenham Hotspur", currentTeamDb: "Spurs", dbTeam: "Bournemouth", yellows: 8, cards90: 0.22, fouls90: 0.93 }
    ]
  },
  {
    id: "brighton-villa", day: "Sunday", date: "23 Aug", time: "14:00",
    home: "Brighton & Hove Albion", away: "Aston Villa", homeDb: "Brighton", awayDb: "Aston Villa",
    candidates: [
      { name: "Diego Gómez", dbName: "Diego Gómez Amarilla", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 9, cards90: 0.38, fouls90: 2.04 },
      { name: "João Gomes", dbName: "João Victor Gomes da Silva", team: "Aston Villa", currentTeamDb: "Aston Villa", dbTeam: "Wolves", yellows: 10, cards90: 0.32, fouls90: 2.20 },
      { name: "Mats Wieffer", dbName: "Mats Wieffer", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 8, cards90: 0.38, fouls90: 1.42 },
      { name: "Carlos Baleba", dbName: "Carlos Baleba", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 5, cards90: 0.27, fouls90: 1.70 },
      { name: "Charalampos Kostoulas", dbName: "Charalampos Kostoulas", team: "Brighton", currentTeamDb: "Brighton", dbTeam: "Brighton", yellows: 2, cards90: 0.51, fouls90: 1.79 }
    ]
  },
  {
    id: "city-bournemouth", day: "Sunday", date: "23 Aug", time: "14:00",
    home: "Manchester City", away: "AFC Bournemouth", homeDb: "Man City", awayDb: "Bournemouth",
    candidates: [
      { name: "Justin Kluivert", dbName: "Justin Kluivert", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 5, cards90: 0.48, fouls90: 1.71 },
      { name: "Tyler Adams", dbName: "Tyler Adams", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 8, cards90: 0.41, fouls90: 1.78 },
      { name: "David Brooks", dbName: "David Brooks", team: "AFC Bournemouth", currentTeamDb: "Bournemouth", dbTeam: "Bournemouth", yellows: 7, cards90: 0.53, fouls90: 0.83 },
      { name: "Nico González", dbName: "Nico González Iglesias", team: "Manchester City", currentTeamDb: "Man City", dbTeam: "Man City", yellows: 6, cards90: 0.35, fouls90: 1.73 },
      { name: "Antoine Semenyo", dbName: "Antoine Semenyo", team: "Manchester City", currentTeamDb: "Man City", dbTeam: "Bournemouth", yellows: 7, cards90: 0.20, fouls90: 1.57 }
    ]
  },
  {
    id: "newcastle-liverpool", day: "Sunday", date: "23 Aug", time: "16:30",
    home: "Newcastle United", away: "Liverpool", homeDb: "Newcastle", awayDb: "Liverpool",
    candidates: [
      { name: "Dan Burn", dbName: "Dan Burn", team: "Newcastle United", currentTeamDb: "Newcastle", dbTeam: "Newcastle", yellows: 9, cards90: 0.37, fouls90: 1.48 },
      { name: "Joelinton", dbName: "Joelinton Cássio Apolinário de Lira", team: "Newcastle United", currentTeamDb: "Newcastle", dbTeam: "Newcastle", yellows: 10, cards90: 0.46, fouls90: 2.17 },
      { name: "Conor Bradley", dbName: "Conor Bradley", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 5, cards90: 0.48, fouls90: 1.75 },
      { name: "Federico Chiesa", dbName: "Federico Chiesa", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 3, cards90: 0.85, fouls90: 3.12 },
      { name: "Joe Gomez", dbName: "Joe Gomez", team: "Liverpool", currentTeamDb: "Liverpool", dbTeam: "Liverpool", yellows: 4, cards90: 0.61, fouls90: 2.12 }
    ]
  },
  {
    id: "fulham-chelsea", day: "Monday", date: "24 Aug", time: "20:00",
    home: "Fulham", away: "Chelsea", homeDb: "Fulham", awayDb: "Chelsea",
    candidates: [
      { name: "Moisés Caicedo", dbName: "Moisés Caicedo Corozo", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 11, cards90: 0.35, fouls90: 1.74 },
      { name: "Jorge Cuenca", dbName: "Jorge Cuenca Barreno", team: "Fulham", currentTeamDb: "Fulham", dbTeam: "Fulham", yellows: 6, cards90: 0.58, fouls90: 0.96 },
      { name: "Liam Delap", dbName: "Liam Delap", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 4, cards90: 0.33, fouls90: 2.06 },
      { name: "Enzo Fernández", dbName: "Enzo Fernández", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 10, cards90: 0.29, fouls90: 1.04 },
      { name: "Jorrel Hato", dbName: "Jorrel Hato", team: "Chelsea", currentTeamDb: "Chelsea", dbTeam: "Chelsea", yellows: 7, cards90: 0.55, fouls90: 1.19 }
    ]
  }
]

const clubDomains: Record<string, string> = {
  "Arsenal": "arsenal.com",
  "Coventry City": "ccfc.co.uk",
  "Hull City": "wearehullcity.co.uk",
  "Manchester United": "manutd.com",
  "Everton": "evertonfc.com",
  "Crystal Palace": "cpfc.co.uk",
  "Ipswich Town": "itfc.co.uk",
  "Sunderland": "safc.com",
  "Nottingham Forest": "nottinghamforest.co.uk",
  "Leeds United": "leedsunited.com",
  "Brentford": "brentfordfc.com",
  "Tottenham Hotspur": "tottenhamhotspur.com",
  "Brighton & Hove Albion": "brightonandhovealbion.com",
  "Aston Villa": "avfc.co.uk",
  "Manchester City": "mancity.com",
  "AFC Bournemouth": "afcb.co.uk",
  "Newcastle United": "newcastleunited.com",
  "Liverpool": "liverpoolfc.com",
  "Fulham": "fulhamfc.com",
  "Chelsea": "chelseafc.com"
}

function getOpponent(fixture: Fixture, candidate: Candidate) {
  return candidate.currentTeamDb === fixture.homeDb ? fixture.awayDb : fixture.homeDb
}

function candidateKey(fixture: Fixture, candidate: Candidate) {
  return `${fixture.id}|${candidate.dbName}|${candidate.dbTeam}`
}

function getH2HSummary(detail?: PlayerDetail) {
  const rows = detail?.h2h ?? []
  return {
    foulsCommitted: rows.reduce((sum, row) => sum + (row.foulsCommitted ?? 0), 0),
    yellowCards: rows.filter((row) => row.yellowCard === true).length,
    redCards: rows.filter((row) => row.redCard === true).length
  }
}

function researchScore(candidate: Candidate, detail?: PlayerDetail) {
  const h2h = getH2HSummary(detail)
  return Math.min(99, Math.round(candidate.cards90 * 60 + candidate.fouls90 * 8 + candidate.yellows * 2 + Math.min(h2h.foulsCommitted, 8) * 2 + h2h.yellowCards * 12))
}

function scoreBand(score: number) {
  if (score >= 75) return { label: "STRONG", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
  if (score >= 60) return { label: "GOOD", cls: "bg-amber-50 text-amber-700 border-amber-200" }
  return { label: "WATCH", cls: "bg-slate-50 text-slate-700 border-slate-200" }
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

function TeamLogo({ team }: { team: string }) {
  const domain = clubDomains[team]
  const initials = team.replace("AFC ", "").replace(" & Hove Albion", "").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-white text-[0.65rem] font-black text-slate-700 shadow-sm">
      <span>{initials}</span>
      {domain ? <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`} alt="" className="absolute inset-1 size-8 object-contain" onError={(event) => { event.currentTarget.style.display = "none" }} /> : null}
    </span>
  )
}

function VenueBadge({ venue }: { venue?: string | null }) {
  if (!venue) return null
  const isHome = venue.toLowerCase() === "home"
  return <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-muted-foreground">{isHome ? "Home" : "Away"}</span>
}

function YellowMetric({ yellows }: { yellows: number }) {
  return (
    <div className="flex min-w-[104px] items-center gap-2 rounded-xl border border-yellow-300 bg-yellow-50 px-2.5 py-2 text-slate-950">
      <span className="block h-5 w-3.5 shrink-0 rounded-[2px] bg-yellow-400 shadow-sm" aria-hidden="true" />
      <div><p className="font-mono text-base font-black leading-none text-slate-950">{yellows}</p><p className="mt-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-slate-700">2025/26 yellows</p></div>
    </div>
  )
}

export default function HomePage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [openFixture, setOpenFixture] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, PlayerDetail>>({})
  const [evidence, setEvidence] = useState<Record<string, PlayerDetail>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadEvidence() {
      const requests = fixtures.flatMap((fixture) => fixture.candidates.map((candidate) => ({ fixture, candidate })))
      const loaded: Record<string, PlayerDetail> = {}
      for (let i = 0; i < requests.length; i += 8) {
        await Promise.all(requests.slice(i, i + 8).map(async ({ fixture, candidate }) => {
          try {
            const opponent = getOpponent(fixture, candidate)
            const response = await fetch(`/api/player?name=${encodeURIComponent(candidate.dbName)}&team=${encodeURIComponent(candidate.dbTeam)}&opponent=${encodeURIComponent(opponent)}`, { cache: "no-store" })
            if (response.ok) loaded[candidateKey(fixture, candidate)] = await response.json()
          } catch {}
        }))
        if (!cancelled) setEvidence({ ...loaded })
      }
      if (!cancelled) setEvidenceLoading(false)
    }
    loadEvidence()
    return () => { cancelled = true }
  }, [])

  function toggleFixture(fixtureId: string) {
    setOpenFixture((current) => current === fixtureId ? null : fixtureId)
    setSelected(null)
  }

  async function togglePlayer(fixture: Fixture, candidate: Candidate, index: number) {
    const key = `${fixture.id}-${index}`
    if (selected === key) return setSelected(null)
    setSelected(key)
    const prefetched = evidence[candidateKey(fixture, candidate)]
    if (prefetched) return setDetails((current) => ({ ...current, [key]: prefetched }))
    if (details[key]) return
    setLoading(key)
    try {
      const opponent = getOpponent(fixture, candidate)
      const response = await fetch(`/api/player?name=${encodeURIComponent(candidate.dbName)}&team=${encodeURIComponent(candidate.dbTeam)}&opponent=${encodeURIComponent(opponent)}`, { cache: "no-store" })
      if (response.ok) {
        const data = await response.json()
        setDetails((current) => ({ ...current, [key]: data }))
      }
    } catch {} finally { setLoading(null) }
  }

  return (
    <main className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground">
        <div className="mx-auto max-w-2xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div><h1 className="text-xl font-bold tracking-tight">Football Cards</h1><p className="mt-0.5 text-sm text-navy-foreground/70">Premier League card radar · 21–24 Aug 2026</p></div>
            <a href="/admin/import" className="rounded-full bg-navy-foreground/10 px-3 py-1.5 text-xs font-semibold hover:bg-navy-foreground/20">Import</a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary"><Database className="size-5" /></div>
            <div><p className="font-bold">All fixtures</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Tap a match to view its top five yellow-card potentials. Each player can then be opened for their full baseline and H2H evidence.</p>{evidenceLoading ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCw className="size-3 animate-spin" />Loading H2H history from Neon…</p> : null}</div>
          </div>
        </section>

        {fixtures.map((fixture) => {
          const fixtureOpen = openFixture === fixture.id
          return (
            <section key={fixture.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <button type="button" onClick={() => toggleFixture(fixture.id)} className="w-full p-4 text-left transition-colors hover:bg-secondary/30" aria-expanded={fixtureOpen}>
                <div className="flex items-center gap-3">
                  <TeamLogo team={fixture.home} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{fixture.day} · {fixture.date} · {fixture.time}</p>
                    <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm font-bold sm:text-base">{fixture.home}</p><span className="text-xs font-medium text-muted-foreground">v</span><p className="truncate text-sm font-bold sm:text-base">{fixture.away}</p></div>
                    <p className="mt-1 text-xs font-semibold text-yellow-500">{fixtureOpen ? "Hide yellow card potentials" : "View yellow card potentials"}</p>
                  </div>
                  <TeamLogo team={fixture.away} />
                  {fixtureOpen ? <ChevronUp className="size-5 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-5 shrink-0 text-muted-foreground" />}
                </div>
              </button>

              {fixtureOpen ? (
                <div className="border-t border-border bg-secondary/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 px-1"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top 5 yellow card candidates</p><span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">Lineups TBC</span></div>
                  <div className="space-y-2">
                    {fixture.candidates.slice(0, 5).map((candidate, index) => {
                      const key = `${fixture.id}-${index}`
                      const open = selected === key
                      const detail = evidence[candidateKey(fixture, candidate)] ?? details[key]
                      const h2h = getH2HSummary(detail)
                      const band = scoreBand(researchScore(candidate, detail))
                      const transferred = candidate.currentTeamDb !== candidate.dbTeam
                      return (
                        <div key={key} className="overflow-hidden rounded-xl border border-border bg-card">
                          <button type="button" onClick={() => togglePlayer(fixture, candidate, index)} className="w-full p-3 text-left transition-colors hover:bg-secondary/40">
                            <div className="flex items-start gap-3">
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold">{index + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{candidate.name}</p><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${band.cls}`}>{band.label}</span></div>
                                <p className="text-xs text-muted-foreground">{candidate.team}{transferred ? ` · 2025/26 data from ${candidate.dbTeam}` : ""}</p>
                                <div className="mt-2 flex flex-wrap items-stretch gap-2">
                                  <YellowMetric yellows={candidate.yellows} />
                                  <div className="rounded-xl bg-secondary px-2.5 py-2"><p className="font-mono text-sm font-bold">{candidate.cards90.toFixed(2)}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">cards/90</p></div>
                                  <div className="rounded-xl bg-secondary px-2.5 py-2"><p className="font-mono text-sm font-bold">{candidate.fouls90.toFixed(2)}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">fouls/90</p></div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {h2h.foulsCommitted > 0 ? <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium">{h2h.foulsCommitted} H2H fouls</span> : null}
                                  {h2h.yellowCards > 0 ? <span className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs font-semibold text-slate-950"><span className="h-3.5 w-2.5 rounded-[1px] bg-yellow-400" />{h2h.yellowCards} H2H {h2h.yellowCards === 1 ? "booking" : "bookings"}</span> : null}
                                  {h2h.redCards > 0 ? <span className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">🟥 {h2h.redCards} H2H {h2h.redCards === 1 ? "red" : "reds"}</span> : null}
                                </div>
                              </div>
                              {open ? <ChevronUp className="mt-1 size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />}
                            </div>
                          </button>

                          {open ? <div className="border-t border-border bg-secondary/30 p-3">
                            {loading === key ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />Loading evidence from Neon…</div> : detail?.connected ? <div className="space-y-3">
                              {detail.baseline ? <div className="grid grid-cols-3 gap-2"><Stat label="Apps" value={detail.baseline.appearances} /><Stat label="Yellows" value={detail.baseline.yellowCards} yellow /><Stat label="Fouls" value={detail.baseline.foulsCommitted} /><Stat label="Cards/90" value={detail.baseline.cardsPer90} decimals /><Stat label="Fouls/90" value={detail.baseline.foulsPer90} decimals /><Stat label="Minutes" value={detail.baseline.minutes} /></div> : null}
                              {detail.h2h?.length ? <div><p className="mb-1.5 text-xs font-semibold text-muted-foreground">Previous meetings vs {getOpponent(fixture, candidate)}</p><div className="space-y-1.5">{detail.h2h.slice(0, 8).map((match, matchIndex) => {
                                const booked = match.yellowCard === true
                                const sentOff = match.redCard === true
                                return <div key={`${match.matchDate}-${matchIndex}`} className="rounded-lg bg-card px-3 py-2 text-xs">
                                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="font-medium">{formatDate(match.matchDate)}</span><VenueBadge venue={match.venue} /></div><span className={`inline-flex items-center gap-1.5 font-semibold ${sentOff ? "text-red-500" : booked ? "text-yellow-500" : "text-muted-foreground"}`}>{sentOff ? "🟥 Sent off" : booked ? <><span className="h-4 w-3 rounded-[2px] bg-yellow-400" />Booked</> : match.yellowCard === false ? "No card" : "Card data missing"}</span></div>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground"><span>{match.foulsCommitted ?? "—"} fouls committed</span><span>{match.foulsDrawn ?? "—"} fouls drawn</span>{match.competition ? <span>{match.competition}</span> : null}</div>
                                </div>
                              })}</div></div> : <p className="text-xs text-muted-foreground">No imported player H2H rows for this opponent.</p>}
                            </div> : <div className="flex gap-2 text-sm text-muted-foreground"><ShieldAlert className="mt-0.5 size-4 shrink-0" />The ranking is available, but the detailed Neon lookup did not return a player record.</div>}
                          </div> : null}
                        </div>
                      )
                    })}
                  </div>
                  {fixture.noLeagueH2HReason ? <div className="mt-3 rounded-xl border border-dashed border-border bg-secondary/30 px-3 py-3"><p className="text-xs font-bold">2025/26 league H2H unavailable</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{fixture.noLeagueH2HReason}</p></div> : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </main>
  )
}

function Stat({ label, value, decimals = false, yellow = false }: { label: string; value: number | null | undefined; decimals?: boolean; yellow?: boolean }) {
  const display = value == null ? "—" : decimals ? Number(value).toFixed(2) : Math.round(Number(value)).toString()
  return <div className={`rounded-xl px-2 py-2 text-center ${yellow ? "border border-yellow-300 bg-yellow-50 text-slate-950" : "bg-card"}`}><p className={`font-mono text-base font-bold ${yellow ? "text-slate-950" : ""}`}>{display}</p><p className={`mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${yellow ? "text-slate-700" : "text-muted-foreground"}`}>{label}</p></div>
}
