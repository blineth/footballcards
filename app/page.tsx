"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, ChevronUp, Database, RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship"
type LiveFixture = {
  id: string
  competition: Competition
  kickoff: string
  status?: string
  home: { name: string }
  away: { name: string }
  lineupStatus?: "expected" | "confirmed" | "unavailable"
}
type FixturesResponse = {
  connected: boolean
  updatedAt: string
  date: string
  leagues: Record<Competition, LiveFixture[]>
}
type Fixture = {
  id: string
  competition: Competition
  dateIso: string
  day: string
  date: string
  time: string
  home: string
  away: string
  status?: string
  lineupStatus?: string
}
type MatchRow = { matchDate: string; opponent?: string | null; minutes?: number | null; foulsCommitted?: number | null; foulsDrawn?: number | null; yellowCard?: boolean | null }
type Candidate = {
  name: string; dbName: string; team: string; position?: string | null; predictedRole?: string | null; predictedStarter?: boolean; predictedLineupConfidence?: string | null; predictedFormation?: string | null; yellows: number; cards90: number; fouls90: number; fouled90?: number | null; sampleLabel: string;
  h2hYellows: number; h2hFouls: number; h2hMatches?: MatchRow[]; score: number; cardRiskScore?: number; band: "STRONG" | "GOOD" | "WATCH";
  currentSeason?: { games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; cards90?: number | null };
  recentFive?: { games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; matches?: MatchRow[] };
  likelyMatchup?: { name: string; position?: string | null; role?: string | null; fouled90?: number | null; type?: string | null; confidence?: string | null } | null;
  refereePlayer?: { matches: number; yellows: number; fouls: number; cardRate?: number | null } | null;
  shortlistReasons?: string[];
}
type Radar = { lineupsConfirmed?: boolean; deepEvidence?: { description?: string }; referee?: { name: string; yellowsPerGame?: number | null; foulsPerGame?: number | null } | null; candidates?: Candidate[] }

function londonDate() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const val = (t:string) => parts.find(p => p.type === t)?.value ?? ""
  return `${val("year")}-${val("month")}-${val("day")}`
}
function displayFixture(raw:LiveFixture):Fixture {
  const d = new Date(raw.kickoff)
  return {
    id: String(raw.id),
    competition: raw.competition,
    dateIso: new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/London", year:"numeric", month:"2-digit", day:"2-digit" }).format(d),
    day: new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", weekday:"long" }).format(d),
    date: new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", day:"2-digit", month:"short" }).format(d),
    time: new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", hour:"2-digit", minute:"2-digit", hour12:false }).format(d),
    home: raw.home.name,
    away: raw.away.name,
    status: raw.status,
    lineupStatus: raw.lineupStatus,
  }
}
function query(f: Fixture, bust=0) {
  const p = new URLSearchParams({ date:f.dateIso, home:f.home, away:f.away, competition:f.competition, refresh:String(bust) })
  return `/api/fixture-radar?${p}`
}
function fmtDate(v:string){ const d=new Date(`${v.slice(0,10)}T12:00:00Z`); return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(d) }
function minLabel(v:number|null|undefined){ if(v==null)return "minutes unknown"; if(v===0)return "did not play"; return `${v} min` }
function bandClass(b:Candidate["band"]){ return b==="STRONG"?"border-emerald-200 bg-emerald-50 text-emerald-800":b==="GOOD"?"border-amber-200 bg-amber-50 text-amber-800":"border-slate-200 bg-slate-50 text-slate-700" }

