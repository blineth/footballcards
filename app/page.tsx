"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Database,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

type Candidate = {
  name: string;
  dbName: string;
  team: string;
  dbTeam: string;
  yellows: number;
  cards90: number;
  fouls90: number;
  h2hFouls?: number;
  score: number;
};

type Fixture = {
  id: string;
  day: string;
  date: string;
  time: string;
  home: string;
  away: string;
  homeDb: string;
  awayDb: string;
  candidates: Candidate[];
};

type PlayerDetail = {
  connected?: boolean;
  baseline?: {
    appearances?: number | null;
    starts?: number | null;
    minutes?: number | null;
    yellowCards?: number | null;
    redCards?: number | null;
    foulsCommitted?: number | null;
    foulsDrawn?: number | null;
    foulsPer90?: number | null;
    cardsPer90?: number | null;
  } | null;
  h2h?: Array<{
    matchDate: string;
    foulsCommitted?: number | null;
    foulsDrawn?: number | null;
    yellowCard?: boolean | null;
    redCard?: boolean | null;
  }>;
};

const fixtures: Fixture[] = [
  {
    id: "arsenal-coventry",
    day: "Friday",
    date: "21 Aug",
    time: "20:00",
    home: "Arsenal",
    away: "Coventry City",
    homeDb: "Arsenal",
    awayDb: "Coventry",
    candidates: [
      { name: "Cristhian Mosquera", dbName: "Cristhian Mosquera", team: "Arsenal", dbTeam: "Arsenal", yellows: 4, cards90: 0.37, fouls90: 1.55, score: 57 },
      { name: "Riccardo Calafiori", dbName: "Riccardo Calafiori", team: "Arsenal", dbTeam: "Arsenal", yellows: 5, cards90: 0.27, fouls90: 1.38, score: 56 },
      { name: "Viktor Gyökeres", dbName: "Viktor Gyökeres", team: "Arsenal", dbTeam: "Arsenal", yellows: 5, cards90: 0.20, fouls90: 1.42, score: 53 },
    ],
  },
  {
    id: "hull-man-utd",
    day: "Saturday",
    date: "22 Aug",
    time: "12:30",
    home: "Hull City",
    away: "Manchester United",
    homeDb: "Hull",
    awayDb: "Man Utd",
    candidates: [
      { name: "Casemiro", dbName: "Carlos Henrique Casimiro", team: "Manchester United", dbTeam: "Man Utd", yellows: 9, cards90: 0.31, fouls90: 1.61, score: 61 },
      { name: "Luke Shaw", dbName: "Luke Shaw", team: "Manchester United", dbTeam: "Man Utd", yellows: 9, cards90: 0.25, fouls90: 1.34, score: 55 },
      { name: "Patrick Dorgu", dbName: "Patrick Dorgu", team: "Manchester United", dbTeam: "Man Utd", yellows: 5, cards90: 0.31, fouls90: 1.44, score: 47 },
    ],
  },
  {
    id: "everton-palace",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Everton",
    away: "Crystal Palace",
    homeDb: "Everton",
    awayDb: "Crystal Palace",
    candidates: [
      { name: "Tim Iroegbunam", dbName: "Tim Iroegbunam", team: "Everton", dbTeam: "Everton", yellows: 9, cards90: 0.55, fouls90: 1.77, h2hFouls: 2, score: 74 },
      { name: "Jefferson Lerma", dbName: "Jefferson Lerma Solís", team: "Crystal Palace", dbTeam: "Crystal Palace", yellows: 7, cards90: 0.37, fouls90: 1.31, h2hFouls: 1, score: 64 },
      { name: "Will Hughes", dbName: "Will Hughes", team: "Crystal Palace", dbTeam: "Crystal Palace", yellows: 8, cards90: 0.39, fouls90: 1.28, h2hFouls: 1, score: 63 },
    ],
  },
  {
    id: "ipswich-sunderland",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Ipswich Town",
    away: "Sunderland",
    homeDb: "Ipswich",
    awayDb: "Sunderland",
    candidates: [
      { name: "Reinildo", dbName: "Reinildo Mandava", team: "Sunderland", dbTeam: "Sunderland", yellows: 7, cards90: 0.32, fouls90: 1.46, score: 54 },
      { name: "Noah Sadiki", dbName: "Noah Sadiki", team: "Sunderland", dbTeam: "Sunderland", yellows: 9, cards90: 0.28, fouls90: 1.00, score: 53 },
      { name: "Habib Diarra", dbName: "Habib Diarra", team: "Sunderland", dbTeam: "Sunderland", yellows: 6, cards90: 0.38, fouls90: 1.28, score: 52 },
    ],
  },
  {
    id: "forest-leeds",
    day: "Saturday",
    date: "22 Aug",
    time: "15:00",
    home: "Nottingham Forest",
    away: "Leeds United",
    homeDb: "Nott'm Forest",
    awayDb: "Leeds",
    candidates: [
      { name: "Ethan Ampadu", dbName: "Ethan Ampadu", team: "Leeds United", dbTeam: "Leeds", yellows: 10, cards90: 0.29, fouls90: 1.44, h2hFouls: 4, score: 68 },
      { name: "Elliot Anderson", dbName: "Elliot Anderson", team: "Nottingham Forest", dbTeam: "Nott'm Forest", yellows: 8, cards90: 0.22, fouls90: 1.54, h2hFouls: 5, score: 68 },
      { name: "Ibrahim Sangaré", dbName: "Ibrahim Sangaré", team: "Nottingham Forest", dbTeam: "Nott'm Forest", yellows: 5, cards90: 0.22, fouls90: 1.82, h2hFouls: 6, score: 64 },
    ],
  },
  {
    id: "brentford-spurs",
    day: "Saturday",
    date: "22 Aug",
    time: "17:30",
    home: "Brentford",
    away: "Tottenham Hotspur",
    homeDb: "Brentford",
    awayDb: "Spurs",
    candidates: [
      { name: "Cristian Romero", dbName: "Cristian Romero", team: "Tottenham Hotspur", dbTeam: "Spurs", yellows: 9, cards90: 0.43, fouls90: 1.54, h2hFouls: 5, score: 76 },
      { name: "Vitaly Janelt", dbName: "Vitaly Janelt", team: "Brentford", dbTeam: "Brentford", yellows: 8, cards90: 0.50, fouls90: 1.26, h2hFouls: 3, score: 75 },
      { name: "Kevin Danso", dbName: "Kevin Danso", team: "Tottenham Hotspur", dbTeam: "Spurs", yellows: 8, cards90: 0.40, fouls90: 1.23, score: 61 },
    ],
  },
  {
    id: "brighton-villa",
    day: "Sunday",
    date: "23 Aug",
    time: "14:00",
    home: "Brighton & Hove Albion",
    away: "Aston Villa",
    homeDb: "Brighton",
    awayDb: "Aston Villa",
    candidates: [
      { name: "Diego Gómez", dbName: "Diego Gómez Amarilla", team: "Brighton", dbTeam: "Brighton", yellows: 9, cards90: 0.38, fouls90: 2.04, h2hFouls: 2, score: 72 },
      { name: "Mats Wieffer", dbName: "Mats Wieffer", team: "Brighton", dbTeam: "Brighton", yellows: 8, cards90: 0.38, fouls90: 1.42, h2hFouls: 2, score: 68 },
      { name: "Matty Cash", dbName: "Matty Cash", team: "Aston Villa", dbTeam: "Aston Villa", yellows: 9, cards90: 0.27, fouls90: 1.22, h2hFouls: 1, score: 60 },
    ],
  },
  {
    id: "city-bournemouth",
    day: "Sunday",
    date: "23 Aug",
    time: "14:00",
    home: "Manchester City",
    away: "AFC Bournemouth",
    homeDb: "Man City",
    awayDb: "Bournemouth",
    candidates: [
      { name: "Justin Kluivert", dbName: "Justin Kluivert", team: "AFC Bournemouth", dbTeam: "Bournemouth", yellows: 5, cards90: 0.48, fouls90: 1.71, h2hFouls: 5, score: 70 },
      { name: "Tyler Adams", dbName: "Tyler Adams", team: "AFC Bournemouth", dbTeam: "Bournemouth", yellows: 8, cards90: 0.41, fouls90: 1.78, h2hFouls: 3, score: 70 },
      { name: "Álex Jiménez", dbName: "Álex Jiménez Sánchez", team: "AFC Bournemouth", dbTeam: "Bournemouth", yellows: 7, cards90: 0.41, fouls90: 1.28, score: 63 },
    ],
  },
  {
    id: "newcastle-liverpool",
    day: "Sunday",
    date: "23 Aug",
    time: "16:30",
    home: "Newcastle United",
    away: "Liverpool",
    homeDb: "Newcastle",
    awayDb: "Liverpool",
    candidates: [
      { name: "Joelinton", dbName: "Joelinton Cássio Apolinário de Lira", team: "Newcastle United", dbTeam: "Newcastle", yellows: 10, cards90: 0.46, fouls90: 2.17, h2hFouls: 1, score: 80 },
      { name: "Dan Burn", dbName: "Dan Burn", team: "Newcastle United", dbTeam: "Newcastle", yellows: 9, cards90: 0.37, fouls90: 1.48, h2hFouls: 4, score: 70 },
      { name: "Bruno Guimarães", dbName: "Bruno Guimarães Rodriguez Moura", team: "Newcastle United", dbTeam: "Newcastle", yellows: 6, cards90: 0.22, fouls90: 1.65, h2hFouls: 4, score: 67 },
    ],
  },
  {
    id: "fulham-chelsea",
    day: "Monday",
    date: "24 Aug",
    time: "20:00",
    home: "Fulham",
    away: "Chelsea",
    homeDb: "Fulham",
    awayDb: "Chelsea",
    candidates: [
      { name: "Saša Lukić", dbName: "Saša Lukić", team: "Fulham", dbTeam: "Fulham", yellows: 9, cards90: 0.47, fouls90: 2.76, h2hFouls: 6, score: 96 },
      { name: "Moisés Caicedo", dbName: "Moisés Caicedo Corozo", team: "Chelsea", dbTeam: "Chelsea", yellows: 11, cards90: 0.35, fouls90: 1.74, h2hFouls: 2, score: 70 },
      { name: "Jorge Cuenca", dbName: "Jorge Cuenca Barreno", team: "Fulham", dbTeam: "Fulham", yellows: 7, cards90: 0.39, fouls90: 1.25, score: 64 },
    ],
  },
];

