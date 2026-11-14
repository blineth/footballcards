"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BadgeCheck,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flame,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"

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
  requestedDate?:string
  showingNextMatchday?:boolean
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
  home:string
  away:string
  homeCrest?:string
  awayCrest?:string
  status?:string
  lineupStatus?:string
}

type Candidate = {
  name:string
  dbName:string
  team:string
  position?:string|null
  score:number
  cardRiskScore?:number
  fouls90:number
  fouled90?:number|null
  h2hYellows:number
  h2hFouls:number
  recentFive?:{games?:number;fouls?:number;yellows?:number;fouls90?:number|null}
  likelyMatchup?:{name:string;fouled90?:number|null;role?:string|null}|null
}

type Radar = {
  lineupsConfirmed?:boolean
  referee?:{name:string;yellowsPerGame?:number|null}|null
  candidates?:Candidate[]
}

type ScoreMarketKey = "foul1"|"foul2"|"foul3"|"fouled1"|"card"|"shot1"|"shot2"|"sot1"|"sot2"

type ScorePlayer = {
  name:string
  dbName:string
  team:string
  position?:string|null
  sampleMatches:number
  sampleMinutes:number
  expectedMinutes:number
  matchup?:{name:string;role?:string|null;fouled90?:number|null}|null
  yellowConditionals:{
    overall:{matches:number;yellows:number;rate:number}
    after1PlusFouls:{matches:number;yellows:number;rate:number|null}
    after2PlusFouls:{matches:number;yellows:number;rate:number|null}
    after3PlusFouls:{matches:number;yellows:number;rate:number|null}
  }
}

type SlipLeg = {
  player:string
  team:string
  market:ScoreMarketKey
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
  combinedOdds:number|null
  averageLegProbability:number|null
  note:string
}

type ScorecardResponse = {
  ok:boolean
  lineupsConfirmed?:boolean
  status?:string
  bookmaker?:string|null
  oddsSource?:string|null
  oddsCapturedAt?:string|null
  oddsAgeSeconds?:number|null
  oddsFreshness?:"LIVE"|"SLIGHTLY STALE"|"STALE"|"UNKNOWN"
  priceAvailable?:boolean
  playerCount?:number
  players?:ScorePlayer[]
  slips?:BetSlip[]
  methodology?:{
    cardConditional?:string
    calibrationWarning?:string
    slipWarning?:string
    priceFreshness?:string
  }
  error?:string
}

const competitions: Competition[] = ["Premier League","Championship","League One","League Two","International"]

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
    home:raw.home.name,
    away:raw.away.name,
    homeCrest:raw.home.crest,
    awayCrest:raw.away.crest,
    status:raw.status,
    lineupStatus:raw.lineupStatus,
  }
}

function radarQuery(f:Fixture,bust=0){
  return "/api/fixture-radar?"+new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(bust)})
}
function scorecardQuery(f:Fixture,bust=0){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition,refresh:String(bust)})
}
function percent(v:number|null|undefined){return v==null?"—":Math.round(Number(v)*100)+"%"}
function edgeText(v:number|null|undefined){return v==null?"—":(Number(v)>=0?"+":"")+(Number(v)*100).toFixed(1)+"pp"}

function slipTheme(id:string){
  if(id==="main-safe") return {shell:"border-emerald-300/20 bg-gradient-to-br from-emerald-500/20 to-emerald-950/40",badge:"bg-emerald-400 text-emerald-950",icon:ShieldCheck,label:"SAFER"}
  if(id==="two-cards") return {shell:"border-amber-300/20 bg-gradient-to-br from-amber-500/20 to-amber-950/40",badge:"bg-amber-300 text-amber-950",icon:BadgeCheck,label:"2 CARDS"}
  if(id==="three-cards") return {shell:"border-rose-300/20 bg-gradient-to-br from-rose-500/20 to-rose-950/40",badge:"bg-rose-300 text-rose-950",icon:Flame,label:"3 CARDS"}
  if(id==="yellow-foul") return {shell:"border-orange-300/20 bg-gradient-to-br from-orange-500/20 to-orange-950/40",badge:"bg-orange-300 text-orange-950",icon:TrendingUp,label:"CARD + FOUL"}
  return {shell:"border-sky-300/20 bg-gradient-to-br from-sky-500/20 to-sky-950/40",badge:"bg-sky-300 text-sky-950",icon:Target,label:"MIXED"}
}

