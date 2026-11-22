"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, RefreshCw, Target, TrendingDown, TrendingUp, XCircle } from "lucide-react"

type StatRow={sample:number;hits:number;hitRate:number|null;avgProbability:number|null;gap:number|null;[key:string]:any}
type Performance={
  available:boolean;days:number;totalRuns:number;gradedLegs:number;hits:number;hitRate:number|null;avgProbability:number|null;brier:number|null;
  gradedRuns:number;winningRuns:number;runHitRate:number|null;
  byMarket:StatRow[];bySurface:any[];byTier:StatRow[];probabilityBands:StatRow[];byConfidence:StatRow[];
  improvement:any[];recentMisses:any[];recentRuns:any[]
}
type Response={ok:boolean;grading?:{graded:number;runsUpdated:number};performance?:Performance;updatedAt?:string;error?:string}

function pct(v:number|null|undefined,d=1){
  return v==null||!Number.isFinite(v)?"—":(v*100).toFixed(d)+"%"
}
function surfaceName(v:string){
  const map:Record<string,string>={
    match_builder:"Match Builder",match_builder_live:"Match Builder Live",match_card_risk:"Card Risk",
    match_likelihood:"Match Likelihood",match_likelihood_live:"Live Likelihood",
    multi_combined:"Multi Combined",multi_match:"Multi Match",acca:"Accas",acca_live:"Live Accas",
  }
  if(v.startsWith("multi_live_"))return "Live Multi · "+v.replace("multi_live_","").toUpperCase()
  return map[v]??v.replaceAll("_"," ")
}
function marketName(v:string){
  const map:Record<string,string>={cards:"Yellow cards",fouls:"Fouls committed",fouled:"Fouls drawn",shots:"Shots",sot:"Shots on target",goals:"Goals",assists:"Assists","match result":"Match result",btts:"BTTS"}
  return map[v]??v
}
function tone(gap:number|null){
  if(gap==null)return "text-white/35"
  if(gap>=-.03)return "text-emerald-300"
  if(gap>=-.08)return "text-amber-200"
  return "text-rose-300"
}

