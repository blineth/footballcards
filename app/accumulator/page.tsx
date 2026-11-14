"use client"

import { useCallback, useEffect, useState } from "react"
import { Activity, CalendarDays, ChevronDown, RefreshCw, ShieldCheck, Sparkles, Trophy } from "lucide-react"

type Leg={fixtureId:string;competition:string;kickoff:string;home:string;away:string;market:string;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null;bookmaker:string|null;grade:"A"|"B"|"C"|"D";reasons:string[]}
type Slip={id:string;title:string;subtitle:string;legs:Leg[];fairCombinedOdds:number|null;bookmaker:string|null;exactCombinedOdds:number|null;exactPriced:boolean}
type Prediction={id:string;competition:string;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;homeStats:any;awayStats:any;h2h:any;probabilities:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};winnerPick?:{side:string;team:string;loser:string;probability:number;grade:string}|null;bttsPick?:{selection:string;probability:number;grade:string}|null;reasons:string[]}
type Response={ok:boolean;date?:string;fixtureCount?:number;predictions?:Prediction[];slips?:Slip[];generatedAt?:string;error?:string}

function londonDate(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=(t:string)=>p.find(x=>x.type===t)?.value??"";return v("year")+"-"+v("month")+"-"+v("day")}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function time(v:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}

export default function AccumulatorPage(){
  const[date,setDate]=useState(londonDate)
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)
  const load=useCallback(async(force=false)=>{setLoading(true);try{const q=new URLSearchParams({date});if(force)q.set("refresh",String(Date.now()));const r=await fetch("/api/match-acca?"+q.toString(),{cache:force?"no-store":"default"});setData(r.ok?await r.json():{ok:false,error:"Accumulator analysis failed"})}catch{setData({ok:false,error:"Accumulator analysis failed"})}finally{setLoading(false)}},[date])
  useEffect(()=>{void load(false)},[load])

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl"><div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-amber-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div><h1 className="mt-1 text-2xl font-black">Accumulator</h1><p className="mt-1 text-xs text-white/45">Premier League · Championship · League One · League Two</p></div><button onClick={()=>void load(true)} className="rounded-xl bg-amber-300 p-2.5 text-amber-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"><CalendarDays className="size-4 text-amber-300"/><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/></div>
    </div></header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-start gap-3"><Activity className="mt-0.5 size-4 text-amber-300"/><div><p className="text-sm font-black">Team-match model</p><p className="mt-1 text-[0.65rem] leading-relaxed text-white/45">Uses current league position, season PPG, last-five form, win/loss streaks, home and away win rates, goal difference, BTTS/scoring rates and recent H2H. Exact bookmaker combined prices only appear when the same preferred bookmaker prices every leg.</p></div></div></section>

      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-amber-300"/><p className="font-black">Analysing the matchday…</p></section>:null}
      {!loading&&!data?.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Accumulator analysis unavailable</p><p className="mt-1 text-sm text-white/40">{data?.error??"Try another date."}</p></section>:null}

      {data?.ok?<><section className="grid grid-cols-2 gap-2"><Metric label="Fixtures analysed" value={String(data.fixtureCount??0)}/><Metric label="Updated" value={data.generatedAt?new Date(data.generatedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—"}/></section>

      <section className="space-y-3"><div className="px-1"><p className="font-black">Accumulator options</p><p className="text-[0.6rem] text-white/35">Different risk profiles from the same matchday analysis.</p></div>{(data.slips??[]).map((s,i)=><SlipCard key={s.id} slip={s} hero={i===0}/>)}</section>

      <section className="space-y-3"><div className="px-1"><p className="font-black">Match-by-match analysis</p><p className="text-[0.6rem] text-white/35">See why the model favours a result or BTTS selection.</p></div>{(data.predictions??[]).map(p=><PredictionCard key={p.id} prediction={p}/>)}</section></>:null}
    </div>
  </main>
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3 text-center"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.46rem] font-black uppercase text-white/25">{label}</p></div>}

function SlipCard({slip,hero=false}:{slip:Slip;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-amber-300/25 bg-gradient-to-br from-amber-400/15 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(v=>!v)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-amber-300"><Sparkles className="size-3.5"/><span className="text-[0.5rem] font-black uppercase tracking-[0.14em]">Starting point</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.56rem] font-black text-white/35">{slip.legs.length} legs{slip.bookmaker?" · "+slip.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{(slip.exactCombinedOdds??slip.fairCombinedOdds)?.toFixed(2)??"—"}</p><p className="text-[0.43rem] uppercase text-white/25">{slip.exactPriced?"exact book price":"model fair odds"}</p></div></div>
      <div className="mt-3 flex items-center justify-between"><span className={"rounded-full px-2.5 py-1 text-[0.5rem] font-black "+(slip.exactPriced?"bg-emerald-400/15 text-emerald-300":"bg-white/7 text-white/40")}>{slip.exactPriced?"BOOKMAKER PRICED":"MODEL PRICE"}</span><ChevronDown className={"size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.fixtureId+"|"+l.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-white/30">{l.competition} · {time(l.kickoff)} · {l.home} v {l.away}</p><p className="mt-1 text-sm font-black">{l.label}</p><p className="mt-0.5 text-[0.54rem] text-white/35">Grade {l.grade}{l.bookmaker?" · "+l.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className="text-[0.43rem] text-white/25">{(l.bookmakerOdds??l.fairOdds).toFixed(2)} odds</p></div></div><p className="mt-2 text-[0.58rem] leading-relaxed text-white/40">{l.reasons.slice(0,2).join(" · ")}</p></div>)}</div>{!slip.exactPriced?<p className="mt-3 text-[0.52rem] text-white/30">Fair odds are model-derived across separate matches and are not a bookmaker quote.</p>:null}</div>:null}
  </article>
}

function PredictionCard({prediction:p}:{prediction:Prediction}){
  const[open,setOpen]=useState(false)
  return <article className="rounded-3xl border border-white/9 bg-white/[0.035] p-4"><button onClick={()=>setOpen(v=>!v)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase text-white/30">{p.competition} · {time(p.kickoff)}</p><h3 className="mt-1 text-base font-black">{p.home} <span className="text-white/25">v</span> {p.away}</h3><p className="mt-2 text-[0.58rem] text-white/45">{p.homeStats.position}th v {p.awayStats.position}th · form {p.homeStats.recentForm} / {p.awayStats.recentForm}</p></div><ChevronDown className={"mt-1 size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5"><Small label={p.home+" win"} value={percent(p.probabilities.homeWin)}/><Small label="Draw" value={percent(p.probabilities.draw)}/><Small label={p.away+" win"} value={percent(p.probabilities.awayWin)}/></div>
      <div className="mt-2 grid grid-cols-2 gap-1.5"><Small label="BTTS Yes" value={percent(p.probabilities.bttsYes)}/><Small label="BTTS No" value={percent(p.probabilities.bttsNo)}/></div></button>
      {open?<div className="mt-3 border-t border-white/8 pt-3"><div className="grid grid-cols-2 gap-2"><Small label={p.home+" home win"} value={percent(p.homeStats.venueWinRate)}/><Small label={p.away+" away win"} value={percent(p.awayStats.venueWinRate)}/><Small label={p.home+" home PPG"} value={Number(p.homeStats.venuePPG).toFixed(2)}/><Small label={p.away+" away PPG"} value={Number(p.awayStats.venuePPG).toFixed(2)}/></div><div className="mt-3 rounded-2xl bg-black/20 p-3"><p className="text-[0.5rem] font-black uppercase text-white/25">Model read</p>{p.winnerPick?<p className="mt-1 text-sm font-black">{p.winnerPick.team} to win · {percent(p.winnerPick.probability)} · Grade {p.winnerPick.grade}</p>:<p className="mt-1 text-sm font-black">No strong direct winner call</p>}{p.bttsPick?<p className="mt-1 text-sm font-black">BTTS {p.bttsPick.selection==="yes"?"Yes":"No"} · {percent(p.bttsPick.probability)} · Grade {p.bttsPick.grade}</p>:null}<p className="mt-2 text-[0.6rem] leading-relaxed text-white/40">{p.reasons.join(" · ")}</p></div></div>:null}
    </article>
}

function Small({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/20 p-2.5 text-center"><p className="font-mono text-sm font-black">{value}</p><p className="mt-0.5 truncate text-[0.43rem] font-black uppercase text-white/25">{label}</p></div>}
