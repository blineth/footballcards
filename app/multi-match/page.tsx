"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, Check, Layers3, RefreshCw, Sparkles } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available"|"unavailable"|"unknown"
type Fixture = {
  id:string
  competition:Competition
  tournament?:string
  kickoff:string
  home:{name:string}
  away:{name:string}
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = {
  leagues:Record<Competition,Fixture[]>
}
type SlipLeg = {
  player:string
  team:string
  market:string
  label:string
  probability:number
  fairOdds:number|null
  bookmakerOdds:number|null
  edge:number|null
  confidence:"A"|"B"|"C"|"D"
  reason:string
}
type BetSlip = {id:string;title:string;legs:SlipLeg[]}
type FoulTargetSlip = {id:string;legs:SlipLeg[]}
type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}
  slips?:BetSlip[]
  foulTargetSlips?:FoulTargetSlip[]
  error?:string
}
type MatchResult = {
  fixture:Fixture
  scorecard:Scorecard|null
  confirmed:boolean
}
type MultiLeg = SlipLeg & {fixtureId:string;match:string;competition:Competition}
type MultiSlip = {
  id:string
  title:string
  subtitle:string
  legs:MultiLeg[]
  combinedOdds:number|null
  modelAllHit:number|null
}

const competitions:Competition[]=["Premier League","Championship","League One","League Two","International"]

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return v("year")+"-"+v("month")+"-"+v("day")
}
function fixtureDate(f:Fixture){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.kickoff))
}
function time(f:Fixture){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(f.kickoff))
}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,refresh:String(Date.now())})
}
function key(leg:SlipLeg){return leg.player+"|"+leg.market}
function marketStatusForLeg(scorecard:Scorecard|null,leg:SlipLeg):MarketStatus{
  if(!scorecard?.marketAvailability)return "unknown"
  if(leg.market==="card")return scorecard.marketAvailability.card
  if(leg.market.startsWith("fouled"))return scorecard.marketAvailability.fouled
  if(leg.market.startsWith("foul"))return scorecard.marketAvailability.foul
  if(leg.market.startsWith("sot"))return scorecard.marketAvailability.sot
  return scorecard.marketAvailability.shot
}
function uniqueLegs(scorecard:Scorecard|null){
  const map=new Map<string,SlipLeg>()
  for(const slip of scorecard?.slips??[]){
    for(const leg of slip.legs){
      const k=key(leg)
      const current=map.get(k)
      if(!current||leg.probability>current.probability)map.set(k,leg)
    }
  }
  return [...map.values()]
}
function bestCard(scorecard:Scorecard|null){
  if(scorecard?.marketAvailability?.card==="unavailable")return null
  return uniqueLegs(scorecard).filter(l=>l.market==="card").sort((a,b)=>b.probability-a.probability)[0]??null
}
function bestFoul(scorecard:Scorecard|null){
  if(scorecard?.marketAvailability?.foul==="unavailable")return null
  const target=(scorecard?.foulTargetSlips??[]).find(s=>s.id==="foul-3-1")
  const fromTarget=[...(target?.legs??[])].sort((a,b)=>b.probability-a.probability)[0]
  if(fromTarget)return fromTarget
  return uniqueLegs(scorecard).filter(l=>l.market==="foul1").sort((a,b)=>b.probability-a.probability)[0]??null
}
function bestSafe(scorecard:Scorecard|null){
  return uniqueLegs(scorecard)
    .filter(l=>l.confidence!=="D")
    .filter(l=>marketStatusForLeg(scorecard,l)!=="unavailable")
    .sort((a,b)=>{
      const qa=a.probability+(a.confidence==="A"?.06:a.confidence==="B"?.04:0)+Math.max(0,Number(a.edge??0))*.2
      const qb=b.probability+(b.confidence==="A"?.06:b.confidence==="B"?.04:0)+Math.max(0,Number(b.edge??0))*.2
      return qb-qa
    })[0]??null
}
function bestShot(scorecard:Scorecard|null){
  return uniqueLegs(scorecard).filter(l=>l.market.startsWith("shot")||l.market.startsWith("sot")).filter(l=>marketStatusForLeg(scorecard,l)!=="unavailable").sort((a,b)=>b.probability-a.probability)[0]??null
}
function makeMultiSlip(id:string,title:string,subtitle:string,results:MatchResult[],selector:(s:Scorecard|null)=>SlipLeg|null):MultiSlip{
  const legs:MultiLeg[]=[]
  for(const result of results){
    if(!result.confirmed||!result.scorecard?.ok)continue
    const leg=selector(result.scorecard)
    if(!leg)continue
    legs.push({...leg,fixtureId:result.fixture.id,match:result.fixture.home.name+" v "+result.fixture.away.name,competition:result.fixture.competition})
  }
  const allPriced=legs.length>0&&legs.every(l=>l.bookmakerOdds!=null)
  const combinedOdds=allPriced?Math.round(legs.reduce((p,l)=>p*Number(l.bookmakerOdds),1)*100)/100:null
  const modelAllHit=legs.length?legs.reduce((p,l)=>p*l.probability,1):null
  return {id,title,subtitle,legs,combinedOdds,modelAllHit}
}