function getOpponent(fixture: Fixture, candidate: Candidate) {
  return candidate.dbTeam === fixture.homeDb ? fixture.awayDb : fixture.homeDb;
}

function scoreBand(score: number) {
  if (score >= 75) return { label: "STRONG", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (score >= 60) return { label: "GOOD", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "WATCH", cls: "bg-slate-50 text-slate-600 border-slate-200" };
}

export default function HomePage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PlayerDetail>>({});
  const [loading, setLoading] = useState<string | null>(null);

  async function togglePlayer(fixture: Fixture, candidate: Candidate, index: number) {
    const key = `${fixture.id}-${index}`;
    if (selected === key) {
      setSelected(null);
      return;
    }

    setSelected(key);

    if (details[key]) return;

    setLoading(key);
    try {
      const opponent = getOpponent(fixture, candidate);
      const url =
        `/api/player?name=${encodeURIComponent(candidate.dbName)}` +
        `&team=${encodeURIComponent(candidate.dbTeam)}` +
        `&opponent=${encodeURIComponent(opponent)}`;

      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setDetails((current) => ({ ...current, [key]: data }));
      }
    } catch {
      // The summary ranking still remains visible if the detail request fails.
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-30 bg-navy text-navy-foreground">
        <div className="mx-auto max-w-2xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Football Cards</h1>
              <p className="mt-0.5 text-sm text-navy-foreground/70">
                Next Premier League matchweek · 21–24 Aug 2026
              </p>
            </div>
            <a
              href="/admin/import"
              className="rounded-full bg-navy-foreground/10 px-3 py-1.5 text-xs font-semibold hover:bg-navy-foreground/20"
            >
              Import
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Database className="size-5 text-foreground" />
            </div>
            <div>
              <p className="font-bold text-foreground">Pre-lineup card radar</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Ranked from the historical data already imported into Neon:
                2025/26 cards, cards/90, fouls/90 and opponent H2H foul history.
                Lineups are not required for this view.
              </p>
            </div>
          </div>
        </section>

        {fixtures.map((fixture) => (
          <section
            key={fixture.id}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border bg-secondary/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {fixture.day} · {fixture.date}
                  </p>
                  <h2 className="mt-1 text-base font-bold text-foreground">
                    {fixture.home} <span className="font-normal text-muted-foreground">v</span>{" "}
                    {fixture.away}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-foreground">{fixture.time}</p>
                  <span className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                    Lineups TBC
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3">
              <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Top card candidates
              </p>

              <div className="space-y-2">
                {fixture.candidates.map((candidate, index) => {
                  const key = `${fixture.id}-${index}`;
                  const open = selected === key;
                  const detail = details[key];
                  const band = scoreBand(candidate.score);

                  return (
                    <div key={key} className="overflow-hidden rounded-xl border border-border">
                      <button
                        type="button"
                        onClick={() => togglePlayer(fixture, candidate, index)}
                        className="w-full bg-card p-3 text-left transition-colors hover:bg-secondary/40"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold text-foreground">
                            {index + 1}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-foreground">{candidate.name}</p>
                              <span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${band.cls}`}>
                                {band.label}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{candidate.team}</p>

                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                🟨 {candidate.yellows} yellows
                              </span>
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                {candidate.cards90.toFixed(2)} cards/90
                              </span>
                              <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                {candidate.fouls90.toFixed(2)} fouls/90
                              </span>
                              {candidate.h2hFouls ? (
                                <span className="rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-foreground">
                                  {candidate.h2hFouls} H2H fouls
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {open ? (
                            <ChevronUp className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {open ? (
                        <div className="border-t border-border bg-secondary/30 p-3">
                          {loading === key ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <RefreshCw className="size-4 animate-spin" />
                              Loading evidence from Neon…
                            </div>
                          ) : detail?.connected ? (
                            <div className="space-y-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                                Imported database evidence
                              </p>

                              {detail.baseline ? (
                                <div className="grid grid-cols-3 gap-2">
                                  <Stat label="Apps" value={detail.baseline.appearances} />
                                  <Stat label="Yellows" value={detail.baseline.yellowCards} />
                                  <Stat label="Fouls" value={detail.baseline.foulsCommitted} />
                                  <Stat label="Cards/90" value={detail.baseline.cardsPer90} decimals />
                                  <Stat label="Fouls/90" value={detail.baseline.foulsPer90} decimals />
                                  <Stat label="Minutes" value={detail.baseline.minutes} />
                                </div>
                              ) : null}

                              {detail.h2h && detail.h2h.length > 0 ? (
                                <div>
                                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                                    Previous meetings vs {getOpponent(fixture, candidate)}
                                  </p>
                                  <div className="space-y-1.5">
                                    {detail.h2h.slice(0, 5).map((match, matchIndex) => {
                                      const cardStatus =
                                        match.redCard === true
                                          ? { label: "Sent off", icon: "🟥", className: "text-destructive" }
                                          : match.yellowCard === true
                                            ? { label: "Booked", icon: "🟨", className: "text-foreground" }
                                            : match.yellowCard === false
                                              ? { label: "No card", icon: "", className: "text-muted-foreground" }
                                              : { label: "Card data missing", icon: "?", className: "text-muted-foreground" };

                                      return (
                                        <div
                                          key={`${match.matchDate}-${matchIndex}`}
                                          className="rounded-lg bg-card px-3 py-2 text-xs"
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="font-medium text-foreground">
                                              {match.matchDate}
                                            </span>
                                            <span className={`inline-flex items-center gap-1 font-semibold ${cardStatus.className}`}>
                                              {cardStatus.icon ? <span>{cardStatus.icon}</span> : null}
                                              {cardStatus.label}
                                            </span>
                                          </div>

                                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                                            <span>
                                              {match.foulsCommitted ?? "—"} fouls committed
                                            </span>
                                            <span>
                                              {match.foulsDrawn ?? "—"} fouls drawn
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <p className="mt-2 text-[0.68rem] leading-relaxed text-muted-foreground">
                                    A yellow is only shown when the imported H2H row explicitly records it.
                                    Blank card fields are shown as “Card data missing”, not “No card”.
                                  </p>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No Premier League H2H rows imported for this opponent.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex gap-2 text-sm text-muted-foreground">
                              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                              The pre-lineup ranking is available, but the detailed Neon lookup
                              did not return a player record.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ))}

        <p className="rounded-xl bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Research score is an evidence-strength ranking, not a guaranteed booking probability.
          Promoted clubs Coventry, Hull and Ipswich do not yet have their Championship history
          loaded, so those fixtures currently rank players from the returning Premier League side.
        </p>
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-around px-4 py-2">
          <span className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
            This week
          </span>
          <a href="/admin/import" className="px-4 py-2 text-xs font-semibold text-muted-foreground">
            Import data
          </a>
        </div>
      </nav>
    </main>
  );
}

function Stat({
  label,
  value,
  decimals = false,
}: {
  label: string;
  value: number | null | undefined;
  decimals?: boolean;
}) {
  const display =
    value == null ? "—" : decimals ? Number(value).toFixed(2) : Math.round(Number(value)).toString();

  return (
    <div className="rounded-xl bg-card px-2 py-2 text-center">
      <p className="font-mono text-base font-bold text-foreground">{display}</p>
      <p className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
