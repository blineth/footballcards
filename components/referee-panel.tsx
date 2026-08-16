import type { RefereeSummary } from "@/lib/types"
import { Gavel } from "lucide-react"

export function RefereePanel({ referee }: { referee: RefereeSummary | null }) {
  const hasStats = referee?.yellowsPerGame != null || referee?.foulsPerGame != null
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy text-navy-foreground">
          <Gavel className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Referee</p>
          <p className="truncate text-base font-bold text-foreground">{referee?.name ?? "To be confirmed"}</p>
        </div>
      </div>
      {referee?.name ? (
        hasStats ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Yellows/game" value={referee.yellowsPerGame} yellow />
            <Stat label="Fouls/game" value={referee.foulsPerGame} />
            <Stat label="Matches" value={referee.matchesRefereed} integer />
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground">
            Not enough historical data for this referee
          </p>
        )
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  yellow,
  integer,
}: {
  label: string
  value: number | null
  yellow?: boolean
  integer?: boolean
}) {
  return (
    <div className="rounded-xl bg-secondary px-2 py-2 text-center">
      <div className="flex items-center justify-center gap-1">
        {yellow ? <span className="inline-block size-2.5 rounded-[3px] bg-card-yellow" /> : null}
        <span className="font-mono text-lg font-bold tabular-nums text-foreground">
          {value == null ? "--" : integer ? value : value.toFixed(2)}
        </span>
      </div>
      <p className="mt-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  )
}
