"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship"
type LiveFixture = {
  id:string; competition:Competition; kickoff:string; status?:string;
  home:{name:string}; away:{name:string};
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = { connected:boolean; updatedAt:string; date:string; leagues:Record<Competition,LiveFixture[]> }
type Fixture = {
  id:string; competition:Competition; dateIso:string; day:string; date:string; time:string;
  home:string; away:string; status?:string; lineupStatus?:string
}
type MatchRow = { matchDate:string; opponent?:string|null; minutes?:number|null; foulsCommitted?:number|null; foulsDrawn?:number|null; yellowCard?:boolean|null }
type Candidate = {
  name:string; dbName:string; team:string; position?:string|null; predictedRole?:string|null;
  yellows:number; cards90:number; fouls90:number; fouled90?:number|null; sampleLabel:string;
  h2hYellows:number; h2hFouls:number; h2hMatches?:MatchRow[];
  score:number; cardRiskScore?:number;
  currentSeason?:{games?:number;minutes?:number;fouls?:number;yellows?:number;fouls90?:number|null;cards90?:number|null};
  recentFive?:{games?:number;minutes?:number;fouls?:number;yellows?:number;fouls90?:number|null;matches?:MatchRow[]};
  likelyMatchup?:{name:string;fouled90?:number|null;role?:string|null}|null;
}
type Radar = { lineupsConfirmed?:boolean; referee?:{name:string;yellowsPerGame?:number|null}|null; candidates?:Candidate[] }
type OddSelection = { market:string; kind:string; label:string; odd:number|null }
type OddsResponse = { bookmaker?:string; source?:string|null; capturedAt?:string|null; selections?:OddSelection[]; priceAvailable?:boolean }

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return `${v("year")}-${v("month")}-${v("day")}`
}
function displayFixture(raw:LiveFixture):Fixture{
  const d=new Date(raw.kickoff)
  return {
    id:String(raw.id),competition:raw.competition,
    dateIso:new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(d),
    day:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"long"}).format(d),
    date:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",day:"2-digit",month:"short"}).format(d),
    time:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false}).format(d),
    home:raw.home.name,away:raw.away.name,status:raw.status,lineupStatus:raw.lineupStatus,
  }
}
function radarQuery(f:Fixture,bust=0){
  return `/api/fixture-radar?${new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(bust)})}`
}
function oddsQuery(f:Fixture,bust=0){
  return `/api/bet-builder-odds?${new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(bust)})}`
}
function cardScore(c:Candidate){ return Number(c.cardRiskScore??c.score??0) }
function foulScore(c:Candidate){
  return Number(c.recentFive?.fouls90??0)*0.5 + Number(c.fouls90??0)*0.3 + Number(c.likelyMatchup?.fouled90??0)*0.2
}
function fouledScore(c:Candidate){ return Number(c.fouled90??0) }
function h2hMeetings(c:Candidate){ return c.h2hMatches?.length??0 }
function sotRows(o:OddsResponse|undefined){
  return (o?.selections??[])
    .filter(s=>s.kind==="sot"&&s.odd!=null)
    .sort((a,b)=>Number(a.odd)-Number(b.odd))
    .slice(0,5)
}

