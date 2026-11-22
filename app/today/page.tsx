"use client"
import {useCallback,useEffect,useMemo,useState} from "react"
import Link from "next/link"
import {ArrowLeft,RefreshCw,AlertTriangle,Target,Activity} from "lucide-react"

type Market="shot1"|"shot2"|"foul1"|"foul2"|"fouled1"|"sot1"|"card"
type Player={name:string;team:string;markets?:Partial<Record<Market,{probability:number;confidence:string;sampleMatches?:number;recent5HitRate?:number}>>}
type Baseline={ok:boolean;lineupMode?:string;lineupsConfirmed?:boolean;priceAvailable?:boolean;players?:Player[];fallbackReason?:string}
type Pick={game:number;player:string;team:string;market:Market;p:number;confidence:string;sample:number|null}
const GAMES=[{home:"Hull City",away:"Brighton & Hove Albion",kickoff:"14:00",date:"2026-11-22"},{home:"Liverpool",away:"Manchester United",kickoff:"16:30",date:"2026-11-22"}]
const LABELS:Record<Market,string>={shot1:"1+ shot",shot2:"2+ shots",foul1:"1+ foul committed",foul2:"2+ fouls committed",fouled1:"1+ foul drawn",sot1:"1+ shot on target",card:"Yellow card"}
const pct=(n:number)=>Number.isFinite(n)?(n*100).toFixed(1)+"%":"—"
function draft(picks:Pick[],markets:Market[],size:number,perGame:boolean){
 const filtered=picks.filter(p=>markets.includes(p.market)).sort((a,b)=>b.p-a.p)
 const selected:Pick[]=[],seen=new Set<string>()
 if(perGame)for(let g=0;g<2;g++){
  const first=filtered.find(p=>p.game===g)
  if(first){selected.push(first);seen.add(first.game+"|"+first.player)}
 }
 for(const p of filtered){
  if(selected.length>=size)break
  if(seen.has(p.game+"|"+p.player))continue
  selected.push(p);seen.add(p.game+"|"+p.player)
 }
 return selected
}
export default function TodayPage(){
 const[data,setData]=useState<(Baseline|null)[]>([null,null])
 const[loading,setLoading]=useState(false)
 const[loadedAt,setLoadedAt]=useState<string|null>(null)
 const refresh=useCallback(async()=>{
  setLoading(true)
  const results=await Promise.all(GAMES.map(async g=>{
   try{
    const params=new URLSearchParams({date:g.date,home:g.home,away:g.away,competition:"Premier League"})
    const r=await fetch("/api/live-player-baseline?"+params,{cache:"no-store"})
    return await r.json() as Baseline
   }catch{return {ok:false} as Baseline}
  }))
  setData(results);setLoadedAt(new Date().toISOString());setLoading(false)
 },[])
 useEffect(()=>{void refresh()},[refresh])
 const picks=useMemo(()=>{
  const out:Pick[]=[]
  for(let g=0;g<data.length;g++)for(const p of data[g]?.players??[]){
   for(const market of Object.keys(LABELS) as Market[]){
    const v=p.markets?.[market]
    if(v&&Number.isFinite(v.probability)&&v.probability>0)
     out.push({game:g,player:p.name,team:p.team,market,p:v.probability,confidence:v.confidence??"D",sample:v.sampleMatches??null})
   }
  }
  return out
 },[data])
 const plans=[
  {name:"Shot-led 5",note:"One player market per footballer, led by historical shot likelihood. Not an offered bookmaker accumulator.",markets:["shot1","shot2"] as Market[],size:5},
  {name:"Mixed 5",note:"Shots, fouls committed and fouls drawn across both matches. Not an offered bookmaker accumulator.",markets:["shot1","foul1","fouled1"] as Market[],size:5},
  {name:"Fouls / drawn 5",note:"A foul-focused research selection; player confirmations remain essential.",markets:["foul1","fouled1","foul2"] as Market[],size:5},
 ]
 const cardPicks=picks.filter(p=>p.market==="card").sort((a,b)=>b.p-a.p).slice(0,6)
 return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
  <header className="border-b border-white/10"><div className="mx-auto max-w-4xl px-4 py-5">
    <div className="flex items-center gap-3"><Link href="/accuracy" className="rounded-xl bg-white/10 p-2"><ArrowLeft className="size-4"/></Link>
      <div className="flex-1"><p className="text-[0.6rem] font-black uppercase tracking-wider text-emerald-300">Football Cards · Match Edge</p><h1 className="text-2xl font-black">Today's fixtures & research slips</h1></div>
      <button disabled={loading} onClick={()=>void refresh()} className="rounded-xl bg-white/10 p-3" aria-label="Refresh"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
    </div>
    <p className="mt-3 text-xs text-white/45">Sunday 22 November 2026 · UK time · {loadedAt?"Refreshed "+new Date(loadedAt).toLocaleTimeString("en-GB"):"Loading"}</p>
  </div></header>
  <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
   <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.055] p-4 text-xs leading-relaxed text-white/65">
     <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-200"/><p><strong className="text-white">Research selections, not verified bookmaker bet slips.</strong> These reflect the existing pre-match baseline. Do not treat them as placeable odds or final selections until both the official XI and exact market prices are confirmed. The historical shadow model is not automatically applied.</p></div>
   </section>
   <Link href="/today/hull-brighton" className="block rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4 text-sm font-black text-emerald-100">Hull City vs Brighton — confirmed starters, live Bet365 single-market odds, model rankings and five-leg research builders →</Link>
   <section className="grid gap-3 sm:grid-cols-2">{GAMES.map((g,i)=><div key={g.home} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs font-bold text-emerald-200">{g.kickoff} · Premier League</p><h2 className="mt-1 text-lg font-black">{g.home} v {g.away}</h2>
      <p className="mt-2 text-xs text-white/55">Lineups: {data[i]?.lineupsConfirmed?"Confirmed":data[i]?.lineupMode==="predicted"?"Predicted only":"Not verified"} · bookmaker prices: {data[i]?.priceAvailable?"Source reports prices":"Unverified"}</p>
      <p className="mt-1 text-xs text-white/40">{data[i]?.players?.length??0} players modelled</p>
      {!data[i]?.ok&&data[i]?<p className="mt-1 text-xs text-rose-200">Player baseline not available</p>:null}
      <div className="mt-3 space-y-2">{picks.filter(p=>p.game===i&&p.market!=="card").sort((a,b)=>b.p-a.p).slice(0,4).map((p,j)=><div key={j} className="flex items-center justify-between gap-2 rounded-lg bg-black/25 p-2">
       <div><p className="text-xs font-bold">{p.player}</p><p className="text-[0.56rem] text-white/40">{LABELS[p.market]} · evidence grade {p.confidence}</p></div><p className="font-mono text-sm font-black">{pct(p.p)}</p>
      </div>)}</div>
   </div>)}</section>
   <div className="flex items-center gap-2"><Target className="size-4 text-emerald-300"/><h2 className="text-xl font-black">Provisional five-leg combinations</h2></div>
   <p className="text-xs text-white/45">Leg percentages are model estimates, not historical proof or independently validated 75% picks. Joint probability and combined odds are intentionally withheld without verified correlation and bookmaker pricing.</p>
   {plans.map(plan=>{const legs=draft(picks,plan.markets,plan.size,true);return <section key={plan.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <h3 className="font-black">{plan.name}</h3><p className="mt-1 text-xs text-white/45">{plan.note}</p>
    <div className="mt-3 space-y-2">{legs.map((p,i)=><div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-black/25 p-3">
      <div><p className="text-sm font-bold">{p.player}</p><p className="mt-1 text-[0.58rem] text-white/45">{p.team} · {LABELS[p.market]} · grade {p.confidence}</p></div><span className="font-mono text-base font-black">{pct(p.p)}</span>
    </div>)}</div>
    <p className="mt-2 text-[0.6rem] text-amber-100/65">{legs.length===5?"Five provisional candidates; not a priced or approved slip.":"Only "+legs.length+" eligible candidates from the current baseline."}</p>
   </section>})}
   <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <div className="flex items-center gap-2"><Activity className="size-4 text-amber-200"/><h2 className="font-black">Yellow-card watchlist — not a slip</h2></div>
    <p className="mt-1 text-xs text-white/45">Low-probability card markets remain separate until the dissent and late-card hypotheses pass independent validation.</p>
    <div className="mt-3 space-y-2">{cardPicks.map((p,i)=><div key={i} className="flex items-center justify-between rounded-lg bg-black/25 p-3"><p className="text-xs"><strong>{p.player}</strong><span className="ml-2 text-white/40">{p.team}</span></p><p className="font-mono text-sm font-black">{pct(p.p)}</p></div>)}</div>
   </section>
   <Link href="/accuracy" className="block rounded-xl bg-white/10 px-4 py-3 text-center text-sm font-bold">Review historical learning and validation</Link>
  </div>
 </main>
}