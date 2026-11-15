"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, ChevronRight, RefreshCw, Sparkles } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type LiveFixture = {
  id:string
  competition:Competition
  tournament?:string
  kickoff:string
  status?:string
  score?:{home:number|null;away:number|null}
  elapsed?:number|null
  home:{name:string;crest?:string}
  away:{name:string;crest?:string}
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = {
  connected:boolean
  updatedAt:string
  date:string
  requestedDate?:string
  leagues:Record<Competition,LiveFixture[]>
}
type MarketStatus="available"|"unavailable"|"unknown"
type Bet365Availability={
  loading:boolean
  priceAvailable:boolean
  liveVerified?:boolean
  marketAvailability:Record<string,MarketStatus>
  note?:string|null
}
type Fixture = {
  id:string
  competition:Competition
  tournament?:string
  dateIso:string
  day:string
  date:string
  time:string
  kickoff:string
  home:string
  away:string
  homeCrest?:string
  awayCrest?:string
  status?:string
  score?:{home:number|null;away:number|null}
  elapsed?:number|null
  lineupStatus?:string
}

const competitionOrder:Competition[]=["International","Premier League","Championship","League One","League Two"]

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return v("year")+"-"+v("month")+"-"+v("day")
}
function addDays(date:string,days:number){
  const d=new Date(date+"T12:00:00Z")
  d.setUTCDate(d.getUTCDate()+days)
  return d.toISOString().slice(0,10)
}
function prettyDate(date:string){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"long",day:"numeric",month:"long"}).format(new Date(date+"T12:00:00Z"))
}
function displayFixture(raw:LiveFixture):Fixture{
  const d=new Date(raw.kickoff)
  return {
    id:String(raw.id),competition:raw.competition,tournament:raw.tournament,
    dateIso:new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(d),
    day:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short"}).format(d),
    date:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",day:"2-digit",month:"short"}).format(d),
    time:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(d),
    kickoff:raw.kickoff,home:raw.home.name,away:raw.away.name,homeCrest:raw.home.crest,awayCrest:raw.away.crest,
    status:raw.status,score:raw.score,elapsed:raw.elapsed,lineupStatus:raw.lineupStatus,
  }
}
function matchUrl(f:Fixture){
  return "/bet-builder?"+new URLSearchParams({
    id:f.id,date:f.dateIso,kickoff:f.kickoff,competition:f.competition,home:f.home,away:f.away,
  }).toString()
}
function isLive(f:Fixture){
  return ["live","halftime","1h","2h","in_progress","in progress"].includes(String(f.status??"").toLowerCase())
}
function oddsUrl(f:Fixture){
  const params:Record<string,string>={
    date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(Date.now()),
  }
  if(isLive(f))params.live="1"
  return "/api/bet-builder-odds?"+new URLSearchParams(params)
}
const marketLabels:Record<string,string>={
  goal:"Goals",assist:"Assists",card:"Cards",foul:"Fouls",fouled:"Fouled",shot:"Shots",sot:"SOT",
}
function availabilitySummary(a:Bet365Availability|undefined){
  if(!a||a.loading)return {tone:"checking",title:"Checking Bet365 markets",detail:""}
  const available=Object.entries(a.marketAvailability??{}).filter(([,v])=>v==="available").map(([k])=>marketLabels[k]??k)
  const unavailable=Object.entries(a.marketAvailability??{}).filter(([,v])=>v==="unavailable").map(([k])=>marketLabels[k]??k)
  if(!available.length&&unavailable.length)return {tone:"none",title:"No Bet365 player markets",detail:"Player props are not currently offered in the verified Bet365 feed."}
  if(available.length)return {
    tone:"available",
    title:"Bet365 player markets available",
    detail:"Available: "+available.join(", ")+(unavailable.length?" · Not offered: "+unavailable.join(", "):"")
  }
  return {tone:"checking",title:"Bet365 market status unknown",detail:a.note??""}
}
function isFinished(raw:LiveFixture|Fixture){
  const status=String(raw.status??"").toLowerCase()
  return ["finished","ft","full time","after extra time","aet","cancelled","canceled","postponed","abandoned"].includes(status)
}
function hasRemainingGames(data:FixturesResponse|null){
  if(!data)return false
  return competitionOrder.some(c=>(data.leagues?.[c]??[]).some(f=>!isFinished(f)))
}

