"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, CalendarDays, ChevronDown, Flame, RefreshCw, ShieldCheck, Sparkles, Target, Trophy } from "lucide-react"

type Leg={fixtureId:string;competition:string;kickoff:string;home:string;away:string;inPlay?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;market:string;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null;bookmaker:string|null;grade:"A"|"B"|"C"|"D";reasons:string[]}
type Slip={id:string;title:string;subtitle:string;legs:Leg[];fairCombinedOdds:number|null;bookmaker:string|null;exactCombinedOdds:number|null;exactPriced:boolean;available?:boolean;requiredLegs?:number;containsLive?:boolean;modelAllHitProbability?:number|null;adjustedAllHitProbability?:number|null;historicalStructureSample?:number;historicalStructureHitRate?:number|null;combinedProbabilityNote?:string}
type Prediction={id:string;competition:string;kickoff:string;status?:string;inPlay?:boolean;finished?:boolean;bttsSettled?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;homeStats:any;awayStats:any;h2h:any;preMatchProbabilities?:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};probabilities:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};winnerPick?:{side:string;team:string;loser:string;probability:number;grade:string}|null;drawPick?:{probability:number;grade:string}|null;bttsPick?:{selection:string;probability:number;grade:string}|null;reasons:string[]}
type RiskMode="safe"|"balanced"|"aggressive"
type Outcome="home"|"draw"|"away"
type Response={ok:boolean;date?:string;fixtureCount?:number;activeFixtureCount?:number;finishedFixtureCount?:number;predictions?:Prediction[];finishedPredictions?:Prediction[];slips?:Slip[];generatedAt?:string;cached?:boolean;staleFallback?:boolean;warning?:string;error?:string}

function londonDate(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=(t:string)=>p.find(x=>x.type===t)?.value??"";return v("year")+"-"+v("month")+"-"+v("day")}
function addDays(date:string,days:number){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function prettyDate(date:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"long",day:"numeric",month:"long"}).format(new Date(date+"T12:00:00Z"))}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function time(v:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}

