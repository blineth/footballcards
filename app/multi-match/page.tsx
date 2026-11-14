"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, BadgeCheck, Layers3, RefreshCw, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available"|"unavailable"|"unknown"

type Fixture = {
  id:string
  date:string
  kickoff:string
  competition:Competition
  home:string
  away:string
}

type SlipLeg = {
  player:string
  team:string
  market:string
  label:string
  probability:number
  fairOdds:number|null
  bookmakerOdds:number|null
  edge:number|null
  confidence:"A"|"B"|"C"|"D"
  reason:string
}

type BetSlip = {id:string;title:string;legs:SlipLeg[]}
type FoulTargetSlip = {id:string;legs:SlipLeg[]}

type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}
  slips?:BetSlip[]
  foulTargetSlips?:FoulTargetSlip[]
  error?:string
}

type Result = {
  fixture:Fixture
  scorecard:Scorecard|null
}

type MultiLeg = SlipLeg & {match:string;competition:Competition}
type MultiSlip = {
  id:string
  title:string
  subtitle:string
  legs:MultiLeg[]
  combinedOdds:number|null
  modelAllHit:number|null
}

function parseGames():Fixture[]{
  if(typeof window==="undefined")return []
  const raw=new URLSearchParams(window.location.search).get("games")
  if(!raw)return []
  try{
    const parsed=JSON.parse(decodeURIComponent(raw))
    return Array.isArray(parsed)?parsed.filter((x:any)=>x?.id&&x?.date&&x?.competition&&x?.home&&x?.away):[]
  }catch{return []}
}
function percent(v:number|null|undefined){return v==null?"—":Math.round(Number(v)*100)+"%"}
function time(kickoff:string){
  if(!kickoff)return ""
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff))
}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({
    date:f.date,
    home:f.home,
    away:f.away,
    competition:f.competition,
    refresh:String(Date.now()),
  })
}
function key(l:SlipLeg){return l.player+"|"+l.market}
function uniqueLegs(s:Scorecard|null){
  const map=new Map<string,SlipLeg>()
  for(const slip of s?.slips??[])for(const leg of slip.legs){
    const k=key(leg)
    const current=map.get(k)
    if(!current||leg.probability>current.probability)map.set(k,leg)
  }
  return [...map.values()]
}
function bestCard(s:Scorecard|null){
  return uniqueLegs(s).filter(l=>l.market==="card").sort((a,b)=>b.probability-a.probability)[0]??null
}
function bestFoul(s:Scorecard|null){
  const target=(s?.foulTargetSlips??[]).find(x=>x.id==="foul-3-1")
  return [...(target?.legs??[])].sort((a,b)=>b.probability-a.probability)[0]??uniqueLegs(s).filter(l=>l.market==="foul1").sort((a,b)=>b.probability-a.probability)[0]??null
}
function bestOverall(s:Scorecard|null){
  const candidates=[bestCard(s),bestFoul(s)].filter(Boolean) as SlipLeg[]
  return candidates.sort((a,b)=>{
    const qa=a.probability+(a.confidence==="A"?.05:a.confidence==="B"?.03:0)+Math.max(0,Number(a.edge??0))*.2
    const qb=b.probability+(b.confidence==="A"?.05:b.confidence==="B"?.03:0)+Math.max(0,Number(b.edge??0))*.2
    return qb-qa
  })[0]??null
}
function makeSlip(id:string,title:string,subtitle:string,results:Result[],selector:(s:Scorecard|null)=>SlipLeg|null):MultiSlip{
  const legs:MultiLeg[]=[]
  for(const r of results){
    const s=r.scorecard
    const eligible=s?.marketAvailability?.card==="available"&&s?.marketAvailability?.foul==="available"
    if(!s?.ok||!s.lineupsConfirmed||!eligible)continue
    const leg=selector(s)
    if(!leg)continue
    legs.push({...leg,match:r.fixture.home+" v "+r.fixture.away,competition:r.fixture.competition})
  }
  const allPriced=legs.length>0&&legs.every(l=>l.bookmakerOdds!=null)
  const combinedOdds=allPriced?Math.round(legs.reduce((p,l)=>p*Number(l.bookmakerOdds),1)*100)/100:null
  const modelAllHit=legs.length?legs.reduce((p,l)=>p*l.probability,1):null
  return {id,title,subtitle,legs,combinedOdds,modelAllHit}
}