export default function MatchesPage(){
  const router=useRouter()
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[resolvedDate,setResolvedDate]=useState(londonDate)
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[loading,setLoading]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)
  const[autoAdvanced,setAutoAdvanced]=useState(false)
  const[bet365Availability,setBet365Availability]=useState<Record<string,Bet365Availability>>({})

  const grouped=useMemo(()=>competitionOrder.map(competition=>({
    competition,
    fixtures:((live?.leagues?.[competition]??[]) as LiveFixture[])
      .filter(f=>!isFinished(f))
      .map(displayFixture),
  })).filter(group=>group.fixtures.length),[live])

  const totalRemaining=grouped.reduce((sum,g)=>sum+g.fixtures.length,0)
  const visibleFixtures=useMemo(()=>grouped.flatMap(g=>g.fixtures),[grouped])

  const refreshBet365Availability=useCallback(async(fixtures:Fixture[])=>{
    if(!fixtures.length)return
    setBet365Availability(cur=>{
      const next={...cur}
      for(const fixture of fixtures)next[fixture.id]={...(next[fixture.id]??{priceAvailable:false,marketAvailability:{}}),loading:true}
      return next
    })
    const results=await Promise.all(fixtures.map(async fixture=>{
      try{
        const response=await fetch(oddsUrl(fixture),{cache:"no-store"})
        if(!response.ok)throw new Error("odds")
        const data=await response.json()
        return [fixture.id,{
          loading:false,
          priceAvailable:Boolean(data?.priceAvailable),
          liveVerified:data?.liveVerified,
          marketAvailability:data?.marketAvailability??{},
          note:data?.note??null,
        }] as const
      }catch{
        return [fixture.id,{loading:false,priceAvailable:false,marketAvailability:{},note:"Unable to verify Bet365 markets right now."}] as const
      }
    }))
    setBet365Availability(cur=>({...cur,...Object.fromEntries(results)}))
  },[])

  const fetchDate=useCallback(async(date:string)=>{
    const r=await fetch("/api/fixtures?"+new URLSearchParams({
      date,nextIfEmpty:"0",refresh:String(Date.now()),
    }),{cache:"no-store"})
    if(!r.ok)throw new Error("fixtures")
    return await r.json() as FixturesResponse
  },[])

  const refresh=useCallback(async()=>{
    setLoading(true)
    try{
      let date=selectedDate
      let data=await fetchDate(date)
      let advanced=false

      if(!hasRemainingGames(data)){
        for(let offset=1;offset<=21;offset++){
          const next=addDays(selectedDate,offset)
          const candidate=await fetchDate(next)
          if(hasRemainingGames(candidate)){
            date=next
            data=candidate
            advanced=true
            break
          }
        }
      }

      setResolvedDate(date)
      setLive(data)
      setAutoAdvanced(advanced)
      setLastRefresh(new Date())
    }catch{
      setLive(null)
      setResolvedDate(selectedDate)
      setAutoAdvanced(false)
    }finally{
      setLoading(false)
    }
  },[fetchDate,selectedDate])

  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(t)},[refresh])
  useEffect(()=>{void refreshBet365Availability(visibleFixtures)},[visibleFixtures,refreshBet365Availability])
  useEffect(()=>{
    if(!visibleFixtures.some(isLive))return
    const t=window.setInterval(()=>void refreshBet365Availability(visibleFixtures),30000)
    return()=>window.clearInterval(t)
  },[visibleFixtures,refreshBet365Availability])

  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Matches</h1>
            <p className="mt-1 text-xs text-white/45">Choose a game. Bet365 market availability is checked before you open it.</p>
          </div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="flex items-center gap-2 rounded-3xl border border-white/10 bg-white/[0.045] p-3">
        <CalendarDays className="size-4 shrink-0 text-emerald-300"/>
        <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none [color-scheme:dark]"/>
        <span className="text-[0.48rem] font-black uppercase text-white/25">{lastRefresh?"Updated "+lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Loading"}</span>
      </section>

      {autoAdvanced?<section className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.05] px-4 py-3"><p className="text-xs font-black text-emerald-200">No more games on {prettyDate(selectedDate)}</p><p className="mt-1 text-[0.58rem] text-white/40">Showing the next available matchday: {prettyDate(resolvedDate)}.</p></section>:null}

      {!loading&&live&&totalRemaining>0?<div className="flex items-end justify-between gap-3 px-1"><div><p className="text-lg font-black">{prettyDate(resolvedDate)}</p><p className="mt-0.5 text-[0.56rem] text-white/30">{totalRemaining} upcoming/live match{totalRemaining===1?"":"es"}</p></div><p className="text-[0.46rem] font-black uppercase text-white/20">INT → PL → CH → L1 → L2</p></div>:null}

      {loading&&!live?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-2 size-5 animate-spin text-emerald-300"/><p className="font-black">Finding the next matchday…</p></div>:null}
      {!loading&&live&&totalRemaining===0?<div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No upcoming matches found</p><p className="mt-1 text-sm text-white/35">Nothing was found across International, Premier League, Championship, League One or League Two in the next 21 days.</p></div>:null}

      {grouped.map(group=><CompetitionSection key={group.competition} competition={group.competition} fixtures={group.fixtures} availability={bet365Availability} onOpen={f=>router.push(matchUrl(f))}/>)}

      <p className="px-2 text-center text-[0.5rem] leading-relaxed text-white/25">Finished fixtures are hidden from the active match list. When the day's football is over, Matches automatically rolls forward to the next available date.</p>
    </div>
  </main>
}

function CompetitionSection({competition,fixtures,availability,onOpen}:{competition:Competition;fixtures:Fixture[];availability:Record<string,Bet365Availability>;onOpen:(f:Fixture)=>void}){
  return <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
    <div className="flex items-center justify-between border-b border-white/8 px-4 py-3"><div><p className="text-sm font-black">{competition}</p><p className="mt-0.5 text-[0.46rem] text-white/25">{fixtures.length} match{fixtures.length===1?"":"es"}</p></div><span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/30">3 MODEL BUILDS PER MATCH</span></div>
    {fixtures.map((f,i)=>{
      const liveNow=isLive(f)
      const confirmed=f.lineupStatus==="confirmed"
      const bet365=availabilitySummary(availability[f.id])
      const bet365Class=bet365.tone==="available"?"bg-emerald-300/10 text-emerald-200":bet365.tone==="none"?"bg-rose-300/10 text-rose-200":"bg-white/6 text-white/35"
      return <button key={f.id} onClick={()=>onOpen(f)} className={"grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-4 text-left transition hover:bg-white/[0.035] "+(i?"border-t border-white/[0.055]":"")}>
        <div className="w-12 text-center">
          {liveNow?<><p className="text-[0.55rem] font-black text-rose-300">LIVE</p><p className="mt-0.5 font-mono text-xs font-black">{f.elapsed??""}'</p></>:<><p className="font-mono text-sm font-black">{f.time}</p><p className="mt-0.5 text-[0.44rem] text-white/25">{f.day}</p></>}
        </div>
        <div className="min-w-0">
          <TeamRow name={f.home} crest={f.homeCrest} score={f.score?.home}/>
          <TeamRow name={f.away} crest={f.awayCrest} score={f.score?.away}/>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className={"rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+(confirmed?"bg-emerald-400/12 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{confirmed?"XI CONFIRMED":"PREDICTED XI"}</span><span className={"rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+bet365Class}>{bet365.title.toUpperCase()}</span>{f.tournament&&f.tournament!==competition?<span className="truncate text-[0.43rem] text-white/20">{f.tournament}</span>:null}</div>
          {bet365.detail?<p className={"mt-1 text-[0.43rem] leading-relaxed "+(bet365.tone==="none"?"text-rose-200/65":bet365.tone==="available"?"text-emerald-200/55":"text-white/25")}>{bet365.detail}</p>:null}
        </div>
        <ChevronRight className="size-4 text-white/25"/>
      </button>
    })}
  </section>
}

function TeamRow({name,crest,score}:{name:string;crest?:string;score?:number|null}){
  return <div className="flex items-center gap-2 py-0.5"><div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white p-1">{crest?<img src={crest} alt="" className="max-h-full max-w-full object-contain"/>:<span className="text-[0.42rem] font-black text-[#07120e]">{name.slice(0,2).toUpperCase()}</span>}</div><p className="min-w-0 flex-1 truncate text-sm font-black">{name}</p>{score!=null?<span className="font-mono text-sm font-black">{score}</span>:null}</div>
}
