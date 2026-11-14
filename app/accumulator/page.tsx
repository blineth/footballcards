"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, CalendarDays, ChevronDown, Flame, RefreshCw, ShieldCheck, Sparkles, Target, Trophy } from "lucide-react"

type Leg={fixtureId:string;competition:string;kickoff:string;home:string;away:string;inPlay?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;market:string;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null;bookmaker:string|null;grade:"A"|"B"|"C"|"D";reasons:string[]}
type Slip={id:string;title:string;subtitle:string;legs:Leg[];fairCombinedOdds:number|null;bookmaker:string|null;exactCombinedOdds:number|null;exactPriced:boolean;available?:boolean;requiredLegs?:number;containsLive?:boolean;modelAllHitProbability?:number|null;adjustedAllHitProbability?:number|null;historicalStructureSample?:number;historicalStructureHitRate?:number|null;combinedProbabilityNote?:string}
type Prediction={id:string;competition:string;kickoff:string;status?:string;inPlay?:boolean;finished?:boolean;bttsSettled?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;homeStats:any;awayStats:any;h2h:any;preMatchProbabilities?:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};probabilities:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};winnerPick?:{side:string;team:string;loser:string;probability:number;grade:string}|null;bttsPick?:{selection:string;probability:number;grade:string}|null;reasons:string[]}
type RiskMode="safe"|"balanced"|"aggressive"
type Response={ok:boolean;date?:string;fixtureCount?:number;activeFixtureCount?:number;finishedFixtureCount?:number;predictions?:Prediction[];finishedPredictions?:Prediction[];slips?:Slip[];generatedAt?:string;cached?:boolean;staleFallback?:boolean;warning?:string;error?:string}

function londonDate(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=(t:string)=>p.find(x=>x.type===t)?.value??"";return v("year")+"-"+v("month")+"-"+v("day")}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function time(v:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}

