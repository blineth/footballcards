"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, BadgeCheck, CirclePlus, Clock3, RefreshCw, ShieldCheck, Sparkles, Target, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { addTrackedBet } from "@/lib/tracked-bets"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available"|"unavailable"|"unknown"
type MarketKey = "goal1"|"assist1"|"foul1"|"foul2"|"foul3"|"foul4"|"foul5"|"fouled1"|"card"|"shot1"|"shot2"|"sot1"|"sot2"
type Category = "popular"|"goals"|"assists"|"shots"|"sot"|"fouls"|"fouled"|"cards"

type Fixture={id:string;date:string;kickoff:string;competition:Competition;home:string;away:string;homeCrest?:string;awayCrest?:string}

type ScoreMarket={
  key:MarketKey;label:string;probability:number;fairOdds:number|null;confidence:"A"|"B"|"C"|"D";
  bookmakerOdds:number|null;bookmakerName:string|null;edge:number|null;expectedValue:number|null;
  recent5HitRate:number;seasonHitRate:number;h2hHitRate:number|null;recommendationScore?:number;reasons:string[]
}
type YellowConditional={matches:number;yellows:number;rate:number|null}
type YellowConditionals={
  overall:YellowConditional;zeroFouls:YellowConditional;exactly1Foul:YellowConditional;exactly2Fouls:YellowConditional;
  threePlusFouls:YellowConditional;after1PlusFouls:YellowConditional;after2PlusFouls:YellowConditional;after3PlusFouls:YellowConditional
}
type ScorePlayer={
  name:string;dbName?:string;team:string;position?:string|null;expectedMinutes?:number;
  markets?:Partial<Record<MarketKey,ScoreMarket>>;yellowConditionals?:YellowConditionals
}
type Selection={
  id:string;player:string;team:string;market:string;label:string;probability:number;fairOdds:number|null;
  bookmakerOdds:number|null;bookmakerName?:string|null;edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;
  currentCount?:number|null;liveAdjusted?:boolean;yellowConditionals?:YellowConditionals;position?:string|null;recommendationScore?:number;
  tackles?:number;interceptions?:number;blocks?:number;duelsTotal?:number;duelsWon?:number;defensiveInterventions?:number
}
type LivePlayerStat={
  player:string;team:string;minutes:number|null;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;assists:number;yellowCards:number;redCards:number;subbedOff:boolean;
  tackles:number;interceptions:number;blocks:number;duelsTotal:number;duelsWon:number;defensiveInterventions:number
}
type LiveData={
  ok:boolean;source:string|null;status:"scheduled"|"live"|"halftime"|"finished"|"unknown";elapsed:number;
  score:{home:number|null;away:number|null};players:LivePlayerStat[];updatedAt:string
}
type LiveOddSelection={kind:string;label:string;odd:number|null;bookmaker?:string|null;noVigProbability?:number|null}
type AvailableBet={
  market:string;kind:string;label:string;odd:number;bookmaker:string;
  probability:number|null;probabilityBasis:"no-vig"|"implied";line?:number|null;side?:string|null
}
type LiveOddsData={
  connected?:boolean;bookmaker?:string|null;source?:string|null;capturedAt?:string|null;
  priceAvailable?:boolean;liveVerified?:boolean;selections?:LiveOddSelection[];note?:string|null;
  marketAvailability?:Record<string,MarketStatus>;bookmakerAvailability?:Record<string,Record<string,MarketStatus>>;
  availableBets?:AvailableBet[]
}
type H2HMeeting={
  date:string;competition?:string|null;home:string;away:string;homeGoals:number;awayGoals:number;
  scorers:Array<{player:string;team:string;goals:number;assists:number}>;
  bookings:Array<{player:string;team:string;yellow:boolean;red:boolean;minute?:number|null;second?:number|null;clock?:string|null;detail?:string|null}>;
  players:Array<{player:string;team:string;minutes:number;goals:number;assists:number;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;yellow:boolean;red:boolean}>;
  totals:{home:{yellow:number;red:number;fouls:number;shots:number;sot:number};away:{yellow:number;red:number;fouls:number;shots:number;sot:number}}
}
type H2HData={ok:boolean;source?:string;scope?:string;meetings:H2HMeeting[];count:number;error?:string}
type RiskBuilder={
  id:string;title:string;risk:"Safe"|"Balanced"|"High Risk";targetFractional:string;targetDecimal:number;
  legs:Selection[];referenceProductOdds:number|null;averageLegProbability:number|null;minimumLegProbability:number|null;
  modelAllHitProbability:number|null;conservativeAllHitProbability?:number|null;safetyScore?:number|null;exactPriced:boolean;bookmaker:string|null;
  verifiedBet365LegPrices?:boolean;exactBet365BuilderPrice?:boolean;pricingBasis?:"bet365_singles_product"|"none";note:string
}
type FallbackSlip={id:string;title:string;risk:string;legs:Selection[];averageLegProbability:number|null;note?:string}
type TrackDraft={title:string;fixture:string;legs:Selection[];modelProbability:number|null;suggestedProduct:number|null}
type Scorecard={
  ok:boolean;lineupsConfirmed?:boolean;lineupMode?:"confirmed"|"predicted"|"squad";lineupSource?:string|null;predictedLineups?:any;
  snapshotFallback?:boolean;fallbackReason?:string|null;
  bookmaker?:string|null;oddsSource?:string|null;oddsCapturedAt?:string|null;oddsAgeSeconds?:number|null;priceAvailable?:boolean;
  oddsFreshness?:"LIVE"|"SLIGHTLY STALE"|"CACHED"|"STALE"|"UNKNOWN";players?:ScorePlayer[];
  slips?:FallbackSlip[];riskBuilders?:RiskBuilder[];foulCardBuilders?:RiskBuilder[];eligibleBooks?:string[];
  marketAvailability?:Record<string,MarketStatus>;bookmakerAvailability?:Record<string,Record<string,MarketStatus>>;
  availableBets?:AvailableBet[];
  referee?:{name?:string;yellowsPerGame?:number|null}|null;error?:string
}

const categories:{id:Category;label:string;markets:MarketKey[]}[]=[
  {id:"popular",label:"Most likely",markets:["goal1","assist1","shot1","sot1","foul1","fouled1","card"]},
  {id:"goals",label:"Goals",markets:["goal1"]},
  {id:"assists",label:"Assists",markets:["assist1"]},
  {id:"shots",label:"Shots",markets:["shot1","shot2"]},
  {id:"sot",label:"SOT",markets:["sot1","sot2"]},
  {id:"fouls",label:"Fouls",markets:["foul1","foul2","foul3","foul4","foul5"]},
  {id:"fouled",label:"Fouled",markets:["fouled1"]},
  {id:"cards",label:"Cards",markets:["card"]},
]

