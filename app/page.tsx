"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, ChevronDown, ChevronUp, RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "International"
type LiveFixture = {
  id:string; competition:Competition; tournament?:string; kickoff:string; status?:string;
  home:{name:string}; away:{name:string};
  lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type FixturesResponse = { connected:boolean; updatedAt:string; date:string; requestedDate?:string; showingNextMatchday?:boolean; leagues:Record<Competition,LiveFixture[]> }
type Fixture = {
  id:string; competition:Competition; tournament?:string; dateIso:string; day:string; date:string; time:string;
  home:string; away:string; status?:string; lineupStatus?:string
}
type MatchRow = { matchDate:string; opponent?:string|null; minutes?:number|null; goals?:number|null; assists?:number|null; shots?:number|null; shotsOnTarget?:number|null; foulsCommitted?:number|null; foulsDrawn?:number|null; yellowCard?:boolean|null }
type Candidate = {
  name:string; dbName:string; team:string; position?:string|null; predictedRole?:string|null;
  yellows:number; cards90:number; fouls90:number; fouled90?:number|null; sampleLabel:string;
  h2hYellows:number; h2hFouls:number; h2hMatches?:MatchRow[];
  score:number; cardRiskScore?:number;
  previousSeason?:{season:string;clubs:string[];competitions:string[];appearances:number;starts:number;minutes:number;goals:number;assists:number;yellows:number;redCards:number;fouls:number;foulsDrawn:number;shots:number;shotsOnTarget:number;fouls90?:number|null;cards90?:number|null;shots90?:number|null;shotsOnTarget90?:number|null}|null;
  currentSeason?:{games?:number;minutes?:number;fouls?:number;yellows?:number;fouls90?:number|null;cards90?:number|null};
  recentFive?:{games?:number;minutes?:number;fouls?:number;yellows?:number;fouls90?:number|null;matches?:MatchRow[]};
  likelyMatchup?:{name:string;fouled90?:number|null;role?:string|null}|null;
}
type Radar = { lineupsConfirmed?:boolean; referee?:{name:string;yellowsPerGame?:number|null}|null; candidates?:Candidate[] }
type OddSelection = { market:string; kind:string; label:string; odd:number|null }
type OddsResponse = { bookmaker?:string; source?:string|null; capturedAt?:string|null; selections?:OddSelection[]; priceAvailable?:boolean }
type SotPlayer = {
  name:string; team:string; games:number; minutes:number; sot:number; onePlus:number; twoPlus:number;
  sot90:number; onePlusRate:number; twoPlusRate:number; score:number;
  matches:Array<{date:string;opponent:string;sot:number;minutes:number}>
}
type SotResponse = { connected:boolean; source?:string; updatedAt?:string; players?:SotPlayer[]; note?:string; error?:string }
type ChampionshipPlayer = {
  name:string; team:string; position?:string|null; appearances:number; starts:number; minutes:number;
  goals:number; assists:number; yellowCards:number; redCards:number; foulsCommitted:number; foulsDrawn:number;
  shots:number; shotsOnTarget:number; goals90?:number|null; assists90?:number|null; fouls90?:number|null;
  fouled90?:number|null; cards90?:number|null; shots90?:number|null; shotsOnTarget90?:number|null;
  previousSeason?:{season:string;clubs:string[];competitions:string[];appearances:number;starts:number;minutes:number;goals:number;assists:number;yellowCards:number;redCards:number;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;fouls90?:number|null;cards90?:number|null;shots90?:number|null;shotsOnTarget90?:number|null}|null;
}
type ChampionshipPlayersResponse = { connected:boolean; season:string; source?:string; playerCount?:number; loadedAt?:string; players?:ChampionshipPlayer[]; error?:string }
type H2HPlayer = { name:string;team:string;opponent:string;position?:string|null;starter?:boolean;minutes?:number|null;goals:number;assists:number;shots:number;shotsOnTarget:number;foulsCommitted:number;foulsDrawn:number;yellowCard:boolean;redCard:boolean }
type H2HMatch = { id:string;date:string;competition:string;home:string;away:string;homeGoals:number;awayGoals:number;referee?:string|null;players:H2HPlayer[] }
type H2HResponse = { ok:boolean;source?:string;period?:string;matches?:H2HMatch[];error?:string }
type BacktestMetric = {testedFixtures:number;eligiblePlayerRows:number;baseRate:number;top1:{selections:number;hits:number;hitRate:number;lift:number|null};top3:{selections:number;hits:number;hitRate:number;lift:number|null}}
type BacktestResponse = {ok:boolean;competition?:string;season?:string;methodology?:string;warning?:string;fixturesInDatabase?:number;playerMatchRows?:number;dataQuality?:{playedRows:number;positionRows:number;positionCoverage:number;starterRows:number};metrics?:Record<"card"|"foul1"|"foul2"|"sot1",BacktestMetric>;error?:string}

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return `${v("year")}-${v("month")}-${v("day")}`
}
function displayFixture(raw:LiveFixture):Fixture{
  const d=new Date(raw.kickoff)
  return {
    id:String(raw.id),competition:raw.competition,tournament:raw.tournament,
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
function sotQuery(f:Fixture,bust=0){
  return `/api/sot-radar?${new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(bust)})}`
}
function norm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function playerMatch(label:string,name:string){
  const a=norm(label),b=norm(name),surname=b.split(" ").at(-1)??b
  return a.includes(b)||a.includes(surname)
}
function sotOdd(o:OddsResponse|undefined,name:string){
  return (o?.selections??[])
    .filter(s=>s.kind==="sot"&&s.odd!=null&&playerMatch(s.label,name))
    .sort((a,b)=>Number(a.odd)-Number(b.odd))[0]??null
}
function cardScore(c:Candidate){ return Number(c.cardRiskScore??c.score??0) }
function foulScore(c:Candidate){
  return Number(c.recentFive?.fouls90??0)*0.5 + Number(c.fouls90??0)*0.3 + Number(c.likelyMatchup?.fouled90??0)*0.2
}
function fouledScore(c:Candidate){ return Number(c.fouled90??0) }

function sameTeam(a:string,b:string){
  const na=norm(a),nb=norm(b)
  return Boolean(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na)))
}
function balancedTopFive<T extends {team:string}>(rows:T[],home:string,away:string,score:(row:T)=>number){
  const sorted=[...rows].sort((a,b)=>score(b)-score(a))
  const homeRows=sorted.filter(r=>sameTeam(r.team,home)).slice(0,2)
  const awayRows=sorted.filter(r=>sameTeam(r.team,away)).slice(0,2)
  const chosen=[...homeRows,...awayRows]
  const seen=new Set(chosen)
  for(const row of sorted){
    if(chosen.length>=5)break
    if(!seen.has(row)){chosen.push(row);seen.add(row)}
  }
  return chosen.sort((a,b)=>score(b)-score(a)).slice(0,5)
}
function h2hMeetings(c:Candidate){ return c.h2hMatches?.length??0 }