function slipExplanation(slip:BetSlip){
  if(!slip.legs.length) return {headline:"No qualifying selections yet",body:"The model has not found enough confirmed-lineup selections that meet the current confidence rules.",facts:[] as string[]}
  const high=slip.legs.filter(l=>l.probability>=0.70).length
  const strong=slip.legs.filter(l=>l.confidence==="A"||l.confidence==="B").length
  const positive=slip.legs.filter(l=>Number(l.edge??0)>0).length
  const top=[...slip.legs].sort((a,b)=>b.probability-a.probability)[0]
  const cardLegs=slip.legs.filter(l=>l.market==="card").length
  const foulLegs=slip.legs.filter(l=>l.market.startsWith("foul")).length
  const shotLegs=slip.legs.filter(l=>l.market.startsWith("shot")||l.market.startsWith("sot")).length

  let body=""
  if(slip.id==="main-safe") body="This is the lower-risk mix: the model takes its strongest simple lines across fouls, fouls drawn, shots, SOT and cards, while avoiding loading the slip with several picks from the same player."
  else if(slip.id==="two-cards") body="This targets the two strongest booking candidates. Card probability is lifted by each player's booking history, foul volume, direct opponent pressure, referee context and how often they are booked in games where they reach 2+ fouls."
  else if(slip.id==="three-cards") body="This adds a third card candidate to chase a bigger return. The selections still rank highly individually, but adding another booking leg makes the overall outcome more volatile."
  else if(slip.id==="yellow-foul") body="This is built around players whose foul involvement and booking history reinforce each other. It is especially interested in players who are repeatedly booked in matches where they commit multiple fouls."
  else body="This mixes the strongest 2+ foul, shot and SOT opportunities. It looks for players with repeatable volume rather than relying on one-off goals or rare events."

  const facts=[
    high+"/"+slip.legs.length+" legs are 70%+ individually",
    strong+"/"+slip.legs.length+" legs are Grade A/B confidence",
    positive?positive+" leg"+(positive===1?"":"s")+" currently show"+(positive===1?"s":"")+" a positive model edge vs price":"Live price edge not yet confirmed",
    "Strongest leg: "+top.player+" "+top.label+" at "+percent(top.probability),
  ]
  if(cardLegs) facts.push(cardLegs+" card selection"+(cardLegs===1?"":"s"))
  if(foulLegs) facts.push(foulLegs+" foul-related selection"+(foulLegs===1?"":"s"))
  if(shotLegs) facts.push(shotLegs+" shot/SOT selection"+(shotLegs===1?"":"s"))

  return {headline:"Why the model likes this "+slip.risk.toLowerCase()+"-risk slip",body,facts}
}

function likelihoodLabel(v:number|null|undefined){
  const p=Number(v??0)
  if(p>=0.76)return "Very strong"
  if(p>=0.67)return "Strong"
  if(p>=0.58)return "Good"
  return "Speculative"
}