function percent(v:number|null|undefined,digits=0){return v==null?"—":(Number(v)*100).toFixed(digits)+"%"}
const TEAM_CODES:Record<string,string>={
  england:"ENG",spain:"ESP",germany:"GER",france:"FRA",italy:"ITA",portugal:"POR",netherlands:"NED",
  belgium:"BEL",brazil:"BRA",argentina:"ARG",croatia:"CRO",denmark:"DEN",sweden:"SWE",norway:"NOR",
  finland:"FIN",albania:"ALB","san marino":"SMR",belarus:"BLR",scotland:"SCO",wales:"WAL",
  ireland:"IRL","northern ireland":"NIR",poland:"POL",switzerland:"SUI",austria:"AUT",turkey:"TUR",turkiye:"TUR",
  greece:"GRE",serbia:"SRB","czech republic":"CZE",czechia:"CZE",slovakia:"SVK",slovenia:"SVN",
  ukraine:"UKR",romania:"ROU",hungary:"HUN",georgia:"GEO",iceland:"ISL","bosnia and herzegovina":"BIH",
  montenegro:"MNE","north macedonia":"MKD",kosovo:"KOS",israel:"ISR",mexico:"MEX",usa:"USA",
  "united states":"USA",canada:"CAN",japan:"JPN","south korea":"KOR",australia:"AUS"
}
function teamNorm(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function sameTeamName(a:string,b:string){
  const x=teamNorm(a).replace(/\b(afc|fc)\b/g,"").trim()
  const y=teamNorm(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function teamCode(team:string){
  const n=teamNorm(team)
  if(TEAM_CODES[n])return TEAM_CODES[n]
  const words=n.split(" ").filter(Boolean)
  if(words.length>=2)return (words[0].slice(0,1)+words[1].slice(0,2)).toUpperCase()
  return n.slice(0,3).toUpperCase()
}
function TeamBadge({team,fixture}:{team:string;fixture:Fixture}){
  const crest=sameTeamName(team,fixture.home)?fixture.homeCrest:sameTeamName(team,fixture.away)?fixture.awayCrest:undefined
  const code=teamCode(team)
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.055] px-1.5 py-0.5 text-[0.42rem] font-black text-white/65">
    {crest?<img src={crest} alt="" className="size-3.5 rounded-full object-contain"/>:<span className="grid size-3.5 place-items-center rounded-full bg-white/10 text-[0.34rem]">{code.slice(0,2)}</span>}
    <span>{code}</span>
  </span>
}
function fractionalOdds(decimal:number|null|undefined){
  if(decimal==null||!Number.isFinite(decimal)||decimal<=1)return "—"
  const target=decimal-1
  const common:Array<[number,number]>=[
    [1,10],[1,8],[1,6],[1,5],[1,4],[2,7],[1,3],[2,5],[4,9],[1,2],[4,7],[8,13],[4,6],[8,11],[4,5],[5,6],[10,11],
    [1,1],[11,10],[6,5],[5,4],[11,8],[3,2],[13,8],[7,4],[15,8],[2,1],[9,4],[5,2],[11,4],[3,1],[10,3],[7,2],[15,4],[4,1],[9,2],[5,1],[11,2],[6,1],[7,1],[8,1],[9,1],[10,1],[12,1],[14,1],[16,1],[20,1],[25,1],[33,1],[40,1],[50,1]
  ]
  if(target>20)return Math.round(target)+"/1"
  let best=common[0],diff=Infinity
  for(const pair of common){
    const d=Math.abs(pair[0]/pair[1]-target)
    if(d<diff){best=pair;diff=d}
  }
  return best[0]===best[1]?"EVS":best[0]+"/"+best[1]
}
type Traffic="high"|"average"|"low"
function marketFloors(market:string){
  if(market==="card")return {green:.20,amber:.14}
  if(market==="goal1")return {green:.32,amber:.18}
  if(market==="assist1")return {green:.24,amber:.14}
  if(market==="shot1")return {green:.72,amber:.48}
  if(market==="shot2")return {green:.48,amber:.28}
  if(market==="sot1")return {green:.42,amber:.25}
  if(market==="sot2")return {green:.20,amber:.10}
  if(market==="foul1")return {green:.68,amber:.48}
  if(market==="foul2")return {green:.42,amber:.24}
  if(market==="foul3")return {green:.20,amber:.10}
  if(market==="foul4")return {green:.10,amber:.05}
  if(market==="foul5")return {green:.055,amber:.025}
  if(market==="fouled1")return {green:.62,amber:.42}
  return {green:.55,amber:.30}
}
function quantile(values:number[],q:number){
  if(!values.length)return 0
  const sorted=[...values].sort((a,b)=>a-b)
  const pos=(sorted.length-1)*q
  const lo=Math.floor(pos),hi=Math.ceil(pos)
  if(lo===hi)return sorted[lo]
  const w=pos-lo
  return sorted[lo]*(1-w)+sorted[hi]*w
}
function trafficFor(row:Selection,all:Selection[]):Traffic{
  const peers=all.filter(x=>x.market===row.market).map(x=>x.probability).filter(Number.isFinite)
  const floors=marketFloors(row.market)
  const greenCut=Math.max(floors.green,quantile(peers,.75))
  const amberCut=Math.max(floors.amber,quantile(peers,.40))
  if(row.probability>=greenCut)return "high"
  if(row.probability>=amberCut)return "average"
  return "low"
}
function parseFixture():Fixture|null{
  if(typeof window==="undefined")return null
  const p=new URLSearchParams(window.location.search)
  const id=p.get("id")??"",date=p.get("date")??"",kickoff=p.get("kickoff")??""
  const competition=(p.get("competition")??"") as Competition,home=p.get("home")??"",away=p.get("away")??""
  const homeCrest=p.get("homeCrest")??"",awayCrest=p.get("awayCrest")??""
  return id&&date&&competition&&home&&away?{id,date,kickoff,competition,home,away,homeCrest,awayCrest}:null
}
function scorecardUrl(f:Fixture,force=false){const q=new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition});if(force)q.set("refresh",String(Date.now()));return "/api/fixture-scorecard?"+q}
function time(kickoff:string){return kickoff?new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff)):""}
function keyOf(s:Pick<Selection,"player"|"market"|"label">){return [s.player,s.market,s.label].join("|").toLowerCase()}
function verifiedBet365Odd(s:Selection){
  return s.bookmakerName==="Bet365"&&s.bookmakerOdds!=null&&Number(s.bookmakerOdds)>1?Number(s.bookmakerOdds):null
}
function referenceOdd(s:Selection){return Number(verifiedBet365Odd(s)??0)}
function liveUrl(f:Fixture){return "/api/live-player-stats?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})}
function lineupStatusUrl(f:Fixture){return "/api/lineup-status?"+new URLSearchParams({id:f.id,date:f.date,home:f.home,away:f.away,competition:f.competition})}
function liveOddsUrl(f:Fixture){return "/api/bet-builder-odds?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition,live:"1",refresh:String(Date.now())})}
function h2hUrl(f:Fixture){return "/api/team-h2h?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})}
function normPlayer(v:string){return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function thresholdForMarket(m:string){
  if(m==="card"||m.startsWith("goal"))return 1
  const hit=m.match(/(\d+)$/);return hit?Number(hit[1]):1
}
function countForMarket(stat:LivePlayerStat,m:string){
  if(m.startsWith("goal"))return stat.goals
  if(m.startsWith("assist"))return stat.assists
  if(m==="card")return stat.yellowCards+stat.redCards
  if(m.startsWith("fouled"))return stat.foulsDrawn
  if(m.startsWith("foul"))return stat.foulsCommitted
  if(m.startsWith("sot"))return stat.shotsOnTarget
  if(m.startsWith("shot"))return stat.shots
  return 0
}
function familyOneMarket(m:string){
  if(m.startsWith("goal"))return "goal1"
  if(m.startsWith("assist"))return "assist1"
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
function applyLive(rows:Selection[],live:LiveData|null,scorecard:Scorecard|null=null){
  if(!live||!(live.status==="live"||live.status==="halftime")||!live.players?.length)return rows
  const stats=new Map(live.players.map(p=>[normPlayer(p.player),p]))
  const oneProb=new Map<string,number>()
  for(const row of rows){
    if(row.market!==familyOneMarket(row.market))continue
    oneProb.set(normPlayer(row.player)+"|"+familyOneMarket(row.market),row.probability)
  }
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,live.elapsed)))/96))
  const adjusted:Selection[]=[]
  const logit=(p:number)=>Math.log(Math.max(.001,Math.min(.999,p))/(1-Math.max(.001,Math.min(.999,p))))
  const logistic=(x:number)=>1/(1+Math.exp(-x))
  const defensivePressure=(stat:LivePlayerStat,position?:string|null)=>{
    const pos=String(position??"").toLowerCase()
    const role=pos.includes("def")?1.08:pos.includes("mid")?1.04:pos.includes("forward")||pos.includes("att")?.88:pos.includes("goal")?.45:1
    const raw=Number(stat.tackles??0)*.07+Number(stat.interceptions??0)*.045+Number(stat.blocks??0)*.025+
      Number(stat.duelsTotal??0)*.009+Number(stat.duelsWon??0)*.006+Number(stat.defensiveInterventions??0)*.025
    return Math.max(0,Math.min(.48,raw*role))
  }
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
    let liveReason=""
    if(row.market==="card"){
      probability=remainingOneProbability(base,live.elapsed)
      const fouls=Math.max(0,Number(stat.foulsCommitted??0))
      const yc=row.yellowConditionals
      const conditional=fouls>=3?yc?.after3PlusFouls:fouls>=2?yc?.after2PlusFouls:fouls>=1?yc?.after1PlusFouls:null
      const overall=yc?.overall?.rate
      if(fouls>0){
        let delta=Math.min(.65,.14*fouls)
        if(conditional?.rate!=null&&overall!=null&&conditional.matches>=2){
          const reliability=Math.min(1,conditional.matches/10)
          const observedDelta=logit(Number(conditional.rate))-logit(Math.max(.02,Number(overall)))
          delta=Math.max(-.10,Math.min(.90,observedDelta*.72*reliability+.10*fouls))
          liveReason=`${fouls} foul${fouls===1?"":"s"} already committed · historical booking rate after this foul load ${Math.round(Number(conditional.rate)*100)}% (${conditional.matches} matches)`
        }else{
          liveReason=`${fouls} foul${fouls===1?"":"s"} already committed · live foul-pressure uplift applied`
        }
        probability=logistic(logit(probability)+delta)
      }
      const pressure=defensivePressure(stat,row.position)
      if(pressure>0){
        const cardPressure=Math.min(.30,pressure*.55)
        probability=logistic(logit(probability)+cardPressure)
        liveReason+=(liveReason?" · ":"")+"defensive workload "+Number(stat.tackles??0)+" tackles, "+Number(stat.interceptions??0)+" interceptions, "+Number(stat.duelsTotal??0)+" duels"
      }
      const refYellows=Number(scorecard?.referee?.yellowsPerGame??0)
      if(refYellows>0){
        probability=logistic(logit(probability)+Math.max(-.18,Math.min(.22,(refYellows-4.2)*.055)))
        liveReason+=(liveReason?" · ":"")+scorecard?.referee?.name+" "+refYellows.toFixed(1)+" yellows/game"
      }
      probability=Math.max(.001,Math.min(.95,probability))
    }else if(row.market.startsWith("goal")||row.market.startsWith("assist")){
      probability=remainingOneProbability(base,live.elapsed)
    }else{
      const lambdaFull=-Math.log(1-Math.max(.001,Math.min(.995,base)))
      probability=poissonAtLeast(lambdaFull*remaining,need)
      if(row.market.startsWith("foul")&&!row.market.startsWith("fouled")){
        const pressure=defensivePressure(stat,row.position)
        if(pressure>0){
          probability=logistic(logit(probability)+pressure)
          liveReason=`Defensive workload: ${Number(stat.tackles??0)} tackles · ${Number(stat.interceptions??0)} interceptions · ${Number(stat.blocks??0)} blocks · ${Number(stat.duelsTotal??0)} duels; future foul probability increased`
        }
      }
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
      tackles:Number(stat.tackles??0),interceptions:Number(stat.interceptions??0),blocks:Number(stat.blocks??0),
      duelsTotal:Number(stat.duelsTotal??0),duelsWon:Number(stat.duelsWon??0),defensiveInterventions:Number(stat.defensiveInterventions??0),
      reason:liveReason||`Live: ${current} already recorded; ${Math.round(probability*100)}% model chance of reaching ${row.label} from ${live.elapsed}'`,
    })
  }
  return adjusted
}
function marketKindForAvailability(m:string){
  if(m.startsWith("goal"))return "goal"
  if(m.startsWith("assist"))return "assist"
  if(m.startsWith("fouled"))return "fouled"
  if(m.startsWith("foul"))return "foul"
  if(m==="card")return "card"
  if(m.startsWith("sot"))return "sot"
  if(m.startsWith("shot"))return "shot"
  return ""
}
function marketLabel(kind:string){
  if(kind==="goal")return "Goalscorer"
  if(kind==="assist")return "Assists"
  if(kind==="card")return "Player cards"
  if(kind==="foul")return "Player fouls committed"
  if(kind==="fouled")return "Player fouled"
  if(kind==="shot")return "Player shots"
  if(kind==="sot")return "Player shots on target"
  return kind
}
function liveKindForMarket(m:string){
  if(m.startsWith("goal"))return "goal"
  if(m.startsWith("assist"))return "assist"
  if(m.startsWith("fouled"))return "fouled"
  if(m.startsWith("foul"))return "foul"
  if(m==="card")return "card"
  if(m.startsWith("sot"))return "sot"
  if(m.startsWith("shot"))return "shot"
  return ""
}
function liveOddThreshold(label:string){
  const hit=String(label??"").match(/(\d+)\s*\+/)
  return hit?Number(hit[1]):1
}
function sameLivePlayer(a:string,b:string){
  const x=normPlayer(a),y=normPlayer(b)
  if(!x||!y)return false
  if(x===y)return true
  const xt=x.split(" "),yt=y.split(" ")
  return xt.length>1&&yt.length>1&&xt[xt.length-1]===yt[yt.length-1]&&(x.includes(yt[0])||y.includes(xt[0]))
}
function overlayVerifiedLiveBet365(rows:Selection[],odds:LiveOddsData|null){
  if(!odds?.priceAvailable||odds.liveVerified!==true||odds.bookmaker!=="Bet365"||odds.source!=="Odds-API.io")return rows
  const captured=odds.capturedAt?new Date(odds.capturedAt).getTime():Number.NaN
  if(!Number.isFinite(captured)||Date.now()-captured>45_000)return rows
  const selections=Array.isArray(odds.selections)?odds.selections:[]
  return rows.map(row=>{
    const kind=liveKindForMarket(row.market)
    const threshold=thresholdForMarket(row.market)
    const match=selections.find(sel=>{
      if(sel.bookmaker!=="Bet365"||sel.kind!==kind||!sel.odd||Number(sel.odd)<=1)return false
      const label=String(sel.label??"")
      const playerPart=label.split("·")[0]?.trim()??""
      return sameLivePlayer(playerPart,row.player)&&liveOddThreshold(label)===threshold
    })
    if(!match)return {...row,bookmakerOdds:null,bookmakerName:null,edge:null}
    const price=Number(match.odd)
    return {
      ...row,
      bookmakerOdds:price,
      bookmakerName:"Bet365",
      edge:Math.round((row.probability-1/price)*1000)/1000,
    }
  })
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
      const row:Selection={id:"",player:p.name,team:p.team,market:m.key,label:m.label,probability:m.probability,fairOdds:m.fairOdds,bookmakerOdds:m.bookmakerOdds,bookmakerName:m.bookmakerName,edge:m.edge,confidence:m.confidence,reason:m.reasons?.[0]??"Player history and current matchup model",yellowConditionals:p.yellowConditionals,position:p.position,recommendationScore:m.recommendationScore}
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

function boardSelectionFamily(kind:string){
  if(["result","double-chance","draw-no-bet"].includes(kind))return "result"
  if(["total-goals","team-goals","first-team-score"].includes(kind))return "goals"
  if(["corners","corners-handicap"].includes(kind))return "corners"
  if(kind==="btts")return "btts"
  if(kind==="bookings")return "bookings"
  if(kind==="goal")return "scorer"
  return kind
}
function broadBetToSelection(bet:AvailableBet,fixture:Fixture):Selection{
  const p=Math.max(.001,Math.min(.999,Number(bet.probability??(1/Math.max(1.01,bet.odd)))))
  return {
    id:["board",bet.kind,bet.label].join("|").toLowerCase(),
    player:"",team:fixture.home+" v "+fixture.away,market:"board:"+bet.kind,label:bet.label,
    probability:p,fairOdds:Math.round((1/p)*1000)/1000,bookmakerOdds:Number(bet.odd),bookmakerName:"Bet365",
    edge:null,confidence:p>=.72?"A":p>=.58?"B":p>=.45?"C":"D",
    reason:bet.probabilityBasis==="no-vig"?"Verified Bet365 market · de-vigged market probability":"Verified Bet365 market · bookmaker implied probability",
  }
}
function buildBroadTargetBuilders(rows:Selection[]):RiskBuilder[]{
  const configs=[
    {id:"broad-safe-3-1",title:"Safe 3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4,minP:.46,max:6},
    {id:"broad-balanced-10-1",title:"Balanced 10/1",risk:"Balanced" as const,targetFractional:"10/1",targetDecimal:11,minP:.24,max:7},
    {id:"broad-high-20-1",title:"High Risk 20/1+",risk:"High Risk" as const,targetFractional:"20/1+",targetDecimal:21,minP:.13,max:8},
  ]
  const candidates=rows
    .filter(r=>verifiedBet365Odd(r)!=null&&r.probability>0&&Number(r.bookmakerOdds)<8&&Number(r.bookmakerOdds)>=1.12)
    .sort((a,b)=>b.probability-a.probability)
  return configs.map(cfg=>{
    type State={legs:Selection[];product:number;prob:number;families:Set<string>}
    let states:State[]=[{legs:[],product:1,prob:1,families:new Set()}]
    for(const row of candidates.filter(r=>r.probability>=cfg.minP)){
      const family=row.market.startsWith("board:")?boardSelectionFamily(row.market.slice(6)):row.market.startsWith("goal")?"scorer":row.market.startsWith("foul")||row.market==="card"?"discipline":row.market
      const next=[...states]
      for(const state of states){
        if(state.legs.length>=cfg.max||state.families.has(family))continue
        const odd=Number(verifiedBet365Odd(row))
        const product=state.product*odd
        if(product>cfg.targetDecimal*1.55&&state.legs.length>=1)continue
        next.push({
          legs:[...state.legs,row],product,prob:state.prob*row.probability,
          families:new Set([...state.families,family]),
        })
      }
      states=next.sort((a,b)=>{
        const ag=a.product>=cfg.targetDecimal,bg=b.product>=cfg.targetDecimal
        if(ag!==bg)return ag?-1:1
        if(ag&&bg&&Math.abs(a.prob-b.prob)>.002)return b.prob-a.prob
        const ad=Math.abs(Math.log(Math.max(1.01,a.product))-Math.log(cfg.targetDecimal))
        const bd=Math.abs(Math.log(Math.max(1.01,b.product))-Math.log(cfg.targetDecimal))
        return ad-bd
      }).slice(0,900)
    }
    const best=states.filter(s=>s.legs.length>=2&&s.product>=cfg.targetDecimal)
      .sort((a,b)=>Math.abs(a.prob-b.prob)>.002?b.prob-a.prob:Math.abs(a.product-cfg.targetDecimal)-Math.abs(b.product-cfg.targetDecimal))[0]
    if(!best)return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,modelAllHitProbability:null,
      conservativeAllHitProbability:null,safetyScore:null,exactPriced:false,bookmaker:"Bet365",
      verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:"Bet365 has markets available, but there is not a strong enough verified route to this target yet."
    }
    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:best.legs,referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:best.legs.reduce((s,x)=>s+x.probability,0)/best.legs.length,
      minimumLegProbability:Math.min(...best.legs.map(x=>x.probability)),
      modelAllHitProbability:best.prob,conservativeAllHitProbability:best.prob,safetyScore:best.prob,
      exactPriced:true,bookmaker:"Bet365",verifiedBet365LegPrices:true,exactBet365BuilderPrice:false,
      pricingBasis:"bet365_singles_product" as const,
      note:"Uses only currently verified Bet365 BTTS and player-prop markets. Match-level BTTS uses de-vigged Bet365 probability where Match Edge has no independent model. The final Bet Builder price can differ because of correlation."
    }
  })
}
function clientRiskBuilders(rows:Selection[],strictVerifiedLive=false):RiskBuilder[]{
  const configs=[
    {id:"safe-3-1",title:"Safe 3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4,min:.40,max:8,minFamilies:1,maxPerFamily:8},
    {id:"balanced-10-1",title:"Balanced 10/1",risk:"Balanced" as const,targetFractional:"10/1",targetDecimal:11,min:.15,max:9,minFamilies:1,maxPerFamily:9},
    {id:"high-20-1",title:"High Risk 20/1+",risk:"High Risk" as const,targetFractional:"20/1+",targetDecimal:21,min:.09,max:10,minFamilies:1,maxPerFamily:10},
  ]
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const baseMarket=(market:string)=>market==="goal1"||market==="assist1"||market==="foul1"||market==="fouled1"||market==="card"||market==="shot1"||market==="sot1"
  const confidenceReliability=(row:Selection)=>row.confidence==="A"?1:row.confidence==="B"?.96:row.confidence==="C"?.88:.74
  const marketReliability=(row:Selection)=>{
    const f=family(row.market)
    if(f==="foul")return .99
    if(f==="fouled")return .985
    if(f==="shot")return .98
    if(f==="sot")return .95
    if(f==="card")return .93
    if(f==="goal")return .92
    if(f==="assist")return .90
    return .95
  }
  const conservativeJoint=(legs:Selection[],raw:number)=>{
    const counts:Record<string,number>={}
    let reliability=1
    for(const leg of legs){
      const f=family(leg.market)
      counts[f]=(counts[f]??0)+1
      reliability*=confidenceReliability(leg)*marketReliability(leg)
    }
    let concentration=1
    for(const count of Object.values(counts))if(count>1)concentration*=Math.pow(.965,count-1)
    return Math.max(0,Math.min(.99,raw*reliability*concentration*Math.pow(.985,Math.max(0,legs.length-2))))
  }

  function buildOne(cfg:(typeof configs)[number],verifiedOnly:boolean):RiskBuilder{
    const preferred=new Map<string,{family:string;score:number}>()
    const playerNames=[...new Set(rows.map(r=>normPlayer(r.player)))]
    for(const player of playerNames){
      const options=rows.filter(r=>
        normPlayer(r.player)===player&&baseMarket(r.market)&&r.confidence!=="D"&&
        (verifiedOnly?verifiedBet365Odd(r)!=null:Number(r.fairOdds??0)>1)
      ).map(r=>{
        const t=trafficFor(r,rows)
        const trafficScore=t==="high"?1:t==="average"?.58:.18
        const modelScore=r.market==="card"?Number(r.recommendationScore??r.probability):r.probability
        const rankScore=trafficScore+modelScore*.22+Math.max(0,r.edge??0)*.15
        return {family:family(r.market),score:rankScore}
      }).sort((a,b)=>b.score-a.score)
      if(options[0])preferred.set(player,options[0])
    }

    const allCandidateRows=rows
      .filter(r=>r.confidence!=="D"&&(verifiedOnly?verifiedBet365Odd(r)!=null:Number(r.fairOdds??0)>1))
      .filter(r=>r.market!=="card"||Number(r.recommendationScore??r.probability)>=.145)
      .map(r=>({row:r,family:family(r.market),signal:preferred.get(normPlayer(r.player))?.score??0}))
      .sort((a,b)=>{
        const ap=a.row.market==="card"?Number(a.row.recommendationScore??a.row.probability):a.row.probability
        const bp=b.row.market==="card"?Number(b.row.recommendationScore??b.row.probability):b.row.probability
        return (bp-ap)||
        ((baseMarket(a.row.market)?0:1)-(baseMarket(b.row.market)?0:1))||
        (b.signal-a.signal)
      })

    const runSearch=(candidateRows:typeof allCandidateRows)=>{
      // Exact objective: maximise joint hit probability subject to reaching the
      // requested odds. We group by player + market family, so one player may
      // contribute different high-probability events (e.g. 1+ shot and 1+ foul)
      // but never nested thresholds from the same family. This avoids a 9%
      // long-shot leg surviving merely because it reaches the target faster.
      const minLegProbability=cfg.risk==="Safe"?.34:cfg.risk==="Balanced"?.24:.18
      const byPlayerFamily=new Map<string,typeof candidateRows>()
      for(const option of candidateRows){
        if(option.row.probability<Math.max(cfg.min,minLegProbability))continue
        const key=normPlayer(option.row.player)+"|"+option.family
        if(!byPlayerFamily.has(key))byPlayerFamily.set(key,[])
        byPlayerFamily.get(key)!.push(option)
      }

      type State={
        legs:Selection[];product:number;prob:number;conservative:number;
        families:Record<string,number>
      }
      const maxProduct=cfg.targetDecimal*1.45
      const maxLog=Math.log(maxProduct)
      const buckets=700
      const bucketFor=(product:number)=>Math.max(0,Math.min(buckets,Math.round(Math.log(Math.max(1,product))/maxLog*buckets)))

      let states=new Map<number,State>()
      states.set(0,{legs:[],product:1,prob:1,conservative:1,families:{}})

      for(const options of byPlayerFamily.values()){
        const next=new Map(states)
        for(const state of states.values()){
          if(state.legs.length>=cfg.max)continue
          for(const option of options){
            const count=state.families[option.family]??0
            if(count>=cfg.maxPerFamily)continue
            const odd=verifiedOnly?referenceOdd(option.row):Number(option.row.fairOdds??0)
            if(!(odd>1))continue
            const product=state.product*odd
            if(product>maxProduct)continue
            const legs=[...state.legs,option.row]
            const prob=state.prob*option.row.probability
            const candidate:State={
              legs,product,prob,conservative:conservativeJoint(legs,prob),
              families:{...state.families,[option.family]:count+1},
            }
            const bucket=bucketFor(product)
            const existing=next.get(bucket)
            if(!existing||
              candidate.prob>existing.prob+.000001||
              (Math.abs(candidate.prob-existing.prob)<=.000001&&candidate.conservative>existing.conservative)
            )next.set(bucket,candidate)
          }
        }

        // Keep the globally strongest target-reaching states plus the strongest
        // probability state in each odds bucket. This preserves slower, safer
        // routes made from several likely 1+ events.
        const ordered=[...next.entries()].sort(([,a],[,b])=>{
          const aHit=a.product>=cfg.targetDecimal,bHit=b.product>=cfg.targetDecimal
          if(aHit!==bHit)return aHit?-1:1
          if(Math.abs(a.prob-b.prob)>.000001)return b.prob-a.prob
          if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
          return Math.abs(a.product-cfg.targetDecimal)-Math.abs(b.product-cfg.targetDecimal)
        })
        states=new Map(ordered.slice(0,Math.min(900,ordered.length)))
      }

      return [...states.values()]
        .filter(s=>s.legs.length>=2&&s.product>=cfg.targetDecimal&&Object.keys(s.families).length>=cfg.minFamilies)
        .sort((a,b)=>{
          if(Math.abs(a.prob-b.prob)>.000001)return b.prob-a.prob
          if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
          return Math.abs(a.product-cfg.targetDecimal)-Math.abs(b.product-cfg.targetDecimal)
        })[0]
    }

    // Every target first tries only low-threshold 1+ markets across different
    // players. Higher thresholds are fallback-only if the simple lines cannot
    // reach the requested price within the leg cap.
    const baseRows=allCandidateRows.filter(x=>baseMarket(x.row.market))
    let best=runSearch(baseRows)
    if(!best)best=runSearch(allCandidateRows)

    if(!best)return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,
      modelAllHitProbability:null,conservativeAllHitProbability:null,safetyScore:null,
      exactPriced:false,bookmaker:null,verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:verifiedOnly?"No combination of verified Bet365 prices reaches this target yet.":"No model combination reaches this target yet."
    }

    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:best.legs,referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:best.legs.reduce((s,x)=>s+x.probability,0)/best.legs.length,
      minimumLegProbability:Math.min(...best.legs.map(x=>x.probability)),
      modelAllHitProbability:best.prob,conservativeAllHitProbability:best.conservative,safetyScore:best.conservative,
      exactPriced:verifiedOnly,bookmaker:verifiedOnly?"Bet365":null,
      verifiedBet365LegPrices:verifiedOnly,exactBet365BuilderPrice:false,
      pricingBasis:verifiedOnly?"bet365_singles_product" as const:"none" as const,
      note:verifiedOnly
        ?"Every leg uses a verified Bet365 price. The displayed combined number is the product of those Bet365 singles; Bet365 can reprice correlated legs in Bet Builder, so it is not claimed as the final Builder quote."
        :"Model-target route only. The displayed product is derived from model fair odds, not a Bet365 price. Check the actual live Bet365 markets before placing."
    }
  }

  function guaranteedModelTarget(cfg:(typeof configs)[number]):RiskBuilder{
    const pool=[...rows]
      .filter(r=>r.confidence!=="D"&&Number(r.probability)>0&&Number(r.fairOdds??0)>1)
      .filter(r=>r.market!=="card"||Number(r.recommendationScore??r.probability)>=.145)
      .sort((a,b)=>{
        const ap=a.market==="card"?Number(a.recommendationScore??a.probability):a.probability
        const bp=b.market==="card"?Number(b.recommendationScore??b.probability):b.probability
        return bp-ap
      })
    const legs:Selection[]=[]
    const usedPlayers=new Set<string>()
    const familyCounts:Record<string,number>={}
    let product=1
    let raw=1

    for(const row of pool){
      const playerKey=normPlayer(row.player)
      const f=family(row.market)
      if(usedPlayers.has(playerKey))continue
      if((familyCounts[f]??0)>=cfg.maxPerFamily)continue
      // Safe should never be forced by a speculative low-probability leg.
      const floor=cfg.risk==="Safe"?.34:cfg.risk==="Balanced"?.16:.08
      if(row.probability<floor)continue
      legs.push(row)
      usedPlayers.add(playerKey)
      familyCounts[f]=(familyCounts[f]??0)+1
      product*=Number(row.fairOdds)
      raw*=Number(row.probability)
      if(product>=cfg.targetDecimal&&legs.length>=2)break
      if(legs.length>=cfg.max)break
    }

    if(product<cfg.targetDecimal||legs.length<2)return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,
      modelAllHitProbability:null,conservativeAllHitProbability:null,safetyScore:null,
      exactPriced:false,bookmaker:null,verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:"No remaining live model route reaches this target."
    }
    const conservative=conservativeJoint(legs,raw)
    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs,referenceProductOdds:Math.round(product*100)/100,
      averageLegProbability:legs.reduce((s,x)=>s+x.probability,0)/legs.length,
      minimumLegProbability:Math.min(...legs.map(x=>x.probability)),
      modelAllHitProbability:raw,conservativeAllHitProbability:conservative,safetyScore:conservative,
      exactPriced:false,bookmaker:null,verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:"Live probability-first model route. Current match events are removed/adjusted first. This is not a Bet365 price; check the actual Bet365 live builder before placing."
    }
  }

  return configs.map(cfg=>{
    const verified=buildOne(cfg,true)
    if(verified.legs.length)return verified
    return {
      ...verified,
      note:strictVerifiedLive
        ?"Waiting for enough fresh verified Bet365 live player selections to reach this target."
        :"Bet365 does not currently list enough exact player selections/thresholds to build this target. Model-only players are excluded from recommended bets."
    }
  })
}

