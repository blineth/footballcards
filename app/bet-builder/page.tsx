"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, BadgeCheck, CirclePlus, Clock3, RefreshCw, ShieldCheck, Sparkles, Target, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available"|"unavailable"|"unknown"
type MarketKey = "goal1"|"foul1"|"foul2"|"foul3"|"foul4"|"foul5"|"fouled1"|"card"|"shot1"|"shot2"|"sot1"|"sot2"
type Category = "popular"|"goals"|"shots"|"sot"|"fouls"|"fouled"|"cards"

type Fixture={id:string;date:string;kickoff:string;competition:Competition;home:string;away:string}

type ScoreMarket={
  key:MarketKey;label:string;probability:number;fairOdds:number|null;confidence:"A"|"B"|"C"|"D";
  bookmakerOdds:number|null;bookmakerName:string|null;edge:number|null;expectedValue:number|null;
  recent5HitRate:number;seasonHitRate:number;h2hHitRate:number|null;reasons:string[]
}
type ScorePlayer={
  name:string;dbName?:string;team:string;position?:string|null;expectedMinutes?:number;
  markets?:Partial<Record<MarketKey,ScoreMarket>>
}
type Selection={
  id:string;player:string;team:string;market:string;label:string;probability:number;fairOdds:number|null;
  bookmakerOdds:number|null;bookmakerName?:string|null;edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;
  currentCount?:number|null;liveAdjusted?:boolean
}
type LivePlayerStat={
  player:string;team:string;minutes:number|null;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;yellowCards:number;redCards:number;subbedOff:boolean
}
type LiveData={
  ok:boolean;source:string|null;status:"scheduled"|"live"|"halftime"|"finished"|"unknown";elapsed:number;
  score:{home:number|null;away:number|null};players:LivePlayerStat[];updatedAt:string
}
type H2HMeeting={
  date:string;competition?:string|null;home:string;away:string;homeGoals:number;awayGoals:number;
  scorers:Array<{player:string;team:string;goals:number;assists:number}>;
  bookings:Array<{player:string;team:string;yellow:boolean;red:boolean}>;
  players:Array<{player:string;team:string;minutes:number;goals:number;assists:number;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;yellow:boolean;red:boolean}>;
  totals:{home:{yellow:number;red:number;fouls:number;shots:number;sot:number};away:{yellow:number;red:number;fouls:number;shots:number;sot:number}}
}
type H2HData={ok:boolean;source?:string;scope?:string;meetings:H2HMeeting[];count:number;error?:string}
type RiskBuilder={
  id:string;title:string;risk:"Safe"|"Balanced"|"High Risk";targetFractional:string;targetDecimal:number;
  legs:Selection[];referenceProductOdds:number|null;averageLegProbability:number|null;minimumLegProbability:number|null;
  modelAllHitProbability:number|null;exactPriced:boolean;bookmaker:string|null;note:string
}
type FallbackSlip={id:string;title:string;risk:string;legs:Selection[];averageLegProbability:number|null;note?:string}
type Scorecard={
  ok:boolean;lineupsConfirmed?:boolean;lineupMode?:"confirmed"|"predicted"|"squad";lineupSource?:string|null;predictedLineups?:any;
  snapshotFallback?:boolean;fallbackReason?:string|null;
  oddsFreshness?:"LIVE"|"SLIGHTLY STALE"|"CACHED"|"STALE"|"UNKNOWN";players?:ScorePlayer[];
  slips?:FallbackSlip[];riskBuilders?:RiskBuilder[];eligibleBooks?:string[];
  marketAvailability?:Record<string,MarketStatus>;bookmakerAvailability?:Record<string,Record<string,MarketStatus>>;
  referee?:{name?:string;yellowsPerGame?:number|null}|null;error?:string
}

const categories:{id:Category;label:string;markets:MarketKey[]}[]=[
  {id:"popular",label:"Most likely",markets:["goal1","shot1","sot1","foul1","fouled1","card"]},
  {id:"goals",label:"Goals",markets:["goal1"]},
  {id:"shots",label:"Shots",markets:["shot1","shot2"]},
  {id:"sot",label:"SOT",markets:["sot1","sot2"]},
  {id:"fouls",label:"Fouls",markets:["foul1","foul2","foul3","foul4","foul5"]},
  {id:"fouled",label:"Fouled",markets:["fouled1"]},
  {id:"cards",label:"Cards",markets:["card"]},
]

