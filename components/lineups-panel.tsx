"use client"

import { ConnectionNotice } from "@/components/connection-notice"
import { Skeleton } from "@/components/ui/skeleton"
import type { LineupsResponse, TeamLineup } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CheckCircle2, Clock, RefreshCw } from "lucide-react"

export function LineupsPanel({
  data,
  isLoading,
  isSyncing,
  onSync,
}: {
  data: LineupsResponse | undefined
  isLoading: boolean
  isSyncing: boolean
  onSync: () => void
}) {
  const status = data?.status ?? "unavailable"
  const confirmed = status === "confirmed"

  return (
    <section aria-label="Lineups" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {confirmed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-strong/12 px-3 py-1 text-sm font-bold text-strong">
              <CheckCircle2 className="size-4" />
              Confirmed XI
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-foreground">
              <Clock className="size-4" />
              Expected XI
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-2 rounded-full bg-navy px-4 py-2 text-sm font-bold text-navy-foreground transition-transform active:scale-95 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-4", isSyncing && "animate-spin")} />
          Sync Lineups
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : !data ? null : !data.connected ? (
        <ConnectionNotice
          variant="live"
          message="Lineup data is requested from the server, but the live data source is not connected."
          nextStep="Add the API_FOOTBALL_KEY environment variable to load lineups."
        />
      ) : !data.home && !data.away ? (
        <ConnectionNotice
          variant="generic"
          message="Official starting lineups have not been published yet. They are usually confirmed about an hour before kick-off. Press Sync Lineups to check for updates."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.home ? <TeamLineupCard lineup={data.home} /> : null}
          {data.away ? <TeamLineupCard lineup={data.away} /> : null}
        </div>
      )}
    </section>
  )
}

function TeamLineupCard({ lineup }: { lineup: TeamLineup }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 truncate text-sm font-bold text-foreground">{lineup.team.name}</h3>
      <ul className="space-y-1">
        {lineup.startingXI.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-xs font-bold text-secondary-foreground">
              {p.number ?? "-"}
            </span>
            <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
            {p.position ? (
              <span className="ml-auto text-[0.65rem] font-semibold uppercase text-muted-foreground">
                {p.position}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
