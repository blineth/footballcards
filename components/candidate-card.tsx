"use client"

import type { Candidate, ConfidenceBand } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"

const bandConfig: Record<ConfidenceBand, { label: string; dot: string; text: string; ring: string }> = {
  STRONG: { label: "STRONG", dot: "bg-strong", text: "text-strong", ring: "border-strong/30 bg-strong/8" },
  GOOD: { label: "GOOD", dot: "bg-good", text: "text-good", ring: "border-good/40 bg-good/10" },
  WATCH: { label: "WATCH", dot: "bg-watch", text: "text-watch", ring: "border-border bg-secondary" },
}

export function CandidateCard({
  candidate,
  rank,
  onOpen,
}: {
  candidate: Candidate
  rank: number
  onOpen: (c: Candidate) => void
}) {
  const band = bandConfig[candidate.band]
  const primaryEvidence = candidate.evidence.filter((e) => e.hasData).slice(0, 4)

  return (
    <button
      type="button"
      onClick={() => onOpen(candidate)}
      className="w-full rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold text-secondary-foreground">
            {rank}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold text-foreground">{candidate.playerName}</span>
              {candidate.confirmed ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-strong/12 px-1.5 py-0.5 text-[0.6rem] font-bold text-strong">
                  XI
                </span>
              ) : null}
            </div>
            <span className="text-sm text-muted-foreground">{candidate.team}</span>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>

      {/* Evidence is more prominent than the score */}
      {primaryEvidence.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {primaryEvidence.map((e) => (
            <li
              key={e.key}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground"
            >
              {e.key === "yellowsLastSeason" || e.key === "refereeYellows" || e.key === "h2hBookings" ? (
                <span className="inline-block size-2.5 rounded-[3px] bg-card-yellow" />
              ) : null}
              <span className="font-mono font-semibold tabular-nums text-foreground">{e.display}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg bg-secondary px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Not enough historical data
        </p>
      )}

      <div className={cn("mt-3 flex items-center justify-between gap-3 rounded-xl border px-3 py-2", band.ring)}>
        <div className="flex items-center gap-2">
          <span className={cn("inline-block size-2.5 rounded-full", band.dot)} />
          <span className={cn("text-xs font-bold tracking-wide", band.text)}>{band.label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[0.65rem] font-medium text-muted-foreground">Research confidence</span>
          <span className="font-mono text-lg font-bold tabular-nums text-foreground">
            {candidate.hasHistoricalData ? candidate.researchConfidence : "--"}
          </span>
          <span className="text-[0.65rem] font-medium text-muted-foreground">/100</span>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground text-pretty">{candidate.explanation}</p>
    </button>
  )
}