function percent(v:number|null|undefined,digits=0){return v==null?"—":(Number(v)*100).toFixed(digits)+"%"}
function parseFixture():Fixture|null{
  if(typeof window==="undefined")return null
  const p=new URLSearchParams(window.location.search)
  const id=p.get("id")??"",date=p.get("date")??"",kickoff=p.get("kickoff")??""
  const competition=(p.get("competition")??"") as Competition,home=p.get("home")??"",away=p.get("away")??""
  return id&&date&&competition&&home&&away?{id,date,kickoff,competition,home,away}:null
}
function scorecardUrl(f:Fixture){return "/api/fixture-scorecard?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition,refresh:String(Date.now())})}
function time(kickoff:string){return kickoff?new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff)):""}
function keyOf(s:Pick<Selection,"player"|"market"|"label">){return [s.player,s.market,s.label].join("|").toLowerCase()}
function referenceOdd(s:Selection){return Number(s.bookmakerOdds??s.fairOdds??(s.probability>0?1/s.probability:0))}
function liveUrl(f:Fixture){return "/api/live-player-stats?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})}
function h2hUrl(f:Fixture){return "/api/team-h2h?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})}
function normPlayer(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function thresholdForMarket(m:string){
  if(m==="card"||m.startsWith("goal"))return 1
  const hit=m.match(/(\d+)$/);return hit?Number(hit[1]):1
}
function countForMarket(stat:LivePlayerStat,m:string){
  if(m.startsWith("goal"))return stat.goals
  if(m==="card")return stat.yellowCards+stat.redCards
  if(m.startsWith("fouled"))return stat.foulsDrawn
  if(m.startsWith("foul"))return stat.foulsCommitted
  if(m.startsWith("sot"))return stat.shotsOnTarget
  if(m.startsWith("shot"))return stat.shots
  return 0
}
function familyOneMarket(m:string){
  if(m.startsWith("goal"))return "goal1"
  if(m==="card")return "card"
  if(m.startsWith("fouled"))return "fouled1"
  if(m.startsWith("foul"))return "foul1"
  if(m.startsWith("sot"))return "sot1"
  if(m.startsWith("shot"))return "shot1"
  return m
}
function poissonAtLeast(lambda:number,threshold:number){
  if(!(lambda>0))return 0
  let term=Math.exp(-lambda),sum=term
  for(let k=1;k<threshold;k++){term*=lambda/k;sum+=term}
  return Math.max(.001,Math.min(.99,1-sum))
}
function remainingOneProbability(full:number,elapsed:number){
  const p=Math.max(.001,Math.min(.995,full))
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,elapsed)))/96))
  const lambda=-Math.log(1-p)
  return Math.max(.001,Math.min(.99,1-Math.exp(-lambda*remaining)))
}
function applyLive(rows:Selection[],live:LiveData|null){
  if(!live||!(live.status==="live"||live.status==="halftime")||!live.players?.length)return rows
  const stats=new Map(live.players.map(p=>[normPlayer(p.player),p]))
  const oneProb=new Map<string,number>()
  for(const row of rows){
    if(row.market!==familyOneMarket(row.market))continue
    oneProb.set(normPlayer(row.player)+"|"+familyOneMarket(row.market),row.probability)
  }
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,live.elapsed)))/96))
  const adjusted:Selection[]=[]
  for(const row of rows){
    const stat=stats.get(normPlayer(row.player))
    if(!stat){adjusted.push(row);continue}
    if(stat.subbedOff)continue
    const current=countForMarket(stat,row.market)
    const threshold=thresholdForMarket(row.market)
    if(current>=threshold)continue
    const base=oneProb.get(normPlayer(row.player)+"|"+familyOneMarket(row.market))??row.probability
    const need=Math.max(1,threshold-current)
    let probability:number
    if(row.market==="card"||row.market.startsWith("goal")){
      probability=remainingOneProbability(base,live.elapsed)
    }else{
      const lambdaFull=-Math.log(1-Math.max(.001,Math.min(.995,base)))
      probability=poissonAtLeast(lambdaFull*remaining,need)
    }
    adjusted.push({
      ...row,
      probability,
      fairOdds:probability>0?Math.round((1/probability)*100)/100:null,
      bookmakerOdds:null,
      bookmakerName:null,
      edge:null,
      currentCount:current,
      liveAdjusted:true,
      reason:`Live: ${current} already recorded; ${Math.round(probability*100)}% model chance of reaching ${row.label} from ${live.elapsed}'`,
    })
  }
  return adjusted
}
function categoryForMarket(m:string):Category{
  if(m.startsWith("goal"))return "goals"
  if(m.startsWith("sot"))return "sot"
  if(m.startsWith("shot"))return "shots"
  if(m.startsWith("fouled"))return "fouled"
  if(m.startsWith("foul"))return "fouls"
  return "cards"
}

