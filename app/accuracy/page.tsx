"use client"
import {useEffect,useMemo,useState} from "react"
import Link from "next/link"
import {ArrowLeft,RefreshCw,Target,Activity,AlertTriangle} from "lucide-react"

type Rate={phase:string;graded:number;hits:number;avg_confidence:string|null;brier?:string;total?:number;market_group?:string;band?:string}
type Signal={signal:string;graded:number;hits:number;avg_confidence:string|null}
type Data={ok:boolean;error?:string;days:number;updatedAt:string;
  phases:Rate[];markets:Rate[];confidence:Rate[];liveCardSignals:Signal[];
  coverage:{unique_saved:number;ungraded:number;match_days:number}}
function pct(h:number,n:number){return n?((100*h)/n).toFixed(1)+"%":"—"}
function num(v:string|null|undefined){return v==null?"—":Number(v).toFixed(1)+"%"}
function RateCard({label,row}:{label:string;row?:Rate}){
  return <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
    <p className="text-[0.6rem] font-bold uppercase tracking-wider text-white/45">{label}</p>
    <p className="mt-2 font-mono text-3xl font-black">{row?.graded?pct(row.hits,row.graded):"—"}</p>
    <p className="mt-1 text-xs text-white/45">{row?.hits??0} / {row?.graded??0} graded unique selections</p>
    <p className="mt-2 text-xs text-cyan-200">Average model confidence: {num(row?.avg_confidence)}</p>
    {row?.brier?<p className="mt-1 text-[0.55rem] text-white/35">Brier score: {row.brier} · lower is better</p>:null}
  </div>
}
export default function AccuracyPage(){
  const[days,setDays]=useState(30)
  const[data,setData]=useState<Data|null>(null)
  const[loading,setLoading]=useState(true)
  const[tab,setTab]=useState<"pre-match"|"live">("pre-match")
  useEffect(()=>{let cancelled=false;setLoading(true)
    fetch("/api/admin/accuracy?days="+days,{cache:"no-store"})
      .then(async r=>{const d=await r.json();if(!cancelled)setData(d)})
      .catch(()=>{if(!cancelled)setData({ok:false,error:"Unable to load model accuracy"} as Data)})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[days])
  const live=data?.phases?.find(p=>p.phase==="live")
  const pre=data?.phases?.find(p=>p.phase==="pre-match")
  const markets=useMemo(()=>data?.markets?.filter(x=>x.phase===tab)??[],[data,tab])
  const bands=useMemo(()=>data?.confidence?.filter(x=>x.phase===tab)??[],[data,tab])
  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="border-b border-white/10 bg-[#07120e]/95"><div className="mx-auto max-w-4xl px-4 py-5">
      <div className="flex items-center gap-3"><Link href="/performance" className="rounded-xl bg-white/10 p-2.5"><ArrowLeft className="size-4"/></Link>
        <div className="flex-1"><p className="text-[0.55rem] font-black uppercase tracking-widest text-emerald-300">Match Edge · Model performance</p>
        <h1 className="text-2xl font-black">Accuracy & confidence</h1></div>
        {loading?<RefreshCw className="size-4 animate-spin text-emerald-300"/>:<Activity className="size-4 text-emerald-300"/>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{[7,30,90,365].map(d=><button key={d} onClick={()=>setDays(d)} className={"rounded-full border px-3 py-2 text-[0.58rem] font-bold "+(days===d?"border-emerald-200 bg-emerald-300 text-emerald-950":"border-white/10 bg-white/5 text-white/55")}>{d===365?"1 year":d+" days"}</button>)}</div>
    </div></header>
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      {data&&!data.ok?<p className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-200">{data.error}</p>:null}
      {data?.ok?<>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2"><RateCard label="Before match hit rate" row={pre}/><RateCard label="Live hit rate" row={live}/></section>
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.055] p-3 text-xs leading-relaxed text-white/60">
          <Target className="mt-0.5 size-4 shrink-0 text-amber-200"/>
          <p><strong className="text-white">75% is a target, not a guarantee.</strong> Accurate probabilities and sustainable results require forward testing. Higher hit rates may come from selecting fewer, lower-priced outcomes; winning bets also depend on the odds.</p>
        </div>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-2"><div><h2 className="font-black">Where the model is strongest</h2><p className="mt-1 text-xs text-white/40">First saved prediction, per event and phase · no repeated refreshes</p></div><span className="rounded-lg bg-white/10 px-2 py-1 text-xs">{data.coverage?.match_days} days</span></div>
          <div className="mt-4 flex gap-2">{(["pre-match","live"] as const).map(p=><button key={p} onClick={()=>setTab(p)} className={"flex-1 rounded-xl px-3 py-2 text-xs font-black "+(tab===p?"bg-emerald-300 text-emerald-950":"bg-white/10 text-white/55")}>{p==="live"?"Live":"Before match"}</button>)}</div>
          <div className="mt-3 space-y-2">{markets.length?markets.map(row=><div key={row.market_group} className="rounded-xl bg-black/25 p-3">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{row.market_group}</p><p className="mt-1 text-[0.58rem] text-white/40">{row.hits}/{row.graded} graded · predicted {num(row.avg_confidence)}</p></div>
              <p className="font-mono text-lg font-black">{pct(row.hits,row.graded)}</p></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-300" style={{width:(row.graded?row.hits/row.graded*100:0)+"%"}}/></div>
          </div>):<p className="py-5 text-center text-xs text-white/45">No settled unique picks for this category yet.</p>}</div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <h2 className="font-black">Confidence calibration · {tab==="live"?"live":"before match"}</h2>
          <p className="mt-1 text-xs text-white/40">When the model predicts a 75%+ chance, how often has it actually won?</p>
          <div className="mt-3 space-y-2">{bands.map(x=><div key={x.band} className="flex items-center justify-between gap-3 rounded-xl bg-black/25 p-3">
            <div><p className="text-sm font-bold">{x.band}</p><p className="text-[0.55rem] text-white/40">{x.hits}/{x.graded} · avg prediction {num(x.avg_confidence)}</p></div>
            <p className="font-mono text-lg font-black">{pct(x.hits,x.graded)}</p>
          </div>)}</div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-200"/><h2 className="font-black">Live yellow-card signal review</h2></div>
          <p className="mt-1 text-xs text-white/40">Observational breakdowns, not causal evidence. Small groups and late-game snapshots can distort results.</p>
          <div className="mt-3 space-y-2">{(data.liveCardSignals??[]).map(x=><div key={x.signal} className="flex justify-between gap-3 rounded-xl bg-black/25 p-3"><div><p className="text-sm font-bold">{x.signal}</p><p className="text-[0.58rem] text-white/40">{x.hits}/{x.graded} · predicted {num(x.avg_confidence)}</p></div><p className="font-mono text-lg font-black">{pct(x.hits,x.graded)}</p></div>)}</div>
        </section>
        <p className="text-[0.67rem] leading-relaxed text-white/45">Coverage: {data.coverage?.unique_saved} unique logged selections, {data.coverage?.ungraded} still awaiting verifiable results. The scores reflect published picks, not bets placed at a bookmaker. Referee pressure, fouls, dissent and dangerous challenges are candidate predictive signals, not proof that a player will be booked.</p>
        <Link href="/admin/recommendation-audit" className="block rounded-xl bg-white/10 px-4 py-3 text-center text-sm font-black">Inspect individual picks versus results</Link>
      </>:null}
    </div>
  </main>
}