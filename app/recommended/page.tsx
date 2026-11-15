"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, BadgeCheck, RefreshCw, Sparkles, Trophy, Activity, Target, TrendingUp, Users, Zap, BarChart3, X, Shirt } from "lucide-react"

type Fixture={id:string;competition:string;kickoff:string;home:{name:string;shortName?:string;crest?:string|null};away:{name:string;shortName?:string;crest?:string|null}}
type SlipLeg={
  player:string;dbPlayerName?:string|null;team:string;market:string;label:string;
  probability:number;fairOdds:number|null;bookmakerOdds:number|null;bookmakerName?:string|null;
  edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;priceSource?:"exact"|"estimated"|null
}
type Slip={
  id:string;bookmaker?:string|null;title?:string;targetFractional?:string;
  legs:SlipLeg[];averageLegProbability:number|null
}
type Recommendation={
  id:string;fixture:Fixture;slip:Slip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null
}
type Tracking={
  available:boolean;days:number;gradedLegs:number;hits?:number;hitRate?:number|null;
  avgProbability?:number|null;brier?:number|null;topPickLegs?:number;topPickHits?:number;
  topPickHitRate?:number|null;topPickAvgProbability?:number|null;
  completeSlips?:number;winningSlips?:number;slipHitRate?:number|null;
  topPickSlips?:number;topPickWinningSlips?:number;topPickSlipHitRate?:number|null;
  exactPriceLegs?:number;exactPriceProfitUnits?:number|null;exactPriceROI?:number|null;
  byMarket?:Array<{market:string;sample:number;hits:number;hitRate:number|null;avgProbability:number|null;avgExactOdds:number|null}>
}
type TargetOddsLeg={
  fixtureId:string;competition:string;kickoff:string;home:string;away:string;player:string;team:string;
  market:string;label:string;probability:number;conservativeProbability?:number;price:number;priceSource:"exact"|"model";
  bookmaker:string|null;confidence:"A"|"B"|"C"|"D"
}
type TargetOddsSlip={
  id:string;targetFractional:string;targetDecimal:number;available:boolean;referenceOdds:number|null;
  modelAllHitProbability:number|null;conservativeAllHitProbability?:number|null;safetyScore?:number|null;bookmaker:string|null;
  priceSource:"bookmaker-singles"|"model"|null;marketsVerified:boolean;
  maxSelections?:number;maxPlayersPerTeam?:number;legs:TargetOddsLeg[];note:string
}
type TargetOddsGame={
  fixture:Fixture
  lineupsConfirmed?:boolean
  targets:TargetOddsSlip[]
}
type LivePlayerProp={
  player:string;team:string;market:"card"|"foul1"|"fouled1"|"shot1"|"sot1"|"goal1"|"assist1";label:string;
  probability:number;fullMatchProbability:number;fairOdds:number;
  confidence:"A"|"B"|"C"|"D";marketStatus:"available"|"unavailable"|"unknown";
  bookmakerOdds?:number|null;bookmakerName?:string|null;reason?:string;
  currentCount?:number;liveStatsAvailable?:boolean;
  currentFouls?:number|null;currentFouled?:number|null;currentShots?:number|null;currentSot?:number|null;
  currentYellowCards?:number|null;currentRedCards?:number|null
}
type LiveMatch={
  id:string;competition:string;kickoff:string;status?:string;inPlay?:boolean;elapsed?:number|null;
  score?:{home:number;away:number}|null;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  probabilities?:{homeWin:number;draw:number;awayWin:number;bttsYes:number;bttsNo:number}|null;
  winnerPick?:{side:string;team:string;loser:string;probability:number;grade:string}|null;
  bttsPick?:{selection:string;probability:number;grade:string}|null;bttsSettled?:boolean;
  livePlayerProps?:LivePlayerProp[];
  livePlayerStatsSource?:string|null;
  reasons?:string[]
}
type ViewMode="all"|"live"|"value"|"props"|"targets"
type PropBoardRow={recId:string;fixture:Fixture;leg:SlipLeg;placeable:boolean;marketProbability:number|null;edge:number|null}
type MultiMatchLeg={
  fixtureId:string;competition:string;kickoff:string;home:string;away:string;
  player:string;team:string;market:string;label:string;probability:number;
  bookmakerOdds:number;bookmaker:"Bet365";confidence:"A"|"B"|"C"|"D"
}
type MultiMatchRiskTier="safe"|"balanced"|"risky"
type MultiMatchGameBuilder={
  fixtureId:string;competition:string;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  riskTier?:MultiMatchRiskTier;targetFractional:string;targetDecimal?:number;referenceOdds:number;modelAllHitProbability:number;
  conservativeAllHitProbability:number;includesCard?:boolean;cardPick?:string|null;lineupsConfirmed?:boolean;preMatchSnapshot?:boolean;legs:MultiMatchLeg[]
}
type MultiMatchTier={
  id:MultiMatchRiskTier;title:string;description:string;targetFractionalPerMatch:string;targetDecimalPerMatch:number;
  available:boolean;matchBuilders:MultiMatchGameBuilder[];legs:MultiMatchLeg[];
  combinedBet365Odds:number|null;conservativeAllHitProbability:number|null;note:string
}
type MultiMatchBuild={
  available:boolean;targetFractionalPerMatch:string;maxMatches:number;eligibleFixtureCount:number;
  matchBuilders:MultiMatchGameBuilder[];legs:MultiMatchLeg[];
  combinedBet365Odds:number|null;modelAllHitProbability:number|null;conservativeAllHitProbability?:number|null;
  tiers?:MultiMatchTier[];defaultTier?:MultiMatchRiskTier;note:string
}
type YellowCardWatchRow={
  fixtureId:string;competition:string;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  player:string;team:string;probability:number;bookmakerOdds:number;confidence:"A"|"B"|"C"|"D";reason:string;
  probabilityBasis?:"model"|"bet365-implied"
}
type Response={
  ok:boolean;updatedAt?:string;date?:string;autoAdvanced?:boolean;fixturesScanned?:number;recommendations?:Recommendation[];
  liveMatches?:LiveMatch[];targetOddsGames?:TargetOddsGame[];tracking?:Tracking;error?:string;staleFallback?:boolean;warning?:string;
  multiMatchBuild?:MultiMatchBuild;yellowCardWatch?:YellowCardWatchRow[]
}

type LineupPlayer={
  id:string;name:string;shortName:string;jersey:string|null;position:string|null;
  group:"gk"|"def"|"mid"|"att"|"other";starter:boolean;captain:boolean;headshot?:string|null
}
type LineupTeam={
  team:string;formation:string|null;formationSource:"official-feed"|"position-inferred"|null;crest?:string|null;
  starters:LineupPlayer[];substitutes:LineupPlayer[]
}
type LineupResponse={
  ok:boolean;confirmed:boolean;source:string;checkedAt:string;competition:string;
  home:LineupTeam;away:LineupTeam;error?:string
}