export default function HomePage(){
  const [competition,setCompetition]=useState<Competition>("Premier League")
  const [selectedDate,setSelectedDate]=useState(londonDate)
  const [open,setOpen]=useState<string|null>(null)
  const [live,setLive]=useState<FixturesResponse|null>(null)
  const [radar,setRadar]=useState<Record<string,Radar>>({})
  const [loading,setLoading]=useState<Record<string,boolean>>({})
  const [loadingFixtures,setLoadingFixtures]=useState(false)
  const [lastRefresh,setLastRefresh]=useState<Date|null>(null)

  const fixtures=useMemo(()=>((live?.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture),[live,competition])

  const loadRadar=useCallback(async(fs:Fixture[], bust:number)=>{
    if(!fs.length) return
    setLoading(x=>({...x,...Object.fromEntries(fs.map(f=>[f.id,true]))}))
    await Promise.all(fs.map(async f=>{
      try{
        const r=await fetch(query(f,bust),{cache:"no-store",headers:{"x-card-research-refresh":String(bust)}})
        if(r.ok){ const data=await r.json() as Radar; setRadar(x=>({...x,[f.id]:data})) }
      }finally{ setLoading(x=>({...x,[f.id]:false})) }
    }))
  },[])

  const refresh=useCallback(async(force=false)=>{
    const bust=Date.now()
    setLoadingFixtures(true)
    try{
      const r=await fetch(`/api/fixtures?date=${encodeURIComponent(selectedDate)}&refresh=${bust}`,{cache:"no-store",headers:{"x-card-research-refresh":String(bust)}})
      if(!r.ok) throw new Error("fixtures request failed")
      const data=await r.json() as FixturesResponse
      setLive(data)
      const fs=((data.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture)
      await loadRadar(fs,bust)
      setLastRefresh(new Date())
      if(force && open && !fs.some(f=>f.id===open)) setOpen(null)
    }catch{
      setLive(null)
    }finally{
      setLoadingFixtures(false)
    }
  },[competition,selectedDate,loadRadar,open])

  useEffect(()=>{ void refresh(false) },[competition,selectedDate])
  useEffect(()=>{
    const t=window.setInterval(()=>void refresh(false),60000)
    return()=>window.clearInterval(t)
  },[refresh])

  const today=londonDate()
  const noGames=!loadingFixtures && live && fixtures.length===0

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white shadow-sm">
      <div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Card Research</h1><p className="text-sm text-white/70">Live games, lineups and yellow-card evidence</p></div>
          <button onClick={()=>void refresh(true)} disabled={loadingFixtures} className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-60">
            <RefreshCw className={`size-4 ${loadingFixtures?"animate-spin":""}`}/> Refresh
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">{(["Premier League","Championship"] as Competition[]).map(c=><button key={c} onClick={()=>{setCompetition(c);setOpen(null)}} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}</div>
      </div>
    </header>

    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground"/>
          <input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);setOpen(null)}} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold"/>
          {selectedDate!==today?<button onClick={()=>{setSelectedDate(today);setOpen(null)}} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold">Today</button>:null}
          <span className="ml-auto text-[0.68rem] text-muted-foreground">{lastRefresh?`Updated ${lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`:"Loading live data…"}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4"><div className="flex gap-3"><Database className="mt-0.5 size-5"/><div><p className="font-bold">How the research view works</p><p className="mt-1 text-sm text-muted-foreground">Fixtures and lineups are pulled live for the selected day. The ranking combines 2025/26 baseline cards and fouls with recent-five form, H2H history, 2026/27 evidence, referee history and direct positional matchup pressure. The page auto-refreshes every 60 seconds and the refresh button forces a fresh lineup check.</p></div></div></section>

      {loadingFixtures && !live?<section className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-5 animate-spin"/>Loading today&apos;s games…</section>:null}
      {noGames?<section className="rounded-2xl border border-border bg-card p-6 text-center"><p className="font-bold">No {competition} games found for this date.</p><p className="mt-1 text-sm text-muted-foreground">Choose another date above. The live feed is still connected and will update as fixtures become available.</p></section>:null}

      {fixtures.map(f=>{ const d=radar[f.id], candidates=d?.candidates??[], isOpen=open===f.id; const confirmed=d?.lineupsConfirmed||f.lineupStatus==="confirmed"; return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <button onClick={()=>setOpen(x=>x===f.id?null:f.id)} className="w-full p-4 text-left"><div className="flex items-center justify-between gap-3"><div><p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{f.day} · {f.date} · {f.time}{f.status&&f.status!=="scheduled"?` · ${f.status}`:""}</p><p className="mt-1 font-bold">{f.home} v {f.away}</p><div className="mt-1 flex items-center gap-2"><p className="text-xs font-semibold text-yellow-500">{isOpen?"Hide full research":"View full card research"}</p><span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold ${confirmed?"bg-emerald-100 text-emerald-800":"bg-secondary text-muted-foreground"}`}>{confirmed?"LINEUPS CONFIRMED":"PRE-LINEUP"}</span></div></div>{isOpen?<ChevronUp/>:<ChevronDown/>}</div></button>
        {isOpen?<div className="border-t border-border bg-secondary/20 p-3"><div className="mb-3 flex items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase text-muted-foreground">Top 10 evidence-ranked candidates</p><p className="text-[0.67rem] text-muted-foreground">{confirmed?"Confirmed XI":"Predicted XI / pre-lineup"}{d?.referee?` · Ref ${d.referee.name}${d.referee.yellowsPerGame!=null?` (${d.referee.yellowsPerGame.toFixed(2)} YC/game)`:""}`:""}</p></div><button onClick={()=>void loadRadar([f],Date.now())} className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-xs font-bold"><RefreshCw className={`size-4 ${loading[f.id]?"animate-spin":""}`}/> Lineup</button></div>
          {!d && loading[f.id]?<div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Refreshing live lineup and card data…</div>:null}
          <div className="space-y-3">{candidates.slice(0,10).map((c,i)=><article key={c.dbName} className="rounded-xl border border-border bg-card p-3"><div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold">{i+1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{c.name}</p><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${bandClass(c.band)}`}>{c.band}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-[0.62rem] font-bold">risk evidence {Math.round(c.cardRiskScore??c.score)}</span></div><p className="text-xs text-muted-foreground">{c.team} · {c.predictedRole??c.position??"position unknown"} · {c.predictedStarter&&!confirmed?"predicted starter":c.sampleLabel}</p>{c.predictedFormation&&!confirmed?<p className="mt-0.5 text-[0.65rem] font-semibold text-amber-700">Predicted {c.predictedFormation} · {c.predictedLineupConfidence==="conflicting-predicted"?"sources conflict":"not confirmed"}</p>:null}
            <div className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6"><Stat label="25/26 YC" value={c.yellows}/><Stat label="Cards/90" value={c.cards90} dec/><Stat label="Fouls/90" value={c.fouls90} dec/><Stat label="Fouled/90" value={c.fouled90} dec/><Stat label="H2H YC" value={c.h2hYellows}/><Stat label="H2H fouls" value={c.h2hFouls}/></div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-secondary p-2"><b>Recent 5:</b> {c.recentFive?.yellows??0} YC · {c.recentFive?.fouls??0} fouls · {c.recentFive?.fouls90!=null?`${c.recentFive.fouls90.toFixed(2)} fouls/90`:"rate unknown"}</div><div className="rounded-lg bg-secondary p-2"><b>2026/27:</b> {c.currentSeason?.yellows??0} YC · {c.currentSeason?.fouls??0} fouls · {c.currentSeason?.minutes??0} min</div></div>
            {c.likelyMatchup?<div className="mt-2 rounded-lg border border-border p-2 text-xs"><b>{c.likelyMatchup.type==="direct-predicted-role"&&!confirmed?"Predicted direct matchup":"Likely matchup pressure"}:</b> {c.predictedRole??c.position??"Player"} → {c.likelyMatchup.role?`${c.likelyMatchup.role} `:""}{c.likelyMatchup.name}{c.likelyMatchup.fouled90!=null?` · draws ${c.likelyMatchup.fouled90.toFixed(2)} fouls/90`:" · foul-drawn rate unavailable"}{c.likelyMatchup.type==="direct-predicted-role"&&!confirmed?" · predicted, not confirmed":""}</div>:null}
            {c.refereePlayer?<div className="mt-2 rounded-lg border border-border p-2 text-xs"><b>With this referee:</b> {c.refereePlayer.yellows} yellows in {c.refereePlayer.matches} matches · {c.refereePlayer.fouls} fouls</div>:null}
            {c.h2hMatches?.length?<div className="mt-3"><p className="mb-1 text-[0.62rem] font-bold uppercase text-muted-foreground">Previous H2H meetings</p><div className="space-y-1">{c.h2hMatches.map((m,j)=><MatchLine key={`${m.matchDate}-${j}`} m={m}/>)}</div></div>:null}
            {c.recentFive?.matches?.length?<div className="mt-3"><p className="mb-1 text-[0.62rem] font-bold uppercase text-muted-foreground">Recent match sample</p><div className="space-y-1">{c.recentFive.matches.map((m,j)=><MatchLine key={`${m.matchDate}-${j}`} m={m}/>)}</div></div>:null}
          </div></div></article>)}</div>
        </div>:null}
      </section>})}
    </div>
  </main>
}

function Stat({label,value,dec=false}:{label:string;value:number|null|undefined;dec?:boolean}){ return <div className="rounded-lg bg-secondary p-2"><p className="font-mono font-bold">{value==null?"—":dec?Number(value).toFixed(2):Math.round(Number(value))}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">{label}</p></div> }
function MatchLine({m}:{m:MatchRow}){ return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-2.5 py-2 text-xs"><span className="font-semibold">{fmtDate(m.matchDate)} · {m.opponent??"opponent"} · {minLabel(m.minutes)}</span><span className="text-muted-foreground">{m.foulsCommitted??0} fouls · {m.foulsDrawn??0} drawn{m.yellowCard===true?" · booked":""}</span></div> }
