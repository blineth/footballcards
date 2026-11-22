"use client"
import {useCallback,useEffect,useMemo,useState} from "react"
import Link from "next/link"
import {ArrowLeft,RefreshCw,ShieldCheck,AlertTriangle,Copy,Check,Target} from "lucide-react"

type Market="shot1"|"shot2"|"sot1"|"foul1"|"foul2"|"fouled1"|"card"
type ModelMarket={probability:number;confidence:string;sampleMatches?:number|null;recent5HitRate?:number|null;seasonHitRate?:number|null;h2hHitRate?:number|null;h2hMatches?:number|null}
type BaselinePlayer={name:string;team:string;markets?:Partial<Record<Market,ModelMarket>>;yellowConditionals?:{zeroFouls?:{matches:number;yellows:number;rate:number|null}}}
type Baseline={ok:boolean;players?:BaselinePlayer[];lineupMode?:string;lineupsConfirmed?:boolean;lineupSource?:string}
type Odd={market:string;kind:string;label:string;odd:number;bookmaker?:string}
type Prices={connected?:boolean;priceAvailable?:boolean;source?:string;capturedAt?:string;selections?:Odd[];note?:string}
type LivePlayer={player:string;team:string;starter:boolean;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;yellowCards:number;minutes:number|null;aggressionSignals?:string[]}
type Live={ok:boolean;source?:string;status?:string;elapsed?:number;players?:LivePlayer[];updatedAt?:string;referee?:{name?:string}|null}
type Leg={player:string;team:string;market:Market;p:number;grade:string;price:number;implied:number;edge:number;sample:number|null;recent:number|null;zeroFouls?:{matches:number;yellows:number;rate:number|null};live?:LivePlayer}
const DATE="2026-11-22"
const KICKOFF="2026-11-22T14:00:00Z"
const PATH_PARAMS=new URLSearchParams({date:DATE,home:"Hull City",away:"Brighton & Hove Albion",competition:"Premier League"}).toString()
const MARKETS:Market[]=["shot1","shot2","sot1","foul1","foul2","fouled1","card"]
const MARKET_LABELS:Record<Market,string>={
 shot1:"1+ shot",shot2:"2+ shots",sot1:"1+ shot on target",
 foul1:"1+ foul committed",foul2:"2+ fouls committed",fouled1:"1+ foul drawn",card:"To be booked"
}
const KIND:Record<Market,string>={shot1:"shot",shot2:"shot",sot1:"sot",foul1:"foul",foul2:"foul",fouled1:"fouled",card:"card"}
function normalize(s:string){return String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\(\d+\)/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")}
function priceFor(odds:Odd[],name:string,market:Market){
 const n=normalize(name),label=MARKET_LABELS[market].toLowerCase()
 const exact=odds.filter(o=>o.kind===KIND[market]&&o.bookmaker==="Bet365")
  .find(o=>{
   const parts=o.label.split("·")
   if(parts.length<2||normalize(parts[0])!==n)return false
   return parts.slice(1).join("·").trim().toLowerCase()===label
  })
 return exact&&Number.isFinite(exact.odd)&&exact.odd>1?exact.odd:null
}
function shortlist(rows:Leg[],markets:Market[],count=5,forceBothTeams=true){
 const eligible=rows.filter(x=>markets.includes(x.market)&&x.grade!=="D").sort((a,b)=>b.p-a.p)
 const selected:Leg[]=[],used=new Set<string>()
 if(forceBothTeams)for(const team of ["Hull City","Brighton & Hove Albion"]){
  const pick=eligible.find(x=>x.team===team)
  if(pick){selected.push(pick);used.add(normalize(pick.player))}
 }
 for(const x of eligible){
  if(selected.length>=count)break
  if(used.has(normalize(x.player)))continue
  selected.push(x);used.add(normalize(x.player))
 }
 return selected
}
const pct=(n:number)=>Number.isFinite(n)?(n*100).toFixed(1)+"%":"—"
const dec=(n:number)=>Number(n).toFixed(n<2?3:2)
export default function HullBrightonToday(){
 const[baseline,setBaseline]=useState<Baseline|null>(null)
 const[prices,setPrices]=useState<Prices|null>(null)
 const[live,setLive]=useState<Live|null>(null)
 const[loaded,setLoaded]=useState<string|null>(null)
 const[loading,setLoading]=useState(false)
 const[marketFilter,setMarketFilter]=useState<Market|"all">("all")
 const[gradeFilter,setGradeFilter]=useState(false)
 const[copied,setCopied]=useState<string|null>(null)
 const refresh=useCallback(async()=>{
  setLoading(true)
  const endpoints=["/api/live-player-baseline?"+PATH_PARAMS,"/api/bet-builder-odds?"+PATH_PARAMS,"/api/live-player-stats?"+PATH_PARAMS]
  const outcomes=await Promise.allSettled(endpoints.map(async path=>{
   const controller=new AbortController()
   const timer=window.setTimeout(()=>controller.abort(),path.includes("bet-builder-odds")?12_000:9_000)
   try{
     const res=await fetch(path,{cache:"no-store",signal:controller.signal})
     if(!res.ok)throw Error(path+" HTTP "+res.status)
     return await res.json()
   }finally{window.clearTimeout(timer)}
  }))
  if(outcomes[0].status==="fulfilled")setBaseline(outcomes[0].value as Baseline)
  if(outcomes[1].status==="fulfilled")setPrices(outcomes[1].value as Prices)
  if(outcomes[2].status==="fulfilled")setLive(outcomes[2].value as Live)
  setLoaded(new Date().toISOString());setLoading(false)
 },[])
 useEffect(()=>{
  void refresh()
  const timer=setInterval(()=>{void refresh()},60_000)
  return()=>clearInterval(timer)
 },[refresh])
 const starters=useMemo(()=>new Map((live?.players??[]).filter(p=>p.starter).map(p=>[normalize(p.player),p])),[live])
 const lineupVerified=live?.source!=null&&starters.size===22
 const legs=useMemo(()=>{
  if(!lineupVerified||!baseline?.players?.length||!prices?.selections?.length)return [] as Leg[]
  const ret:Leg[]=[]
  for(const p of baseline.players){
   const active=starters.get(normalize(p.name))
   if(!active)continue
   for(const market of MARKETS){
    const model=p.markets?.[market]
    if(!model||!Number.isFinite(model.probability)||model.probability<=0)continue
    const price=priceFor(prices.selections,p.name,market)
    if(price==null)continue
    const implied=1/price
    ret.push({player:p.name,team:p.team,market,p:model.probability,grade:model.confidence??"D",price,implied,edge:model.probability-implied,sample:model.sampleMatches??null,recent:model.recent5HitRate??null,zeroFouls:p.yellowConditionals?.zeroFouls,live:active})
   }
  }
  return ret
 },[baseline,prices,lineupVerified,starters])
 const kickStarted=(live?.status==="live"||live?.status==="halftime"||live?.status==="finished")||Date.now()>=Date.parse(KICKOFF)
 const sorted=useMemo(()=>legs.filter(x=>marketFilter==="all"||x.market===marketFilter).filter(x=>!gradeFilter||x.grade==="A"||x.grade==="B")
  .sort((a,b)=>b.p-a.p||b.edge-a.edge),[legs,marketFilter,gradeFilter])
 const plans=[
  {name:"Highest probability · five legs",subtitle:"Shots and 1+ foul involvement, ranked for individual estimated hit chance",markets:["shot1","foul1","fouled1"] as Market[]},
  {name:"Shots-only · five legs",subtitle:"One shot market per player, no cards",markets:["shot1","shot2","sot1"] as Market[]},
  {name:"Fouls-only · five legs",subtitle:"Fouls committed or drawn, with no card requirement",markets:["foul1","foul2","fouled1"] as Market[]},
 ] as const
 const copy=async(name:string,items:Leg[])=>{
  const note="HULL v BRIGHTON | 22 Nov 2026 | RESEARCH ONLY | Bet365 individual leg odds; no verified combined builder price."
  const content=[note,name,...items.map(x=>x.player+" ("+x.team+") — "+MARKET_LABELS[x.market]+" — model "+pct(x.p)+" — Bet365 "+dec(x.price))].join("\n")
  try{await navigator.clipboard.writeText(content);setCopied(name)}catch{setCopied(null)}
 }
 const cards=legs.filter(p=>p.market==="card").sort((a,b)=>b.p-a.p)
 const valueWatch=legs.filter(p=>p.edge>0&&p.grade!=="D")
   .sort((a,b)=>b.edge-a.edge).slice(0,8)
 const pricedBelowModel=legs.filter(p=>p.edge<=0).length
 return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
  <div className="border-b border-white/10"><div className="mx-auto max-w-5xl px-4 py-5">
   <div className="flex items-center gap-3">
    <Link href="/today" className="rounded-xl bg-white/10 p-2"><ArrowLeft className="size-4"/></Link>
    <div className="flex-1"><p className="text-[0.58rem] font-black uppercase tracking-[.16em] text-emerald-300">Football Cards · Match Centre</p>
     <h1 className="text-2xl font-black sm:text-3xl">Hull City <span className="text-white/30">vs</span> Brighton</h1>
     <p className="mt-1 text-xs text-white/45">Sunday 22 November · 14:00 GMT · MKM Stadium</p>
    </div>
    <button onClick={()=>void refresh()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold">
     <RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/><span className="hidden sm:inline">Refresh</span>
    </button>
   </div>
   <p className="mt-3 text-[0.65rem] text-white/45">Last data check: {loaded?new Date(loaded).toLocaleTimeString("en-GB",{hour12:false}):"Loading"} · automatic refresh every 60 seconds</p>
  </div></div>
  <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
   <div className="grid gap-3 sm:grid-cols-3">
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
     <p className="text-[0.6rem] uppercase text-white/45">Starting XI</p>
     <p className="mt-1 font-black">{lineupVerified?"22 verified starters":"Verifying"}</p>
     <p className="text-[0.6rem] text-white/45">{live?.source??"Official team data pending"}</p>
    </div>
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
     <p className="text-[0.6rem] uppercase text-white/45">Bookmaker market</p>
     <p className="mt-1 font-black">{prices?.priceAvailable?"Bet365 prices received":"Awaiting exact prices"}</p>
     <p className="text-[0.6rem] text-white/45">{prices?.source??"Unavailable"} · {prices?.capturedAt?new Date(prices.capturedAt).toLocaleTimeString("en-GB",{hour12:false}):"not timestamped"}</p>
    </div>
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
     <p className="text-[0.6rem] uppercase text-white/45">Fixture status</p>
     <p className="mt-1 font-black">{live?.status==="live"?"LIVE · "+(live?.elapsed??0)+"′":live?.status==="halftime"?"Half-time":live?.status==="finished"?"Finished":kickStarted?"Kickoff reached":"Pre-match"}</p>
     <p className="text-[0.6rem] text-white/45">{legs.length} eligible starting-XI markets with exact individual prices</p>
    </div>
   </div>
   {kickStarted?<section className="flex gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-3 text-xs text-amber-100"><AlertTriangle className="size-4 shrink-0"/> The match has started or reached kick-off. These model probabilities are PRE-MATCH only; prices may have expired. Do not use them as live bet quotes. Use live player counts as progress, not recalculated in-play probabilities.</section>:null}
   {!lineupVerified?<section className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3 text-xs text-amber-100">Exact starting XI has not yet been independently verified from the match feed. No provisional selection is treated as a confirmed starter.</section>:null}
   <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
    <div className="flex gap-2"><ShieldCheck className="size-5 text-emerald-300"/><div><h2 className="font-black">Selection methodology</h2>
     <p className="mt-1 text-xs leading-relaxed text-white/55">Only confirmed starters with an <strong>exact Bet365 market price</strong> appear below. Percentages are model estimates, while the quoted decimal prices are individual bookmaker prices. No same-game builder quote or fivefold probability is invented. The historical dissent model stays in shadow testing.</p>
    </div></div>
   </section>
   <section className="space-y-3">
    <div className="flex items-center gap-2"><Target className="size-4 text-emerald-300"/><h2 className="text-xl font-black">Five-leg research combinations</h2></div>
    {plans.map(plan=>{
     const picks=shortlist(legs,plan.markets,5,true)
     return <div key={plan.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black">{plan.name}</h3><p className="mt-1 text-xs text-white/45">{plan.subtitle}</p></div>
       <button disabled={picks.length===0} onClick={()=>void copy(plan.name,picks)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-bold">{copied===plan.name?<Check className="size-3.5"/>:<Copy className="size-3.5"/>}{copied===plan.name?"Copied":"Copy legs"}</button>
      </div>
      <div className="mt-3 space-y-2">{picks.map((p,i)=><div key={p.player+p.market} className="flex items-center justify-between gap-3 rounded-xl bg-black/25 px-3 py-2.5">
       <div className="min-w-0"><p className="text-sm font-bold">{i+1}. {p.player}</p>
        <p className="mt-1 text-[0.65rem] text-white/50">{MARKET_LABELS[p.market]} · {p.team==="Hull City"?"HUL":"BHA"} · evidence {p.grade}</p></div>
       <div className="shrink-0 text-right"><p className="font-mono text-sm font-black">{pct(p.p)}</p><p className="mt-0.5 text-xs font-bold text-emerald-200">Bet365 {dec(p.price)}</p></div>
      </div>)}</div>
      <p className="mt-3 text-[0.62rem] text-amber-100/65">{picks.length<5?"Only "+picks.length+" qualifying priced starters.":""} Quoted individual odds are verified, but many legs are priced shorter than their model-implied fair odds. These are probability-first research selections, NOT automatically positive-value bets. No combined bet-builder price or guaranteed hit rate is available. Correlation between legs is not priced by multiplying singles.</p>
     </div>
    })}
   </section>
   <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div>
      <h2 className="font-black">Model vs bookmaker · possible value</h2>
      <p className="mt-1 text-xs leading-relaxed text-white/50">Only markets where the model's estimated probability exceeds Bet365's raw implied probability. A positive difference is <strong>not</strong> proof of genuine value: the model can be miscalibrated, the bookmaker margin is included and the historical shadow calibration is not live.</p>
     </div><p className="text-xs text-white/45">{pricedBelowModel} of {legs.length} priced markets are at or below bookmaker-implied chance</p>
    </div>
    <div className="mt-3 space-y-2">{valueWatch.map(p=><div key={p.player+p.market} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-black/25 p-3">
     <div className="min-w-0"><p className="text-sm font-bold">{p.player}</p><p className="mt-1 text-xs text-white/55">{MARKET_LABELS[p.market]} · evidence {p.grade}</p><p className="mt-1 text-[0.65rem] text-white/45">Model {pct(p.p)} · bookmaker-implied {pct(p.implied)}</p></div>
     <div className="text-right"><p className="text-sm font-black text-emerald-200">{dec(p.price)}</p><p className="mt-1 text-xs text-white/55">+{(p.edge*100).toFixed(1)} points</p></div>
    </div>)}
    {!valueWatch.length?<p className="mt-3 text-xs text-white/50">No verified positive-edge candidate currently clears the basic model-versus-price screen.</p>:null}</div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-black">Yellow-card candidates</h2>
     <p className="mt-1 text-xs text-white/45">Card model + exact priced markets; dissent/late-card hypothesis not yet validated.</p></div><AlertTriangle className="size-4 text-amber-200"/></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{cards.slice(0,6).map(p=><div key={p.player} className="rounded-xl bg-black/25 p-3">
     <div className="flex justify-between gap-2"><p className="text-sm font-bold">{p.player}</p><p className="font-mono font-black">{pct(p.p)}</p></div>
     <p className="mt-1 text-xs text-white/50">{p.team} · Bet365 {dec(p.price)} · evidence {p.grade}</p>
     {p.zeroFouls?.matches?<p className="mt-1 text-[0.62rem] text-white/40">{p.zeroFouls.yellows}/{p.zeroFouls.matches} recorded zero-foul games with cards (reason unverified)</p>:null}
    </div>)}</div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">All verified starter markets</h2><p className="mt-1 text-xs text-white/45">Filter by player-prop type, with model probability and exact Bet365 singles price</p></div>
     <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={gradeFilter} onChange={e=>setGradeFilter(e.target.checked)}/> A/B evidence only</label>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
     {(["all",...MARKETS] as Array<Market|"all">).map(k=><button key={k} onClick={()=>setMarketFilter(k)} className={"rounded-lg border px-2.5 py-1.5 text-xs font-bold "+(marketFilter===k?"border-emerald-300/50 bg-emerald-300/15 text-emerald-100":"border-white/10 bg-white/5 text-white/60")}>{k==="all"?"All":MARKET_LABELS[k]}</button>)}
    </div>
    <div className="mt-3 max-h-[650px] space-y-1.5 overflow-y-auto">{sorted.slice(0,90).map(p=><div key={p.player+"|"+p.market} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg bg-black/25 px-3 py-2.5">
     <div className="min-w-0"><p className="truncate text-xs font-bold">{p.player}</p><p className="text-[0.63rem] text-white/45">{MARKET_LABELS[p.market]} · {p.team==="Hull City"?"HUL":"BHA"} · {p.grade}</p></div>
     <div className="text-right"><p className="text-xs font-black">{pct(p.p)}</p><p className="text-[0.58rem] text-white/40">Model</p></div>
     <div className="text-right"><p className="text-xs font-black text-emerald-200">{dec(p.price)}</p><p className="text-[0.58rem] text-white/40">Bet365</p></div>
    </div>)}
    {!sorted.length?<p className="py-6 text-center text-sm text-white/45">Waiting for confirmed starter-level prices. Refresh to recheck.</p>:null}
    </div>
   </section>
   <p className="text-[0.65rem] leading-relaxed text-white/40">Player statistics, probability calibration and bookmaker quotes can update or be withdrawn. Prices shown are independent singles; a bookmaker must provide the actual combined quote before a same-game bet-builder price is known. The model has not demonstrated a sustained 75% real-world hit rate. No wager has been placed.</p>
   <Link href="/accuracy" className="block rounded-xl bg-white/10 px-4 py-3 text-center text-sm font-bold">Historical accuracy and learning report</Link>
  </div>
 </main>
}