function percent(v:number|null|undefined){return v==null?"—":Math.round(v*100)+"%"}
const TEAM_CODES:Record<string,string>={
  england:"ENG",spain:"ESP",germany:"GER",france:"FRA",italy:"ITA",portugal:"POR",netherlands:"NED",
  belgium:"BEL",brazil:"BRA",argentina:"ARG",croatia:"CRO",denmark:"DEN",sweden:"SWE",norway:"NOR",
  finland:"FIN",albania:"ALB","san marino":"SMR",belarus:"BLR",scotland:"SCO",wales:"WAL",
  ireland:"IRL","northern ireland":"NIR",poland:"POL",switzerland:"SUI",austria:"AUT",turkey:"TUR",
  greece:"GRE",serbia:"SRB","czech republic":"CZE",czechia:"CZE",slovakia:"SVK",slovenia:"SVN",
  ukraine:"UKR",romania:"ROU",hungary:"HUN",georgia:"GEO",iceland:"ISL","bosnia and herzegovina":"BIH",
  montenegro:"MNE","north macedonia":"MKD",kosovo:"KOS",israel:"ISR",mexico:"MEX",usa:"USA",
  "united states":"USA",canada:"CAN",japan:"JPN","south korea":"KOR",australia:"AUS"
}
function simpleNorm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function teamCode(team:string){
  const n=simpleNorm(team)
  if(TEAM_CODES[n])return TEAM_CODES[n]
  const words=n.split(" ").filter(Boolean)
  if(words.length>=2)return (words[0].slice(0,1)+words[1].slice(0,2)).toUpperCase()
  return n.slice(0,3).toUpperCase()
}
function sameTeam(a:string,b:string){
  const x=simpleNorm(a).replace(/\b(afc|fc)\b/g,"").trim()
  const y=simpleNorm(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function TeamBadge({team,home,away,homeCrest,awayCrest}:{team:string;home?:string;away?:string;homeCrest?:string|null;awayCrest?:string|null}){
  const crest=home&&sameTeam(team,home)?homeCrest:away&&sameTeam(team,away)?awayCrest:null
  const code=teamCode(team)
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-2 py-1 text-[0.46rem] font-black text-white/65">
    {crest?<img src={crest} alt="" className="size-4 rounded-full object-contain"/>:<span className="grid size-4 place-items-center rounded-full bg-white/10 text-[0.38rem]">{code.slice(0,2)}</span>}
    <span>{code}</span>
  </span>
}
function fractionalOdds(decimal:number|null|undefined){
  if(decimal==null||!Number.isFinite(decimal)||decimal<=1)return "—"
  const target=decimal-1
  const common:Array<[number,number]>=[
    [1,20],[1,16],[1,14],[1,12],[1,10],[1,8],[1,7],[1,6],[1,5],[2,9],[1,4],[2,7],[3,10],[1,3],[4,11],[2,5],[4,9],[1,2],[8,15],[4,7],[8,13],[4,6],[8,11],[4,5],[5,6],[10,11],
    [1,1],[11,10],[6,5],[5,4],[11,8],[3,2],[13,8],[7,4],[15,8],[2,1],[9,4],[5,2],[11,4],[3,1],[10,3],[7,2],[15,4],[4,1],[9,2],[5,1],[11,2],[6,1],[13,2],[7,1],[15,2],[8,1],[9,1],[10,1],[11,1],[12,1],[14,1],[16,1],[18,1],[20,1],[25,1],[33,1],[40,1],[50,1]
  ]
  if(target>20){
    const rounded=Math.max(21,Math.round(target))
    return rounded+"/1"
  }
  let best=common[0],diff=Infinity
  for(const pair of common){
    const d=Math.abs(pair[0]/pair[1]-target)
    if(d<diff){best=pair;diff=d}
  }
  return best[0]===best[1]?"EVS":best[0]+"/"+best[1]
}
function time(f:Fixture){
  return new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(f.kickoff))
}
function avgProbability(slip:Slip){
  if(slip.averageLegProbability!=null)return slip.averageLegProbability
  return slip.legs.length?slip.legs.reduce((s,l)=>s+l.probability,0)/slip.legs.length:0
}

function londonToday(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
}
function multiCacheKey(){return "match-edge:multi:v5:"+londonToday()}
function readMultiCache():Response|null{
  try{
    const raw=window.localStorage.getItem(multiCacheKey())
    if(!raw)return null
    const parsed=JSON.parse(raw)
    return parsed?.data?.ok?parsed.data as Response:null
  }catch{return null}
}
function writeMultiCache(data:Response){
  try{
    const hasBuild=(data?.multiMatchBuild?.matchBuilders?.length??0)>0||(data?.multiMatchBuild?.tiers??[]).some(t=>(t.matchBuilders?.length??0)>0)
    if(data?.ok&&hasBuild)window.localStorage.setItem(multiCacheKey(),JSON.stringify({savedAt:new Date().toISOString(),data}))
  }catch{}
}

export default function RecommendedPage(){
  const[loading,setLoading]=useState(false)
  const[data,setData]=useState<Response|null>(null)
  const[multiTier,setMultiTier]=useState<MultiMatchRiskTier>("safe")

  const refresh=useCallback(async(force=false)=>{
    setLoading(true)
    const controller=new AbortController()
    const timeout=window.setTimeout(()=>controller.abort(),force?25000:12000)
    try{
      const url="/api/recommended?mode=multi"+(force?"&refresh=1":"")
      const r=await fetch(url,{cache:"no-store",signal:controller.signal})
      const next=r.ok?await r.json() as Response:{ok:false,error:"Multi-match scan failed"}
      const hasBuild=(next?.multiMatchBuild?.matchBuilders?.length??0)>0||(next?.multiMatchBuild?.tiers??[]).some(t=>(t.matchBuilders?.length??0)>0)
      const hasLive=(next?.liveMatches?.length??0)>0
      if(next.ok&&!hasBuild&&!hasLive){
        const cached=readMultiCache()
        setData(cached??next)
      }else{
        setData(next)
        if(next.ok)writeMultiCache(next)
      }
    }catch(error){
      const timedOut=error instanceof DOMException&&error.name==="AbortError"
      setData(cur=>cur??{
        ok:false,
        error:timedOut
          ?"No cached Multi build is available yet. Tap refresh to build it once; after that it stays cached until you refresh again."
          :"Multi-match scan failed"
      })
    }finally{
      window.clearTimeout(timeout)
      setLoading(false)
    }
  },[])

  useEffect(()=>{
    const cached=readMultiCache()
    if(cached){
      setData(cached)
      setLoading(false)
      const now=Date.now()
      const nearLineup=(cached.multiMatchBuild?.matchBuilders??[]).some(m=>{
        const kickoff=new Date(m.kickoff).getTime()
        return Number.isFinite(kickoff)&&now>=kickoff-120*60*1000&&now<=kickoff+3*60*60*1000
      })
      if(nearLineup)void refresh(true)
      return
    }
    void refresh(false)
  },[refresh])

  useEffect(()=>{
    const t=window.setInterval(()=>{
      const now=Date.now()
      const nearLineupOrLive=(data?.liveMatches?.length??0)>0||(data?.multiMatchBuild?.matchBuilders??[]).some(m=>{
        const kickoff=new Date(m.kickoff).getTime()
        return Number.isFinite(kickoff)&&now>=kickoff-120*60*1000&&now<=kickoff+3*60*60*1000
      })
      if(nearLineupOrLive)void refresh(true)
    },30000)
    return()=>window.clearInterval(t)
  },[refresh,data])

  const multi=data?.multiMatchBuild
  const cards=data?.yellowCardWatch??[]
  const legacySafeTier:MultiMatchTier|null=multi?{
    id:"safe",title:"Safe",description:"Safest available route",targetFractionalPerMatch:multi.targetFractionalPerMatch||"3/1",targetDecimalPerMatch:4,
    available:multi.available,matchBuilders:multi.matchBuilders??[],legs:multi.legs??[],
    combinedBet365Odds:multi.combinedBet365Odds??null,conservativeAllHitProbability:multi.conservativeAllHitProbability??multi.modelAllHitProbability??null,
    note:multi.note,
  }:null
  const tiers=(multi?.tiers?.length?multi.tiers:(legacySafeTier?[legacySafeTier]:[]))
  const activeTier=tiers.find(t=>t.id===multiTier)??tiers[0]??null
  const legs=activeTier?.legs??[]
  const matchBuilders=activeTier?.matchBuilders??[]
  const liveMatches=data?.liveMatches??[]
  const liveMode=liveMatches.length>0

  return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-violet-300"><Trophy className="size-4"/><span className="text-[0.62rem] font-black uppercase tracking-[0.16em]">Match Edge</span></div>
            <h1 className="mt-1 text-2xl font-black">{liveMode?"Multi Live Intelligence":"Multi-Match Builder"}</h1>
            <p className="mt-1 text-xs text-white/45">{liveMode?"Same live player engine as Match Builder, across every game in play.":"Three probability-led Multi builds: Safe, Balanced and Risky · up to 10 matches."}</p>
          </div>
          <button onClick={()=>void refresh(true)} className="rounded-xl bg-violet-300 p-2.5 text-violet-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[0.46rem] font-black uppercase">
          {["Goals","Assists","Cards","Fouls committed","Fouls drawn","Shots","SOT"].map(x=><span key={x} className="rounded-full bg-emerald-300/10 px-2 py-1 text-emerald-200">{x}</span>)}
        </div>
        <p className="mt-2 text-[0.52rem] text-white/30">{liveMode?"Live games use current fouls committed, fouls drawn, shots, SOT, cards, goals, assists and substitutions alongside each player's history. Top 3 are shown for every market in every live game.":"Automatic Multi uses verified Bet365 player markets only: goals, assists, cards, fouls committed, fouls drawn, shots and SOT. Match/team markets such as corners, BTTS, total goals, match winner and double chance are excluded. Safe, Balanced and Risky stay probability-first, so repeated 1+ events are preferred when they are more likely. Once both XIs are confirmed, only those starters remain eligible."}</p>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {data?.staleFallback?<div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-4 py-3 text-xs text-amber-100">{data.warning??"Showing the last successful cached build."}</div>:null}

      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-violet-300"/><p className="font-black">Loading cached Multi build…</p><p className="mt-1 text-xs text-white/30">If there is no cache yet, this will stop automatically rather than scan forever.</p></section>:null}
      {!loading&&data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-6 text-center"><p className="font-black">Multi-match scan unavailable</p><p className="mt-1 text-sm text-white/40">{data.error??"Try a manual refresh."}</p></section>:null}

      {liveMode
        ?<LiveNowSection matches={liveMatches}/>
        :<>
      {data?.ok?<section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DecisionMetric label="Eligible matches" value={String(multi?.eligibleFixtureCount??0)} sub="verified player-prop coverage"/>
        <DecisionMetric label="Match builders" value={String(matchBuilders.length)} sub={(activeTier?.title??"Safe")+" · "+(activeTier?.targetFractionalPerMatch??"3/1")+" each"}/>
        <DecisionMetric label="Total selections" value={String(legs.length)} sub="inside selected tier"/>
        <DecisionMetric label="Combined chance" value={percent(activeTier?.conservativeAllHitProbability)} sub="conservative estimate"/>
      </section>:null}

      {data?.ok&&tiers.length?<section className="grid grid-cols-3 gap-2">
        {tiers.map(tier=>{
          const active=activeTier?.id===tier.id
          const label=tier.id==="safe"?"Safe":tier.id==="balanced"?"Balanced":"Risky"
          return <button key={tier.id} onClick={()=>setMultiTier(tier.id)} className={"rounded-2xl border px-3 py-3 text-left transition "+(active?"border-violet-300/35 bg-violet-300 text-violet-950":"border-white/8 bg-white/[0.035] text-white")}>
            <p className="text-xs font-black">{label}</p>
            <p className={"mt-1 font-mono text-sm font-black "+(active?"text-violet-950":"text-emerald-200")}>{tier.targetFractionalPerMatch}</p>
            <p className={"mt-1 text-[0.46rem] "+(active?"text-violet-950/65":"text-white/30")}>{tier.id==="safe"?"Low variance":tier.id==="balanced"?"Higher target":"Highest target"}</p>
          </button>
        })}
      </section>:null}

      {data?.ok?<section className="rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-400/[0.13] to-black/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div><div className="flex items-center gap-2 text-violet-200"><Sparkles className="size-4"/><p className="text-[0.54rem] font-black uppercase tracking-[0.13em]">{activeTier?.title??"Safe"} Bet Builder Multi</p></div><h2 className="mt-1 text-xl font-black">{matchBuilders.length?matchBuilders.length+" matches · "+legs.length+" selections":"No qualifying multi yet"}</h2><p className="mt-1 text-[0.58rem] leading-relaxed text-white/40">{activeTier?.note??multi?.note??"Waiting for enough matches with verified Bet365 prices."}</p></div>
          <div className="text-right"><p className="font-mono text-xl font-black">{fractionalOdds(activeTier?.combinedBet365Odds)}</p><p className="text-[0.42rem] font-black uppercase text-emerald-300/75">{activeTier?.combinedBet365Odds!=null?"Bet365 singles reference":"no complete price"}</p></div>
        </div>

        {activeTier?.description?<div className="mt-3 rounded-2xl border border-white/8 bg-black/15 px-3 py-2 text-[0.56rem] leading-relaxed text-white/45">{activeTier.description}</div>:null}

        {matchBuilders.length?<div className="mt-4 space-y-3">{matchBuilders.map((builder,matchIndex)=><div key={(builder.riskTier??activeTier?.id??"safe")+"|"+builder.fixtureId} className="rounded-2xl border border-white/8 bg-black/20 p-3">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[0.46rem] font-black uppercase text-violet-200/70">Match {matchIndex+1} · {activeTier?.title??"Safe"} {builder.targetFractional}</p><p className="mt-1 text-sm font-black">{builder.home} <span className="text-white/25">v</span> {builder.away}</p><p className="mt-1 text-[0.46rem] text-white/30">{builder.competition} · {builder.legs.length} selections{builder.includesCard&&builder.cardPick?" · card: "+builder.cardPick:""}{builder.preMatchSnapshot?" · pre-match snapshot":""}</p><div className="mt-2"><LineupButton fixture={{id:builder.fixtureId,competition:builder.competition,kickoff:builder.kickoff,home:{name:builder.home,crest:builder.homeCrest},away:{name:builder.away,crest:builder.awayCrest}}} confirmed={Boolean(builder.lineupsConfirmed)}/></div></div><div className="text-right"><p className="font-mono text-base font-black text-emerald-200">{fractionalOdds(builder.referenceOdds)}</p><p className="text-[0.42rem] text-white/30">{percent(builder.conservativeAllHitProbability)} est. · {builder.preMatchSnapshot?"pre-match Bet365 ref":"Bet365 ref"}</p></div></div>
          <div className="mt-3 space-y-1.5">{builder.legs.map((leg,i)=><div key={leg.player+"|"+leg.market+"|"+i} className={"grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl px-2.5 py-2 "+(leg.market==="card"?"border border-amber-300/15 bg-amber-300/[0.06]":"bg-white/[0.045]")}>
            <span className="text-[0.46rem] font-black text-white/25">{i+1}</span>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-[0.62rem] font-black">{leg.player} · {leg.label}</p><TeamBadge team={leg.team} home={builder.home} away={builder.away} homeCrest={builder.homeCrest} awayCrest={builder.awayCrest}/>{leg.market==="card"?<span className="rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[0.38rem] font-black text-amber-200">TOP CARD PICK</span>:null}</div><p className="mt-0.5 text-[0.42rem] text-white/25">Grade {leg.confidence} · verified Bet365</p></div>
            <div className="text-right"><p className="font-mono text-[0.62rem] font-black text-emerald-200">{fractionalOdds(leg.bookmakerOdds)}</p><p className="text-[0.4rem] text-white/25">{percent(leg.probability)}</p></div>
          </div>)}</div>
        </div>)}</div>:<div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/15 p-6 text-center"><p className="font-black">No {activeTier?.title??"selected"} multi available yet</p><p className="mt-1 text-xs text-white/35">The builder will not manufacture a card or weak player prop just to reach the target price.</p></div>}
      </section>:null}

      {data?.ok?<section className="space-y-3">
        <div className="px-1"><div className="flex items-center gap-2 text-amber-200"><BadgeCheck className="size-4"/><p className="font-black">Yellow Card Watch</p></div><p className="mt-1 text-[0.6rem] text-white/35">Visible whenever Bet365 has a verified player-card market and Match Edge has a priced card candidate.</p></div>
        {cards.length?<div className="space-y-2">{cards.map((row,i)=><div key={row.fixtureId+"|"+row.player} className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.045] p-3">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[0.46rem] font-black uppercase text-white/25">{row.home} v {row.away}</p><div className="mt-1 flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black">{i+1}. {row.player} · To be booked</p><TeamBadge team={row.team} home={row.home} away={row.away} homeCrest={row.homeCrest} awayCrest={row.awayCrest}/><span className={"rounded-full px-1.5 py-0.5 text-[0.38rem] font-black "+(row.probabilityBasis==="model"?"bg-emerald-300/10 text-emerald-200":"bg-amber-300/10 text-amber-200")}>{row.probabilityBasis==="model"?"MATCH EDGE MODEL":"BET365 IMPLIED"}</span></div><p className="mt-1 line-clamp-2 text-[0.5rem] leading-relaxed text-white/30">{row.reason}</p></div><div className="text-right"><p className="font-mono text-base font-black text-amber-200">{fractionalOdds(row.bookmakerOdds)}</p><p className="text-[0.46rem] font-black text-white/40">{percent(row.probability)}</p></div></div>
        </div>)}</div>:<div className="rounded-2xl border border-dashed border-amber-300/12 bg-amber-300/[0.025] p-5 text-center"><p className="text-sm font-black text-amber-100">No verified yellow-card picks right now</p><p className="mt-1 text-[0.56rem] text-white/30">This section stays visible so you can tell the card market was checked rather than missing from the app.</p></div>}
      </section>:null}
        </>}

    </div>
  </main>
}

function buildPropBoard(recommendations:Recommendation[]):PropBoardRow[]{
  const out:PropBoardRow[]=[]
  const seen=new Set<string>()
  for(const rec of recommendations){
    for(const leg of rec.slip.legs??[]){
      const key=[rec.fixture.id,leg.player,leg.market,leg.label].join("|")
      if(seen.has(key))continue
      seen.add(key)
      const exact=leg.bookmakerOdds!=null&&leg.priceSource!=="estimated"&&Number(leg.bookmakerOdds)>1
      const marketProbability=exact?1/Number(leg.bookmakerOdds):null
      const edge=marketProbability==null?null:Number(leg.probability)-marketProbability
      out.push({recId:rec.id,fixture:rec.fixture,leg,placeable:rec.placeable,marketProbability,edge})
    }
  }
  return out.sort((a,b)=>b.leg.probability-a.leg.probability)
}

function LineupPitch({team}:{team:LineupTeam}){
  const groups=[
    {key:"att",label:"Attack",players:team.starters.filter(p=>p.group==="att")},
    {key:"mid",label:"Midfield",players:team.starters.filter(p=>p.group==="mid")},
    {key:"def",label:"Defence",players:team.starters.filter(p=>p.group==="def")},
    {key:"gk",label:"Goalkeeper",players:team.starters.filter(p=>p.group==="gk")},
  ]
  const known=new Set(groups.flatMap(g=>g.players.map(p=>p.id||p.name)))
  const other=team.starters.filter(p=>!known.has(p.id||p.name))
  if(other.length)groups.splice(3,0,{key:"other",label:"Other",players:other})
  return <div className="rounded-3xl border border-emerald-200/15 bg-gradient-to-b from-emerald-950/90 to-[#0b291b] p-3">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">{team.crest?<img src={team.crest} alt="" className="size-7 object-contain"/>:<div className="grid size-7 place-items-center rounded-full bg-white/10 text-[0.48rem] font-black">{teamCode(team.team).slice(0,2)}</div>}<div><p className="text-sm font-black">{team.team}</p><p className="text-[0.48rem] text-emerald-100/45">{team.starters.length}/11 starters</p></div></div>
      <div className="text-right"><p className="font-mono text-base font-black text-emerald-200">{team.formation??"—"}</p><p className="text-[0.4rem] uppercase text-emerald-100/35">{team.formationSource==="official-feed"?"official formation":team.formationSource==="position-inferred"?"shape inferred from positions":"formation unavailable"}</p></div>
    </div>
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-emerald-900/35 px-2 py-4">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-white/10"/>
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10"/>
      <div className="relative space-y-4">
        {groups.map(group=>group.players.length?<div key={group.key}><p className="mb-1 text-center text-[0.38rem] font-black uppercase tracking-[0.14em] text-white/25">{group.label}</p><div className="flex flex-wrap justify-center gap-1.5">{group.players.map(player=><div key={player.id||player.name} className="min-w-[4.2rem] max-w-[6.2rem] rounded-xl bg-black/35 px-2 py-1.5 text-center shadow-sm"><p className="truncate text-[0.54rem] font-black">{player.shortName||player.name}{player.captain?" ©":""}</p><p className="mt-0.5 text-[0.38rem] text-white/35">{player.jersey?"#"+player.jersey+" · ":""}{player.position??group.label}</p></div>)}</div></div>:null)}
      </div>
    </div>
  </div>
}

function LineupButton({fixture,confirmed,className=""}:{fixture:Fixture;confirmed:boolean;className?:string}){
  const[open,setOpen]=useState(false)
  const[loading,setLoading]=useState(false)
  const[data,setLineup]=useState<LineupResponse|null>(null)
  if(!confirmed)return null
  const load=async()=>{
    setOpen(true)
    if(data?.confirmed)return
    setLoading(true)
    try{
      const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(fixture.kickoff))
      const q=new URLSearchParams({date,home:fixture.home.name,away:fixture.away.name,competition:fixture.competition})
      const r=await fetch("/api/lineup?"+q.toString(),{cache:"no-store"})
      const json=await r.json() as LineupResponse
      setLineup(json)
    }catch{
      setLineup(null)
    }finally{setLoading(false)}
  }
  return <>
    <button type="button" onClick={(e)=>{e.stopPropagation();void load()}} className={"inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1.5 text-[0.52rem] font-black text-emerald-200 "+className}><Shirt className="size-3"/>Lineup ✓</button>
    {open?<div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={()=>setOpen(false)}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#07120e] p-4 shadow-2xl sm:rounded-3xl" onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 z-10 -mx-1 flex items-start justify-between gap-3 bg-[#07120e]/95 px-1 pb-3 backdrop-blur">
          <div><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-300 px-2 py-1 text-[0.45rem] font-black text-emerald-950">CONFIRMED XI</span><span className="text-[0.46rem] text-white/30">{data?.source??"Official match sheet"}</span></div><h3 className="mt-2 text-lg font-black">{fixture.home.name} <span className="text-white/25">v</span> {fixture.away.name}</h3><p className="mt-0.5 text-[0.52rem] text-white/35">{fixture.competition} · this is the XI used by Match Edge</p></div>
          <button type="button" onClick={()=>setOpen(false)} className="rounded-xl bg-white/8 p-2 text-white/60"><X className="size-4"/></button>
        </div>
        {loading?<div className="py-14 text-center"><RefreshCw className="mx-auto size-5 animate-spin text-emerald-300"/><p className="mt-2 text-xs font-black">Loading official team sheets…</p></div>:data?.confirmed?<div className="space-y-3"><LineupPitch team={data.home}/><LineupPitch team={data.away}/><p className="px-1 text-[0.48rem] leading-relaxed text-white/30">Formation is shown as official when the match feed supplies it. If ESPN confirms the XI but omits the formation, the app labels any displayed shape as position-inferred rather than pretending it is official.</p></div>:<div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.05] p-5 text-center"><p className="font-black text-amber-100">Official XI could not be reloaded</p><p className="mt-1 text-xs text-white/35">The match was flagged confirmed by the recommendation scan, but the live match-sheet endpoint did not return both 11s on this request.</p></div>}
      </div>
    </div>:null}
  </>
}

function DecisionMetric({label,value,sub}:{label:string;value:string;sub:string}){
  return <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3"><p className="font-mono text-lg font-black">{value}</p><p className="mt-1 text-[0.48rem] font-black uppercase text-white/30">{label}</p><p className="mt-1 text-[0.45rem] text-white/20">{sub}</p></div>
}

function DecisionTabs({view,setView,liveCount,valueCount,propCount}:{view:ViewMode;setView:(v:ViewMode)=>void;liveCount:number;valueCount:number;propCount:number}){
  const tabs=[
    {id:"all" as const,label:"For you",icon:Sparkles,count:null},
    {id:"live" as const,label:"Live",icon:Zap,count:liveCount},
    {id:"value" as const,label:"Value",icon:TrendingUp,count:valueCount},
    {id:"props" as const,label:"Props",icon:Users,count:propCount},
    {id:"targets" as const,label:"Target odds",icon:Target,count:null},
  ]
  return <section className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"><div className="flex min-w-max gap-2 pb-1">{tabs.map(tab=>{const Icon=tab.icon;const active=view===tab.id;return <button key={tab.id} onClick={()=>setView(tab.id)} className={"flex items-center gap-2 rounded-full border px-3.5 py-2.5 text-xs font-black transition "+(active?"border-violet-300/30 bg-violet-300 text-violet-950":"border-white/8 bg-white/[0.04] text-white/50")}><Icon className="size-3.5"/>{tab.label}{tab.count!=null?<span className={"rounded-full px-1.5 py-0.5 text-[0.48rem] "+(active?"bg-violet-950/10":"bg-white/7")}>{tab.count}</span>:null}</button>})}</div></section>
}

function ValueBoard({rows}:{rows:PropBoardRow[]}){
  return <section className="space-y-3">
    <div className="flex items-end justify-between gap-3 px-1"><div><div className="flex items-center gap-2 text-emerald-300"><TrendingUp className="size-4"/><p className="font-black">Best model-vs-price gaps</p></div><p className="mt-1 text-[0.6rem] text-white/35">Only exact recorded bookmaker prices. Gap is model probability minus raw implied price probability.</p></div></div>
    <div className="space-y-2">{rows.map(row=><div key={row.recId+"|"+row.leg.player+"|"+row.leg.market} className="rounded-2xl border border-emerald-300/10 bg-emerald-400/[0.035] p-3">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.48rem] font-black uppercase text-white/25">{row.fixture.competition} · {row.fixture.home.name} v {row.fixture.away.name}</p><p className="mt-1 text-sm font-black">{row.leg.player} · {row.leg.label}</p><p className="mt-1 text-[0.52rem] text-white/35">{row.leg.bookmakerName??"Bookmaker"} · {row.leg.bookmakerOdds?.toFixed(2)} · Grade {row.leg.confidence}</p></div><div className="text-right"><p className="font-mono text-lg font-black text-emerald-300">+{((row.edge??0)*100).toFixed(1)}pp</p><p className="text-[0.42rem] uppercase text-white/25">model gap</p></div></div>
      <div className="mt-3 grid grid-cols-3 gap-2"><Stat label="Model" value={percent(row.leg.probability)}/><Stat label="Price implies" value={percent(row.marketProbability)}/><Stat label="Fair odds" value={row.leg.fairOdds?.toFixed(2)??"—"}/></div>
    </div>)}</div>
  </section>
}

function PlayerPropsBoard({rows}:{rows:PropBoardRow[]}){
  const[market,setMarket]=useState<"all"|"card"|"foul"|"fouled"|"shot"|"sot">("all")
  const[sort,setSort]=useState<"projection"|"edge">("projection")
  const group=(m:string)=>m==="card"?"card":m.startsWith("fouled")?"fouled":m.startsWith("foul")?"foul":m.startsWith("sot")?"sot":m.startsWith("shot")?"shot":"other"
  const filtered=rows.filter(r=>market==="all"||group(r.leg.market)===market)
  const shown=[...filtered].sort((a,b)=>sort==="edge"?(b.edge??-999)-(a.edge??-999):b.leg.probability-a.leg.probability).slice(0,24)
  const filters:[typeof market,string][]=[["all","All"],["card","Cards"],["foul","Fouls"],["fouled","Fouled"],["shot","Shots"],["sot","SOT"]]
  return <section className="space-y-3">
    <div className="px-1"><div className="flex items-center gap-2 text-cyan-300"><Users className="size-4"/><p className="font-black">Player props board</p></div><p className="mt-1 text-[0.6rem] text-white/35">Scan qualified player markets by projection or exact-price gap. No bookmaker edge is shown when the price has not actually been verified.</p></div>
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"><div className="flex min-w-max gap-2 pb-1">{filters.map(([id,label])=><button key={id} onClick={()=>setMarket(id)} className={"rounded-full border px-3 py-2 text-[0.58rem] font-black "+(market===id?"border-cyan-300/35 bg-cyan-300 text-cyan-950":"border-white/8 bg-white/[0.04] text-white/45")}>{label}</button>)}</div></div>
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.025] p-2">
      <p className="pl-2 text-[0.5rem] font-black uppercase text-white/25">{shown.length} shown</p>
      <div className="flex gap-1"><button onClick={()=>setSort("projection")} className={"rounded-xl px-3 py-2 text-[0.52rem] font-black "+(sort==="projection"?"bg-white text-[#07120e]":"text-white/35")}>Projection</button><button onClick={()=>setSort("edge")} className={"rounded-xl px-3 py-2 text-[0.52rem] font-black "+(sort==="edge"?"bg-white text-[#07120e]":"text-white/35")}>Price edge</button></div>
    </div>
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/8 px-3 py-2 text-[0.46rem] font-black uppercase text-white/25"><span>Player / market</span><span>Projection</span><span>Edge</span></div>
      <div>{shown.length?shown.map((row,i)=><div key={row.recId+"|"+row.leg.player+"|"+row.leg.market} className={"grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-3 "+(i?"border-t border-white/[0.055]":"")}>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-xs font-black">{row.leg.player} · {row.leg.label}</p><TeamBadge team={row.leg.team} home={row.fixture.home.name} away={row.fixture.away.name} homeCrest={row.fixture.home.crest} awayCrest={row.fixture.away.crest}/></div><p className="mt-0.5 truncate text-[0.46rem] text-white/30">{row.fixture.home.name} v {row.fixture.away.name} · Grade {row.leg.confidence}</p></div>
        <div className="text-right"><p className="font-mono text-sm font-black">{percent(row.leg.probability)}</p><p className="text-[0.4rem] text-white/20">{row.leg.fairOdds?.toFixed(2)??"—"} fair</p></div>
        <div className="min-w-[3.1rem] text-right">{row.edge!=null?<><p className={"font-mono text-xs font-black "+(row.edge>0?"text-emerald-300":"text-rose-300")}>{row.edge>=0?"+":""}{(row.edge*100).toFixed(1)}pp</p><p className="text-[0.38rem] text-white/20">{row.leg.bookmakerOdds?.toFixed(2)}</p></>:<><p className="text-xs font-black text-white/25">—</p><p className="text-[0.38rem] text-white/20">no exact price</p></>}</div>
      </div>):<p className="px-4 py-8 text-center text-sm text-white/35">No qualified props in this market yet.</p>}</div>
    </div>
  </section>
}

