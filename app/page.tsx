"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, Check, Layers3, LockKeyhole, RefreshCw, Sparkles, TicketCheck } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available" | "unavailable" | "unknown"

type LiveFixture = {
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
  lineupStatus?:string
}

type Availability = {
  card:MarketStatus
  foul:MarketStatus
  fouled:MarketStatus
  shot:MarketStatus
  sot:MarketStatus
}

type OddsCheck = {
  bookmaker?:string|null
  marketAvailability?:Availability
  bookmakerAvailability?:Record<string,Availability>
  cached?:boolean
  source?:string|null
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
    id:String(raw.id),
    competition:raw.competition,
    tournament:raw.tournament,
    dateIso:new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(d),
    day:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short"}).format(d),
    date:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",day:"2-digit",month:"short"}).format(d),
    time:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(d),
    kickoff:raw.kickoff,
    home:raw.home.name,
    away:raw.away.name,
    homeCrest:raw.home.crest,
    awayCrest:raw.away.crest,
    status:raw.status,
    lineupStatus:raw.lineupStatus,
  }
}

function oddsUrl(f:Fixture){
  return "/api/bet-builder-odds?"+new URLSearchParams({
    date:f.dateIso,
    home:f.home,
    away:f.away,
    competition:f.competition,
  })
}

function eligibility(check?:OddsCheck){
  if(!check)return {eligible:false,checking:true,reason:"Checking preferred bookmaker player markets…",books:[] as string[]}
  const books=Object.entries(check.bookmakerAvailability??{})
    .filter(([,a])=>a.card==="available"&&a.foul==="available")
    .map(([book])=>book)
  if(books.length)return {eligible:true,checking:false,reason:"Cards + fouls available together at "+books.join(", "),books}
  const a=check.marketAvailability
  if(!a)return {eligible:false,checking:false,reason:"Player markets not verified at the preferred bookmakers",books:[] as string[]}
  const missing:string[]=[]
  if(a.card!=="available")missing.push(a.card==="unavailable"?"cards unavailable":"cards not verified")
  if(a.foul!=="available")missing.push(a.foul==="unavailable"?"fouls unavailable":"fouls not verified")
  if(a.card==="available"&&a.foul==="available")missing.push("cards and fouls are not available together at the same bookmaker")
  return {eligible:false,checking:false,reason:missing.join(" · "),books:[] as string[]}
}

function singleSlipUrl(f:Fixture){
  const params=new URLSearchParams({
    id:f.id,
    date:f.dateIso,
    kickoff:f.kickoff,
    competition:f.competition,
    home:f.home,
    away:f.away,
  })
  return "/bet-builder?"+params.toString()
}