export default function HomePage(){
  const[competition,setCompetition]=useState<Competition>("Premier League")
  const[selectedDate,setSelectedDate]=useState(londonDate)
  const[open,setOpen]=useState<string|null>(null)
  const[live,setLive]=useState<FixturesResponse|null>(null)
  const[radar,setRadar]=useState<Record<string,Radar>>({})
  const[scorecards,setScorecards]=useState<Record<string,ScorecardResponse>>({})
  const[loading,setLoading]=useState<Record<string,boolean>>({})
  const[loadingFixtures,setLoadingFixtures]=useState(false)
  const[lastRefresh,setLastRefresh]=useState<Date|null>(null)

  const fixtures=useMemo(()=>((live?.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture),[live,competition])
  const today=londonDate()

  const loadMatch=useCallback(async(f:Fixture,bust=Date.now())=>{
    setLoading(x=>({...x,[f.id]:true}))
    try{
      const rr=await fetch(radarQuery(f,bust),{cache:"no-store"})
      let rd:Radar|undefined
      if(rr.ok){
        rd=await rr.json() as Radar
        setRadar(x=>({...x,[f.id]:rd as Radar}))
      }
      const confirmed=rd?.lineupsConfirmed===true||f.lineupStatus==="confirmed"
      if(confirmed){
        const sr=await fetch(scorecardQuery(f,bust),{cache:"no-store"})
        if(sr.ok){
          const sd=await sr.json() as ScorecardResponse
          setScorecards(x=>({...x,[f.id]:sd}))
        }
      }
    }catch{}finally{
      setLoading(x=>({...x,[f.id]:false}))
    }
  },[])

  const refresh=useCallback(async(force=false)=>{
    const bust=Date.now()
    setLoadingFixtures(true)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({date:selectedDate,competition,nextIfEmpty:selectedDate===londonDate()?"1":"0",refresh:String(bust)}),{cache:"no-store"})
      if(!r.ok)throw new Error("fixtures failed")
      const data=await r.json() as FixturesResponse
      setLive(data)
      if(data.showingNextMatchday&&data.date!==selectedDate)setSelectedDate(data.date)
      const fs=((data.leagues?.[competition]??[]) as LiveFixture[]).map(displayFixture)
      await Promise.all(fs.map(f=>loadMatch(f,bust)))
      setLastRefresh(new Date())
      if(force&&open&&!fs.some(f=>f.id===open))setOpen(null)
    }catch{
      setLive(null)
    }finally{
      setLoadingFixtures(false)
    }
  },[competition,selectedDate,loadMatch,open])

  useEffect(()=>{void refresh(false)},[competition,selectedDate])
  useEffect(()=>{const t=window.setInterval(()=>void refresh(false),60000);return()=>window.clearInterval(t)},[refresh])

  const confirmedCount=fixtures.filter(f=>radar[f.id]?.lineupsConfirmed||f.lineupStatus==="confirmed").length
  const readyCount=fixtures.filter(f=>(scorecards[f.id]?.slips?.length??0)>0).length
  const noGames=!loadingFixtures&&live&&fixtures.length===0

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><span className="text-[0.65rem] font-black uppercase tracking-[0.18em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Matches</h1>
            <p className="mt-1 text-xs text-white/55">Browse fixtures · lineup status · match analysis</p>
          </div>
          <button onClick={()=>void refresh(true)} disabled={loadingFixtures} className="flex shrink-0 items-center gap-2 rounded-xl bg-emerald-400 px-3 py-2.5 text-xs font-black text-emerald-950 shadow-lg shadow-emerald-500/10 disabled:opacity-60">
            <RefreshCw className={"size-4 "+(loadingFixtures?"animate-spin":"")}/>Refresh
          </button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {competitions.map(c=><button key={c} onClick={()=>{setCompetition(c);setOpen(null)}} className={"shrink-0 rounded-full px-3.5 py-2 text-xs font-black transition "+(competition===c?"bg-white text-[#07120e]":"bg-white/7 text-white/65 hover:bg-white/10")}>{c}</button>)}
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-white/10 bg-white/[0.055] p-3.5 shadow-2xl shadow-black/10">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2"><CalendarDays className="size-4 text-emerald-300"/><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);setOpen(null)}} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white [color-scheme:dark]"/></div>
          {selectedDate!==today?<button onClick={()=>{setSelectedDate(today);setOpen(null)}} className="rounded-xl bg-white/8 px-3 py-2 text-xs font-bold text-white/75">Today</button>:null}
          <div className="ml-auto flex items-center gap-3 text-[0.65rem] text-white/50">
            <span><b className="text-white">{confirmedCount}</b> confirmed</span>
            <span><b className="text-emerald-300">{readyCount}</b> slips ready</span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[0.62rem] text-white/35"><Clock3 className="size-3"/>{lastRefresh?"Updated "+lastRefresh.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"Checking fixtures…"} · auto-refresh every 60s</div>
      </section>

      {loadingFixtures&&!live?<LoadingCard/>:null}
      {noGames?<section className="rounded-3xl border border-white/10 bg-white/[0.055] p-8 text-center"><p className="font-black">No {competition} fixtures found.</p><p className="mt-1 text-sm text-white/45">Try another date or competition.</p></section>:null}

      <div className="space-y-3">
        {fixtures.map(f=>{
          const d=radar[f.id]
          const scorecard=scorecards[f.id]
          const confirmed=d?.lineupsConfirmed||f.lineupStatus==="confirmed"
          const isOpen=open===f.id
          return <MatchCard
            key={f.id}
            fixture={f}
            radar={d}
            scorecard={scorecard}
            confirmed={Boolean(confirmed)}
            open={isOpen}
            loading={Boolean(loading[f.id])}
            onToggle={()=>setOpen(x=>x===f.id?null:f.id)}
            onRefresh={()=>void loadMatch(f,Date.now())}
          />
        })}
      </div>
    </div>
  </main>
}

