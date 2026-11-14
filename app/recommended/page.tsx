"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BadgeCheck, RefreshCw, Sparkles, Trophy } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "International"
type Fixture = {
  id:string
  competition:Competition
  tournament?:string
  kickoff:string
  home:{name:string}
  away:{name:string}
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = { leagues:Record<string,Fixture[]> }
type MarketStatus = "available"|"unavailable"|"unknown"
type SlipLeg = {
  player:string
  team:string
  market:string
  label:string
  probability:number
  fairOdds:number|null
  bookmakerOdds:number|null
  bookmakerName?:string|null
  edge:number|null
  confidence:"A"|"B"|"C"|"D"
  reason:string
}
type BetSlip = {
  id:string
  bookmaker?:string|null
  title:string
  risk:string
  legs:SlipLeg[]
  averageLegProbability:number|null
  placeable?:boolean
  marketAvailability?:Array<{player:string;market:string;status:MarketStatus}>
}
type FoulTargetSlip = {
  id:string
  bookmaker?:string|null
  targetFractional:string
  legs:SlipLeg[]
  averageLegProbability:number|null
  placeable?:boolean
  marketStatus?:MarketStatus
}
type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  bookmaker?:string|null
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus}
  eligibleBooks?:string[]
  slips?:BetSlip[]
  previewSlips?:BetSlip[]
  foulTargetSlips?:FoulTargetSlip[]
  previewFoulTargetSlips?:FoulTargetSlip[]
}
type Recommendation = {
  id:string
  fixture:Fixture
  slip:BetSlip|FoulTargetSlip
  confirmed:boolean
  kind:"standard"|"foul"
  rank:number
  placeable:boolean
  blockedReason:string|null
}

const competitions:Competition[]=["Premier League","Championship","League One","International"]

function londonDate(offset=0){
  const now=new Date()
  now.setUTCDate(now.getUTCDate()+offset)
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now)
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return v("year")+"-"+v("month")+"-"+v("day")
}
function fixtureDate(f:Fixture){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.kickoff))
}
function time(f:Fixture){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(f.kickoff))
}
function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,refresh:String(Date.now())})
}
function slipLegs(slip:BetSlip|FoulTargetSlip){return slip.legs??[]}
function avgProbability(slip:BetSlip|FoulTargetSlip){
  const legs=slipLegs(slip)
  return slip.averageLegProbability??(legs.length?legs.reduce((s,l)=>s+l.probability,0)/legs.length:0)
}
function rankSlip(slip:BetSlip|FoulTargetSlip,confirmed:boolean,placeable:boolean){
  const legs=slipLegs(slip)
  if(!legs.length)return -999
  const geo=Math.exp(legs.reduce((s,l)=>s+Math.log(Math.max(.01,l.probability)),0)/legs.length)
  const min=Math.min(...legs.map(l=>l.probability))
  const grade=legs.filter(l=>l.confidence==="A"||l.confidence==="B").length/legs.length
  return geo*.55+min*.25+grade*.08+(confirmed?.08:0)+(placeable?.04:0)-Math.max(0,legs.length-5)*.006
}
function blockedReason(scorecard:Scorecard,slip:BetSlip|FoulTargetSlip,kind:"standard"|"foul"){
  if(kind==="foul"){
    const status=(slip as FoulTargetSlip).marketStatus??scorecard.marketAvailability?.foul??"unknown"
    if(status==="unavailable")return "Foul market unavailable at the selected bookmaker"
    if(status==="unknown")return "Foul market not verified at the selected bookmaker"
    return null
  }
  const statuses=(slip as BetSlip).marketAvailability??[]
  if(statuses.some(x=>x.status==="unavailable"&&x.market==="card"))return "Card market unavailable at the bookmaker"
  if(statuses.some(x=>x.status==="unavailable"))return "One or more required markets are unavailable"
  if(statuses.some(x=>x.status==="unknown"))return "One or more markets are not verified on the free feed"
  return null
}