function selectionsFrom(data:Scorecard|null){
  const out:Selection[]=[]
  const seen=new Set<string>()
  for(const p of data?.players??[]){
    for(const m of Object.values(p.markets??{})){
      if(!m)continue
      const row:Selection={id:"",player:p.name,team:p.team,market:m.key,label:m.label,probability:m.probability,fairOdds:m.fairOdds,bookmakerOdds:m.bookmakerOdds,bookmakerName:m.bookmakerName,edge:m.edge,confidence:m.confidence,reason:m.reasons?.[0]??"Player history and current matchup model"}
      row.id=keyOf(row)
      if(seen.has(row.id))continue
      seen.add(row.id);out.push(row)
    }
  }
  if(!out.length){
    for(const slip of data?.slips??[])for(const leg of slip.legs??[]){
      const row:Selection={...leg,id:keyOf(leg)}
      if(seen.has(row.id))continue
      seen.add(row.id);out.push(row)
    }
  }
  return out
}

function clientRiskBuilders(rows:Selection[]):RiskBuilder[]{
  const configs=[
    {id:"safe-3-1",title:"Safe 3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4,min:.62,max:5},
    {id:"balanced-10-1",title:"Balanced 10/1",risk:"Balanced" as const,targetFractional:"10/1",targetDecimal:11,min:.48,max:6},
    {id:"high-20-1",title:"High Risk 20/1+",risk:"High Risk" as const,targetFractional:"20/1+",targetDecimal:21,min:.14,max:9},
  ]
  return configs.map(cfg=>{
    type State={legs:Selection[];product:number;prob:number;players:Set<string>;quality:number}
    const pool=[...rows].filter(r=>r.probability>=cfg.min&&r.confidence!=="D").sort((a,b)=>b.probability-a.probability).slice(0,42)
    let states:State[]=[{legs:[],product:1,prob:1,players:new Set(),quality:0}]
    for(const leg of pool){
      const next=[...states]
      for(const state of states){
        if(state.legs.length>=cfg.max||state.players.has(leg.player.toLowerCase()))continue
        const odd=referenceOdd(leg);if(!(odd>1))continue
        const product=state.product*odd;if(product>cfg.targetDecimal*1.8&&state.legs.length>=1)continue
        next.push({legs:[...state.legs,leg],product,prob:state.prob*leg.probability,players:new Set([...state.players,leg.player.toLowerCase()]),quality:state.quality+leg.probability+Math.max(0,leg.edge??0)*.2})
      }
      states=next.sort((a,b)=>{
        const s=(x:State)=>Math.abs(Math.log(Math.max(1.01,x.product))-Math.log(cfg.targetDecimal))-(x.quality/Math.max(1,x.legs.length))*.2+(x.product<cfg.targetDecimal*.8?.5:0)
        return s(a)-s(b)
      }).slice(0,220)
    }
    const best=states.filter(s=>s.legs.length>=2&&s.product>=cfg.targetDecimal)[0]
    if(!best)return {id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,modelAllHitProbability:null,exactPriced:false,bookmaker:null,note:"No qualifying combination actually reaches this target yet. A lower-priced slip will not be labelled as "+cfg.targetFractional+"."}
    const books=[...new Set(best.legs.map(x=>x.bookmakerName).filter(Boolean))] as string[]
    const exactPriced=best.legs.every(x=>x.bookmakerOdds!=null)&&books.length===1
    return {id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,legs:best.legs,referenceProductOdds:Math.round(best.product*100)/100,averageLegProbability:best.legs.reduce((s,x)=>s+x.probability,0)/best.legs.length,minimumLegProbability:Math.min(...best.legs.map(x=>x.probability)),modelAllHitProbability:best.prob,exactPriced,bookmaker:exactPriced?books[0]:null,note:exactPriced?"Exact singles are from one bookmaker; its final Builder price can still change for correlation.":"Uses exact single prices where available and model fair odds otherwise; final bookmaker Builder odds can differ."}
  })
}

export default function BetBuilderPage(){
  const router=useRouter()
  const[fixture,setFixture]=useState<Fixture|null>(null)
  const[data,setData]=useState<Scorecard|null>(null)
  const[live,setLive]=useState<LiveData|null>(null)
  const[loading,setLoading]=useState(true)
  const[category,setCategory]=useState<Category>("popular")
  const[selected,setSelected]=useState<Record<string,Selection>>({})
  const[trayOpen,setTrayOpen]=useState(false)
  const[h2hOpen,setH2hOpen]=useState(false)
  const[h2hLoading,setH2hLoading]=useState(false)
  const[h2hData,setH2hData]=useState<H2HData|null>(null)

  useEffect(()=>{setFixture(parseFixture())},[])
  const load=useCallback(async(f:Fixture)=>{setLoading(true);try{const r=await fetch(scorecardUrl(f),{cache:"no-store"});setData(await r.json().catch(()=>({ok:false,error:"Unable to load match model."})))}finally{setLoading(false)}},[])
  useEffect(()=>{if(fixture)void load(fixture)},[fixture,load])
  useEffect(()=>{if(!fixture)return;const t=window.setInterval(()=>void load(fixture),60000);return()=>window.clearInterval(t)},[fixture,load])
  const loadLive=useCallback(async(f:Fixture)=>{
    const kickoff=new Date(f.kickoff).getTime()
    const now=Date.now()
    if(Number.isFinite(kickoff)&&(now<kickoff-10*60*1000||now>kickoff+4*60*60*1000))return
    try{const r=await fetch(liveUrl(f),{cache:"no-store"});if(r.ok)setLive(await r.json())}catch{}
  },[])
  useEffect(()=>{if(!fixture)return;void loadLive(fixture);const t=window.setInterval(()=>void loadLive(fixture),30000);return()=>window.clearInterval(t)},[fixture,loadLive])
  const toggleH2H=useCallback(async()=>{
    if(!fixture)return
    if(h2hOpen){setH2hOpen(false);return}
    setH2hOpen(true)
    if(h2hData)return
    setH2hLoading(true)
    try{
      const r=await fetch(h2hUrl(fixture),{cache:"no-store"})
      setH2hData(r.ok?await r.json():{ok:false,meetings:[],count:0,error:"Unable to load H2H history."})
    }catch{
      setH2hData({ok:false,meetings:[],count:0,error:"Unable to load H2H history."})
    }finally{setH2hLoading(false)}
  },[fixture,h2hOpen,h2hData])

  const preMatchRows=useMemo(()=>selectionsFrom(data),[data])
  const allRows=useMemo(()=>applyLive(preMatchRows,live),[preMatchRows,live])
  const visible=useMemo(()=>{
    const allowed=new Set(categories.find(x=>x.id===category)?.markets??[])
    const rows=category==="popular"?allRows.filter(x=>allowed.has(x.market as MarketKey)):allRows.filter(x=>allowed.has(x.market as MarketKey))
    const bestByPlayerMarket=new Map<string,Selection>()
    for(const row of rows.sort((a,b)=>b.probability-a.probability)){
      const family=categoryForMarket(row.market)
      const k=category==="popular"?row.player.toLowerCase()+"|"+family:row.id
      if(!bestByPlayerMarket.has(k))bestByPlayerMarket.set(k,row)
    }
    return [...bestByPlayerMarket.values()].sort((a,b)=>b.probability-a.probability)
  },[allRows,category])
  const serverBuilders=(data?.riskBuilders??[]).filter(x=>x.legs?.length)
  const inPlay=live?.status==="live"||live?.status==="halftime"
  const builders=inPlay?clientRiskBuilders(allRows):(serverBuilders.length?serverBuilders:clientRiskBuilders(allRows))
  useEffect(()=>{
    const valid=new Map(allRows.map(r=>[r.id,r]))
    setSelected(cur=>{
      if(!Object.keys(cur).length)return cur
      const next:Record<string,Selection>={}
      let changed=false
      for(const [k,v] of Object.entries(cur)){
        const fresh=valid.get(k)
        if(fresh){next[k]=fresh;if(fresh!==v)changed=true}
        else changed=true
      }
      return changed?next:cur
    })
  },[allRows,data?.lineupMode])
  const selectedRows=Object.values(selected)
  const referenceProduct=selectedRows.reduce((p,s)=>p*Math.max(1.01,referenceOdd(s)),1)
  const modelProduct=selectedRows.reduce((p,s)=>p*s.probability,1)
  const customRisk=modelProduct>=.25?"Safe":modelProduct>=.09?"Balanced":"Risky"

  if(!fixture)return <main className="min-h-screen bg-[#07120e] px-4 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><p className="font-black">Choose a match first</p><p className="mt-2 text-sm text-white/40">Open a fixture from Matches to build it.</p><button onClick={()=>router.push("/")} className="mt-5 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-emerald-950">Matches</button></div></main>

  function toggle(row:Selection){
    setSelected(cur=>{
      const next={...cur}
      if(next[row.id]){delete next[row.id];return next}
      const family=categoryForMarket(row.market)
      for(const [id,existing] of Object.entries(next)){
        if(normPlayer(existing.player)===normPlayer(row.player)&&categoryForMarket(existing.market)===family)delete next[id]
      }
      next[row.id]=row
      return next
    })
  }
  function useBuild(build:RiskBuilder){const next:Record<string,Selection>={};for(const leg of build.legs){const row={...leg,id:leg.id||keyOf(leg)};next[row.id]=row}setSelected(next);setTrayOpen(true)}

  return <main className="min-h-screen bg-[#07120e] pb-36 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button onClick={()=>router.push("/")} className="rounded-xl bg-white/7 p-2.5 text-white/70"><ArrowLeft className="size-4"/></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-emerald-300"><Target className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.15em]">Match Builder</span></div><h1 className="mt-1 truncate text-xl font-black">{fixture.home} <span className="text-white/25">v</span> {fixture.away}</h1><p className="mt-0.5 text-[0.58rem] text-white/35">{inPlay&&live?<span className="font-black text-rose-300">LIVE {live.elapsed}' · {live.score.home??"-"}-{live.score.away??"-"} · </span>:null}{fixture.competition} · {time(fixture.kickoff)}</p></div>
          <button onClick={()=>void toggleH2H()} className={"rounded-xl border px-3 py-2.5 text-[0.55rem] font-black "+(h2hOpen?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/10 bg-white/6 text-white/55")}>H2H</button>
          <button onClick={()=>void load(fixture)} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {h2hOpen?<H2HPanel data={h2hData} loading={h2hLoading} home={fixture.home} away={fixture.away}/>:null}
      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Ranking player markets…</p></section>:null}
      {data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-5"><p className="font-black">Match model unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></section>:null}

      {data?.ok&&data.lineupMode==="predicted"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-5 shrink-0 text-amber-300"/><div><p className="font-black text-amber-100">Predicted XI active</p><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{data.lineupSource??"Probable starters based on recent selection history and minutes."} As soon as the official XI arrives, anyone benched is removed and all probabilities/slips are rebuilt automatically.</p></div></div></section>:data?.ok&&data.lineupMode==="squad"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-6 text-center"><Clock3 className="mx-auto size-6 text-amber-300"/><p className="mt-3 font-black">No reliable XI yet</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">The match is still available, but player recommendations need a probable or confirmed starting XI.</p></section>:null}

      {inPlay&&live?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/[0.055] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-rose-200">Live recommendations adapting</p><p className="mt-1 text-[0.58rem] leading-relaxed text-white/40">Settled thresholds are removed automatically. If a player commits their first foul, 1+ disappears and the next available foul line moves up the ranking.</p></div><span className="shrink-0 rounded-full bg-rose-300 px-2 py-1 text-[0.45rem] font-black text-rose-950">{live.elapsed}'</span></div><p className="mt-2 text-[0.46rem] text-white/25">{live.source??"Live feed"} · refreshes every 30 seconds</p></section>:null}

      {data?.ok&&(data.lineupMode==="confirmed"||data.lineupMode==="predicted"||data.lineupsConfirmed)?<>
        <section className="rounded-3xl border border-emerald-300/12 bg-gradient-to-br from-emerald-400/[0.09] to-black/25 p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><p className="text-[0.54rem] font-black uppercase tracking-[0.13em]">3 suggested slips</p></div><h2 className="mt-1 text-lg font-black">Choose one or build your own</h2><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{inPlay?"These are rebuilt from the remaining live markets after anything already landed is removed.":"Safe aims around 3/1, Balanced around 10/1 and Risky 20/1+. The model picks the strongest route to each target."}</p></div><span className={"rounded-full px-2 py-1 text-[0.46rem] font-black "+(data.lineupMode==="confirmed"?"bg-emerald-400/10 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{data.lineupMode==="confirmed"?"XI CONFIRMED":"PREDICTED XI"}</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{builders.map(b=><RiskCard key={b.id} build={b} onUse={()=>useBuild(b)}/>)}</div>
        </section>

        <section className="space-y-3">
          <div className="px-1"><p className="font-black">Add your own selections</p><p className="mt-1 text-[0.6rem] text-white/35">Choose the market, then tap the player line you want. The strongest probabilities are shown first and your slip updates at the bottom.</p></div>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"><div className="flex min-w-max gap-2 pb-1">{categories.map(x=><button key={x.id} onClick={()=>setCategory(x.id)} className={"rounded-full border px-3.5 py-2.5 text-xs font-black "+(category===x.id?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/8 bg-white/[0.04] text-white/50")}>{x.label}</button>)}</div></div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
            <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/8 px-3 py-2"><p className="text-[0.48rem] font-black uppercase text-white/25">Most likely first</p><p className="text-[0.48rem] font-black uppercase text-white/25">{visible.length} options</p></div>
            <div>{visible.length?visible.map((row,i)=><SelectionRow key={row.id} row={row} selected={Boolean(selected[row.id])} onToggle={()=>toggle(row)} rank={i+1}/>):<p className="px-4 py-8 text-center text-sm text-white/35">No qualifying selections in this market.</p>}</div>
          </div>
        </section>

        {data.snapshotFallback?<section className="rounded-2xl border border-violet-300/15 bg-violet-400/[0.04] p-3 text-[0.58rem] leading-relaxed text-white/40">Snapshot fallback is active. Probabilities are still ranked, but live bookmaker prices may be unavailable, so fair odds are shown instead.</section>:null}
      </>:null}
    </div>

    {selectedRows.length?<BuilderTray rows={selectedRows} referenceProduct={referenceProduct} modelProduct={modelProduct} risk={customRisk} open={trayOpen} setOpen={setTrayOpen} onRemove={row=>toggle(row)} onClear={()=>setSelected({})}/>:null}
  </main>
}

