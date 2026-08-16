"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { formatMatchDate } from "@/lib/date"
import { fetcher } from "@/lib/fetcher"
import type { Candidate } from "@/lib/types"
import useSWR from "swr"

interface PlayerDetail {
  connected: boolean
  player: string
  team?: string
  baseline: {
    season: string
    competition: string
    appearances: number | null
    starts: number | null
    minutes: number | null
    yellowCards: number | null
    redCards: number | null
    foulsCommitted: number | null
    foulsDrawn: number | null
    foulsPer90: number | null
    cardsPer90: number | null
  } | null
  h2h: {
    matchDate: string
    opponent: string
    minutes: number | null
    foulsCommitted: number | null
    foulsDrawn: number | null
    yellowCard: boolean | null
    redCard: boolean | null
  }[]
  refereeHistory: {
    referee: string
    matchesTogether: number | null
    yellowCards: number | null
    redCards: number | null
    foulsCommitted: number | null
  } | null
}

export function PlayerDetailDrawer({
  candidate,
  opponent,
  referee,
  onClose,
}: {
  candidate: Candidate | null
  opponent: string | null
  referee: string | null
  onClose: () => void
}) {
  const open = candidate !== null
  const key =
    candidate !== null
      ? `/api/player?name=${encodeURIComponent(candidate.playerName)}&team=${encodeURIComponent(
          candidate.team,
        )}${opponent ? `&opponent=${encodeURIComponent(opponent)}` : ""}${
          referee ? `&referee=${encodeURIComponent(referee)}` : ""
        }`
      : null
  const { data, isLoading } = useSWR<PlayerDetail>(key, fetcher)

  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl p-0">
        {candidate ? (
          <>
            <SheetHeader className="border-b border-border p-5 pb-4">
              <SheetTitle className="text-left text-xl font-bold">{candidate.playerName}</SheetTitle>
              <p className="text-left text-sm text-muted-foreground">
                {candidate.team}
                {opponent ? ` · vs ${opponent}` : ""}
              </p>
            </SheetHeader>

            <div className="space-y-6 p-5">
              {isLoading ? (
                <Skeleton className="h-40 w-full rounded-2xl" />
              ) : !data ? null : !data.connected ? (
                <Notice text="Historical database is not connected, so no season stats or match history can be shown." />
              ) : (
                <>
                  <Section title="Season stats">
                    {data.baseline ? (
                      <div className="grid grid-cols-3 gap-2">
                        <Metric label="Apps" value={data.baseline.appearances} integer />
                        <Metric label="Starts" value={data.baseline.starts} integer />
                        <Metric label="Minutes" value={data.baseline.minutes} integer />
                        <Metric label="Yellows" value={data.baseline.yellowCards} integer yellow />
                        <Metric label="Reds" value={data.baseline.redCards} integer />
                        <Metric label="Fouls" value={data.baseline.foulsCommitted} integer />
                        <Metric label="Fouls/90" value={data.baseline.foulsPer90} />
                        <Metric label="Cards/90" value={data.baseline.cardsPer90} />
                        <Metric label="Fouls drawn" value={data.baseline.foulsDrawn} integer />
                      </div>
                    ) : (
                      <Notice text="Not enough historical data has been imported for this player." />
                    )}
                  </Section>

                  <Section
                    title={opponent ? `Previous meetings vs ${opponent}` : "Head-to-head record"}
                  >
                    {data.h2h.length > 0 ? (
                      <ul className="space-y-2">
                        {data.h2h.map((m, i) => (
                          <li
                            key={`${m.matchDate}-${i}`}
                            className="flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5"
                          >
                            <span className="font-mono text-sm font-medium text-foreground">
                              {formatMatchDate(m.matchDate)}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-muted-foreground">
                                {m.foulsCommitted ?? "--"} {m.foulsCommitted === 1 ? "foul" : "fouls"}
                              </span>
                              {m.redCard ? (
                                <span className="inline-flex items-center gap-1 text-sm font-semibold text-destructive">
                                  <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-destructive" />
                                  sent off
                                </span>
                              ) : m.yellowCard ? (
                                <span className="inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                                  <span className="inline-block h-3.5 w-2.5 rounded-[2px] bg-card-yellow" />
                                  booked
                                </span>
                              ) : (
                                <span className="text-sm text-muted-foreground">no card</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Notice
                        text={
                          opponent
                            ? `No head-to-head matches against ${opponent} have been imported.`
                            : "No head-to-head data imported."
                        }
                      />
                    )}
                  </Section>

                  <Section title="Referee history">
                    {data.refereeHistory ? (
                      <div className="rounded-xl bg-secondary p-3">
                        <p className="text-sm font-semibold text-foreground">{data.refereeHistory.referee}</p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <Metric label="Together" value={data.refereeHistory.matchesTogether} integer />
                          <Metric label="Yellows" value={data.refereeHistory.yellowCards} integer yellow />
                          <Metric label="Fouls" value={data.refereeHistory.foulsCommitted} integer />
                        </div>
                      </div>
                    ) : (
                      <Notice text="No record of this referee officiating this player has been imported." />
                    )}
                  </Section>
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">{title}</h4>
      {children}
    </section>
  )
}

function Metric({
  label,
  value,
  integer,
  yellow,
}: {
  label: string
  value: number | null
  integer?: boolean
  yellow?: boolean
}) {
  return (
    <div className="rounded-xl bg-secondary px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1">
        {yellow ? <span className="inline-block size-2.5 rounded-[3px] bg-card-yellow" /> : null}
        <span className="font-mono text-base font-bold tabular-nums text-foreground">
          {value == null ? "--" : integer ? value : value.toFixed(2)}
        </span>
      </div>
      <p className="mt-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-card px-3 py-3 text-sm text-muted-foreground text-pretty">
      {text}
    </p>
  )
}
