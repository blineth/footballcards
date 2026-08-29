"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship"
type Fixture = { id: string; competition: Competition; dateIso: string; day: string; date: string; time: string; home: string; away: string }
type H2HMatch = { matchDate: string; opponent?: string | null; competition?: string | null; venue?: string | null; minutes?: number | null; foulsCommitted?: number | null; foulsDrawn?: number | null; yellowCard?: boolean | null; redCard?: boolean | null }
type CurrentSeason = { season?: string; games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; cards90?: number | null; evidenceWeight?: number }
type Candidate = { name: string; dbName: string; team: string; dbTeam: string; yellows: number; cards90: number; fouls90: number; appearances: number; starts: number; minutes: number; startLikelihood: number; sampleLabel: string; h2hYellows: number; h2hFouls: number; h2hMatches?: H2HMatch[]; score: number; band: "STRONG" | "GOOD" | "WATCH"; currentSeason?: CurrentSeason }
type RadarResponse = { lineupsConfirmed?: boolean; referee?: { name: string; yellowsPerGame?: number | null } | null; candidates?: Candidate[] }

const fixtures: Fixture[] = [
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

function query(fixture: Fixture) {
  const params = new URLSearchParams({ date: fixture.dateIso, home: fixture.home, away: fixture.away, competition: fixture.competition })
  return `/api/fixture-radar?${params.toString()}`
}

function evidenceScore(candidate: Candidate) {
  const repeatedH2H = candidate.h2hYellows >= 2 ? 30 : candidate.h2hYellows === 1 ? 18 : 0
  const h2hFoulSignal = Math.min(14, candidate.h2hFouls * 2.5)
  const cardRateSignal = Math.min(18, candidate.cards90 * 36)
  const foulRateSignal = Math.min(12, candidate.fouls90 * 5)
  const currentYellowSignal = Math.min(14, Number(candidate.currentSeason?.yellows ?? 0) * 10)
  const currentFoulSignal = Math.min(8, Number(candidate.currentSeason?.fouls90 ?? 0) * 3)
  const starterSignal = Math.min(4, candidate.startLikelihood * 4)
  return repeatedH2H + h2hFoulSignal + cardRateSignal + foulRateSignal + currentYellowSignal + currentFoulSignal + starterSignal
}

function isExtraStrong(candidate: Candidate) {
  const repeatedBooking = candidate.h2hYellows >= 2
  const h2hPlusProfile = candidate.h2hYellows >= 1 && (candidate.cards90 >= 0.25 || candidate.fouls90 >= 1.25)
  const highGeneralProfile = candidate.cards90 >= 0.35 && candidate.fouls90 >= 1.5 && candidate.startLikelihood >= 0.7
  const currentSeasonSignal = Number(candidate.currentSeason?.yellows ?? 0) >= 1 && Number(candidate.currentSeason?.fouls90 ?? 0) >= 1
  return repeatedBooking || h2hPlusProfile || highGeneralProfile || currentSeasonSignal || candidate.band === "STRONG"
}

function shortlist(candidates: Candidate[]) {
  const ordered = [...candidates].sort((a, b) => evidenceScore(b) - evidenceScore(a) || b.score - a.score)
  const chosen = ordered.slice(0, 2)
  for (const candidate of ordered.slice(2)) {
    if (chosen.length >= 4) break
    if (isExtraStrong(candidate)) chosen.push(candidate)
  }
  return chosen
}

function minutesLabel(minutes: number | null | undefined) {
  if (minutes == null) return "minutes unknown"
  if (minutes === 0) return "did not play"
  return `${minutes} min`
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

export default function ShortlistPage() {
  const [radar, setRadar] = useState<Record<string, RadarResponse>>({})
  const [loading, setLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      await Promise.all(fixtures.map(async (fixture) => {
        try {
          const response = await fetch(query(fixture), { cache: "no-store" })
          if (!response.ok) return
          const data = await response.json() as RadarResponse
          setRadar((current) => ({ ...current, [fixture.id]: data }))
        } catch {}
      }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const rows = useMemo(() => fixtures.map((fixture) => ({ fixture, data: radar[fixture.id], picks: shortlist(radar[fixture.id]?.candidates ?? []) })), [radar])

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div>
            <h1 className="text-xl font-bold">Card Shortlist</h1>
            <p className="mt-0.5 text-sm text-navy-foreground/70">Best yellow-card evidence across GW2</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="rounded-xl bg-white/10 p-2.5" aria-label="Refresh shortlist"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="font-bold">Quick shortlist</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Normally shows the strongest 2 players in each match. Extra names appear only when the evidence is unusually strong, such as repeated H2H bookings, strong H2H foul history, high cards/90 plus fouls/90, or a current-season card signal. This is an evidence ranking, not a guarantee of a booking.</p>
        </section>

        {rows.map(({ fixture, data, picks }) => (
          <section key={fixture.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{fixture.day} · {fixture.date} · {fixture.time}</p>
              <p className="mt-1 font-bold">{fixture.home} v {fixture.away}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] font-semibold text-muted-foreground">
                <span>{data?.lineupsConfirmed ? "Lineups confirmed" : "Pre-lineup"}</span>
                {data?.referee?.name ? <span>Ref: {data.referee.name}{data.referee.yellowsPerGame != null ? ` · ${data.referee.yellowsPerGame.toFixed(2)} yellows/game` : ""}</span> : null}
              </div>
            </div>

            <div className="space-y-3 p-3">
              {picks.length ? picks.map((candidate, index) => {
                const recentH2H = (candidate.h2hMatches ?? []).slice(0, 3)
                return (
                  <div key={`${fixture.id}-${candidate.dbName}`} className="rounded-xl border border-border bg-secondary/25 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-navy font-mono text-xs font-black text-white">{index + 1}</span><p className="font-bold">{candidate.name}</p><span className="rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-[0.62rem] font-bold text-slate-900">{candidate.team}</span></div>
                        <p className="mt-1 text-xs text-muted-foreground">Evidence score {candidate.score.toFixed(0)} · {candidate.sampleLabel}</p>
                      </div>
                      <span className="rounded-lg bg-card px-2 py-1 text-[0.65rem] font-extrabold">{isExtraStrong(candidate) ? "Strong signal" : "Top 2"}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-card p-2"><p className="font-mono font-bold">{candidate.yellows}</p><p className="text-[0.58rem] font-semibold uppercase text-muted-foreground">25/26 yellows</p></div>
                      <div className="rounded-lg bg-card p-2"><p className="font-mono font-bold">{candidate.cards90.toFixed(2)}</p><p className="text-[0.58rem] font-semibold uppercase text-muted-foreground">cards/90</p></div>
                      <div className="rounded-lg bg-card p-2"><p className="font-mono font-bold">{candidate.fouls90.toFixed(2)}</p><p className="text-[0.58rem] font-semibold uppercase text-muted-foreground">fouls/90</p></div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {candidate.h2hYellows > 0 ? <span className="rounded-lg border border-yellow-300 bg-yellow-50 px-2 py-1 font-semibold text-slate-900">{candidate.h2hYellows} H2H booking{candidate.h2hYellows === 1 ? "" : "s"}</span> : null}
                      {candidate.h2hFouls > 0 ? <span className="rounded-lg bg-card px-2 py-1 font-medium">{candidate.h2hFouls} H2H fouls</span> : null}
                      {candidate.currentSeason?.games ? <span className="rounded-lg bg-card px-2 py-1 font-medium">26/27: {candidate.currentSeason.yellows ?? 0} YC · {candidate.currentSeason.fouls ?? 0} fouls</span> : null}
                    </div>

                    {recentH2H.length ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-[0.62rem] font-bold uppercase tracking-wide text-muted-foreground">Recent H2H meetings</p>
                        {recentH2H.map((match, matchIndex) => (
                          <div key={`${match.matchDate}-${matchIndex}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-2 text-xs">
                            <span className="font-semibold">{formatDate(match.matchDate)} · {minutesLabel(match.minutes)}</span>
                            <span className="text-muted-foreground">{match.foulsCommitted ?? 0} fouls{match.yellowCard === true ? " · booked" : ""}{match.redCard === true ? " · sent off" : ""}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              }) : <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No shortlist data available for this fixture yet.</div>}
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}
