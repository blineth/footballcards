"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Clock3, RefreshCw, ShieldCheck, Sparkles, TicketCheck } from "lucide-react"
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
  bookmakerName?:string|null
  previousBookmakerOdds?:number|null
  bookmakerMovement?:number|null
  edge:number|null
  expectedValue?:number|null
  confidence:"A"|"B"|"C"|"D"
  reason:string
}

type BetSlip = {
  id:string
  title:string
  risk:string
  legs:SlipLeg[]
  averageLegProbability:number|null
  note:string
  placeable?:boolean
  marketAvailability?:Array<{player:string;market:string;status:MarketStatus}>
}

type FoulTargetSlip = {
  id:string
  bookmaker?:string|null
  targetFractional:string
  targetDecimal:number
  legs:SlipLeg[]
  referenceProductOdds:number|null
  averageLegProbability:number|null
  minimumLegProbability:number|null
  note:string
  placeable?:boolean
  marketStatus?:MarketStatus
}

type ExactFoulOffer = {
  player:string
  team:string
  position?:string|null
  threshold:number
  label:string
  bookmakerMarket:string
  bookmakerLabel:string
  bookmakerOdds:number
  bookmaker:string
  probability:number
  fairOdds:number|null
  edge:number
  expectedValue:number
  confidence:"A"|"B"|"C"|"D"
  priceSource?:"exact"|"estimated"
}

type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  snapshotFallback?:boolean
  fallbackReason?:string|null
  bookmaker?:string|null
  oddsFreshness?:"LIVE"|"SLIGHTLY STALE"|"CACHED"|"STALE"|"UNKNOWN"
  playerCount?:number
  referee?:{name?:string;yellowsPerGame?:number|null}|null
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}
  bookmakerAvailability?:Record<string,{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}>
  eligibleBooks?:string[]
  slips?:BetSlip[]
  exactFoulOffers?:ExactFoulOffer[]
  estimatedFoulOffers?:ExactFoulOffer[]
  foulTargetSlips?:FoulTargetSlip[]
  error?:string
}

function percent(v:number|null|undefined){return v==null?"—":Math.round(Number(v)*100)+"%"}
function edgeText(v:number|null|undefined){return v==null?"—":(Number(v)>=0?"+":"")+(Number(v)*100).toFixed(1)+"pp"}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({
    date:f.date,
    home:f.home,
    away:f.away,
    competition:f.competition,
    refresh:String(Date.now()),
  })
}
function parseFixture():Fixture|null{
  if(typeof window==="undefined")return null
  const p=new URLSearchParams(window.location.search)
  const id=p.get("id")??""
  const date=p.get("date")??""
  const kickoff=p.get("kickoff")??""
  const competition=(p.get("competition")??"") as Competition
  const home=p.get("home")??""
  const away=p.get("away")??""
  if(!id||!date||!competition||!home||!away)return null
  return {id,date,kickoff,competition,home,away}
}
function time(kickoff:string){
  if(!kickoff)return ""
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff))
}
function slipWhy(slip:BetSlip){
  if(slip.id==="main-safe")return "The model's strongest simple angles in this match, favouring high calibrated hit rates and avoiding too much exposure to one player."
  if(slip.id==="two-cards")return "The two strongest booking candidates after card history, foul volume, repeated-foul booking behaviour, direct matchup and referee context."
  if(slip.id==="three-cards")return "A higher-return card version using the next strongest booking candidate as well."
  if(slip.id==="yellow-foul")return "Built around players whose booking rate rises when their foul involvement increases."
  return "A volume-led mix of fouls, shots and shots on target from the confirmed XI."
}