export default function RecommendedPage(){
  const[loading,setLoading]=useState(false)
  const[recommendations,setRecommendations]=useState<Recommendation[]>([])
  const[fixturesScanned,setFixturesScanned]=useState(0)
  const[lastUpdated,setLastUpdated]=useState<Date|null>(null)

  const refresh=useCallback(async()=>{
    setLoading(true)
    try{
      const dates=[londonDate(0),londonDate(1),londonDate(2)]
      const fixtureResponses=await Promise.all(dates.map(async date=>{
        try{
          const r=await fetch("/api/fixtures?"+new URLSearchParams({date,refresh:String(Date.now())}),{cache:"no-store"})
          return r.ok?await r.json() as FixturesResponse:null
        }catch{return null}
      }))
      const fixtureMap=new Map<string,Fixture>()
      for(const data of fixtureResponses){
        if(!data)continue
        for(const competition of competitions){
          for(const f of data.leagues?.[competition]??[])fixtureMap.set(f.id,f)
        }
      }
      const upcoming=[...fixtureMap.values()]
        .filter(f=>new Date(f.kickoff).getTime()>Date.now()-2*60*60*1000)
        .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
        .slice(0,18)

      setFixturesScanned(upcoming.length)

      const rows=await Promise.all(upcoming.map(async fixture=>{
        try{
          const r=await fetch(scorecardUrl(fixture),{cache:"no-store"})
          if(!r.ok)return [] as Recommendation[]
          const scorecard=await r.json() as Scorecard
          if(!scorecard.ok)return [] as Recommendation[]
          const confirmed=Boolean(scorecard.lineupsConfirmed)
          const fixtureEligible=(scorecard.eligibleBooks?.length??0)>0
          if(!fixtureEligible)return [] as Recommendation[]
          const standards=confirmed?(scorecard.slips??[]):(scorecard.previewSlips??[])
          const fouls=confirmed?(scorecard.foulTargetSlips??[]):(scorecard.previewFoulTargetSlips??[])
          const candidates:Recommendation[]=[]

          for(const slip of standards){
            if(!slip.legs?.length||!slip.bookmaker)continue
            const blocked=blockedReason(scorecard,slip,"standard")
            const placeable=Boolean((slip as BetSlip).placeable)&&!blocked
            candidates.push({
              id:fixture.id+"|"+slip.id,
              fixture,slip,confirmed,kind:"standard",
              rank:rankSlip(slip,confirmed,placeable),
              placeable,
              blockedReason:blocked,
            })
          }

          const preferredFoul=fouls.filter(s=>s.bookmaker&&s.legs?.length).sort((a,b)=>rankSlip(b,confirmed,Boolean(b.placeable))-rankSlip(a,confirmed,Boolean(a.placeable)))[0]
          if(preferredFoul?.legs?.length){
            const blocked=blockedReason(scorecard,preferredFoul,"foul")
            const placeable=Boolean(preferredFoul.placeable)&&!blocked
            candidates.push({
              id:fixture.id+"|"+preferredFoul.id,
              fixture,slip:preferredFoul,confirmed,kind:"foul",
              rank:rankSlip(preferredFoul,confirmed,placeable),
              placeable,
              blockedReason:blocked,
            })
          }
          return candidates
        }catch{return [] as Recommendation[]}
      }))

      const sorted=rows.flat().sort((a,b)=>b.rank-a.rank)
      setRecommendations(sorted.slice(0,8))
      setLastUpdated(new Date())
    }finally{
      setLoading(false)
    }
  },[])

  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(),120000);return()=>window.clearInterval(t)},[refresh])

  const best=recommendations[0]??null
  const alternatives=useMemo(()=>recommendations.slice(1),[recommendations])

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-violet-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div><h1 className="mt-1 text-2xl font-black">Recommended</h1><p className="mt-1 text-xs text-white/45">Best model-identified slip across the next upcoming games.</p></div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-violet-300 p-2.5 text-violet-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
        <p className="mt-3 text-[0.58rem] text-white/30">Premier League · Championship · League One · International · {fixturesScanned} fixtures scanned{lastUpdated?" · updated "+lastUpdated.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):""}</p>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      {loading&&!best?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-violet-300"/><p className="font-black">Scanning upcoming matches…</p></div>:null}
      {!loading&&!best?<div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No recommendation ready yet</p><p className="mt-1 text-sm text-white/35">The tab will keep re-checking upcoming fixtures as lineups and markets become available.</p></div>:null}
      {best?<RecommendationCard rec={best} hero/>:null}

      {alternatives.length?<section className="space-y-3"><div className="px-1"><p className="font-black">Other strong options</p><p className="text-[0.6rem] text-white/35">Ranked below the main pick by calibrated selection strength and lineup certainty.</p></div>{alternatives.map(r=><RecommendationCard key={r.id} rec={r}/>)}</section>:null}
    </div>
  </main>
}