function MiniPerformance({tracking}:{tracking:Tracking}){
  return <Link href="/performance" className="block rounded-3xl border border-emerald-300/10 bg-emerald-400/[0.035] p-4 transition hover:bg-emerald-400/[0.06]">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><BarChart3 className="size-4 text-emerald-300"/><div><p className="text-sm font-black">Model record</p><p className="text-[0.52rem] text-white/30">{tracking.gradedLegs} graded legs · last {tracking.days} days</p></div></div><span className="text-[0.54rem] font-black text-emerald-300">OPEN RESULTS →</span></div>
    <div className="mt-3 grid grid-cols-3 gap-2"><Stat label="Hit rate" value={percent(tracking.hitRate)}/><Stat label="Avg model" value={percent(tracking.avgProbability)}/><Stat label="Top-pick hit" value={percent(tracking.topPickHitRate)}/></div>
  </Link>
}

function LiveNowSection({matches}:{matches:LiveMatch[]}){
  return <section className="space-y-3">
    <div className="px-1"><p className="font-black">Live games</p><p className="text-[0.6rem] text-white/35">Each live match uses the same engine as the individual Match Builder. Top 3 are recalculated from current match events plus player history.</p></div>
    <div className="space-y-3">{matches.map(match=><LiveMatchCard key={match.id} match={match}/>)}</div>
  </section>
}

