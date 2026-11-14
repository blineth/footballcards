"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BadgeCheck, RefreshCw, Sparkles, Trophy, Activity } from "lucide-react"

type Fixture={id:string;competition:string;kickoff:string;home:{name:string};away:{name:string}}
type SlipLeg={
  player:string;dbPlayerName?:string|null;team:string;market:string;label:string;
  probability:number;fairOdds:number|null;bookmakerOdds:number|null;bookmakerName?:string|null;
  edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;priceSource?:"exact"|"estimated"|null
}
type Slip={
  id:string;bookmaker?:string|null;title?:string;targetFractional?:string;
  legs:SlipLeg[];averageLegProbability:number|null
}
type Recommendation={
  id:string;fixture:Fixture;slip:Slip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null
}
type Tracking={
  available:boolean;days:number;gradedLegs:number;hits?:number;hitRate?:number|null;
  avgProbability?:number|null;brier?:number|null;topPickLegs?:number;topPickHits?:number;
  topPickHitRate?:number|null;topPickAvgProbability?:number|null;
  completeSlips?:number;winningSlips?:number;slipHitRate?:number|null;
  topPickSlips?:number;topPickWinningSlips?:number;topPickSlipHitRate?:number|null;
  exactPriceLegs?:number;exactPriceProfitUnits?:number|null;exactPriceROI?:number|null;
  byMarket?:Array<{market:string;sample:number;hits:number;hitRate:number|null;avgProbability:number|null;avgExactOdds:number|null}>
}
type Response={
  ok:boolean;updatedAt?:string;fixturesScanned?:number;recommendations?:Recommendation[];
  tracking?:Tracking;error?:string
}

function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function time(f:Fixture){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(f.kickoff))
}
function avgProbability(slip:Slip){
  if(slip.averageLegProbability!=null)return slip.averageLegProbability
  return slip.legs.length?slip.legs.reduce((s,l)=>s+l.probability,0)/slip.legs.length:0
}

export default function RecommendedPage(){
  const[loading,setLoading]=useState(false)
  const[data,setData]=useState<Response|null>(null)

  const refresh=useCallback(async(force=false)=>{
    setLoading(true)
    try{
      const url="/api/recommended"+(force?"?refresh=1":"")
      const r=await fetch(url,{cache:force?"no-store":"default"})
      setData(r.ok?await r.json() as Response:{ok:false,error:"Recommended scan failed"})
    }catch{
      setData({ok:false,error:"Recommended scan failed"})
    }finally{setLoading(false)}
  },[])

  useEffect(()=>{void refresh(false)},[refresh])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(false),300000);return()=>window.clearInterval(t)},[refresh])

  const recommendations=data?.recommendations??[]
  const best=recommendations[0]??null
  const alternatives=useMemo(()=>recommendations.slice(1),[recommendations])
  const tracking=data?.tracking

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-violet-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Recommended</h1>
            <p className="mt-1 text-xs text-white/45">Today’s strongest model recommendations only.</p>
          </div>
          <button onClick={()=>void refresh(true)} className="rounded-xl bg-violet-300 p-2.5 text-violet-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
        <p className="mt-3 text-[0.58rem] text-white/30">
          Premier League · Championship · League One · International · {data?.fixturesScanned??0} fixtures scanned
          {data?.updatedAt?" · updated "+new Date(data.updatedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):""}
        </p>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {tracking?.available?<TrackingCard tracking={tracking}/>:null}

      {loading&&!best?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-violet-300"/><p className="font-black">Scanning upcoming matches…</p></div>:null}
      {!loading&&!data?.ok?<div className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Recommended scan unavailable</p><p className="mt-1 text-sm text-white/40">{data?.error??"Try a manual refresh."}</p></div>:null}
      {!loading&&data?.ok&&!best?<div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No recommendation ready yet</p><p className="mt-1 text-sm text-white/35">No remaining fixture today currently passes the model/market rules strongly enough.</p></div>:null}

      {best?<RecommendationCard rec={best} hero/>:null}

      {alternatives.length?<section className="space-y-3">
        <div className="px-1"><p className="font-black">Other strong options</p><p className="text-[0.6rem] text-white/35">Ranked below the main pick after market calibration, recommendation-level calibration, price source and lineup certainty.</p></div>
        {alternatives.map(r=><RecommendationCard key={r.id} rec={r}/>)}
      </section>:null}
    </div>
  </main>
}