function scorecardCacheKey(f:Fixture){return "match-edge:scorecard:"+[f.date,f.competition,f.home,f.away].join("|").toLowerCase()}
function readScorecardCache(f:Fixture):Scorecard|null{
  try{
    const raw=window.localStorage.getItem(scorecardCacheKey(f))
    if(!raw)return null
    const parsed=JSON.parse(raw)
    return parsed?.data?.ok?parsed.data as Scorecard:null
  }catch{return null}
}
function writeScorecardCache(f:Fixture,data:Scorecard){
  try{if(data?.ok)window.localStorage.setItem(scorecardCacheKey(f),JSON.stringify({savedAt:new Date().toISOString(),data}))}catch{}
}
export default function BetBuilderPage(){
  const router=useRouter()
  const[fixture,setFixture]=useState<Fixture|null>(null)
  const[data,setData]=useState<Scorecard|null>(null)
  const[live,setLive]=useState<LiveData|null>(null)
  const[liveOdds,setLiveOdds]=useState<LiveOddsData|null>(null)
  const[loading,setLoading]=useState(true)
  const[category,setCategory]=useState<Category>("popular")
  const[selected,setSelected]=useState<Record<string,Selection>>({})
  const[trayOpen,setTrayOpen]=useState(false)
  const[h2hOpen,setH2hOpen]=useState(false)
  const[h2hLoading,setH2hLoading]=useState(false)
  const[h2hData,setH2hData]=useState<H2HData|null>(null)
  const[trackDraft,setTrackDraft]=useState<TrackDraft|null>(null)
  const[builderMode,setBuilderMode]=useState<"all"|"player"|"discipline">("all")

  useEffect(()=>{setFixture(parseFixture())},[])
  const load=useCallback(async(f:Fixture,force=false)=>{
    const kickoff=new Date(f.kickoff).getTime()
    const preMatch=!Number.isFinite(kickoff)||Date.now()<kickoff
    if(!force&&preMatch){
      const cached=readScorecardCache(f)
      if(cached){setData(cached);setLoading(false);return}
    }
    setLoading(true)
    try{
      const r=await fetch(scorecardUrl(f,force),{cache:"no-store"})
      const next=await r.json().catch(()=>({ok:false,error:"Unable to load match model."})) as Scorecard
      setData(next)
      if(preMatch&&next?.ok)writeScorecardCache(f,next)
    }finally{setLoading(false)}
  },[])
  useEffect(()=>{if(fixture)void load(fixture,false)},[fixture,load])
  useEffect(()=>{
    if(!fixture||!(live?.status==="live"||live?.status==="halftime"))return
    const t=window.setInterval(()=>void load(fixture,false),60000)
    return()=>window.clearInterval(t)
  },[fixture,live?.status,load])
  useEffect(()=>{
    if(!fixture||data?.lineupsConfirmed===true||data?.lineupMode==="confirmed")return
    const kickoff=new Date(fixture.kickoff).getTime()
    if(!Number.isFinite(kickoff))return

    const windowStart=kickoff-60*60*1000
    const windowEnd=kickoff-45*60*1000
    let cancelled=false
    let timer:number|undefined
    let interval:number|undefined

    const stop=()=>{
      if(timer!=null)window.clearTimeout(timer)
      if(interval!=null)window.clearInterval(interval)
      timer=undefined
      interval=undefined
    }
    const check=async()=>{
      if(cancelled)return
      const now=Date.now()
      if(now<windowStart||now>windowEnd){if(now>windowEnd)stop();return}
      try{
        const r=await fetch(lineupStatusUrl(fixture),{cache:"no-store"})
        if(!r.ok)return
        const status=await r.json()
        if(status?.confirmed===true){
          stop()
          await load(fixture,true)
        }
      }catch{}
    }
    const begin=()=>{
      if(cancelled)return
      void check()
      interval=window.setInterval(()=>void check(),90000)
    }

    const now=Date.now()
    if(now<windowStart){
      timer=window.setTimeout(begin,Math.max(0,windowStart-now))
    }else if(now<=windowEnd){
      begin()
    }

    return()=>{cancelled=true;stop()}
  },[fixture,data?.lineupsConfirmed,data?.lineupMode,load])

  const loadLive=useCallback(async(f:Fixture)=>{
    const kickoff=new Date(f.kickoff).getTime()
    const now=Date.now()
    if(Number.isFinite(kickoff)&&(now<kickoff-10*60*1000||now>kickoff+4*60*60*1000))return
    try{const r=await fetch(liveUrl(f),{cache:"no-store"});if(r.ok)setLive(await r.json())}catch{}
  },[])
  useEffect(()=>{if(!fixture)return;void loadLive(fixture);const t=window.setInterval(()=>void loadLive(fixture),30000);return()=>window.clearInterval(t)},[fixture,loadLive])
  const loadLiveOdds=useCallback(async(f:Fixture)=>{
    try{
      const r=await fetch(liveOddsUrl(f),{cache:"no-store"})
      if(r.ok)setLiveOdds(await r.json())
    }catch{}
  },[])
  useEffect(()=>{
    if(!fixture||!(live?.status==="live"||live?.status==="halftime")){setLiveOdds(null);return}
    void loadLiveOdds(fixture)
    const t=window.setInterval(()=>void loadLiveOdds(fixture),15000)
    return()=>window.clearInterval(t)
  },[fixture,live?.status,loadLiveOdds])
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
  const liveAdjustedRows=useMemo(()=>applyLive(preMatchRows,live,data),[preMatchRows,live,data])
  const allRows=useMemo(()=>overlayVerifiedLiveBet365(liveAdjustedRows,liveOdds),[liveAdjustedRows,liveOdds])
  const visible=useMemo(()=>{
    const allowed=new Set(categories.find(x=>x.id===category)?.markets??[])
    const rows=allRows.filter(x=>allowed.has(x.market as MarketKey))
    if(category==="cards")return [...rows].sort((a,b)=>{
      const ar=a.liveAdjusted?a.probability:Number(a.recommendationScore??a.probability)
      const br=b.liveAdjusted?b.probability:Number(b.recommendationScore??b.probability)
      return br-ar||b.probability-a.probability
    })
    if(category!=="popular")return [...rows].sort((a,b)=>b.probability-a.probability)

    // Most likely = one strongest action per player. Cards use the evidence score
    // rather than raw probability so a weak 19% card cannot outrank a stronger
    // H2H/current-form card simply because the calibrated percentage is larger.
    const score=(row:Selection)=>{
      const t=trafficFor(row,allRows)
      const traffic=t==="high"?1:t==="average"?.58:.18
      const model=row.market==="card"
        ? (row.liveAdjusted?row.probability:Number(row.recommendationScore??row.probability))
        : row.probability
      return traffic+model*.22+Math.max(0,row.edge??0)*.15
    }
    const best=new Map<string,Selection>()
    for(const row of rows){
      const key=normPlayer(row.player)
      const current=best.get(key)
      if(!current||score(row)>score(current))best.set(key,row)
    }
    return [...best.values()].sort((a,b)=>score(b)-score(a))
  },[allRows,category])
  const liveOddsAge=liveOdds?.capturedAt?Math.max(0,(Date.now()-new Date(liveOdds.capturedAt).getTime())/1000):null
  const liveBet365=Boolean(liveOdds?.priceAvailable&&liveOdds?.liveVerified===true&&liveOdds?.bookmaker==="Bet365"&&liveOdds?.source==="Odds-API.io"&&liveOddsAge!=null&&liveOddsAge<=45)
  const verifiedBet365=Boolean(data?.priceAvailable&&data?.bookmaker==="Bet365"&&data?.oddsSource==="Odds-API.io"&&data?.oddsFreshness!=="STALE"&&data?.oddsFreshness!=="UNKNOWN")
  const serverBuilders=(data?.riskBuilders??[]).filter(x=>x.legs?.length&&x.verifiedBet365LegPrices===true)
  const disciplineServerBuilders=(data?.foulCardBuilders??[]).filter(x=>x.legs?.length&&x.verifiedBet365LegPrices===true)
  const disciplineRows=allRows.filter(r=>r.market==="card"||r.market.startsWith("foul")||r.market.startsWith("fouled"))
  const inPlay=live?.status==="live"||live?.status==="halftime"
  const activeMarketAvailability=inPlay?(liveOdds?.marketAvailability??{}):(data?.marketAvailability??{})
  const bet365MarketStatus=(market:string):MarketStatus=>{
    const kind=marketKindForAvailability(market)
    return kind?(activeMarketAvailability?.[kind]??"unknown"):"unknown"
  }
  const marketKinds=["goal","assist","card","foul","fouled","shot","sot"]
  const unavailableBet365Markets=marketKinds.filter(kind=>activeMarketAvailability?.[kind]==="unavailable")
  const availableBet365Markets=marketKinds.filter(kind=>activeMarketAvailability?.[kind]==="available")
  const activeAvailableBets=(inPlay?(liveOdds?.availableBets??[]):(data?.availableBets??[]))
  const broadRows=useMemo(()=>fixture
    ? activeAvailableBets.filter(b=>b.kind==="btts").map(b=>broadBetToSelection(b,fixture))
    :[],[activeAvailableBets,fixture])
  const verifiedPlayerRows=useMemo(()=>allRows.filter(r=>verifiedBet365Odd(r)!=null),[allRows])
  const broadTargetBuilders=useMemo(()=>buildBroadTargetBuilders([...broadRows,...verifiedPlayerRows]),[broadRows,verifiedPlayerRows])
  const playerBuilders=clientRiskBuilders(allRows,true)
  const disciplineBuilders=clientRiskBuilders(disciplineRows,true)
  const builders=builderMode==="discipline"
    ?disciplineBuilders
    :builderMode==="player"
      ?playerBuilders
      :broadTargetBuilders
  const bestAvailableBets=useMemo(()=>{
    const byFamily=new Map<string,Selection>()
    const candidates=[...broadRows,...verifiedPlayerRows]
      .filter(r=>verifiedBet365Odd(r)!=null&&Number(verifiedBet365Odd(r))>=1.12&&Number(verifiedBet365Odd(r))<=8&&r.probability>=.18)
      .sort((a,b)=>{
        const qa=a.probability*Math.min(1.25,Math.sqrt(Number(verifiedBet365Odd(a)??1)))
        const qb=b.probability*Math.min(1.25,Math.sqrt(Number(verifiedBet365Odd(b)??1)))
        return qb-qa
      })
    for(const row of candidates){
      const family=row.market.startsWith("board:")?boardSelectionFamily(row.market.slice(6)):row.market.startsWith("goal")?"scorer":row.market
      if(!byFamily.has(family))byFamily.set(family,row)
      if(byFamily.size>=6)break
    }
    return [...byFamily.values()]
  },[broadRows,verifiedPlayerRows])
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
  const referenceProduct=selectedRows.length&&selectedRows.every(s=>verifiedBet365Odd(s)!=null)
    ? selectedRows.reduce((p,s)=>p*Number(verifiedBet365Odd(s)),1)
    : null
  const modelProduct=selectedRows.reduce((p,s)=>p*s.probability,1)
  const customRisk=modelProduct>=.25?"Safe":modelProduct>=.09?"Balanced":"Risky"

  if(!fixture)return <main className="min-h-screen bg-[#07120e] px-4 py-10 text-white"><div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><p className="font-black">Choose a match first</p><p className="mt-2 text-sm text-white/40">Open a fixture from Matches to build it.</p><button onClick={()=>router.push("/")} className="mt-5 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-emerald-950">Matches</button></div></main>

  function toggle(row:Selection){
    if(bet365MarketStatus(row.market)==="unavailable"||verifiedBet365Odd(row)==null)return
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
  function trackBuild(build:RiskBuilder){
    setTrackDraft({
      title:build.title,
      fixture:fixture.home+" v "+fixture.away,
      legs:build.legs.map(leg=>({...leg,id:leg.id||keyOf(leg)})),
      modelProbability:build.conservativeAllHitProbability??build.modelAllHitProbability??null,
      suggestedProduct:build.referenceProductOdds,
    })
  }
  function trackCustom(){
    if(!selectedRows.length)return
    setTrackDraft({
      title:"Custom Bet Builder",
      fixture:fixture.home+" v "+fixture.away,
      legs:selectedRows,
      modelProbability:modelProduct,
      suggestedProduct:referenceProduct,
    })
  }

  return <main className="min-h-screen bg-[#07120e] pb-36 text-white">
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07120e]/95 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <button onClick={()=>router.push("/")} className="rounded-xl bg-white/7 p-2.5 text-white/70"><ArrowLeft className="size-4"/></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-emerald-300"><Target className="size-4"/><span className="text-[0.6rem] font-black uppercase tracking-[0.15em]">Match Builder</span></div><h1 className="mt-1 truncate text-xl font-black">{fixture.home} <span className="text-white/25">v</span> {fixture.away}</h1><p className="mt-0.5 text-[0.58rem] text-white/35">{inPlay&&live?<span className="font-black text-rose-300">LIVE {live.elapsed}' · {live.score.home??"-"}-{live.score.away??"-"} · </span>:null}{fixture.competition} · {time(fixture.kickoff)}{!inPlay?<span className="text-white/20"> · cached until refresh</span>:null}</p></div>
          <button onClick={()=>void toggleH2H()} className={"rounded-xl border px-3 py-2.5 text-[0.55rem] font-black "+(h2hOpen?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/10 bg-white/6 text-white/55")}>H2H</button>
          <button onClick={()=>void load(fixture,true)} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {h2hOpen?<H2HPanel data={h2hData} loading={h2hLoading} home={fixture.home} away={fixture.away}/>:null}
      {loading&&!data?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Ranking player markets…</p></section>:null}
      {data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-5"><p className="font-black">Match model unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></section>:null}

      {data?.ok&&data.lineupMode==="predicted"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-5 shrink-0 text-amber-300"/><div><p className="font-black text-amber-100">Predicted XI active</p><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{data.lineupSource??"Probable starters based on recent selection history and minutes."} The page checks for the official XI only between roughly 60 and 45 minutes before kickoff. Once confirmed, anyone benched is removed, all probabilities/slips are rebuilt once, and lineup polling stops for this match.</p></div></div></section>:data?.ok&&data.lineupMode==="squad"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-6 text-center"><Clock3 className="mx-auto size-6 text-amber-300"/><p className="mt-3 font-black">No reliable XI yet</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">The match is still available, but player recommendations need a probable or confirmed starting XI.</p></section>:null}

      {inPlay&&live?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/[0.055] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-rose-200">Live recommendations adapting</p><p className="mt-1 text-[0.58rem] leading-relaxed text-white/40">Settled thresholds are removed automatically. If a player commits their first foul, 1+ disappears and the next available foul line moves up the ranking.</p></div><span className="shrink-0 rounded-full bg-rose-300 px-2 py-1 text-[0.45rem] font-black text-rose-950">{live.elapsed}'</span></div><p className="mt-2 text-[0.46rem] text-white/25">{live.source??"Live feed"} · refreshes every 30 seconds</p></section>:null}

      {(Object.keys(activeMarketAvailability??{}).length>0)?<section className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase tracking-wide text-white/55">Bet365 live market availability</p><p className="mt-1 text-[0.5rem] leading-relaxed text-white/30">Only markets with a verified Bet365 price can be added to a bet or used in target slips. Other markets may still show model analysis, but they are not presented as bets.</p></div><span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/35">{inPlay?"LIVE":"BET365"}</span></div>
        {availableBet365Markets.length?<div className="mt-2"><p className="text-[0.42rem] font-black uppercase text-emerald-300/80">Available</p><div className="mt-1 flex flex-wrap gap-1.5">{availableBet365Markets.map(kind=><span key={kind} className="rounded-full bg-emerald-300/10 px-2 py-1 text-[0.42rem] font-black text-emerald-200">{marketLabel(kind)}</span>)}</div></div>:null}
        {unavailableBet365Markets.length?<div className="mt-2"><p className="text-[0.42rem] font-black uppercase text-rose-300/80">Not available in verified Bet365 feed</p><div className="mt-1 flex flex-wrap gap-1.5">{unavailableBet365Markets.map(kind=><span key={kind} className="rounded-full bg-rose-300/10 px-2 py-1 text-[0.42rem] font-black text-rose-200">{marketLabel(kind)}</span>)}</div></div>:null}
      </section>:null}

      {data?.ok&&(data.lineupMode==="confirmed"||data.lineupMode==="predicted"||data.lineupsConfirmed)?<>
        <section className={"rounded-2xl border px-3 py-2.5 "+(liveBet365?"border-emerald-300/25 bg-emerald-400/[0.07]":verifiedBet365?"border-cyan-300/20 bg-cyan-300/[0.05]":"border-white/8 bg-white/[0.025]")}>
          <div className="flex items-center justify-between gap-3"><div><p className={"text-[0.52rem] font-black uppercase tracking-wide "+(liveBet365?"text-emerald-300":verifiedBet365?"text-cyan-200":"text-white/35")}>{liveBet365?"CONFIRMED LIVE BET365 ODDS":inPlay?"WAITING FOR LIVE BET365 PRICES":verifiedBet365?"VERIFIED BET365 ODDS":"NO VERIFIED BET365 PRICES"}</p><p className="mt-0.5 text-[0.5rem] text-white/30">{liveBet365?"Prices are from the current Odds-API.io Bet365 live feed and are rechecked every 15 seconds.":inPlay?(liveOdds?.note??"Live model probabilities remain visible, but 3/1, 10/1 and 20/1 target cards require fresh verified Bet365 live prices."):verifiedBet365?"Bet365 prices are verified but not inside the live freshness window.":"Model probabilities remain available, but target odds are not shown without Bet365 pricing."}</p></div>{data.oddsFreshness?<span className="rounded-full bg-white/6 px-2 py-1 font-mono text-[0.42rem] font-black text-white/35">{data.oddsFreshness}</span>:null}</div>
        </section>
        {bestAvailableBets.length?<section className="rounded-3xl border border-cyan-300/12 bg-cyan-300/[0.045] p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase tracking-[0.13em] text-cyan-200">Best available Bet365 bets</p><h2 className="mt-1 text-lg font-black">Use what Bet365 actually offers</h2><p className="mt-1 text-[0.56rem] leading-relaxed text-white/35">These are ranked only from markets with a verified Bet365 price. Player bets use the Match Edge model where available; corners and other match markets use de-vigged Bet365 market probability until an independent model is available.</p></div><span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[0.42rem] font-black text-cyan-100">{bestAvailableBets.length} PICKS</span></div>
          <div className="mt-3 space-y-2">{bestAvailableBets.map((row,index)=><div key={row.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-black/20 px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-full bg-cyan-300/10 text-[0.5rem] font-black text-cyan-100">{index+1}</span><div className="min-w-0"><p className="truncate text-xs font-black">{row.label}</p><p className="mt-0.5 truncate text-[0.44rem] text-white/30">{row.market.startsWith("board:")?"Bet365 market consensus":"Match Edge player model"} · verified Bet365</p></div><div className="text-right"><p className="font-mono text-sm font-black text-emerald-200">{Number(row.bookmakerOdds).toFixed(2)}</p><p className="text-[0.42rem] font-black text-white/30">{percent(row.probability)} chance</p></div></div>)}</div>
        </section>:null}

        <section className="rounded-3xl border border-emerald-300/12 bg-gradient-to-br from-emerald-400/[0.09] to-black/25 p-4">
          <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><p className="text-[0.54rem] font-black uppercase tracking-[0.13em]">Suggested Bet365 slips</p></div><h2 className="mt-1 text-lg font-black">{builderMode==="discipline"?"Cards & fouls":builderMode==="player"?"Player markets":"All markets"}</h2><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{builderMode==="discipline"?"Only player cards, fouls committed and fouls drawn are considered.":builderMode==="player"?"Only player props are considered: goals, assists, shots, shots on target, cards, fouls committed and fouls drawn.":inPlay?"Everything Bet365 currently offers can be considered, including match result, goals, BTTS, team goals, corners, bookings and verified player props.":"Everything Bet365 offers can be considered, including result, goals, BTTS, team goals, corners, bookings and all verified player props."}</p></div><span className={"rounded-full px-2 py-1 text-[0.46rem] font-black "+(data.lineupMode==="confirmed"?"bg-emerald-400/10 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{data.lineupMode==="confirmed"?"XI CONFIRMED":"PREDICTED XI"}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button onClick={()=>setBuilderMode("all")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="all"?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/8 bg-white/[0.04] text-white/45")}>ALL MARKETS</button>
            <button onClick={()=>setBuilderMode("player")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="player"?"border-cyan-300/30 bg-cyan-300 text-cyan-950":"border-white/8 bg-white/[0.04] text-white/45")}>PLAYER MARKETS</button>
            <button onClick={()=>setBuilderMode("discipline")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="discipline"?"border-amber-300/30 bg-amber-300 text-amber-950":"border-white/8 bg-white/[0.04] text-white/45")}>CARDS & FOULS</button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">{builders.length?builders.map(b=><RiskCard key={b.id} build={b} liveBet365={liveBet365} inPlay={inPlay} onTrack={()=>trackBuild(b)} onUse={()=>useBuild(b)} fixture={fixture}/>):<div className="sm:col-span-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-center"><p className="text-xs font-black text-white/55">No verified Bet365 target slip available yet</p><p className="mt-1 text-[0.5rem] text-white/25">{builderMode==="discipline"
  ?"Bet365 has not priced enough qualifying card/foul legs to build this target safely."
  :builderMode==="player"
    ?"Bet365 has not priced enough verified player-prop legs to build this target safely."
    :"Bet365 has not priced enough verified BTTS + player-prop markets to build this target safely."}</p></div>}</div>
        </section>

        <section className="space-y-3">
          <div className="px-1"><p className="font-black">Add your own selections</p><p className="mt-1 text-[0.6rem] text-white/35">{inPlay?"Model probabilities are shown for analysis, but you can only add a player line when that exact market has a fresh verified Bet365 live price.":"Choose the market, then tap the player line you want. The strongest probabilities are shown first and your slip updates at the bottom."}</p></div>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"><div className="flex min-w-max gap-2 pb-1">{categories.map(x=><button key={x.id} onClick={()=>setCategory(x.id)} className={"rounded-full border px-3.5 py-2.5 text-xs font-black "+(category===x.id?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/8 bg-white/[0.04] text-white/50")}>{x.label}</button>)}</div></div>

          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
            <div className="border-b border-white/8 px-3 py-2"><div className="flex items-center justify-between gap-3"><p className="text-[0.48rem] font-black uppercase text-white/25">Most likely first</p><p className="text-[0.48rem] font-black uppercase text-white/25">{visible.length} options</p></div><div className="mt-1.5 flex gap-2 text-[0.4rem] font-black uppercase"><span className="text-emerald-300">● High</span><span className="text-amber-200">● Average</span><span className="text-rose-200/80">● Low</span><span className="text-white/20">relative to this market</span></div></div>
            <div>{visible.length?visible.map((row,i)=><SelectionRow key={row.id} row={row} selected={Boolean(selected[row.id])} onToggle={()=>toggle(row)} rank={i+1} traffic={trafficFor(row,allRows)} bestAction={category==="popular"} liveBet365={liveBet365} marketStatus={bet365MarketStatus(row.market)} inPlay={inPlay} fixture={fixture}/>):<p className="px-4 py-8 text-center text-sm text-white/35">No qualifying selections in this market.</p>}</div>
          </div>
        </section>

        {data.snapshotFallback?<section className="rounded-2xl border border-violet-300/15 bg-violet-400/[0.04] p-3 text-[0.58rem] leading-relaxed text-white/40">Snapshot fallback is active. Probabilities are still ranked, but no price is displayed unless a verified Bet365 price is available.</section>:null}
      </>:null}
    </div>

    {selectedRows.length?<BuilderTray rows={selectedRows} referenceProduct={referenceProduct} modelProduct={modelProduct} risk={customRisk} open={trayOpen} setOpen={setTrayOpen} onRemove={row=>toggle(row)} onClear={()=>setSelected({})} onTrack={trackCustom} fixture={fixture}/>:null}
    {trackDraft?<TrackBetModal draft={trackDraft} fixture={fixture} onClose={()=>setTrackDraft(null)} onSaved={()=>{setTrackDraft(null);router.push("/performance")}}/>:null}
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
  const[bookingsOpen,setBookingsOpen]=useState(false)
  const fmt=new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(m.date+"T12:00:00Z"))
  const top=(key:"foulsCommitted"|"foulsDrawn"|"shots"|"shotsOnTarget")=>[...m.players].sort((a,b)=>Number(b[key])-Number(a[key]))[0]??null
  const foulLeader=top("foulsCommitted"),drawnLeader=top("foulsDrawn"),shotLeader=top("shots"),sotLeader=top("shotsOnTarget")
  return <article className="overflow-hidden rounded-3xl border border-white/10 bg-black/25">
    <button onClick={()=>setOpen(v=>!v)} className="w-full px-4 py-4 text-left transition hover:bg-white/[0.025]">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <div><p className="font-mono text-[0.58rem] text-white/35">{fmt}</p>{m.competition?<p className="mt-1 max-w-28 truncate text-[0.46rem] font-black uppercase tracking-wide text-emerald-300/65">{m.competition}</p>:null}</div>
        <div className="min-w-0 text-center"><p className="truncate text-sm font-black">{m.home} <span className="text-white/25">v</span> {m.away}</p><p className="mt-1 text-[0.48rem] font-black uppercase text-white/25">{open?"Hide match detail":"Open match detail"}</p></div>
        <p className="font-mono text-2xl font-black">{m.homeGoals}-{m.awayGoals}</p>
      </div>
    </button>

    <div className="border-t border-white/[0.055] px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl bg-white/[0.045] p-3"><p className="text-[0.5rem] font-black uppercase tracking-wide text-white/30">Goalscorers</p><p className="mt-1.5 text-xs leading-relaxed text-white/65">{m.scorers.length?m.scorers.map(s=>s.player+(s.goals>1?" ×"+s.goals:"")).join(", "):"No scorer detail available"}</p></div>
        <button onClick={()=>setBookingsOpen(v=>!v)} className={"rounded-2xl border p-3 text-left transition "+(bookingsOpen?"border-amber-300/25 bg-amber-300/[0.08]":"border-white/6 bg-white/[0.045]")}>
          <div className="flex items-center justify-between gap-2"><p className="text-[0.5rem] font-black uppercase tracking-wide text-amber-200/80">Yellow / red cards</p><span className="rounded-full bg-amber-300/12 px-2 py-0.5 font-mono text-[0.55rem] font-black text-amber-100">{m.bookings.length}</span></div>
          <p className="mt-1.5 text-xs text-white/60">{m.bookings.length?m.bookings.slice(0,3).map(b=>b.player).join(", ")+(m.bookings.length>3?" +"+(m.bookings.length-3)+" more":""):"No bookings tracked"}</p>
          <p className="mt-1 text-[0.45rem] font-black uppercase text-white/25">{bookingsOpen?"Hide booking times":"Tap for booking times"}</p>
        </button>
      </div>

      {bookingsOpen?<div className="mt-3 overflow-hidden rounded-2xl border border-amber-300/12 bg-amber-300/[0.035]">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/7 px-3 py-2"><p className="text-[0.5rem] font-black uppercase text-amber-100/70">Booked player</p><p className="text-[0.5rem] font-black uppercase text-amber-100/70">Match clock</p></div>
        {m.bookings.length?m.bookings.map((b,i)=><div key={b.player+"|"+String(b.clock??b.minute??i)} className={"grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3 "+(i?"border-t border-white/[0.055]":"")}>
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-base">{b.red?"🟥":"🟨"}</span><p className="truncate text-sm font-black">{b.player}</p></div><p className="mt-0.5 truncate text-[0.52rem] text-white/35">{b.team||"Team unavailable"}{b.detail?" · "+b.detail:""}</p></div>
          <div className="text-right">{b.minute!=null&&b.second!=null?<><p className="font-mono text-base font-black text-amber-100">{String(b.minute).padStart(2,"0")}:{String(b.second).padStart(2,"0")}</p><p className="text-[0.42rem] text-white/25">{b.clock??"exact elapsed clock"}</p></>:<p className="font-mono text-base font-black text-amber-100">{b.clock??(b.minute!=null?String(b.minute)+"'":"—")}</p>}</div>
        </div>):<p className="px-3 py-4 text-xs text-white/35">No booking event detail available from this source.</p>}
      </div>:null}

      <div className="mt-3 grid grid-cols-2 gap-2"><H2HTeamTotals label={m.home} x={m.totals.home}/><H2HTeamTotals label={m.away} x={m.totals.away}/></div>
    </div>

    {open?<div className="border-t border-white/8 bg-white/[0.018] p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <H2HLeader label="Most fouls committed" player={foulLeader?.player??"—"} value={foulLeader?String(foulLeader.foulsCommitted):"—"}/>
        <H2HLeader label="Most fouls drawn" player={drawnLeader?.player??"—"} value={drawnLeader?String(drawnLeader.foulsDrawn):"—"}/>
        <H2HLeader label="Most shots" player={shotLeader?.player??"—"} value={shotLeader?String(shotLeader.shots):"—"}/>
        <H2HLeader label="Most shots on target" player={sotLeader?.player??"—"} value={sotLeader?String(sotLeader.shotsOnTarget):"—"}/>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-end justify-between gap-3"><div><p className="text-sm font-black">Player match stats</p><p className="mt-0.5 text-[0.52rem] text-white/30">Scroll sideways to see every stat.</p></div><span className="text-[0.46rem] font-black uppercase text-white/20">{m.players.length} players</span></div>
        <div className="overflow-x-auto rounded-2xl border border-white/8 [scrollbar-width:thin]">
          <table className="min-w-[920px] w-full border-collapse text-left">
            <thead className="bg-[#101d18]">
              <tr className="text-[0.5rem] font-black uppercase tracking-wide text-white/35">
                <th className="sticky left-0 z-10 min-w-[180px] bg-[#101d18] px-3 py-3">Player</th>
                <th className="px-3 py-3 text-center">Fouls committed</th>
                <th className="px-3 py-3 text-center">Fouls drawn</th>
                <th className="px-3 py-3 text-center">Shots</th>
                <th className="px-3 py-3 text-center">Shots on target</th>
                <th className="px-3 py-3 text-center">Goals</th>
                <th className="px-3 py-3 text-center">Assists</th>
                <th className="px-3 py-3 text-center">Cards</th>
              </tr>
            </thead>
            <tbody>{m.players.map((p,i)=><tr key={p.team+"|"+p.player} className={i?"border-t border-white/[0.055]":""}>
              <td className="sticky left-0 z-[5] bg-[#0b1712] px-3 py-3.5"><p className="text-xs font-black text-white/80">{p.player}</p><p className="mt-0.5 text-[0.48rem] text-white/30">{p.team}</p></td>
              <H2HStatCell value={p.foulsCommitted} emphasis={p.foulsCommitted>0?"amber":"none"}/>
              <H2HStatCell value={p.foulsDrawn} emphasis={p.foulsDrawn>0?"cyan":"none"}/>
              <H2HStatCell value={p.shots} emphasis={p.shots>0?"white":"none"}/>
              <H2HStatCell value={p.shotsOnTarget} emphasis={p.shotsOnTarget>0?"emerald":"none"}/>
              <H2HStatCell value={p.goals} emphasis={p.goals>0?"emerald":"none"}/>
              <H2HStatCell value={p.assists} emphasis={p.assists>0?"cyan":"none"}/>
              <td className="px-3 py-3.5 text-center text-sm">{p.red?"🟥":p.yellow?"🟨":"—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>:null}
  </article>
}
function H2HLeader({label,player,value}:{label:string;player:string;value:string}){
  return <div className="rounded-2xl border border-white/7 bg-black/20 p-3"><p className="text-[0.44rem] font-black uppercase leading-tight text-white/25">{label}</p><p className="mt-1 truncate text-xs font-black text-white/70">{player}</p><p className="mt-1 font-mono text-lg font-black">{value}</p></div>
}
function H2HStatCell({value,emphasis}:{value:number;emphasis:"amber"|"cyan"|"emerald"|"white"|"none"}){
  const tone=emphasis==="amber"?"text-amber-200":emphasis==="cyan"?"text-cyan-200":emphasis==="emerald"?"text-emerald-200":emphasis==="white"?"text-white/80":"text-white/25"
  return <td className={"px-3 py-3.5 text-center font-mono text-sm font-black "+tone}>{value}</td>
}
function H2HTeamTotals({label,x}:{label:string;x:{yellow:number;red:number;fouls:number;shots:number;sot:number}}){
  return <div className="rounded-2xl bg-white/[0.045] p-3"><p className="truncate text-[0.5rem] font-black text-white/40">{label}</p><div className="mt-2 grid grid-cols-4 gap-1 text-center"><div><p className="font-mono text-sm font-black">{x.fouls}</p><p className="text-[0.38rem] uppercase text-white/20">Fouls</p></div><div><p className="font-mono text-sm font-black">{x.shots}</p><p className="text-[0.38rem] uppercase text-white/20">Shots</p></div><div><p className="font-mono text-sm font-black">{x.sot}</p><p className="text-[0.38rem] uppercase text-white/20">SOT</p></div><div><p className="font-mono text-sm font-black text-amber-100">{x.yellow}</p><p className="text-[0.38rem] uppercase text-white/20">YC</p></div></div></div>
}

function RiskCard({build,onUse,onTrack,liveBet365=false,inPlay=false,fixture}:{build:RiskBuilder;onUse:()=>void;onTrack:()=>void;liveBet365?:boolean;inPlay?:boolean;fixture:Fixture}){
  const tone=build.risk==="Safe"?"border-emerald-300/18 bg-emerald-400/[0.06]":build.risk==="Balanced"?"border-amber-300/18 bg-amber-300/[0.05]":"border-rose-300/18 bg-rose-400/[0.05]"
  const accent=build.risk==="Safe"?"text-emerald-300":build.risk==="Balanced"?"text-amber-300":"text-rose-300"
  const verified=build.verifiedBet365LegPrices===true
  const blockedLive=inPlay&&!verified
  return <article className={"rounded-2xl border p-3 "+tone}>
    <div className="flex items-start justify-between gap-2"><div><p className={"text-[0.5rem] font-black uppercase "+accent}>{build.id.startsWith("discipline-")?"FOULS & CARDS · ":""}{build.risk==="High Risk"?"Risky":build.risk}</p><p className="mt-1 text-lg font-black">{build.targetFractional}</p></div><ShieldCheck className={"size-4 "+accent}/></div>
    {build.legs.length&&!blockedLive?<><div className="mt-2 flex items-center gap-1.5"><span className={"rounded-full px-2 py-1 text-[0.38rem] font-black "+(verified?(liveBet365?"bg-emerald-300/15 text-emerald-200":"bg-cyan-300/10 text-cyan-100"):"bg-amber-300/10 text-amber-100")}>{verified?(liveBet365?"LIVE BET365 LEGS":"VERIFIED BET365 LEGS"):"MODEL ANALYSIS ONLY"}</span><span className="text-[0.38rem] text-white/25">{verified?"final Bet Builder quote may differ":"not an actionable Bet365 bet"}</span></div><div className="mt-2 grid grid-cols-3 gap-1.5"><MiniStat label="Raw chance" value={percent(build.modelAllHitProbability,1)}/><MiniStat label="Safety chance" value={percent(build.conservativeAllHitProbability??build.modelAllHitProbability,1)}/><MiniStat label={verified?"Bet365 leg product":"Model fair product"} value={fractionalOdds(build.referenceProductOdds)}/></div><div className="mt-2 space-y-1.5">{build.legs.map(l=><div key={keyOf(l)} className="flex items-center justify-between gap-2 rounded-lg bg-black/15 px-2 py-1.5"><div className="min-w-0 flex flex-1 items-center gap-1.5"><p className="min-w-0 truncate text-[0.5rem] text-white/65">{l.player} · {l.label}</p><TeamBadge team={l.team} fixture={fixture}/></div><span className="shrink-0 font-mono text-[0.48rem] font-black text-white/45">{percent(l.probability)}</span></div>)}</div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={onUse} className="rounded-xl bg-white/8 px-3 py-2 text-[0.54rem] font-black text-white/55">Use selections</button><button disabled={!verified} onClick={verified?onTrack:undefined} className={"rounded-xl px-3 py-2 text-[0.58rem] font-black "+(verified?"bg-white text-[#07120e]":"cursor-not-allowed bg-white/8 text-white/25")}>{verified?"Track this bet":"Not on Bet365"}</button></div></>:<div className="mt-2 rounded-xl border border-rose-300/12 bg-rose-300/[0.045] px-3 py-2"><p className="text-[0.54rem] font-black text-rose-200">{blockedLive?"Not available to bet on Bet365 live":(build.note||"No strong route available yet.")}</p>{blockedLive?<p className="mt-1 text-[0.46rem] text-white/30">Match Edge may still analyse the underlying probability, but it will not show the model-only legs as a 3/1, 10/1 or 20/1 bet.</p>:null}</div>}
  </article>
}
function TrackBetModal({draft,fixture,onClose,onSaved}:{draft:TrackDraft;fixture:Fixture;onClose:()=>void;onSaved:()=>void}){
  const[odds,setOdds]=useState("")
  const[stake,setStake]=useState("")
  const actualOdds=Number(odds)
  const actualStake=Number(stake)
  const valid=Number.isFinite(actualOdds)&&actualOdds>1&&Number.isFinite(actualStake)&&actualStake>0
  const save=()=>{
    if(!valid)return
    addTrackedBet({
      source:"match-builder",
      title:draft.title,
      fixture:draft.fixture,
      odds:actualOdds,
      stake:actualStake,
      modelProbability:draft.modelProbability,
      legs:draft.legs.map(leg=>({
        label:(leg.player?leg.player+" · ":"")+leg.label,
        player:leg.player,
        team:leg.team,
        market:leg.market,
        modelProbability:leg.probability,
        bet365Odds:verifiedBet365Odd(leg),
      })),
    })
    onSaved()
  }
  return <div className="fixed inset-0 z-[80] flex items-end bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
    <div className="w-full max-w-lg rounded-3xl border border-emerald-300/20 bg-[#0d1d17] p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[0.52rem] font-black uppercase tracking-[0.13em] text-emerald-300">My slips</p><h3 className="mt-1 text-lg font-black">{draft.title}</h3><p className="mt-1 text-[0.55rem] text-white/35">{draft.fixture} · {draft.legs.length} selections</p></div><button onClick={onClose} className="rounded-xl bg-white/7 p-2 text-white/45"><X className="size-4"/></button></div>
      <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">{draft.legs.map(leg=><div key={keyOf(leg)} className="rounded-xl bg-white/[0.045] px-3 py-2"><div className="flex flex-wrap items-center gap-1.5"><p className="text-xs font-black">{leg.player} · {leg.label}</p><TeamBadge team={leg.team} fixture={fixture}/></div><p className="mt-0.5 text-[0.44rem] text-white/25">{percent(leg.probability)} model{verifiedBet365Odd(leg)!=null?" · "+Number(verifiedBet365Odd(leg)).toFixed(3)+" Bet365 single":""}</p></div>)}</div>
      <div className="mt-4 rounded-2xl border border-amber-300/12 bg-amber-300/[0.045] p-3"><p className="text-[0.55rem] font-black text-amber-100">Enter what you actually placed at Bet365</p><p className="mt-1 text-[0.48rem] leading-relaxed text-white/35">Use the final Bet Builder odds Bet365 shows after all selections are added. Do not use the leg-product estimate{draft.suggestedProduct?" ("+draft.suggestedProduct.toFixed(2)+")":""}.</p></div>
      <div className="mt-3 grid grid-cols-2 gap-2"><label className="rounded-2xl bg-black/20 p-3"><span className="text-[0.44rem] font-black uppercase text-white/25">Actual Bet365 odds</span><input inputMode="decimal" value={odds} onChange={e=>setOdds(e.target.value)} placeholder="e.g. 4.00" className="mt-1 w-full bg-transparent font-mono text-lg font-black outline-none"/></label><label className="rounded-2xl bg-black/20 p-3"><span className="text-[0.44rem] font-black uppercase text-white/25">Stake £</span><input inputMode="decimal" value={stake} onChange={e=>setStake(e.target.value)} placeholder="e.g. 10" className="mt-1 w-full bg-transparent font-mono text-lg font-black outline-none"/></label></div>
      {valid?<div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Potential return" value={"£"+(actualStake*actualOdds).toFixed(2)}/><MiniStat label="Potential profit" value={"£"+(actualStake*(actualOdds-1)).toFixed(2)}/></div>:null}
      <button disabled={!valid} onClick={save} className="mt-4 w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-emerald-950 disabled:opacity-30">Save as open bet</button>
    </div>
  </div>
}

function MiniStat({label,value}:{label:string;value:string}){return <div className="rounded-xl bg-black/20 px-2 py-1.5"><p className="font-mono text-xs font-black">{value}</p><p className="text-[0.4rem] uppercase text-white/25">{label}</p></div>}

function SelectionRow({row,selected,onToggle,rank,traffic,bestAction=false,liveBet365=false,marketStatus="unknown",inPlay=false,fixture}:{row:Selection;selected:boolean;onToggle:()=>void;rank:number;traffic:Traffic;bestAction?:boolean;liveBet365?:boolean;marketStatus?:MarketStatus;inPlay?:boolean;fixture:Fixture}){
  const exact=row.bookmakerOdds!=null
  const actionable=exact&&marketStatus!=="unavailable"
  const trafficText=traffic==="high"?"HIGH":traffic==="average"?"AVERAGE":"LOW"
  const trafficClass=traffic==="high"?"bg-emerald-300/15 text-emerald-200 border-emerald-300/20":traffic==="average"?"bg-amber-300/12 text-amber-100 border-amber-300/20":"bg-rose-300/10 text-rose-100/75 border-rose-300/15"
  const probabilityClass=traffic==="high"?"text-emerald-200":traffic==="average"?"text-amber-100":"text-rose-100/80"
  return <button disabled={!actionable} onClick={actionable?onToggle:undefined} className={"grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 text-left transition "+(rank>1?"border-t border-white/[0.055] ":"")+(selected?"bg-emerald-400/[0.08]":actionable?"hover:bg-white/[0.025]":"opacity-55 cursor-not-allowed")}>
    <span className={"flex size-7 items-center justify-center rounded-full text-[0.56rem] font-black "+(traffic==="high"?"bg-emerald-400/12 text-emerald-300":traffic==="average"?"bg-amber-300/10 text-amber-200":"bg-rose-300/8 text-rose-200/65")}>{rank}</span>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-black">{row.player}</p><TeamBadge team={row.team} fixture={fixture}/>{bestAction?<span className="rounded-full bg-cyan-300/10 px-1.5 py-0.5 text-[0.36rem] font-black text-cyan-200">BEST ACTION</span>:null}{selected?<BadgeCheck className="size-3.5 shrink-0 text-emerald-300"/>:null}</div><p className="mt-0.5 truncate text-[0.54rem] font-bold text-white/55">{row.label}</p><p className="mt-0.5 truncate text-[0.46rem] text-white/25">Grade {row.confidence}{row.liveAdjusted?" · live count "+(row.currentCount??0):row.edge!=null?" · "+(row.edge>=0?"+":"")+(row.edge*100).toFixed(1)+"pp vs price":""}</p></div>
    <div className="min-w-[5rem] text-right"><div className="mb-1 flex justify-end"><span className={"rounded-full border px-1.5 py-0.5 text-[0.38rem] font-black "+trafficClass}>{trafficText}</span></div><p className={"font-mono text-base font-black "+probabilityClass}>{percent(row.probability)}</p><p className={"text-[0.42rem] font-black "+(exact?"text-emerald-200/70":marketStatus==="unavailable"?"text-rose-200/70":"text-white/20")}>{exact?(row.bookmakerOdds!.toFixed(3)+" · "+(liveBet365?"LIVE BET365":"VERIFIED BET365")):marketStatus==="unavailable"?"NOT OFFERED IN VERIFIED BET365 FEED":"NO VERIFIED BET365 PRICE"}</p>{actionable?<span className={"mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+(selected?"bg-emerald-300 text-emerald-950":"bg-white/6 text-white/30")}>{selected?<X className="size-2.5"/>:<CirclePlus className="size-2.5"/>}{selected?"REMOVE":"ADD"}</span>:<span className="mt-1 inline-flex rounded-full bg-rose-300/10 px-1.5 py-0.5 text-[0.4rem] font-black text-rose-200">MODEL ONLY</span>}</div>
  </button>
}

function BuilderTray({rows,referenceProduct,modelProduct,risk,open,setOpen,onRemove,onClear,onTrack,fixture}:{rows:Selection[];referenceProduct:number|null;modelProduct:number;risk:"Safe"|"Balanced"|"Risky";open:boolean;setOpen:(v:boolean)=>void;onRemove:(r:Selection)=>void;onClear:()=>void;onTrack:()=>void;fixture:Fixture}){
  return <div className="fixed inset-x-0 bottom-[4.85rem] z-40 px-3">
    <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-emerald-300/20 bg-[#0d1d17]/98 shadow-2xl backdrop-blur-xl">
      {open?<div className="max-h-[46vh] overflow-y-auto border-b border-white/8 p-3">
        <div className="mb-2 flex items-center justify-between"><p className="text-sm font-black">Your builder</p><button onClick={onClear} className="flex items-center gap-1 text-[0.5rem] font-black text-rose-300"><Trash2 className="size-3"/>CLEAR</button></div>
        <div className="space-y-1.5">{rows.map(row=><div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.045] px-3 py-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-xs font-black">{row.player} · {row.label}</p><TeamBadge team={row.team} fixture={fixture}/></div><p className="text-[0.44rem] text-white/25">{percent(row.probability)} model · {verifiedBet365Odd(row)!=null?Number(verifiedBet365Odd(row)).toFixed(3)+" verified Bet365":"no verified Bet365 price"}</p></div><button onClick={()=>onRemove(row)} className="rounded-lg bg-white/6 p-1.5 text-white/35"><X className="size-3"/></button></div>)}</div>
        <p className="mt-2 text-[0.46rem] leading-relaxed text-white/25">Reference odds multiply singles only. Same-game bookmaker Builder pricing can be lower because correlated selections are repriced together.</p>
        <button onClick={onTrack} className="mt-3 w-full rounded-xl bg-emerald-400 px-3 py-2.5 text-[0.58rem] font-black text-emerald-950">Track this bet in Match Edge</button>
      </div>:null}
      <button onClick={()=>setOpen(!open)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-left"><div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-400 text-emerald-950"><Target className="size-5"/></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-black">{rows.length} selection{rows.length===1?"":"s"}</p><span className={"rounded-full px-1.5 py-0.5 text-[0.42rem] font-black "+(risk==="Safe"?"bg-emerald-300/15 text-emerald-300":risk==="Balanced"?"bg-amber-300/15 text-amber-200":"bg-rose-300/15 text-rose-200")}>{risk.toUpperCase()}</span></div><p className="mt-0.5 text-[0.5rem] text-white/35">Model chance {percent(modelProduct,1)} · tap to {open?"collapse":"review"}</p></div><div className="text-right"><p className="font-mono text-lg font-black">{referenceProduct!=null?referenceProduct.toFixed(2):"—"}</p><p className="text-[0.4rem] uppercase text-white/25">{referenceProduct!=null?"Bet365 leg product":"need Bet365 prices"}</p></div></button>
    </div>
  </div>
}