export default function AccumulatorPage(){
  const[date,setDate]=useState(londonDate)
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)
  const[risk,setRisk]=useState<RiskMode>("safe")
  const load=useCallback(async(force=false)=>{setLoading(true);try{const q=new URLSearchParams({date});if(force)q.set("refresh",String(Date.now()));const r=await fetch("/api/match-acca?"+q.toString(),{cache:force?"no-store":"default"});setData(r.ok?await r.json():{ok:false,error:"Accumulator analysis failed"})}catch{setData({ok:false,error:"Accumulator analysis failed"})}finally{setLoading(false)}},[date])
  useEffect(()=>{void load(false)},[load])
  useEffect(()=>{
    const hasLive=(data?.predictions??[]).some(p=>p.inPlay)
    if(!hasLive)return
    const timer=window.setInterval(()=>void load(true),30000)
    return()=>window.clearInterval(timer)
  },[data,load])
  const selectedSlip=useMemo(()=>{
    const slips=(data?.slips??[]).filter(s=>s.available!==false)
    const target=risk==="safe"?5:risk==="balanced"?7:10
    return slips.find(s=>(s.requiredLegs??s.legs.length)===target)??slips.sort((a,b)=>Math.abs((a.requiredLegs??a.legs.length)-target)-Math.abs((b.requiredLegs??b.legs.length)-target))[0]??null
  },[data?.slips,risk])

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl"><div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-amber-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div><h1 className="mt-1 text-2xl font-black">Acca Builder</h1><p className="mt-1 text-xs text-white/45">Choose your risk. The engine builds the strongest multi-match route.</p></div><button onClick={()=>void load(true)} className="rounded-xl bg-amber-300 p-2.5 text-amber-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"><CalendarDays className="size-4 text-amber-300"/><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/></div>
    </div></header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      <section className="rounded-3xl border border-amber-300/12 bg-gradient-to-br from-amber-300/[0.08] to-black/20 p-4">
        <div className="flex items-start gap-3"><Target className="mt-0.5 size-4 text-amber-300"/><div><p className="text-sm font-black">Choose your build</p><p className="mt-1 text-[0.62rem] leading-relaxed text-white/45">Like the best acca tools, risk is the first decision. Safe targets five stronger legs, Balanced targets seven, and Aggressive targets ten. Every leg comes from a different match.</p></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <RiskButton mode="safe" active={risk==="safe"} onClick={()=>setRisk("safe")} title="Safe" sub="5 fold" icon={<ShieldCheck className="size-4"/>}/>
          <RiskButton mode="balanced" active={risk==="balanced"} onClick={()=>setRisk("balanced")} title="Balanced" sub="7 fold" icon={<Activity className="size-4"/>}/>
          <RiskButton mode="aggressive" active={risk==="aggressive"} onClick={()=>setRisk("aggressive")} title="Aggressive" sub="10 fold" icon={<Flame className="size-4"/>}/>
        </div>
      </section>

      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-amber-300"/><p className="font-black">Analysing the matchday…</p></section>:null}
      {!loading&&data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Accumulator analysis unavailable</p><p className="mt-1 text-sm text-white/40">{data?.error??"Try another date."}</p></section>:null}

      {data?.ok?<>{data.staleFallback?<section className="rounded-2xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-[0.62rem] text-amber-100">{data.warning??"Showing the last successful cached analysis because a fresh data pull failed."}</section>:null}<section className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Active fixtures" value={String(data.activeFixtureCount??data.predictions?.length??0)}/><Metric label="Live matches" value={String((data.predictions??[]).filter(p=>p.inPlay).length)}/><Metric label="Build" value={risk==="safe"?"5 fold":risk==="balanced"?"7 fold":"10 fold"}/><Metric label="Updated" value={data.generatedAt?new Date(data.generatedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—"}/></section>

      {selectedSlip?<><AccaSnapshot slip={selectedSlip}/><section className="space-y-3"><div className="px-1"><p className="font-black">{risk==="safe"?"Safer":"Selected"} build</p><p className="text-[0.6rem] text-white/35">The weakest leg and combined chance are visible before you expand the full slip.</p></div><SlipCard slip={selectedSlip} hero/></section></>:<section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center"><p className="font-black">No {risk} build available</p><p className="mt-1 text-sm text-white/35">There are not enough qualifying matches for this risk level today.</p></section>}

      <details className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-black text-white/45">Compare all acca builds</summary><div className="mt-3 space-y-3">{(data.slips??[]).map(s=><SlipCard key={"compare-"+s.id} slip={s}/>)}</div></details>

      <section className="space-y-3"><div className="px-1"><p className="font-black">Match-by-match analysis</p><p className="text-[0.6rem] text-white/35">Only upcoming and live matches are shown here.</p></div>{(data.predictions??[]).map(p=><PredictionCard key={p.id} prediction={p}/>)}</section>
      {(data.finishedPredictions?.length??0)>0?<details className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-black text-white/45">Finished matches ({data.finishedPredictions?.length})</summary><div className="mt-3 space-y-2">{(data.finishedPredictions??[]).map(p=><PredictionCard key={"finished-"+p.id} prediction={p}/>)}</div></details>:null}</>:null}
    </div>
  </main>
}

function RiskButton({active,onClick,title,sub,icon}:{mode:RiskMode;active:boolean;onClick:()=>void;title:string;sub:string;icon:ReactNode}){
  return <button onClick={onClick} className={"rounded-2xl border p-3 text-left transition "+(active?"border-amber-300/35 bg-amber-300 text-amber-950":"border-white/8 bg-black/20 text-white/50")}><div className="flex items-center gap-2">{icon}<p className="text-xs font-black">{title}</p></div><p className={"mt-1 text-[0.48rem] font-black uppercase "+(active?"text-amber-950/60":"text-white/25")}>{sub}</p></button>
}

function AccaSnapshot({slip}:{slip:Slip}){
  const probs=slip.legs.map(l=>l.probability).filter(Number.isFinite)
  const weakest=probs.length?Math.min(...probs):null
  const avg=probs.length?probs.reduce((a,b)=>a+b,0)/probs.length:null
  const live=slip.legs.filter(l=>l.inPlay).length
  return <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase tracking-[0.13em] text-amber-300">Build snapshot</p><h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.56rem] text-white/35">{slip.legs.length} selections · {slip.bookmaker??"model pricing"}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{(slip.exactCombinedOdds??slip.fairCombinedOdds)?.toFixed(2)??"—"}</p><p className="text-[0.42rem] uppercase text-white/25">{slip.exactPriced?"combined odds":"fair odds"}</p></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Small label="Adjusted all hit" value={percent(slip.adjustedAllHitProbability)}/><Small label="Avg leg" value={percent(avg)}/><Small label="Weakest leg" value={percent(weakest)}/><Small label="Live legs" value={String(live)}/></div>
    <p className="mt-3 text-[0.54rem] leading-relaxed text-white/30">{slip.exactPriced?"Every leg has an exact price at the same bookmaker.":"The displayed combined fair odds are model-derived unless a single bookmaker prices every leg."}</p>
  </section>
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3 text-center"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.46rem] font-black uppercase text-white/25">{label}</p></div>}

function SlipCard({slip,hero=false}:{slip:Slip;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  if(slip.available===false)return <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><h2 className="text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-[0.6rem] font-bold text-amber-100">Not enough qualifying picks to build the required {slip.requiredLegs??5}-leg acca for this matchday.</p></article>
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-amber-300/25 bg-gradient-to-br from-amber-400/15 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(v=>!v)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-amber-300"><Sparkles className="size-3.5"/><span className="text-[0.5rem] font-black uppercase tracking-[0.14em]">Starting point</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.56rem] font-black text-white/35">{slip.legs.length} legs{slip.bookmaker?" · "+slip.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{(slip.exactCombinedOdds??slip.fairCombinedOdds)?.toFixed(2)??"—"}</p><p className="text-[0.43rem] uppercase text-white/25">{slip.exactPriced?"exact book price":"model fair odds"}</p></div></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5"><Small label={slip.containsLive?"Live all hit":"Adj. all hit"} value={percent(slip.adjustedAllHitProbability)}/><Small label="Raw product" value={percent(slip.modelAllHitProbability)}/><Small label={slip.containsLive?"Live legs":"Hist. structure"} value={slip.containsLive?String(slip.legs.filter(l=>l.inPlay).length):percent(slip.historicalStructureHitRate)}/></div><div className="mt-3 flex items-center justify-between"><span className={"rounded-full px-2.5 py-1 text-[0.5rem] font-black "+(slip.exactPriced?"bg-emerald-400/15 text-emerald-300":"bg-white/7 text-white/40")}>{slip.exactPriced?"BOOKMAKER PRICED":"MODEL PRICE"}</span><ChevronDown className={"size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.fixtureId+"|"+l.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-white/30">{l.competition} · {l.inPlay&&l.score?<span className="text-rose-300">LIVE {l.elapsed??"?"}' · {l.home} {l.score.home}-{l.score.away} {l.away}</span>:<>{time(l.kickoff)} · {l.home} v {l.away}</>}</p><p className="mt-1 text-sm font-black">{l.label}</p><p className="mt-0.5 text-[0.54rem] text-white/35">Grade {l.grade}{l.bookmaker?" · "+l.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className="text-[0.43rem] text-white/25">{(l.bookmakerOdds??l.fairOdds).toFixed(2)} odds</p></div></div><p className="mt-2 text-[0.58rem] leading-relaxed text-white/40">{l.reasons.slice(0,2).join(" · ")}</p></div>)}</div>{!slip.exactPriced?<p className="mt-3 text-[0.52rem] text-white/30">{slip.combinedProbabilityNote??"Fair odds are model-derived across separate matches and are not a bookmaker quote."}</p>:null}</div>:null}
  </article>
}

function PredictionCard({prediction:p}:{prediction:Prediction}){
  const[open,setOpen]=useState(false)
  return <article className="rounded-3xl border border-white/9 bg-white/[0.035] p-4"><button onClick={()=>setOpen(v=>!v)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase text-white/30">{p.competition} · {time(p.kickoff)}</p><h3 className="mt-1 text-base font-black">{p.inPlay&&p.score?<><span className="text-rose-300">LIVE {p.elapsed??"?"}'</span> · {p.home} {p.score.home}-{p.score.away} {p.away}</>:<>{p.home} <span className="text-white/25">v</span> {p.away}</>}</h3><p className="mt-2 text-[0.58rem] text-white/45">{p.homeStats.position}th v {p.awayStats.position}th · form {p.homeStats.recentForm} / {p.awayStats.recentForm}</p></div><ChevronDown className={"mt-1 size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div>
      {p.inPlay&&p.preMatchProbabilities?<div className="mt-3 rounded-xl bg-rose-400/5 px-3 py-2 text-[0.54rem] text-rose-100/65">Pre-match: {p.home} {percent(p.preMatchProbabilities.homeWin)} · Draw {percent(p.preMatchProbabilities.draw)} · {p.away} {percent(p.preMatchProbabilities.awayWin)} → updated below from the live score.</div>:null}<div className="mt-3 grid grid-cols-3 gap-1.5"><Small label={p.inPlay?p.home+" live win":p.home+" win"} value={percent(p.probabilities.homeWin)}/><Small label="Draw" value={percent(p.probabilities.draw)}/><Small label={p.inPlay?p.away+" live win":p.away+" win"} value={percent(p.probabilities.awayWin)}/></div>
      {p.bttsSettled?<div className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-center text-[0.56rem] font-black text-white/35">BTTS settled — hidden from betting picks</div>:<div className="mt-2 grid grid-cols-2 gap-1.5"><Small label="BTTS Yes" value={percent(p.probabilities.bttsYes)}/><Small label="BTTS No" value={percent(p.probabilities.bttsNo)}/></div>}</button>
      {open?<div className="mt-3 border-t border-white/8 pt-3"><div className="grid grid-cols-2 gap-2"><Small label={p.home+" home win"} value={percent(p.homeStats.venueWinRate)}/><Small label={p.away+" away win"} value={percent(p.awayStats.venueWinRate)}/><Small label={p.home+" home PPG"} value={Number(p.homeStats.venuePPG).toFixed(2)}/><Small label={p.away+" away PPG"} value={Number(p.awayStats.venuePPG).toFixed(2)}/></div><div className="mt-3 rounded-2xl bg-black/20 p-3"><p className="text-[0.5rem] font-black uppercase text-white/25">Model read</p>{p.winnerPick?<><p className="mt-1 text-sm font-black">{p.winnerPick.team} to win · {percent(p.winnerPick.probability)} · Grade {p.winnerPick.grade}</p><p className="mt-1 text-[0.58rem] font-bold text-rose-200/70">Expected loser: {p.winnerPick.loser}</p></>:<p className="mt-1 text-sm font-black">No strong direct winner call</p>}{p.bttsSettled?<p className="mt-1 text-[0.58rem] font-bold text-white/35">BTTS market already settled in-play.</p>:p.bttsPick?<p className="mt-1 text-sm font-black">BTTS {p.bttsPick.selection==="yes"?"Yes":"No"} · {percent(p.bttsPick.probability)} · Grade {p.bttsPick.grade}</p>:null}<p className="mt-2 text-[0.6rem] leading-relaxed text-white/40">{p.reasons.join(" · ")}</p></div></div>:null}
    </article>
}

function Small({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/20 p-2.5 text-center"><p className="font-mono text-sm font-black">{value}</p><p className="mt-0.5 truncate text-[0.43rem] font-black uppercase text-white/25">{label}</p></div>}
