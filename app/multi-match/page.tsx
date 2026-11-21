"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, BadgeCheck, Layers3, RefreshCw, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type Fixture = {id:string;date:string;kickoff:string;competition:Competition;home:string;away:string;status?:string}
type Offer = {
  player:string;team:string;label:string;probability:number;fairOdds:number|null;
  bookmakerOdds:number;bookmaker:string;edge:number;confidence:"A"|"B"|"C"|"D";
  threshold?:number;reason?:string
}
type Scorecard = {
  ok:boolean
  lineupsConfirmed?:boolean
  eligibleBooks?:string[]
  exactCardOffers?:Offer[]
  exactFoulOffers?:Offer[]
  error?:string
}
type Result={fixture:Fixture;scorecard:Scorecard|null}
type MultiLeg=Offer&{match:string;competition:Competition;market:"card"|"foul"}
type MultiSlip={
  id:string;title:string;subtitle:string;bookmaker:string|null;legs:MultiLeg[];
  combinedOdds:number|null;modelAllHit:number|null;complete:boolean
}

const preferredBooks=["Bet365","Sky Bet","William Hill","Paddy Power"]

function parseGames():Fixture[]{
  if(typeof window==="undefined")return []
  const raw=new URLSearchParams(window.location.search).get("games")
  if(!raw)return []
  try{
    const parsed=JSON.parse(decodeURIComponent(raw))
    return Array.isArray(parsed)?parsed.filter((x:any)=>x?.id&&x?.date&&x?.competition&&x?.home&&x?.away):[]
  }catch{return []}
}
function percent(v:number|null|undefined){return v==null?"—":Math.round(Number(v)*100)+"%"}
const TEAM_CODES:Record<string,string>={
  england:"ENG",spain:"ESP",germany:"GER",france:"FRA",italy:"ITA",portugal:"POR",netherlands:"NED",
  belgium:"BEL",croatia:"CRO",scotland:"SCO",wales:"WAL",ireland:"IRL","northern ireland":"NIR",
  brazil:"BRA",argentina:"ARG",finland:"FIN",albania:"ALB","san marino":"SMR",belarus:"BLR"
}
function teamCode(team:string){
  const n=team.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
  if(TEAM_CODES[n])return TEAM_CODES[n]
  const parts=n.split(" ").filter(Boolean)
  return (parts.length>1?parts[0].slice(0,1)+parts[1].slice(0,2):n.slice(0,3)).toUpperCase()
}
function TeamTag({team}:{team:string}){
  const code=teamCode(team)
  return <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[0.44rem] font-black text-white/65"><span className="grid size-3.5 place-items-center rounded-full bg-white/10 text-[0.34rem]">{code.slice(0,2)}</span>{code}</span>
}
function time(kickoff:string){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff))
}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition,view:"builder",refresh:String(Date.now())})
}
function quality(o:Offer){
  return o.probability+(o.confidence==="A"?.05:o.confidence==="B"?.03:0)+Math.max(0,o.edge)*.25
}
function bestCard(s:Scorecard|null,book:string){
  return [...(s?.exactCardOffers??[])].filter(o=>o.bookmaker===book).sort((a,b)=>quality(b)-quality(a))[0]??null
}
function bestFoul(s:Scorecard|null,book:string){
  return [...(s?.exactFoulOffers??[])]
    .filter(o=>o.bookmaker===book&&o.probability>=.42)
    .sort((a,b)=>quality(b)-quality(a))[0]??null
}
function buildForBook(
  id:string,title:string,subtitle:string,book:string,results:Result[],
  pick:(s:Scorecard|null,book:string)=>Offer|null,
  market:"card"|"foul",
):MultiSlip{
  const legs:MultiLeg[]=[]
  let complete=true
  for(const r of results){
    const s=r.scorecard
    if(!s?.ok||!s.lineupsConfirmed||!(s.eligibleBooks??[]).includes(book)){complete=false;continue}
    const offer=pick(s,book)
    if(!offer){complete=false;continue}
    legs.push({...offer,match:r.fixture.home+" v "+r.fixture.away,competition:r.fixture.competition,market})
  }
  const combinedOdds=legs.length?Math.round(legs.reduce((p,l)=>p*l.bookmakerOdds,1)*100)/100:null
  const modelAllHit=legs.length?legs.reduce((p,l)=>p*l.probability,1):null
  return {id,title,subtitle,bookmaker:book,legs,combinedOdds,modelAllHit,complete:complete&&legs.length===results.length}
}
function buildTargetMulti(book:string,results:Result[],targetDecimal:number,targetLabel:string):MultiSlip{
  const fixtureOptions=results.map(r=>{
    const s=r.scorecard
    if(!s?.ok||!s.lineupsConfirmed||!(s.eligibleBooks??[]).includes(book))return {fixture:r.fixture,options:[] as Array<{offer:Offer;market:"card"|"foul"}>}
    const cards=[...(s.exactCardOffers??[])].filter(o=>o.bookmaker===book).sort((a,b)=>quality(b)-quality(a)).slice(0,2)
    const fouls=[...(s.exactFoulOffers??[])].filter(o=>o.bookmaker===book&&o.probability>=.40).sort((a,b)=>quality(b)-quality(a)).slice(0,3)
    return {
      fixture:r.fixture,
      options:[
        ...cards.map(offer=>({offer,market:"card" as const})),
        ...fouls.map(offer=>({offer,market:"foul" as const})),
      ],
    }
  })

  type State={legs:MultiLeg[];odds:number;quality:number}
  let states:State[]=[{legs:[],odds:1,quality:0}]
  for(const row of fixtureOptions){
    const next=[...states]
    for(const state of states){
      for(const option of row.options){
        if(state.legs.length>=12)continue
        const odds=state.odds*option.offer.bookmakerOdds
        if(odds>targetDecimal*2.5&&state.legs.length>=1)continue
        next.push({
          legs:[...state.legs,{...option.offer,match:row.fixture.home+" v "+row.fixture.away,competition:row.fixture.competition,market:option.market}],
          odds,
          quality:state.quality+quality(option.offer),
        })
      }
    }
    states=next.sort((a,b)=>{
      const score=(s:State)=>{
        if(!s.legs.length)return 999
        const distance=Math.abs(Math.log(Math.max(1.01,s.odds))-Math.log(targetDecimal))
        return distance*1.8-(s.quality/s.legs.length)*.35
      }
      return score(a)-score(b)
    }).slice(0,240)
  }
  const best=states.filter(s=>s.legs.length>=2).sort((a,b)=>{
    const da=Math.abs(Math.log(a.odds)-Math.log(targetDecimal))
    const db=Math.abs(Math.log(b.odds)-Math.log(targetDecimal))
    return da-db
  })[0]
  const legs=best?.legs??[]
  return {
    id:"target-"+targetLabel.replace("/","-")+"-"+book,
    title:"~"+targetLabel+" Target",
    subtitle:"Best same-bookmaker cross-match combination nearest "+targetLabel+" using at most one exact card/foul line per selected game.",
    bookmaker:book,
    legs,
    combinedOdds:best?Math.round(best.odds*100)/100:null,
    modelAllHit:legs.length?legs.reduce((p,l)=>p*l.probability,1):null,
    complete:Boolean(best)&&results.every(r=>r.scorecard?.lineupsConfirmed),
  }
}

