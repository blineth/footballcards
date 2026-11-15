"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Activity, CalendarDays, ChevronDown, Flame, RefreshCw, ShieldCheck, Sparkles, Target, Trophy, X } from "lucide-react"
import { addTrackedBet } from "@/lib/tracked-bets"

type Leg={fixtureId:string;competition:string;kickoff:string;home:string;away:string;inPlay?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;market:string;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null;bookmaker:string|null;grade:"A"|"B"|"C"|"D";reasons:string[]}
type Slip={id:string;title:string;subtitle:string;legs:Leg[];fairCombinedOdds:number|null;bookmaker:string|null;exactCombinedOdds:number|null;exactPriced:boolean;confirmedBet365Odds?:boolean;oddsSource?:string|null;oddsCapturedAt?:string|null;oddsVerifiedAt?:string|null;available?:boolean;requiredLegs?:number;containsLive?:boolean;modelAllHitProbability?:number|null;adjustedAllHitProbability?:number|null;historicalStructureSample?:number;historicalStructureHitRate?:number|null;combinedProbabilityNote?:string}
type Prediction={id:string;competition:string;kickoff:string;status?:string;inPlay?:boolean;finished?:boolean;bttsSettled?:boolean;elapsed?:number|null;score?:{home:number;away:number}|null;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;homeStats:any;awayStats:any;h2h:any;preMatchProbabilities?:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};probabilities:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number};oddsByBook?:{Bet365?:{homeWin?:number;draw?:number;awayWin?:number;bttsYes?:number;bttsNo?:number}};bet365OddsVerifiedAt?:string|null;winnerPick?:{side:string;team:string;loser:string;probability:number;grade:string}|null;drawPick?:{probability:number;grade:string}|null;bttsPick?:{selection:string;probability:number;grade:string}|null;reasons:string[]}
type H2HMeeting={date:string;competition?:string|null;home:string;away:string;homeGoals:number;awayGoals:number;scorers:Array<{player:string;team:string;goals:number;assists:number}>;bookings:Array<{player:string;team:string;yellow:boolean;red:boolean;minute?:number|null;second?:number|null;clock?:string|null}>;players:Array<{player:string;team:string;minutes:number;goals:number;assists:number;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;yellow:boolean;red:boolean}>;totals:{home:{yellow:number;red:number;fouls:number;shots:number;sot:number};away:{yellow:number;red:number;fouls:number;shots:number;sot:number}}}
type H2HData={ok:boolean;source?:string;scope?:string;meetings:H2HMeeting[];count:number;error?:string}
type RiskMode="safe"|"balanced"|"aggressive"
type Outcome="home"|"draw"|"away"
type Response={ok:boolean;date?:string;fixtureCount?:number;activeFixtureCount?:number;finishedFixtureCount?:number;predictions?:Prediction[];finishedPredictions?:Prediction[];slips?:Slip[];generatedAt?:string;cached?:boolean;staleFallback?:boolean;warning?:string;error?:string}

function londonDate(){const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const v=(t:string)=>p.find(x=>x.type===t)?.value??"";return v("year")+"-"+v("month")+"-"+v("day")}
function addDays(date:string,days:number){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function prettyDate(date:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"long",day:"numeric",month:"long"}).format(new Date(date+"T12:00:00Z"))}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function time(v:string){return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v))}
function kickoffDate(v:string){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v))}
function verifiedTime(v:string|null|undefined){
  if(!v)return ""
  try{return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(v))}
  catch{return ""}
}
function resultBet365Odds(p:Prediction,outcome:Outcome){
  const board=p.oddsByBook?.Bet365
  if(!board)return null
  const value=outcome==="home"?board.homeWin:outcome==="draw"?board.draw:board.awayWin
  return value!=null&&Number(value)>1?Number(value):null
}