export default function MatchesPage(){
  const router=useRouter()
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[availability,setAvailability]=useState<Record<string,OddsCheck>>({})
  const[checking,setChecking]=useState<Record<string,boolean>>({})
  const[loadingFixtures,setLoadingFixtures]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)
  const[multiMode,setMultiMode]=useState(false)
  const[selectedMulti,setSelectedMulti]=useState<Record<string,Fixture>>({})

  const fixtures=useMemo(()=>((live?.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture),[live,competition])
  const selectedCount=Object.keys(selectedMulti).length

  const checkMarkets=useCallback(async(f:Fixture)=>{
    setChecking(x=>({...x,[f.id]:true}))
    try{
      const r=await fetch(oddsUrl(f),{cache:"no-store"})
      if(r.ok){
        const data=await r.json() as OddsCheck
        setAvailability(x=>({...x,[f.id]:data}))
      }
    }catch{}finally{
      setChecking(x=>({...x,[f.id]:false}))
    }
  },[])

  const refresh=useCallback(async()=>{
    const bust=Date.now()
    setLoadingFixtures(true)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({
        date:selectedDate,
        competition,
        nextIfEmpty:"0",
        refresh:String(bust),
      }),{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures")
      const data=await r.json() as FixturesResponse
      setLive(data)
      const fs=((data.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture)
      await Promise.all(fs.map(checkMarkets))
      setLastRefresh(new Date())
    }catch{
      setLive(null)
    }finally{
      setLoadingFixtures(false)
    }
  },[competition,selectedDate,checkMarkets])

  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(),180000);return()=>window.clearInterval(t)},[refresh])
  useEffect(()=>{setSelectedMulti({});setMultiMode(false)},[selectedDate])

  function toggleMulti(f:Fixture){
    const e=eligibility(availability[f.id])
    if(!e.eligible)return
    setSelectedMulti(current=>{
      if(current[f.id]){
        const next={...current}
        delete next[f.id]
        return next
      }
      if(Object.keys(current).length>=12)return current
      return {...current,[f.id]:f}
    })
  }

  function createMulti(){
    const games=Object.values(selectedMulti)
    if(games.length<2)return
    const compact=games.map(f=>({
      id:f.id,date:f.dateIso,kickoff:f.kickoff,competition:f.competition,home:f.home,away:f.away,
    }))
    router.push("/multi-match?games="+encodeURIComponent(JSON.stringify(compact)))
  }

  return <main className="min-h-screen bg-[#07120e] pb-36 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">Matches</h1>
            <p className="mt-1 text-xs text-white/45">{multiMode?"Select eligible games for one multi-match slip.":"Choose a game and create the slip from here."}</p>
          </div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loadingFixtures?"animate-spin":"")}/></button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {competitions.map(c=><button key={c} onClick={()=>setCompetition(c)} className={"shrink-0 rounded-full px-3.5 py-2 text-xs font-black "+(competition===c?"bg-white text-[#07120e]":"bg-white/7 text-white/55")}>{c}</button>)}
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.05] p-3.5">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <CalendarDays className="size-4 text-emerald-300"/>
            <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="w-full bg-transparent text-sm font-black outline-none [color-scheme:dark]"/>
          </div>
          <button onClick={()=>{setMultiMode(x=>!x);setSelectedMulti({})}} className={"flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-black "+(multiMode?"bg-sky-300 text-sky-950":"bg-white/8 text-white/70")}><Layers3 className="size-4"/>{multiMode?"Cancel":"Multi Match"}</button>
        </div>
        <p className="mt-2 text-[0.58rem] text-white/30">{lastRefresh?"Market check updated "+lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Checking Bet365 market availability…"} · only games with both player cards and player fouls can be used</p>
      </section>

      {loadingFixtures&&!live?<div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-2 size-5 animate-spin text-emerald-300"/><p className="font-black">Loading matches…</p></div>:null}

      {!loadingFixtures&&live&&fixtures.length===0?<div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center"><p className="font-black">No {competition} matches today</p><p className="mt-1 text-sm text-white/35">Choose another date or competition.</p></div>:null}

      <section className="space-y-3">
        {fixtures.map(f=>{
          const e=eligibility(availability[f.id])
          const picked=Boolean(selectedMulti[f.id])
          const lineups=f.lineupStatus==="confirmed"
          const status=f.status&&f.status!=="scheduled"?f.status.replaceAll("_"," "):null
          return <article key={f.id} className={"rounded-3xl border p-4 shadow-xl shadow-black/10 "+(e.eligible?"border-emerald-300/15 bg-[#0d1d17]":"border-white/8 bg-[#0a1612]")}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[0.58rem] font-black uppercase tracking-[0.12em] text-white/30">{f.day} {f.date} · {f.time}{status?" · "+status:""}</p><p className="mt-1 text-[0.58rem] text-white/30">{f.tournament??f.competition}</p></div>
              <span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+(lineups?"bg-emerald-400 text-emerald-950":"bg-white/7 text-white/40")}>{lineups?"XI CONFIRMED":"PRE-LINEUP"}</span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <Team name={f.home} crest={f.homeCrest}/>
              <span className="text-[0.55rem] font-black uppercase tracking-[0.2em] text-white/20">vs</span>
              <Team name={f.away} crest={f.awayCrest}/>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-3">
              <div className="min-w-0">
                {checking[f.id]&&!availability[f.id]?<p className="text-[0.62rem] font-bold text-white/45">Checking preferred bookmaker player markets…</p>:<>
                  <p className={"text-[0.62rem] font-black "+(e.eligible?"text-emerald-300":"text-rose-200")}>{e.eligible?"Eligible for betting slip":"Slip locked"}</p>
                  <p className="mt-0.5 truncate text-[0.56rem] text-white/35">{e.reason}</p>
                </>}
              </div>
              {e.eligible?<div className="flex shrink-0 gap-1.5"><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[0.48rem] font-black text-emerald-300">{e.books[0]??"BOOK"} ✓</span><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[0.48rem] font-black text-emerald-300">CARDS + FOULS</span></div>:<LockKeyhole className="size-4 shrink-0 text-white/25"/>}
            </div>

            <div className="mt-3">
              {multiMode?
                <button disabled={!e.eligible} onClick={()=>toggleMulti(f)} className={"flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-35 "+(picked?"bg-sky-300 text-sky-950":"bg-white/8 text-white")}><span className={"flex size-5 items-center justify-center rounded-md border "+(picked?"border-sky-950/20 bg-sky-950/10":"border-white/20")}>{picked?<Check className="size-3.5"/>:null}</span>{picked?"Selected":"Select for Multi Match"}</button>
                :
                <button disabled={!e.eligible} onClick={()=>router.push(singleSlipUrl(f))} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-emerald-950 disabled:cursor-not-allowed disabled:bg-white/7 disabled:text-white/25"><TicketCheck className="size-4"/>{e.eligible?"Create Bet Slip":"Bet Slip Unavailable"}</button>
              }
            </div>
          </article>
        })}
      </section>
    </div>

    {multiMode&&selectedCount>0?<div className="fixed inset-x-0 bottom-[4.9rem] z-40 px-4">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-sky-300/20 bg-[#10231d]/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="min-w-0 flex-1"><p className="text-sm font-black">{selectedCount} game{selectedCount===1?"":"s"} selected</p><p className="text-[0.55rem] text-white/40">{selectedCount<2?"Select at least one more eligible game":"Ready to generate one multi-match recommendation"}</p></div>
        <button onClick={createMulti} disabled={selectedCount<2} className="rounded-xl bg-sky-300 px-4 py-2.5 text-xs font-black text-sky-950 disabled:opacity-40">Create Multi-Match Slip</button>
      </div>
    </div>:null}
  </main>
}

function Team({name,crest}:{name:string;crest?:string}){
  return <div className="flex min-w-0 flex-1 flex-col items-center text-center"><div className="flex size-12 items-center justify-center rounded-2xl bg-white p-2">{crest?<img src={crest} alt="" className="max-h-full max-w-full object-contain"/>:<span className="font-black text-[#07120e]">{name.slice(0,2).toUpperCase()}</span>}</div><p className="mt-2 max-w-[8rem] text-sm font-black leading-tight">{name}</p></div>
}
