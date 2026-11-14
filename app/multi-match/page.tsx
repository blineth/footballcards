"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, BadgeCheck, Layers3, RefreshCw, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type Fixture = {id:string;date:string;kickoff:string;competition:Competition;home:string;away:string}
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
function time(kickoff:string){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff))
}
function scorecardUrl(f:Fixture){
  return "/api/fixture-scorecard?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition,refresh:String(Date.now())})
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

  useEffect(()=>{setFixtures(parseGames())},[])
  const load=useCallback(async(games:Fixture[])=>{
    if(!games.length){setLoading(false);return}
    setLoading(true)
    try{
      setResults(await Promise.all(games.map(async fixture=>{
        try{
          const r=await fetch(scorecardUrl(fixture),{cache:"no-store"})
          return {fixture,scorecard:r.ok?await r.json() as Scorecard:null}
        }catch{return {fixture,scorecard:null}}
      })))
    }finally{setLoading(false)}
  },[])
  useEffect(()=>{if(fixtures.length)void load(fixtures)},[fixtures,load])
  useEffect(()=>{if(!fixtures.length)return;const t=window.setInterval(()=>void load(fixtures),60000);return()=>window.clearInterval(t)},[fixtures,load])

  const commonBooks=useMemo(()=>preferredBooks.filter(book=>results.length===fixtures.length&&results.every(r=>(r.scorecard?.eligibleBooks??[]).includes(book))),[results,fixtures.length])
  const confirmedCount=results.filter(r=>r.scorecard?.lineupsConfirmed).length

  const slips=useMemo(()=>{
    const all:MultiSlip[]=[]
    for(const book of commonBooks){
      all.push(buildMixedForBook(book,results))
      all.push(buildForBook("cards-"+book,"One Card Per Game","Strongest exact booking price from every selected game.",book,results,bestCard,"card"))
      all.push(buildForBook("fouls-"+book,"One Foul Line Per Game","Strongest exact offered foul threshold from every selected game.",book,results,bestFoul,"foul"))
    }
    return all.filter(s=>s.legs.length)
  },[results,commonBooks])

  const recommended=useMemo(()=>[...slips].filter(s=>s.id.startsWith("recommended-")).sort((a,b)=>{
    if(a.complete!==b.complete)return a.complete?-1:1
    const qa=a.legs.length?a.legs.reduce((x,l)=>x+quality(l),0)/a.legs.length:0
    const qb=b.legs.length?b.legs.reduce((x,l)=>x+quality(l),0)/b.legs.length:0
    return qb-qa
  })[0]??null,[slips])
  const alternatives=slips.filter(s=>s!==recommended)

  if(!fixtures.length&&!loading){
    return <main className="min-h-screen bg-[#07120e] px-4 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><p className="font-black">Select games from Matches</p><p className="mt-2 text-sm text-white/40">Multi Match is created from Matches and requires one of the preferred bookmakers to offer both cards and fouls on every selected fixture.</p><button onClick={()=>router.push("/")} className="mt-5 rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-black text-sky-950">Back to Matches</button></div></main>
  }

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl"><div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><div className="flex items-center gap-3"><button onClick={()=>router.push("/")} className="rounded-xl bg-white/7 p-2.5 text-white/70"><ArrowLeft className="size-4"/></button><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-sky-300"><Layers3 className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.15em]">Multi Match</span></div><h1 className="mt-1 text-xl font-black">{fixtures.length} selected games</h1><p className="mt-0.5 text-[0.58rem] text-white/35">One bookmaker per accumulator · exact offered card/foul lines only.</p></div><button onClick={()=>void load(fixtures)} className="rounded-xl bg-sky-300 p-2.5 text-sky-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button></div></div></header>

    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-black">Selected matches</p><p className="mt-0.5 text-[0.58rem] text-white/35">A full accumulator needs one bookmaker to cover every selected game.</p></div><span className="rounded-full bg-white/7 px-2 py-1 text-[0.5rem] font-black text-white/45">{confirmedCount}/{fixtures.length} XI confirmed</span></div><div className="mt-3 space-y-2">{fixtures.map(f=>{const s=results.find(r=>r.fixture.id===f.id)?.scorecard;return <div key={f.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 p-3"><div><p className="text-sm font-black">{f.home} v {f.away}</p><p className="mt-0.5 text-[0.54rem] text-white/35">{f.competition} · {time(f.kickoff)}</p></div><span className={"rounded-full px-2 py-1 text-[0.5rem] font-black "+((s?.eligibleBooks?.length??0)?"bg-emerald-400/10 text-emerald-300":"bg-rose-400/10 text-rose-200")}>{s?.eligibleBooks?.length?s.eligibleBooks.join(" / "):"BLOCKED"}</span></div>})}</div></section>

      {!loading&&results.length&&!commonBooks.length?<section className="rounded-3xl border border-rose-300/20 bg-rose-400/10 p-4"><p className="font-black">No single bookmaker covers every selected match</p><p className="mt-1 text-sm text-rose-100/70">The app will not mix Bet365, Sky Bet, William Hill and Paddy Power inside one accumulator. Go back and change the selected games.</p></section>:null}
      {loading&&!results.length?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-sky-300"/><p className="font-black">Analysing selected matches…</p></section>:null>}
      {!loading&&commonBooks.length&&confirmedCount<fixtures.length?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/5 p-5"><p className="font-black text-amber-100">Waiting for confirmed lineups</p><p className="mt-1 text-sm text-amber-100/60">The final accumulator is only produced when every selected match has a confirmed XI.</p></section>:null}

      {recommended?.complete?<MultiSlipCard slip={recommended} hero/>:null}
      {alternatives.filter(s=>s.complete).map(s=><MultiSlipCard key={s.id} slip={s}/>)}
    </div>
  </main>
}

function MultiSlipCard({slip,hero=false}:{slip:MultiSlip;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-sky-300/25 bg-gradient-to-br from-sky-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left"><div className="flex items-start justify-between gap-3"><div>{hero?<div className="flex items-center gap-1.5 text-sky-300"><Sparkles className="size-3.5"/><span className="text-[0.52rem] font-black uppercase tracking-[0.14em]">Recommended</span></div>:null}<h2 className="mt-1 text-lg font-black">{slip.title}</h2><p className="mt-1 text-sm font-black text-sky-300">{slip.bookmaker}</p><p className="mt-1 text-[0.62rem] text-white/45">{slip.subtitle}</p><p className="mt-2 text-[0.58rem] text-white/35">{slip.legs.length} games included</p></div><div className="text-right"><p className="font-mono text-xl font-black">{slip.combinedOdds?.toFixed(2)??"—"}</p><p className="text-[0.42rem] uppercase text-white/25">individual prices multiplied</p></div></div><div className="mt-3 rounded-2xl bg-black/20 p-3"><div className="flex items-start gap-2"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-300"/><p className="text-[0.64rem] leading-relaxed text-white/50">All legs are exact prices from {slip.bookmaker}. Cross-match legs are separate events, so the product is a useful accumulator reference; the bookmaker's displayed final price remains authoritative.</p></div></div></button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{slip.legs.map((l,i)=><div key={l.match+"|"+l.player+"|"+i} className="rounded-2xl bg-white/[0.055] p-3"><p className="text-[0.52rem] font-black uppercase text-white/30">{l.competition} · {l.match}</p><div className="mt-1 flex items-center justify-between gap-3"><div><p className="text-sm font-black">{l.player} · {l.label}</p><p className="mt-1 text-[0.58rem] text-white/40">{l.bookmaker} · Grade {l.confidence}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(l.probability)}</p><p className="text-[0.46rem] text-white/25">{l.bookmakerOdds.toFixed(2)} odds</p></div></div></div>)}</div>{slip.modelAllHit!=null?<p className="mt-3 text-[0.54rem] text-white/30">Independent cross-match model guide: {percent(slip.modelAllHit)} for every leg landing. This remains an estimate, not a guarantee.</p>:null}</div>:null}
  </article>
}