export default function AccumulatorPage(){
  const[date,setDate]=useState(londonDate)
  const[resolvedDate,setResolvedDate]=useState(londonDate)
  const[autoAdvanced,setAutoAdvanced]=useState(false)
  const[data,setData]=useState<Response|null>(null)
  const[loading,setLoading]=useState(false)
  const[risk,setRisk]=useState<RiskMode>("safe")
  const[selectedOutcomes,setSelectedOutcomes]=useState<Record<string,Outcome>>({})
  const[manualOpen,setManualOpen]=useState(false)
  const[trackSlip,setTrackSlip]=useState<Slip|null>(null)
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
    const id=risk==="safe"?"fold-5":risk==="balanced"?"fold-7":"fold-10"
    return slips.find(s=>s.id===id)??null
  },[data?.slips,risk])
  const safeSlip=(data?.slips??[]).find(s=>s.id==="fold-5"&&s.available!==false)??null
  const balancedSlip=(data?.slips??[]).find(s=>s.id==="fold-7"&&s.available!==false)??null
  const riskySlip=(data?.slips??[]).find(s=>s.id==="fold-10"&&s.available!==false)??null

  const manualPicks=useMemo(()=>{
    const rows:(Prediction&{outcome:Outcome;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null})[]=[]
    for(const p of data?.predictions??[]){
      const outcome=selectedOutcomes[p.id]
      if(!outcome)continue
      const probability=outcome==="home"?p.probabilities.homeWin:outcome==="draw"?p.probabilities.draw:p.probabilities.awayWin
      const label=outcome==="home"?p.home+" to win":outcome==="away"?p.away+" to win":"Draw"
      rows.push({...p,outcome,label,probability,fairOdds:probability>0?1/probability:99,bookmakerOdds:resultBet365Odds(p,outcome)})
    }
    return rows
  },[data?.predictions,selectedOutcomes])
  const manualProbability=manualPicks.length?manualPicks.reduce((v,p)=>v*Math.max(.01,p.probability),1):null
  const allManualPriced=manualPicks.length>0&&manualPicks.every(p=>p.bookmakerOdds!=null&&Number(p.bookmakerOdds)>1)
  const manualOdds=allManualPriced?manualPicks.reduce((v,p)=>v*Number(p.bookmakerOdds),1):null
  const manualRisk=manualOdds==null?"":manualOdds>21?"Risky":manualOdds>=11?"Balanced":"Safe"
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
          <RiskButton mode="safe" active={risk==="safe"} onClick={()=>setRisk("safe")} title="Safe" sub={(safeSlip?.legs.length??5)+" fold"} icon={<ShieldCheck className="size-4"/>}/>
          <RiskButton mode="balanced" active={risk==="balanced"} onClick={()=>setRisk("balanced")} title="Balanced" sub={(balancedSlip?.legs.length??7)+" fold"} icon={<Activity className="size-4"/>}/>
          <RiskButton mode="aggressive" active={risk==="aggressive"} onClick={()=>setRisk("aggressive")} title="Risky" sub={(riskySlip?.legs.length??10)+" fold"} icon={<Flame className="size-4"/>}/>
        </div>
      </section>

      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-amber-300"/><p className="font-black">Analysing the matchday…</p></section>:null}
      {!loading&&data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Accumulator analysis unavailable</p><p className="mt-1 text-sm text-white/40">{data?.error??"Try another date."}</p></section>:null}

      {data?.ok?<>{data.staleFallback?<section className="rounded-2xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-[0.62rem] text-amber-100">{data.warning??"Showing the last successful cached analysis because a fresh data pull failed."}</section>:null}<section className="grid grid-cols-2 gap-2 sm:grid-cols-5"><Metric label="Matchday" value={resolvedDate===date?"Selected":"Next"}/><Metric label="Active fixtures" value={String(data.activeFixtureCount??data.predictions?.length??0)}/><Metric label="Live matches" value={String((data.predictions??[]).filter(p=>p.inPlay).length)}/><Metric label="Build" value={risk==="safe"?"5 fold":risk==="balanced"?"7 fold":"10 fold"}/><Metric label="Updated" value={data.generatedAt?new Date(data.generatedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—"}/></section>

      {selectedSlip?<><AccaSnapshot slip={selectedSlip}/><section className="space-y-3"><div className="px-1"><p className="font-black">{risk==="safe"?"Safer":"Selected"} build</p><p className="text-[0.6rem] text-white/35">The weakest leg and combined chance are visible before you expand the full slip.</p></div><SlipCard slip={selectedSlip} hero onTrack={()=>setTrackSlip(selectedSlip)}/></section></>:<section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center"><p className="font-black">No {risk} build available</p><p className="mt-1 text-sm text-white/35">There are not enough qualifying matches for this risk level on {prettyDate(resolvedDate)}.</p></section>}

      <section className="space-y-3"><div className="px-1"><p className="font-black">Suggested accas</p><p className="mt-1 text-[0.6rem] text-white/35">Safe, Balanced and Risky are generated automatically. Tap a risk above to focus on one, or expand any suggestion below.</p></div><div className="space-y-3">{(data.slips??[]).map(s=><SlipCard key={"suggested-"+s.id} slip={s} onTrack={()=>setTrackSlip(s)}/>)}</div></section>

      <section className="space-y-3"><div className="px-1"><p className="font-black">Build your own acca</p><p className="mt-1 text-[0.6rem] text-white/35">Tap Home, Draw or Away. Green is the strongest result call, amber is closer, red is less likely. Your slip updates at the bottom.</p></div>{(data.predictions??[]).map(p=><OutcomeCard key={p.id} prediction={p} selected={selectedOutcomes[p.id]??null} onSelect={o=>chooseOutcome(p.id,o)}/>)}</section>
      {(data.finishedPredictions?.length??0)>0?<details className="rounded-3xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-black text-white/45">Finished matches ({data.finishedPredictions?.length})</summary><div className="mt-3 space-y-2">{(data.finishedPredictions??[]).map(p=><PredictionCard key={"finished-"+p.id} prediction={p}/>)}</div></details>:null}</>:null}
    </div>
    {manualPicks.length?<ManualAccaTray picks={manualPicks} probability={manualProbability} odds={manualOdds} risk={manualRisk} open={manualOpen} setOpen={setManualOpen} onRemove={id=>setSelectedOutcomes(cur=>Object.fromEntries(Object.entries(cur).filter(([key])=>key!==id)))} onClear={()=>setSelectedOutcomes({})}/>:null}
    {trackSlip?<TrackAccaModal slip={trackSlip} onClose={()=>setTrackSlip(null)} onSaved={()=>setTrackSlip(null)}/>:null}
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
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase tracking-[0.13em] text-amber-300">Build snapshot</p><h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.56rem] text-white/35">{slip.legs.length} selections · {slip.confirmedBet365Odds?"Bet365 verified":"waiting for Bet365 prices"}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.confirmedBet365Odds&&slip.exactCombinedOdds!=null?slip.exactCombinedOdds.toFixed(2):"—"}</p><p className={"text-[0.42rem] font-black uppercase "+(slip.confirmedBet365Odds?"text-emerald-300":"text-white/25")}>{slip.confirmedBet365Odds?"confirmed Bet365 acca odds":"Bet365 price unavailable"}</p></div></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Small label="Adjusted all hit" value={percent(slip.adjustedAllHitProbability)}/><Small label="Avg leg" value={percent(avg)}/><Small label="Weakest leg" value={percent(weakest)}/><Small label="Live legs" value={String(live)}/></div>
    <p className="mt-3 text-[0.54rem] leading-relaxed text-white/30">{slip.confirmedBet365Odds?"Every leg has a current verified Bet365 price from Odds-API.io"+(verifiedTime(slip.oddsVerifiedAt)?" · checked "+verifiedTime(slip.oddsVerifiedAt):"")+".":"No bookmaker odds are shown until Bet365 prices every leg."}</p>
  </section>
}

function Metric({label,value}:{label:string;value:string}){return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3 text-center"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.46rem] font-black uppercase text-white/25">{label}</p></div>}

function SlipCard({slip,hero=false,onTrack}:{slip:Slip;hero?:boolean;onTrack?:()=>void}){
  const[open,setOpen]=useState(hero)
  if(slip.available===false)return <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-4"><h2 className="text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-[0.6rem] font-bold text-amber-100">Not enough qualifying picks to build the required {slip.requiredLegs??5}-leg acca for this matchday.</p></article>
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-amber-300/25 bg-gradient-to-br from-amber-400/15 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(v=>!v)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-amber-300"><Sparkles className="size-3.5"/><span className="text-[0.5rem] font-black uppercase tracking-[0.14em]">Starting point</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.56rem] font-black text-white/35">{slip.legs.length} legs{slip.bookmaker?" · "+slip.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.confirmedBet365Odds&&slip.exactCombinedOdds!=null?slip.exactCombinedOdds.toFixed(2):"—"}</p><p className={"text-[0.43rem] font-black uppercase "+(slip.confirmedBet365Odds?"text-emerald-300":"text-white/25")}>{slip.confirmedBet365Odds?"Bet365 acca odds":"no verified odds"}</p></div></div>
      <div className="mt-3 grid grid-cols-3 gap-1.5"><Small label={slip.containsLive?"Live all hit":"Adj. all hit"} value={percent(slip.adjustedAllHitProbability)}/><Small label="Raw product" value={percent(slip.modelAllHitProbability)}/><Small label={slip.containsLive?"Live legs":"Hist. structure"} value={slip.containsLive?String(slip.legs.filter(l=>l.inPlay).length):percent(slip.historicalStructureHitRate)}/></div><div className="mt-3 flex items-center justify-between"><span className={"rounded-full px-2.5 py-1 text-[0.5rem] font-black "+(slip.confirmedBet365Odds?"bg-emerald-400/15 text-emerald-300":"bg-white/7 text-white/40")}>{slip.confirmedBet365Odds?"CONFIRMED BET365 ACCA ODDS":"BET365 PRICE UNAVAILABLE"}</span><ChevronDown className={"size-4 text-white/30 transition "+(open?"rotate-180":"")}/></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.fixtureId+"|"+l.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-white/30">{l.competition} · {l.inPlay&&l.score?<span className="text-rose-300">LIVE {l.elapsed??"?"}' · {l.home} {l.score.home}-{l.score.away} {l.away}</span>:<>{time(l.kickoff)} · {l.home} v {l.away}</>}</p><p className="mt-1 text-sm font-black">{l.label}</p><p className="mt-0.5 text-[0.54rem] text-white/35">Grade {l.grade}{l.bookmaker?" · "+l.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className={"text-[0.43rem] font-black "+(l.bookmakerOdds!=null&&l.bookmaker==="Bet365"?"text-emerald-300/75":"text-white/25")}>{l.bookmakerOdds!=null&&l.bookmaker==="Bet365"?l.bookmakerOdds.toFixed(3)+" Bet365":"No verified Bet365 price"}</p></div></div><p className="mt-2 text-[0.58rem] leading-relaxed text-white/40">{l.reasons.slice(0,2).join(" · ")}</p></div>)}</div><p className="mt-3 text-[0.52rem] text-white/30">{slip.confirmedBet365Odds?"Combined price is the product of verified Bet365 prices across separate matches. Prices can move before placement.":"Model probability is still shown, but no combined odds are presented without complete Bet365 pricing."}</p>{onTrack?<button onClick={onTrack} className="mt-3 w-full rounded-xl bg-emerald-400 px-3 py-2.5 text-[0.58rem] font-black text-emerald-950">Track this Acca</button>:null}</div>:null}
  </article>
}

function TrackAccaModal({slip,onClose,onSaved}:{slip:Slip;onClose:()=>void;onSaved:()=>void}){
  const[odds,setOdds]=useState(slip.confirmedBet365Odds&&slip.exactCombinedOdds!=null?String(slip.exactCombinedOdds):"")
  const[stake,setStake]=useState("")
  const actualOdds=Number(odds),actualStake=Number(stake)
  const valid=Number.isFinite(actualOdds)&&actualOdds>1&&Number.isFinite(actualStake)&&actualStake>0
  const save=()=>{
    if(!valid)return
    addTrackedBet({
      source:"acca",
      title:slip.title,
      fixture:slip.legs.length+"-fold Acca",
      odds:actualOdds,
      stake:actualStake,
      modelProbability:slip.adjustedAllHitProbability??slip.modelAllHitProbability??null,
      legs:slip.legs.map(l=>({
        label:l.label,
        fixture:l.home+" v "+l.away,
        market:l.market,
        modelProbability:l.probability,
        bet365Odds:l.bookmaker==="Bet365"?l.bookmakerOdds:null,
      })),
    })
    onSaved()
  }
  return <div className="fixed inset-0 z-[80] flex items-end bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
    <div className="w-full max-w-lg rounded-3xl border border-emerald-300/20 bg-[#0d1d17] p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase tracking-[0.13em] text-emerald-300">My slips</p><h3 className="mt-1 text-lg font-black">{slip.title}</h3><p className="mt-1 text-[0.55rem] text-white/35">{slip.legs.length} selections{slip.confirmedBet365Odds?" · verified Bet365 price":""}</p></div><button onClick={onClose} className="rounded-xl bg-white/7 p-2 text-white/45"><X className="size-4"/></button></div>
      <div className="mt-3 max-h-44 space-y-1.5 overflow-y-auto">{slip.legs.map((l,i)=><div key={l.fixtureId+"|"+l.market+"|"+i} className="rounded-xl bg-white/[0.045] px-3 py-2"><p className="text-xs font-black">{l.label}</p><p className="mt-0.5 text-[0.44rem] text-white/25">{l.home} v {l.away}{l.bookmakerOdds!=null?" · "+l.bookmakerOdds.toFixed(3)+" Bet365":""}</p></div>)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2"><label className="rounded-2xl bg-black/20 p-3"><span className="text-[0.44rem] font-black uppercase text-white/25">Actual Bet365 odds</span><input inputMode="decimal" value={odds} onChange={e=>setOdds(e.target.value)} placeholder="e.g. 5.30" className="mt-1 w-full bg-transparent font-mono text-lg font-black outline-none"/></label><label className="rounded-2xl bg-black/20 p-3"><span className="text-[0.44rem] font-black uppercase text-white/25">Stake £</span><input inputMode="decimal" value={stake} onChange={e=>setStake(e.target.value)} placeholder="e.g. 10" className="mt-1 w-full bg-transparent font-mono text-lg font-black outline-none"/></label></div>
      {valid?<div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Potential return" value={"£"+(actualStake*actualOdds).toFixed(2)}/><Metric label="Potential profit" value={"£"+(actualStake*(actualOdds-1)).toFixed(2)}/></div>:null}
      <button disabled={!valid} onClick={save} className="mt-4 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-emerald-950 disabled:opacity-30">Save as open bet</button>
    </div>
  </div>
}

function outcomeTone(probability:number,isBest:boolean,selected:boolean){
  if(selected)return "border-white bg-white text-[#07120e]"
  if(isBest&&probability>=.40)return "border-emerald-300/35 bg-emerald-400/12 text-emerald-200"
  if(probability>=.30)return "border-amber-300/25 bg-amber-300/8 text-amber-100"
  return "border-rose-300/20 bg-rose-400/[0.055] text-rose-100/80"
}
function OutcomeCard({prediction:p,selected,onSelect}:{prediction:Prediction;selected:Outcome|null;onSelect:(o:Outcome)=>void}){
  const[h2hOpen,setH2hOpen]=useState(false)
  const[h2hLoading,setH2hLoading]=useState(false)
  const[h2hData,setH2hData]=useState<H2HData|null>(null)
  const probs={home:p.probabilities.homeWin,draw:p.probabilities.draw,away:p.probabilities.awayWin}
  const best=Math.max(probs.home,probs.draw,probs.away)
  const rows:[Outcome,string,number][]=[["home",p.home,probs.home],["draw","Draw",probs.draw],["away",p.away,probs.away]]
  const toggleH2H=async()=>{
    if(h2hOpen){setH2hOpen(false);return}
    setH2hOpen(true)
    if(h2hData)return
    setH2hLoading(true)
    try{
      const q=new URLSearchParams({date:kickoffDate(p.kickoff),home:p.home,away:p.away,competition:p.competition})
      const r=await fetch("/api/team-h2h?"+q.toString(),{cache:"no-store"})
      setH2hData(r.ok?await r.json():{ok:false,meetings:[],count:0,error:"Unable to load H2H history."})
    }catch{
      setH2hData({ok:false,meetings:[],count:0,error:"Unable to load H2H history."})
    }finally{setH2hLoading(false)}
  }
  return <article className="rounded-3xl border border-white/9 bg-white/[0.035] p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-white/25">{p.competition} · {time(p.kickoff)}</p><p className="mt-1 text-sm font-black">{p.home} <span className="text-white/25">v</span> {p.away}</p></div>{p.inPlay&&p.score?<span className="rounded-full bg-rose-300/12 px-2 py-1 text-[0.45rem] font-black text-rose-200">LIVE {p.elapsed??"?"}' · {p.score.home}-{p.score.away}</span>:null}</div>
    <div className="mt-3 grid grid-cols-3 gap-2">{rows.map(([outcome,label,probability])=>{const bet365=resultBet365Odds(p,outcome);return <button key={outcome} onClick={()=>onSelect(outcome)} className={"rounded-2xl border px-2 py-3 text-center transition "+outcomeTone(probability,probability===best,selected===outcome)}><p className="truncate text-[0.55rem] font-black">{label}</p><p className="mt-1 font-mono text-lg font-black">{percent(probability)}</p><p className={"mt-0.5 text-[0.42rem] font-black uppercase "+(bet365?"text-emerald-300/80":"opacity-45")}>{bet365?bet365.toFixed(3)+" Bet365":"No Bet365 price"}</p></button>})}</div>
    <div className="mt-3 flex items-center gap-2">
      <button onClick={()=>void toggleH2H()} className={"rounded-xl px-3 py-2 text-[0.5rem] font-black "+(h2hOpen?"bg-amber-300 text-amber-950":"bg-white/[0.06] text-white/45")}>{h2hOpen?"Hide H2H":"H2H history"}</button>
      <details className="flex-1"><summary className="cursor-pointer text-[0.5rem] font-black text-white/30">Why these percentages?</summary><p className="mt-2 text-[0.56rem] leading-relaxed text-white/40">{p.reasons.join(" · ")}</p></details>
    </div>
    {h2hOpen?<AccaH2HPanel data={h2hData} loading={h2hLoading}/>:null}
  </article>
}

function AccaH2HPanel({data,loading}:{data:H2HData|null;loading:boolean}){
  if(loading)return <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 p-5 text-center"><RefreshCw className="mx-auto size-4 animate-spin text-amber-300"/><p className="mt-2 text-[0.55rem] text-white/35">Loading full H2H history…</p></div>
  if(!data?.meetings?.length)return <div className="mt-3 rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-xs text-white/35">{data?.error??"No matching meetings found in the H2H history service."}</p></div>
  return <div className="mt-3 rounded-3xl border border-white/8 bg-black/20 p-3">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase tracking-[0.12em] text-amber-200">Full H2H history</p><p className="mt-1 text-[0.52rem] leading-relaxed text-white/35">{data.scope??"Recent league and cup meetings."}</p></div><span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/30">{data.count} matches</span></div>
    <div className="mt-3 space-y-2">{data.meetings.map(m=><AccaH2HMeeting key={m.date+"|"+m.home+"|"+m.away} meeting={m}/>)}</div>
  </div>
}
function AccaH2HMeeting({meeting:m}:{meeting:H2HMeeting}){
  const[open,setOpen]=useState(false)
  const fmt=new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(m.date+"T12:00:00Z"))
  return <div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[0.035]">
    <button onClick={()=>setOpen(v=>!v)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 text-left">
      <div><p className="font-mono text-[0.48rem] text-white/30">{fmt}</p><p className="mt-0.5 max-w-24 truncate text-[0.4rem] font-black uppercase text-amber-200/60">{m.competition??"Match"}</p></div>
      <div className="min-w-0"><p className="truncate text-xs font-black">{m.home} v {m.away}</p><p className="mt-0.5 text-[0.44rem] text-white/25">{m.bookings.length} cards · {m.totals.home.fouls+m.totals.away.fouls} fouls</p></div>
      <p className="font-mono text-lg font-black">{m.homeGoals}-{m.awayGoals}</p>
    </button>
    {open?<div className="border-t border-white/7 p-3">
      <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-black/20 p-2.5"><p className="text-[0.44rem] font-black uppercase text-white/25">Scorers</p><p className="mt-1 text-[0.54rem] text-white/60">{m.scorers.length?m.scorers.map(s=>s.player+(s.goals>1?" ×"+s.goals:"")).join(", "):"No scorer detail"}</p></div><div className="rounded-xl bg-black/20 p-2.5"><p className="text-[0.44rem] font-black uppercase text-amber-100/50">Cards</p><p className="mt-1 text-[0.54rem] text-white/60">{m.bookings.length?m.bookings.map(b=>b.player+(b.clock?" "+b.clock:"")+(b.red?" 🟥":" 🟨")).join(", "):"No cards"}</p></div></div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-white/7">
        <table className="min-w-[760px] w-full text-left">
          <thead className="bg-black/25 text-[0.46rem] font-black uppercase text-white/30"><tr><th className="px-3 py-2">Player</th><th className="px-3 py-2 text-center">Fouls committed</th><th className="px-3 py-2 text-center">Fouls drawn</th><th className="px-3 py-2 text-center">Shots</th><th className="px-3 py-2 text-center">SOT</th><th className="px-3 py-2 text-center">Cards</th></tr></thead>
          <tbody>{m.players.map((x,i)=><tr key={x.team+"|"+x.player} className={i?"border-t border-white/[0.05]":""}><td className="px-3 py-2.5"><p className="text-[0.58rem] font-black">{x.player}</p><p className="text-[0.42rem] text-white/25">{x.team}</p></td><td className="px-3 py-2.5 text-center font-mono text-xs">{x.foulsCommitted}</td><td className="px-3 py-2.5 text-center font-mono text-xs">{x.foulsDrawn}</td><td className="px-3 py-2.5 text-center font-mono text-xs">{x.shots}</td><td className="px-3 py-2.5 text-center font-mono text-xs">{x.shotsOnTarget}</td><td className="px-3 py-2.5 text-center">{x.red?"🟥":x.yellow?"🟨":"—"}</td></tr>)}</tbody>
        </table>
      </div>
    </div>:null}
  </div>
}

function ManualAccaTray({picks,probability,odds,risk,open,setOpen,onRemove,onClear}:{picks:Array<Prediction&{outcome:Outcome;label:string;probability:number;fairOdds:number;bookmakerOdds:number|null}>;probability:number|null;odds:number|null;risk:string;open:boolean;setOpen:(v:boolean)=>void;onRemove:(id:string)=>void;onClear:()=>void}){
  const tone=risk==="Safe"?"bg-emerald-300/15 text-emerald-200":risk==="Balanced"?"bg-amber-300/15 text-amber-100":"bg-rose-300/15 text-rose-100"
  return <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-3xl px-3">
    <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#0b1813]/98 shadow-2xl backdrop-blur-xl">
      <button onClick={()=>setOpen(!open)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-left"><div className="flex size-10 items-center justify-center rounded-2xl bg-amber-300 text-amber-950"><Trophy className="size-5"/></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-black">{picks.length} selection{picks.length===1?"":"s"}</p><span className={"rounded-full px-2 py-0.5 text-[0.42rem] font-black "+tone}>{risk.toUpperCase()}</span></div><p className="mt-0.5 text-[0.5rem] text-white/35">Whole-slip model chance {percent(probability)}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{odds?.toFixed(2)??"—"}</p><p className="text-[0.4rem] uppercase text-white/25">{odds!=null?"Bet365 acca odds":"waiting for Bet365"}</p></div></button>
      {open?<div className="border-t border-white/8 bg-black/20 p-3"><div className="max-h-64 space-y-2 overflow-y-auto">{picks.map(p=><div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-black">{p.label}</p><p className="truncate text-[0.46rem] text-white/30">{p.home} v {p.away} · {percent(p.probability)}{p.bookmakerOdds!=null?" · "+p.bookmakerOdds.toFixed(3)+" Bet365":" · no Bet365 price"}</p></div><button onClick={()=>onRemove(p.id)} className="rounded-lg bg-white/7 px-2 py-1 text-[0.48rem] font-black text-white/40">REMOVE</button></div>)}</div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-[0.48rem] leading-relaxed text-white/25">{odds!=null?"Combined odds are the product of the current verified Bet365 prices for your selected results.":"Combined odds stay blank until every selected result has a verified Bet365 price."}</p><button onClick={onClear} className="rounded-xl bg-white/7 px-3 py-2 text-[0.5rem] font-black text-white/45">CLEAR</button></div></div>:null}
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