function H2HPanel({data,loading,home,away}:{data:H2HData|null;loading:boolean;home:string;away:string}){
  return <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[0.5rem] font-black uppercase tracking-[0.12em] text-emerald-300">Head to head</p><h2 className="mt-1 text-base font-black">{home} v {away}</h2><p className="mt-1 text-[0.55rem] text-white/35">{data?.scope??"Scores, scorers, bookings and player match stats from previous meetings."}</p></div>{data?.source?<span className="rounded-full bg-white/6 px-2 py-1 text-[0.4rem] font-black text-white/25">{data.source}</span>:null}</div>
    {loading?<div className="py-8 text-center"><RefreshCw className="mx-auto size-5 animate-spin text-emerald-300"/><p className="mt-2 text-xs text-white/35">Loading H2H history…</p></div>:data?.meetings?.length?<div className="mt-4 space-y-3">{data.meetings.map(m=><H2HMeetingCard key={m.date} meeting={m}/>)}</div>:<p className="mt-4 rounded-2xl bg-black/20 px-3 py-5 text-center text-xs text-white/35">{data?.error??"No tracked previous meetings found in the current history source."}</p>}
  </section>
}
function H2HMeetingCard({meeting:m}:{meeting:H2HMeeting}){
  const[open,setOpen]=useState(false)
  const fmt=new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(m.date+"T12:00:00Z"))
  return <article className="overflow-hidden rounded-2xl border border-white/8 bg-black/20">
    <button onClick={()=>setOpen(v=>!v)} className="w-full p-3 text-left">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3"><div><p className="font-mono text-[0.5rem] text-white/30">{fmt}</p>{m.competition?<p className="mt-0.5 max-w-24 truncate text-[0.4rem] font-black uppercase text-emerald-300/55">{m.competition}</p>:null}</div><p className="truncate text-xs font-black">{m.home} <span className="text-white/25">v</span> {m.away}</p><p className="font-mono text-lg font-black">{m.homeGoals}-{m.awayGoals}</p></div>
      <div className="mt-2 grid grid-cols-2 gap-2"><div className="rounded-xl bg-white/[0.04] px-2 py-1.5"><p className="text-[0.44rem] font-black uppercase text-white/25">Scorers</p><p className="mt-1 text-[0.52rem] text-white/55">{m.scorers.length?m.scorers.map(s=>s.player+(s.goals>1?" x"+s.goals:"")).join(", "):"None tracked"}</p></div><div className="rounded-xl bg-white/[0.04] px-2 py-1.5"><p className="text-[0.44rem] font-black uppercase text-white/25">Booked</p><p className="mt-1 text-[0.52rem] text-white/55">{m.bookings.length?m.bookings.map(b=>b.player+(b.red?" 🟥":" 🟨")).join(", "):"None tracked"}</p></div></div>
      <div className="mt-2 grid grid-cols-2 gap-2"><H2HTeamTotals label={m.home} x={m.totals.home}/><H2HTeamTotals label={m.away} x={m.totals.away}/></div>
      <p className="mt-2 text-center text-[0.44rem] font-black uppercase text-white/20">{open?"Hide player stats":"Show player fouls / shots / SOT"}</p>
    </button>
    {open?<div className="border-t border-white/8 p-2"><div className="grid grid-cols-[1fr_repeat(5,auto)] gap-x-2 px-2 pb-1 text-[0.38rem] font-black uppercase text-white/20"><span>Player</span><span>F</span><span>FD</span><span>SH</span><span>SOT</span><span>YC</span></div>{m.players.map(p=><div key={p.team+"|"+p.player} className="grid grid-cols-[1fr_repeat(5,auto)] items-center gap-x-2 border-t border-white/[0.045] px-2 py-1.5 text-[0.48rem]"><span className="min-w-0 truncate text-white/55">{p.player}<span className="ml-1 text-white/20">{p.team}</span></span><span className="font-mono">{p.foulsCommitted}</span><span className="font-mono">{p.foulsDrawn}</span><span className="font-mono">{p.shots}</span><span className="font-mono">{p.shotsOnTarget}</span><span className="font-mono">{p.yellow?"1":"0"}</span></div>)}</div>:null}
  </article>
}
function H2HTeamTotals({label,x}:{label:string;x:{yellow:number;red:number;fouls:number;shots:number;sot:number}}){
  return <div className="rounded-xl bg-white/[0.04] px-2 py-1.5"><p className="truncate text-[0.45rem] font-black text-white/35">{label}</p><p className="mt-1 font-mono text-[0.48rem] text-white/55">{x.fouls} fouls · {x.shots} shots · {x.sot} SOT · {x.yellow} YC{x.red?" · "+x.red+" RC":""}</p></div>
}