function buildMixedForBook(book:string,results:Result[]):MultiSlip{
  const legs:MultiLeg[]=[]
  let complete=true
  for(const r of results){
    const s=r.scorecard
    if(!s?.ok||!s.lineupsConfirmed||!(s.eligibleBooks??[]).includes(book)){complete=false;continue}
    const card=bestCard(s,book)
    const foul=bestFoul(s,book)
    const options=[
      card?{offer:card,market:"card" as const}:null,
      foul?{offer:foul,market:"foul" as const}:null,
    ].filter(Boolean) as Array<{offer:Offer;market:"card"|"foul"}>
    options.sort((a,b)=>quality(b.offer)-quality(a.offer))
    const pick=options[0]
    if(!pick){complete=false;continue}
    legs.push({...pick.offer,match:r.fixture.home+" v "+r.fixture.away,competition:r.fixture.competition,market:pick.market})
  }
  const combinedOdds=legs.length?Math.round(legs.reduce((p,l)=>p*l.bookmakerOdds,1)*100)/100:null
  const modelAllHit=legs.length?legs.reduce((p,l)=>p*l.probability,1):null
  return {
    id:"recommended-"+book,title:"Recommended Multi-Match Slip",
    subtitle:"One strongest exact card-or-foul line from every selected game at the same bookmaker.",
    bookmaker:book,legs,combinedOdds,modelAllHit,complete:complete&&legs.length===results.length,
  }
}