export default function HomePage(){
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[open,setOpen]=useState<string|null>(null)
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[radar,setRadar]=useState<Record<string,Radar>>({})
  const[odds,setOdds]=useState<Record<string,OddsResponse>>({})
  const[loading,setLoading]=useState<Record<string,boolean>>({})
  const[loadingFixtures,setLoadingFixtures]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)

  const fixtures=useMemo(()=>((live?.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture),[live,competition])

  const loadResearch=useCallback(async(fs:Fixture[],bust:number)=>{
    if(!fs.length)return
    setLoading(x=>({...x,...Object.fromEntries(fs.map(f=>[f.id,true]))}))
    await Promise.all(fs.map(async f=>{
      try{
        await Promise.all([
          (async()=>{const r=await fetch(radarQuery(f,bust),{cache:"no-store"});if(r.ok){const d=await r.json() as Radar;setRadar(x=>({...x,[f.id]:d}))}})(),
          (async()=>{const r=await fetch(oddsQuery(f,bust),{cache:"no-store"});if(r.ok){const d=await r.json() as OddsResponse;setOdds(x=>({...x,[f.id]:d}))}})(),
        ])
      }catch{}finally{setLoading(x=>({...x,[f.id]:false}))}
    }))
  },[])

  const refresh=useCallback(async(force=false)=>{
    const bust=Date.now()
    setLoadingFixtures(true)
    try{
      const r=await fetch(`/api/fixtures?date=${encodeURIComponent(selectedDate)}&refresh=${bust}`,{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures failed")
      const data=await r.json() as FixturesResponse
      setLive(data)
      const fs=((data.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture)
      await loadResearch(fs,bust)
      setLastRefresh(new Date())
      if(force&&open&&!fs.some(f=>f.id===open))setOpen(null)
    }catch{setLive(null)}finally{setLoadingFixtures(false)}
  },[competition,selectedDate,loadResearch,open])

  useEffect(()=>{void refresh(false)},[competition,selectedDate])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(false),60000);return()=>window.clearInterval(t)},[refresh])

  const today=londonDate()
  const noGames=!loadingFixtures&&live&&fixtures.length===0

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white shadow-sm">
      <div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Match Research</h1><p className="text-sm text-white/70">Cards, SOT, fouls and fouls drawn</p></div>
          <button onClick={()=>void refresh(true)} disabled={loadingFixtures} className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-60"><RefreshCw className={`size-4 ${loadingFixtures?"animate-spin":""}`}/> Refresh</button>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">{(["Premier League","Championship"] as Competition[]).map(c=><button key={c} onClick={()=>{setCompetition(c);setOpen(null)}} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}</div>
      </div>
    </header>

    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2"><CalendarDays className="size-4 text-muted-foreground"/><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);setOpen(null)}} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold"/>{selectedDate!==today?<button onClick={()=>{setSelectedDate(today);setOpen(null)}} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold">Today</button>:null}<span className="ml-auto text-[0.68rem] text-muted-foreground">{lastRefresh?`Updated ${lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`:"Loading…"}</span></div>
      </section>

      {loadingFixtures&&!live?<section className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-5 animate-spin"/>Loading games…</section>:null}
      {noGames?<section className="rounded-2xl border border-border bg-card p-6 text-center"><p className="font-bold">No {competition} games found for this date.</p></section>:null}

      {fixtures.map(f=>{
        const d=radar[f.id],o=odds[f.id],cs=d?.candidates??[],isOpen=open===f.id
        const confirmed=d?.lineupsConfirmed||f.lineupStatus==="confirmed"
        const cards=[...cs].sort((a,b)=>cardScore(b)-cardScore(a)).slice(0,5)
        const fouls=[...cs].sort((a,b)=>foulScore(b)-foulScore(a)).slice(0,5)
        const fouled=[...cs].sort((a,b)=>fouledScore(b)-fouledScore(a)).slice(0,5)
        const sots=sotRows(o)

        return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <button onClick={()=>setOpen(x=>x===f.id?null:f.id)} className="w-full p-4 text-left">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{f.day} · {f.date} · {f.time}</p><p className="mt-1 font-bold">{f.home} v {f.away}</p><div className="mt-1 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold ${confirmed?"bg-emerald-100 text-emerald-800":"bg-secondary text-muted-foreground"}`}>{confirmed?"LINEUPS CONFIRMED":"PRE-LINEUP"}</span><span className="text-xs font-semibold text-yellow-600">{isOpen?"Hide rankings":"View rankings"}</span></div></div>{isOpen?<ChevronUp/>:<ChevronDown/>}</div>
          </button>

          {isOpen?<div className="space-y-3 border-t border-border bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{d?.referee?.name?`Ref: ${d.referee.name}${d.referee.yellowsPerGame!=null?` · ${d.referee.yellowsPerGame.toFixed(2)} YC/game`:""}`:"Referee not confirmed"}</p><button onClick={()=>void loadResearch([f],Date.now())} className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-xs font-bold"><RefreshCw className={`size-4 ${loading[f.id]?"animate-spin":""}`}/> Refresh</button></div>

            <RankGroup title="Top 5 most likely carded" subtitle="H2H yellows · this season · recent 5 · cards/90 · fouls">
              {cards.map((c,i)=><CardRow key={c.dbName} rank={i+1} c={c}/>)}
            </RankGroup>

            <RankGroup title="Top 5 shots on target" subtitle={sots.length?`Fresh ${o?.bookmaker??"bookmaker"} SOT markets`:"No fresh player SOT feed returned for this match"}>
              {sots.length?sots.map((s,i)=><SimpleRow key={i} rank={i+1} name={s.label} stats={s.market} value={s.odd!=null?`${Number(s.odd).toFixed(2)} odds`:"—"}/>):<Unavailable text="SOT player data/price unavailable from the configured feed."/>}
            </RankGroup>

            <RankGroup title="Top 5 fouls committed" subtitle="Recent foul form · fouls/90 · direct matchup pressure">
              {fouls.map((c,i)=><SimpleRow key={c.dbName} rank={i+1} name={c.name} stats={`Recent 5: ${c.recentFive?.fouls??0} fouls · ${Number(c.fouls90??0).toFixed(2)}/90${c.likelyMatchup?.name?` · vs ${c.likelyMatchup.name}`:""}`} value={`${foulScore(c).toFixed(2)} rank`}/>)}
            </RankGroup>

            <RankGroup title="Top 5 fouls drawn" subtitle="Players most likely to draw fouls">
              {fouled.map((c,i)=><SimpleRow key={c.dbName} rank={i+1} name={c.name} stats={`${Number(c.fouled90??0).toFixed(2)} fouls drawn/90 · ${c.team}`} value={c.position??""}/>)}
            </RankGroup>
          </div>:null}
        </section>
      })}
    </div>
  </main>
}

function RankGroup({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border px-3 py-2.5"><p className="text-sm font-black">{title}</p><p className="text-[0.65rem] text-muted-foreground">{subtitle}</p></div><div className="divide-y divide-border">{children}</div></section>
}
function CardRow({rank,c}:{rank:number;c:Candidate}){
  return <div className="p-3"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-navy font-mono text-xs font-black text-white">{rank}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{c.name}</p><span className="font-mono text-sm font-black">{Math.round(cardScore(c))}</span></div><p className="text-xs text-muted-foreground">{c.team} · {c.position??"position unknown"}</p><div className="mt-2 grid grid-cols-5 gap-1.5 text-center"><Mini l="H2H YC" v={c.h2hYellows} sub={`${h2hMeetings(c)} games`}/><Mini l="26/27 YC" v={c.currentSeason?.yellows??0}/><Mini l="Recent 5 YC" v={c.recentFive?.yellows??0}/><Mini l="Cards/90" v={c.cards90} dec/><Mini l="Fouls/90" v={c.fouls90} dec/></div></div></div></div>
}
function SimpleRow({rank,name,stats,value}:{rank:number;name:string;stats:string;value:string}){
  return <div className="flex items-start gap-3 p-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-xs font-black">{rank}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{name}</p><span className="shrink-0 text-xs font-bold">{value}</span></div><p className="mt-0.5 text-xs text-muted-foreground">{stats}</p></div></div>
}
function Mini({l,v,sub,dec=false}:{l:string;v:number|null|undefined;sub?:string;dec?:boolean}){
  return <div className="rounded-lg bg-secondary p-1.5"><p className="font-mono text-sm font-black">{v==null?"—":dec?Number(v).toFixed(2):Math.round(Number(v))}</p><p className="text-[0.48rem] font-bold uppercase text-muted-foreground">{l}</p>{sub?<p className="text-[0.46rem] text-muted-foreground">{sub}</p>:null}</div>
}
function Unavailable({text}:{text:string}){return <div className="p-4 text-center text-xs text-muted-foreground">{text}</div>}
