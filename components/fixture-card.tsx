import { londonKickoff } from "@/lib/date"
import type { Fixture } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ChevronRight, ClipboardList, Gavel } from "lucide-react"
import Link from "next/link"

function StatusPill({ status }: { status: Fixture["status"] }) {
  const map: Record<Fixture["status"], { label: string; className: string }> = {
    scheduled: { label: "Scheduled", className: "bg-secondary text-secondary-foreground" },
    live: { label: "Live", className: "bg-destructive/10 text-destructive" },
    halftime: { label: "Half-time", className: "bg-destructive/10 text-destructive" },
    finished: { label: "Full-time", className: "bg-muted text-muted-foreground" },
    postponed: { label: "Postponed", className: "bg-muted text-muted-foreground" },
    unknown: { label: "TBC", className: "bg-muted text-muted-foreground" },
  }
  const { label, className } = map[status]
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide", className)}>
      {label}
    </span>
  )
}

function LineupPill({ status }: { status: Fixture["lineupStatus"] }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-strong/12 px-2 py-0.5 text-[0.65rem] font-semibold text-strong">
        Confirmed XI
      </span>
    )
  }
  if (status === "expected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-semibold text-accent-foreground">
        Expected XI
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
      Lineups TBC
    </span>
  )
}

export function FixtureCard({ fixture }: { fixture: Fixture }) {
  return (
    <Link
      href={`/match/${fixture.id}`}
      className="group block rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill status={fixture.status} />
          <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
            {fixture.competition}
          </span>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {londonKickoff(fixture.kickoff)}
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <TeamRow name={fixture.home.name} />
        <TeamRow name={fixture.away.name} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <LineupPill status={fixture.lineupStatus} />
        {fixture.referee?.name ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[0.65rem] font-medium text-secondary-foreground">
            <Gavel className="size-3" />
            {fixture.referee.name}
            {fixture.referee.yellowsPerGame !== null ? (
              <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-foreground">
                <span className="inline-block size-2 rounded-[2px] bg-card-yellow" />
                {fixture.referee.yellowsPerGame.toFixed(2)}/g
              </span>
            ) : null}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
            <Gavel className="size-3" />
            Referee TBC
          </span>
        )}
        <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </Link>
  )
}

function TeamRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-[0.7rem] font-bold text-secondary-foreground">
        {name.slice(0, 3).toUpperCase()}
      </span>
      <span className="truncate text-base font-semibold text-foreground">{name}</span>
    </div>
  )
}

export function FixtureCardMeta() {
  return <ClipboardList className="size-4" />
}
