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
  leagues:Record<Competition,LiveFixture[]>
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

const competitions:Competition[]=["Premier League","Championship","League One","League Two","International"]

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return v("year")+"-"+v("month")+"-"+v("day")
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
  return ["live","halftime","1h","2h","in_progress"].includes(String(f.status??"").toLowerCase())
}

export default function MatchesPage(){
  const router=useRouter()
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[loading,setLoading]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)

  const fixtures=useMemo(()=>((live?.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture),[live,competition])

  const refresh=useCallback(async()=>{
    setLoading(true)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({
        date:selectedDate,competition,nextIfEmpty:"0",refresh:String(Date.now()),
      }),{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures")
      setLive(await r.json())
      setLastRefresh(new Date())
    }catch{setLive(null)}
    finally{setLoading(false)}
  },[competition,selectedDate])

  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(t)},[refresh])

  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Matches</h1>
            <p className="mt-1 text-xs text-white/45">Choose a game. We build the strongest bets inside it.</p>
          </div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {competitions.map(c=><button key={c} onClick={()=>setCompetition(c)} className={"shrink-0 rounded-full px-3.5 py-2 text-xs font-black "+(competition===c?"bg-white text-[#07120e]":"bg-white/7 text-white/55")}>{c}</button>)}
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="flex items-center gap-2 rounded-3xl border border-white/10 bg-white/[0.045] p-3">
        <CalendarDays className="size-4 shrink-0 text-emerald-300"/>
        <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none [color-scheme:dark]"/>
        <span className="text-[0.48rem] font-black uppercase text-white/25">{lastRefresh?"Updated "+lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Loading"}</span>
      </section>

      {loading&&!live?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-2 size-5 animate-spin text-emerald-300"/><p className="font-black">Loading matches…</p></div>:null}
      {!loading&&live&&fixtures.length===0?<div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No {competition} matches on this date</p><p className="mt-1 text-sm text-white/35">Choose another date or competition.</p></div>:null}

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        {fixtures.map((f,i)=>{
          const liveNow=isLive(f)
          const confirmed=f.lineupStatus==="confirmed"
          return <button key={f.id} onClick={()=>router.push(matchUrl(f))} className={"grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-4 text-left transition hover:bg-white/[0.035] "+(i?"border-t border-white/[0.055]":"")}>
            <div className="w-12 text-center">
              {liveNow?<><p className="text-[0.55rem] font-black text-rose-300">LIVE</p><p className="mt-0.5 font-mono text-xs font-black">{f.elapsed??""}'</p></>:<><p className="font-mono text-sm font-black">{f.time}</p><p className="mt-0.5 text-[0.44rem] text-white/25">{f.day}</p></>}
            </div>
            <div className="min-w-0">
              <TeamRow name={f.home} crest={f.homeCrest} score={f.score?.home}/>
              <TeamRow name={f.away} crest={f.awayCrest} score={f.score?.away}/>
              <div className="mt-1.5 flex items-center gap-1.5"><span className={"rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+(confirmed?"bg-emerald-400/12 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{confirmed?"XI CONFIRMED":"PREDICTED XI"}</span><span className="truncate text-[0.43rem] text-white/20">{f.tournament??f.competition}</span></div>
            </div>
            <div className="flex items-center gap-2"><span className="hidden rounded-full bg-white/6 px-2 py-1 text-[0.43rem] font-black text-white/30 sm:inline">3 BUILDS</span><ChevronRight className="size-4 text-white/25"/></div>
          </button>
        })}
      </section>

      <p className="px-2 text-center text-[0.5rem] leading-relaxed text-white/25">Open any match to see three model-built slips first, then add or remove player markets yourself.</p>
    </div>
  </main>
}

function TeamRow({name,crest,score}:{name:string;crest?:string;score?:number|null}){
  return <div className="flex items-center gap-2 py-0.5"><div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white p-1">{crest?<img src={crest} alt="" className="max-h-full max-w-full object-contain"/>:<span className="text-[0.42rem] font-black text-[#07120e]">{name.slice(0,2).toUpperCase()}</span>}</div><p className="min-w-0 flex-1 truncate text-sm font-black">{name}</p>{score!=null?<span className="font-mono text-sm font-black">{score}</span>:null}</div>
}