export default function MultiMatchPage(){
  const[date,setDate]=useState(londonDate)
  const[fixtures,setFixtures]=useState<Fixture[]>([])
  const[selected,setSelected]=useState<string[]>([])
  const[enabled,setEnabled]=useState<Competition[]>(competitions)
  const[loading,setLoading]=useState(false)
  const[building,setBuilding]=useState(false)
  const[results,setResults]=useState<MatchResult[]>([])

  const visible=useMemo(()=>fixtures.filter(f=>enabled.includes(f.competition)),[fixtures,enabled])

  const loadFixtures=useCallback(async()=>{
    setLoading(true)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({date,refresh:String(Date.now())}),{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures")
      const data=await r.json() as FixturesResponse
      const all=competitions.flatMap(c=>data.leagues?.[c]??[])
      setFixtures(all)
      setSelected(current=>current.filter(id=>all.some(f=>f.id===id)))
      setResults([])
    }catch{
      setFixtures([])
    }finally{
      setLoading(false)
    }
  },[date])

  useEffect(()=>{void loadFixtures()},[loadFixtures])

  async function build(){
    const chosen=fixtures.filter(f=>selected.includes(f.id))
    setBuilding(true)
    try{
      const rows=await Promise.all(chosen.map(async fixture=>{
        try{
          const r=await fetch(scorecardUrl(fixture),{cache:"no-store"})
          const scorecard=r.ok?await r.json() as Scorecard:null
          return {fixture,scorecard,confirmed:Boolean(scorecard?.lineupsConfirmed)}
        }catch{
          return {fixture,scorecard:null,confirmed:false}
        }
      }))
      setResults(rows)
    }finally{
      setBuilding(false)
    }
  }

  function toggleFixture(id:string){
    setSelected(current=>current.includes(id)?current.filter(x=>x!==id):current.length>=12?current:[...current,id])
    setResults([])
  }
  function toggleCompetition(c:Competition){
    setEnabled(current=>current.includes(c)?current.filter(x=>x!==c):[...current,c])
  }

  const slips=results.length?[
    makeMultiSlip("safe","Safest leg from every game","One highest-rated calibrated selection per confirmed match.",results,bestSafe),
    makeMultiSlip("cards","One card per game","The strongest yellow-card candidate from each confirmed match.",results,bestCard),
    makeMultiSlip("fouls","One 1+ foul per game","The strongest 1+ foul candidate from each confirmed match.",results,bestFoul),
    makeMultiSlip("shots","One shot/SOT per game","The strongest shot or shot-on-target selection from each confirmed match.",results,bestShot),
  ]:[]

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-sky-300"><Layers3 className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div><h1 className="mt-1 text-2xl font-black">Multi Match</h1><p className="mt-1 text-xs text-white/45">Pick several games and let the model choose one strong angle from each.</p></div>
          <button onClick={()=>void loadFixtures()} className="rounded-xl bg-sky-300 p-2.5 text-sky-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-4">
        <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-3"><CalendarDays className="size-4 text-sky-300"/><input type="date" value={date} onChange={e=>{setDate(e.target.value);setSelected([])}} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/></label>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{competitions.map(c=><button key={c} onClick={()=>toggleCompetition(c)} className={"shrink-0 rounded-full px-3 py-2 text-[0.62rem] font-black "+(enabled.includes(c)?"bg-white text-[#07120e]":"bg-white/7 text-white/40")}>{c}</button>)}</div>
        <div className="mt-3 flex items-center justify-between text-[0.62rem] text-white/40"><span>Select up to 12 matches</span><span><b className="text-white">{selected.length}</b>/12 selected</span></div>
      </section>

      <section className="space-y-2">
        {visible.map(f=>{
          const picked=selected.includes(f.id)
          return <button key={f.id} onClick={()=>toggleFixture(f.id)} className={"flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition "+(picked?"border-sky-300/30 bg-sky-300/10":"border-white/8 bg-white/[0.035]")}>
            <div className={"flex size-6 shrink-0 items-center justify-center rounded-lg border "+(picked?"border-sky-300 bg-sky-300 text-sky-950":"border-white/15 bg-black/20")}>{picked?<Check className="size-4"/>:null}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{f.home.name} v {f.away.name}</p><p className="mt-0.5 text-[0.56rem] text-white/35">{f.competition} · {time(f)}</p></div>
            <span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+(f.lineupStatus==="confirmed"?"bg-emerald-400 text-emerald-950":"bg-white/7 text-white/35")}>{f.lineupStatus==="confirmed"?"XI CONFIRMED":"PRE-LINEUP"}</span>
          </button>
        })}
        {!visible.length&&!loading?<div className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">No fixtures found for the current filters.</div>:null}
      </section>

      {selected.length?<button onClick={()=>void build()} disabled={building} className="w-full rounded-2xl bg-sky-300 px-4 py-3.5 text-sm font-black text-sky-950 disabled:opacity-60">{building?"Analysing selected matches…":"Build multi-match slips"}</button>:null}

      {results.length?<section className="space-y-3">
        <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-3 text-[0.62rem] text-white/45"><b className="text-white">{results.filter(r=>r.confirmed).length}</b> of {results.length} selected matches currently have confirmed lineups. Unconfirmed games are excluded from the final legs until their XIs are confirmed.</div><div className="rounded-2xl border border-amber-300/10 bg-amber-300/5 p-3 text-[0.6rem] text-amber-100/80">If a bookmaker confirms a required market is unavailable — for example no player yellow-card market — that game is skipped for that slip type. Unknown markets stay model-only until verified.</div>
        {slips.map(slip=><MultiSlipCard key={slip.id} slip={slip}/>)}
      </section>:null}
    </div>
  </main>
}

function MultiSlipCard({slip}:{slip:MultiSlip}){
  const[open,setOpen]=useState(false)
  return <article className="overflow-hidden rounded-3xl border border-sky-300/15 bg-gradient-to-br from-sky-400/10 to-black/20">
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-sky-300">MULTI MATCH</p><h3 className="mt-1 text-lg font-black">{slip.title}</h3><p className="mt-1 text-[0.64rem] text-white/45">{slip.subtitle}</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.combinedOdds?.toFixed(2)??"—"}</p><p className="text-[0.44rem] uppercase text-white/30">{slip.combinedOdds!=null?"combined odds":"price incomplete"}</p></div></div>
      <div className="mt-3 flex flex-wrap gap-1.5">{slip.legs.map(l=><span key={l.fixtureId+"|"+l.player} className="rounded-full bg-white/7 px-2.5 py-1 text-[0.58rem] font-bold text-white/70">{l.player} · {l.label} · {percent(l.probability)}</span>)}</div>
      <p className="mt-3 rounded-2xl bg-black/20 p-3 text-[0.64rem] leading-relaxed text-white/50">{slip.id==="cards"?"Why: this takes the single strongest booking candidate from each confirmed match rather than stacking several cards in one game.":slip.id==="fouls"?"Why: this uses the strongest calibrated 1+ foul player from every selected confirmed game, keeping each leg simple and repeatable.":slip.id==="shots"?"Why: one strongest shot/SOT angle per game spreads the exposure across different matches.":"Why: the model simply takes the highest-rated A/B-style opportunity from each confirmed match, regardless of market."}</p>
    </button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map(leg=><div key={leg.fixtureId+"|"+leg.player+"|"+leg.market} className="rounded-2xl bg-white/[0.055] p-3"><p className="text-[0.55rem] font-black uppercase text-white/30">{leg.competition} · {leg.match}</p><div className="mt-1 flex items-center justify-between gap-3"><div><p className="text-sm font-black">{leg.player} · {leg.label}</p><p className="mt-1 text-[0.6rem] text-white/40">{leg.reason}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(leg.probability)}</p><p className="text-[0.48rem] text-white/30">{leg.bookmakerOdds?.toFixed(2)??"—"} odds</p></div></div></div>)}</div>{slip.modelAllHit!=null?<p className="mt-3 text-[0.55rem] text-white/30">Independent model estimate for every leg landing: {percent(slip.modelAllHit)}. This assumes cross-match independence and is shown only as a guide.</p>:null}</div>:null}
  </article>
}
