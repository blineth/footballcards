"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, BarChart3, RefreshCw, ShieldCheck, TrendingUp } from "lucide-react"

type MarketRow={
  market:string;sample:number;hits:number;hitRate:number|null;avgProbability:number|null;avgExactOdds:number|null
}
type Tracking={
  available:boolean;days:number;gradedLegs:number;hits?:number;hitRate?:number|null;
  avgProbability?:number|null;brier?:number|null;topPickLegs?:number;topPickHits?:number;
  topPickHitRate?:number|null;topPickAvgProbability?:number|null;
  completeSlips?:number;winningSlips?:number;slipHitRate?:number|null;
  topPickSlips?:number;topPickWinningSlips?:number;topPickSlipHitRate?:number|null;
  exactPriceLegs?:number;exactPriceProfitUnits?:number|null;exactPriceROI?:number|null;
  byMarket?:MarketRow[]
}
type Response={ok:boolean;tracking?:Tracking;updatedAt?:string;error?:string}

function pct(v:number|null|undefined,digits=0){
  if(v==null||!Number.isFinite(v))return "—"
  return (v*100).toFixed(digits)+"%"
}
function marketName(v:string){
  const names:Record<string,string>={
    card:"Yellow card",foul1:"1+ foul",foul2:"2+ fouls",foul3:"3+ fouls",foul4:"4+ fouls",foul5:"5+ fouls",
    fouled1:"1+ foul drawn",shot1:"1+ shot",shot2:"2+ shots",sot1:"1+ shot on target",sot2:"2+ shots on target"
  }
  return names[v]??v.replaceAll("_"," ")
}

export default function PerformancePage(){
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)

  const load=useCallback(async(force=false)=>{
    setLoading(true)
    try{
      const r=await fetch("/api/recommended"+(force?"?refresh=1":""),{cache:force?"no-store":"default"})
      setData(r.ok?await r.json():{ok:false,error:"Performance data unavailable"})
    }catch{
      setData({ok:false,error:"Performance data unavailable"})
    }finally{setLoading(false)}
  },[])

  useEffect(()=>{void load(false)},[load])
  const t=data?.tracking
  const markets=useMemo(()=>[...(t?.byMarket??[])].sort((a,b)=>(b.sample??0)-(a.sample??0)),[t?.byMarket])
  const enough=(t?.gradedLegs??0)>=20

  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><BarChart3 className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Results & calibration</h1>
            <p className="mt-1 text-xs text-white/45">The model's record stays visible — winners and losers.</p>
          </div>
          <button onClick={()=>void load(true)} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {!data&&!loading?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">Loading performance…</div>:null}
      {loading&&!data?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Loading settled results…</p></div>:null}
      {data&&!data.ok?<div className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Results unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></div>:null}

      {data?.ok&&t?.available?<>
        <section className="rounded-3xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/12 to-black/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div><div className="flex items-center gap-2 text-emerald-300"><ShieldCheck className="size-4"/><p className="text-[0.58rem] font-black uppercase tracking-[0.14em]">Public model record</p></div><h2 className="mt-2 text-xl font-black">Last {t.days} days</h2><p className="mt-1 max-w-xl text-[0.62rem] leading-relaxed text-white/45">This is measured from recommendations the engine actually published. A high model probability is not treated as a win rate unless the settled sample supports it.</p></div>
            <span className="rounded-full bg-white/7 px-2.5 py-1 text-[0.48rem] font-black text-white/40">{t.gradedLegs} GRADED</span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Leg hit rate" value={pct(t.hitRate,1)} sub={(t.hits??0)+" / "+t.gradedLegs}/>
          <Metric label="Avg model" value={pct(t.avgProbability,1)} sub="published chance"/>
          <Metric label="Top-pick hit" value={pct(t.topPickHitRate,1)} sub={(t.topPickLegs??0)+" legs"}/>
          <Metric label="Whole slips" value={pct(t.slipHitRate,1)} sub={(t.completeSlips??0)+" settled"}/>
        </section>

        {(t.exactPriceLegs??0)>0?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start gap-3"><TrendingUp className="mt-0.5 size-4 text-violet-300"/><div className="flex-1"><p className="font-black">Price performance</p><p className="mt-1 text-[0.62rem] leading-relaxed text-white/40">Only recommendations with an exact recorded bookmaker price are included here. This avoids pretending a model fair price was available to bet.</p></div></div>
          <div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Exact-price legs" value={String(t.exactPriceLegs??0)} sub="recorded prices"/><Metric label="Exact-price ROI" value={t.exactPriceROI==null?"—":((t.exactPriceROI>=0?"+":"")+pct(t.exactPriceROI,1))} sub={(t.exactPriceLegs??0)>=20?"usable sample":"small sample"}/></div>
        </section>:null}

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-black">Performance by market</p><p className="mt-1 text-[0.6rem] text-white/35">Hit rate compared with the average probability the model assigned.</p></div><Activity className="size-4 text-cyan-300"/></div>
          {!enough?<div className="mt-3 rounded-2xl bg-amber-300/[0.07] p-3 text-[0.62rem] leading-relaxed text-amber-100/80">There are only {t.gradedLegs} graded legs so far. Market-level percentages are shown, but they should not be treated as stable until the samples grow.</div>:null}
          <div className="mt-3 space-y-2">
            {markets.length?markets.map(row=>{
              const diff=(row.hitRate!=null&&row.avgProbability!=null)?row.hitRate-row.avgProbability:null
              return <div key={row.market} className="rounded-2xl bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{marketName(row.market)}</p><p className="mt-0.5 text-[0.5rem] text-white/30">{row.hits}/{row.sample} landed{row.avgExactOdds?" · avg exact odds "+row.avgExactOdds.toFixed(2):""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{pct(row.hitRate,1)}</p><p className={"text-[0.46rem] font-black "+(diff==null?"text-white/25":diff>=0?"text-emerald-300":"text-rose-300")}>{diff==null?"—":((diff>=0?"+":"")+(diff*100).toFixed(1)+"pp vs model")}</p></div></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-300" style={{width:Math.max(0,Math.min(100,(row.hitRate??0)*100))+"%"}}/></div>
                <p className="mt-1.5 text-[0.46rem] text-white/25">Model average {pct(row.avgProbability,1)}</p>
              </div>
            }):<p className="py-6 text-center text-sm text-white/35">No market-level settled data yet.</p>}
          </div>
        </section>

        <section className="rounded-3xl border border-white/8 bg-white/[0.025] p-4">
          <p className="text-[0.54rem] font-black uppercase tracking-[0.12em] text-white/30">How to read this</p>
          <p className="mt-2 text-[0.62rem] leading-relaxed text-white/40">The aim is calibration, not a flashy strike-rate claim. If picks labelled around 70% land roughly 70% of the time over a large sample, the probability model is behaving sensibly. Price performance matters separately: a likely outcome can still be a poor bet when the available odds are too short.</p>
        </section>
      </>:data?.ok?<section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No settled tracking data yet</p><p className="mt-1 text-sm text-white/35">Recommendations will populate this page as they are graded.</p></section>:null}
    </div>
  </main>
}

function Metric({label,value,sub}:{label:string;value:string;sub:string}){
  return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.48rem] font-black uppercase text-white/30">{label}</p><p className="mt-1 text-[0.46rem] text-white/20">{sub}</p></div>
}