function LiveMatchCard({match}:{match:LiveMatch}){
  const score=match.score
  const probs=match.probabilities
  const playerProps=match.livePlayerProps??[]
  const propGroups=[
    {market:"card" as const,title:"Cards",selection:"to be carded"},
    {market:"foul1" as const,title:"Fouls",selection:"1+ foul"},
    {market:"fouled1" as const,title:"Fouled",selection:"1+ foul drawn"},
    {market:"shot1" as const,title:"Shots",selection:"1+ shot"},
    {market:"sot1" as const,title:"Shots on target",selection:"1+ SOT"},
    {market:"goal1" as const,title:"Goals",selection:"to score"},
    {market:"assist1" as const,title:"Assists",selection:"to assist"},
  ].map(group=>({...group,picks:playerProps.filter(p=>p.market===group.market).sort((a,b)=>b.probability-a.probability).slice(0,3)})).filter(group=>group.picks.length)
  const suggestedProps:LivePlayerProp[]=[]
  const usedPlayers=new Set<string>()
  for(const group of propGroups){
    const pick=group.picks.find(p=>!usedPlayers.has(p.player.toLowerCase()))
    if(!pick)continue
    suggestedProps.push(pick)
    usedPlayers.add(pick.player.toLowerCase())
    if(suggestedProps.length>=4)break
  }
  const liveLegs=[
    !match.bttsSettled&&match.bttsPick?{label:"BTTS "+(match.bttsPick.selection==="yes"?"Yes":"No"),probability:match.bttsPick.probability,grade:match.bttsPick.grade}:null,
  ].filter(Boolean) as Array<{label:string;probability:number;grade:string}>
  return <article className="rounded-3xl border border-rose-300/15 bg-rose-400/[0.045] p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-rose-300 px-2 py-1 text-[0.48rem] font-black text-rose-950">LIVE {match.elapsed??"?"}'</span><span className="text-[0.5rem] font-black uppercase text-white/30">{match.competition}</span></div>
        <h3 className="mt-2 text-lg font-black">{match.home} <span className="text-white/25">{score?score.home:"—"}–{score?score.away:"—"}</span> {match.away}</h3>
      </div>
    </div>

    {playerProps.length?<div className="mt-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.045] p-3">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase tracking-[0.12em] text-cyan-300">Live player likelihoods</p><p className="mt-0.5 text-[0.5rem] text-white/30">Top 3 per market from the current minute to full time{match.livePlayerStatsSource?" · live event counts connected":""}</p></div><span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[0.44rem] font-black text-cyan-200">ACTIVE PLAYERS</span></div>

      <div className="mt-3 space-y-3">{propGroups.map(group=><div key={group.market}><div className="mb-1.5 flex items-center justify-between"><p className="text-[0.5rem] font-black uppercase text-white/35">{group.title}</p><p className="text-[0.42rem] text-white/20">top {group.picks.length}</p></div><div className="space-y-1.5">{group.picks.map(prop=><div key={prop.player+"|"+prop.market} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.045] px-3 py-2"><div><div className="flex flex-wrap items-center gap-1.5"><p className="text-xs font-black">{prop.player} · {prop.label}</p><TeamBadge team={prop.team} home={match.home} away={match.away} homeCrest={match.homeCrest} awayCrest={match.awayCrest}/></div><p className="mt-0.5 text-[0.46rem] text-white/25">Grade {prop.confidence}{prop.market==="card"&&prop.liveStatsAvailable?" · fouls "+String(prop.currentFouls??0)+" · fouled "+String(prop.currentFouled??0):prop.market==="foul1"&&prop.liveStatsAvailable?" · fouls committed "+String(prop.currentFouls??0):prop.market==="fouled1"&&prop.liveStatsAvailable?" · fouled "+String(prop.currentFouled??0):prop.market==="shot1"||prop.market==="sot1"?" · shots "+String(prop.currentShots??0)+" · SOT "+String(prop.currentSot??0):prop.liveStatsAvailable?" · live count "+String(prop.currentCount??0):""}</p></div><div className="text-right"><p className="font-mono text-sm font-black">{percent(prop.probability)}</p><p className="text-[0.4rem] text-white/20">remaining</p></div></div>)}</div></div>)}</div>
      <p className="mt-3 text-[0.48rem] leading-relaxed text-white/25">These are remaining-match probabilities recalculated from the live game state. Substitutes who come on are included once active; players who go off are removed.</p>
    </div>:null}
  </article>
}

function TargetOddsSection({games,selectedId,onSelect}:{games:TargetOddsGame[];selectedId:string|null;onSelect:(id:string)=>void}){
  const selected=games.find(g=>g.fixture.id===selectedId)??games[0]??null
  if(!selected)return null
  return <section className="space-y-3">
    <div className="px-1"><p className="font-black">Target odds builder</p><p className="text-[0.6rem] text-white/35">Pick the match and target return. The engine then finds the highest-probability verified Bet365 player-prop route to reach it — it does not add match winner, double chance, total goals or corners just to inflate the price.</p></div>
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {games.map(game=><button key={game.fixture.id} onClick={()=>onSelect(game.fixture.id)} className={"min-w-[12rem] shrink-0 rounded-2xl border px-3 py-3 text-left transition "+(game.fixture.id===selected.fixture.id?"border-violet-300/35 bg-violet-400/10":"border-white/8 bg-white/[0.035]")}>
        <p className="text-[0.48rem] font-black uppercase text-white/30">{game.fixture.competition} · {time(game.fixture)}</p>
        <p className="mt-1 text-sm font-black">{game.fixture.home.name} <span className="text-white/25">v</span> {game.fixture.away.name}</p>
      </button>)}
    </div>
    <div className="rounded-2xl border border-violet-300/10 bg-violet-400/[0.035] px-4 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase text-violet-300">Selected match</p><p className="mt-1 font-black">{selected.fixture.home.name} v {selected.fixture.away.name}</p><p className="mt-1 text-[0.56rem] text-white/35">{selected.fixture.competition} · {time(selected.fixture)}</p></div><LineupButton fixture={selected.fixture} confirmed={Boolean(selected.lineupsConfirmed)}/></div></div>
    <div className="grid gap-3 sm:grid-cols-2">{selected.targets.map(s=><TargetOddsCard key={s.id} slip={s} fixture={selected.fixture}/>)}</div>
  </section>
}

function TargetOddsCard({slip,fixture}:{slip:TargetOddsSlip;fixture:Fixture}){
  const[open,setOpen]=useState(slip.targetFractional==="3/1")
  if(!slip.available)return <article className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase tracking-[0.14em] text-white/30">Target</p><h3 className="mt-1 text-xl font-black">{slip.targetFractional}</h3></div><span className="rounded-full bg-white/7 px-2.5 py-1 text-[0.48rem] font-black text-white/35">NO STRONG BUILD</span></div>
    <p className="mt-3 text-[0.62rem] leading-relaxed text-white/40">{slip.note}</p>
  </article>
  return <article className="overflow-hidden rounded-3xl border border-violet-300/15 bg-violet-400/[0.045]">
    <button onClick={()=>setOpen(v=>!v)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[0.5rem] font-black uppercase tracking-[0.14em] text-violet-300">Target {slip.targetFractional}</p><h3 className="mt-1 text-lg font-black">{slip.legs.length}-leg builder</h3><p className="mt-1 text-[0.56rem] text-white/35">{slip.bookmaker??"Model fair prices"} · same game</p></div>
        <div className="text-right"><p className="font-mono text-xl font-black">{slip.referenceOdds?.toFixed(2)??"—"}</p><p className="text-[0.42rem] uppercase text-white/25">{slip.priceSource==="bookmaker-singles"?"singles reference":"model reference"}</p></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2"><Stat label="Conservative chance" value={percent(slip.conservativeAllHitProbability??slip.modelAllHitProbability)}/><Stat label="Legs" value={String(slip.legs.length)+(slip.maxSelections?" / "+slip.maxSelections:"")}/></div>
      <div className="mt-3 flex items-center justify-between"><span className={"rounded-full px-2.5 py-1 text-[0.5rem] font-black "+(slip.marketsVerified?"bg-emerald-400/15 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{slip.marketsVerified?"MARKETS VERIFIED":"CHECK MARKETS"}</span><span className="text-[0.52rem] font-black text-white/35">{open?"Hide":"Show what to add"}</span></div>
    </button>
    {open?<div className="border-t border-white/8 bg-black/20 p-4">
      <div className="space-y-2">{slip.legs.map((leg,i)=><div key={leg.player+"|"+leg.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3">
        <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-1.5"><p className="text-sm font-black">{leg.player} · {leg.label}</p><TeamBadge team={leg.team} home={fixture.home.name} away={fixture.away.name} homeCrest={fixture.home.crest} awayCrest={fixture.away.crest}/></div><p className="mt-0.5 text-[0.56rem] text-white/35">Grade {leg.confidence}{leg.bookmaker?" · "+leg.bookmaker:""}</p></div><div className="text-right"><p className="font-mono text-base font-black">{percent(leg.conservativeProbability??leg.probability)}</p><p className="text-[0.44rem] text-white/25">{leg.conservativeProbability!=null&&Math.abs(leg.conservativeProbability-leg.probability)>.005?"model "+percent(leg.probability)+" · ":""}{leg.price.toFixed(2)} {leg.priceSource==="exact"?"single":"fair"}</p></div></div>
      </div>)}</div>
      <p className="mt-3 rounded-xl bg-amber-300/[0.06] px-3 py-2 text-[0.56rem] leading-relaxed text-amber-100/75">{slip.note}</p>
    </div>:null}
  </article>
}

function TrackingCard({tracking}:{tracking:Tracking}){
  const enough=(tracking.gradedLegs??0)>=20
  return <section className="rounded-3xl border border-emerald-300/10 bg-emerald-400/[0.035] p-4">
    <div className="flex items-start gap-3">
      <Activity className="mt-0.5 size-4 shrink-0 text-emerald-300"/>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-black">Live model accountability</p><span className="text-[0.52rem] text-white/30">last {tracking.days} days</span></div>
        {!enough?<p className="mt-2 text-xs leading-relaxed text-white/45">{tracking.gradedLegs} recommendation legs graded so far. The panel becomes statistically useful as the live sample grows.</p>:<>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Graded legs" value={String(tracking.gradedLegs)}/>
            <Stat label="Hit rate" value={percent(tracking.hitRate)}/>
            <Stat label="Avg model" value={percent(tracking.avgProbability)}/>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Whole-slip hit" value={percent(tracking.slipHitRate)}/>
            <Stat label="Top-pick slip hit" value={percent(tracking.topPickSlipHitRate)}/>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Top-pick leg hit" value={percent(tracking.topPickHitRate)}/>
            <Stat label="Top-pick model" value={percent(tracking.topPickAvgProbability)}/>
          </div>
          {(tracking.exactPriceLegs??0)>=20?<div className="mt-2 grid grid-cols-2 gap-2">
            <Stat label="Exact-price legs" value={String(tracking.exactPriceLegs??0)}/>
            <Stat label="Exact-price ROI" value={tracking.exactPriceROI==null?"—":((tracking.exactPriceROI>=0?"+":"")+(tracking.exactPriceROI*100).toFixed(1)+"%")}/>
          </div>:null}
        </>}
      </div>
    </div>
  </section>
}

function Stat({label,value}:{label:string;value:string}){
  return <div className="rounded-xl bg-black/20 p-2.5 text-center"><p className="font-mono text-sm font-black">{value}</p><p className="mt-0.5 text-[0.44rem] font-black uppercase text-white/25">{label}</p></div>
}

function RecommendationCard({rec,hero=false}:{rec:Recommendation;hero?:boolean}){
  const[open,setOpen]=useState(hero)
  const legs=rec.slip.legs??[]
  const avg=avgProbability(rec.slip)
  const bookmaker=rec.slip.bookmaker??null
  const title=rec.kind==="foul"?"Foul builder "+(rec.slip.targetFractional??""):(rec.slip.title??rec.slip.id)
  return <article className={"overflow-hidden rounded-3xl border "+(hero?"border-violet-300/25 bg-gradient-to-br from-violet-500/20 to-black/30":"border-white/10 bg-white/[0.04]")}>
    <button onClick={()=>setOpen(x=>!x)} className="w-full p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-emerald-400 px-2 py-1 text-[0.5rem] font-black text-emerald-950">CONFIRMED XI</span>
            {hero?<span className="rounded-full bg-violet-300 px-2 py-1 text-[0.5rem] font-black text-violet-950">TOP PICK</span>:null}
          </div>
          <p className="mt-2 text-[0.58rem] font-black uppercase text-white/30">{rec.fixture.competition} · {time(rec.fixture)}</p>
          <h2 className="mt-1 text-lg font-black">{rec.fixture.home.name} <span className="text-white/25">v</span> {rec.fixture.away.name}</h2>
          <p className="mt-2 text-sm font-black">{title}</p>
          {bookmaker?<p className="mt-1 text-[0.58rem] font-black text-violet-300">{bookmaker}</p>:null}
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-black">{percent(avg)}</p>
          <p className="text-[0.44rem] uppercase text-white/30">avg leg model</p>
          {rec.recommendationReliability!=null?<><p className="mt-1 font-mono text-sm font-black text-emerald-300">{percent(rec.recommendationReliability)}</p><p className="text-[0.4rem] uppercase text-white/25">historical reliability</p></>:null}
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-black/20 p-3">
        <div className="flex items-start gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-violet-300"/><p className="text-[0.67rem] leading-relaxed text-white/55">{rec.kind==="foul"?"The strongest same-bookmaker foul builder after exact/estimated price quality, calibrated hit probability, weakest-leg strength and lineup certainty.":"The strongest current slip profile after market calibration, recommendation-level historical calibration, price quality, confidence and lineup certainty."}</p></div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[0.6rem] text-white/40">{legs.length} legs</p>
        {rec.placeable?<span className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[0.54rem] font-black text-emerald-300"><BadgeCheck className="size-3"/>MARKETS VERIFIED</span>:<span className="flex items-center gap-1 rounded-full bg-amber-300/10 px-2.5 py-1 text-[0.54rem] font-black text-amber-200"><AlertTriangle className="size-3"/>CHECK MARKET</span>}
      </div>
      {rec.blockedReason?<p className="mt-2 rounded-xl bg-amber-300/10 px-3 py-2 text-[0.6rem] text-amber-100">{rec.blockedReason}</p>:null}
    </button>
    {rec.confirmed?<div className="border-t border-white/[0.055] px-4 py-2"><LineupButton fixture={rec.fixture} confirmed={rec.confirmed}/></div>:null}

    {open?<div className="border-t border-white/8 bg-black/20 p-4"><div className="space-y-2">{legs.map((leg,i)=><div key={leg.player+"|"+leg.market+"|"+i} className="rounded-2xl bg-white/[0.055] p-3">
      <div className="flex items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-1.5"><p className="text-sm font-black">{leg.player} · {leg.label}</p><TeamBadge team={leg.team} home={rec.fixture.home.name} away={rec.fixture.away.name} homeCrest={rec.fixture.home.crest} awayCrest={rec.fixture.away.crest}/></div><p className="mt-0.5 text-[0.56rem] text-white/35">Grade {leg.confidence}{leg.bookmakerName?" · "+leg.bookmakerName:""}{leg.priceSource==="estimated"?" · ESTIMATED PRICE":""}</p></div><p className="font-mono text-base font-black">{percent(leg.probability)}</p></div>
      {leg.bookmakerOdds!=null&&leg.priceSource!=="estimated"?<div className="mt-2 grid grid-cols-3 gap-1.5"><Stat label="Model" value={percent(leg.probability)}/><Stat label="Price implies" value={percent(1/leg.bookmakerOdds)}/><Stat label="Gap" value={((leg.probability-(1/leg.bookmakerOdds))*100>=0?"+":"")+((leg.probability-(1/leg.bookmakerOdds))*100).toFixed(1)+"pp"}/></div>:null}
      <p className="mt-2 text-[0.62rem] leading-relaxed text-white/45">{leg.reason}</p>
      {leg.bookmakerOdds!=null?<p className="mt-2 text-[0.56rem] text-white/35">{leg.priceSource==="estimated"?"Likely":"Bookmaker"} price: <span className="font-mono font-black text-white/70">{fractionalOdds(leg.bookmakerOdds)}</span></p>:null}
    </div>)}</div></div>:null}
  </article>
}
