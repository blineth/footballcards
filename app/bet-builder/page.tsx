"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, Clock3, RefreshCw, Sparkles } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type Fixture = {
  id:string
  competition:Competition
  tournament?:string
  kickoff:string
  status?:string
  home:{name:string;crest?:string}
  away:{name:string;crest?:string}
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = {
  connected:boolean
  date:string
  showingNextMatchday?:boolean
  leagues:Record<Competition,Fixture[]>
}
type Radar = {
  lineupsConfirmed?:boolean
  referee?:{name:string;yellowsPerGame?:number|null}|null
}
type MarketStatus = "available"|"unavailable"|"unknown"
type SlipLeg = {
  player:string
  team:string
  market:string
  label:string
  probability:number
  fairOdds:number|null
  bookmakerOdds:number|null
  previousBookmakerOdds:number|null
  bookmakerMovement:number|null
  edge:number|null
  expectedValue:number|null
  confidence:"A"|"B"|"C"|"D"
  reason:string
}
type BetSlip = {
  id:string
  title:string
  risk:string
  legs:SlipLeg[]
  averageLegProbability:number|null
  note:string
  placeable?:boolean
  marketAvailability?:Array<{player:string;market:string;status:MarketStatus}>
}
type FoulTargetSlip = {
  id:string
  targetFractional:string
  targetDecimal:number
  legs:SlipLeg[]
  referenceProductOdds:number|null
  averageLegProbability:number|null
  minimumLegProbability:number|null
  pricedLegs:number
  usesLivePrices:boolean
  withinTargetRange:boolean
  note:string
  placeable?:boolean
  marketStatus?:MarketStatus
}
type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  bookmaker?:string|null
  oddsSource?:string|null
  oddsFreshness?:"LIVE"|"SLIGHTLY STALE"|"CACHED"|"STALE"|"UNKNOWN"
  oddsCapturedAt?:string|null
  priceAvailable?:boolean
  playerCount?:number
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}
  slips?:BetSlip[]
  foulTargetSlips?:FoulTargetSlip[]
  error?:string
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
function percent(v:number|null|undefined){return v==null?"—":Math.round(Number(v)*100)+"%"}
function edge(v:number|null|undefined){return v==null?"—":(Number(v)>=0?"+":"")+(Number(v)*100).toFixed(1)+"pp"}
function likelihood(v:number|null|undefined){
  const p=Number(v??0)
  if(p>=.76)return "Very strong"
  if(p>=.67)return "Strong"
  if(p>=.58)return "Good"
  return "Higher risk"
}
function scorecardUrl(f:Fixture,bust=0){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,refresh:String(bust)})
}
function radarUrl(f:Fixture,bust=0){
  return "/api/fixture-radar?"+new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,refresh:String(bust)})
}
function marketStatusLabel(status:MarketStatus|undefined,label:string){
  if(status==="available") return {text:label+" available",cls:"bg-emerald-400/15 text-emerald-300"}
  if(status==="unavailable") return {text:label+" unavailable",cls:"bg-rose-400/15 text-rose-200"}
  return {text:label+" not verified",cls:"bg-amber-300/10 text-amber-200"}
}
function slipWhy(slip:BetSlip){
  if(slip.id==="main-safe") return "The model's strongest simple markets in this game, prioritising high calibrated hit rates and avoiding too much exposure to one player."
  if(slip.id==="two-cards") return "The two strongest booking candidates after card history, foul volume, repeated-foul booking behaviour, direct matchup and referee context are combined."
  if(slip.id==="three-cards") return "A higher-return version of the card angle, adding the next strongest booking candidate while keeping the same evidence rules."
  if(slip.id==="yellow-foul") return "Built around players whose booking rate rises when their foul count increases, so the card and foul evidence reinforce one another."
  return "A volume-led mix of fouls, shots and shots on target, favouring repeatable involvement over rare outcomes."
}