export default function MultiMatchPage(){
  const router=useRouter()
  const[fixtures,setFixtures]=useState<Fixture[]>([])
  const[results,setResults]=useState<Result[]>([])
  const[loading,setLoading]=useState(true)
  const[mode,setMode]=useState<"all"|"discipline">("all")
  const leagues:Competition[]=["Premier League","Championship","League One","League Two","International"]
  const[league,setLeague]=useState<Competition>("Premier League")
  const[matchDate,setMatchDate]=useState(()=>(()=>{const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=(type:string)=>parts.find(p=>p.type===type)?.value??"";return part("year")+"-"+part("month")+"-"+part("day")})())
  const[available,setAvailable]=useState<Fixture[]>([])
  const[fixtureLoading,setFixtureLoading]=useState(false)
  const[fixtureError,setFixtureError]=useState("")
  const initialSelectionApplied=useRef(false)
  const fetchAvailable=useCallback(async()=>{
    setFixtureLoading(true);setFixtureError("")
    const controller=new AbortController()
    const timeout=window.setTimeout(()=>controller.abort(),12000)
    try{
      const r=await fetch("/api/fixtures?"+new URLSearchParams({date:matchDate,nextIfEmpty:"0"}),{cache:"no-store",signal:controller.signal})
      if(!r.ok)throw new Error("Unable to retrieve fixtures")
      const payload=await r.json() as {leagues?:Record<Competition,Array<{id:string;kickoff:string;status?:string;home:{name:string};away:{name:string}}>>}
      const all=(["Premier League","Championship","League One","League Two","International"] as Competition[]).flatMap(competition=>(payload.leagues?.[competition]??[]).map(game=>({
        id:game.id,date:matchDate,kickoff:game.kickoff,competition,home:game.home.name,away:game.away.name,status:game.status??"scheduled"
      })))
      setAvailable(all)
      if(!new URLSearchParams(window.location.search).has("games"))setFixtures(all.filter(game=>game.competition===league))

    }catch{setFixtureError("Could not refresh fixtures. Try again; existing matches remain visible.")}
    finally{window.clearTimeout(timeout);setFixtureLoading(false)}
  },[matchDate,league])
  useEffect(()=>{void fetchAvailable()},[fetchAvailable])
  useEffect(()=>{const timer=window.setInterval(()=>void fetchAvailable(),60000);return()=>window.clearInterval(timer)},[fetchAvailable])
  const toggleFixture=(game:Fixture)=>setFixtures(current=>current.some(x=>x.id===game.id)?current.filter(x=>x.id!==game.id):[...current,game])
  const leagueFixtures=available.filter(game=>game.competition===league)
  const selectedInLeague=fixtures.filter(game=>game.competition===league).length
  const isThreePm=(game:Fixture)=>new Date(game.kickoff).toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",hour12:false})==="15:00"
  const threePmFixtures=leagueFixtures.filter(isThreePm)
  const displayedFixtures=[...leagueFixtures].sort((a,b)=>Number(isThreePm(b))-Number(isThreePm(a))||a.kickoff.localeCompare(b.kickoff))
  const selectThreePm=()=>setFixtures(current=>[...current,...threePmFixtures.filter(game=>!current.some(x=>x.id===game.id))])



  useEffect(()=>{const games=parseGames();if(games.length)setFixtures(games);else setLoading(false)},[])
  const load=useCallback(async(games:Fixture[])=>{
    if(!games.length){setLoading(false);return}
    setLoading(true)
    try{
      setResults(await Promise.all(games.map(async fixture=>{
        try{
          const controller=new AbortController()
          const timeout=window.setTimeout(()=>controller.abort(),18000)
          try{
            const r=await fetch(scorecardUrl(fixture),{cache:"no-store",signal:controller.signal})
            return {fixture,scorecard:r.ok?await r.json() as Scorecard:null}
          }finally{window.clearTimeout(timeout)}
        }catch{return {fixture,scorecard:null}}
      })))
    }finally{setLoading(false)}
  },[])
  useEffect(()=>{if(fixtures.length)void load(fixtures)},[fixtures,load])
  useEffect(()=>{if(!fixtures.length)return;const t=window.setInterval(()=>void load(fixtures),60000);return()=>window.clearInterval(t)},[fixtures,load])

  // Same evidence-ranked player model used by the single-match builder.
  // Automatically preselect the strongest remaining selection per fixture;
  // users can change each fixture's pick. Prices are optional evidence, not
  // a prerequisite for showing the prediction.
  const options=useMemo(()=>results.map(result=>{
    const scorecard=result.scorecard as Scorecard&{slips?:Array<{id:string;legs:Array<{player:string;team:string;market:string;label:string;probability:number;bookmakerOdds?:number|null;confidence:string;recent5HitRate?:number;h2hHitRate?:number|null;h2hMatches?:number}>}>;players?:Array<{name:string;team:string;markets:Record<string,{key:string;label:string;probability:number;bookmakerOdds?:number|null;confidence:string;recent5HitRate?:number;h2hHitRate?:number|null;h2hMatches?:number}>}>}
    const primary=scorecard?.slips?.find(s=>s.id==="form-h2h-builder")?.legs??[]
    const fallback=(scorecard?.players??[]).flatMap(p=>Object.values(p.markets??{}).filter(Boolean).map(m=>({...m,player:p.name,team:p.team,market:m.key})))
    const picks=fallback.filter(x=>x.probability>=.08&&x.confidence!=="D"&&Number.isFinite(x.probability)).sort((a,b)=>b.probability-a.probability)
    return {fixture:result.fixture,picks}
  }),[results])
  const recommended=useMemo(()=>options.filter(row=>row.fixture.competition===league).map(row=>{
    // Discipline slips deliberately reserve 1–2 slots for the most likely
    // yellow-card recipients and three for fouls committed, per fixture.
    // Do not substitute low-probability card picks just to fill a quota.
    const cards=row.picks.filter(p=>p.market==="card"&&p.probability>=.12).sort((a,b)=>b.probability-a.probability)
    const fouls=row.picks.filter(p=>/^foul[1-5]$/.test(p.market)).sort((a,b)=>b.probability-a.probability)
    const chosenCards=cards.slice(0,2)
    const chosenFouls=fouls.filter(p=>!chosenCards.some(c=>c.player===p.player)).slice(0,3)
    const picks=mode==="discipline"?[...chosenCards,...chosenFouls].sort((a,b)=>b.probability-a.probability):row.picks.slice(0,5)
    const combined=picks.length?picks.reduce((v,p)=>v*p.probability,1):null
    const actualOdds=picks.length&&picks.every(p=>Number(p.bookmakerOdds)>1)?picks.reduce((v,p)=>v*Number(p.bookmakerOdds),1):null
    return {fixture:row.fixture,picks,combined,actualOdds,fairOdds:combined&&combined>0?1/combined:null}
  }),[options,league,mode])

  const rankedAcrossGames=useMemo(()=>{
    const all=options.filter(row=>row.fixture.competition===league).flatMap(row=>row.picks.map(p=>({fixture:row.fixture,pick:p})))
    const eligible=all.filter(row=>mode==="all"?true:row.pick.market==="card"||/^foul[1-5]$/.test(row.pick.market))
    return eligible.sort((a,b)=>b.pick.probability-a.pick.probability).slice(0,25)
  },[options,league,mode])
  const topCards=useMemo(()=>options.filter(row=>row.fixture.competition===league).flatMap(row=>row.picks.filter(p=>p.market==="card").map(p=>({fixture:row.fixture,pick:p}))).sort((a,b)=>b.pick.probability-a.pick.probability).slice(0,10),[options,league])
  const topFouls=useMemo(()=>options.filter(row=>row.fixture.competition===league).flatMap(row=>row.picks.filter(p=>/^foul[1-5]$/.test(p.market)).map(p=>({fixture:row.fixture,pick:p}))).sort((a,b)=>b.pick.probability-a.pick.probability).slice(0,10),[options,league])
  const [leaderboard,setLeaderboard]=useState<"cards"|"fouls"|"all">("cards")
  const leaderboardRows=leaderboard==="cards"?topCards:leaderboard==="fouls"?topFouls:rankedAcrossGames
  return <main className="min-h-screen bg-[#07120e] pb-24 text-white"><header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e] p-4"><div className="mx-auto flex max-w-3xl items-center gap-3"><button onClick={()=>router.push("/")} className="rounded-xl bg-white/10 p-3"><ArrowLeft className="size-4"/></button><div className="flex-1"><p className="text-xs font-black uppercase tracking-widest text-sky-300">Multi Match</p><h1 className="text-xl font-black">Top 5 picks per match</h1></div><button onClick={()=>void load(fixtures)} className="rounded-xl bg-sky-300 p-3 text-sky-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div></header>
    <div className="mx-auto max-w-3xl px-3 pt-3">
      <div className="flex gap-1.5 overflow-x-auto pb-2">{leagues.map(item=><button key={item} type="button" onClick={()=>setLeague(item)} className={"shrink-0 rounded-lg px-3 py-2 text-xs font-bold "+(league===item?"bg-sky-300 text-sky-950":"bg-white/10 text-white/75")}>{item} ({available.filter(g=>g.competition===item).length})</button>)}</div>
      <div className="flex items-center justify-between gap-2"><input type="date" value={matchDate} onChange={e=>setMatchDate(e.target.value)} className="rounded-lg border border-white/15 bg-[#07120e] px-2 py-1.5 text-xs text-white"/><span className="text-xs text-white/50">{leagueFixtures.length} games · all included</span></div>
      {fixtureError?<p className="mt-2 text-xs text-amber-200">{fixtureError}</p>:null}
    </div>
    <div className="mx-auto max-w-3xl space-y-2 px-3 pb-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1"><button onClick={()=>setMode("all")} className={"rounded-lg px-2 py-2 text-xs font-bold "+(mode==="all"?"bg-sky-300 text-sky-950":"text-white/60")}>All markets</button><button onClick={()=>setMode("discipline")} className={"rounded-lg px-2 py-2 text-xs font-bold "+(mode==="discipline"?"bg-amber-300 text-amber-950":"text-white/60")}>Cards + fouls</button></div>
      <p className="text-xs text-white/50">{mode==="discipline"?"Per match: 1–2 highest-probability yellow-card picks plus 3 fouls-committed picks, where supported by available data.":"Five highest-probability picks per match."} Projected fair odds are estimates, not bookmaker prices.</p>
      {loading?<p className="text-xs text-sky-200">Updating projections…</p>:null}
      <section className="rounded-xl border border-sky-300/20 bg-sky-300/[0.04] p-2.5">
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-black">Most probable across all games</h2><span className="text-[0.65rem] text-white/50">Auto-refresh 60s</span></div>
        <div className="mt-2 grid grid-cols-3 gap-1">{(["cards","fouls","all"] as const).map(tab=><button key={tab} onClick={()=>setLeaderboard(tab)} className={"rounded-lg px-1 py-2 text-[0.7rem] font-bold "+(leaderboard===tab?"bg-sky-300 text-sky-950":"bg-white/10 text-white/65")}>{tab==="cards"?"Yellow cards":tab==="fouls"?"Fouls committed":"All markets"}</button>)}</div>
        <div className="mt-2 divide-y divide-white/10">{leaderboardRows.map((row,i)=><div key={row.fixture.id+"|"+row.pick.player+"|"+row.pick.market} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><p className="truncate text-xs font-bold">{i+1}. {row.pick.player} · {row.pick.label}</p><p className="truncate text-[0.65rem] text-white/45">{row.fixture.home} v {row.fixture.away} · {time(row.fixture.kickoff)}</p></div><div className="shrink-0 text-right"><p className="font-mono text-xs font-black text-sky-200">{percent(row.pick.probability)}</p><p className="text-[0.65rem] text-white/45">Fair {row.pick.probability>0?(1/row.pick.probability).toFixed(2):"—"}x</p></div></div>)}</div>
        {!leaderboardRows.length?<p className="py-3 text-xs text-white/50">No verified player projections loaded yet.</p>:null}
        <p className="mt-2 text-[0.65rem] text-amber-200/70">Historical model projections, not live match event statistics or verified bookmaker odds. Match status and fixture list refresh automatically.</p>
      </section>
      {recommended.map(row=><section key={row.fixture.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
        <div className="flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-black">{row.fixture.home} v {row.fixture.away}</h3><p className="text-[0.65rem] text-white/45">{time(row.fixture.kickoff)} · {row.picks.length} picks</p></div><div className="shrink-0 text-right"><p className="font-mono text-sm font-black text-emerald-300">{row.fairOdds==null?"—":row.fairOdds.toFixed(2)}x</p><p className="text-[0.6rem] text-white/40">projected fair odds</p></div></div>
        <div className="mt-2 divide-y divide-white/5">{row.picks.map((p,i)=><div key={p.player+"|"+p.market} className="flex items-center justify-between gap-2 py-1.5"><div className="min-w-0"><p className="truncate text-xs font-bold">{i+1}. {p.player} · {p.label}</p><p className="text-[0.62rem] text-white/40">Fair {p.probability>0?(1/p.probability).toFixed(2):"—"}x{Number(p.bookmakerOdds)>1?" · Book "+Number(p.bookmakerOdds).toFixed(2)+"x":""}</p></div><span className="shrink-0 font-mono text-xs font-black text-sky-200">{percent(p.probability)}</span></div>)}</div>
        {row.picks.length>1?<p className="mt-1 border-t border-white/10 pt-1.5 text-[0.65rem] text-white/45">Combined estimate {percent(row.combined)} · {row.actualOdds==null?"No verified combined bookmaker price":"Bookmaker singles product "+row.actualOdds.toFixed(2)+"x"} · correlated legs may change actual probability</p>:null}
        {!row.picks.length?<p className="py-2 text-xs text-amber-200">Player projections unavailable for this fixture.</p>:null}
      </section>)}
      {!recommended.length&&!loading?<p className="rounded-xl bg-white/5 p-4 text-sm text-white/60">No fixtures with player projections available for this league/date.</p>:null}
    <p className="text-xs leading-relaxed text-white/40">Probabilities are estimates, not guarantees. Multiplying single-leg chances assumes independence and may overstate confidence where events are correlated. Live prices and settlement rules are determined by the bookmaker.</p></div></main>
}