export default function AccumulatorPage(){
  const[date,setDate]=useState(londonDate)
  const[resolvedDate,setResolvedDate]=useState(londonDate)
  const[autoAdvanced,setAutoAdvanced]=useState(false)
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)
  const[risk,setRisk]=useState<RiskMode>("safe")
  const[selectedOutcomes,setSelectedOutcomes]=useState<Record<string,Outcome>>({})
  const[manualOpen,setManualOpen]=useState(false)
  const load=useCallback(async(force=false)=>{
    setLoading(true)
    try{
      const fetchAcca=async(targetDate:string)=>{
        const q=new URLSearchParams({date:targetDate})
        if(force)q.set("refresh",String(Date.now()))
        const r=await fetch("/api/match-acca?"+q.toString(),{cache:force?"no-store":"default"})
        return r.ok?await r.json() as Response:{ok:false,error:"Accumulator analysis failed"} as Response
      }
      let target=date
      let response=await fetchAcca(target)
      let advanced=false
      const hasActive=(x:Response)=>x.ok&&Number(x.activeFixtureCount??x.predictions?.length??0)>0
      if(!hasActive(response)){
        for(let offset=1;offset<=21;offset++){
          const next=addDays(date,offset)
          const candidate=await fetchAcca(next)
          if(hasActive(candidate)){
            target=next
            response=candidate
            advanced=true
            break
          }
        }
      }
      setResolvedDate(target)
      setAutoAdvanced(advanced)
      setData(response)
    }catch{
      setResolvedDate(date)
      setAutoAdvanced(false)
      setData({ok:false,error:"Accumulator analysis failed"})
    }finally{setLoading(false)}
  },[date])
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

  const manualPicks=useMemo(()=>{
    const rows:(Prediction&{outcome:Outcome;label:string;probability:number;fairOdds:number})[]=[]
    for(const p of data?.predictions??[]){
      const outcome=selectedOutcomes[p.id]
      if(!outcome)continue
      const probability=outcome==="home"?p.probabilities.homeWin:outcome==="draw"?p.probabilities.draw:p.probabilities.awayWin
      const label=outcome==="home"?p.home+" to win":outcome==="away"?p.away+" to win":"Draw"
      rows.push({...p,outcome,label,probability,fairOdds:probability>0?1/probability:99})
    }
    return rows
  },[data?.predictions,selectedOutcomes])
  const manualProbability=manualPicks.length?manualPicks.reduce((v,p)=>v*Math.max(.01,p.probability),1):null
  const manualOdds=manualProbability?1/manualProbability:null
  const manualRisk=manualOdds==null?"":manualOdds<=5?"Safe":manualOdds<=12?"Balanced":"Risky"
  function chooseOutcome(fixtureId:string,outcome:Outcome){
    setSelectedOutcomes(cur=>cur[fixtureId]===outcome?Object.fromEntries(Object.entries(cur).filter(([id])=>id!==fixtureId)):{...cur,[fixtureId]:outcome})
  }

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl"><div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-amber-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div><h1 className="mt-1 text-2xl font-black">Acca Builder</h1><p className="mt-1 text-xs text-white/45">Choose your risk. The engine builds the strongest multi-match route.</p></div><button onClick={()=>void load(true)} className="rounded-xl bg-amber-300 p-2.5 text-amber-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"><CalendarDays className="size-4 text-amber-300"/><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/></div>
    </div></header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {autoAdvanced?<section className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-3"><p className="text-xs font-black text-amber-100">No more qualifying fixtures on {prettyDate(date)}</p><p className="mt-1 text-[0.58rem] text-white/40">Showing the next available matchday: {prettyDate(resolvedDate)}.</p></section>:null}
      <section className="rounded-3xl border border-amber-300/12 bg-gradient-to-br from-amber-300/[0.08] to-black/20 p-4">
        <div className="flex items-start gap-3"><Target className="mt-0.5 size-4 text-amber-300"/><div><p className="text-sm font-black">Choose your build</p><p className="mt-1 text-[0.62rem] leading-relaxed text-white/45">Like the best acca tools, risk is the first decision. Safe targets five stronger legs, Balanced targets seven, and Aggressive targets ten. Every leg comes from a different match.</p></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <RiskButton mode="safe" active={risk==="safe"} onClick={()=>setRisk("safe")} title="Safe" sub="5 fold" icon={<ShieldCheck className="size-4"/>}/>
          <RiskButton mode="balanced" active={risk==="balanced"} onClick={()=>setRisk("balanced")} title="Balanced" sub="7 fold" icon={<Activity className="size-4"/>}/>
          <RiskButton mode="aggressive" active={risk==="aggressive"} onClick={()=>setRisk("aggressive")} title="Risky" sub="10 fold" icon={<Flame className="size-4"/>}/>
        </div>
      </section>

      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-amber-300"/><p className="font-black">Analysing the matchday…</p></section>:null}
      {!loading&&data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Accumulator analysis unavailable</p><p className="mt-1 text-sm text-white/40">{data?.error??"Try another date."}</p></section>:null}

      {data?.ok?<>{data.staleFallback?<section className="rounded-2xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-[0.62rem] text-amber-100">{data.warning??"Showing the last successful cached analysis because a fresh data pull failed."}</section>:null}<section className="grid grid-cols-2 gap-2 sm:grid-cols-5"><Metric label="Matchday" value={resolvedDate===date?"Selected":"Next"}/><Metric label="Active fixtures" value={String(data.activeFixtureCount??data.predictions?.length??0)}/><Metric label="Live matches" value={String((data.predictions??[]).filter(p=>p.inPlay).length)}/><Metric label="Build" value={risk==="safe"?"5 fold":risk==="balanced"?"7 fold":"10 fold"}/><Metric label="Updated" value={data.generatedAt?new Date(data.generatedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—"}/></section>

      {selectedSlip?<><AccaSnapshot slip={selectedSlip}/><section className="space-y-3"><div className="px-1"><p className="font-black">{risk==="safe"?"Safer":"Selected"} build</p><p className="text-[0.6rem] text-white/35">The weakest leg and combined chance are visible before you expand the full slip.</p></div><SlipCard slip={selectedSlip} hero/></section></>:<section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center"><p className="font-black">No {risk} build available</p><p className="mt-1 text-sm text-white/35">There are not enough qualifying matches for this risk level on {prettyDate(resolvedDate)}.</p></section>}

      <details className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-black text-white/45">Compare all acca builds</summary><div className="mt-3 space-y-3">{(data.slips??[]).map(s=><SlipCard key={"compare-"+s.id} slip={s}/>)}</div></details>

      <section className="space-y-3"><div className="px-1"><p className="font-black">Build your own acca</p><p className="mt-1 text-[0.6rem] text-white/35">Tap Home, Draw or Away. Green is the strongest result call, amber is closer, red is less likely. Your slip updates at the bottom.</p></div>{(data.predictions??[]).map(p=><OutcomeCard key={p.id} prediction={p} selected={selectedOutcomes[p.id]??null} onSelect={o=>chooseOutcome(p.id,o)}/>)}</section>
      {(data.finishedPredictions?.length??0)>0?<details className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-black text-white/45">Finished matches ({data.finishedPredictions?.length})</summary><div className="mt-3 space-y-2">{(data.finishedPredictions??[]).map(p=><PredictionCard key={"finished-"+p.id} prediction={p}/>)}</div></details>:null}</>:null}
    </div>
    {manualPicks.length?<ManualAccaTray picks={manualPicks} probability={manualProbability} odds={manualOdds} risk={manualRisk} open={manualOpen} setOpen={setManualOpen} onRemove={id=>setSelectedOutcomes(cur=>Object.fromEntries(Object.entries(cur).filter(([key])=>key!==id)))} onClear={()=>setSelectedOutcomes({})}/>:null}
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

function outcomeTone(probability:number,isBest:boolean,selected:boolean){
  if(selected)return "border-white bg-white text-[#07120e]"
  if(isBest&&probability>=.40)return "border-emerald-300/35 bg-emerald-400/12 text-emerald-200"
  if(probability>=.30)return "border-amber-300/25 bg-amber-300/8 text-amber-100"
  return "border-rose-300/20 bg-rose-400/[0.055] text-rose-100/80"
}
function OutcomeCard({prediction:p,selected,onSelect}:{prediction:Prediction;selected:Outcome|null;onSelect:(o:Outcome)=>void}){
  const probs={home:p.probabilities.homeWin,draw:p.probabilities.draw,away:p.probabilities.awayWin}
  const best=Math.max(probs.home,probs.draw,probs.away)
  const rows:[Outcome,string,number][]=[["home",p.home,probs.home],["draw","Draw",probs.draw],["away",p.away,probs.away]]
  return <article className="rounded-3xl border border-white/9 bg-white/[0.035] p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-white/25">{p.competition} · {time(p.kickoff)}</p><p className="mt-1 text-sm font-black">{p.home} <span className="text-white/25">v</span> {p.away}</p></div>{p.inPlay&&p.score?<span className="rounded-full bg-rose-300/12 px-2 py-1 text-[0.45rem] font-black text-rose-200">LIVE {p.elapsed??"?"}' · {p.score.home}-{p.score.away}</span>:null}</div>
    <div className="mt-3 grid grid-cols-3 gap-2">{rows.map(([outcome,label,probability])=><button key={outcome} onClick={()=>onSelect(outcome)} className={"rounded-2xl border px-2 py-3 text-center transition "+outcomeTone(probability,probability===best,selected===outcome)}><p className="truncate text-[0.55rem] font-black">{label}</p><p className="mt-1 font-mono text-lg font-black">{percent(probability)}</p><p className="mt-0.5 text-[0.42rem] font-black uppercase opacity-55">{(1/Math.max(.01,probability)).toFixed(2)} fair</p></button>)}</div>
    <details className="mt-3"><summary className="cursor-pointer text-[0.5rem] font-black text-white/30">Why these percentages?</summary><p className="mt-2 text-[0.56rem] leading-relaxed text-white/40">{p.reasons.join(" · ")}</p></details>
  </article>
}

function ManualAccaTray({picks,probability,odds,risk,open,setOpen,onRemove,onClear}:{picks:Array<Prediction&{outcome:Outcome;label:string;probability:number;fairOdds:number}>;probability:number|null;odds:number|null;risk:string;open:boolean;setOpen:(v:boolean)=>void;onRemove:(id:string)=>void;onClear:()=>void}){
  const tone=risk==="Safe"?"bg-emerald-300/15 text-emerald-200":risk==="Balanced"?"bg-amber-300/15 text-amber-100":"bg-rose-300/15 text-rose-100"
  return <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-3xl px-3">
    <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#0b1813]/98 shadow-2xl backdrop-blur-xl">
      <button onClick={()=>setOpen(!open)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-left"><div className="flex size-10 items-center justify-center rounded-2xl bg-amber-300 text-amber-950"><Trophy className="size-5"/></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-black">{picks.length} selection{picks.length===1?"":"s"}</p><span className={"rounded-full px-2 py-0.5 text-[0.42rem] font-black "+tone}>{risk.toUpperCase()}</span></div><p className="mt-0.5 text-[0.5rem] text-white/35">Whole-slip model chance {percent(probability)}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{odds?.toFixed(2)??"—"}</p><p className="text-[0.4rem] uppercase text-white/25">predicted odds</p></div></button>
      {open?<div className="border-t border-white/8 bg-black/20 p-3"><div className="max-h-64 space-y-2 overflow-y-auto">{picks.map(p=><div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-black">{p.label}</p><p className="truncate text-[0.46rem] text-white/30">{p.home} v {p.away} · {percent(p.probability)}</p></div><button onClick={()=>onRemove(p.id)} className="rounded-lg bg-white/7 px-2 py-1 text-[0.48rem] font-black text-white/40">REMOVE</button></div>)}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-[0.48rem] leading-relaxed text-white/25">Predicted odds are model fair odds, not a bookmaker quote.</p><button onClick={onClear} className="rounded-xl bg-white/7 px-3 py-2 text-[0.5rem] font-black text-white/45">CLEAR</button></div></div>:null}
    </div>
  </div>
}

function PredictionCard({prediction:p}:{prediction:Prediction}){
  const[open,setOpen]=useState(false)
  return <article className="rounded-3xl border border-white/9 bg-white/[0.035] p-4"><button onClick={()=>setOpen(v=>!v)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase text-white/30">{p.competition} · {time(p.kickoff)}</p><h3 className="mt-1 text-base font-black">{p.inPlay&&p.score?<><span className="text-rose-300">LIVE {p.elapsed??"?"}'</span> · {p.home} {p.score.home}-{p.score.away} {p.away}</>:<>{p.home} <span className="text-white/25">v</span> {p.away}</>}</h3><p className="mt-2 text-[0.58rem] text-white/45">{p.homeStats.position}th v {p.awayStats.position}th · form {p.homeStats.recentForm} / {p.awayStats.recentForm}</p></div><ChevronDown className={"mt-1 size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div>
      {p.inPlay&&p.preMatchProbabilities?<div className="mt-3 rounded-xl bg-rose-400/5 px-3 py-2 text-[0.54rem] text-rose-100/65">Pre-match: {p.home} {percent(p.preMatchProbabilities.homeWin)} · Draw {percent(p.preMatchProbabilities.draw)} · {p.away} {percent(p.preMatchProbabilities.awayWin)} → updated below from the live score.</div>:null}<div className="mt-3 grid grid-cols-3 gap-1.5"><Small label={p.inPlay?p.home+" live win":p.home+" win"} value={percent(p.probabilities.homeWin)}/><Small label="Draw" value={percent(p.probabilities.draw)}/><Small label={p.inPlay?p.away+" live win":p.away+" win"} value={percent(p.probabilities.awayWin)}/></div>
      {p.bttsSettled?<div className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-center text-[0.56rem] font-black text-white/35">BTTS settled — hidden from betting picks</div>:<div className="mt-2 grid grid-cols-2 gap-1.5"><Small label="BTTS Yes" value={percent(p.probabilities.bttsYes)}/><Small label="BTTS No" value={percent(p.probabilities.bttsNo)}/></div>}</button>
      {open?<div className="mt-3 border-t border-white/8 pt-3"><div className="grid grid-cols-2 gap-2"><Small label={p.home+" home win"} value={percent(p.homeStats.venueWinRate)}/><Small label={p.away+" away win"} value={percent(p.awayStats.venueWinRate)}/><Small label={p.home+" home PPG"} value={Number(p.homeStats.venuePPG).toFixed(2)}/><Small label={p.away+" away PPG"} value={Number(p.awayStats.venuePPG).toFixed(2)}/></div><div className="mt-3 rounded-2xl bg-black/20 p-3"><p className="text-[0.5rem] font-black uppercase text-white/25">Model read</p>{p.winnerPick?<><p className="mt-1 text-sm font-black">{p.winnerPick.team} to win · {percent(p.winnerPick.probability)} · Grade {p.winnerPick.grade}</p><p className="mt-1 text-[0.58rem] font-bold text-rose-200/70">Expected loser: {p.winnerPick.loser}</p></>:p.drawPick?<p className="mt-1 text-sm font-black">Draw · {percent(p.drawPick.probability)} · Grade {p.drawPick.grade}</p>:<p className="mt-1 text-sm font-black">No strong direct result call</p>}{p.bttsSettled?<p className="mt-1 text-[0.58rem] font-bold text-white/35">BTTS market already settled in-play.</p>:p.bttsPick?<p className="mt-1 text-sm font-black">BTTS {p.bttsPick.selection==="yes"?"Yes":"No"} · {percent(p.bttsPick.probability)} · Grade {p.bttsPick.grade}</p>:null}<p className="mt-2 text-[0.6rem] leading-relaxed text-white/40">{p.reasons.join(" · ")}</p></div></div>:null}
    </article>
}

function Small({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/20 p-2.5 text-center"><p className="font-mono text-sm font-black">{value}</p><p className="mt-0.5 truncate text-[0.43rem] font-black uppercase text-white/25">{label}</p></div>}