function LoadingCard(){
  return <section className="rounded-3xl border border-white/10 bg-white/[0.055] p-8 text-center text-sm text-white/50"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/>Loading fixtures and checking lineups…</section>
}

function TeamBadge({name,crest}:{name:string;crest?:string}){
  return <div className="flex min-w-0 flex-1 flex-col items-center text-center">
    <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white p-2 shadow-lg">
      {crest?<img src={crest} alt="" className="max-h-full max-w-full object-contain"/>:<span className="text-sm font-black text-[#07120e]">{name.slice(0,2).toUpperCase()}</span>}
    </div>
    <p className="mt-2 max-w-[8rem] text-sm font-black leading-tight">{name}</p>
  </div>
}

function MatchCard({fixture,radar,scorecard,confirmed,open,loading,onToggle,onRefresh}:{fixture:Fixture;radar?:Radar;scorecard?:ScorecardResponse;confirmed:boolean;open:boolean;loading:boolean;onToggle:()=>void;onRefresh:()=>void}){
  const slips=scorecard?.slips??[]
  const statusText=fixture.status&&fixture.status!=="scheduled"?fixture.status.replaceAll("_"," "):null
  return <section className={"overflow-hidden rounded-3xl border shadow-2xl shadow-black/15 transition "+(confirmed?"border-emerald-400/20 bg-[#0d1d17]":"border-white/10 bg-[#0b1813]")}>
    <button onClick={onToggle} className="w-full p-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[0.62rem] font-bold uppercase tracking-wider text-white/40">
            <span>{fixture.day} {fixture.date}</span><span>•</span><span className="text-white/70">{fixture.time}</span>
            {statusText?<><span>•</span><span className="text-amber-300">{statusText}</span></>:null}
          </div>
          <p className="mt-1 text-[0.62rem] text-white/35">{fixture.tournament??fixture.competition}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={"rounded-full px-2.5 py-1 text-[0.58rem] font-black "+(confirmed?"bg-emerald-400 text-emerald-950":"bg-white/8 text-white/50")}>{confirmed?"XI CONFIRMED":"WAITING FOR XI"}</span>
          {open?<ChevronUp className="size-4 text-white/50"/>:<ChevronDown className="size-4 text-white/50"/>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <TeamBadge name={fixture.home} crest={fixture.homeCrest}/>
        <div className="shrink-0 text-center"><p className="text-[0.55rem] font-black uppercase tracking-[0.2em] text-white/25">vs</p>{slips.length?<p className="mt-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[0.55rem] font-black text-emerald-300">{slips.length} slips</p>:null}</div>
        <TeamBadge name={fixture.away} crest={fixture.awayCrest}/>
      </div>
    </button>

    {open?<div className="border-t border-white/8 bg-black/10 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[0.68rem] text-white/45">{radar?.referee?.name?"Referee: "+radar.referee.name+(radar.referee.yellowsPerGame!=null?" · "+radar.referee.yellowsPerGame.toFixed(1)+" cards/game":""):"Referee not confirmed"}</p>
        <button onClick={e=>{e.stopPropagation();onRefresh()}} className="flex items-center gap-1.5 rounded-xl bg-white/7 px-2.5 py-2 text-[0.65rem] font-black text-white/70"><RefreshCw className={"size-3.5 "+(loading?"animate-spin":"")}/>Update</button>
      </div>
      <SlipPanel data={scorecard} confirmed={confirmed}/>
    </div>:null}
  </section>
}

function SlipPanel({data,confirmed}:{data?:ScorecardResponse;confirmed:boolean}){
  const[openSlip,setOpenSlip]=useState<string|null>(null)

  if(!confirmed){
    return <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.035] p-5 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-white/7"><Clock3 className="size-5 text-white/45"/></div>
      <p className="mt-3 font-black">Waiting for confirmed lineups</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-white/40">Once both starting XIs are released, the model re-runs every player against their role, opponent, recent form, H2H and card/foul patterns before creating the slips.</p>
    </div>
  }

  if(!data){
    return <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-center"><RefreshCw className="mx-auto mb-2 size-5 animate-spin text-emerald-300"/><p className="font-black">Building confirmed-lineup slips…</p></div>
  }

  if(!data.ok){
    return <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">{data.error??"Scorecard unavailable."}</div>
  }

  const freshness=data.oddsFreshness??"UNKNOWN"
  const live=freshness==="LIVE"
  const freshnessClass=live?"bg-emerald-400 text-emerald-950":freshness==="SLIGHTLY STALE"?"bg-amber-300 text-amber-950":freshness==="STALE"?"bg-rose-300 text-rose-950":"bg-white/10 text-white/55"
  const captured=data.oddsCapturedAt?new Date(data.oddsCapturedAt).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):null

  return <div className="space-y-3">
    <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.035] p-3">
      <div>
        <p className="text-xs font-black">Model ready</p>
        <p className="mt-0.5 text-[0.6rem] text-white/40">{data.playerCount??0} player profiles analysed · confirmed XI</p>
      </div>
      <div className="text-right">
        <span className={"rounded-full px-2 py-1 text-[0.55rem] font-black "+freshnessClass}>{data.bookmaker??"BET365"} {freshness}</span>
        <p className="mt-1 text-[0.52rem] text-white/30">{captured?"price "+captured:data.priceAvailable?"price available":"model only"}</p>
      </div>
    </div>

    {(data.slips??[]).map((slip,index)=>{
      const theme=slipTheme(slip.id)
      const Icon=theme.icon
      const why=slipExplanation(slip)
      const expanded=openSlip===slip.id
      return <article key={slip.id} className={"overflow-hidden rounded-3xl border "+theme.shell}>
        <button onClick={()=>setOpenSlip(x=>x===slip.id?null:slip.id)} className="w-full p-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className={"flex size-10 shrink-0 items-center justify-center rounded-2xl "+theme.badge}><Icon className="size-5"/></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[0.55rem] font-black uppercase tracking-[0.14em] text-white/45">{theme.label}</span><span className="rounded-full bg-black/20 px-2 py-0.5 text-[0.5rem] font-black text-white/50">{slip.legs.length} legs</span></div>
                <h3 className="mt-1 text-base font-black">{slip.title}</h3>
                <p className="mt-0.5 text-[0.65rem] text-white/50">{likelihoodLabel(slip.averageLegProbability)} · average selection likelihood {percent(slip.averageLegProbability)}</p>
              </div>
            </div>
            <div className="shrink-0 text-right"><p className="font-mono text-2xl font-black">{percent(slip.averageLegProbability)}</p><p className="text-[0.48rem] font-black uppercase tracking-wider text-white/35">model strength</p></div>
          </div>

          <div className="mt-3 rounded-2xl bg-black/20 p-3">
            <div className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-300"/><div><p className="text-xs font-black">{why.headline}</p><p className="mt-1 text-[0.68rem] leading-relaxed text-white/55">{why.body}</p></div></div>
          </div>

          <div className="mt-3 space-y-1.5">
            {slip.legs.slice(0,expanded?slip.legs.length:3).map((leg,i)=><LegPreview key={slip.id+"|"+leg.player+"|"+leg.market+"|"+i} leg={leg}/>)}
          </div>
          {slip.legs.length>3&&!expanded?<p className="mt-2 text-center text-[0.6rem] font-bold text-white/40">+ {slip.legs.length-3} more selections</p>:null}
          <div className="mt-3 flex items-center justify-center gap-1 text-[0.58rem] font-black text-white/40">{expanded?"Hide detail":"View why each pick is included"}{expanded?<ChevronUp className="size-3"/>:<ChevronDown className="size-3"/>}</div>
        </button>

        {expanded?<div className="border-t border-white/10 bg-black/20 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {why.facts.slice(0,4).map(fact=><div key={fact} className="rounded-xl bg-white/[0.055] p-2.5 text-[0.62rem] leading-snug text-white/60">{fact}</div>)}
          </div>
          <div className="mt-3 space-y-2">
            {slip.legs.map((leg,i)=><LegDetail key={slip.id+"-detail-"+i} leg={leg}/>)}
          </div>
          <p className="mt-3 text-[0.56rem] leading-relaxed text-white/30">The percentage shown for the slip is average selection strength, not the chance every leg lands together. Same-match legs can be correlated, so the model does not multiply them into a fake combined probability.</p>
        </div>:null}
      </article>
    })}

    {!(data.slips??[]).length?<div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-center"><p className="font-black">No slips cleared the model rules yet</p><p className="mt-1 text-xs text-white/40">The confirmed XI is loaded, but the current selections have not met the confidence/value filters.</p></div>:null}
  </div>
}