function TrackingCard({tracking}:{tracking:Tracking}){
  const enough=(tracking.gradedLegs??0)>=20
  return <section className="rounded-3xl border border-emerald-300/10 bg-emerald-400/[0.035] p-4">
    <div className="flex items-start gap-3">
      <Activity className="mt-0.5 size-4 shrink-0 text-emerald-300"/>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-black">Live model accountability</p><span className="text-[0.52rem] text-white/30">last {tracking.days} days</span></div>
        {!enough?<p className="mt-2 text-xs leading-relaxed text-white/45">{tracking.gradedLegs} recommendation legs graded so far. The panel becomes statistically useful as the live sample grows.</p>:<>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Graded legs" value={String(tracking.gradedLegs)}/>
            <Stat label="Hit rate" value={percent(tracking.hitRate)}/>
            <Stat label="Avg model" value={percent(tracking.avgProbability)}/>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Whole-slip hit" value={percent(tracking.slipHitRate)}/>
            <Stat label="Top-pick slip hit" value={percent(tracking.topPickSlipHitRate)}/>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Top-pick leg hit" value={percent(tracking.topPickHitRate)}/>
            <Stat label="Top-pick model" value={percent(tracking.topPickAvgProbability)}/>
          </div>
          {(tracking.exactPriceLegs??0)>=20?<div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Exact-price legs" value={String(tracking.exactPriceLegs??0)}/>
            <Stat label="Exact-price ROI" value={tracking.exactPriceROI==null?"—":((tracking.exactPriceROI>=0?"+":"")+(tracking.exactPriceROI*100).toFixed(1)+"%")}/>
          </div>:null}
        </>}
      </div>
    </div>
  </section>
}

function Stat({label,value}:{label:string;value:string}){
  return <div className="rounded-xl bg-black/20 p-2.5 text-center"><p className="font-mono text-sm font-black">{value}</p><p className="mt-0.5 text-[0.44rem] font-black uppercase text-white/25">{label}</p></div>
}

function RecommendationCard({rec,hero=false}:{rec:Recommendation;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  const legs=rec.slip.legs??[]
  const avg=avgProbability(rec.slip)
  const bookmaker=rec.slip.bookmaker??null
  const title=rec.kind==="foul"?"Foul builder "+(rec.slip.targetFractional??""):(rec.slip.title??rec.slip.id)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-violet-300/25 bg-gradient-to-br from-violet-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+(rec.confirmed?"bg-emerald-400 text-emerald-950":"bg-amber-300 text-amber-950")}>{rec.confirmed?"CONFIRMED XI":"PROVISIONAL"}</span>
            {hero?<span className="rounded-full bg-violet-300 px-2 py-1 text-[0.5rem] font-black text-violet-950">TOP PICK</span>:null}
          </div>
          <p className="mt-2 text-[0.58rem] font-black uppercase text-white/30">{rec.fixture.competition} · {time(rec.fixture)}</p>
          <h2 className="mt-1 text-lg font-black">{rec.fixture.home.name} <span className="text-white/25">v</span> {rec.fixture.away.name}</h2>
          <p className="mt-2 text-sm font-black">{title}</p>
          {bookmaker?<p className="mt-1 text-[0.58rem] font-black text-violet-300">{bookmaker}</p>:null}
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-black">{percent(avg)}</p>
          <p className="text-[0.44rem] uppercase text-white/30">avg leg model</p>
          {rec.recommendationReliability!=null?<><p className="mt-1 font-mono text-sm font-black text-emerald-300">{percent(rec.recommendationReliability)}</p><p className="text-[0.4rem] uppercase text-white/25">historical reliability</p></>:null}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-black/20 p-3">
        <div className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-violet-300"/><p className="text-[0.67rem] leading-relaxed text-white/55">{rec.kind==="foul"?"The strongest same-bookmaker foul builder after exact/estimated price quality, calibrated hit probability, weakest-leg strength and lineup certainty.":"The strongest current slip profile after market calibration, recommendation-level historical calibration, price quality, confidence and lineup certainty."}</p></div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[0.6rem] text-white/40">{legs.length} legs</p>
        {rec.placeable?<span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[0.54rem] font-black text-emerald-300"><BadgeCheck className="size-3"/>MARKETS VERIFIED</span>:<span className="flex items-center gap-1 rounded-full bg-amber-300/10 px-2.5 py-1 text-[0.54rem] font-black text-amber-200"><AlertTriangle className="size-3"/>CHECK MARKET</span>}
      </div>
      {rec.blockedReason?<p className="mt-2 rounded-xl bg-amber-300/10 px-3 py-2 text-[0.6rem] text-amber-100">{rec.blockedReason}</p>:null}
    </button>

    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{legs.map((leg,i)=><div key={leg.player+"|"+leg.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{leg.player} · {leg.label}</p><p className="mt-0.5 text-[0.56rem] text-white/35">{leg.team} · Grade {leg.confidence}{leg.bookmakerName?" · "+leg.bookmakerName:""}{leg.priceSource==="estimated"?" · ESTIMATED PRICE":""}</p></div><p className="font-mono text-base font-black">{percent(leg.probability)}</p></div>
      <p className="mt-2 text-[0.62rem] leading-relaxed text-white/45">{leg.reason}</p>
      {leg.bookmakerOdds!=null?<p className="mt-2 text-[0.56rem] text-white/35">{leg.priceSource==="estimated"?"Likely":"Bookmaker"} price: <span className="font-mono font-black text-white/70">{leg.bookmakerOdds.toFixed(2)}</span></p>:null}
    </div>)}</div></div>:null}
  </article>
}