function MultiSlipCard({slip,hero=false}:{slip:MultiSlip;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-sky-300/25 bg-gradient-to-br from-sky-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-sky-300"><Sparkles className="size-3.5"/><span className="text-[0.52rem] font-black uppercase tracking-[0.14em]">Recommended</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-sm font-black text-sky-300">{slip.bookmaker}</p><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.58rem] text-white/35">{slip.legs.length} games included</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.combinedOdds?.toFixed(2)??"—"}</p><p className="text-[0.42rem] uppercase text-white/25">individual prices multiplied</p></div></div><div className="mt-3 rounded-2xl bg-black/20 p-3"><div className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-300"/><p className="text-[0.64rem] leading-relaxed text-white/50">All legs are exact prices from {slip.bookmaker}. Cross-match legs are separate events, so the product is a useful accumulator reference; the bookmaker's displayed final price remains authoritative.</p></div></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.match+"|"+l.player+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><p className="text-[0.52rem] font-black uppercase text-white/30">{l.competition} · {l.match}</p><div className="mt-1 flex items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-1.5"><p className="text-sm font-black">{l.player} · {l.label}</p><TeamTag team={l.team}/></div><p className="mt-1 text-[0.58rem] text-white/40">{l.bookmaker} · Grade {l.confidence}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className="text-[0.46rem] text-white/25">{l.bookmakerOdds.toFixed(2)} odds</p></div></div></div>)}</div>{slip.modelAllHit!=null?<p className="mt-3 text-[0.54rem] text-white/30">Independent cross-match model guide: {percent(slip.modelAllHit)} for every leg landing. This remains an estimate, not a guarantee.</p>:null}</div>:null}
  </article>
}