function RiskCard({build,onUse}:{build:RiskBuilder;onUse:()=>void}){
  const tone=build.risk==="Safe"?"border-emerald-300/18 bg-emerald-400/[0.06]":build.risk==="Balanced"?"border-amber-300/18 bg-amber-300/[0.05]":"border-rose-300/18 bg-rose-400/[0.05]"
  const accent=build.risk==="Safe"?"text-emerald-300":build.risk==="Balanced"?"text-amber-300":"text-rose-300"
  return <article className={"rounded-2xl border p-3 "+tone}>
    <div className="flex items-start justify-between gap-2"><div><p className={"text-[0.5rem] font-black uppercase "+accent}>{build.risk==="High Risk"?"Risky":build.risk}</p><p className="mt-1 text-lg font-black">{build.targetFractional}</p></div><ShieldCheck className={"size-4 "+accent}/></div>
    {build.legs.length?<><div className="mt-2 grid grid-cols-2 gap-1.5"><MiniStat label="Model chance" value={percent(build.modelAllHitProbability,1)}/><MiniStat label="Predicted odds" value={build.referenceProductOdds?.toFixed(2)??"—"}/></div><div className="mt-2 space-y-1.5">{build.legs.map(l=><div key={keyOf(l)} className="flex items-center justify-between gap-2 rounded-lg bg-black/15 px-2 py-1.5"><p className="min-w-0 flex-1 truncate text-[0.5rem] text-white/65">{l.player} · {l.label}</p><span className="shrink-0 font-mono text-[0.48rem] font-black text-white/45">{percent(l.probability)}</span></div>)}</div><button onClick={onUse} className="mt-3 w-full rounded-xl bg-white px-3 py-2 text-[0.58rem] font-black text-[#07120e]">Add this slip</button></>:<p className="mt-2 text-[0.54rem] text-white/30">No strong route available yet.</p>}
  </article>
}
function MiniStat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/20 px-2 py-1.5"><p className="font-mono text-xs font-black">{value}</p><p className="text-[0.4rem] uppercase text-white/25">{label}</p></div>}