function RecommendationCard({rec,hero=false}:{rec:Recommendation;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  const legs=slipLegs(rec.slip)
  const avg=avgProbability(rec.slip)
  const bookmaker=(rec.slip as BetSlip|FoulTargetSlip).bookmaker??null
  const title=rec.kind==="foul"?"Foul builder "+(rec.slip as FoulTargetSlip).targetFractional:(rec.slip as BetSlip).title
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-violet-300/25 bg-gradient-to-br from-violet-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex flex-wrap gap-1.5"><span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+(rec.confirmed?"bg-emerald-400 text-emerald-950":"bg-amber-300 text-amber-950")}>{rec.confirmed?"CONFIRMED XI":"PROVISIONAL"}</span>{hero?<span className="rounded-full bg-violet-300 px-2 py-1 text-[0.5rem] font-black text-violet-950">TOP PICK</span>:null}</div><p className="mt-2 text-[0.58rem] font-black uppercase text-white/30">{rec.fixture.competition} · {time(rec.fixture)}</p><h2 className="mt-1 text-lg font-black">{rec.fixture.home.name} <span className="text-white/25">v</span> {rec.fixture.away.name}</h2><p className="mt-2 text-sm font-black">{title}</p>{bookmaker?<p className="mt-1 text-[0.58rem] font-black text-violet-300">{bookmaker}</p>:null}</div>
        <div className="text-right"><p className="font-mono text-2xl font-black">{percent(avg)}</p><p className="text-[0.44rem] uppercase text-white/30">avg leg strength</p></div>
      </div>

      <div className="mt-3 rounded-2xl bg-black/20 p-3">
        <div className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-violet-300"/><p className="text-[0.67rem] leading-relaxed text-white/55">{rec.kind==="foul"?"The model has found the strongest exact foul thresholds offered by one preferred bookmaker in this fixture. It ranks highly because the weakest leg still clears the foul-builder threshold and the lineup profile is strong.":"This is currently the strongest slip profile across the scanned fixtures after calibrated probability, weakest-leg strength, confidence grade, number of legs and lineup certainty are considered together."}</p></div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[0.6rem] text-white/40">{legs.length} legs</p>
        {rec.placeable?<span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[0.54rem] font-black text-emerald-300"><BadgeCheck className="size-3"/>MARKETS VERIFIED</span>:<span className="flex items-center gap-1 rounded-full bg-amber-300/10 px-2.5 py-1 text-[0.54rem] font-black text-amber-200"><AlertTriangle className="size-3"/>CHECK MARKET</span>}
      </div>
      {rec.blockedReason?<p className="mt-2 rounded-xl bg-amber-300/10 px-3 py-2 text-[0.6rem] text-amber-100">{rec.blockedReason}</p>:null}
    </button>

    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{legs.map((leg,i)=><div key={leg.player+"|"+leg.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black">{leg.player} · {leg.label}</p><p className="mt-0.5 text-[0.56rem] text-white/35">{leg.team} · Grade {leg.confidence}{leg.bookmakerName?" · "+leg.bookmakerName:""}</p></div><p className="font-mono text-base font-black">{percent(leg.probability)}</p></div><p className="mt-2 text-[0.62rem] leading-relaxed text-white/45">{leg.reason}</p></div>)}</div></div>:null}
  </article>
}