export default function HomePage(){
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[open,setOpen]=useState<string|null>(null)
  const[openGroups,setOpenGroups]=useState<Record<string,boolean>>({})
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[radar,setRadar]=useState<Record<string,Radar>>({})
  const[odds,setOdds]=useState<Record<string,OddsResponse>>({})
  const[sot,setSot]=useState<Record<string,SotResponse>>({})
  const[championshipDb,setChampionshipDb]=useState<ChampionshipPlayersResponse|null>(null)
  const[premierLeagueDb,setPremierLeagueDb]=useState<ChampionshipPlayersResponse|null>(null)
  const[h2h,setH2h]=useState<Record<string,H2HResponse>>({})
  const[backtest,setBacktest]=useState<BacktestResponse|null>(null)
  const[premierBacktest,setPremierBacktest]=useState<BacktestResponse|null>(null)
  const[loadingBacktest,setLoadingBacktest]=useState(false)
  const[loadingH2h,setLoadingH2h]=useState<Record<string,boolean>>({})
  const[loadingChampionshipDb,setLoadingChampionshipDb]=useState(false)
  const[loadingPremierLeagueDb,setLoadingPremierLeagueDb]=useState(false)
  const[loadingPremierBacktest,setLoadingPremierBacktest]=useState(false)
  const[loading,setLoading]=useState<Record<string,boolean>>({})
  const[loadingSot,setLoadingSot]=useState<Record<string,boolean>>({})
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

  const loadChampionshipDb=useCallback(async()=>{
    setLoadingChampionshipDb(true)
    try{
      const r=await fetch(`/api/championship/players?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as ChampionshipPlayersResponse
      setChampionshipDb(d)
    }catch{
      setChampionshipDb({connected:false,season:"2026/27",players:[],error:"Championship player database unavailable"})
    }finally{setLoadingChampionshipDb(false)}
  },[])

  const loadPremierLeagueDb=useCallback(async()=>{
    setLoadingPremierLeagueDb(true)
    try{
      const r=await fetch(`/api/premier-league/players?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as ChampionshipPlayersResponse
      setPremierLeagueDb(d)
    }catch{
      setPremierLeagueDb({connected:false,season:"2026/27",players:[],error:"Premier League player database unavailable"})
    }finally{setLoadingPremierLeagueDb(false)}
  },[])

  const loadBacktest=useCallback(async()=>{
    setLoadingBacktest(true)
    try{
      const r=await fetch(`/api/championship/backtest?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as BacktestResponse
      setBacktest(d)
    }catch{
      setBacktest({ok:false,error:"Championship backtest unavailable"})
    }finally{setLoadingBacktest(false)}
  },[])

  const loadPremierBacktest=useCallback(async()=>{
    setLoadingPremierBacktest(true)
    try{
      const r=await fetch(`/api/premier-league/backtest?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as BacktestResponse
      setPremierBacktest(d)
    }catch{
      setPremierBacktest({ok:false,error:"Premier League backtest unavailable"})
    }finally{setLoadingPremierBacktest(false)}
  },[])

  const loadLeagueOneDb=useCallback(async()=>{
    setLoadingLeagueOneDb(true)
    try{
      const r=await fetch(`/api/league-one/players?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as ChampionshipPlayersResponse
      setLeagueOneDb(d)
    }catch{setLeagueOneDb({connected:false,season:"2026/27",players:[],error:"League One player database unavailable"})}
    finally{setLoadingLeagueOneDb(false)}
  },[])

  const loadLeagueOneBacktest=useCallback(async()=>{
    setLoadingLeagueOneBacktest(true)
    try{
      const r=await fetch(`/api/league-one/backtest?refresh=${Date.now()}`,{cache:"no-store"})
      const d=await r.json() as BacktestResponse
      setLeagueOneBacktest(d)
    }catch{setLeagueOneBacktest({ok:false,error:"League One backtest unavailable"})}
    finally{setLoadingLeagueOneBacktest(false)}
  },[])

  const loadH2h=useCallback(async(f:Fixture)=>{
    setLoadingH2h(x=>({...x,[f.id]:true}))
    try{
      const base=f.competition==="League One"?"/api/league-one/h2h":"/api/championship/h2h"
      const r=await fetch(`${base}?${new URLSearchParams({home:f.home,away:f.away,refresh:String(Date.now())})}`,{cache:"no-store"})
      const d=await r.json() as H2HResponse
      setH2h(x=>({...x,[f.id]:d}))
      if(d.ok) await loadResearch([f],Date.now())
    }catch{
      setH2h(x=>({...x,[f.id]:{ok:false,matches:[],error:"Last-season H2H research unavailable"}}))
    }finally{setLoadingH2h(x=>({...x,[f.id]:false}))}
  },[loadResearch])

  const loadSot=useCallback(async(f:Fixture,bust=Date.now())=>{
    setLoadingSot(x=>({...x,[f.id]:true}))
    try{
      const r=await fetch(sotQuery(f,bust),{cache:"no-store"})
      const d=await r.json() as SotResponse
      setSot(x=>({...x,[f.id]:d}))
    }catch{
      setSot(x=>({...x,[f.id]:{connected:false,players:[],error:"SOT research unavailable"}}))
    }finally{
      setLoadingSot(x=>({...x,[f.id]:false}))
    }
  },[])

  const refresh=useCallback(async(force=false)=>{
    const bust=Date.now()
    setLoadingFixtures(true)
    try{
      const r=await fetch(`/api/fixtures?${new URLSearchParams({date:selectedDate,competition,nextIfEmpty:selectedDate===londonDate()?"1":"0",refresh:String(bust)})}`,{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures failed")
      const data=await r.json() as FixturesResponse
      setLive(data)
      if(data.showingNextMatchday&&data.date!==selectedDate)setSelectedDate(data.date)
      const fs=((data.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture)
      await loadResearch(fs,bust)
      if(open){
        const opened=fs.find(f=>f.id===open)
        if(opened&&openGroups[`${open}:sot`]) await loadSot(opened,bust)
      }
      setLastRefresh(new Date())
      if(force&&open&&!fs.some(f=>f.id===open))setOpen(null)
    }catch{setLive(null)}finally{setLoadingFixtures(false)}
  },[competition,selectedDate,loadResearch,loadSot,open,openGroups])

  useEffect(()=>{void refresh(false)},[competition,selectedDate])
  useEffect(()=>{if(competition==="Championship"){void loadChampionshipDb();void loadBacktest()}else{void loadPremierLeagueDb();void loadPremierBacktest()}},[competition,loadChampionshipDb,loadBacktest,loadPremierLeagueDb,loadPremierBacktest])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(false),60000);return()=>window.clearInterval(t)},[refresh])

  const today=londonDate()
  const noGames=!loadingFixtures&&live&&fixtures.length===0

  function toggleGroup(f:Fixture,group:string){
    const key=`${f.id}:${group}`
    const next=!openGroups[key]
    setOpenGroups(x=>({...x,[key]:next}))
    if(group==="sot"&&next&&!sot[f.id]&&!loadingSot[f.id]) void loadSot(f)
    if(group==="h2h"&&next&&(f.competition==="Championship"||f.competition==="League One")&&!h2h[f.id]&&!loadingH2h[f.id]) void loadH2h(f)
  }

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white shadow-sm">
      <div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Match Research</h1><p className="text-sm text-white/70">Cards, SOT, fouls and fouls drawn</p></div>
          <button onClick={()=>void refresh(true)} disabled={loadingFixtures} className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-60"><RefreshCw className={`size-4 ${loadingFixtures?"animate-spin":""}`}/> Refresh</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1">{(["Premier League","Championship","League One","International"] as Competition[]).map(c=><button key={c} onClick={()=>{setCompetition(c);setOpen(null)}} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}</div>
      </div>
    </header>

    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2"><CalendarDays className="size-4 text-muted-foreground"/><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);setOpen(null)}} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-semibold"/>{selectedDate!==today?<button onClick={()=>{setSelectedDate(today);setOpen(null)}} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold">Today</button>:null}<span className="ml-auto text-[0.68rem] text-muted-foreground">{lastRefresh?`Updated ${lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`:"Loading…"}</span></div>
      </section>

      {competition==="Championship"?<>
        <ChampionshipDatabase leagueName="Championship" data={championshipDb} loading={loadingChampionshipDb} onRefresh={loadChampionshipDb}/>
        <BacktestPanel leagueName="Championship" data={backtest} loading={loadingBacktest} onRefresh={loadBacktest}/>
      </>:<>
        <ChampionshipDatabase leagueName="Premier League" data={premierLeagueDb} loading={loadingPremierLeagueDb} onRefresh={loadPremierLeagueDb}/>
        <BacktestPanel leagueName="Premier League" data={premierBacktest} loading={loadingPremierBacktest} onRefresh={loadPremierBacktest}/>
      </>}

      {loadingFixtures&&!live?<section className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-5 animate-spin"/>Loading games…</section>:null}
      {noGames?<section className="rounded-2xl border border-border bg-card p-6 text-center"><p className="font-bold">No {competition} games found for this date.</p></section>:null}

      {fixtures.map(f=>{
        const d=radar[f.id],o=odds[f.id],cs=d?.candidates??[],isOpen=open===f.id
        const confirmed=d?.lineupsConfirmed||f.lineupStatus==="confirmed"
        const cards=balancedTopFive(cs,f.home,f.away,cardScore)
        const fouls=balancedTopFive(cs,f.home,f.away,foulScore)
        const fouled=balancedTopFive(cs,f.home,f.away,fouledScore)
        const sots=balancedTopFive(sot[f.id]?.players??[],f.home,f.away,(p)=>Number(p.score??0))

        return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <button onClick={()=>setOpen(x=>x===f.id?null:f.id)} className="w-full p-4 text-left">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{f.day} · {f.date} · {f.time}</p><p className="mt-1 font-bold">{f.home} v {f.away}</p>{f.tournament?<p className="mt-0.5 text-[0.65rem] text-muted-foreground">{f.tournament}</p>:null}<div className="mt-1 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-bold ${confirmed?"bg-emerald-100 text-emerald-800":"bg-secondary text-muted-foreground"}`}>{confirmed?"LINEUPS CONFIRMED":"PRE-LINEUP"}</span><span className="text-xs font-semibold text-yellow-600">{isOpen?"Hide categories":"Open categories"}</span></div></div>{isOpen?<ChevronUp/>:<ChevronDown/>}</div>
          </button>

          {isOpen?<div className="space-y-3 border-t border-border bg-secondary/20 p-3">
            <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{d?.referee?.name?`Ref: ${d.referee.name}${d.referee.yellowsPerGame!=null?` · ${d.referee.yellowsPerGame.toFixed(2)} YC/game`:""}`:"Referee not confirmed"}</p><button onClick={()=>void loadResearch([f],Date.now())} className="flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-2 text-xs font-bold"><RefreshCw className={`size-4 ${loading[f.id]?"animate-spin":""}`}/> Refresh</button></div>

            {(f.competition==="Championship"||f.competition==="League One")?<CollapsibleGroup open={Boolean(openGroups[`${f.id}:h2h`])} onToggle={()=>toggleGroup(f,"h2h")} title="2025/26 H2H match research" subtitle="Goals · assists · shots · SOT · fouls · fouls won · cards">
              {loadingH2h[f.id]?<div className="p-4 text-center text-xs text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-4 animate-spin"/>Loading last-season H2H player stats…</div>:<H2HPanel data={h2h[f.id]}/>}
            </CollapsibleGroup>:null}

            <CollapsibleGroup open={Boolean(openGroups[`${f.id}:cards`])} onToggle={()=>toggleGroup(f,"cards")} title="Top 5 most likely carded" subtitle="H2H yellows · this season · recent 5 · cards/90 · fouls">
              {cards.map((c,i)=><CardRow key={c.dbName} rank={i+1} c={c}/>)}
            </CollapsibleGroup>

            <CollapsibleGroup open={Boolean(openGroups[`${f.id}:sot`])} onToggle={()=>toggleGroup(f,"sot")} title="Top 5 shots on target" subtitle="Last 5 match SOT · 1+ hit rate · 2+ hit rate · SOT/90">
              {loadingSot[f.id]?<div className="p-4 text-center text-xs text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-4 animate-spin"/>Loading recent SOT match data…</div>:sots.length?sots.map((p,i)=><SotRow key={p.name} rank={i+1} p={p} odd={sotOdd(o,p.name)}/>):<Unavailable text={sot[f.id]?.note||sot[f.id]?.error||"Open this category to load recent player SOT data."}/>}
            </CollapsibleGroup>

            <CollapsibleGroup open={Boolean(openGroups[`${f.id}:fouls`])} onToggle={()=>toggleGroup(f,"fouls")} title="Top 5 fouls committed" subtitle="Recent foul form · fouls/90 · direct matchup pressure">
              {fouls.map((c,i)=><SimpleRow key={c.dbName} rank={i+1} name={c.name} stats={`Recent 5: ${c.recentFive?.fouls??0} fouls · ${Number(c.fouls90??0).toFixed(2)}/90${c.likelyMatchup?.name?` · vs ${c.likelyMatchup.name}`:""}`} value={`${foulScore(c).toFixed(2)} rank`}/>)}
            </CollapsibleGroup>

            <CollapsibleGroup open={Boolean(openGroups[`${f.id}:drawn`])} onToggle={()=>toggleGroup(f,"drawn")} title="Top 5 fouls drawn" subtitle="Players most likely to draw fouls">
              {fouled.map((c,i)=><SimpleRow key={c.dbName} rank={i+1} name={c.name} stats={`${Number(c.fouled90??0).toFixed(2)} fouls drawn/90 · ${c.team}`} value={c.position??""}/>)}
            </CollapsibleGroup>
          </div>:null}
        </section>
      })}
    </div>
  </main>
}

function CollapsibleGroup({open,onToggle,title,subtitle,children}:{open:boolean;onToggle:()=>void;title:string;subtitle:string;children:React.ReactNode}){
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"><div><p className="text-sm font-black">{title}</p><p className="text-[0.65rem] text-muted-foreground">{subtitle}</p></div>{open?<ChevronUp className="size-4 shrink-0"/>:<ChevronDown className="size-4 shrink-0"/>}</button>{open?<div className="divide-y divide-border border-t border-border">{children}</div>:null}</section>
}
function CardRow({rank,c}:{rank:number;c:Candidate}){
  return <div className="p-3"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-navy font-mono text-xs font-black text-white">{rank}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{c.name}</p><span className="font-mono text-sm font-black">{Math.round(cardScore(c))}</span></div><p className="text-xs text-muted-foreground">{c.team} · {c.position??"position unknown"}</p>{c.previousSeason?<p className="mt-1 text-[0.62rem] text-muted-foreground">25/26: {c.previousSeason.clubs.join(" / ")} · {c.previousSeason.yellows} YC · {c.previousSeason.fouls} fouls · {c.previousSeason.shotsOnTarget} SOT</p>:null}<div className="mt-2 grid grid-cols-5 gap-1.5 text-center"><Mini l="H2H YC" v={c.h2hYellows} sub={`${h2hMeetings(c)} games`}/><Mini l="26/27 YC" v={c.currentSeason?.yellows??0}/><Mini l="Recent 5 YC" v={c.recentFive?.yellows??0}/><Mini l="Cards/90" v={c.cards90} dec/><Mini l="Fouls/90" v={c.fouls90} dec/></div></div></div></div>
}
function SotRow({rank,p,odd}:{rank:number;p:SotPlayer;odd:OddSelection|null}){
  return <div className="p-3"><div className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-navy font-mono text-xs font-black text-white">{rank}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div><p className="font-bold">{p.name}</p><p className="text-xs text-muted-foreground">{p.team} · last {p.games} matches</p></div>{odd?.odd!=null?<div className="rounded-lg bg-secondary px-2 py-1 text-center"><p className="font-mono text-sm font-black">{Number(odd.odd).toFixed(2)}</p><p className="text-[0.48rem] font-bold uppercase text-muted-foreground">Bet365</p></div>:null}</div><div className="mt-2 grid grid-cols-4 gap-1.5 text-center"><Mini l="Last 5 SOT" v={p.sot}/><Mini l="SOT/90" v={p.sot90} dec/><Mini l="1+ hit" v={p.onePlusRate*100} suffix="%"/><Mini l="2+ hit" v={p.twoPlusRate*100} suffix="%"/></div><p className="mt-2 text-[0.65rem] text-muted-foreground">{p.matches.slice(0,5).map(m=>`${m.sot} v ${m.opponent}`).join(" · ")}</p></div></div></div>
}
function SimpleRow({rank,name,stats,value}:{rank:number;name:string;stats:string;value:string}){
  return <div className="flex items-start gap-3 p-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-xs font-black">{rank}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-bold">{name}</p><span className="shrink-0 text-xs font-bold">{value}</span></div><p className="mt-0.5 text-xs text-muted-foreground">{stats}</p></div></div>
}
function Mini({l,v,sub,dec=false,suffix=""}:{l:string;v:number|null|undefined;sub?:string;dec?:boolean;suffix?:string}){
  return <div className="rounded-lg bg-secondary p-1.5"><p className="font-mono text-sm font-black">{v==null?"—":`${dec?Number(v).toFixed(2):Math.round(Number(v))}${suffix}`}</p><p className="text-[0.48rem] font-bold uppercase text-muted-foreground">{l}</p>{sub?<p className="text-[0.46rem] text-muted-foreground">{sub}</p>:null}</div>
}
function Unavailable({text}:{text:string}){return <div className="p-4 text-center text-xs text-muted-foreground">{text}</div>}

function ChampionshipDatabase({leagueName,data,loading,onRefresh}:{leagueName:string;data:ChampionshipPlayersResponse|null;loading:boolean;onRefresh:()=>void}){
  const[q,setQ]=useState("")
  const[sort,setSort]=useState<keyof ChampionshipPlayer>("foulsCommitted")
  const players=useMemo(()=>{
    const query=norm(q)
    return [...(data?.players??[])]
      .filter(p=>!query||norm(p.name).includes(query)||norm(p.team).includes(query))
      .sort((a,b)=>Number(b[sort]??0)-Number(a[sort]??0)||b.minutes-a.minutes)
  },[data,q,sort])
  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="border-b border-border p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="font-black">2026/27 {leagueName} player database</p><p className="mt-1 text-xs text-muted-foreground">{data?.playerCount??data?.players?.length??0} players · current season · FBref Standard + Shooting + Misc</p></div><button onClick={onRefresh} className="rounded-lg border bg-card p-2"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button></div>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search player or club" className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm"/><select value={sort} onChange={e=>setSort(e.target.value as keyof ChampionshipPlayer)} className="rounded-lg border border-border bg-background px-2 py-2 text-xs font-bold"><option value="foulsCommitted">Fouls</option><option value="foulsDrawn">Fouls won</option><option value="yellowCards">Yellow cards</option><option value="shots">Shots</option><option value="shotsOnTarget">SOT</option><option value="goals">Goals</option><option value="assists">Assists</option><option value="minutes">Minutes</option></select></div>
    </div>
    {loading&&!data?<div className="p-6 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto mb-2 size-5 animate-spin"/>Loading Championship data…</div>:data?.error?<Unavailable text={data.error}/>:<div className="max-h-[34rem] overflow-auto"><table className="w-max min-w-full text-xs"><thead className="sticky top-0 z-10 bg-secondary"><tr className="text-left"><Th>Player</Th><Th>Club</Th><Th>Apps</Th><Th>Min</Th><Th>G</Th><Th>A</Th><Th>Shots</Th><Th>SOT</Th><Th>YC</Th><Th>RC</Th><Th>Fouls</Th><Th>Won</Th><Th>F/90</Th><Th>Won/90</Th><Th>SOT/90</Th><Th>25/26 club</Th><Th>25/26 Apps</Th><Th>25/26 G</Th><Th>25/26 A</Th><Th>25/26 YC</Th><Th>25/26 Fouls</Th><Th>25/26 Won</Th><Th>25/26 SOT</Th></tr></thead><tbody>{players.map(p=><tr key={`${p.name}|${p.team}`} className="border-t border-border"><Td strong>{p.name}</Td><Td>{p.team}</Td><Td>{p.appearances}</Td><Td>{p.minutes==null?"—":p.minutes}</Td><Td>{p.goals}</Td><Td>{p.assists}</Td><Td>{p.shots}</Td><Td>{p.shotsOnTarget}</Td><Td>{p.yellowCards}</Td><Td>{p.redCards}</Td><Td>{p.foulsCommitted}</Td><Td>{p.foulsDrawn}</Td><Td>{fmt(p.fouls90)}</Td><Td>{fmt(p.fouled90)}</Td><Td>{fmt(p.shotsOnTarget90)}</Td><Td>{p.previousSeason?.clubs.join(" / ")??"—"}</Td><Td>{p.previousSeason?.appearances??"—"}</Td><Td>{p.previousSeason?.goals??"—"}</Td><Td>{p.previousSeason?.assists??"—"}</Td><Td>{p.previousSeason?.yellowCards??"—"}</Td><Td>{p.previousSeason?.foulsCommitted??"—"}</Td><Td>{p.previousSeason?.foulsDrawn??"—"}</Td><Td>{p.previousSeason?.shotsOnTarget??"—"}</Td></tr>)}</tbody></table></div>}
  </section>
}
function H2HPanel({data}:{data:H2HResponse|undefined}){
  if(!data)return <Unavailable text="Open this section to load last season's head-to-head player stats."/>
  if(!data.ok)return <Unavailable text={data.error??"No H2H data available."}/>
  if(!(data.matches??[]).length)return <Unavailable text="No meetings were found between these teams during 2025/26."/>
  return <div className="space-y-3 p-3">{(data.matches??[]).map(m=><div key={m.id} className="overflow-hidden rounded-xl border border-border bg-background"><div className="border-b border-border p-3"><p className="font-bold">{m.home} {m.homeGoals}–{m.awayGoals} {m.away}</p><p className="text-[0.65rem] text-muted-foreground">{m.date} · {m.competition}{m.referee?` · Ref ${m.referee}`:""}</p></div><div className="overflow-x-auto"><table className="w-max min-w-full text-[0.68rem]"><thead className="bg-secondary"><tr><Th>Player</Th><Th>Team</Th><Th>Min</Th><Th>G</Th><Th>A</Th><Th>Sh</Th><Th>SOT</Th><Th>Fouls</Th><Th>Won</Th><Th>YC</Th><Th>RC</Th></tr></thead><tbody>{m.players.filter(p=>p.starter||Number(p.goals||0)+Number(p.assists||0)+Number(p.shots||0)+Number(p.foulsCommitted||0)+Number(p.foulsDrawn||0)>0||p.yellowCard||p.redCard).sort((a,b)=>Number(b.minutes??0)-Number(a.minutes??0)).map(p=><tr key={`${m.id}|${p.name}|${p.team}`} className="border-t border-border"><Td strong>{p.name}</Td><Td>{p.team}</Td><Td>{p.minutes}</Td><Td>{p.goals}</Td><Td>{p.assists}</Td><Td>{p.shots}</Td><Td>{p.shotsOnTarget}</Td><Td>{p.foulsCommitted}</Td><Td>{p.foulsDrawn}</Td><Td>{p.yellowCard?"1":"0"}</Td><Td>{p.redCard?"1":"0"}</Td></tr>)}</tbody></table></div></div>)}</div>
}
function Th({children}:{children:React.ReactNode}){return <th className="whitespace-nowrap px-2.5 py-2 font-black">{children}</th>}
function Td({children,strong=false}:{children:React.ReactNode;strong?:boolean}){return <td className={`whitespace-nowrap px-2.5 py-2 ${strong?"font-bold":""}`}>{children}</td>}
function fmt(v:number|null|undefined){return v==null?"—":Number(v).toFixed(2)}


function BacktestPanel({leagueName,data,loading,onRefresh}:{leagueName:string;data:BacktestResponse|null;loading:boolean;onRefresh:()=>void}){
  const labels:Record<string,string>={card:"Yellow card",foul1:"1+ foul",foul2:"2+ fouls",sot1:"1+ SOT"}
  return <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-border p-4"><div><p className="font-black">{leagueName} signal backtest</p><p className="mt-1 text-xs text-muted-foreground">Walk-forward only · no future-match leakage</p></div><button onClick={onRefresh} className="rounded-lg border bg-card p-2"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button></div>
    {!data&&loading?<div className="p-5 text-center text-xs text-muted-foreground">Running backtest…</div>:data?.error?<Unavailable text={data.error}/>:data?.metrics?<div className="p-3">
      <div className="grid grid-cols-2 gap-2">{Object.entries(data.metrics).map(([key,m])=><div key={key} className="rounded-xl border border-border bg-secondary/20 p-3"><p className="text-xs font-black">{labels[key]??key}</p><p className="mt-2 font-mono text-lg font-black">{Math.round(m.top3.hitRate*100)}%</p><p className="text-[0.62rem] text-muted-foreground">Top 3 hit rate · {m.top3.hits}/{m.top3.selections}</p><p className="mt-1 text-[0.62rem] text-muted-foreground">All eligible: {Math.round(m.baseRate*100)}%{m.top3.lift!=null?` · ${m.top3.lift.toFixed(2)}× lift`:""}</p></div>)}</div>
      <p className="mt-3 text-[0.65rem] text-muted-foreground">{data.fixturesInDatabase??0} fixtures · {data.playerMatchRows??0} player-match rows{data.dataQuality?` · ${Math.round(data.dataQuality.positionCoverage*100)}% of played rows have a recorded match role`:""}. {data.warning}</p>
    </div>:<Unavailable text="No backtest results yet."/>}
  </section>
}