export default function BetBuilderPage(){
  const router=useRouter()
  const[fixture,setFixture]=useState<Fixture|null>(null)
  const[data,setData]=useState<Scorecard|null>(null)
  const[loading,setLoading]=useState(true)

  useEffect(()=>{setFixture(parseFixture())},[])

  const load=useCallback(async(f:Fixture)=>{
    setLoading(true)
    try{
      const r=await fetch(scorecardUrl(f),{cache:"no-store"})
      const payload=await r.json().catch(()=>({ok:false,error:"Unable to load the player scorecard."}))
      setData(payload as Scorecard)
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{if(fixture)void load(fixture)},[fixture,load])
  useEffect(()=>{if(!fixture)return;const t=window.setInterval(()=>void load(fixture),60000);return()=>window.clearInterval(t)},[fixture,load])

  if(!fixture){
    return <main className="min-h-screen bg-[#07120e] px-4 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><p className="font-black">Choose a game from Matches</p><p className="mt-2 text-sm text-white/40">Bet slips are now created directly from the match card so you never have to select the fixture twice.</p><button onClick={()=>router.push("/")} className="mt-5 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-emerald-950">Back to Matches</button></div></main>
  }

  const card=data?.marketAvailability?.card
  const foul=data?.marketAvailability?.foul
  const eligibleBooks=data?.eligibleBooks??[]
  const eligible=eligibleBooks.length>0
  const unavailable=(card==="unavailable"||foul==="unavailable")&&eligibleBooks.length===0
  const verified=Boolean(data?.bookmakerAvailability)&&Object.keys(data?.bookmakerAvailability??{}).length>0
  const snapshotFallback=Boolean(data?.snapshotFallback)

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button onClick={()=>router.push("/")} className="rounded-xl bg-white/7 p-2.5 text-white/70"><ArrowLeft className="size-4"/></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-emerald-300"><TicketCheck className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.15em]">Bet Builder</span></div><h1 className="mt-1 truncate text-xl font-black">{fixture.home} <span className="text-white/25">v</span> {fixture.away}</h1><p className="mt-0.5 text-[0.58rem] text-white/35">{fixture.competition} · {time(fixture.kickoff)}</p></div>
          <button onClick={()=>void load(fixture)} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Checking Bet365 markets and model…</p></section>:null}

      {data?.ok?<MarketGate data={data}/>:null}

      {data?.ok&&!snapshotFallback&&verified&&!eligible?<section className="rounded-3xl border border-rose-300/20 bg-rose-400/10 p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-rose-200"/><div><p className="font-black">No bet slip for this match</p><p className="mt-1 text-sm leading-relaxed text-rose-100/75">{unavailable?"Bet365 does not offer both player yellow cards and player fouls for this fixture, so this match is blocked from the betting workflow.":"Both player-card and player-foul markets must be verified before a slip can be created."}</p></div></div>
      </section>:null}

      {data?.ok&&!snapshotFallback&&!verified?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-5"><p className="font-black text-amber-100">Market availability not verified</p><p className="mt-1 text-sm text-amber-100/60">This match remains locked until both Bet365 player cards and player fouls are verified as available.</p></section>:null}

      {data?.ok&&!snapshotFallback&&eligible&&!data.lineupsConfirmed?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-6 text-center"><Clock3 className="mx-auto size-6 text-amber-300"/><p className="mt-3 font-black">Markets are eligible — waiting for confirmed lineups</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">Both player cards and fouls are available together at {eligibleBooks.join(", ")}. Final recommendations will appear automatically when the starting XIs are confirmed.</p></section>:null}

      {data?.ok&&snapshotFallback&&!data.lineupsConfirmed?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-6 text-center"><Clock3 className="mx-auto size-6 text-amber-300"/><p className="mt-3 font-black">Waiting for confirmed lineups</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">The live research database is unavailable, so the snapshot fallback is armed but will not create any player slip until both official starting XIs are confirmed.</p></section>:null}

      {data?.ok&&snapshotFallback&&data.lineupsConfirmed?<>
        <section className="rounded-3xl border border-violet-300/15 bg-violet-400/[0.05] p-4"><p className="font-black text-violet-200">Confirmed-XI snapshot fallback</p><p className="mt-1 text-xs leading-relaxed text-white/45">{data.fallbackReason??"Using the checked-in player snapshot because live research data is temporarily unavailable."} These are model-only picks, so verify the bookmaker market and price before placing.</p></section>
        <section className="space-y-3">
          <div className="px-1"><p className="font-black">Model-only confirmed XI slips</p><p className="text-[0.6rem] text-white/35">Only confirmed starters are eligible. No provisional or bench players are allowed.</p></div>
          {(data.slips??[]).map(slip=><StandardSlip key={slip.id} slip={slip}/>)}
          {!(data.slips??[]).length?<div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">Confirmed lineups are loaded, but the snapshot does not have enough qualifying player history to build a slip.</div>:null}
        </section>
      </>:null}

      {data?.ok&&!snapshotFallback&&eligible&&data.lineupsConfirmed?<>
        <ExactFoulOffers offers={data.exactFoulOffers??[]}/>
        <EstimatedFoulOffers offers={data.estimatedFoulOffers??[]}/>
        <FoulLadder slips={data.foulTargetSlips??[]}/>
        <section className="space-y-3">
          <div className="px-1"><p className="font-black">Recommended slips</p><p className="text-[0.6rem] text-white/35">Built only from a fixture where both player-card and foul markets are available.</p></div>
          {(data.slips??[]).map(slip=><StandardSlip key={slip.id} slip={slip}/>)}
        </section>
      </>:null}

      {data&&!data.ok?<section className="rounded-3xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">{data.error??"Unable to build this match."}</section>:null}
    </div>
  </main>
}

function MarketGate({data}:{data:Scorecard}){
  const card=data.marketAvailability?.card??"unknown"
  const foul=data.marketAvailability?.foul??"unknown"
  const chip=(label:string,status:MarketStatus)=>({label,cls:status==="available"?"bg-emerald-400/15 text-emerald-300":status==="unavailable"?"bg-rose-400/15 text-rose-200":"bg-amber-300/10 text-amber-200",text:status==="available"?"Available":status==="unavailable"?"Unavailable":"Not verified"})
  const c=chip("Player cards",card),f=chip("Player fouls",foul)
  return <section className="rounded-3xl border border-white/10 bg-white/[0.045] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">Preferred bookmaker market check</p><p className="mt-1 text-[0.58rem] text-white/35">Bet365 · Sky Bet · William Hill · Paddy Power</p><p className="mt-1 text-[0.52rem] text-white/25">{data.lineupsConfirmed?"Confirmed XI loaded":"Pre-lineup market eligibility"}</p></div><span className="rounded-full bg-white/7 px-2 py-1 text-[0.5rem] font-black text-white/45">{data.oddsFreshness??"UNKNOWN"}</span></div><div className="mt-3 grid grid-cols-2 gap-2">{[c,f].map(x=><div key={x.label} className={"rounded-2xl p-3 "+x.cls}><p className="text-[0.55rem] font-black uppercase opacity-70">{x.label}</p><p className="mt-1 text-sm font-black">{x.text}</p></div>)}</div></section>
}

function ExactFoulOffers({offers}:{offers:ExactFoulOffer[]}){
  const top=[...offers].sort((a,b)=>(b.edge-a.edge)||(b.probability-a.probability)).slice(0,30)
  return <section className="space-y-3">
    <div className="px-1"><p className="font-black">Exact foul offers</p><p className="text-[0.6rem] text-white/35">Only exact thresholds returned by Bet365, Sky Bet, William Hill or Paddy Power are shown. Our probability and fair odds are calculated against that exact line.</p></div>
    {top.length?<div className="space-y-2">{top.map((o,i)=><div key={o.player+"|"+o.threshold+"|"+o.bookmaker+"|"+i} className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black">{o.player} · {o.label}</p><p className="mt-0.5 text-[0.56rem] text-white/35">{o.team} · {o.bookmaker}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{o.bookmakerOdds.toFixed(2)}</p><p className="text-[0.45rem] uppercase text-white/25">book price</p></div></div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center"><Metric label="Model" value={percent(o.probability)}/><Metric label="Fair" value={o.fairOdds?.toFixed(2)??"—"}/><Metric label="Edge" value={edgeText(o.edge)} good={o.edge>0}/></div>
    </div>)}</div>:<div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">No exact player-foul thresholds were returned by the current UK bookmaker feed.</div>}
  </section>
}

function EstimatedFoulOffers({offers}:{offers:ExactFoulOffer[]}){
  const top=[...offers].sort((a,b)=>(b.probability-a.probability)||(b.edge-a.edge)).slice(0,20)
  if(!top.length)return null
  return <section className="space-y-3">
    <div className="px-1"><p className="font-black">Likely bookmaker prices</p><p className="text-[0.6rem] text-white/35">Estimated only when the bookmaker's foul market is verified but that exact threshold price is missing. Anchored to that bookmaker's observed margin on the player's other foul lines.</p></div>
    <div className="space-y-2">{top.map((o,i)=><div key={o.player+"|"+o.threshold+"|"+o.bookmaker+"|est|"+i} className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-3">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-sm font-black">{o.player} · {o.label}</p><span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[0.45rem] font-black text-amber-200">ESTIMATED</span></div><p className="mt-0.5 text-[0.56rem] text-white/35">{o.team} · {o.bookmaker}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{o.bookmakerOdds.toFixed(2)}</p><p className="text-[0.45rem] uppercase text-white/25">likely price</p></div></div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center"><Metric label="Model" value={percent(o.probability)}/><Metric label="Fair" value={o.fairOdds?.toFixed(2)??"—"}/><Metric label="Est. edge" value={edgeText(o.edge)} good={o.edge>0}/></div>
    </div>)}</div>
  </section>
}

function FoulLadder({slips}:{slips:FoulTargetSlip[]}){
  return <section className="space-y-3"><div className="px-1"><p className="font-black">Foul odds ladder</p><p className="text-[0.6rem] text-white/35">Uses exact preferred-bookmaker foul lines first, with clearly marked estimated thresholds only when the same bookmaker's foul market is verified.</p></div>{slips.map(s=><FoulCard key={s.id} slip={s}/>)}</section>
}

function FoulCard({slip}:{slip:FoulTargetSlip}){
  const[open,setOpen]=useState(false)
  const ready=slip.legs.length>0
  return <article className="overflow-hidden rounded-3xl border border-emerald-300/15 bg-gradient-to-br from-emerald-500/15 to-black/20">
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.54rem] font-black uppercase tracking-[0.14em] text-emerald-300">FOUL TARGET</p><h3 className="mt-1 text-xl font-black">{slip.targetFractional}</h3>{slip.bookmaker?<p className="mt-1 text-[0.58rem] font-black text-emerald-300">{slip.bookmaker}</p>:null}<p className="mt-1 text-[0.62rem] text-white/45">{ready?slip.legs.length+" exact bookmaker lines selected":"No qualifying combination"}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.referenceProductOdds?.toFixed(2)??"—"}</p><p className="text-[0.44rem] uppercase text-white/25">reference</p></div></div>
      {ready?<div className="mt-3 flex flex-wrap gap-1.5">{slip.legs.map((l,i)=><span key={l.player+"|"+l.market+"|"+i} className="rounded-full bg-white/7 px-2.5 py-1 text-[0.58rem] font-bold text-white/70">{l.player} · {l.label} · {l.bookmakerName??"book"} · {percent(l.probability)}</span>)}</div>:null}
    </button>
    {open&&ready?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><Leg key={l.player+"|"+i} leg={l}/>)}</div><p className="mt-3 text-[0.55rem] leading-relaxed text-white/30">{slip.note}</p></div>:null}
  </article>
}

function StandardSlip({slip}:{slip:BetSlip}){
  const[open,setOpen]=useState(false)
  return <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045]">
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-3.5"/><span className="text-[0.52rem] font-black uppercase">{slip.risk} risk</span></div><h3 className="mt-1 font-black">{slip.title}</h3><p className="mt-1 text-[0.64rem] leading-relaxed text-white/45">{slipWhy(slip)}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{percent(slip.averageLegProbability)}</p><p className="text-[0.42rem] uppercase text-white/25">avg leg</p></div></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><Leg key={l.player+"|"+l.market+"|"+i} leg={l}/>)}</div></div>:null}
  </article>
}

function Leg({leg}:{leg:SlipLeg}){
  return <div className="rounded-2xl bg-white/[0.055] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{leg.player} · {leg.label}</p><p className="mt-0.5 text-[0.56rem] text-white/35">{leg.team} · Grade {leg.confidence}{leg.bookmakerName?" · "+leg.bookmakerName:""}</p></div><p className="font-mono text-base font-black">{percent(leg.probability)}</p></div><p className="mt-2 text-[0.62rem] leading-relaxed text-white/45">{leg.reason}</p><div className="mt-2 grid grid-cols-3 gap-1.5 text-center"><Metric label="Fair" value={leg.fairOdds?.toFixed(2)??"—"}/><Metric label={leg.bookmakerName??"Book"} value={leg.bookmakerOdds?.toFixed(2)??"—"}/><Metric label="Edge" value={edgeText(leg.edge)} good={Number(leg.edge??0)>0}/></div></div>
}

function Metric({label,value,good=false}:{label:string;value:string;good?:boolean}){
  return <div className="rounded-xl bg-black/20 p-2"><p className={"font-mono text-xs font-black "+(good?"text-emerald-300":"")}>{value}</p><p className="mt-0.5 text-[0.42rem] font-black uppercase text-white/25">{label}</p></div>
}
