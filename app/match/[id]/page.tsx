"use client"

import { use, useState } from "react"
import useSWR from "swr"
import { AppHeader } from "@/components/app-header"
import { CandidateCard } from "@/components/candidate-card"
import { LineupsPanel } from "@/components/lineups-panel"
import { PlayerDetailDrawer } from "@/components/player-detail-drawer"
import { RefereePanel } from "@/components/referee-panel"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fetcher } from "@/lib/fetcher"
import { londonKickoff } from "@/lib/date"
import type {
  Candidate,
  Fixture,
  LineupsResponse,
  RecommendationsResponse,
} from "@/lib/types"
import { Shield, Swords } from "lucide-react"

interface MatchResponse {
  connected: boolean
  match: Fixture | null
  updatedAt: string
}

export default function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [selected, setSelected] = useState<Candidate | null>(null)

  const {
    data: matchResponse,
    isLoading: matchLoading,
  } = useSWR<MatchResponse>(`/api/match/${id}`, fetcher, {
    refreshInterval: 60_000,
  })

  const {
    data: lineups,
    isLoading: lineupsLoading,
    isValidating: lineupsSyncing,
    mutate: mutateLineups,
  } = useSWR<LineupsResponse>(`/api/lineups/${id}`, fetcher, {
    refreshInterval: 120_000,
  })

  const {
    data: recommendations,
    isLoading: recLoading,
    mutate: mutateRecommendations,
  } = useSWR<RecommendationsResponse>(`/api/recommendations/${id}`, fetcher, {
    refreshInterval: 60_000,
  })

  const match = matchResponse?.match ?? null

  async function syncLineups() {
    await mutateLineups()
    await mutateRecommendations()
  }

  if (matchLoading) {
    return (
      <main className="mx-auto min-h-screen max-w-lg pb-24">
        <AppHeader title="Football Cards" subtitle="Loading match research…" back={{ href: "/", label: "Today" }} />
        <div className="space-y-3 p-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </main>
    )
  }

  if (!matchResponse?.connected) {
    return (
      <main className="mx-auto min-h-screen max-w-lg pb-24">
        <AppHeader title="Football Cards" subtitle="Match dashboard" back={{ href: "/", label: "Today" }} />
        <div className="p-4">
          <div className="rounded-2xl border border-dashed border-border bg-card p-5">
            <h2 className="font-bold text-foreground">Live data source not connected</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Add the <span className="font-mono font-semibold">API_FOOTBALL_KEY</span> environment variable in Vercel to load this fixture.
            </p>
          </div>
        </div>
      </main>
    )
  }

  if (!match) {
    return (
      <main className="mx-auto min-h-screen max-w-lg pb-24">
        <AppHeader title="Football Cards" subtitle="Match dashboard" back={{ href: "/", label: "Today" }} />
        <div className="p-4 text-sm text-muted-foreground">Match not found.</div>
      </main>
    )
  }

  const cardCandidates = recommendations?.cardCandidates ?? []
  const foulCandidates = recommendations?.foulCandidates ?? []

  return (
    <main className="mx-auto min-h-screen max-w-lg pb-28">
      <AppHeader
        title={`${match.home.name} v ${match.away.name}`}
        subtitle={`${match.competition} · ${londonKickoff(match.kickoff)}${match.venue ? ` · ${match.venue}` : ""}`}
        back={{ href: "/", label: "Today" }}
      />

      <div className="space-y-5 p-4">
        <RefereePanel referee={match.referee} />

        <LineupsPanel
          data={lineups}
          isLoading={lineupsLoading}
          isSyncing={lineupsSyncing}
          onSync={syncLineups}
        />

        <Tabs defaultValue="cards" className="w-full">
          <TabsList className="grid w-full grid-cols-2 rounded-2xl">
            <TabsTrigger value="cards" className="rounded-xl">
              <Shield className="mr-2 size-4" />
              Card Radar
            </TabsTrigger>
            <TabsTrigger value="fouls" className="rounded-xl">
              <Swords className="mr-2 size-4" />
              Foul Radar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cards" className="mt-4 space-y-3">
            <RadarHeader
              title="Top 5 yellow card candidates"
              subtitle="Season cards, foul rate, H2H and referee evidence"
              loading={recLoading}
              empty={!cardCandidates.length}
              historicalAvailable={recommendations?.historicalDataAvailable ?? false}
            />
            {cardCandidates.slice(0, 5).map((candidate, index) => (
              <CandidateCard
                key={`${candidate.playerId}-card`}
                candidate={candidate}
                rank={index + 1}
                onOpen={setSelected}
              />
            ))}
          </TabsContent>

          <TabsContent value="fouls" className="mt-4 space-y-3">
            <RadarHeader
              title="Top 5 foul candidates"
              subtitle="Fouls/90, H2H foul volume and lineup context"
              loading={recLoading}
              empty={!foulCandidates.length}
              historicalAvailable={recommendations?.historicalDataAvailable ?? false}
            />
            {foulCandidates.slice(0, 5).map((candidate, index) => (
              <CandidateCard
                key={`${candidate.playerId}-foul`}
                candidate={candidate}
                rank={index + 1}
                onOpen={setSelected}
              />
            ))}
          </TabsContent>
        </Tabs>

        <p className="rounded-xl bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Research confidence is an evidence-strength score, not the probability of a bet winning.
          Missing historical information is never treated as zero.
        </p>
      </div>

      <PlayerDetailDrawer
        candidate={selected}
        opponent={
          selected
            ? selected.team === match.home.name
              ? match.away.name
              : match.home.name
            : null
        }
        referee={match.referee?.name ?? null}
        onClose={() => setSelected(null)}
      />
    </main>
  )
}

function RadarHeader({
  title,
  subtitle,
  loading,
  empty,
  historicalAvailable,
}: {
  title: string
  subtitle: string
  loading: boolean
  empty: boolean
  historicalAvailable: boolean
}) {
  return (
    <div className="pb-1">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      {loading ? (
        <p className="mt-2 text-sm text-muted-foreground">Calculating recommendations…</p>
      ) : empty ? (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          {historicalAvailable
            ? "No eligible candidates found for the current lineup."
            : "Not enough historical data yet. Use Import to add player, H2H and referee datasets."}
        </div>
      ) : null}
    </div>
  )
}