function SelectionRow({row,selected,onToggle,rank}:{row:Selection;selected:boolean;onToggle:()=>void;rank:number}){
  const exact=row.bookmakerOdds!=null
  return <button onClick={onToggle} className={"grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 text-left transition "+(rank>1?"border-t border-white/[0.055] ":"")+(selected?"bg-emerald-400/[0.08]":"hover:bg-white/[0.025]")}>
    <span className={"flex size-7 items-center justify-center rounded-full text-[0.56rem] font-black "+(rank<=3?"bg-emerald-400/12 text-emerald-300":"bg-white/5 text-white/30")}>{rank}</span>
    <div className="min-w-0"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-black">{row.player}</p>{selected?<BadgeCheck className="size-3.5 shrink-0 text-emerald-300"/>:null}</div><p className="mt-0.5 truncate text-[0.54rem] font-bold text-white/55">{row.label}</p><p className="mt-0.5 truncate text-[0.46rem] text-white/25">{row.team} · Grade {row.confidence}{row.liveAdjusted?" · live count "+(row.currentCount??0):row.edge!=null?" · "+(row.edge>=0?"+":"")+(row.edge*100).toFixed(1)+"pp vs price":""}</p></div>
    <div className="min-w-[4.5rem] text-right"><p className="font-mono text-base font-black">{percent(row.probability)}</p><p className="text-[0.42rem] text-white/25">{exact?(row.bookmakerOdds!.toFixed(2)+" "+(row.bookmakerName??"book")):((row.fairOdds?.toFixed(2)??"—")+(row.liveAdjusted?" live fair":" fair"))}</p><span className={"mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+(selected?"bg-emerald-300 text-emerald-950":"bg-white/6 text-white/30")}>{selected?<X className="size-2.5"/>:<CirclePlus className="size-2.5"/>}{selected?"REMOVE":"ADD"}</span></div>
  </button>
}

function BuilderTray({rows,referenceProduct,modelProduct,risk,open,setOpen,onRemove,onClear}:{rows:Selection[];referenceProduct:number;modelProduct:number;risk:"Safe"|"Balanced"|"Risky";open:boolean;setOpen:(v:boolean)=>void;onRemove:(r:Selection)=>void;onClear:()=>void}){
  return <div className="fixed inset-x-0 bottom-[4.85rem] z-40 px-3">
    <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-300/20 bg-[#0d1d17]/98 shadow-2xl backdrop-blur-xl">
      {open?<div className="max-h-[46vh] overflow-y-auto border-b border-white/8 p-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-sm font-black">Your builder</p><button onClick={onClear} className="flex items-center gap-1 text-[0.5rem] font-black text-rose-300"><Trash2 className="size-3"/>CLEAR</button></div>
        <div className="space-y-1.5">{rows.map(row=><div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.045] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-black">{row.player} · {row.label}</p><p className="text-[0.44rem] text-white/25">{percent(row.probability)} model · {(row.bookmakerOdds??row.fairOdds)?.toFixed(2)??"—"} {row.bookmakerOdds?"book":"fair"}</p></div><button onClick={()=>onRemove(row)} className="rounded-lg bg-white/6 p-1.5 text-white/35"><X className="size-3"/></button></div>)}</div>
        <p className="mt-2 text-[0.46rem] leading-relaxed text-white/25">Reference odds multiply singles only. Same-game bookmaker Builder pricing can be lower because correlated selections are repriced together.</p>
      </div>:null}
      <button onClick={()=>setOpen(!open)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-left"><div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950"><Target className="size-5"/></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-black">{rows.length} selection{rows.length===1?"":"s"}</p><span className={"rounded-full px-1.5 py-0.5 text-[0.42rem] font-black "+(risk==="Safe"?"bg-emerald-300/15 text-emerald-300":risk==="Balanced"?"bg-amber-300/15 text-amber-200":"bg-rose-300/15 text-rose-200")}>{risk.toUpperCase()}</span></div><p className="mt-0.5 text-[0.5rem] text-white/35">Model chance {percent(modelProduct,1)} · tap to {open?"collapse":"review"}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{referenceProduct.toFixed(2)}</p><p className="text-[0.4rem] uppercase text-white/25">predicted odds</p></div></button>
    </div>
  </div>
}
