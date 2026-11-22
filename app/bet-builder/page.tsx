"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, BadgeCheck, ChevronDown, CirclePlus, Clock3, RefreshCw, ShieldCheck, Sparkles, Target, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { addTrackedBet } from "@/lib/tracked-bets"
import {MarketHistoryBadge} from "@/components/MarketHistoryBadge"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
type MarketStatus = "available"|"unavailable"|"unknown"
type MarketKey = "goal1"|"assist1"|"foul1"|"foul2"|"foul3"|"foul4"|"foul5"|"fouled1"|"card"|"shot1"|"shot2"|"sot1"|"sot2"
type Category = "popular"|"goals"|"assists"|"shots"|"sot"|"fouls"|"fouled"|"cards"

type Fixture={id:string;date:string;kickoff:string;competition:Competition;home:string;away:string;homeCrest?:string;awayCrest?:string}

type ScoreMarket={
  key:MarketKey;label:string;probability:number;fairOdds:number|null;confidence:"A"|"B"|"C"|"D";
  bookmakerOdds:number|null;bookmakerName:string|null;edge:number|null;expectedValue:number|null;
  recent5HitRate:number;recent10HitRate?:number;seasonHitRate:number;seasonPer90?:number|null;
  h2hHitRate:number|null;h2hMatches?:number;h2hLineupOverlap?:number|null;h2hSimilarity?:number|null;
  sampleMatches?:number;seasonMatches?:number;recommendationScore?:number;reasons:string[]
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
  tackles?:number;interceptions?:number;blocks?:number;duelsTotal?:number;duelsWon?:number;defensiveInterventions?:number;
  livePressureScore?:number;liveRankScore?:number;preMarketProbability?:number;
  liveFoulsCommitted?:number;liveFoulsDrawn?:number;liveShots?:number;liveShotsOnTarget?:number;
  disciplineHeat?:number;recentFouls10?:number;recentFouls15?:number;aggressionSignals?:string[];lastAggressionMinute?:number|null;
  recent5HitRate?:number|null;recent10HitRate?:number|null;seasonHitRate?:number|null;seasonPer90?:number|null;
  h2hHitRate?:number|null;h2hMatches?:number;h2hLineupOverlap?:number|null;h2hSimilarity?:number|null;sampleMatches?:number;seasonMatches?:number;
  dataFreshness?:string|null;referenceBookmakerOdds?:number|null;referenceImpliedProbability?:number|null;referenceOddsLive?:boolean
}
type LivePlayerStat={
  player:string;team:string;minutes:number|null;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;assists:number;yellowCards:number;redCards:number;starter?:boolean;subbedOn?:boolean;subbedOff:boolean;
  tackles:number;interceptions:number;blocks:number;duelsTotal:number;duelsWon:number;defensiveInterventions:number;
  recentFouls10?:number;recentFouls15?:number;recentFouled10?:number;disciplineHeat?:number;
  aggressionScore?:number;aggressionSignals?:string[];lastAggressionMinute?:number|null
}
type RefereeLiveContext={
  name:string|null;source:string|null;matches:number|null;historicalYellowsPerGame:number|null;historicalFoulsPerGame:number|null;
  liveFouls:number;liveYellows:number;liveReds:number;liveFoulsPer90:number|null;liveYellowsPer90:number|null;
  liveCardPerFoul:number|null;historicalCardPerFoul:number|null;strictnessScore:number;strictnessLabel:"strict"|"average"|"lenient";
  historicalModifier:number;liveDecisionModifier:number
}
type LiveData={
  ok:boolean;source:string|null;status:"scheduled"|"live"|"halftime"|"finished"|"unknown";elapsed:number;
  score:{home:number|null;away:number|null};players:LivePlayerStat[];updatedAt:string;referee?:RefereeLiveContext|null
}
type LiveOddSelection={kind:string;label:string;odd:number|null;bookmaker?:string|null;noVigProbability?:number|null}
type AvailableBet={
  market:string;kind:string;label:string;odd:number;bookmaker:string;
  probability:number|null;probabilityBasis:"no-vig"|"implied";line?:number|null;side?:string|null
}
type LiveOddsData={
  connected?:boolean;bookmaker?:string|null;source?:string|null;capturedAt?:string|null;
  priceAvailable?:boolean;liveVerified?:boolean;lastGoodReference?:boolean;cached?:boolean;selections?:LiveOddSelection[];note?:string|null;
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
  verifiedBet365LegPrices?:boolean;referenceBet365LegPrices?:boolean;exactBet365BuilderPrice?:boolean;pricingBasis?:"bet365_singles_product"|"bet365_reference_product"|"none";note:string
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
function scorecardUrl(f:Fixture,force=false){const q=new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition,view:"builder"});if(force)q.set("refresh",String(Date.now()));return "/api/fixture-scorecard?"+q}
function time(kickoff:string){return kickoff?new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",weekday:"short",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(kickoff)):""}
function keyOf(s:Pick<Selection,"player"|"market"|"label">){return [s.player,s.market,s.label].join("|").toLowerCase()}
function ledgerMarket(row:Selection){
  if(!row.market.startsWith("board:"))return row.market
  if(row.market==="board:btts"){
    const l=String(row.label??"").toLowerCase()
    return l.includes("no")?"bttsNo":l.includes("yes")?"bttsYes":null
  }
  return null
}
function ledgerLeg(row:Selection,fixture:Fixture,live:LiveData|null=null){
  const market=ledgerMarket(row)
  if(!market)return null
  return {
    fixture:{id:fixture.id,competition:fixture.competition,kickoff:fixture.kickoff,date:fixture.date,home:fixture.home,away:fixture.away},
    playerName:row.market.startsWith("board:")?null:row.player,
    dbPlayerName:row.market.startsWith("board:")?null:(row.dbPlayerName??row.player),
    team:row.market.startsWith("board:")?null:row.team,
    market,label:row.label,modelProbability:row.probability,fairOdds:row.fairOdds,
    bookmakerOdds:displayedBet365Odd(row)?.odd??row.bookmakerOdds??null,confidence:row.confidence,
    recent5HitRate:row.recent5HitRate??null,seasonHitRate:row.seasonHitRate??null,
    h2hHitRate:row.h2hHitRate??null,h2hMatches:row.h2hMatches??0,sampleMatches:row.sampleMatches??0,
    disciplineHeat:row.disciplineHeat??null,recentFouls10:row.recentFouls10??null,
    liveFouls:row.liveFoulsCommitted??null,liveFouled:row.liveFoulsDrawn??null,
    liveShots:row.liveShots??null,liveSot:row.liveShotsOnTarget??null,
    aggressionSignals:row.liveAdjusted?row.aggressionSignals??[]:null,
    aggressionEventMinute:row.liveAdjusted?row.lastAggressionMinute??null:null,
    liveFeedSource:row.liveAdjusted?live?.source??null:null,
    liveFeedUpdatedAt:row.liveAdjusted?live?.updatedAt??null:null,
    liveModelMinute:row.liveAdjusted?live?.elapsed??null:null,
  }
}
function verifiedBet365Odd(s:Selection){
  return s.bookmakerName==="Bet365"&&s.bookmakerOdds!=null&&Number(s.bookmakerOdds)>1?Number(s.bookmakerOdds):null
}
function displayedBet365Odd(s:Selection){
  const live=verifiedBet365Odd(s)
  if(live!=null)return {odd:live,state:"live" as const}
  if(s.referenceBookmakerOdds!=null&&Number(s.referenceBookmakerOdds)>1)return {odd:Number(s.referenceBookmakerOdds),state:"reference" as const}
  return null
}
function referenceOdd(s:Selection){return Number(verifiedBet365Odd(s)??0)}
function liveUrl(f:Fixture){return "/api/live-player-stats?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})}
function livePlayerIsActive(p:LivePlayerStat){
  if(p.subbedOff)return false
  return p.starter===true||p.subbedOn===true||Number(p.minutes??0)>0||
    Number(p.foulsCommitted??0)>0||Number(p.foulsDrawn??0)>0||Number(p.shots??0)>0||
    Number(p.shotsOnTarget??0)>0||Number(p.goals??0)>0||Number(p.assists??0)>0||
    Number(p.yellowCards??0)>0||Number(p.redCards??0)>0
}
function fastBaselineUrl(f:Fixture){
  return "/api/live-player-baseline?"+new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})
}
function liveBaselineUrl(f:Fixture,live:LiveData){
  const q=new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})
  const active=(live.players??[]).filter(livePlayerIsActive)
  for(const p of active)q.append("starter",p.player)
  return "/api/live-player-baseline?"+q.toString()
}
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

  const elapsed=Math.max(1,Number(live.elapsed??0))
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,elapsed)))/96))
  const adjusted:Selection[]=[]
  const logit=(p:number)=>Math.log(Math.max(.001,Math.min(.999,p))/(1-Math.max(.001,Math.min(.999,p))))
  const logistic=(x:number)=>1/(1+Math.exp(-x))

  const teamTotals=new Map<string,{fc:number;fd:number;shots:number;sot:number;cards:number;duels:number;tackles:number}>()
  for(const stat of live.players){
    if(!livePlayerIsActive(stat))continue
    const key=teamNorm(stat.team)
    const cur=teamTotals.get(key)??{fc:0,fd:0,shots:0,sot:0,cards:0,duels:0,tackles:0}
    cur.fc+=Number(stat.foulsCommitted??0)
    cur.fd+=Number(stat.foulsDrawn??0)
    cur.shots+=Number(stat.shots??0)
    cur.sot+=Number(stat.shotsOnTarget??0)
    cur.cards+=Number(stat.yellowCards??0)+Number(stat.redCards??0)
    cur.duels+=Number(stat.duelsTotal??0)
    cur.tackles+=Number(stat.tackles??0)
    teamTotals.set(key,cur)
  }
  const teamKeys=[...teamTotals.keys()]
  const opponentKey=(team:string)=>{
    const key=teamNorm(team)
    return teamKeys.find(x=>x!==key)??""
  }
  const per90=(value:number)=>value*90/Math.max(12,elapsed)

  const defensivePressure=(stat:LivePlayerStat,position?:string|null)=>{
    const pos=String(position??"").toLowerCase()
    const role=pos.includes("def")?1.10:pos.includes("mid")?1.05:pos.includes("forward")||pos.includes("att")?.88:pos.includes("goal")?.42:1
    const raw=Number(stat.tackles??0)*.07+Number(stat.interceptions??0)*.045+Number(stat.blocks??0)*.025+
      Number(stat.duelsTotal??0)*.009+Number(stat.duelsWon??0)*.006+Number(stat.defensiveInterventions??0)*.025
    return Math.max(0,Math.min(.50,raw*role))
  }
  const matchPressure=(stat:LivePlayerStat,position?:string|null)=>{
    const own=teamTotals.get(teamNorm(stat.team))??{fc:0,fd:0,shots:0,sot:0,cards:0,duels:0,tackles:0}
    const opp=teamTotals.get(opponentKey(stat.team))??{fc:0,fd:0,shots:0,sot:0,cards:0,duels:0,tackles:0}
    // Opponent fouls drawn are effectively the fouls this player's team is being
    // forced to commit. Cap the signal so one frantic opening spell cannot swamp history.
    const oppDrawRate=per90(opp.fd)
    const ownCommitRate=per90(own.fc)
    const teamFoulIntensity=Math.max(0,Math.min(.34,(oppDrawRate-7)*.012+(ownCommitRate-7)*.009))
    const personalAggression=Math.min(.42,Number(stat.foulsCommitted??0)*.13)
    const personalTargeting=Math.min(.24,Number(stat.foulsDrawn??0)*.06)
    return {
      foul:Math.max(0,Math.min(.62,defensivePressure(stat,position)+teamFoulIntensity+personalAggression)),
      card:Math.max(0,Math.min(.72,defensivePressure(stat,position)*.55+teamFoulIntensity*.75+personalAggression*1.15)),
      fouled:Math.max(0,Math.min(.42,personalTargeting+Math.max(0,per90(own.fd)-7)*.008)),
      oppDrawRate,ownCommitRate,
    }
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
    const pressure=matchPressure(stat,row.position)
    let probability:number
    let liveReason=""

    if(row.market==="card"){
      probability=remainingOneProbability(base,elapsed)
      const fouls=Math.max(0,Number(stat.foulsCommitted??0))
      const yc=row.yellowConditionals
      const conditional=fouls>=3?yc?.after3PlusFouls:fouls>=2?yc?.after2PlusFouls:fouls>=1?yc?.after1PlusFouls:null
      const overall=yc?.overall?.rate
      const disciplineHeat=Math.max(0,Math.min(1,Number(stat.disciplineHeat??0)))
      const recentBurst=Math.min(.34,Number(stat.recentFouls10??0)*.17+Math.max(0,Number(stat.recentFouls15??0)-Number(stat.recentFouls10??0))*.07)
      const refHistorical=Math.max(-.18,Math.min(.18,Number(live.referee?.historicalModifier??0)))
      const refLive=Math.max(-.34,Math.min(.34,Number(live.referee?.liveDecisionModifier??0)))
      const refDelta=Math.max(-.30,Math.min(.30,refHistorical*.45+refLive))
      const refInteraction=refDelta*(.72+disciplineHeat*.45+Math.min(.18,fouls*.035))
      let cardDelta=Math.min(1.18,pressure.card*.72+disciplineHeat*.52+recentBurst+refInteraction)
      if(fouls>0&&conditional?.rate!=null&&overall!=null&&conditional.matches>=2){
        const reliability=Math.min(1,conditional.matches/10)
        const observedDelta=logit(Number(conditional.rate))-logit(Math.max(.02,Number(overall)))
        cardDelta=Math.max(cardDelta,Math.max(-.10,Math.min(.95,observedDelta*.72*reliability+.11*fouls)))
        liveReason=`${fouls} foul${fouls===1?"":"s"} committed · historical booking rate after this foul load ${Math.round(Number(conditional.rate)*100)}% (${conditional.matches} matches)`
      }else if(fouls>0){
        liveReason=`${fouls} foul${fouls===1?"":"s"} committed already`
      }
      probability=logistic(logit(probability)+cardDelta)
      if(Number(stat.recentFouls10??0)>0)liveReason+=(liveReason?" · ":"")+`${stat.recentFouls10} new foul${stat.recentFouls10===1?"":"s"} in the last 10 minutes`
      if((stat.aggressionSignals??[]).length)liveReason+=(liveReason?" · ":"")+`live signal: ${(stat.aggressionSignals??[]).slice(0,2).join(", ")}`
      liveReason+=(liveReason?" · ":"")+`discipline heat ${Math.round(disciplineHeat*100)}/100 · opponent drawing fouls at ${pressure.oppDrawRate.toFixed(1)}/90`
      if(live.referee?.name){
        liveReason+=` · referee ${live.referee.name}: ${live.referee.strictnessLabel}`
        if(live.referee.historicalYellowsPerGame!=null)liveReason+=` (${Number(live.referee.historicalYellowsPerGame).toFixed(1)} yellows/game historically)`
        if(live.referee.liveYellowsPer90!=null)liveReason+=` · live pace ${Number(live.referee.liveYellowsPer90).toFixed(1)} yellows/90`
      }
      const refYellows=Number(scorecard?.referee?.yellowsPerGame??0)
      if(refYellows>0){
        probability=logistic(logit(probability)+Math.max(-.18,Math.min(.22,(refYellows-4.2)*.055)))
        liveReason+=` · ${scorecard?.referee?.name} ${refYellows.toFixed(1)} yellows/game`
      }
      probability=Math.max(.001,Math.min(.95,probability))
    }else if(row.market.startsWith("goal")||row.market.startsWith("assist")){
      probability=remainingOneProbability(base,elapsed)
      if(row.market.startsWith("goal")&&Number(stat.shots??0)>0){
        probability=logistic(logit(probability)+Math.min(.32,Number(stat.shots??0)*.08+Number(stat.shotsOnTarget??0)*.13))
        liveReason=`${stat.shots} shot${stat.shots===1?"":"s"} already · ${stat.shotsOnTarget} on target`
      }
    }else{
      const lambdaFull=-Math.log(1-Math.max(.001,Math.min(.995,base)))
      probability=poissonAtLeast(lambdaFull*remaining,need)
      if(row.market.startsWith("foul")&&!row.market.startsWith("fouled")){
        probability=logistic(logit(probability)+pressure.foul)
        liveReason=`${current} foul${current===1?"":"s"} committed · team foul pressure ${pressure.ownCommitRate.toFixed(1)}/90 · opponent fouls drawn ${pressure.oppDrawRate.toFixed(1)}/90`
      }else if(row.market.startsWith("fouled")){
        probability=logistic(logit(probability)+pressure.fouled)
        liveReason=`${current} fouls drawn · live targeting pressure applied`
      }else if(row.market.startsWith("shot")){
        const attacking=Math.min(.34,Number(stat.shots??0)*.08+Number(stat.shotsOnTarget??0)*.12)
        if(attacking>0)probability=logistic(logit(probability)+attacking)
        liveReason=`${stat.shots} shots · ${stat.shotsOnTarget} SOT already`
      }
    }

    const livePressureScore=row.market==="card"?Math.max(pressure.card,Math.min(1,Number(stat.disciplineHeat??0))):
      row.market.startsWith("fouled")?pressure.fouled:
      row.market.startsWith("foul")?pressure.foul:
      row.market.startsWith("shot")||row.market.startsWith("sot")?Math.min(.45,Number(stat.shots??0)*.08+Number(stat.shotsOnTarget??0)*.12):0

    adjusted.push({
      ...row,
      preMarketProbability:probability,
      probability,
      fairOdds:probability>0?Math.round((1/probability)*100)/100:null,
      bookmakerOdds:null,
      bookmakerName:null,
      edge:null,
      currentCount:current,
      liveAdjusted:true,
      livePressureScore,
      liveRankScore:probability+livePressureScore*.08,
      liveFoulsCommitted:Number(stat.foulsCommitted??0),liveFoulsDrawn:Number(stat.foulsDrawn??0),
      liveShots:Number(stat.shots??0),liveShotsOnTarget:Number(stat.shotsOnTarget??0),
      disciplineHeat:Number(stat.disciplineHeat??0),recentFouls10:Number(stat.recentFouls10??0),recentFouls15:Number(stat.recentFouls15??0),
      aggressionSignals:Array.isArray(stat.aggressionSignals)?stat.aggressionSignals.slice(0,4):[],lastAggressionMinute:stat.lastAggressionMinute??null,
      tackles:Number(stat.tackles??0),interceptions:Number(stat.interceptions??0),blocks:Number(stat.blocks??0),
      duelsTotal:Number(stat.duelsTotal??0),duelsWon:Number(stat.duelsWon??0),defensiveInterventions:Number(stat.defensiveInterventions??0),
      reason:liveReason||`Live: ${current} already recorded; ${Math.round(probability*100)}% remaining-match chance of reaching ${row.label} from ${elapsed}'`,
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
  const clean=(v:string)=>normPlayer(String(v??"").replace(/\s*\(\d+\)\s*$/,""))
  const x=clean(a),y=clean(b)
  if(!x||!y)return false
  if(x===y)return true
  const xt=x.split(" "),yt=y.split(" ")
  return xt.length>1&&yt.length>1&&xt[xt.length-1]===yt[yt.length-1]&&(x.includes(yt[0])||y.includes(xt[0]))
}
function overlayVerifiedLiveBet365(rows:Selection[],odds:LiveOddsData|null){
  if(!odds||odds.bookmaker!=="Bet365")return rows
  const selections=Array.isArray(odds.selections)?odds.selections:[]
  if(!selections.length)return rows

  const captured=odds.capturedAt?new Date(odds.capturedAt).getTime():Number.NaN
  const freshLive=Boolean(
    odds.priceAvailable&&odds.liveVerified===true&&String(odds.source??"").startsWith("Odds-API.io")&&
    Number.isFinite(captured)&&Date.now()-captured<=45_000
  )
  const lastGood=odds.lastGoodReference===true||(!freshLive&&odds.cached===true)
  if(!freshLive&&!lastGood)return rows

  return rows.map(row=>{
    const kind=liveKindForMarket(row.market)
    const threshold=thresholdForMarket(row.market)
    const match=selections.find(sel=>{
      if(sel.bookmaker!=="Bet365"||sel.kind!==kind||!sel.odd||Number(sel.odd)<=1)return false
      const label=String(sel.label??"")
      const playerPart=label.split("·")[0]?.trim()??""
      return sameLivePlayer(playerPart,row.player)&&liveOddThreshold(label)===threshold
    })
    if(!match){
      return freshLive?{...row,bookmakerOdds:null,bookmakerName:null,edge:null}:row
    }

    const price=Number(match.odd)
    const implied=Math.max(.001,Math.min(.95,1/price))
    const modelP=Math.max(.001,Math.min(.99,row.probability))
    // Bet365 is a market signal, not the model. Fresh live prices receive a modest
    // weight; an older retained price is only a weak prior.
    const weight=freshLive?.22:.08
    const calibrated=Math.max(.001,Math.min(.99,modelP*(1-weight)+implied*weight))
    const marketRankBoost=Math.max(-.06,Math.min(.06,(implied-modelP)*.18))
    return {
      ...row,
      preMarketProbability:modelP,
      probability:calibrated,
      fairOdds:Math.round((1/calibrated)*100)/100,
      bookmakerOdds:freshLive?price:null,
      bookmakerName:freshLive?"Bet365":null,
      referenceBookmakerOdds:price,
      referenceImpliedProbability:implied,
      referenceOddsLive:freshLive,
      edge:freshLive?Math.round((modelP-implied)*1000)/1000:null,
      liveRankScore:Math.max(.001,Math.min(.999,(row.liveRankScore??modelP)+marketRankBoost)),
      reason:row.reason+(freshLive
        ?` · fresh Bet365 ${price.toFixed(2)} (${Math.round(implied*100)}% implied) used as market calibration`
        :` · last captured Bet365 ${price.toFixed(2)} used as a light market prior`),
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
      const row:Selection={id:"",player:p.name,team:p.team,market:m.key,label:m.label,probability:m.probability,fairOdds:m.fairOdds,bookmakerOdds:m.bookmakerOdds,bookmakerName:m.bookmakerName,edge:m.edge,confidence:m.confidence,reason:m.reasons?.[0]??"Player history and current matchup model",yellowConditionals:p.yellowConditionals,position:p.position,recommendationScore:m.recommendationScore,recent5HitRate:m.recent5HitRate,recent10HitRate:m.recent10HitRate??null,seasonHitRate:m.seasonHitRate,seasonPer90:m.seasonPer90??null,h2hHitRate:m.h2hHitRate,h2hMatches:Number(m.h2hMatches??0),h2hLineupOverlap:m.h2hLineupOverlap??null,h2hSimilarity:m.h2hSimilarity??null,sampleMatches:Number(m.sampleMatches??0),seasonMatches:Number(m.seasonMatches??0),dataFreshness:data?.oddsFreshness??null}
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
const MAX_RESEARCH_BUILDER_LEGS=6 // Conservative suggested slip; Bet365 publishes an absolute maximum of 12.
function buildBroadTargetBuilders(rows:Selection[]):RiskBuilder[]{
  const configs=[
    {id:"broad-most-likely",title:"2/1 Minimum",risk:"Safe" as const,targetFractional:"2/1",targetDecimal:3},
    {id:"broad-3-1",title:"3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4},
    {id:"broad-5-1",title:"5/1",risk:"Safe" as const,targetFractional:"5/1",targetDecimal:6},
    {id:"broad-10-1",title:"10/1",risk:"Safe" as const,targetFractional:"10/1",targetDecimal:11},
    {id:"broad-15-1",title:"15/1",risk:"Balanced" as const,targetFractional:"15/1",targetDecimal:16},
    {id:"broad-20-1",title:"20/1",risk:"Balanced" as const,targetFractional:"20/1",targetDecimal:21},
    {id:"broad-25-1",title:"25/1",risk:"Balanced" as const,targetFractional:"25/1",targetDecimal:26},
    {id:"broad-30-1",title:"30/1",risk:"Balanced" as const,targetFractional:"30/1",targetDecimal:31},
    {id:"broad-40-1",title:"40/1",risk:"High Risk" as const,targetFractional:"40/1",targetDecimal:41},
    {id:"broad-50-1",title:"50/1",risk:"High Risk" as const,targetFractional:"50/1",targetDecimal:51},
    {id:"broad-75-1",title:"75/1",risk:"High Risk" as const,targetFractional:"75/1",targetDecimal:76},
    {id:"broad-100-1",title:"100/1",risk:"High Risk" as const,targetFractional:"100/1",targetDecimal:101},
  ]
  const stability=(row:Selection)=>{
    if(row.market==="foul1")return 1.10
    if(row.market==="fouled1")return 1.07
    if(row.market==="shot1")return 1.04
    if(row.market==="sot1")return .99
    if(row.market==="board:btts")return .96
    if(row.market==="card")return .84
    if(row.market.startsWith("goal"))return .80
    if(row.market.startsWith("assist"))return .77
    return .92
  }
  const candidates=rows
    .filter(r=>verifiedBet365Odd(r)!=null&&r.probability>0&&Number(r.bookmakerOdds)<12&&Number(r.bookmakerOdds)>=1.02&&r.confidence!=="D")
    .sort((a,b)=>(b.probability*stability(b))-(a.probability*stability(a))||b.probability-a.probability)

  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":market==="card"?"card":"board"
  const pool:Selection[]=[]
  const primaryPlayers=new Set<string>()
  const usedPlayerFamilies=new Set<string>()
  let usedBtts=false

  // Pass 1: diversify first. Take the strongest single event for each player.
  for(const row of candidates){
    if(row.market.startsWith("board:")){
      if(row.market==="board:btts"&&!usedBtts){pool.push(row);usedBtts=true}
      continue
    }
    const player=normPlayer(row.player)
    if(!player||primaryPlayers.has(player))continue
    primaryPlayers.add(player)
    usedPlayerFamilies.add(player+"|"+family(row.market))
    pool.push(row)
  }

  // Pass 2: once the distinct-player route is exhausted, keep extending with
  // genuinely different high-probability event families for those players.
  // Never count nested thresholds from the same family as separate safe legs.
  const perPlayerCount=new Map<string,number>()
  for(const row of pool){
    const p=normPlayer(row.player)
    if(p)perPlayerCount.set(p,(perPlayerCount.get(p)??0)+1)
  }
  for(const row of candidates){
    if(row.market.startsWith("board:"))continue
    const player=normPlayer(row.player)
    if(!player)continue
    const key=player+"|"+family(row.market)
    if(usedPlayerFamilies.has(key))continue
    if((perPlayerCount.get(player)??0)>=1)continue
    usedPlayerFamilies.add(key)
    perPlayerCount.set(player,(perPlayerCount.get(player)??0)+1)
    pool.push(row)
    if(pool.length>=MAX_RESEARCH_BUILDER_LEGS)break
  }

  const chosen:Selection[]=[]
  let product=1
  let raw=1
  const addNext=()=>{
    const next=pool[chosen.length]
    if(!next)return false
    chosen.push(next)
    product*=Number(verifiedBet365Odd(next))
    raw*=next.probability
    return true
  }

  return configs.map(cfg=>{
    if(cfg.id==="broad-most-likely"){
      while(product<3&&chosen.length<Math.min(pool.length,MAX_RESEARCH_BUILDER_LEGS))if(!addNext())break
    }else{
      while(product<cfg.targetDecimal&&chosen.length<Math.min(pool.length,MAX_RESEARCH_BUILDER_LEGS))if(!addNext())break
    }
    const legs=[...chosen]
    const reached=product>=Math.max(3,cfg.targetDecimal)
    if(!reached)return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,modelAllHitProbability:null,
      conservativeAllHitProbability:null,safetyScore:null,exactPriced:false,bookmaker:"Bet365",
      verifiedBet365LegPrices:false,exactBet365BuilderPrice:false,pricingBasis:"none" as const,
      note:"Unavailable under the six-leg research cap; no Bet365 combined quote is available."
    }
    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs,referenceProductOdds:Math.round(product*100)/100,
      averageLegProbability:legs.reduce((sum,x)=>sum+x.probability,0)/legs.length,
      minimumLegProbability:Math.min(...legs.map(x=>x.probability)),
      modelAllHitProbability:raw,conservativeAllHitProbability:raw,safetyScore:raw,
      exactPriced:false,bookmaker:"Bet365",verifiedBet365LegPrices:true,exactBet365BuilderPrice:false,
      pricingBasis:"bet365_singles_product" as const,
      note:cfg.id==="broad-most-likely"
        ?"The strongest estimated win chance from the available verified Bet365 markets."
        :`Probability first, odds floor second. This keeps the safer route below it and adds only the next-best selection until it clears ${cfg.targetFractional}.`
    }
  })
}
function clientRiskBuilders(rows:Selection[],strictVerifiedLive=false):RiskBuilder[]{
  const configs=[
    {id:"most-likely",title:"2/1 Minimum",risk:"Safe" as const,targetFractional:"2/1",targetDecimal:3},
    {id:"target-3-1",title:"3/1",risk:"Safe" as const,targetFractional:"3/1",targetDecimal:4},
    {id:"target-5-1",title:"5/1",risk:"Safe" as const,targetFractional:"5/1",targetDecimal:6},
    {id:"target-10-1",title:"10/1",risk:"Safe" as const,targetFractional:"10/1",targetDecimal:11},
    {id:"target-15-1",title:"15/1",risk:"Balanced" as const,targetFractional:"15/1",targetDecimal:16},
    {id:"target-20-1",title:"20/1",risk:"Balanced" as const,targetFractional:"20/1",targetDecimal:21},
    {id:"target-25-1",title:"25/1",risk:"Balanced" as const,targetFractional:"25/1",targetDecimal:26},
    {id:"target-30-1",title:"30/1",risk:"Balanced" as const,targetFractional:"30/1",targetDecimal:31},
    {id:"target-40-1",title:"40/1",risk:"High Risk" as const,targetFractional:"40/1",targetDecimal:41},
    {id:"target-50-1",title:"50/1",risk:"High Risk" as const,targetFractional:"50/1",targetDecimal:51},
    {id:"target-75-1",title:"75/1",risk:"High Risk" as const,targetFractional:"75/1",targetDecimal:76},
    {id:"target-100-1",title:"100/1",risk:"High Risk" as const,targetFractional:"100/1",targetDecimal:101},
  ]
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const baseMarket=(market:string)=>market==="goal1"||market==="assist1"||market==="foul1"||market==="fouled1"||market==="card"||market==="shot1"||market==="sot1"
  const confidenceReliability=(row:Selection)=>row.confidence==="A"?1:row.confidence==="B"?.96:row.confidence==="C"?.88:.74
  const marketReliability=(row:Selection)=>{
    const f=family(row.market)
    if(f==="foul")return .995
    if(f==="fouled")return .99
    if(f==="shot")return .985
    if(f==="sot")return .95
    if(f==="card")return .91
    if(f==="goal")return .89
    if(f==="assist")return .87
    return .94
  }
  const conservativeJoint=(legs:Selection[],raw:number)=>{
    let reliability=1
    const counts:Record<string,number>={}
    for(const leg of legs){
      const f=family(leg.market)
      counts[f]=(counts[f]??0)+1
      reliability*=confidenceReliability(leg)*marketReliability(leg)
    }
    let concentration=1
    for(const count of Object.values(counts))if(count>1)concentration*=Math.pow(.975,count-1)
    return Math.max(0,Math.min(.99,raw*reliability*concentration*Math.pow(.99,Math.max(0,legs.length-2))))
  }
  const stability=(row:Selection)=>{
    const f=family(row.market)
    if(row.market==="foul1")return 1.10
    if(row.market==="fouled1")return 1.07
    if(row.market==="shot1")return 1.04
    if(row.market==="sot1")return .99
    if(f==="foul")return .98
    if(f==="fouled")return .97
    if(f==="shot")return .96
    if(f==="sot")return .93
    if(f==="card")return .84
    if(f==="goal")return .80
    if(f==="assist")return .77
    return .90
  }
  const likelihoodScore=(row:Selection)=>{
    const live=Number(row.liveRankScore??row.probability)
    const p=Number(row.probability)
    const baseBonus=baseMarket(row.market)?.035:0
    return p*.72+live*.20+stability(row)*.08+baseBonus
  }
  type PriceMode="live"|"reference"|"model"
  const oddFor=(row:Selection,mode:PriceMode)=>{
    if(mode==="live")return Number(verifiedBet365Odd(row)??0)
    if(mode==="reference")return Number(displayedBet365Odd(row)?.odd??0)
    return Number(row.fairOdds??0)
  }
  const validFor=(row:Selection,mode:PriceMode)=>{
    const odd=oddFor(row,mode)
    if(!(odd>1)||row.confidence==="D")return false
    if(row.market==="card"&&row.probability<.16)return false
    if((row.market.startsWith("goal")||row.market.startsWith("assist"))&&row.probability<.14)return false
    return true
  }
  const choosePool=(mode:PriceMode)=>{
    const eligible=rows.filter(r=>validFor(r,mode)).sort((a,b)=>{
      const scoreDiff=likelihoodScore(b)-likelihoodScore(a)
      if(Math.abs(scoreDiff)>.0001)return scoreDiff
      return b.probability-a.probability
    })
    const pool:Selection[]=[]
    const seenPlayers=new Set<string>()
    const usedPlayerFamilies=new Set<string>()

    // First use the best event for each distinct player.
    for(const row of eligible){
      const player=normPlayer(row.player)
      if(!player||seenPlayers.has(player))continue
      seenPlayers.add(player)
      usedPlayerFamilies.add(player+"|"+family(row.market))
      pool.push(row)
    }

    // Then extend the same probability route with other event families for the
    // same players. Nested thresholds in the same family are deliberately skipped.
    const perPlayerCount=new Map<string,number>()
    for(const row of pool){
      const p=normPlayer(row.player)
      if(p)perPlayerCount.set(p,(perPlayerCount.get(p)??0)+1)
    }
    for(const row of eligible){
      const player=normPlayer(row.player)
      if(!player)continue
      const key=player+"|"+family(row.market)
      if(usedPlayerFamilies.has(key))continue
      if((perPlayerCount.get(player)??0)>=3)continue
      usedPlayerFamilies.add(key)
      perPlayerCount.set(player,(perPlayerCount.get(player)??0)+1)
      pool.push(row)
      if(pool.length>=36)break
    }
    return pool
  }
  const productOf=(pool:Selection[],mode:PriceMode,count:number)=>pool.slice(0,count).reduce((v,row)=>v*oddFor(row,mode),1)
  const canReach=(pool:Selection[],mode:PriceMode,target:number)=>pool.length>=2&&productOf(pool,mode,Math.min(pool.length,MAX_RESEARCH_BUILDER_LEGS))>=target

  let mode:PriceMode="model"
  const livePool=choosePool("live")
  const refPool=choosePool("reference")
  if(canReach(livePool,"live",101))mode="live"
  else if(canReach(refPool,"reference",101))mode="reference"
  else if(canReach(livePool,"live",21))mode="live"
  else if(canReach(refPool,"reference",21))mode="reference"

  // Optimise each odds tier independently. Hull exposed a failure mode where the
  // previous ladder inherited a weak selection from every smaller builder.
  // Search bounded combinations and prefer the strongest joint hit probability,
  // with a penalty for a particularly fragile leg and same-player dependence.
  const pool=choosePool(mode).slice(0,22)
  type Candidate={legs:Selection[];price:number;joint:number;weakest:number;players:Set<string>;families:Set<string>}
  const optimise=(target:number):Candidate|null=>{
    const required=Math.max(3,target)
    let beam:Candidate[]=[{legs:[],price:1,joint:1,weakest:1,players:new Set(),families:new Set()}]
    let best:Candidate|null=null
    const quality=(c:Candidate)=>Math.log(Math.max(1e-12,c.joint))+
      Math.log(Math.max(.1,c.weakest))*.22-
      Math.max(0,c.legs.length-3)*.025
    for(let depth=1;depth<=MAX_RESEARCH_BUILDER_LEGS;depth++){
      const next:Candidate[]=[]
      for(const state of beam){
        const last=state.legs.length?pool.indexOf(state.legs[state.legs.length-1]):-1
        for(let i=last+1;i<pool.length;i++){
          const row=pool[i]
          const player=normPlayer(row.player)
          const fam=family(row.market)
          if(player&&state.players.has(player))continue
          if(state.families.has(player+"|"+fam))continue
          const price=oddFor(row,mode)
          if(!(price>1))continue
          const players=new Set(state.players)
          if(player)players.add(player)
          const families=new Set(state.families)
          families.add(player+"|"+fam)
          const candidate:Candidate={
            legs:[...state.legs,row],price:state.price*price,
            joint:state.joint*row.probability,
            weakest:Math.min(state.weakest,row.probability),
            players,families
          }
          if(candidate.price>=required){
            if(!best||quality(candidate)>quality(best))best=candidate
          }else next.push(candidate)
        }
      }
      beam=next.sort((a,b)=>{
        const aGap=Math.max(0,Math.log(required/a.price))
        const bGap=Math.max(0,Math.log(required/b.price))
        return (quality(b)-bGap*.12)-(quality(a)-aGap*.12)
      }).slice(0,160)
      if(!beam.length)break
    }
    return best
  }

  return configs.map(cfg=>{
    const found=optimise(cfg.targetDecimal)
    const legs=found?.legs??[]
    const product=found?.price??1
    const raw=found?.joint??1
    const reached=Boolean(found)
    if(!reached){
      // A missing bookmaker quote or an unreachable odds floor must not erase
      // the actual model picks: these are research predictions, not quoted bets.
      const researchLegs=choosePool("model").slice(0,Math.min(5,MAX_RESEARCH_BUILDER_LEGS))
      const joint=researchLegs.reduce((p,row)=>p*row.probability,1)
      const conservative=conservativeJoint(researchLegs,joint)
      return {
        id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
        legs:researchLegs,referenceProductOdds:null,
        averageLegProbability:researchLegs.length?researchLegs.reduce((v,row)=>v+row.probability,0)/researchLegs.length:null,
        minimumLegProbability:researchLegs.length?Math.min(...researchLegs.map(row=>row.probability)):null,
        modelAllHitProbability:researchLegs.length?joint:null,
        conservativeAllHitProbability:researchLegs.length?conservative:null,
        safetyScore:researchLegs.length?conservative:null,
        exactPriced:false,bookmaker:null,verifiedBet365LegPrices:false,referenceBet365LegPrices:false,
        exactBet365BuilderPrice:false,pricingBasis:"none" as const,
        note:"Research selections shown: the requested odds floor is not verified or reachable with available prices. These picks are model predictions, not a bookmaker-quoted builder."
      }
    }

    const conservative=conservativeJoint(legs,raw)
    const livePriced=mode==="live"
    const refPriced=mode==="reference"
    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs,referenceProductOdds:Math.round(product*100)/100,
      averageLegProbability:legs.reduce((s,x)=>s+x.probability,0)/legs.length,
      minimumLegProbability:Math.min(...legs.map(x=>x.probability)),
      modelAllHitProbability:raw,conservativeAllHitProbability:conservative,safetyScore:conservative,
      exactPriced:livePriced,bookmaker:(livePriced||refPriced)?"Bet365":null,
      verifiedBet365LegPrices:livePriced,referenceBet365LegPrices:refPriced,exactBet365BuilderPrice:false,
      pricingBasis:livePriced?"bet365_singles_product" as const:refPriced?"bet365_reference_product" as const:"none" as const,
      note:cfg.id==="most-likely"
        ?"Highest-probability route from the current eligible selections. Its price is whatever the safest route naturally produces."
        :`Independently optimised combination for ${cfg.targetFractional}, prioritising joint hit probability and avoiding weak inherited legs. Indicative singles product, not a verified Bet365 Bet Builder quote.`
    }
  })
}
function scorecardCacheKey(f:Fixture){return "match-edge:scorecard:"+[f.date,f.competition,f.home,f.away].join("|").toLowerCase()}
function readScorecardCache(f:Fixture):Scorecard|null{
  try{
    const key=scorecardCacheKey(f)
    const raw=window.localStorage.getItem(key)
    if(!raw)return null
    const parsed=JSON.parse(raw)
    const data=parsed?.data as Scorecard|undefined
    if(data?.snapshotFallback){
      const kickoff=new Date(f.kickoff).getTime()
      const now=Date.now()
      const inPlay=Number.isFinite(kickoff)&&now>=kickoff-15*60*1000&&now<=kickoff+4*60*60*1000
      if(!inPlay){
        window.localStorage.removeItem(key)
        return null
      }
    }
    return data?.ok?data:null
  }catch{return null}
}
function writeScorecardCache(f:Fixture,data:Scorecard){
  try{if(data?.ok)window.localStorage.setItem(scorecardCacheKey(f),JSON.stringify({savedAt:new Date().toISOString(),data}))}catch{}
}
function liveStateKey(f:Fixture){return "match-edge:live-state:v2:"+[f.date,f.competition,f.home,f.away].join("|").toLowerCase()}
function liveOddsStateKey(f:Fixture){return "match-edge:live-odds:v2:"+[f.date,f.competition,f.home,f.away].join("|").toLowerCase()}
function readLiveState(f:Fixture):LiveData|null{
  try{
    const raw=window.localStorage.getItem(liveStateKey(f));if(!raw)return null
    const parsed=JSON.parse(raw)
    return parsed?.data?.ok&&Array.isArray(parsed?.data?.players)?parsed.data as LiveData:null
  }catch{return null}
}
function writeLiveState(f:Fixture,data:LiveData){
  try{
    if(data?.ok&&Array.isArray(data.players)&&data.players.length){
      window.localStorage.setItem(liveStateKey(f),JSON.stringify({savedAt:new Date().toISOString(),data}))
    }
  }catch{}
}
function hasUsefulBet365LiveBoard(data:LiveOddsData|null|undefined){
  if(!data||data.bookmaker!=="Bet365")return false
  const selections=Array.isArray(data.selections)?data.selections.filter(s=>s.bookmaker==="Bet365"&&s.odd!=null&&Number(s.odd)>1):[]
  const available=Object.values(data.marketAvailability??{}).some(v=>v==="available")
  return selections.length>0||available
}
function readLiveOddsState(f:Fixture):LiveOddsData|null{
  try{
    const raw=window.localStorage.getItem(liveOddsStateKey(f));if(!raw)return null
    const parsed=JSON.parse(raw)
    return hasUsefulBet365LiveBoard(parsed?.data)?parsed.data as LiveOddsData:null
  }catch{return null}
}
function writeLiveOddsState(f:Fixture,data:LiveOddsData){
  try{
    if(hasUsefulBet365LiveBoard(data)){
      window.localStorage.setItem(liveOddsStateKey(f),JSON.stringify({savedAt:new Date().toISOString(),data}))
    }
  }catch{}
}
export default function BetBuilderPage(){
  const router=useRouter()
  const[fixture,setFixture]=useState<Fixture|null>(null)
  const[data,setData]=useState<Scorecard|null>(null)
  const[live,setLive]=useState<LiveData|null>(null)
  const[liveOdds,setLiveOdds]=useState<LiveOddsData|null>(null)
  const[loading,setLoading]=useState(true)
  const[category,setCategory]=useState<Category>("fouls")
  const[selected,setSelected]=useState<Record<string,Selection>>({})
  const[trayOpen,setTrayOpen]=useState(false)
  const[h2hOpen,setH2hOpen]=useState(false)
  const[h2hLoading,setH2hLoading]=useState(false)
  const[h2hData,setH2hData]=useState<H2HData|null>(null)
  const[trackDraft,setTrackDraft]=useState<TrackDraft|null>(null)
  const[builderMode,setBuilderMode]=useState<"all"|"player"|"discipline">("all")

  useEffect(()=>{setFixture(parseFixture())},[])
  useEffect(()=>{
    if(!fixture)return
    const cachedLive=readLiveState(fixture)
    const cachedOdds=readLiveOddsState(fixture)
    if(cachedLive)setLive(cachedLive)
    if(cachedOdds)setLiveOdds(cachedOdds)
  },[fixture])
  const load=useCallback(async(f:Fixture,force=false)=>{
    const cached=readScorecardCache(f)
    if(cached?.ok){
      setData(cached)
      setLoading(false)
      if(!force)return
    }else setLoading(true)
    // Full scorecard requests currently exceed the platform function timeout.
    // Use the bounded independent starter/history and Bet365 odds feeds.
    const params=new URLSearchParams({date:f.date,home:f.home,away:f.away,competition:f.competition})
    const quick=async(url:string,ms:number)=>{
      const c=new AbortController()
      const timer=window.setTimeout(()=>c.abort(),ms)
      try{
        const response=await fetch(url,{cache:"no-store",signal:c.signal})
        if(!response.ok)throw Error("Source HTTP "+response.status)
        return await response.json()
      }finally{window.clearTimeout(timer)}
    }
    try{
      const snapshot=await quick("/api/live-player-baseline?"+params,12_000) as Scorecard
      if(!snapshot.ok||!snapshot.players?.length)throw Error("Fast player model unavailable")
      const odds=await quick("/api/bet-builder-odds?"+params,10_000).catch(()=>null) as (LiveOddsData&{source?:string})|null
      const prices=Array.isArray(odds?.selections)?odds.selections:[]
      const players=(snapshot.players??[]).map(player=>({
        ...player,
        markets:Object.fromEntries(Object.entries(player.markets??{}).map(([key,m])=>{
          if(!m)return [key,m]
          const kind=liveKindForMarket(key)
          const threshold=thresholdForMarket(key)
          const label=key==="card"?"to be booked":key==="goal1"?"anytime goalscorer":key==="assist1"?"1+ assist":
            key.startsWith("fouled")?threshold+"+ foul"+(threshold>1?"s":"")+" drawn":
            key.startsWith("foul")?threshold+"+ foul"+(threshold>1?"s":"")+" committed":
            key.startsWith("sot")?threshold+"+ shot"+(threshold>1?"s":"")+" on target":
            threshold+"+ shot"+(threshold>1?"s":"")
          const quote=prices.find(item=>{
            if(item.bookmaker!=="Bet365"||item.kind!==kind||!item.odd||item.odd<=1)return false
            const parts=String(item.label??"").split("·")
            return parts.length>=2&&sameLivePlayer(parts[0],player.name)&&
              parts.slice(1).join("·").trim().toLowerCase()===label
          })
          const price=quote?Number(quote.odd):null
          return [key,{...m,bookmakerOdds:price,bookmakerName:price!=null?"Bet365":null,
            edge:price!=null?m.probability-1/price:null}]
        })) as ScorePlayer["markets"],
      }))
      const next:Scorecard={...snapshot,players,snapshotFallback:true,
        fallbackReason:"Fast historical snapshot shown because the full evidence service is slow. Recheck before betting.",
        bookmaker:odds?.priceAvailable?"Bet365":null,
        oddsSource:odds?.source??null,oddsCapturedAt:odds?.capturedAt??null,
        priceAvailable:Boolean(odds?.priceAvailable),oddsFreshness:odds?.priceAvailable?"LIVE":"UNKNOWN",
        marketAvailability:odds?.marketAvailability??{},
        bookmakerAvailability:odds?.bookmakerAvailability??{},
        availableBets:odds?.availableBets??[],
      }
      setData(next)
      writeScorecardCache(f,next)
    }catch{
      if(!cached)setData({ok:false,error:"Match model is slow or temporarily unavailable. Try the match centre or refresh."})
    }finally{setLoading(false)}
  },[])
  useEffect(()=>{if(fixture)void load(fixture,false)},[fixture,load])
  useEffect(()=>{
    if(!fixture||data?.lineupsConfirmed===true||data?.lineupMode==="confirmed")return
    const kickoff=new Date(fixture.kickoff).getTime()
    if(!Number.isFinite(kickoff))return

    const windowStart=kickoff-120*60*1000
    const windowEnd=kickoff+10*60*1000
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
      interval=window.setInterval(()=>void check(),30000)
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
    try{
      const r=await fetch(liveUrl(f),{cache:"no-store"})
      if(!r.ok)return
      const next=await r.json() as LiveData
      if(next?.ok&&Array.isArray(next.players)&&next.players.length){
        setLive(current=>{
          // Never move the live match backwards because one provider returned an
          // older snapshot. Keep the newest captured match state.
          if(current?.ok&&current.status!=="scheduled"&&Number(current.elapsed??0)>Number(next.elapsed??0))return current
          return next
        })
        writeLiveState(f,next)
      }
    }catch{
      // Deliberately keep the previous successful live state.
    }
  },[])
  useEffect(()=>{if(!fixture)return;void loadLive(fixture);const t=window.setInterval(()=>void loadLive(fixture),30000);return()=>window.clearInterval(t)},[fixture,loadLive])
  const liveActiveRosterSignature=useMemo(()=>live
    ? live.players.filter(livePlayerIsActive).map(p=>normPlayer(p.player)).sort().join("|")
    : "",[live])
  const loadLiveBaseline=useCallback(async(f:Fixture,currentLive:LiveData)=>{
    if(!(currentLive.status==="live"||currentLive.status==="halftime")||!currentLive.players?.length)return
    const active=currentLive.players.filter(livePlayerIsActive)
    try{
      const r=await fetch(liveBaselineUrl(f,currentLive),{cache:"default"})
      if(!r.ok)return
      const next=await r.json() as Scorecard
      if(next?.ok&&next.players?.length){
        setData(current=>{
          const merged={...next,referee:next.referee??current?.referee??null}
          writeScorecardCache(f,merged)
          return merged
        })
        setLoading(false)
      }
    }catch{}
  },[])
  useEffect(()=>{
    if(!fixture||!live||!liveActiveRosterSignature)return
    void loadLiveBaseline(fixture,live)
  },[fixture,liveActiveRosterSignature,loadLiveBaseline])
  const loadLiveOdds=useCallback(async(f:Fixture)=>{
    try{
      const r=await fetch(liveOddsUrl(f),{cache:"no-store"})
      if(!r.ok)return
      const next=await r.json() as LiveOddsData
      // Only replace the saved Bet365 board when the refresh actually captured a
      // usable player board. A temporary empty/unavailable provider response must
      // never wipe the last successful live prices and market availability.
      if(hasUsefulBet365LiveBoard(next)){
        setLiveOdds(next)
        writeLiveOddsState(f,next)
      }
    }catch{
      // Keep the last successful Bet365 live board.
    }
  },[])
  useEffect(()=>{
    if(!fixture||!(live?.status==="live"||live?.status==="halftime"))return
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
  // The 22 screenshot-confirmed starters for Liverpool v Manchester United.
  // Restrict every player market and recommended builder to starters, rather than
  // allowing squad members or predicted XI players into the betting shortlist.
  const suppliedStartingXI=useMemo(()=>{
    if(!fixture||fixture.date!=="2026-11-22"||
      !sameTeamName(fixture.home,"Liverpool")||!sameTeamName(fixture.away,"Manchester United"))return null
    return new Set([
      "Alisson","Ronald Araújo","Jérémy Jacquet","Virgil van Dijk","Milos Kerkez",
      "Dominik Szoboszlai","Alexis Mac Allister","Rio Ngumoha","Florian Wirtz",
      "Bradley Barcola","Alexander Isak","Senne Lammens","Leny Yoro",
      "Matthijs de Ligt","Lisandro Martínez","Diogo Dalot","Kobbie Mainoo",
      "Youri Tielemans","Patrick Dorgu","Bruno Fernandes","Bryan Mbeumo","Matheus Cunha"
    ].map(normPlayer))
  },[fixture])
  const allRows=useMemo(()=>{
    const rows=overlayVerifiedLiveBet365(liveAdjustedRows,liveOdds)
    if(!suppliedStartingXI)return rows
    // Once play starts, substitutions supersede the original XI where the
    // live feed explicitly identifies active players.
    const activeLive=(live?.status==="live"||live?.status==="halftime")
      ?(live.players??[]).filter(livePlayerIsActive):[]
    const active=activeLive.length>=11
      ?new Set(activeLive.map(p=>normPlayer(p.player)))
      :suppliedStartingXI
    return rows.filter(row=>{
      const name=normPlayer(row.player)
      return active.has(name)||[...active].some(x=>x.endsWith(" "+name)||name.endsWith(" "+x))
    })
  },[liveAdjustedRows,liveOdds,suppliedStartingXI,live])

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
      const model=Number(row.liveRankScore??(row.market==="card"
        ? (row.liveAdjusted?row.probability:Number(row.recommendationScore??row.probability))
        : row.probability))
      const marketSignal=row.referenceImpliedProbability!=null?Math.min(.08,Math.max(-.04,(row.referenceImpliedProbability-row.probability)*.12)):0
      return traffic+model*.22+Math.max(0,row.edge??0)*.15+marketSignal
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
  const cardRiskRows=useMemo(()=>allRows
    .filter(r=>r.market==="card")
    .sort((a,b)=>{
      // Live card risk is driven first by actual foul involvement in this match.
      // Fouls committed matter most; fouls drawn are a smaller involvement signal.
      const aScore=Number(a.probability)*.62+Math.min(.15,Number(a.liveFoulsCommitted??0)*.045)+Math.min(.03,Number(a.liveFoulsDrawn??0)*.008)
        +Math.min(.22,Number(a.disciplineHeat??0)*.22)+Math.min(.12,Number(a.recentFouls10??0)*.06)
        +(a.referenceImpliedProbability!=null?Math.min(.035,Math.max(-.02,(a.referenceImpliedProbability-a.probability)*.10)):0)
      const bScore=Number(b.probability)*.62+Math.min(.15,Number(b.liveFoulsCommitted??0)*.045)+Math.min(.03,Number(b.liveFoulsDrawn??0)*.008)
        +Math.min(.22,Number(b.disciplineHeat??0)*.22)+Math.min(.12,Number(b.recentFouls10??0)*.06)
        +(b.referenceImpliedProbability!=null?Math.min(.035,Math.max(-.02,(b.referenceImpliedProbability-b.probability)*.10)):0)
      return bScore-aScore||Number(b.liveFoulsCommitted??0)-Number(a.liveFoulsCommitted??0)||b.probability-a.probability
    })
    .slice(0,8),[allRows])
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
  const playerBuilders=!inPlay&&serverBuilders.length?serverBuilders:clientRiskBuilders(allRows,true)
  const disciplineBuilders=!inPlay&&disciplineServerBuilders.length?disciplineServerBuilders:clientRiskBuilders(disciplineRows,true)
  const broadHasBuild=broadTargetBuilders.some(b=>b.legs?.length)
  const candidateBuilders=builderMode==="discipline"
    ?disciplineBuilders
    :builderMode==="player"
      ?playerBuilders
      :!inPlay&&serverBuilders.length
        ?serverBuilders
        :broadHasBuild
          ?broadTargetBuilders
          :playerBuilders
  const builders=candidateBuilders.filter(b=>b.legs?.length&&b.referenceProductOdds!=null&&b.referenceProductOdds>=3 || (b.legs?.length&&b.referenceProductOdds==null))
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
    if(!fixture||!data?.ok||(!inPlay&&data.snapshotFallback))return
    // Never record a post-kickoff view as a pre-match forecast when the live feed is missing.
    if(!inPlay&&Date.now()>=new Date(fixture.kickoff).getTime())return
    if(inPlay&&Date.now()<new Date(fixture.kickoff).getTime())return
    const fixtureInfo={id:fixture.id,competition:fixture.competition,kickoff:fixture.kickoff,date:fixture.date,home:fixture.home,away:fixture.away}
    const ref=live?.referee??null
    const base={
      fixture:fixtureInfo,
      lineupConfirmed:data.lineupMode==="confirmed"||data.lineupsConfirmed===true,
      live:inPlay,
      liveMinute:inPlay?Number(live?.elapsed??0):null,
      referee:ref?{name:ref.name??null,strictnessScore:ref.strictnessScore??null}:null,
    }
    const runs:any[]=[]
    {
      for(const build of builders){
        const legs=(build.legs??[]).map(row=>ledgerLeg(row,fixture,live)).filter(Boolean)
        if(!legs.length)continue
        runs.push({
          ...base,
          surface:inPlay?"match_builder_live":"match_builder",
          slip:{
            id:build.id,title:build.title,tier:build.risk,oddsTarget:build.targetFractional,
            combinedOdds:build.referenceProductOdds??null,
            modelJointProbability:build.conservativeAllHitProbability??build.modelAllHitProbability??null,
            bookmaker:build.bookmaker??null,
          },
          legs,
        })
      }
    }
    if(cardRiskRows.length){
      const legs=cardRiskRows.slice(0,8).map(row=>ledgerLeg(row,fixture,live)).filter(Boolean)
      if(legs.length)runs.push({
        ...base,surface:"match_card_risk",
        slip:{id:"card-risk",title:"Live Card Risk",tier:"ranking",oddsTarget:null,combinedOdds:null,modelJointProbability:null,bookmaker:"Bet365"},
        legs,
      })
    }
    const likelihoodLegs=visible.slice(0,20).map(row=>ledgerLeg(row,fixture,live)).filter(Boolean)
    if(likelihoodLegs.length)runs.push({
      ...base,surface:inPlay?"match_likelihood_live":"match_likelihood",
      slip:{id:"likelihood-"+category,title:(inPlay?"Live ":"")+"Likelihood · "+category,tier:"ranking",oddsTarget:null,combinedOdds:null,modelJointProbability:null,bookmaker:"Bet365"},
      legs:likelihoodLegs,
    })
    // Persist every market family even when the visitor is viewing another tab.
    // Otherwise a pre-match visit to "Popular" leaves no card/foul baseline.
    const auditFamilies=[
      {id:"cards",markets:["card"]},
      {id:"fouls",markets:["foul"]},
      {id:"fouled",markets:["fouled"]},
      {id:"shots",markets:["shot"]},
      {id:"sot",markets:["sot"]},
      {id:"goals",markets:["goal"]},
      {id:"assists",markets:["assist"]},
    ]
    for(const family of auditFamilies){
      const rows=allRows.filter(row=>family.markets.some(m=>m==="card"?row.market==="card":row.market.startsWith(m)))
        .sort((a,b)=>b.probability-a.probability)
      const legs=rows.slice(0,30).map(row=>ledgerLeg(row,fixture,live)).filter(Boolean)
      if(!legs.length)continue
      runs.push({...base,surface:inPlay?"market_audit_live":"market_audit_pre",
        slip:{id:"all-"+family.id,title:(inPlay?"Live ":"Pre-match ")+family.id+" audit",tier:"ranking",oddsTarget:null,combinedOdds:null,modelJointProbability:null,bookmaker:null},legs})
    }
    if(!runs.length)return
    void fetch("/api/prediction-ledger",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({runs}),keepalive:true}).catch(()=>{})
  },[fixture,data?.ok,data?.lineupMode,data?.lineupsConfirmed,builders,builderMode,cardRiskRows,visible,category,allRows,inPlay,live?.elapsed,live?.referee])
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
          <button onClick={()=>router.push("/hull-review")} className="rounded-xl border border-white/10 bg-white/6 px-2.5 py-2.5 text-[0.55rem] font-black text-emerald-200">Results</button>
          <button onClick={()=>void toggleH2H()} className={"rounded-xl border px-3 py-2.5 text-[0.55rem] font-black "+(h2hOpen?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/10 bg-white/6 text-white/55")}>H2H</button>
          <button onClick={()=>{
            if(inPlay){
              void loadLive(fixture)
              if(live)void loadLiveBaseline(fixture,live)
              void loadLiveOdds(fixture)
            }else{
              void load(fixture,true)
            }
          }} className="rounded-xl bg-emerald-400 p-2.5 text-emerald-950"><RefreshCw className={"size-4 "+(loading?"animate-spin":"")}/></button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
      {h2hOpen?<H2HPanel data={h2hData} loading={h2hLoading} home={fixture.home} away={fixture.away}/>:null}
      {inPlay?<LiveMatchStatsPanel live={live} home={fixture.home} away={fixture.away} onRefresh={()=>void loadLive(fixture)}/>:null}
      {loading&&!data&&!inPlay?<section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center"><RefreshCw className="mx-auto mb-3 size-5 animate-spin text-emerald-300"/><p className="font-black">Building evidenced model…</p><p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/35">Loading the full recent-form, season, H2H, lineup, referee and market model. Snapshot probabilities are not shown as recommendations.</p></section>:null}
      {loading&&!data&&inPlay?<section className="rounded-3xl border border-emerald-300/12 bg-emerald-400/[0.045] p-4"><div className="flex items-center gap-3"><RefreshCw className="size-4 animate-spin text-emerald-300"/><div><p className="text-sm font-black">Loading live player model…</p><p className="mt-1 text-[0.54rem] text-white/35">Current score and live events are already connected. Player rankings will appear as soon as the cached or fresh scorecard is available.</p></div></div></section>:null}
      {data&&!data.ok?<section className="rounded-3xl border border-rose-300/15 bg-rose-400/5 p-5"><p className="font-black">Match model unavailable</p><p className="mt-1 text-sm text-white/40">{data.error}</p></section>:null}

      {data?.ok&&data.snapshotFallback?<section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4"><p className="text-sm font-black text-amber-100">Fast match view — limited research model</p><p className="mt-1 text-xs leading-relaxed text-white/55">{data.fallbackReason} Player estimates use the current snapshot, not the full referee/H2H model. Exact Bet365 singles prices are included where available, but no combined odds are implied.</p></section>:null}
       {data?.ok&&data.lineupMode==="predicted"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-4"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 size-5 shrink-0 text-amber-300"/><div><p className="font-black text-amber-100">Predicted XI active</p><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{data.lineupSource??"Probable starters based on recent selection history and minutes."} The page checks the official team sheet every 30 seconds from two hours before kickoff until confirmation. Once both starting XIs are verified, anyone benched is removed and every probability and slip is rebuilt from the confirmed starters.</p></div></div></section>:data?.ok&&data.lineupMode==="squad"?<section className="rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] p-6 text-center"><Clock3 className="mx-auto size-6 text-amber-300"/><p className="mt-3 font-black">No reliable XI yet</p><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-white/40">The match is still available, but player recommendations need a probable or confirmed starting XI.</p></section>:null}

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
          <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-emerald-300"><Sparkles className="size-4"/><p className="text-[0.54rem] font-black uppercase tracking-[0.13em]">{inPlay&&!liveBet365?"Suggested live model slips":"Suggested Bet365 slips"}</p></div><h2 className="mt-1 text-lg font-black">{builderMode==="discipline"?"Most likely to be carded":builderMode==="player"?"Player markets":"All markets"}</h2><p className="mt-1 text-[0.6rem] leading-relaxed text-white/40">{builderMode==="discipline"?"One live ranking based mainly on who is committing fouls and who is being fouled right now, combined with each player's normal card risk and Bet365 card price when available.":builderMode==="player"?"Only player props are considered: goals, assists, shots, shots on target, cards, fouls committed and fouls drawn. Each row shows the Bet365 price captured for that exact player line when available.":inPlay?"Everything Bet365 currently offers can be considered, including match result, goals, BTTS, team goals, corners, bookings and verified player props.":"Everything Bet365 offers can be considered, including result, goals, BTTS, team goals, corners, bookings and all verified player props."}</p></div><span className={"rounded-full px-2 py-1 text-[0.46rem] font-black "+(data.lineupMode==="confirmed"?"bg-emerald-400/10 text-emerald-300":"bg-amber-300/10 text-amber-200")}>{data.lineupMode==="confirmed"?"XI CONFIRMED":"PREDICTED XI"}</span></div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button onClick={()=>setBuilderMode("all")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="all"?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/8 bg-white/[0.04] text-white/45")}>ALL MARKETS</button>
            <button onClick={()=>setBuilderMode("player")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="player"?"border-cyan-300/30 bg-cyan-300 text-cyan-950":"border-white/8 bg-white/[0.04] text-white/45")}>PLAYER MARKETS</button>
            <button onClick={()=>setBuilderMode("discipline")} className={"rounded-xl border px-2 py-2.5 text-[0.5rem] font-black "+(builderMode==="discipline"?"border-amber-300/30 bg-amber-300 text-amber-950":"border-white/8 bg-white/[0.04] text-white/45")}>CARD RISK</button>
          </div>
          {builderMode==="discipline"
            ?<CardRiskPanel rows={cardRiskRows} fixture={fixture} live={live} liveBet365={liveBet365}/>
            :<div className="mt-4 space-y-2">{builders.length?builders.map((b,i)=><RiskCard key={b.id} build={b} liveBet365={liveBet365} inPlay={inPlay} onTrack={()=>trackBuild(b)} onUse={()=>useBuild(b)} fixture={fixture} defaultOpen={i===0}/>):<div className="sm:col-span-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-center"><p className="text-xs font-black text-white/55">No target slip available yet</p><p className="mt-1 text-[0.5rem] text-white/25">{builderMode==="player"
              ?"Not enough qualifying player-prop legs reach this target yet."
              :"Not enough qualifying markets reach this target yet."}</p></div>}</div>}
        </section>

        <section className="space-y-3">
          <div className="px-1"><p className="font-black">{inPlay?"Live likelihood":"Player likelihood"}</p><p className="mt-1 text-[0.6rem] text-white/35">{inPlay?"What is most likely to happen from the current minute onward, using the live match state plus each player's history. Already-hit thresholds are removed automatically.":"Ranked player-event probabilities from the model. Bet365 prices are shown only as price context where we have them."}</p></div>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"><div className="flex min-w-max gap-2 pb-1">{categories.filter(x=>x.id!=="popular").map(x=><button key={x.id} onClick={()=>setCategory(x.id)} className={"rounded-full border px-3.5 py-2.5 text-xs font-black "+(category===x.id?"border-emerald-300/30 bg-emerald-300 text-emerald-950":"border-white/8 bg-white/[0.04] text-white/50")}>{x.label}</button>)}</div></div>

          <LikelihoodBoard rows={visible} allRows={allRows} preMatchRows={preMatchRows} live={live} category={category==="popular"?"fouls":category} fixture={fixture} inPlay={inPlay}/>
        </section>


      </>:null}
    </div>

    {selectedRows.length?<BuilderTray rows={selectedRows} referenceProduct={referenceProduct} modelProduct={modelProduct} risk={customRisk} open={trayOpen} setOpen={setTrayOpen} onRemove={row=>toggle(row)} onClear={()=>setSelected({})} onTrack={trackCustom} fixture={fixture}/>:null}
    {trackDraft?<TrackBetModal draft={trackDraft} fixture={fixture} onClose={()=>setTrackDraft(null)} onSaved={()=>{setTrackDraft(null);router.push("/performance")}}/>:null}
  </main>
}


type LiveStatSort="foulsCommitted"|"foulsDrawn"|"shots"|"shotsOnTarget"|"yellowCards"|"tackles"|"disciplineHeat"
function LiveMatchStatsPanel({live,home,away,onRefresh}:{live:LiveData|null;home:string;away:string;onRefresh:()=>void}){
  const[sort,setSort]=useState<LiveStatSort>("foulsCommitted")
  const[team,setTeam]=useState<"all"|"home"|"away">("all")
  const[expanded,setExpanded]=useState(false)
  const active=useMemo(()=>{
    if(!live?.players)return []
    return live.players.filter(p=>livePlayerIsActive(p)||p.subbedOff)
      .filter(p=>team==="all"||(team==="home"?sameTeamName(p.team,home):sameTeamName(p.team,away)))
      .sort((a,b)=>Number(b[sort]??0)-Number(a[sort]??0)||Number(b.foulsCommitted??0)-Number(a.foulsCommitted??0)||a.player.localeCompare(b.player))
  },[live,sort,team,home,away])
  const shown=expanded?active:active.slice(0,8)
  const booked=useMemo(()=>live?.players?.filter(p=>Number(p.yellowCards??0)>0||Number(p.redCards??0)>0)
    .sort((a,b)=>Number(b.yellowCards??0)-Number(a.yellowCards??0))??[],[live])
  const yellowTotal=live?.players?.reduce((sum,p)=>sum+Number(p.yellowCards??0),0)??0
  const redTotal=live?.players?.reduce((sum,p)=>sum+Number(p.redCards??0),0)??0
  const options:Array<{key:LiveStatSort;label:string}>=[
    {key:"foulsCommitted",label:"Fouls"},{key:"foulsDrawn",label:"Fouled"},
    {key:"yellowCards",label:"Yellow cards"},{key:"shots",label:"Shots"},
    {key:"shotsOnTarget",label:"SOT"},{key:"tackles",label:"Tackles"},
    {key:"disciplineHeat",label:"Heat"},
  ]
  const updated=live?.updatedAt?new Date(live.updatedAt):null
  const updatedText=updated&&!Number.isNaN(updated.getTime())?updated.toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"unavailable"
  return <section className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[0.045] p-3 sm:p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-[0.52rem] font-black uppercase tracking-[0.13em] text-emerald-300">Live match stats · actual counts</p>
        <h2 className="mt-1 text-base font-black">Player fouls, cards & shots</h2>
        <p className="mt-1 text-[0.52rem] text-white/40">{live?.source??"Checking live provider"} · {live?.status==="halftime"?"Half time":live?.elapsed?live.elapsed+"'":"Awaiting live feed"} · Updated {updatedText} UK</p>
      </div>
      <button onClick={onRefresh} aria-label="Refresh live player statistics" className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-emerald-200"><RefreshCw className="size-4"/></button>
    </div>
    {live?.players?.length?<>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.055] p-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-300 text-sm font-black text-amber-950">{yellowTotal}</span>
        <div className="min-w-0 flex-1"><p className="text-xs font-black text-amber-100">Yellow cards issued</p><p className="text-[0.5rem] text-white/45">{booked.length?booked.length+" player"+(booked.length===1?"":"s")+" booked / sent off":"No players booked in this feed yet"} · {redTotal} red</p></div>
      </div>
      {booked.length?<div className="mt-2"><p className="mb-1.5 text-[0.5rem] font-black uppercase tracking-wide text-amber-200/70">Already booked · live match</p><div className="flex flex-wrap gap-1.5">{booked.map(p=><span key={p.team+"|"+p.player} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.075] px-2.5 py-2 text-[0.58rem] font-bold text-amber-100"><span className="mr-1 rounded-sm bg-amber-300 px-1 py-0.5 font-black text-amber-950">{p.yellowCards} YC</span>{p.player} <span className="text-amber-100/40">· {p.foulsCommitted} fouls{p.redCards>0?" · RED":""}</span></span>)}</div></div>:null}
      <div className="mt-3 flex flex-wrap gap-1.5">{(["all","home","away"] as const).map(v=><button key={v} onClick={()=>{setTeam(v);setExpanded(false)}} className={"max-w-full truncate rounded-lg px-2.5 py-2 text-[0.57rem] font-bold "+(team===v?"bg-emerald-300 text-emerald-950":"bg-white/[0.07] text-white/65")}>{v==="all"?"Both teams":v==="home"?home:away}</button>)}</div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">{options.map(x=><button key={x.key} onClick={()=>setSort(x.key)} className={"shrink-0 rounded-lg border px-2.5 py-1.5 text-[0.52rem] font-black "+(sort===x.key?"border-cyan-300/30 bg-cyan-300/15 text-cyan-100":"border-white/10 bg-white/[0.03] text-white/45")}>{x.label}</button>)}</div>
      <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-white/[0.055] text-[0.49rem] font-black uppercase text-white/40"><tr><th className="px-2.5 py-2">Player</th><th className="px-1.5 py-2 text-center">Min</th><th className="px-1.5 py-2 text-center">Fouls</th><th className="px-1.5 py-2 text-center">Won</th><th className="px-1.5 py-2 text-center text-amber-200">Yellow</th><th className="px-1.5 py-2 text-center">Shots</th><th className="px-1.5 py-2 text-center">SOT</th><th className="px-1.5 py-2 text-center">Tkl</th><th className="px-1.5 py-2 text-center">Heat</th></tr></thead>
          <tbody>{shown.map(p=><tr key={p.team+"|"+p.player} className="border-t border-white/[0.06] text-[0.62rem]">
            <td className="max-w-[170px] px-2.5 py-2"><p className="truncate font-black">{p.player}</p><p className="truncate text-[0.44rem] text-white/35">{p.team}{p.subbedOff?" · OFF":p.subbedOn?" · SUB":""}</p></td>
            <td className="px-1.5 text-center font-mono text-white/50">{p.minutes??"—"}</td>
            <td className={"px-1.5 text-center font-mono font-black "+(sort==="foulsCommitted"?"text-cyan-200":"text-white")}>{p.foulsCommitted}</td>
            <td className="px-1.5 text-center font-mono">{p.foulsDrawn}</td>
            <td className="px-1.5 text-center font-mono"><span className={"inline-flex min-w-6 justify-center rounded px-1 py-1 font-black "+(p.yellowCards>0?"bg-amber-300 text-amber-950":"text-white/40")}>{p.yellowCards}</span>{p.redCards>0?<span className="ml-1 rounded bg-red-500 px-1 py-1 font-black text-white">{p.redCards}R</span>:null}</td>
            <td className="px-1.5 text-center font-mono">{p.shots}</td>
            <td className="px-1.5 text-center font-mono">{p.shotsOnTarget}</td>
            <td className="px-1.5 text-center font-mono">{p.tackles}</td>
            <td className="px-1.5 text-center font-mono text-orange-200">{Math.round(Number(p.disciplineHeat??0)*100)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {active.length>8?<button onClick={()=>setExpanded(v=>!v)} className="mt-2 w-full rounded-xl bg-white/[0.06] py-2 text-xs font-black text-white/70">{expanded?"Show top 8":"Show all "+active.length+" active players"}</button>:null}
      <p className="mt-2 text-[0.47rem] leading-relaxed text-white/35">Raw feed totals, not model forecasts. Heat is a 0–100 calculated discipline signal, not an official statistic. Refreshes every 30 seconds; coverage and update timing depend on the provider.</p>
    </>:<p className="mt-3 rounded-xl bg-black/20 p-3 text-xs text-white/45">No confirmed live player counts available yet. Figures will appear when the feed supplies player statistics.</p>}
  </section>
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

function CardRiskPanel({rows,fixture,live,liveBet365}:{rows:Selection[];fixture:Fixture;live:LiveData|null;liveBet365:boolean}){
  return <div className="mt-4 overflow-hidden rounded-2xl border border-amber-300/14 bg-black/20">
    <div className="border-b border-white/7 px-3 py-3">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black text-amber-100">Live card risk</p><p className="mt-1 text-[0.48rem] text-white/30">Ranked from live discipline heat, referee strictness, foul load, recent foul bursts and any dangerous/reckless, confrontation or dissent signals in the commentary, then normal card history and Bet365 price.</p>{live?.referee?.name?<div className="mt-2 flex flex-wrap gap-1.5"><span className={"rounded-full px-2 py-1 text-[0.42rem] font-black "+(live.referee.strictnessLabel==="strict"?"bg-rose-300/12 text-rose-100":live.referee.strictnessLabel==="lenient"?"bg-emerald-300/10 text-emerald-100":"bg-white/6 text-white/45")}>REF {live.referee.name} · {live.referee.strictnessLabel.toUpperCase()}</span>{live.referee.historicalYellowsPerGame!=null?<span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/40">{Number(live.referee.historicalYellowsPerGame).toFixed(1)} YC/G</span>:null}{live.referee.liveYellowsPer90!=null?<span className="rounded-full bg-amber-300/10 px-2 py-1 text-[0.42rem] font-black text-amber-100">LIVE {Number(live.referee.liveYellowsPer90).toFixed(1)} YC/90</span>:null}</div>:null}</div>{live?<span className="rounded-full bg-rose-300/10 px-2 py-1 text-[0.42rem] font-black text-rose-200">{live.elapsed}' LIVE</span>:null}</div>
    </div>
    {rows.length?rows.map((row,i)=><div key={row.id} className={"grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 "+(i?"border-t border-white/[0.055]":"")}>
      <span className={"flex size-8 items-center justify-center rounded-full font-mono text-xs font-black "+(i===0?"bg-amber-300 text-amber-950":"bg-white/6 text-white/45")}>{i+1}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-black">{row.player}</p><TeamBadge team={row.team} fixture={fixture}/></div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-rose-300/10 px-2 py-0.5 text-[0.42rem] font-black text-rose-100">FOULS {Number(row.liveFoulsCommitted??0)}</span>
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[0.42rem] font-black text-cyan-100">FOULED {Number(row.liveFoulsDrawn??0)}</span>
          {row.disciplineHeat!=null?<span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[0.42rem] font-black text-amber-100">HEAT {Math.round(Number(row.disciplineHeat)*100)}</span>:null}
          {Number(row.recentFouls10??0)>0?<span className="rounded-full bg-rose-300/10 px-2 py-0.5 text-[0.42rem] font-black text-rose-100">+{Number(row.recentFouls10)} RECENT FOUL{Number(row.recentFouls10)===1?"":"S"}</span>:null}
          {(row.aggressionSignals??[]).slice(0,1).map(signal=><span key={signal} className="rounded-full bg-orange-300/10 px-2 py-0.5 text-[0.42rem] font-black text-orange-100">{signal.toUpperCase()}</span>)}
          {row.referenceBookmakerOdds?<span className="rounded-full bg-emerald-300/10 px-2 py-0.5 text-[0.42rem] font-black text-emerald-100">{row.referenceOddsLive?"BET365 LIVE ":"LAST BET365 "}{Number(row.referenceBookmakerOdds).toFixed(2)}</span>:null}
        </div>
        <MarketHistoryBadge player={row.player} team={row.team} market="card" date={fixture.date} home={fixture.home} away={fixture.away} competition={fixture.competition}/>
      </div>
      <div className="text-right"><p className="font-mono text-lg font-black text-amber-100">{percent(row.probability)}</p><p className="text-[0.4rem] font-black uppercase text-white/25">card chance</p></div>
    </div>):<p className="px-4 py-8 text-center text-sm text-white/35">No unbooked card candidates available right now.</p>}
    <div className="border-t border-white/7 px-3 py-2 text-[0.43rem] leading-relaxed text-white/25">Players already booked or substituted off are removed. {liveBet365?"Fresh Bet365 card prices are included in the ranking.":"If Bet365's live board drops, the last captured card price is only a light reference; the live foul counts continue updating."}</div>
  </div>
}

function marketEvidence(row:Selection){
  if(row.market.startsWith("board:"))return null
  const sample=Math.max(0,Number(row.sampleMatches??0))
  const seasonN=Math.max(0,Number(row.seasonMatches??0))
  const recent5N=Math.min(5,sample)
  const recent10N=Math.min(10,sample)
  const h2hN=Math.max(0,Number(row.h2hMatches??0))
  const recent5=Number(row.recent5HitRate),recent10=Number(row.recent10HitRate),season=Number(row.seasonHitRate),h2h=Number(row.h2hHitRate)
  const bits:string[]=[]
  if(Number.isFinite(recent5)&&recent5N>0)bits.push("L5 "+Math.max(0,Math.min(recent5N,Math.round(recent5*recent5N)))+"/"+recent5N)
  if(Number.isFinite(recent10)&&recent10N>0)bits.push("L10 "+Math.max(0,Math.min(recent10N,Math.round(recent10*recent10N)))+"/"+recent10N)
  if(Number.isFinite(season)&&seasonN>0)bits.push("Season "+Math.max(0,Math.min(seasonN,Math.round(season*seasonN)))+"/"+seasonN)
  if(Number.isFinite(h2h)&&h2hN>0)bits.push("H2H "+Math.max(0,Math.min(h2hN,Math.round(h2h*h2hN)))+"/"+h2hN)
  return bits.length?bits.join(" · "):null
}
function WhySelection({row}:{row:Selection}){
  const price=displayedBet365Odd(row)
  const sample=Math.max(0,Number(row.sampleMatches??0)),seasonN=Math.max(0,Number(row.seasonMatches??0)),h2hN=Math.max(0,Number(row.h2hMatches??0))
  const stat=(label:string,value:string)=><div className="rounded-lg bg-white/[0.045] px-2 py-1.5"><p className="text-[0.38rem] font-black uppercase text-white/25">{label}</p><p className="mt-0.5 font-mono text-[0.5rem] font-black text-white/65">{value}</p></div>
  return <details className="mt-2 rounded-xl border border-white/7 bg-black/15">
    <summary className="cursor-pointer list-none px-2.5 py-2 text-[0.46rem] font-black text-cyan-100/70">Why this selection?</summary>
    <div className="border-t border-white/7 p-2.5">
      <div className="grid grid-cols-3 gap-1.5">
        {stat("Last 5",row.recent5HitRate!=null?percent(row.recent5HitRate):"No sample")}
        {stat("Last 10",row.recent10HitRate!=null?percent(row.recent10HitRate):"No sample")}
        {stat("Season",seasonN?percent(row.seasonHitRate)+" · "+seasonN+" games":"No sample")}
        {stat("Season /90",row.seasonPer90!=null?Number(row.seasonPer90).toFixed(2):"—")}
        {stat("H2H",h2hN&&row.h2hHitRate!=null?percent(row.h2hHitRate)+" · "+h2hN+" games":"No sample")}
        {stat("H2H similarity",row.h2hSimilarity!=null?percent(row.h2hSimilarity):"—")}
        {stat("Lineup overlap",row.h2hLineupOverlap!=null?percent(row.h2hLineupOverlap):"—")}
        {stat("Model",percent(row.probability))}
        {stat("Confidence",row.confidence)}
      </div>
      <p className="mt-2 text-[0.44rem] leading-relaxed text-white/40">{row.reason||"Player history, role and matchup evidence."}</p>
      <p className="mt-1 text-[0.42rem] text-white/25">{price?(price.state==="live"?"Verified Bet365 "+price.odd.toFixed(3):"Last captured Bet365 "+price.odd.toFixed(3)):"No verified Bet365 price"} · data {String(row.dataFreshness??"model").toLowerCase()}</p>
    </div>
  </details>
}

function betSummary(build:RiskBuilder){
  const legs=build.legs??[]
  if(!legs.length)return null
  const families=legs.reduce((acc,row)=>{
    const f=row.market.startsWith("fouled")?"fouled":row.market.startsWith("foul")?"fouls":row.market.startsWith("sot")?"SOT":row.market.startsWith("shot")?"shots":row.market.startsWith("goal")?"goals":row.market.startsWith("assist")?"assists":row.market==="card"?"cards":"other"
    acc[f]=(acc[f]??0)+1
    return acc
  },{} as Record<string,number>)
  const familyText=Object.entries(families)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,4)
    .map(([name,count])=>count+" "+name)
    .join(" · ")
  const recentSupported=legs.filter(row=>Number(row.recent5HitRate??0)>=.6).length
  const seasonSupported=legs.filter(row=>Number(row.seasonHitRate??0)>=.6).length
  const h2hSupported=legs.filter(row=>Number(row.h2hMatches??0)>0&&Number(row.h2hHitRate??0)>=.5).length
  const evidenceBits=[
    recentSupported?recentSupported+"/"+legs.length+" strong recent form":null,
    seasonSupported?seasonSupported+"/"+legs.length+" strong season form":null,
    h2hSupported?h2hSupported+" with supportive H2H":null,
  ].filter(Boolean)
  return {
    markets:familyText,
    evidence:evidenceBits.join(" · "),
  }
}

function RiskCard({build,onUse,onTrack,liveBet365=false,inPlay=false,fixture,defaultOpen=false}:{build:RiskBuilder;onUse:()=>void;onTrack:()=>void;liveBet365?:boolean;inPlay?:boolean;fixture:Fixture;defaultOpen?:boolean}){
  const[open,setOpen]=useState(defaultOpen)
  const tone=build.risk==="Safe"?"border-emerald-300/18 bg-emerald-400/[0.06]":build.risk==="Balanced"?"border-amber-300/18 bg-amber-300/[0.05]":"border-rose-300/18 bg-rose-400/[0.05]"
  const accent=build.risk==="Safe"?"text-emerald-300":build.risk==="Balanced"?"text-amber-300":"text-rose-300"
  const verified=build.verifiedBet365LegPrices===true
  const referenceBet365=build.referenceBet365LegPrices===true
  const modelOnly=inPlay&&!verified&&!referenceBet365
  const summary=betSummary(build)
  const slipChance=build.conservativeAllHitProbability??build.modelAllHitProbability
  const weakestLeg=build.legs.length?build.legs.reduce((a,b)=>a.probability<=b.probability?a:b):null
  const slipConfidence=slipChance==null?"Not estimated":slipChance>=.3?"Higher relative confidence":slipChance>=.12?"Moderate relative confidence":"Low confidence"
  return <article className={"rounded-2xl border "+tone}>
    <button onClick={()=>setOpen(v=>!v)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
      <div className="min-w-0"><p className={"text-[0.48rem] font-black uppercase tracking-wide "+accent}>{build.id==="most-likely"||build.id==="broad-most-likely"?"2/1 MINIMUM":"ODDS TARGET"}</p><div className="mt-1 flex flex-wrap items-baseline gap-2"><p className="text-base font-black">{build.title}</p>{build.referenceProductOdds?<span className="font-mono text-sm font-black text-white/55">{fractionalOdds(build.referenceProductOdds)} singles estimate</span>:null}</div><p className="mt-1 text-[0.45rem] text-white/30">{build.legs.length?build.legs.length+" selections · "+percent(slipChance,1)+" estimated full-slip chance":build.note}</p></div>
      <ChevronDown className={"size-4 shrink-0 text-white/35 transition "+(open?"rotate-180":"")}/>
    </button>
    {open&&build.legs.length?<div className="border-t border-white/7 p-3"><div className="mb-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3"><p className="text-[0.5rem] font-black uppercase tracking-wide text-emerald-200">Estimated chance every selection wins</p><p className="mt-1 text-2xl font-black text-white">{percent(slipChance,1)} <span className="text-xs font-semibold text-white/55">{slipConfidence}</span></p><p className="mt-1 text-[0.48rem] leading-relaxed text-white/55">Cautious model estimate, not a guaranteed or historically calibrated win rate. All legs must land. Hull showed 0/4 complete 10/1 snapshots despite 15/19 individual legs hitting.</p>{weakestLeg?<p className="mt-2 text-[0.48rem] text-amber-200/80">Weakest selection: {weakestLeg.player} · {weakestLeg.label} ({percent(weakestLeg.probability,1)} individual estimate)</p>:null}</div>{summary?<div className="mb-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.04] p-2.5"><p className="text-[0.46rem] font-black uppercase tracking-wide text-cyan-200">Why this bet</p><p className="mt-1 text-[0.52rem] font-bold text-white/60">{summary.markets}</p>{summary.evidence?<p className="mt-1 text-[0.44rem] leading-relaxed text-white/35">{summary.evidence}. The model evaluates the complete combination and penalises weak selections rather than assuming individual leg success guarantees a winning slip.</p>:<p className="mt-1 text-[0.44rem] leading-relaxed text-white/35">The ladder prioritises the highest-probability player events first and only adds more legs to clear this odds floor.</p>}</div>:null}<div className="flex flex-wrap items-center gap-1.5"><span className={"rounded-full px-2 py-1 text-[0.38rem] font-black "+(verified?(liveBet365?"bg-emerald-300/15 text-emerald-200":"bg-cyan-300/10 text-cyan-100"):"bg-amber-300/10 text-amber-100")}>{verified?(liveBet365?"LIVE BET365 LEGS":"VERIFIED BET365 LEGS"):referenceBet365?"BET365 REFERENCE LEGS":(inPlay?"LIVE MODEL ROUTE":"MODEL ANALYSIS ONLY")}</span><span className="text-[0.38rem] text-white/25">{verified?"Indicative product of Bet365 singles; actual builder quote may differ":referenceBet365?"last captured Bet365 singles · not current live quotes":modelOnly?"Bet365 price unavailable · model still updating":"model fair odds"}</span></div><div className="mt-2 grid grid-cols-3 gap-1.5"><MiniStat label="Raw model %" value={percent(build.modelAllHitProbability,1)}/><MiniStat label="Cautious slip %" value={percent(build.conservativeAllHitProbability??build.modelAllHitProbability,1)}/><MiniStat label={verified?"Singles ref":referenceBet365?"B365 ref":"Model product"} value={fractionalOdds(build.referenceProductOdds)}/></div><div className="mt-2 space-y-1.5">{build.legs.map(l=>{const ev=marketEvidence(l);return <div key={keyOf(l)} className="rounded-lg bg-black/15 px-2 py-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><p className="min-w-0 truncate text-[0.5rem] text-white/65">{l.player} · {l.label}</p><TeamBadge team={l.team} fixture={fixture}/></div>{ev?<p className="mt-1 text-[0.42rem] font-bold text-cyan-100/55">{ev}</p>:null}<MarketHistoryBadge player={l.player} team={l.team} market={l.market} date={fixture.date} home={fixture.home} away={fixture.away} competition={fixture.competition}/></div><div className="shrink-0 text-right"><p className="font-mono text-[0.48rem] font-black text-white/55">{percent(l.probability)}</p></div></div></div>})}</div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={onUse} className="rounded-xl bg-white/8 px-3 py-2 text-[0.54rem] font-black text-white/55">{verified?"Use selections":referenceBet365?"View Bet365 refs":"View selections"}</button><button disabled={!verified} onClick={verified?onTrack:undefined} className={"rounded-xl px-3 py-2 text-[0.58rem] font-black "+(verified?"bg-white text-[#07120e]":"cursor-not-allowed bg-white/8 text-white/25")}>{verified?"Track research only":referenceBet365?"Bet365 refs only":"Awaiting Bet365 price"}</button></div></div>:open&&!build.legs.length?<div className="border-t border-white/7 p-3 text-[0.52rem] text-white/35">{build.note}</div>:null}
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

type HistoryMatch={
 date:string;opponent:string;minutes:number|null;foulsCommitted:number|null;foulsDrawn:number|null;
 shots:number|null;shotsOnTarget:number|null;yellow:boolean|null;red:boolean|null;
 goals:number|null;assists:number|null;hit:boolean|null
}
type HistoryResult={ok:boolean;lastFive?:HistoryMatch[];h2h?:HistoryMatch[];
 lastFiveSummary?:{matches:number;graded:number;hits:number;rate:number|null};
 h2hSummary?:{matches:number;graded:number;hits:number;rate:number|null};
 lastFiveBookings?:{booked:number;withKnownOutcome:number;reds:number};
 h2hBookings?:{booked:number;withKnownOutcome:number;reds:number};
 h2hOpponent?:string;error?:string}
function PlayerHistoryDetails({row,fixture,inPlay}:{row:Selection;fixture:Fixture;inPlay:boolean}){
 const[history,setHistory]=useState<HistoryResult|null>(null)
 const[loading,setLoading]=useState(true)
 const[attempt,setAttempt]=useState(0)
 useEffect(()=>{
   let active=true
   const controller=new AbortController()
   const timer=window.setTimeout(()=>controller.abort(),9000)
   setLoading(true);setHistory(null)
   const params=new URLSearchParams({
     date:fixture.date,competition:fixture.competition,player:row.player,team:row.team,
     opponent:sameTeamName(row.team,fixture.home)?fixture.away:fixture.home,
     market:row.market,
   })
   fetch("/api/player-match-history?"+params,{signal:controller.signal})
     .then(async response=>{if(!response.ok)throw Error("Unavailable");return await response.json() as HistoryResult})
     .then(data=>{if(active)setHistory(data)})
     .catch(()=>{if(active)setHistory({ok:false,error:"History could not be loaded. Retry."})})
     .finally(()=>{window.clearTimeout(timer);if(active)setLoading(false)})
   return()=>{active=false;window.clearTimeout(timer);controller.abort()}
 },[fixture.date,fixture.competition,fixture.home,fixture.away,row.player,row.team,row.market,attempt])
 const metric=(match:HistoryMatch)=>{
   if(row.market==="card")return match.yellow==null?"—":match.yellow?"Yellow":"No yellow"
   if(row.market.startsWith("fouled"))return match.foulsDrawn
   if(row.market.startsWith("foul"))return match.foulsCommitted
   if(row.market.startsWith("sot"))return match.shotsOnTarget
   if(row.market.startsWith("shot"))return match.shots
   if(row.market.startsWith("goal"))return match.goals
   if(row.market.startsWith("assist"))return match.assists
   return null
 }
 const panel=(title:string,matches:HistoryMatch[],summary?:HistoryResult["lastFiveSummary"],isH2H=false)=>(
   <div className={"mt-4 rounded-2xl border p-3 "+(isH2H?"border-amber-300/25 bg-amber-300/[0.045]":"border-white/8 bg-white/[0.02]")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-black">{title}</p>
     <p className="text-[0.65rem] font-black text-cyan-100/80">{summary?.graded?summary.hits+"/"+summary.graded+" "+row.label+" ("+percent(summary.rate,0)+")":"No graded results"}</p>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100">
        🟨 {matches.filter(m=>m.yellow===true).length}/{matches.filter(m=>m.yellow!=null).length} yellow-card games
      </span>
      {matches.some(m=>m.red===true)?<span className="rounded-xl bg-rose-400/15 px-2.5 py-2 text-xs font-bold text-rose-200">🟥 {matches.filter(m=>m.red===true).length} red-card games</span>:null}
      <span className="text-[0.58rem] text-white/40">{matches.length} recorded appearance{matches.length===1?"":"s"}</span>
    </div>
    {matches.length?<div className="mt-3 space-y-2">{matches.map((m,i)=><div key={m.date+"|"+m.opponent+"|"+i}
      className={"rounded-xl border px-3 py-3 "+(m.yellow===true?"border-amber-300/35 bg-amber-300/[0.085]":"border-white/[0.06] bg-black/20")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0"><p className="truncate text-sm font-black">{m.opponent}</p><p className="mt-0.5 text-[0.62rem] text-white/45">{m.date} · {m.minutes==null?"Minutes unknown":m.minutes+" mins"}</p></div>
        {m.yellow===true?<span className="shrink-0 rounded-xl border border-amber-200/50 bg-amber-300/20 px-3 py-2 text-sm font-black text-amber-100">🟨 BOOKED</span>:
         m.yellow===false?<span className="shrink-0 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[0.7rem] font-bold text-white/50">No yellow</span>:
         <span className="shrink-0 text-xs text-white/35">Card unknown</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
       <p className="text-[0.7rem] font-bold text-white/70">{row.market==="card"?"Discipline":row.label}: <span className="font-mono text-white">{metric(m)??"—"}</span></p>
       <span className={"rounded-lg px-2 py-1 text-[0.62rem] font-black "+(m.hit===true?"bg-emerald-400/15 text-emerald-200":m.hit===false?"bg-rose-400/10 text-rose-200":"bg-white/10 text-white/35")}>{m.hit==null?"NO DATA":m.hit?"✓ HIT":"✕ MISS"}</span>
      </div>
      <p className="mt-1.5 text-[0.59rem] text-white/40">Fouls {m.foulsCommitted??"—"} · fouls drawn {m.foulsDrawn??"—"} · shots {m.shots??"—"} · SOT {m.shotsOnTarget??"—"}</p>
     </div>)}</div>:<p className="mt-3 rounded-lg bg-black/20 p-3 text-[0.68rem] leading-relaxed text-white/55">
      {isH2H?"No historical appearances against this opponent found in the imported match database, including earlier clubs and seasons. This does not mean the player has never faced them.":"No historical appearances found in the imported database."}
     </p>}
   </div>
 )
 return <div className="border-t border-white/8 bg-black/20 px-3 py-4">
  <div className="flex items-center justify-between"><p className="text-xs font-black text-white/80">Player history · {row.label}</p><span className="text-[0.55rem] text-white/35">Before match only</span></div>
  <div className="mt-2 grid grid-cols-3 gap-1.5"><MiniStat label="Last 5 model" value={row.recent5HitRate==null?"—":percent(row.recent5HitRate)}/><MiniStat label="Season model" value={row.seasonHitRate==null?"—":percent(row.seasonHitRate)}/><MiniStat label="H2H model" value={row.h2hHitRate==null?"—":percent(row.h2hHitRate)}/></div>
  {inPlay?<p className="mt-2 text-[0.59rem] text-emerald-200/70">Historical records are fixed before kickoff. Live foul/shot counts are shown on the ranking above, not added to last-five or H2H.</p>:null}
  {loading?<p className="mt-3 text-xs text-white/45">Loading actual past match rows…</p>:
    history?.ok?<>
      <div className="mt-3 grid grid-cols-2 gap-2">
       <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3">
        <p className="text-[0.58rem] font-black uppercase tracking-wide text-amber-100/70">Last 5 bookings</p>
        <p className="mt-1 text-xl font-black text-amber-100">🟨 {history.lastFiveBookings?.booked??(history.lastFive??[]).filter(x=>x.yellow===true).length}<span className="text-xs text-amber-100/60"> / {history.lastFiveBookings?.withKnownOutcome??(history.lastFive??[]).length}</span></p>
       </div>
       <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3">
        <p className="text-[0.58rem] font-black uppercase tracking-wide text-amber-100/70">H2H bookings</p>
        <p className="mt-1 text-xl font-black text-amber-100">🟨 {history.h2hBookings?.booked??(history.h2h??[]).filter(x=>x.yellow===true).length}<span className="text-xs text-amber-100/60"> / {history.h2hBookings?.withKnownOutcome??(history.h2h??[]).length}</span></p>
       </div>
      </div>
      {panel("Last five appearances",history.lastFive??[],history.lastFiveSummary)}
      {panel("H2H vs "+(history.h2hOpponent??(sameTeamName(row.team,fixture.home)?fixture.away:fixture.home)),history.h2h??[],history.h2hSummary,true)}
     </>:
    <div className="mt-3"><p className="text-xs text-amber-100">{history?.error??"No history found"}</p><button onClick={()=>setAttempt(a=>a+1)} className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold">Retry history</button></div>}
  <p className="mt-3 text-[0.56rem] leading-relaxed text-white/35">Yellow-card badges show recorded bookings regardless of the selected market. H2H includes available earlier seasons and clubs. Individual results differ from model estimates; unavailable stats are never assumed to be zero.</p>
 </div>
}
function LikelihoodBoard({rows,allRows,preMatchRows,live,category,fixture,inPlay}:{rows:Selection[];allRows:Selection[];preMatchRows:Selection[];live:LiveData|null;category:Category;fixture:Fixture;inPlay:boolean}){
 const[expanded,setExpanded]=useState<string|null>(null)
 const[summaries,setSummaries]=useState<Record<string,{lastFive:{hits:number;total:number;known:number;events:number;threshold:number};h2h:{hits:number;total:number;known:number;events:number;threshold:number};recordedRecent:number;recordedH2h:number}>>({})
 const label=categories.find(x=>x.id===category)?.label??"Likelihood"
 // Include every current player once, prioritising their best remaining market.
 const active=inPlay&&live?.players?.length?live.players.filter(livePlayerIsActive):null
 const activeNames=active?new Set(active.map(p=>normPlayer(p.player)+"|"+teamNorm(p.team))):null
 const ranked:Selection[]=[]
 const rankedNames=new Set<string>()
 for(const row of [...rows].sort((a,b)=>b.probability-a.probability)){
   const key=normPlayer(row.player)+"|"+teamNorm(row.team)
   if(activeNames&&!activeNames.has(key))continue
   if(rankedNames.has(key))continue
   rankedNames.add(key)
   ranked.push(row)
 }
 const missing=active?.filter(p=>!rankedNames.has(normPlayer(p.player)+"|"+teamNorm(p.team)))??[]
 const allowed=new Set(categories.find(c=>c.id===category)?.markets??["card"])
 const fallbackMarket=(categories.find(c=>c.id===category)?.markets??["card"])[0]
 const missingHistory=missing.map(stat=>({
  stat,source:preMatchRows.find(r=>normPlayer(r.player)===normPlayer(stat.player)&&teamNorm(r.team)===teamNorm(stat.team)&&allowed.has(r.market as MarketKey))??null
 }))
 const rosterKey=JSON.stringify(ranked.map(r=>[r.player,r.team,r.market]))
 useEffect(()=>{
  if(!rosterKey||rosterKey==="[]")return
  let cancelled=false
  const ctrl=new AbortController()
  const timeout=window.setTimeout(()=>ctrl.abort(),9000)
  const unique=Array.from(new Map((JSON.parse(rosterKey) as [string,string,string][]).map(([name,team,market])=>[name.toLowerCase()+"|"+team.toLowerCase()+"|"+market,{name,team,market}])).values())
  fetch("/api/player-booking-summaries",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({date:fixture.date,home:fixture.home,away:fixture.away,players:unique}),
    signal:ctrl.signal,cache:"no-store",
  }).then(async r=>{if(!r.ok)throw Error("Historical summaries unavailable");return r.json()})
   .then((d:{ok:boolean;profiles?:Array<{name:string;team:string;market:string;lastFive:{hits:number;total:number;known:number;events:number;threshold:number};h2h:{hits:number;total:number;known:number;events:number;threshold:number};recordedRecent:number;recordedH2h:number}>})=>{
    if(cancelled||!d.ok)return
    const next:Record<string,{lastFive:{hits:number;total:number;known:number;events:number;threshold:number};h2h:{hits:number;total:number;known:number;events:number;threshold:number};recordedRecent:number;recordedH2h:number}>={}
    for(const p of d.profiles??[])next[normPlayer(p.name)+"|"+teamNorm(p.team)+"|"+p.market]={lastFive:p.lastFive,h2h:p.h2h,recordedRecent:p.recordedRecent,recordedH2h:p.recordedH2h}
    setSummaries(next)
   }).catch(()=>{if(!cancelled)setSummaries({})})
   .finally(()=>window.clearTimeout(timeout))
  return()=>{cancelled=true;ctrl.abort();window.clearTimeout(timeout)}
 },[rosterKey,fixture.date,fixture.home,fixture.away])
 const evidence=(row:Selection)=>{
   if(!inPlay)return marketEvidence(row)
   if(row.market==="card")return "Fouls "+Number(row.liveFoulsCommitted??0)+" · fouled "+Number(row.liveFoulsDrawn??0)
   if(row.market.startsWith("fouled"))return "Fouled "+Number(row.liveFoulsDrawn??0)+" already"
   if(row.market.startsWith("foul"))return "Fouls "+Number(row.liveFoulsCommitted??0)+" already"
   if(row.market.startsWith("sot")||row.market.startsWith("shot"))return "Shots "+Number(row.liveShots??0)+" · SOT "+Number(row.liveShotsOnTarget??0)
   return row.currentCount!=null?"Live count "+row.currentCount:marketEvidence(row)
 }
 return <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
  <div className="border-b border-white/8 px-3 py-3"><div className="flex items-center justify-between gap-3">
   <div><p className="text-sm font-black">{label} likelihood</p><p className="mt-1 text-[0.5rem] text-white/30">{inPlay?"Remaining-match chance · tap player for earlier matches and H2H":"Model chance · tap any player for last five games and H2H"}</p></div>
   <span className="rounded-full bg-white/6 px-2 py-1 text-[0.42rem] font-black text-white/35">{ranked.length+missing.length} {inPlay?"ON PITCH":"PLAYERS"}</span></div></div>
  {ranked.length?ranked.map((row,i)=>{
   const price=displayedBet365Odd(row),traffic=trafficFor(row,allRows)
   const tone=traffic==="high"?"text-emerald-200":traffic==="average"?"text-amber-100":"text-rose-100/80"
   const open=expanded===row.id
   const counts=summaries[normPlayer(row.player)+"|"+teamNorm(row.team)+"|"+row.market]
   const countLabel=(v:{hits:number;total:number;known:number;events:number;threshold:number}|undefined)=>{
     if(!v||!v.total)return "—"
     if(!v.known)return "no stats"
     if(row.market==="card")return v.hits+"/"+v.total
     const name=row.market.startsWith("fouled")?"drawn":row.market.startsWith("foul")?"fouls":row.market.startsWith("sot")?"SOT":row.market.startsWith("shot")?"shots":row.market.startsWith("goal")?"goals":"assists"
     return v.events+" "+name+"/"+v.total
   }
   return <div key={row.id} className={i?"border-t border-white/[0.055]":""}>
    <button type="button" onClick={()=>setExpanded(v=>v===row.id?null:row.id)} aria-expanded={open}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left hover:bg-white/[0.025]">
     <span className={"flex size-8 items-center justify-center rounded-full font-mono text-xs font-black "+(i===0?"bg-emerald-300 text-emerald-950":"bg-white/6 text-white/45")}>{i+1}</span>
     <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-black">{row.player}</p><TeamBadge team={row.team} fixture={fixture}/></div>
      <p className="mt-0.5 truncate text-[0.54rem] font-bold text-white/55">{row.label}</p>
      {evidence(row)?<p className="mt-1 truncate text-[0.46rem] font-bold text-cyan-100/45">{evidence(row)}</p>:null}
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.58rem] font-bold">
       <span className="text-amber-200/85">{row.market==="card"?"🟨 ":""}L5 {countLabel(counts?.lastFive)}</span>
       <span className="text-amber-200/85">H2H {countLabel(counts?.h2h)}</span>
       <span className="inline-flex items-center gap-0.5 text-emerald-200/70">{open?"Less":"Details"} <ChevronDown className={"size-3 transition "+(open?"rotate-180":"")}/></span>
      </span>
     </div>
     <div className="min-w-[5.5rem] text-right"><p className={"font-mono text-lg font-black "+tone}>{percent(row.probability)}</p>
      <p className="text-[0.4rem] font-black uppercase text-white/25">{inPlay?"remaining chance":"model chance"}</p>
      {price?<p className={"mt-1 font-mono text-[0.48rem] font-black "+(price.state==="live"?"text-emerald-200":"text-amber-200/80")}>B365 {price.odd.toFixed(2)}{price.state==="reference"?" ref":""}</p>:null}</div>
    </button>
    {open?<PlayerHistoryDetails row={row} fixture={fixture} inPlay={inPlay}/>:null}
   </div>
  }):!missing.length?<p className="px-4 py-8 text-center text-sm text-white/35">No remaining player events in this market right now.</p>:null}
  {missingHistory.map(({stat,source},i)=>{
    const key=normPlayer(stat.player)+"|"+teamNorm(stat.team)
    const open=expanded==="missing|"+key
    return <div key={"missing|"+key} className="border-t border-white/[0.055]">
      <button type="button" onClick={()=>setExpanded(v=>v==="missing|"+key?null:"missing|"+key)}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/6 font-mono text-xs font-black text-white/45">{ranked.length+i+1}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-black">{stat.player}</p><TeamBadge team={stat.team} fixture={fixture}/></div>
          <p className="mt-1 text-[0.55rem] text-white/50">{source&&countForMarket(stat,source.market)>=thresholdForMarket(source.market)?"Market threshold already reached":"No remaining model estimate"}</p>
          <span className="mt-1 inline-flex items-center gap-1 text-[0.55rem] font-bold text-emerald-200/70">L5 · H2H <ChevronDown className={"size-3 transition "+(open?"rotate-180":"")}/></span>
        </div>
        <div className="text-right"><p className="text-xs font-black text-white/45">—</p><p className="text-[0.43rem] text-white/30">No remaining chance</p></div>
      </button>
      {open?(source?<PlayerHistoryDetails row={source} fixture={fixture} inPlay={inPlay}/>:<div className="border-t border-white/10 p-3"><MarketHistoryBadge player={stat.player} team={stat.team} market={fallbackMarket} date={fixture.date} home={fixture.home} away={fixture.away} competition={fixture.competition}/></div>):null}
    </div>
  })}
 </div>
}

function SelectionRow({row,selected,onToggle,rank,traffic,bestAction=false,liveBet365=false,marketStatus="unknown",inPlay=false,fixture}:{row:Selection;selected:boolean;onToggle:()=>void;rank:number;traffic:Traffic;bestAction?:boolean;liveBet365?:boolean;marketStatus?:MarketStatus;inPlay?:boolean;fixture:Fixture}){
  const shownPrice=displayedBet365Odd(row)
  const exact=shownPrice?.state==="live"
  const referencePrice=shownPrice?.state==="reference"
  const actionable=exact&&marketStatus!=="unavailable"
  const trafficText=traffic==="high"?"HIGH":traffic==="average"?"AVERAGE":"LOW"
  const trafficClass=traffic==="high"?"bg-emerald-300/15 text-emerald-200 border-emerald-300/20":traffic==="average"?"bg-amber-300/12 text-amber-100 border-amber-300/20":"bg-rose-300/10 text-rose-100/75 border-rose-300/15"
  const probabilityClass=traffic==="high"?"text-emerald-200":traffic==="average"?"text-amber-100":"text-rose-100/80"
  return <button disabled={!actionable} onClick={actionable?onToggle:undefined} className={"grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 text-left transition "+(rank>1?"border-t border-white/[0.055] ":"")+(selected?"bg-emerald-400/[0.08]":actionable?"hover:bg-white/[0.025]":"opacity-55 cursor-not-allowed")}>
    <span className={"flex size-7 items-center justify-center rounded-full text-[0.56rem] font-black "+(traffic==="high"?"bg-emerald-400/12 text-emerald-300":traffic==="average"?"bg-amber-300/10 text-amber-200":"bg-rose-300/8 text-rose-200/65")}>{rank}</span>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-sm font-black">{row.player}</p><TeamBadge team={row.team} fixture={fixture}/>{bestAction?<span className="rounded-full bg-cyan-300/10 px-1.5 py-0.5 text-[0.36rem] font-black text-cyan-200">BEST ACTION</span>:null}{selected?<BadgeCheck className="size-3.5 shrink-0 text-emerald-300"/>:null}</div><p className="mt-0.5 truncate text-[0.54rem] font-bold text-white/55">{row.label}</p>{marketEvidence(row)?<p className="mt-1 text-[0.44rem] font-bold text-cyan-100/50">{marketEvidence(row)}</p>:null}<p className="mt-0.5 truncate text-[0.46rem] text-white/25">Grade {row.confidence}{row.liveAdjusted
  ?(row.market==="card"
    ?" · FC "+Number(row.liveFoulsCommitted??0)+" · FD "+Number(row.liveFoulsDrawn??0)+" · pressure "+Math.round(Number(row.livePressureScore??0)*100)
    :row.market.startsWith("fouled")
      ?" · FD "+Number(row.liveFoulsDrawn??0)+" · pressure "+Math.round(Number(row.livePressureScore??0)*100)
      :row.market.startsWith("foul")
        ?" · FC "+Number(row.liveFoulsCommitted??0)+" · pressure "+Math.round(Number(row.livePressureScore??0)*100)
        :" · live count "+(row.currentCount??0)+(row.livePressureScore!=null?" · pressure "+Math.round(row.livePressureScore*100):""))
  :row.edge!=null?" · "+(row.edge>=0?"+":"")+(row.edge*100).toFixed(1)+"pp vs price":""}{row.referenceBookmakerOdds&&!row.referenceOddsLive?" · last Bet365 "+row.referenceBookmakerOdds.toFixed(2):""}</p></div>
    <div className="min-w-[5rem] text-right"><div className="mb-1 flex justify-end"><span className={"rounded-full border px-1.5 py-0.5 text-[0.38rem] font-black "+trafficClass}>{trafficText}</span></div><p className={"font-mono text-base font-black "+probabilityClass}>{percent(row.probability)}</p><p className={"text-[0.42rem] font-black "+(exact?"text-emerald-200/70":referencePrice?"text-amber-200/75":marketStatus==="unavailable"?"text-rose-200/70":"text-white/20")}>{exact?(shownPrice!.odd.toFixed(3)+" · "+(liveBet365?"LIVE BET365":"BET365")):referencePrice?(shownPrice!.odd.toFixed(3)+" · LAST BET365"):marketStatus==="unavailable"?"NOT OFFERED IN CURRENT BET365 FEED":"NO BET365 PRICE CAPTURED"}</p>{actionable?<span className={"mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.4rem] font-black "+(selected?"bg-emerald-300 text-emerald-950":"bg-white/6 text-white/30")}>{selected?<X className="size-2.5"/>:<CirclePlus className="size-2.5"/>}{selected?"REMOVE":"ADD"}</span>:referencePrice?<span className="mt-1 inline-flex rounded-full bg-amber-300/10 px-1.5 py-0.5 text-[0.4rem] font-black text-amber-100">PRICE REFERENCE</span>:<span className="mt-1 inline-flex rounded-full bg-rose-300/10 px-1.5 py-0.5 text-[0.4rem] font-black text-rose-200">MODEL ONLY</span>}</div>
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
