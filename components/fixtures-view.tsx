"use client"

import { ConnectionNotice } from "@/components/connection-notice"
import { FixtureCard } from "@/components/fixture-card"
import { Skeleton } from "@/components/ui/skeleton"
import { londonTime } from "@/lib/date"
import { fetcher } from "@/lib/fetcher"
import type { Competition, FixturesResponse } from "@/lib/types"
import { cn } from "@/lib/utils"
import { RefreshCw } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import useSWR from "swr"

type FilterKey = "all" | "premier-league" | "championship"

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "premier-league", label: "Premier League" },
  { key: "championship", label: "Championship" },
]

const leagueFromFilter: Record<Exclude<FilterKey, "all">, Competition> = {
  "premier-league": "Premier League",
  championship: "Championship",
}

export function FixturesView() {
  const searchParams = useSearchParams()
  const leagueParam = (searchParams.get("league") as FilterKey) ?? "all"
  const active: FilterKey = filters.some((f) => f.key === leagueParam) ? leagueParam : "all"

  const { data, isLoading, mutate, isValidating } = useSWR<FixturesResponse>("/api/fixtures", fetcher, {
    refreshInterval: 60_000, // today's fixtures refresh automatically
    revalidateOnFocus: true,
  })

  const shown = useMemo<Competition[]>(() => {
    if (active === "all") return ["Premier League", "Championship"]
    return [leagueFromFilter[active]]
  }, [active])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <FilterTabs active={active} />
        <button
          type="button"
          onClick={() => mutate()}
          className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Refresh fixtures"
        >
          <RefreshCw className={cn("size-4", isValidating && "animate-spin")} />
        </button>
      </div>

      {data ? (
        <p className="px-1 text-xs text-muted-foreground">
          {data.connected ? "Live" : "Not connected"} &middot; Last updated {londonTime(data.updatedAt)}
        </p>
      ) : null}

      {isLoading ? (
        <LoadingState />
      ) : !data ? null : !data.connected ? (
        <ConnectionNotice
          variant="live"
          message="Today's fixtures are requested from the server, but no live football data source is configured yet, so nothing can be shown. No fixtures are invented."
          nextStep="Add the API_FOOTBALL_KEY environment variable in Project Settings to load live Premier League and Championship fixtures."
        />
      ) : (
        <div className="space-y-6">
          {shown.map((league) => {
            const fixtures = data.leagues[league]
            return (
              <section key={league} aria-labelledby={`league-${league}`} className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 id={`league-${league}`} className="text-sm font-bold uppercase tracking-wide text-foreground">
                    {league}
                  </h2>
                  <span className="text-xs font-medium text-muted-foreground">
                    {fixtures.length} {fixtures.length === 1 ? "game" : "games"}
                  </span>
                </div>
                {fixtures.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    No games today
                  </p>
                ) : (
                  <div className="space-y-3">
                    {fixtures.map((f) => (
                      <FixtureCard key={f.id} fixture={f} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterTabs({ active }: { active: FilterKey }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
      {filters.map((f) => {
        const href = f.key === "all" ? "/" : `/?league=${f.key}`
        const isActive = active === f.key
        return (
          <a
            key={f.key}
            href={href}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              isActive ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </a>
        )
      })}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full rounded-2xl" />
      ))}
    </div>
  )
}