export default function AdminModelPerformance(){
  const[days,setDays]=useState(30)
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)

  const load=useCallback(async(forceGrade=true)=>{
    setLoading(true)
    try{
      const q=new URLSearchParams({days:String(days),grade:forceGrade?"1":"0"})
      const r=await fetch("/api/admin/model-performance?"+q.toString(),{cache:"no-store"})
      setData(r.ok?await r.json():{ok:false,error:"Admin analytics unavailable"})
    }catch{
      setData({ok:false,error:"Admin analytics unavailable"})
    }finally{setLoading(false)}
  },[days])
  useEffect(()=>{void load(true)},[load])

  const p=data?.performance
  const markets=useMemo(()=>[...(p?.byMarket??[])].sort((a,b)=>b.sample-a.sample),[p?.byMarket])
  const weaknesses=useMemo(()=>[...(p?.improvement??[])].filter(x=>x.status!=="healthy"),[p?.improvement])

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-5xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Link href="/performance" className="rounded-xl bg-white/7 p-2.5 text-white/60"><ArrowLeft className="size-4"/></Link>
            <div><div className="flex items-center gap-2 text-violet-300"><BarChart3 className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.16em]">Admin · Model Lab</span></div><h1 className="mt-1 text-2xl font-black">Prediction performance</h1><p className="mt-1 text-xs text-white/40">Every published prediction, timestamped and graded against the final result.</p></div>
          </div>
          <button onClick={()=>void load(true)} className="rounded-xl bg-violet-300 p-2.5 text-violet-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><Link href="/admin/recommendation-audit" className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-[0.55rem] font-black text-emerald-200">SUGGESTED VS ACTUAL</Link>{[7,30,90,365].map(d=><button key={d} onClick={()=>setDays(d)} className={"rounded-full border px-3 py-2 text-[0.55rem] font-black "+(days===d?"border-violet-300/30 bg-violet-300 text-violet-950":"border-white/10 bg-white/[0.04] text-white/45")}>{d===365?"1 YEAR":d+" DAYS"}</button>)}</div>
      </div>
    </header>

    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
      {loading&&!data?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto size-5 animate-spin text-violet-300"/><p className="mt-2 font-black">Grading predictions…</p></div>:null}
      {data&&!data.ok?<div className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Analytics unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></div>:null}

      {data?.ok&&p?<>
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Metric label="Leg hit rate" value={pct(p.hitRate)} sub={p.hits+" / "+p.gradedLegs+" graded"}/>
          <Metric label="Whole-slip hit" value={pct(p.runHitRate)} sub={p.winningRuns+" / "+p.gradedRuns+" settled runs"}/>
          <Metric label="Model average" value={pct(p.avgProbability)} sub={"Brier "+(p.brier==null?"—":p.brier.toFixed(3))}/>
          <Metric label="Prediction runs" value={String(p.totalRuns)} sub={"last "+p.days+" days"}/>
        </section>

        {data.grading&&(data.grading.graded>0||data.grading.runsUpdated>0)?<section className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] px-4 py-3 text-xs text-emerald-100">This refresh graded {data.grading.graded} outstanding legs and settled {data.grading.runsUpdated} complete prediction runs.</section>:null}

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-black">Where the model needs improvement</p><p className="mt-1 text-[0.6rem] text-white/35">Actual hit rate minus the probability we published. Large negative gaps mean the model is overconfident.</p></div><AlertTriangle className="size-4 text-amber-200"/></div>
          <div className="mt-3 space-y-2">
            {weaknesses.length?weaknesses.map(row=><div key={row.area} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl bg-black/20 p-3"><div><div className="flex items-center gap-2"><p className="text-sm font-black">{marketName(row.area)}</p><span className={"rounded-full px-2 py-0.5 text-[0.4rem] font-black "+(row.status==="needs work"?"bg-rose-300/10 text-rose-200":"bg-amber-300/10 text-amber-100")}>{String(row.status).toUpperCase()}</span></div><p className="mt-1 text-[0.5rem] text-white/30">{row.sample} settled predictions · model {pct(row.avgProbability)} · actual {pct(row.hitRate)}</p></div><p className={"font-mono text-base font-black "+tone(row.gap)}>{row.gap==null?"—":((row.gap>=0?"+":"")+(row.gap*100).toFixed(1)+"pp")}</p></div>):<div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/35">{p.gradedLegs<5?"Not enough settled predictions yet. The ledger is collecting them now.":"No material weak areas in the current sample."}</div>}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="Accuracy by market" subtitle="Cards, fouls, shots, goals and other leg types.">
            <div className="space-y-2">{markets.length?markets.map(row=><AccuracyRow key={row.market_group} label={marketName(row.market_group)} sample={row.sample} hits={row.hits} hitRate={row.hitRate} avg={row.avgProbability} gap={row.gap}/>):<Empty/>}</div>
          </Panel>
          <Panel title="Accuracy by product" subtitle="Which parts of the app are actually strongest.">
            <div className="space-y-2">{(p.bySurface??[]).length?p.bySurface.map(row=><div key={row.surface} className="rounded-2xl bg-black/20 p-3"><div className="flex justify-between gap-3"><div><p className="text-sm font-black">{surfaceName(row.surface)}</p><p className="mt-1 text-[0.48rem] text-white/30">{row.hits}/{row.sample} legs · {row.winningRuns}/{row.gradedRuns} complete runs</p></div><div className="text-right"><p className="font-mono text-base font-black">{pct(row.hitRate)}</p><p className="text-[0.45rem] text-white/25">slips {pct(row.runHitRate)}</p></div></div></div>):<Empty/>}</div>
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="Odds / product tiers" subtitle="How whole Match Builder, Multi and Acca structures perform.">
            <div className="space-y-2">{(p.byTier??[]).length?p.byTier.map(row=><AccuracyRow key={String(row.tier)} label={String(row.tier??"Unlabelled")} sample={row.sample} hits={row.hits} hitRate={row.hitRate} avg={row.avgProbability} gap={row.gap} extra={row.avg_odds?"Avg odds "+Number(row.avg_odds).toFixed(2):undefined}/>):<Empty/>}</div>
          </Panel>
          <Panel title="Probability calibration" subtitle="If we say 70%, outcomes should land around 70% over time.">
            <div className="space-y-2">{(p.probabilityBands??[]).length?p.probabilityBands.map(row=><AccuracyRow key={row.label} label={row.label} sample={row.sample} hits={row.hits} hitRate={row.hitRate} avg={row.avgProbability} gap={row.gap}/>):<Empty/>}</div>
          </Panel>
        </section>

        <Panel title="Latest high-confidence misses" subtitle="The quickest place to see why the model was wrong and what evidence it relied on.">
          <div className="space-y-2">{(p.recentMisses??[]).length?p.recentMisses.map((row,i)=><div key={i} className="rounded-2xl border border-rose-300/10 bg-rose-300/[0.035] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><XCircle className="size-3.5 shrink-0 text-rose-300"/><p className="truncate text-sm font-black">{row.player_name?row.player_name+" · ":""}{row.label}</p></div><p className="mt-1 text-[0.48rem] text-white/30">{row.home_team} v {row.away_team} · {surfaceName(row.surface)} · {new Date(row.captured_at).toLocaleString("en-GB")}</p><p className="mt-1 text-[0.48rem] text-cyan-100/45">{row.recent5_hit_rate!=null?"Recent "+pct(Number(row.recent5_hit_rate),0)+" · ":""}{row.season_hit_rate!=null?"Season "+pct(Number(row.season_hit_rate),0)+" · ":""}{row.h2h_matches>0&&row.h2h_hit_rate!=null?"H2H "+Math.round(Number(row.h2h_hit_rate)*Number(row.h2h_matches))+"/"+row.h2h_matches:""}{row.discipline_heat!=null?" · Heat "+Math.round(Number(row.discipline_heat)*100):""}</p></div><div className="text-right"><p className="font-mono text-base font-black text-rose-200">{pct(Number(row.model_probability))}</p><p className="text-[0.42rem] text-white/25">result {row.result_value??"—"}</p></div></div></div>):<Empty text="No settled misses yet."/>}</div>
        </Panel>

        <Panel title="Recent prediction runs" subtitle="Timestamped audit trail of what the app actually published.">
          <div className="space-y-2">{(p.recentRuns??[]).length?p.recentRuns.map(row=><div key={row.id} className="rounded-2xl bg-black/20 p-3"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2">{row.fully_graded?(row.won?<CheckCircle2 className="size-3.5 text-emerald-300"/>:<XCircle className="size-3.5 text-rose-300"/>):<Target className="size-3.5 text-cyan-300"/>}<p className="text-sm font-black">{row.slip_title}</p></div><p className="mt-1 text-[0.47rem] text-white/30">{surfaceName(row.surface)} · {new Date(row.captured_at).toLocaleString("en-GB")}{row.live?" · LIVE "+(row.live_minute??"?")+"'":""}</p></div><div className="text-right"><p className="font-mono text-sm font-black">{row.hits}/{row.graded}</p><p className="text-[0.42rem] text-white/25">{row.legs} legs</p></div></div></div>):<Empty/>}</div>
        </Panel>
      </>:null}
    </div>
  </main>
}

function Metric({label,value,sub}:{label:string;value:string;sub:string}){
  return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3"><p className="font-mono text-xl font-black">{value}</p><p className="mt-1 text-[0.5rem] font-black uppercase tracking-wide text-white/30">{label}</p><p className="mt-1 text-[0.44rem] text-white/20">{sub}</p></div>
}
function Panel({title,subtitle,children}:{title:string;subtitle:string;children:any}){
  return <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"><div><p className="font-black">{title}</p><p className="mt-1 text-[0.58rem] text-white/35">{subtitle}</p></div><div className="mt-3">{children}</div></section>
}
function AccuracyRow({label,sample,hits,hitRate,avg,gap,extra}:{label:string;sample:number;hits:number;hitRate:number|null;avg:number|null;gap:number|null;extra?:string}){
  return <div className="rounded-2xl bg-black/20 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{label}</p><p className="mt-1 text-[0.47rem] text-white/30">{hits}/{sample} landed · model {pct(avg)}{extra?" · "+extra:""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{pct(hitRate)}</p><p className={"text-[0.44rem] font-black "+tone(gap)}>{gap==null?"—":((gap>=0?"+":"")+(gap*100).toFixed(1)+"pp")}</p></div></div></div>
}
function Empty({text="No settled data yet."}:{text?:string}){return <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">{text}</div>}