export default function MultiMatchPage(){
  const router=useRouter()
  const[fixtures,setFixtures]=useState<Fixture[]>([])
  const[results,setResults]=useState<Result[]>([])
  const[loading,setLoading]=useState(true)

  useEffect(()=>{setFixtures(parseGames())},[])

  const load=useCallback(async(games:Fixture[])=>{
    if(!games.length){setLoading(false);return}
    setLoading(true)
    try{
      const rows=await Promise.all(games.map(async fixture=>{
        try{
          const r=await fetch(scorecardUrl(fixture),{cache:"no-store"})
          return {fixture,scorecard:r.ok?await r.json() as Scorecard:null}
        }catch{return {fixture,scorecard:null}}
      }))
      setResults(rows)
    }finally{setLoading(false)}
  },[])

  useEffect(()=>{if(fixtures.length)void load(fixtures)},[fixtures,load])
  useEffect(()=>{if(!fixtures.length)return;const t=window.setInterval(()=>void load(fixtures),60000);return()=>window.clearInterval(t)},[fixtures,load])

  const eligibleResults=useMemo(()=>results.filter(r=>r.scorecard?.marketAvailability?.card==="available"&&r.scorecard?.marketAvailability?.foul==="available"),[results])
  const blockedResults=useMemo(()=>results.filter(r=>r.scorecard&&!(r.scorecard.marketAvailability?.card==="available"&&r.scorecard.marketAvailability?.foul==="available")),[results])
  const confirmedEligible=eligibleResults.filter(r=>r.scorecard?.lineupsConfirmed)

  const slips=useMemo(()=>[
    makeSlip("recommended","Recommended Multi-Match Slip","One strongest card-or-foul angle from every confirmed eligible game.",results,bestOverall),
    makeSlip("cards","One Card Per Game","Strongest yellow-card candidate from each confirmed eligible fixture.",results,bestCard),
    makeSlip("fouls","One Foul Per Game","Strongest 1+ foul candidate from each confirmed eligible fixture.",results,bestFoul),
  ],[results])

  const main=slips[0]

  if(!fixtures.length&&!loading){
    return <main className="min-h-screen bg-[#07120e] px-4 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><p className="font-black">Select games from Matches</p><p className="mt-2 text-sm text-white/40">Multi Match is now created from the Matches screen. Only fixtures with both player cards and fouls verified can be selected.</p><button onClick={()=>router.push("/")} className="mt-5 rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-black text-sky-950">Back to Matches</button></div></main>
  }

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button onClick={()=>router.push("/")} className="rounded-xl bg-white/7 p-2.5 text-white/70"><ArrowLeft className="size-4"/></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sky-300"><Layers3 className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.15em]">Multi Match</span></div><h1 className="mt-1 text-xl font-black">{fixtures.length} selected games</h1><p className="mt-0.5 text-[0.58rem] text-white/35">Automatically building one cross-match recommendation.</p></div>
          <button onClick={()=>void load(fixtures)} className="rounded-xl bg-sky-300 p-2.5 text-sky-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between"><div><p className="text-sm font-black">Selected matches</p><p className="mt-0.5 text-[0.58rem] text-white/35">Every game is re-checked before it can contribute a leg.</p></div><span className="rounded-full bg-white/7 px-2 py-1 text-[0.5rem] font-black text-white/45">{confirmedEligible.length}/{fixtures.length} XI confirmed</span></div>
        <div className="mt-3 space-y-2">{fixtures.map(f=>{
          const r=results.find(x=>x.fixture.id===f.id)
          const s=r?.scorecard
          const eligible=s?.marketAvailability?.card==="available"&&s?.marketAvailability?.foul==="available"
          return <div key={f.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-3"><div className="min-w-0"><p className="truncate text-sm font-black">{f.home} v {f.away}</p><p className="mt-0.5 text-[0.54rem] text-white/35">{f.competition} · {time(f.kickoff)}</p></div><div className="text-right">{!s?<span className="text-[0.52rem] text-white/35">checking…</span>:eligible?<span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[0.5rem] font-black text-emerald-300">CARDS + FOULS ✓</span>:<span className="rounded-full bg-rose-400/10 px-2 py-1 text-[0.5rem] font-black text-rose-200">BLOCKED</span>}</div></div>
        })}</div>
      </section>

      {blockedResults.length?<section className="rounded-3xl border border-rose-300/20 bg-rose-400/10 p-4"><p className="font-black">A selected game is no longer eligible</p><p className="mt-1 text-sm text-rose-100/70">It will not be used because both player cards and player fouls are not currently verified as available. Go back to Matches to replace it.</p></section>:null}

      {loading&&!results.length?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-sky-300"/><p className="font-black">Analysing selected matches…</p></section>:null}

      {!loading&&eligibleResults.length&&confirmedEligible.length<eligibleResults.length?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-5"><p className="font-black text-amber-100">Waiting for some confirmed lineups</p><p className="mt-1 text-sm text-amber-100/60">The multi-match recommendation will automatically add each eligible game once its starting XI is confirmed.</p></section>:null}

      {main.legs.length?<MultiSlipCard slip={main} hero/>:null}
      {slips.slice(1).filter(s=>s.legs.length).map(s=><MultiSlipCard key={s.id} slip={s}/>)}

      {!loading&&results.length&&!main.legs.length?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center"><p className="font-black">No final multi-match slip yet</p><p className="mt-1 text-sm text-white/40">The selected games are either waiting for confirmed XIs or no longer meet the card + foul market requirement.</p></section>:null}
    </div>
  </main>
}

function MultiSlipCard({slip,hero=false}:{slip:MultiSlip;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-sky-300/25 bg-gradient-to-br from-sky-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-sky-300"><Sparkles className="size-3.5"/><span className="text-[0.52rem] font-black uppercase tracking-[0.14em]">Recommended</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.58rem] text-white/35">{slip.legs.length} games included</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.combinedOdds?.toFixed(2)??"—"}</p><p className="text-[0.42rem] uppercase text-white/25">{slip.combinedOdds!=null?"combined price":"prices incomplete"}</p></div></div>
      <div className="mt-3 rounded-2xl bg-black/20 p-3"><div className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-300"/><p className="text-[0.64rem] leading-relaxed text-white/50">{slip.id==="recommended"?"Why: the model chooses whichever is stronger — the best yellow-card or 1+ foul angle — from each confirmed eligible match. This keeps the slip focused on the two markets you actually want to bet.":slip.id==="cards"?"Why: one strongest booking candidate from every confirmed eligible game.":"Why: one strongest 1+ foul candidate from every confirmed eligible game."}</p></div></div>
    </button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.match+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><p className="text-[0.52rem] font-black uppercase text-white/30">{l.competition} · {l.match}</p><div className="mt-1 flex items-center justify-between gap-3"><div><p className="text-sm font-black">{l.player} · {l.label}</p><p className="mt-1 text-[0.58rem] text-white/40">{l.reason}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className="text-[0.46rem] text-white/25">{l.bookmakerOdds?.toFixed(2)??"—"} odds</p></div></div></div>)}</div>{slip.modelAllHit!=null?<p className="mt-3 text-[0.54rem] text-white/30">Guide only: multiplying cross-match model probabilities gives {percent(slip.modelAllHit)} if treated as independent.</p>:null}</div>:null}
  </article>
}