function LegPreview({leg}:{leg:SlipLeg}){
  const positive=Number(leg.edge??0)>0
  return <div className="flex items-center gap-3 rounded-xl bg-white/[0.055] px-3 py-2.5">
    <div className={"size-2 shrink-0 rounded-full "+(leg.confidence==="A"?"bg-emerald-300":leg.confidence==="B"?"bg-lime-300":leg.confidence==="C"?"bg-amber-300":"bg-white/25")}/>
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-black">{leg.player} <span className="font-medium text-white/45">· {leg.label}</span></p>
      <p className="mt-0.5 truncate text-[0.56rem] text-white/35">{leg.team} · Grade {leg.confidence}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {leg.bookmakerOdds!=null?<div className="rounded-lg bg-black/25 px-2 py-1 text-center"><p className="font-mono text-xs font-black">{leg.bookmakerOdds.toFixed(2)}</p><p className="text-[0.42rem] uppercase text-white/30">Bet365</p></div>:null}
      <div className="text-right"><p className="font-mono text-sm font-black">{percent(leg.probability)}</p>{positive?<p className="text-[0.46rem] font-black text-emerald-300">+EDGE</p>:null}</div>
    </div>
  </div>
}

function LegDetail({leg}:{leg:SlipLeg}){
  const movement=leg.previousBookmakerOdds!=null&&leg.bookmakerOdds!=null&&leg.bookmakerMovement!=null
    ?leg.previousBookmakerOdds.toFixed(2)+" → "+leg.bookmakerOdds.toFixed(2)+" "+(leg.bookmakerMovement<0?"shortened":"drifted")
    :null
  return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-sm font-black">{leg.player}</p><p className="text-[0.62rem] text-white/40">{leg.team} · {leg.label}</p></div>
      <div className="text-right"><p className="font-mono text-lg font-black">{percent(leg.probability)}</p><p className="text-[0.48rem] uppercase text-white/30">likelihood</p></div>
    </div>
    <p className="mt-2 text-[0.68rem] leading-relaxed text-white/60"><b className="text-white/80">Why:</b> {leg.reason||"Strong player history and recent match profile."}</p>
    <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
      <Metric label="Confidence" value={leg.confidence}/>
      <Metric label="Fair odds" value={leg.fairOdds?.toFixed(2)??"—"}/>
      <Metric label="Bet365" value={leg.bookmakerOdds?.toFixed(2)??"—"}/>
      <Metric label="Edge" value={edgeText(leg.edge)} good={Number(leg.edge??0)>0}/>
    </div>
    {movement?<p className="mt-2 text-[0.55rem] text-white/35">Price move: {movement}</p>:null}
  </div>
}

function Metric({label,value,good=false}:{label:string;value:string;good?:boolean}){
  return <div className="rounded-xl bg-black/20 px-1.5 py-2"><p className={"font-mono text-xs font-black "+(good?"text-emerald-300":"text-white")}>{value}</p><p className="mt-0.5 text-[0.42rem] font-black uppercase tracking-wider text-white/25">{label}</p></div>
}
