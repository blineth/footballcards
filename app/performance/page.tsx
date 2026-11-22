"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, BarChart3, CheckCircle2, Clock3, RefreshCw, ShieldCheck, TrendingUp, Trash2, XCircle } from "lucide-react"
import { betProfit, betReturn, getTrackedBets, removeTrackedBet, settleTrackedBet, trackedBetEventName, type TrackedBet } from "@/lib/tracked-bets"

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
  const[tracked,setTracked]=useState<TrackedBet[]>([])

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
  useEffect(()=>{
    const refresh=()=>setTracked(getTrackedBets())
    refresh()
    const event=trackedBetEventName()
    window.addEventListener(event,refresh)
    window.addEventListener("storage",refresh)
    return()=>{window.removeEventListener(event,refresh);window.removeEventListener("storage",refresh)}
  },[])
  const t=data?.tracking
  const markets=useMemo(()=>[...(t?.byMarket??[])].sort((a,b)=>(b.sample??0)-(a.sample??0)),[t?.byMarket])
  const enough=(t?.gradedLegs??0)>=20
  const settled=tracked.filter(b=>b.status!=="open")
  const openBets=tracked.filter(b=>b.status==="open")
  const won=settled.filter(b=>b.status==="won")
  const decided=settled.filter(b=>b.status==="won"||b.status==="lost")
  const totalStaked=settled.reduce((s,b)=>s+b.stake,0)
  const totalReturned=settled.reduce((s,b)=>s+(betReturn(b)??0),0)
  const totalProfit=settled.reduce((s,b)=>s+(betProfit(b)??0),0)
  const roi=totalStaked>0?totalProfit/totalStaked:null
  const userWinRate=decided.length?won.length/decided.length:null

  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><BarChart3 className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Results & calibration</h1>
            <p className="mt-1 text-xs text-white/45">The model's record stays visible — winners and losers.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><Link href="/accuracy" className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2.5 text-[0.5rem] font-black text-emerald-200">HIT RATE</Link><Link href="/admin/model-performance" className="rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 py-2.5 text-[0.5rem] font-black text-violet-200">ADMIN LAB</Link><button onClick={()=>void load(true)} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {!data&&!loading?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">Loading performance…</div>:null}
      {loading&&!data?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Loading settled results…</p></div>:null}
      {data&&!data.ok?<div className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Results unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></div>:null}

      <section className="rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/[0.10] to-black/30 p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-cyan-300"><TrendingUp className="size-4"/><p className="text-[0.58rem] font-black uppercase tracking-[0.14em]">My Bet Results</p></div><h2 className="mt-2 text-xl font-black">Bets placed from Match Edge</h2><p className="mt-1 max-w-xl text-[0.62rem] leading-relaxed text-white/45">This uses the actual Bet365 odds and stake you saved. Open bets do not affect profit or ROI until you settle them.</p></div><span className="rounded-full bg-white/7 px-2.5 py-1 text-[0.48rem] font-black text-white/40">{openBets.length} OPEN</span></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Net profit" value={(totalProfit>=0?"+":"")+"£"+totalProfit.toFixed(2)} sub="settled bets"/><Metric label="ROI" value={roi==null?"—":((roi>=0?"+":"")+pct(roi,1))} sub={"£"+totalStaked.toFixed(2)+" staked"}/><Metric label="Win rate" value={pct(userWinRate,1)} sub={won.length+" / "+decided.length+" decided"}/><Metric label="Returned" value={"£"+totalReturned.toFixed(2)} sub={settled.length+" settled"}/></div>
      </section>

      {tracked.length?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-black">My slips</p><p className="mt-1 text-[0.6rem] text-white/35">Settle each bet after Bet365 has graded it. Won, lost and void bets feed the money analytics above.</p></div><span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/30">{tracked.length} SAVED</span></div>
        <div className="mt-3 space-y-2">{tracked.map(b=><TrackedBetCard key={b.id} bet={b} onChange={()=>setTracked(getTrackedBets())}/>)}</div>
      </section>:<section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-5 text-center"><p className="font-black">No personal bets tracked yet</p><p className="mt-1 text-xs text-white/35">Use “Track this bet” in Match Builder or “Track this Acca” in Accas after you place it at Bet365.</p></section>}

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

function TrackedBetCard({bet,onChange}:{bet:TrackedBet;onChange:()=>void}){
  const returned=betReturn(bet)
  const profit=betProfit(bet)
  const settle=(status:"won"|"lost"|"void")=>{settleTrackedBet(bet.id,status);onChange()}
  const remove=()=>{removeTrackedBet(bet.id);onChange()}
  const statusTone=bet.status==="won"?"text-emerald-300 bg-emerald-300/10":bet.status==="lost"?"text-rose-300 bg-rose-300/10":bet.status==="void"?"text-amber-200 bg-amber-300/10":"text-cyan-200 bg-cyan-300/10"
  return <article className="rounded-2xl border border-white/7 bg-black/20 p-3">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-black">{bet.title}</p><span className={"rounded-full px-2 py-0.5 text-[0.4rem] font-black uppercase "+statusTone}>{bet.status}</span></div><p className="mt-0.5 text-[0.48rem] text-white/25">{bet.fixture??bet.source} · Bet365 · {new Date(bet.createdAt).toLocaleDateString("en-GB")}</p></div><button onClick={remove} className="rounded-lg bg-white/5 p-1.5 text-white/25"><Trash2 className="size-3"/></button></div>
    <div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-xl bg-white/[0.04] p-2"><p className="font-mono text-sm font-black">{bet.odds.toFixed(2)}</p><p className="text-[0.4rem] uppercase text-white/20">Actual odds</p></div><div className="rounded-xl bg-white/[0.04] p-2"><p className="font-mono text-sm font-black">£{bet.stake.toFixed(2)}</p><p className="text-[0.4rem] uppercase text-white/20">Stake</p></div><div className="rounded-xl bg-white/[0.04] p-2"><p className={"font-mono text-sm font-black "+(profit==null?"":profit>=0?"text-emerald-300":"text-rose-300")}>{profit==null?"£"+(bet.stake*bet.odds).toFixed(2):(profit>=0?"+":"")+"£"+profit.toFixed(2)}</p><p className="text-[0.4rem] uppercase text-white/20">{profit==null?"Potential return":"Profit / loss"}</p></div></div>
    <details className="mt-2"><summary className="cursor-pointer text-[0.5rem] font-black text-white/30">{bet.legs.length} selections · view bet</summary><div className="mt-2 space-y-1">{bet.legs.map((leg,i)=><div key={i} className="rounded-lg bg-white/[0.035] px-2.5 py-2"><p className="text-[0.54rem] font-black text-white/65">{leg.label}</p><p className="mt-0.5 text-[0.42rem] text-white/25">{leg.fixture??leg.team??""}{leg.modelProbability!=null?" · model "+pct(leg.modelProbability,0):""}{leg.bet365Odds!=null?" · "+leg.bet365Odds.toFixed(3)+" Bet365":""}</p></div>)}</div></details>
    {bet.status==="open"?<div className="mt-3 grid grid-cols-3 gap-2"><button onClick={()=>settle("won")} className="flex items-center justify-center gap-1 rounded-xl bg-emerald-400 px-2 py-2 text-[0.52rem] font-black text-emerald-950"><CheckCircle2 className="size-3"/>WON</button><button onClick={()=>settle("lost")} className="flex items-center justify-center gap-1 rounded-xl bg-rose-400/15 px-2 py-2 text-[0.52rem] font-black text-rose-200"><XCircle className="size-3"/>LOST</button><button onClick={()=>settle("void")} className="flex items-center justify-center gap-1 rounded-xl bg-amber-300/12 px-2 py-2 text-[0.52rem] font-black text-amber-100"><Clock3 className="size-3"/>VOID</button></div>:<p className="mt-3 text-[0.48rem] text-white/25">{returned!=null?"Returned £"+returned.toFixed(2):""}{bet.settledAt?" · settled "+new Date(bet.settledAt).toLocaleDateString("en-GB"):""}</p>}
  </article>
}

function Metric({label,value,sub}:{label:string;value:string;sub:string}){
  return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.48rem] font-black uppercase text-white/30">{label}</p><p className="mt-1 text-[0.46rem] text-white/20">{sub}</p></div>
}