export default function BetBuilderPage(){
  const[date,setDate]=useState(londonDate)
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[fixtures,setFixtures]=useState<Fixture[]>([])
  const[selectedId,setSelectedId]=useState("")
  const[radar,setRadar]=useState<Radar|null>(null)
  const[scorecard,setScorecard]=useState<Scorecard|null>(null)
  const[loadingFixtures,setLoadingFixtures]=useState(false)
  const[loadingMatch,setLoadingMatch]=useState(false)

  const selected=useMemo(()=>fixtures.find(f=>f.id===selectedId)??null,[fixtures,selectedId])

  const loadFixtures=useCallback(async()=>{
    setLoadingFixtures(true)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({
        date,
        competition,
        nextIfEmpty:"0",
        refresh:String(Date.now()),
      }),{cache:"no-store"})
      if(!r.ok) throw new Error("fixtures")
      const data=await r.json() as FixturesResponse
      const fs=data.leagues?.[competition]??[]
      setFixtures(fs)
      setSelectedId(current=>fs.some(f=>f.id===current)?current:"")
      setRadar(null)
      setScorecard(null)
    }catch{
      setFixtures([])
    }finally{
      setLoadingFixtures(false)
    }
  },[date,competition])

  const loadMatch=useCallback(async(f:Fixture)=>{
    setLoadingMatch(true)
    const bust=Date.now()
    try{
      const rr=await fetch(radarUrl(f,bust),{cache:"no-store"})
      const rd=rr.ok?await rr.json() as Radar:null
      setRadar(rd)
      const sr=await fetch(scorecardUrl(f,bust),{cache:"no-store"})
      setScorecard(sr.ok?await sr.json() as Scorecard:null)
    }finally{
      setLoadingMatch(false)
    }
  },[])

  useEffect(()=>{void loadFixtures()},[loadFixtures])
  useEffect(()=>{if(selected)void loadMatch(selected)},[selected,loadMatch])
  useEffect(()=>{
    const t=window.setInterval(()=>{if(selected)void loadMatch(selected)},60000)
    return()=>window.clearInterval(t)
  },[selected,loadMatch])

  const confirmed=Boolean(radar?.lineupsConfirmed||selected?.lineupStatus==="confirmed")

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Bet Builder</h1>
            <p className="mt-1 text-xs text-white/45">Pick one game. Only that match appears here.</p>
          </div>
          <button onClick={()=>selected?void loadMatch(selected):void loadFixtures()} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+((loadingFixtures||loadingMatch)?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-4">
        <p className="text-[0.6rem] font-black uppercase tracking-[0.15em] text-white/35">Select game</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <span className="mb-1.5 flex items-center gap-1.5 text-[0.56rem] font-black uppercase text-white/35"><CalendarDays className="size-3"/>Date</span>
            <input type="date" value={date} onChange={e=>{setDate(e.target.value);setSelectedId("")}} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/>
          </label>
          <label className="relative rounded-2xl border border-white/10 bg-black/20 p-3">
            <span className="mb-1.5 block text-[0.56rem] font-black uppercase text-white/35">Competition</span>
            <select value={competition} onChange={e=>{setCompetition(e.target.value as Competition);setSelectedId("")}} className="w-full appearance-none bg-transparent pr-6 text-sm font-black outline-none">
              {competitions.map(c=><option key={c} value={c} className="bg-[#07120e]">{c}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3 size-4 text-white/35"/>
          </label>
        </div>
        <label className="relative mt-2 block rounded-2xl border border-white/10 bg-black/20 p-3">
          <span className="mb-1.5 block text-[0.56rem] font-black uppercase text-white/35">Match</span>
          <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} disabled={loadingFixtures} className="w-full appearance-none bg-transparent pr-7 text-sm font-black outline-none">
            <option value="" className="bg-[#07120e]">{loadingFixtures?"Loading…":fixtures.length?"Choose a match":"No fixtures found"}</option>
            {fixtures.map(f=><option key={f.id} value={f.id} className="bg-[#07120e]">{time(f)} · {f.home.name} v {f.away.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3 size-4 text-white/35"/>
        </label>
      </section>

      {!selected?<Empty/>:null}
      {selected?<MatchHeader fixture={selected} radar={radar} confirmed={confirmed}/>:null}

      {selected&&scorecard?.ok?<OddsStatus data={scorecard}/>:null}

      {selected&&!confirmed?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-6 text-center">
        <Clock3 className="mx-auto size-6 text-amber-300"/>
        <p className="mt-3 font-black">Waiting for confirmed lineups</p>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">Bookmaker market availability is already checked above. Final player recommendations unlock when the starting XIs are confirmed, then re-check automatically every 60 seconds.</p>
      </section>:null}

      {selected&&loadingMatch&&!scorecard?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center"><RefreshCw className="mx-auto mb-2 size-5 animate-spin text-emerald-300"/><p className="font-black">Checking bookmaker markets…</p></section>:null}

      {selected&&confirmed&&scorecard?.ok?<>
        <FoulLadder slips={scorecard.foulTargetSlips??[]}/>
        <section className="space-y-3">
          <div className="px-1"><p className="font-black">Other model slips</p><p className="text-[0.62rem] text-white/35">Cards, foul/card combinations and shots from the same confirmed XI.</p></div>
          {(scorecard.slips??[]).map(s=><StandardSlip key={s.id} slip={s}/>)}
        </section>
      </>:null}

      {selected&&confirmed&&scorecard&&!scorecard.ok?<section className="rounded-3xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">{scorecard.error??"Unable to build this match."}</section>:null}
    </div>
  </main>
}

function Empty(){
  return <section className="rounded-3xl border border-dashed border-white/10 bg-white/[0.035] p-8 text-center"><p className="font-black">Choose a match above</p><p className="mt-1 text-sm text-white/35">You will only see recommendations for the game you select.</p></section>
}

function MatchHeader({fixture,radar,confirmed}:{fixture:Fixture;radar:Radar|null;confirmed:boolean}){
  return <section className="rounded-3xl border border-white/10 bg-[#0d1d17] p-4">
    <div className="flex items-center justify-between gap-3">
      <div><p className="text-[0.6rem] font-black uppercase tracking-[0.12em] text-white/35">{fixture.tournament??fixture.competition} · {time(fixture)}</p><h2 className="mt-1 text-lg font-black">{fixture.home.name} <span className="text-white/25">v</span> {fixture.away.name}</h2><p className="mt-1 text-[0.62rem] text-white/35">{radar?.referee?.name?"Ref: "+radar.referee.name+(radar.referee.yellowsPerGame!=null?" · "+radar.referee.yellowsPerGame.toFixed(1)+" cards/game":""):"Referee not confirmed"}</p></div>
      <span className={"shrink-0 rounded-full px-2.5 py-1 text-[0.56rem] font-black "+(confirmed?"bg-emerald-400 text-emerald-950":"bg-white/8 text-white/45")}>{confirmed?"XI CONFIRMED":"WAITING FOR XI"}</span>
    </div>
  </section>
}

function OddsStatus({data}:{data:Scorecard}){
  const freshness=data.oddsFreshness??"UNKNOWN"
  const cls=freshness==="LIVE"?"bg-emerald-400 text-emerald-950":freshness==="CACHED"?"bg-sky-300 text-sky-950":freshness==="SLIGHTLY STALE"?"bg-amber-300 text-amber-950":freshness==="STALE"?"bg-rose-300 text-rose-950":"bg-white/10 text-white/50"
  const card=marketStatusLabel(data.marketAvailability?.card,"Cards")
  const foul=marketStatusLabel(data.marketAvailability?.foul,"Fouls")
  const sot=marketStatusLabel(data.marketAvailability?.sot,"SOT")
  const cardBlocked=data.marketAvailability?.card==="unavailable"
  const foulBlocked=data.marketAvailability?.foul==="unavailable"
  const blockMessage=cardBlocked&&foulBlocked
    ?"Bet365 does not currently offer player fouls or player cards for this fixture. Foul/card builders are disabled."
    :cardBlocked
      ?"Bet365 does not currently offer player cards for this fixture. Card-based builders are disabled."
      :foulBlocked
        ?"Bet365 does not currently offer player fouls for this fixture. Foul-based builders are disabled."
        :null
  return <section className="rounded-2xl border border-white/8 bg-white/[0.035] p-3">
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black">{data.lineupsConfirmed?"Confirmed-lineup model ready":"Bookmaker market check"}</p><p className="mt-0.5 text-[0.58rem] text-white/35">{data.lineupsConfirmed?(data.playerCount??0)+" player profiles analysed":"Markets checked as soon as the fixture is selected"}</p></div><span className={"rounded-full px-2 py-1 text-[0.54rem] font-black "+cls}>{data.bookmaker??"BET365"} {freshness}</span></div>
    <div className="mt-2 flex flex-wrap gap-1.5"><span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+card.cls}>{card.text}</span><span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+foul.cls}>{foul.text}</span><span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+sot.cls}>{sot.text}</span></div>
    {blockMessage?<p className="mt-2 rounded-xl bg-rose-400/10 px-3 py-2 text-[0.62rem] font-bold leading-relaxed text-rose-100">{blockMessage}</p>:null}
  </section>
}

function FoulLadder({slips}:{slips:FoulTargetSlip[]}){
  return <section className="space-y-3">
    <div className="px-1"><p className="font-black">Foul odds ladder</p><p className="text-[0.62rem] text-white/35">1+ foul selections built toward the return you want, within Bet365's 12-selection / six-players-per-team Bet Builder limits.</p></div>
    {slips.map(s=><FoulTargetCard key={s.id} slip={s}/>)}
  </section>
}

function FoulTargetCard({slip}:{slip:FoulTargetSlip}){
  const[open,setOpen]=useState(false)
  const ready=slip.legs.length>0
  const marketNote=slip.marketStatus==="unavailable"?"Foul market unavailable at this bookmaker":slip.marketStatus==="unknown"?"Foul market not verified on the free bookmaker feed":null
  return <article className={"overflow-hidden rounded-3xl border "+(ready?"border-emerald-400/15 bg-gradient-to-br from-emerald-500/15 to-black/20":"border-white/8 bg-white/[0.03]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[0.56rem] font-black uppercase tracking-[0.14em] text-emerald-300">TARGET RETURN</p><h3 className="mt-1 text-xl font-black">{slip.targetFractional}</h3><p className="mt-1 text-[0.64rem] text-white/45">{ready?slip.legs.length+" players · "+likelihood(slip.averageLegProbability)+" average leg strength":"No qualifying combination"}</p></div>
        <div className="text-right"><p className="font-mono text-xl font-black">{slip.referenceProductOdds?.toFixed(2)??"—"}</p><p className="text-[0.46rem] font-black uppercase text-white/30">reference product</p></div>
      </div>
      {ready?<div className="mt-3 flex flex-wrap gap-1.5">{slip.legs.map(leg=><span key={leg.player} className="rounded-full bg-white/7 px-2.5 py-1 text-[0.6rem] font-bold text-white/70">{leg.player} 1+ foul · {percent(leg.probability)}</span>)}</div>:null}
      <div className="mt-3 rounded-2xl bg-black/20 p-3 text-[0.67rem] leading-relaxed text-white/55">
        {ready?"Why: the model keeps adding the strongest calibrated 1+ foul candidates until it gets near this odds target, while protecting the Bet365 player/team limits.":"The model would have to use weaker foul legs than the current threshold to chase this price, so it leaves the target blank instead."}
      </div>
      {marketNote?<p className={"mt-2 rounded-xl px-3 py-2 text-[0.6rem] "+(slip.marketStatus==="unavailable"?"bg-rose-400/10 text-rose-100":"bg-amber-300/10 text-amber-100")}>{marketNote}</p>:null}
    </button>
    {open&&ready?<div className="border-t border-white/8 bg-black/20 p-4">
      <div className="space-y-2">{slip.legs.map(leg=><Leg key={leg.player+"|"+leg.market} leg={leg}/>)}</div>
      <p className="mt-3 text-[0.56rem] leading-relaxed text-white/30">{slip.note}</p>
    </div>:null}
  </article>
}

function StandardSlip({slip}:{slip:BetSlip}){
  const[open,setOpen]=useState(false)
  const unavailable=slip.marketAvailability?.filter(x=>x.status==="unavailable")??[]
  const unknown=slip.marketAvailability?.filter(x=>x.status==="unknown")??[]
  return <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045]">
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.55rem] font-black uppercase text-white/35">{slip.risk} risk · {slip.legs.length} legs</p><h3 className="mt-1 font-black">{slip.title}</h3><p className="mt-1 text-[0.65rem] leading-relaxed text-white/50">{slipWhy(slip)}</p>{unavailable.length?<p className="mt-2 rounded-lg bg-rose-400/10 px-2.5 py-1.5 text-[0.58rem] text-rose-100">Bookmaker market unavailable: {Array.from(new Set(unavailable.map(x=>x.market))).join(", ")}</p>:unknown.length?<p className="mt-2 rounded-lg bg-amber-300/10 px-2.5 py-1.5 text-[0.58rem] text-amber-100">Market availability not verified on the free feed</p>:<p className="mt-2 text-[0.55rem] font-black text-emerald-300">Markets verified available</p>}</div><div className="text-right"><p className="font-mono text-xl font-black">{percent(slip.averageLegProbability)}</p><p className="text-[0.45rem] uppercase text-white/30">avg leg</p></div></div>
    </button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((leg,i)=><Leg key={leg.player+"|"+leg.market+"|"+i} leg={leg}/>)}</div></div>:null}
  </article>
}

function Leg({leg}:{leg:SlipLeg}){
  return <div className="rounded-2xl bg-white/[0.055] p-3">
    <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black">{leg.player} · {leg.label}</p><p className="mt-0.5 text-[0.58rem] text-white/35">{leg.team} · Grade {leg.confidence}</p></div><p className="font-mono text-base font-black">{percent(leg.probability)}</p></div>
    <p className="mt-2 text-[0.64rem] leading-relaxed text-white/50">{leg.reason||"Strong historical and recent profile."}</p>
    <div className="mt-2 grid grid-cols-3 gap-1.5 text-center"><Metric label="Fair" value={leg.fairOdds?.toFixed(2)??"—"}/><Metric label="Bet365" value={leg.bookmakerOdds?.toFixed(2)??"—"}/><Metric label="Edge" value={edge(leg.edge)} good={Number(leg.edge??0)>0}/></div>
  </div>
}
function Metric({label,value,good=false}:{label:string;value:string;good?:boolean}){
  return <div className="rounded-xl bg-black/20 p-2"><p className={"font-mono text-xs font-black "+(good?"text-emerald-300":"")}>{value}</p><p className="mt-0.5 text-[0.42rem] font-black uppercase text-white/25">{label}</p></div>
}
