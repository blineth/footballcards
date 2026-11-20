"use client"

import { use, useEffect, useMemo, useState } from "react"
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
    refreshInterval: (latest) => latest?.status === "confirmed" ? 120_000 : 30_000,
    revalidateOnFocus: true,
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
        <Bet365SlipBuilder match={match} />

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

type PricedSelection = { market:string; kind:string; label:string; odd:number|null; bookmaker?:string|null }
type SlipLeg = PricedSelection & { fixtureId:string; fixtureLabel:string; source:string; addedAt:number }
const SLIP_KEY="footballcards-bet365-slip-v1"

function Bet365SlipBuilder({match}:{match:Fixture}){
  const [board,setBoard]=useState<PricedSelection[]>([])
  const [source,setSource]=useState("")
  const [notice,setNotice]=useState("")
  const [loading,setLoading]=useState(true)
  const [slip,setSlip]=useState<SlipLeg[]>([])
  const [stake,setStake]=useState("10")
  const [search,setSearch]=useState("")
  const [ready,setReady]=useState(false)
  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(SLIP_KEY)||"[]")
      if(Array.isArray(saved))setSlip(saved.filter((v:SlipLeg)=>v&&typeof v.fixtureId==="string"&&Number.isFinite(v.odd)&&Number(v.odd)>1))
    }catch{}
    setReady(true)
  },[])
  useEffect(()=>{if(ready)localStorage.setItem(SLIP_KEY,JSON.stringify(slip))},[slip,ready])
  useEffect(()=>{
    const controller=new AbortController()
    const date=match.kickoff.slice(0,10)
    const query=new URLSearchParams({date,home:match.home.name,away:match.away.name,competition:match.competition})
    setLoading(true)
    fetch("/api/bet-builder-odds?"+query,{signal:controller.signal,cache:"no-store"})
      .then(async r=>{if(!r.ok)throw Error("Odds feed unavailable");return r.json()})
      .then(data=>{
        const valid=(Array.isArray(data.selections)?data.selections:[]).filter((v:PricedSelection)=>Number.isFinite(Number(v.odd))&&Number(v.odd)>1&&(!v.bookmaker||v.bookmaker.toLowerCase()==="bet365"))
        setBoard(valid)
        setSource(String(data.source||""))
        setNotice(String(data.note||""))
      })
      .catch(e=>{if(!controller.signal.aborted){setBoard([]);setNotice(String(e.message||"Unable to load prices"))}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[match.id,match.kickoff,match.home.name,match.away.name,match.competition])
  const visible=useMemo(()=>board.filter(v=>(v.market+" "+v.label).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(1/Number(b.odd))-(1/Number(a.odd))).slice(0,80),[board,search])
  const fixtures=new Set(slip.map(v=>v.fixtureId))
  const sameMatchMultiple=slip.length>1&&fixtures.size<slip.length
  const total=slip.reduce((n,v)=>n*Number(v.odd),1)
  const multiMatchOnly=slip.length>0&&!sameMatchMultiple
  const toggle=(v:PricedSelection)=>{
    const key=match.id+"|"+v.market+"|"+v.label
    setSlip(current=>current.some(x=>x.fixtureId+"|"+x.market+"|"+x.label===key)
      ?current.filter(x=>x.fixtureId+"|"+x.market+"|"+x.label!==key)
      :[...current,{...v,fixtureId:match.id,fixtureLabel:match.home.name+" v "+match.away.name,source,addedAt:Date.now()}])
  }
  return <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
    <div><h2 className="text-lg font-bold">Bet365 market builder</h2><p className="text-xs text-muted-foreground">Real selections from the existing odds feed, ordered by bookmaker-implied likelihood (shortest odds first). This is not our statistical prediction; bookmaker margin is included. Prices are snapshots, not guaranteed.</p></div>
    <p className="text-sm">{loading?"Loading Bet365 markets…":board.length+" priced selections"+(source?" · "+source:"")}</p>
    {notice&&<p className="text-xs text-muted-foreground">{notice}</p>}
    <input className="w-full rounded-xl border border-border bg-background p-3 text-sm" placeholder="Search player or market" value={search} onChange={e=>setSearch(e.target.value)}/>
    <div className="max-h-72 space-y-2 overflow-y-auto">
      {visible.map((v,i)=>{
        const selected=slip.some(x=>x.fixtureId===match.id&&x.market===v.market&&x.label===v.label)
        return <button key={v.market+"|"+v.label+"|"+i} type="button" onClick={()=>toggle(v)} className={"flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm "+(selected?"border-primary bg-secondary":"border-border")}>
          <span><span className="block font-semibold">{v.label}</span><span className="block text-xs text-muted-foreground">{v.market}</span></span>
          <span className="shrink-0 font-bold">{Number(v.odd).toFixed(2)} {selected?"✓":"+"}</span>
        </button>
      })}
      {!loading&&!visible.length&&<p className="text-sm text-muted-foreground">No matching priced markets returned for this fixture.</p>}
    </div>
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between"><h3 className="font-bold">Your slip · {slip.length} legs</h3><button type="button" className="text-xs underline" onClick={()=>setSlip([])}>Clear</button></div>
      {slip.map((leg,i)=><div key={leg.fixtureId+"|"+leg.market+"|"+leg.label+"|"+i} className="flex items-start justify-between gap-2 text-xs"><span>{leg.fixtureLabel} · {leg.label} ({leg.market})</span><button type="button" className="shrink-0 underline" onClick={()=>setSlip(cur=>cur.filter((_,j)=>j!==i))}>{Number(leg.odd).toFixed(2)} ×</button></div>)}
      <label className="flex items-center justify-between gap-2 text-sm">Stake (£)<input type="number" min="0" step="0.5" value={stake} onChange={e=>setStake(e.target.value)} className="w-24 rounded-lg border border-border bg-background p-2 text-right"/></label>
      <p className="text-sm">Individual odds product: <strong>{slip.length?total.toFixed(2):"—"}</strong></p>
      {sameMatchMultiple?<p className="text-xs text-amber-600">Same-match selections detected. The odds product is NOT a verified Bet365 Bet Builder price; combined payout and probability are withheld until correlated pricing is available.</p>:multiMatchOnly?<p className="text-sm">Indicative multi-match return: <strong>£{(Math.max(0,Number(stake)||0)*total).toFixed(2)}</strong></p>:null}
      <p className="text-xs text-muted-foreground">Research confidence is not a win probability. Verified statistical probabilities will appear only when calibrated estimates are available. Recheck bookmaker prices before placing any bet.</p>
    </div>
  </section>
}
