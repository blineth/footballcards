import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { GET as matchAccaGET } from "../match-acca/route"
import { GET as livePlayerStatsGET } from "../live-player-stats/route"
import { GET as betBuilderOddsGET } from "../bet-builder-odds/route"
import { gradeHistoricalRecommendations, recommendationTrackingSummary, saveRecommendationSnapshots } from "@/lib/recommendation-tracking"
import { gradePredictionLedger } from "@/lib/prediction-ledger"
import recommendationBacktest from "@/data/model/recommendation-backtest.json"
import calibrationSnapshot from "@/data/model/calibration.json"
import { snapshotPlayersForFixture, internationalPlayersForFixture } from "@/lib/current-season-snapshot"
import { buildSnapshotScorecard } from "@/lib/snapshot-scorecard"
import { getOfficialLineup } from "@/lib/official-lineup"

export const dynamic="force-dynamic"
export const revalidate=120

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"
type Fixture={
  id:string;competition:Competition;tournament?:string;kickoff:string;status?:string;
  score?:{home:number|null;away:number|null};elapsed?:number|null;
  home:{name:string;shortName?:string;crest?:string|null};away:{name:string;shortName?:string;crest?:string|null};lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type MarketStatus="available"|"unavailable"|"unknown"
type SlipLeg={
  player:string;dbPlayerName?:string|null;team:string;market:string;label:string;
  probability:number;fairOdds:number|null;bookmakerOdds:number|null;bookmakerName?:string|null;
  edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;priceSource?:"exact"|"estimated"|null;
  bookmakerProbability?:number|null;
  recent5HitRate?:number|null;recent10HitRate?:number|null;seasonHitRate?:number|null;seasonPer90?:number|null;
  h2hHitRate?:number|null;h2hMatches?:number;h2hLineupOverlap?:number|null;h2hSimilarity?:number|null;
  sampleMatches?:number;expectedMinutes?:number|null;position?:string|null
}
type BetSlip={
  id:string;bookmaker?:string|null;title:string;risk:string;legs:SlipLeg[];
  averageLegProbability:number|null;placeable?:boolean;
  marketAvailability?:Array<{player:string;market:string;status:MarketStatus}>
}
type FoulTargetSlip={
  id:string;bookmaker?:string|null;targetFractional:string;legs:SlipLeg[];
  averageLegProbability:number|null;placeable?:boolean;marketStatus?:MarketStatus;usesLivePrices?:boolean
}
type ScorecardMarket={
  key?:string;label:string;probability:number;fairOdds?:number|null;bookmakerOdds?:number|null;
  bookmakerName?:string|null;edge?:number|null;confidence:"A"|"B"|"C"|"D";reasons?:string[];
  sampleMatches?:number;recent5HitRate?:number;recent10HitRate?:number;seasonHitRate?:number;seasonPer90?:number|null;
  h2hHitRate?:number|null;h2hMatches?:number;h2hLineupOverlap?:number|null;h2hSimilarity?:number|null;recommendationScore?:number;
  impliedProbability?:number|null;bookmakerNoVigProbability?:number|null
}
type ScorecardPlayer={
  name:string;dbName?:string;team:string;expectedMinutes?:number|null;position?:string|null;
  markets?:Record<string,ScorecardMarket>;
  cardContext?:{rolePrior?:number;clubMatches?:number;clubYellows?:number;clubCardRate?:number|null;clubCompetitions?:string[]};
  yellowConditionals?:{
    overall?:{matches:number;yellows:number;rate:number};
    after1PlusFouls?:{matches:number;yellows:number;rate:number|null};
    after2PlusFouls?:{matches:number;yellows:number;rate:number|null};
    after3PlusFouls?:{matches:number;yellows:number;rate:number|null};
  }
}
type Scorecard={
  ok:boolean;lineupsConfirmed?:boolean;lineupMode?:"confirmed"|"predicted"|"squad";eligibleBooks?:string[];
  marketAvailability?:{goal?:MarketStatus;assist?:MarketStatus;card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus};
  slips?:BetSlip[];previewSlips?:BetSlip[];foulTargetSlips?:FoulTargetSlip[];previewFoulTargetSlips?:FoulTargetSlip[];
  riskBuilders?:Array<{id:string;title:string;risk:string;legs:SlipLeg[];averageLegProbability:number|null;referenceProductOdds?:number|null;modelAllHitProbability?:number|null}>;
  players?:ScorecardPlayer[];
  availableBets?:Array<{
    market:string;kind:string;label:string;odd:number;bookmaker:string;
    probability:number|null;probabilityBasis:"no-vig"|"implied";line?:number|null;side?:string|null
  }>;
  oddsSelections?:Array<{
    market:string;kind:string;label:string;odd:number|null;underOdd?:number|null;
    noVigProbability?:number|null;bookmaker?:string|null
  }>;
  referee?:{name?:string|null;yellowsPerGame?:number|null;foulsPerGame?:number|null;matches?:number|null}|null
}
type Recommendation={
  id:string;fixture:Fixture;slip:BetSlip|FoulTargetSlip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null;
  fullPlayerMarkets?:boolean;playerMarketAvailability?:Record<string,MarketStatus>
}
type TargetOddsLeg={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;
  player:string;team:string;market:string;label:string;probability:number;conservativeProbability:number;
  price:number;priceSource:"exact";bookmaker:"Bet365";confidence:SlipLeg["confidence"]
}
type TargetOddsSlip={
  id:string;targetFractional:string;targetDecimal:number;available:boolean;
  referenceOdds:number|null;modelAllHitProbability:number|null;conservativeAllHitProbability:number|null;safetyScore:number|null;bookmaker:string|null;
  priceSource:"bookmaker-singles"|null;marketsVerified:boolean;legs:TargetOddsLeg[];
  maxSelections:number;maxPlayersPerTeam:number;note:string
}
type TargetOddsGame={
  fixture:Fixture
  lineupsConfirmed:boolean
  targets:TargetOddsSlip[]
}

const competitions:Competition[]=["Premier League","Championship","League One","League Two","International"]

type OfficialLineup={confirmed:boolean;starters:Set<string>;source?:string;checkedAt?:string;cachedConfirmed?:boolean}
function normName(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
}
function sameTeamName(a:string,b:string){
  const x=normName(a).replace(/\b(afc|fc)\b/g,"").trim(),y=normName(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
async function officialLineupForFixture(f:Fixture):Promise<OfficialLineup>{
  try{
    const lineup=await getOfficialLineup({
      date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,eventId:f.id,force:true,
    })
    const starters=new Set<string>([
      ...(lineup.homeLineup?.starters??[]).map((p:any)=>normName(String(p.name??""))),
      ...(lineup.awayLineup?.starters??[]).map((p:any)=>normName(String(p.name??""))),
    ].filter(Boolean))
    return {confirmed:lineup.confirmed&&starters.size===22,starters,source:lineup.source,checkedAt:lineup.checkedAt,cachedConfirmed:lineup.cachedConfirmed}
  }catch{return {confirmed:false,starters:new Set()}}
}

type LivePlayerStat={
  player:string;team:string;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;assists:number;yellowCards:number;redCards:number;starter:boolean;subbedOn:boolean;subbedOff:boolean;minutes:number;
  tackles:number;interceptions:number;blocks:number;duelsTotal:number;duelsWon:number;defensiveInterventions:number;
  recentFouls10:number;recentFouls15:number;recentFouled10:number;disciplineHeat:number;
  aggressionScore:number;aggressionSignals:string[];lastAggressionMinute:number|null
}
type RefereeLiveContext={
  name:string|null;source:string|null;matches:number|null;historicalYellowsPerGame:number|null;historicalFoulsPerGame:number|null;
  liveFouls:number;liveYellows:number;liveReds:number;liveFoulsPer90:number|null;liveYellowsPer90:number|null;
  liveCardPerFoul:number|null;historicalCardPerFoul:number|null;strictnessScore:number;strictnessLabel:"strict"|"average"|"lenient";
  historicalModifier:number;liveDecisionModifier:number
}
function espnStat(row:any,name:string){
  const found=(row?.stats??[]).find((s:any)=>String(s?.name??"")===name)
  const value=Number(found?.value??found?.displayValue??0)
  return Number.isFinite(value)?value:0
}
async function livePlayerStatsForFixture(f:Fixture){
  try{
    const q=new URLSearchParams({
      date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,
    })
    const response=await livePlayerStatsGET(new Request("http://local/api/live-player-stats?"+q.toString()))
    if(!response.ok)return {source:null,status:null,elapsed:null,score:null,referee:null as RefereeLiveContext|null,players:new Map<string,LivePlayerStat>()}
    const data=await response.json()
    const rows:Array<any>=Array.isArray(data?.players)?data.players:[]
    return {
      source:data?.source??null,status:data?.status??null,elapsed:Number.isFinite(Number(data?.elapsed))?Number(data.elapsed):null,score:data?.score??null,
      referee:data?.referee??null,
      players:new Map<string,LivePlayerStat>(rows.map((row:any)=>[normName(String(row.player??"")),{
        player:String(row.player??""),team:String(row.team??""),
        foulsCommitted:Number(row.foulsCommitted??0),foulsDrawn:Number(row.foulsDrawn??0),
        shots:Number(row.shots??0),shotsOnTarget:Number(row.shotsOnTarget??0),
        goals:Number(row.goals??0),assists:Number(row.assists??0),
        yellowCards:Number(row.yellowCards??0),redCards:Number(row.redCards??0),
        starter:row.starter===true,subbedOn:row.subbedOn===true,subbedOff:row.subbedOff===true,minutes:Number(row.minutes??0),
        tackles:Number(row.tackles??0),interceptions:Number(row.interceptions??0),blocks:Number(row.blocks??0),
        duelsTotal:Number(row.duelsTotal??0),duelsWon:Number(row.duelsWon??0),defensiveInterventions:Number(row.defensiveInterventions??0),
        recentFouls10:Number(row.recentFouls10??0),recentFouls15:Number(row.recentFouls15??0),recentFouled10:Number(row.recentFouled10??0),
        disciplineHeat:Number(row.disciplineHeat??0),aggressionScore:Number(row.aggressionScore??0),
        aggressionSignals:Array.isArray(row.aggressionSignals)?row.aggressionSignals.map(String).slice(0,4):[],
        lastAggressionMinute:Number.isFinite(Number(row.lastAggressionMinute))?Number(row.lastAggressionMinute):null,
      }]))
    }
  }catch{
    return {source:null,status:null,elapsed:null,score:null,referee:null as RefereeLiveContext|null,players:new Map<string,LivePlayerStat>()}
  }
}
function filterSlipToOfficialStarters<T extends BetSlip|FoulTargetSlip>(slip:T,lineup:OfficialLineup):T|null{
  if(!lineup.confirmed)return slip
  const legs=(slip.legs??[]).filter(leg=>lineup.starters.has(normName(leg.player)))
  if(!legs.length)return null
  const avg=legs.reduce((s,l)=>s+l.probability,0)/legs.length
  return {...slip,legs,averageLegProbability:avg} as T
}

function filterScorecardToOfficialStarters(scorecard:Scorecard,lineup:OfficialLineup):Scorecard{
  if(!lineup.confirmed)return scorecard
  return {
    ...scorecard,
    lineupsConfirmed:true,
    lineupMode:"confirmed",
    players:(scorecard.players??[]).filter(player=>lineup.starters.has(normName(player.name))),
  }
}


function londonDate(offset=0){
  const now=new Date()
  now.setUTCDate(now.getUTCDate()+offset)
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now)
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return v("year")+"-"+v("month")+"-"+v("day")
}
function fixtureDate(f:Fixture){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.kickoff))
}
function slipLegs(slip:BetSlip|FoulTargetSlip){return slip.legs??[]}
function avgProbability(slip:BetSlip|FoulTargetSlip){
  const legs=slipLegs(slip)
  return slip.averageLegProbability??(legs.length?legs.reduce((s,l)=>s+l.probability,0)/legs.length:0)
}
function recommendationReliability(probability:number,liveFactor=1){
  const snapshot:any=recommendationBacktest as any
  const bands=snapshot?.recommendationCalibration?.bands
  if(!Array.isArray(bands)||bands.length!==20)return probability
  const idx=Math.max(0,Math.min(19,Math.floor(Math.max(0,Math.min(.999999,probability))/.05)))
  const value=Number(bands[idx]?.calibratedProbability)
  const base=Number.isFinite(value)?value:probability
  return Math.max(.01,Math.min(.99,base*liveFactor))
}
function rankSlip(slip:BetSlip|FoulTargetSlip,confirmed:boolean,placeable:boolean,liveFactor=1){
  const legs=slipLegs(slip)
  if(!legs.length)return -999
  const geo=Math.exp(legs.reduce((s,l)=>s+Math.log(Math.max(.01,l.probability)),0)/legs.length)
  const min=Math.min(...legs.map(l=>l.probability))
  const grade=legs.filter(l=>l.confidence==="A"||l.confidence==="B").length/legs.length
  const reliability=recommendationReliability(avgProbability(slip),liveFactor)
  const exactRatio=legs.filter(l=>l.bookmakerOdds!=null&&l.priceSource!=="estimated").length/legs.length
  const lowVarianceRatio=legs.filter(l=>l.market.startsWith("foul")||l.market.startsWith("fouled")||l.market.startsWith("shot")||l.market.startsWith("sot")).length/legs.length
  return geo*.38+min*.19+reliability*.16+grade*.08+lowVarianceRatio*.07+exactRatio*.04+(confirmed?.05:0)+(placeable?.03:0)-Math.max(0,legs.length-5)*.006
}

const TARGET_ODDS=[
  {fractional:"3/1",decimal:4},
  {fractional:"5/1",decimal:6},
  {fractional:"10/1",decimal:11},
  {fractional:"15/1",decimal:16},
  {fractional:"20/1",decimal:21},
  {fractional:"25/1",decimal:26},
  {fractional:"30/1",decimal:31},
  {fractional:"40/1",decimal:41},
  {fractional:"50/1",decimal:51},
] as const
const TARGET_BOOKS=["Bet365"] as const

function buildTargetOddsSlips(scorecard:Scorecard|null,fixture:Fixture):TargetOddsSlip[]{
  const MAX_SELECTIONS=12
  const MAX_PLAYERS_PER_TEAM=6
  const teamKey=(team:string)=>sameTeamName(team,fixture.home.name)?"home":sameTeamName(team,fixture.away.name)?"away":normName(team)
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const baseMarket=(market:string)=>lowThresholdMarket(market)

  type Candidate={fixture:Fixture;leg:SlipLeg;exactPrice:number;conservativeP:number;modelP:number;teamKey:string}
  const conservativeLegProbability=(leg:SlipLeg,price:number)=>{
    const modelP=Math.max(.01,Math.min(.99,Number(leg.probability)))
    const bookmakerP=Math.max(.01,Math.min(.99,Number(leg.bookmakerProbability??(1/price))))
    const uplift=leg.confidence==="A"?1.18:leg.confidence==="B"?1.12:leg.confidence==="C"?1.07:1
    // Treat the market as an external calibration anchor. The model may disagree,
    // but a very large positive edge cannot be accepted at face value until it
    // proves itself in backtesting. This stops a long-priced goalscorer from
    // dominating a target simply because our raw model is over-confident.
    let p=Math.min(modelP,bookmakerP*uplift)
    const fam=family(leg.market)
    const reliability=fam==="foul"||fam==="fouled"?.998
      :fam==="shot"?.995
      :fam==="sot"?.975
      :fam==="goal"?.90
      :fam==="assist"?.86
      :fam==="card"?.90
      :.97
    p*=reliability*evidenceReliability(leg)
    return Math.max(.01,Math.min(.99,p))
  }

  const candidates:Candidate[]=(scorecard?.ok?directPlayerCandidates(scorecard):[])
    .filter(leg=>leg.bookmakerName==="Bet365"&&leg.bookmakerOdds!=null&&leg.priceSource!=="estimated"&&Number(leg.bookmakerOdds)>1)
    .map(leg=>{
      const exactPrice=Number(leg.bookmakerOdds)
      return {fixture,leg,exactPrice,conservativeP:conservativeLegProbability(leg,exactPrice),modelP:Number(leg.probability),teamKey:teamKey(leg.team)}
    })
    .filter(x=>x.conservativeP>=.10)

  const bothTeamsAvailable=candidates.some(x=>x.teamKey==="home")&&candidates.some(x=>x.teamKey==="away")
  const correlationPenalty=(legs:Candidate[])=>{
    let penalty=1
    for(let i=0;i<legs.length;i++){
      for(let j=i+1;j<legs.length;j++){
        const a=legs[i],b=legs[j],af=family(a.leg.market),bf=family(b.leg.market)
        const sameTeam=a.teamKey===b.teamKey
        if(sameTeam&&(af==="shot"||af==="sot")&&(bf==="shot"||bf==="sot"))penalty*=.985
        else if(sameTeam&&af===bf)penalty*=(af==="foul"||af==="fouled") ? .993 : .988
        else if(!sameTeam&&((af==="foul"&&bf==="fouled")||(af==="fouled"&&bf==="foul")))penalty*=.992
        else if((af==="goal"&&bf==="assist")||(af==="assist"&&bf==="goal"))penalty*=.97
      }
    }
    return Math.max(.78,penalty)
  }
  const conservativeJoint=(legs:Candidate[])=>{
    const raw=legs.reduce((p,x)=>p*x.conservativeP,1)
    return raw*correlationPenalty(legs)
  }

  function stateSafety(state:{conservativeProb:number;legs:Candidate[]}){
    if(!state.legs.length)return 0
    const minP=Math.min(...state.legs.map(x=>x.conservativeP))
    const avgP=state.legs.reduce((sum,x)=>sum+x.conservativeP,0)/state.legs.length
    // Joint chance remains the main signal, but a weak-link penalty deliberately
    // favours several high-frequency legs over one speculative leg when the
    // whole-slip probabilities are otherwise close/uncertain.
    const jointSafety=state.conservativeProb*Math.pow(Math.max(.12,minP)/.50,.72)*Math.pow(Math.max(.35,avgP)/.60,.18)
    return routeSelectionSafety(state.legs.map(x=>x.leg),jointSafety)
  }

  function search(targetDecimal:number){
    type State={
      legs:Candidate[];odds:number;modelProb:number;conservativeProb:number;
      players:Set<string>;families:Record<string,number>;teamCounts:Record<string,number>;baseCount:number
    }
    let states:State[]=[{legs:[],odds:1,modelProb:1,conservativeProb:1,players:new Set(),families:{},teamCounts:{},baseCount:0}]
    const pool=[...candidates]
      .sort((a,b)=>{
        const aRank=a.conservativeP*marketStabilityFactor(a.leg)
        const bRank=b.conservativeP*marketStabilityFactor(b.leg)
        return bRank-aRank||b.conservativeP-a.conservativeP||b.modelP-a.modelP||((baseMarket(a.leg.market)?0:1)-(baseMarket(b.leg.market)?0:1))||a.exactPrice-b.exactPrice
      })
      .slice(0,90)

    for(const option of pool){
      const next=[...states]
      for(const state of states){
        const playerKey=normName(option.leg.player)
        if(state.legs.length>=MAX_SELECTIONS||state.players.has(playerKey))continue
        const teamCount=state.teamCounts[option.teamKey]??0
        if(teamCount>=MAX_PLAYERS_PER_TEAM)continue
        const fam=family(option.leg.market)
        const familyCount=state.families[fam]??0
        const odds=state.odds*option.exactPrice
        if(odds>targetDecimal*1.45&&state.legs.length>=1)continue
        next.push({
          legs:[...state.legs,option],
          odds,
          modelProb:state.modelProb*option.modelP,
          conservativeProb:conservativeJoint([...state.legs,option]),
          players:new Set([...state.players,playerKey]),
          families:{...state.families,[fam]:familyCount+1},
          teamCounts:{...state.teamCounts,[option.teamKey]:teamCount+1},
          baseCount:state.baseCount+(baseMarket(option.leg.market)?1:0),
        })
      }

      const buckets=new Map<string,State[]>()
      for(const state of next){
        const oddsBucket=Math.floor(Math.log(Math.max(1,state.odds))*130)
        const homeCount=state.teamCounts.home??0,awayCount=state.teamCounts.away??0
        const key=oddsBucket+"|"+state.legs.length+"|"+homeCount+"|"+awayCount
        const rows=buckets.get(key)??[]
        rows.push(state)
        rows.sort((a,b)=>{
          const sa=stateSafety(a),sb=stateSafety(b)
          if(Math.abs(sa-sb)>.0000001)return sb-sa
          if(Math.abs(a.conservativeProb-b.conservativeProb)>.0000001)return b.conservativeProb-a.conservativeProb
          const weakA=a.legs.length?Math.min(...a.legs.map(x=>x.conservativeP)):0
          const weakB=b.legs.length?Math.min(...b.legs.map(x=>x.conservativeP)):0
          if(Math.abs(weakA-weakB)>.0001)return weakB-weakA
          return b.baseCount-a.baseCount
        })
        buckets.set(key,rows.slice(0,12))
      }
      states=[...buckets.values()].flat()
        .sort((a,b)=>stateSafety(b)-stateSafety(a)||b.conservativeProb-a.conservativeProb)
        .slice(0,4200)
    }

    let acceptable=states.filter(state=>
      state.legs.length>=2&&state.odds>=targetDecimal&&state.odds<=targetDecimal*1.35
    )
    if(bothTeamsAvailable){
      acceptable=acceptable.filter(state=>(state.teamCounts.home??0)>0&&(state.teamCounts.away??0)>0)
    }
    if(!acceptable.length)return null

    const rank=(rows:State[])=>rows.sort((a,b)=>{
      const sa=stateSafety(a),sb=stateSafety(b)
      if(Math.abs(sa-sb)>.0000001)return sb-sa
      if(Math.abs(a.conservativeProb-b.conservativeProb)>.0000001)return b.conservativeProb-a.conservativeProb
      const weakA=Math.min(...a.legs.map(x=>x.conservativeP))
      const weakB=Math.min(...b.legs.map(x=>x.conservativeP))
      if(Math.abs(weakA-weakB)>.001)return weakB-weakA
      const avgA=a.legs.reduce((x,l)=>x+l.conservativeP,0)/a.legs.length
      const avgB=b.legs.reduce((x,l)=>x+l.conservativeP,0)/b.legs.length
      if(Math.abs(avgA-avgB)>.001)return avgB-avgA
      const da=Math.abs(Math.log(a.odds)-Math.log(targetDecimal))
      const db=Math.abs(Math.log(b.odds)-Math.log(targetDecimal))
      if(Math.abs(da-db)>.005)return da-db
      return b.legs.length-a.legs.length
    })[0]
    const bestOverall=rank([...acceptable])
    const lowVariance=acceptable.filter(state=>state.legs.every(x=>{
      const fam=family(x.leg.market)
      return fam==="foul"||fam==="fouled"||fam==="shot"||fam==="sot"
    }))
    const bestLowVariance=lowVariance.length?rank([...lowVariance]):null
    if(bestLowVariance&&bestOverall){
      // Safe targets should be robust, not merely short. A goalscorer/card/assist
      // route must beat the best all-foul/shot/SOT route by a meaningful margin
      // before we accept the extra event variance. The margin relaxes as the user
      // asks for larger target odds, where some volatility is unavoidable.
      const requiredMargin=targetDecimal<=6?1.28:targetDecimal<=16?1.18:1.10
      const overallHasHighVariance=bestOverall.legs.some(x=>{
        const fam=family(x.leg.market)
        return fam==="goal"||fam==="assist"||fam==="card"
      })
      if(overallHasHighVariance&&stateSafety(bestOverall)<stateSafety(bestLowVariance)*requiredMargin){
        return bestLowVariance
      }
    }
    return bestOverall
  }

  return TARGET_ODDS.map(target=>{
    const chosen=search(target.decimal)
    if(!chosen)return {
      id:"target-"+fixture.id+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,
      available:false,referenceOdds:null,modelAllHitProbability:null,conservativeAllHitProbability:null,safetyScore:null,bookmaker:null,
      priceSource:null,marketsVerified:false,legs:[],maxSelections:MAX_SELECTIONS,maxPlayersPerTeam:MAX_PLAYERS_PER_TEAM,
      note:"No sufficiently strong two-team verified Bet365 player-prop route reaches this target under the 12-selection / six-players-per-team limits. The engine will not add match winner, double chance, total goals or corners just to manufacture the price.",
    }
    const legs:TargetOddsLeg[]=chosen.legs.map(x=>({
      fixtureId:fixture.id,competition:fixture.competition,kickoff:fixture.kickoff,
      home:fixture.home.name,away:fixture.away.name,player:x.leg.player,team:x.leg.team,
      market:x.leg.market,label:x.leg.label,probability:x.leg.probability,conservativeProbability:Math.round(x.conservativeP*1000)/1000,
      price:Math.round(x.exactPrice*1000)/1000,priceSource:"exact" as const,
      bookmaker:"Bet365" as const,confidence:x.leg.confidence,
    }))
    return {
      id:"target-"+fixture.id+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,available:true,
      referenceOdds:Math.round(chosen.odds*100)/100,
      modelAllHitProbability:Math.round(chosen.modelProb*10000)/10000,
      conservativeAllHitProbability:Math.round(chosen.conservativeProb*10000)/10000,
      safetyScore:Math.round(stateSafety(chosen)*10000)/10000,
      bookmaker:"Bet365" as const,priceSource:"bookmaker-singles" as const,marketsVerified:true,legs,
      maxSelections:MAX_SELECTIONS,maxPlayersPerTeam:MAX_PLAYERS_PER_TEAM,
      note:"Safest-route search: up to 12 Bet365 selections, max six different players per team, both teams considered, and one prop per player to reduce same-player correlation. All verified player props are eligible — goals, assists, cards, fouls committed, fouls drawn, shots and shots on target — but match/team markets such as match winner, double chance, total goals, BTTS and corners are excluded. The engine applies a stability penalty to scorer/assist/card legs and prefers several high-frequency 1+ events whenever that gives a better whole-slip chance.",
    }
  })
}

function buildTargetOddsGames(scans:FixtureScan[],fixturePool:Fixture[]=[]):TargetOddsGame[]{
  const fixtures=new Map<string,Fixture>()
  const scorecards=new Map<string,Scorecard|null>()
  for(const fixture of fixturePool)fixtures.set(fixture.id,fixture)
  for(const scan of scans){
    fixtures.set(scan.fixture.id,scan.fixture)
    scorecards.set(scan.fixture.id,scan.scorecard)
  }
  return [...fixtures.values()]
    .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
    .map(fixture=>{const scorecard=scorecards.get(fixture.id)??null;return {fixture,lineupsConfirmed:Boolean(scorecard?.lineupsConfirmed),targets:buildTargetOddsSlips(scorecard,fixture)}})
}
function selectDiversifiedRecommendations(rows:Recommendation[],limit=8){
  const sorted=[...rows].sort((a,b)=>b.rank-a.rank)
  if(sorted.length<=limit)return sorted
  const selected:Recommendation[]=[]
  const seen=new Set<string>()
  const add=(row:Recommendation|undefined)=>{
    if(!row||seen.has(row.id)||selected.length>=limit)return
    selected.push(row);seen.add(row.id)
  }
  // Keep the strongest overall recommendation first.
  add(sorted[0])
  // Then make sure every competition that has a qualified candidate is visible.
  const bestByCompetition=new Map<Competition,Recommendation>()
  for(const row of sorted){
    const competition=row.fixture.competition
    if(!bestByCompetition.has(competition))bestByCompetition.set(competition,row)
  }
  for(const row of [...bestByCompetition.values()].sort((a,b)=>b.rank-a.rank))add(row)
  for(const row of sorted)add(row)
  return selected
}

function blockedReason(scorecard:Scorecard,slip:BetSlip|FoulTargetSlip,kind:"standard"|"foul"){
  if(kind==="foul"){
    const status=(slip as FoulTargetSlip).marketStatus??scorecard.marketAvailability?.foul??"unknown"
    if(status==="unavailable")return "Foul market unavailable at the selected bookmaker"
    if(status==="unknown")return "Foul market not verified at the selected bookmaker"
    if((slip as FoulTargetSlip).usesLivePrices===false)return "One or more foul prices are estimated and must be checked in the bookmaker"
    return null
  }
  const statuses=(slip as BetSlip).marketAvailability??[]
  if(statuses.some(x=>x.status==="unavailable"))return "One or more required markets are unavailable"
  if(statuses.some(x=>x.status==="unknown"))return "One or more required markets are not verified"
  return null
}
async function fixturesFor(date:string,refresh:boolean){
  const q=new URLSearchParams({date})
  if(refresh)q.set("refresh",String(Date.now()))
  const res=await fixturesGET(new Request("http://local/api/fixtures?"+q.toString()))
  return res.ok?await res.json():null
}
async function scorecardFor(f:Fixture,refresh:boolean){
  try{
    const q=new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition})
    if(refresh)q.set("refresh",String(Date.now()))
    const res=await scorecardGET(new Request("http://local/api/fixture-scorecard?"+q.toString()))
    return res.ok?await res.json() as Scorecard:null
  }catch{return null}
}

type MultiMatchLeg={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;
  player:string;team:string;market:string;label:string;probability:number;
  bookmakerOdds:number;bookmaker:"Bet365";confidence:SlipLeg["confidence"];
  recent5HitRate:number|null;seasonHitRate:number|null;h2hHitRate:number|null;h2hMatches:number;sampleMatches:number
}
type MultiMatchRiskTier=string
type MultiMatchGameBuilder={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  riskTier:MultiMatchRiskTier;targetFractional:string;targetDecimal:number;referenceOdds:number;modelAllHitProbability:number;
  conservativeAllHitProbability:number;includesCard:boolean;cardPick:string|null;lineupsConfirmed:boolean;preMatchSnapshot:boolean;legs:MultiMatchLeg[]
}
type MultiMatchTier={
  id:MultiMatchRiskTier;title:string;description:string;targetFractionalPerMatch:string;targetDecimalPerMatch:number;
  available:boolean;matchBuilders:MultiMatchGameBuilder[];legs:MultiMatchLeg[];
  combinedBet365Odds:number|null;conservativeAllHitProbability:number|null;note:string
}
type MultiMatchBuild={
  available:boolean;targetFractionalPerMatch:string;maxMatches:number;eligibleFixtureCount:number;
  matchBuilders:MultiMatchGameBuilder[];legs:MultiMatchLeg[];
  combinedBet365Odds:number|null;modelAllHitProbability:number|null;conservativeAllHitProbability:number|null;
  tiers:MultiMatchTier[];defaultTier:MultiMatchRiskTier;note:string
}
type YellowCardWatchRow={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  player:string;team:string;probability:number;evidenceScore?:number;bookmakerOdds:number;confidence:SlipLeg["confidence"];reason:string;
  probabilityBasis:"model"|"bet365-implied"
}
function fullPlayerMarketSet(status:Scorecard["marketAvailability"]){
  return ["card","foul","fouled","shot","sot"].every(key=>(status as any)?.[key]==="available")
}
function usablePlayerPropCoverage(status:Scorecard["marketAvailability"]){
  const keys=["goal","assist","card","foul","fouled","shot","sot"]
  return keys.filter(key=>(status as any)?.[key]==="available").length>=2
}
type FixtureScan={fixture:Fixture;scorecard:Scorecard|null;recommendations:Recommendation[]}
type MultiGameBoardPick={
  player:string;team:string;market:string;label:string;probability:number;rankScore:number;
  bookmakerOdds:number|null;bookmakerName:string|null;confidence:SlipLeg["confidence"];reason:string;
  recent5HitRate:number|null;seasonHitRate:number|null;h2hHitRate:number|null;h2hMatches:number
}
type MultiGameBoardGroup={id:"cards"|"fouls"|"fouled"|"shots"|"sot"|"goals"|"assists";title:string;picks:MultiGameBoardPick[]}
type MultiGameBoard={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  lineupsConfirmed:boolean;lineupMode:"confirmed"|"predicted"|"squad";preMatchSnapshot:boolean;groups:MultiGameBoardGroup[]
}

function cardEvidenceEligible(player:ScorecardPlayer,market:ScorecardMarket){
  const h2hN=Number(market.h2hMatches??0)
  const h2hRate=Number(market.h2hHitRate??0)
  const recent=Number(market.recent5HitRate??0)
  const season=Number(market.seasonHitRate??0)
  const sample=Number(market.sampleMatches??0)
  const evidenceScore=Number(market.recommendationScore??market.probability??0)
  const after2=player.yellowConditionals?.after2PlusFouls
  const clubMatches=Number(player.cardContext?.clubMatches??0)
  const clubRate=Number(player.cardContext?.clubCardRate??0)
  const strongH2H=h2hN>=2&&h2hRate>=.50
  const strongCurrent=recent>=.40&&season>=.20
  const strongSeason=sample>=8&&season>=.30
  const strongClub=clubMatches>=8&&clubRate>=.20
  const foulPressure=Number(after2?.matches??0)>=3&&Number(after2?.rate??0)>=.45
  return Number(market.probability)>=.14&&evidenceScore>=.145&&(strongH2H||strongCurrent||strongSeason||strongClub||foulPressure)
}

function lowThresholdMarket(market:string){
  return market==="foul1"||market==="fouled1"||market==="shot1"||market==="sot1"
}
function marketStabilityFactor(leg:SlipLeg){
  if(leg.market==="foul1")return 1.10
  if(leg.market==="fouled1")return 1.045
  if(leg.market==="shot1")return 1.02
  if(leg.market==="sot1")return .985
  if(/^foul[2-9]/.test(leg.market))return .93
  if(leg.market==="shot2")return .945
  if(leg.market==="sot2")return .91
  if(leg.market==="card")return .84
  if(leg.market==="goal1")return .82
  if(leg.market==="assist1")return .79
  return .96
}
function routeSelectionSafety(legs:SlipLeg[],joint:number){
  if(!legs.length)return 0
  const stabilityGeo=Math.exp(legs.reduce((sum,leg)=>sum+Math.log(Math.max(.70,marketStabilityFactor(leg))),0)/legs.length)
  const foulOneCount=legs.filter(leg=>leg.market==="foul1").length
  const lowThresholdCount=legs.filter(leg=>lowThresholdMarket(leg.market)).length
  const repeatEventBonus=1+Math.min(.09,foulOneCount*.018+Math.max(0,lowThresholdCount-foulOneCount)*.006)
  return joint*stabilityGeo*repeatEventBonus
}
function evidenceSupport(leg:SlipLeg){
  const recent=Number(leg.recent5HitRate),season=Number(leg.seasonHitRate)
  const h2h=Number(leg.h2hHitRate),h2hN=Number(leg.h2hMatches??0)
  let weighted=0,weight=0
  if(Number.isFinite(recent)){weighted+=recent*.34;weight+=.34}
  if(Number.isFinite(season)){weighted+=season*.46;weight+=.46}
  if(h2hN>=2&&Number.isFinite(h2h)){
    const hw=Math.min(.20,.08+.03*Math.min(4,h2hN))
    weighted+=h2h*hw;weight+=hw
  }
  return weight>0?Math.max(0,Math.min(1,weighted/weight)):Math.max(0,Math.min(1,Number(leg.probability??0)))
}
function evidenceReliability(leg:SlipLeg){
  const support=evidenceSupport(leg)
  let factor=.91+support*.13
  if(lowThresholdMarket(leg.market))factor+=.012
  else if(/^foul[2-9]/.test(leg.market)||leg.market==="shot2"||leg.market==="sot2")factor-=.035
  const h2h=Number(leg.h2hHitRate),h2hN=Number(leg.h2hMatches??0)
  if(h2hN>=2&&Number.isFinite(h2h)){
    if(h2h>=.75)factor+=.012
    else if(h2h<=.20)factor-=.012
  }
  const mins=Number(leg.expectedMinutes)
  if(Number.isFinite(mins)){
    if(mins<45)factor*=.93
    else if(mins<60)factor*=.97
    else if(mins<72)factor*=.985
  }
  return Math.max(.84,Math.min(1.035,factor))
}

function directPlayerCandidates(scorecard:Scorecard){
  const out:SlipLeg[]=[]
  const seen=new Set<string>()
  for(const player of scorecard.players??[]){
    for(const [marketKey,market] of Object.entries(player.markets??{})){
      // Recommendation builders are player-prop led. Match winner, double chance,
      // total goals and corners are intentionally not supported here.
      const supported=marketKey==="card"||marketKey.startsWith("foul")||marketKey.startsWith("fouled")||marketKey.startsWith("shot")||marketKey.startsWith("sot")||marketKey.startsWith("goal")||marketKey.startsWith("assist")
      if(!supported)continue
      const exact=market.bookmakerName==="Bet365"&&market.bookmakerOdds!=null&&Number(market.bookmakerOdds)>1
      const probability=Number(market.probability)
      const minimum=marketKey==="card"?.14:marketKey.startsWith("goal")||marketKey.startsWith("assist")?.18:marketKey.startsWith("sot")?.20:.24
      const h2hN=Number(market.h2hMatches??0)
      const h2hRate=Number(market.h2hHitRate??0)
      const recent=Number(market.recent5HitRate??0)
      const season=Number(market.seasonHitRate??0)
      const lowSampleEvidence=Number(player.expectedMinutes??0)>=50&&(
        (h2hN>=2&&h2hRate>=.50)||
        recent>=.60||
        season>=.65
      )
      if(!exact||!Number.isFinite(probability)||probability<minimum)continue
      if(market.confidence==="D"&&!lowSampleEvidence)continue
      if(marketKey==="card"&&!cardEvidenceEligible(player,market))continue
      const key=normName(player.name)+"|"+marketKey+"|"+market.label
      if(seen.has(key))continue
      seen.add(key)
      out.push({
        player:player.name,team:player.team,market:marketKey,label:market.label,
        probability,fairOdds:market.fairOdds??null,
        bookmakerOdds:Number(market.bookmakerOdds),bookmakerName:"Bet365",
        edge:market.edge??null,confidence:market.confidence,
        reason:(market.reasons??[]).join(" · ")||"Verified Bet365 player market",
        priceSource:"exact",
        bookmakerProbability:market.bookmakerNoVigProbability??market.impliedProbability??(Number(market.bookmakerOdds)>1?1/Number(market.bookmakerOdds):null),
        recent5HitRate:Number.isFinite(Number(market.recent5HitRate))?Number(market.recent5HitRate):null,
        seasonHitRate:Number.isFinite(Number(market.seasonHitRate))?Number(market.seasonHitRate):null,
        h2hHitRate:Number.isFinite(Number(market.h2hHitRate))?Number(market.h2hHitRate):null,
        h2hMatches:Number(market.h2hMatches??0),
        sampleMatches:Number(market.sampleMatches??0),
        expectedMinutes:Number.isFinite(Number(player.expectedMinutes))?Number(player.expectedMinutes):null,
        position:player.position??null,
      })
    }
  }
  return out
}

function buildMultiGameBoards(scans:FixtureScan[]):MultiGameBoard[]{
  const specs:Array<{id:MultiGameBoardGroup["id"];title:string;key:string}>=[
    {id:"cards",title:"Most likely to be carded",key:"card"},
    {id:"fouls",title:"Fouls committed",key:"foul1"},
    {id:"fouled",title:"Fouls drawn",key:"fouled1"},
    {id:"shots",title:"Shots",key:"shot1"},
    {id:"sot",title:"Shots on target",key:"sot1"},
    {id:"goals",title:"Goalscorer",key:"goal1"},
    {id:"assists",title:"Assists",key:"assist1"},
  ]
  const evidence=(m:ScorecardMarket)=>{
    const recent=Number(m.recent5HitRate),season=Number(m.seasonHitRate),h2h=Number(m.h2hHitRate),h2hN=Number(m.h2hMatches??0)
    let total=0,weight=0
    if(Number.isFinite(recent)){total+=recent*.30;weight+=.30}
    if(Number.isFinite(season)){total+=season*.50;weight+=.50}
    if(h2hN>=2&&Number.isFinite(h2h)){total+=h2h*.20;weight+=.20}
    return weight?total/weight:Number(m.probability??0)
  }
  const ranking=(id:MultiGameBoardGroup["id"],m:ScorecardMarket)=>{
    const p=Math.max(0,Math.min(1,Number(m.probability??0)))
    const ev=Math.max(0,Math.min(1,evidence(m)))
    if(id==="cards"){
      const recommendation=Math.max(0,Math.min(1,Number(m.recommendationScore??p)))
      return p*.38+recommendation*.42+ev*.20
    }
    return p*.76+ev*.24
  }
  return scans
    .filter(scan=>scan.scorecard?.ok&&(scan.scorecard.players?.length??0)>0)
    .sort((a,b)=>a.fixture.kickoff.localeCompare(b.fixture.kickoff))
    .map(scan=>{
      const scorecard=scan.scorecard!
      const groups:MultiGameBoardGroup[]=specs.map(spec=>{
        const picks=(scorecard.players??[])
          .map(player=>{
            const market=player.markets?.[spec.key]
            if(!market||!Number.isFinite(Number(market.probability)))return null
            const probability=Math.max(0,Math.min(1,Number(market.probability)))
            return {
              player:player.name,team:player.team,market:spec.key,label:market.label,probability,
              rankScore:ranking(spec.id,market),
              bookmakerOdds:market.bookmakerName==="Bet365"&&Number(market.bookmakerOdds)>1?Number(market.bookmakerOdds):null,
              bookmakerName:market.bookmakerName==="Bet365"?"Bet365":null,
              confidence:market.confidence,
              reason:(market.reasons??[]).slice(0,2).join(" · ")||"Season, recent-form and matchup model",
              recent5HitRate:Number.isFinite(Number(market.recent5HitRate))?Number(market.recent5HitRate):null,
              seasonHitRate:Number.isFinite(Number(market.seasonHitRate))?Number(market.seasonHitRate):null,
              h2hHitRate:Number.isFinite(Number(market.h2hHitRate))?Number(market.h2hHitRate):null,
              h2hMatches:Number(market.h2hMatches??0),
            } as MultiGameBoardPick
          })
          .filter(Boolean) as MultiGameBoardPick[]
        picks.sort((a,b)=>b.rankScore-a.rankScore||b.probability-a.probability)
        return {id:spec.id,title:spec.title,picks:picks.slice(0,3)}
      })
      return {
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,
        homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,
        lineupsConfirmed:Boolean(scorecard.lineupsConfirmed),
        lineupMode:scorecard.lineupMode??"squad",
        preMatchSnapshot:new Date(scan.fixture.kickoff).getTime()<=Date.now(),
        groups,
      }
    })
}


function buildMultiMatchFromScans(scans:FixtureScan[]):MultiMatchBuild{
  const eligible=scans.filter(x=>x.scorecard?.ok&&usablePlayerPropCoverage(x.scorecard.marketAvailability))
  const tierConfigs=[
    {id:"most-likely",title:"Most Likely",targetFractional:"Best",targetDecimal:0},
    {id:"3-1",title:"3/1",targetFractional:"3/1",targetDecimal:4},
    {id:"5-1",title:"5/1",targetFractional:"5/1",targetDecimal:6},
    {id:"10-1",title:"10/1",targetFractional:"10/1",targetDecimal:11},
    {id:"15-1",title:"15/1",targetFractional:"15/1",targetDecimal:16},
    {id:"20-1",title:"20/1",targetFractional:"20/1",targetDecimal:21},
    {id:"25-1",title:"25/1",targetFractional:"25/1",targetDecimal:26},
    {id:"30-1",title:"30/1",targetFractional:"30/1",targetDecimal:31},
    {id:"40-1",title:"40/1",targetFractional:"40/1",targetDecimal:41},
    {id:"50-1",title:"50/1",targetFractional:"50/1",targetDecimal:51},
    {id:"75-1",title:"75/1",targetFractional:"75/1",targetDecimal:76},
    {id:"100-1",title:"100/1",targetFractional:"100/1",targetDecimal:101},
  ] as const
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const routesByFixture=new Map<string,Map<string,MultiMatchGameBuilder>>()

  for(const scan of eligible){
    const scorecard=scan.scorecard!
    const sourceLegs=directPlayerCandidates(scorecard)
    const sourceByKey=new Map(sourceLegs.map(leg=>[normName(leg.player)+"|"+leg.market,leg]))
    const byTier=new Map<string,MultiMatchGameBuilder>()

    // Most Likely remains a natural-price route: two highest-stability distinct
    // player events. Every explicit odds target below uses the exact same search
    // function as the individual Target Odds builder.
    const natural=sourceLegs
      .filter(leg=>leg.bookmakerName==="Bet365"&&leg.bookmakerOdds!=null&&Number(leg.bookmakerOdds)>1&&leg.confidence!=="D")
      .sort((a,b)=>(b.probability*marketStabilityFactor(b))-(a.probability*marketStabilityFactor(a))||b.probability-a.probability)
    const most:SlipLeg[]=[]
    const seen=new Set<string>()
    for(const leg of natural){
      const key=normName(leg.player)
      if(!key||seen.has(key))continue
      seen.add(key);most.push(leg)
      if(most.length>=2)break
    }
    if(most.length){
      const product=most.reduce((v,l)=>v*Number(l.bookmakerOdds),1)
      const raw=most.reduce((v,l)=>v*l.probability,1)
      const mapped:MultiMatchLeg[]=most.map(leg=>({
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,player:leg.player,team:leg.team,market:leg.market,label:leg.label,
        probability:leg.probability,bookmakerOdds:Number(leg.bookmakerOdds),bookmaker:"Bet365",confidence:leg.confidence,
        recent5HitRate:Number.isFinite(Number(leg.recent5HitRate))?Number(leg.recent5HitRate):null,
        seasonHitRate:Number.isFinite(Number(leg.seasonHitRate))?Number(leg.seasonHitRate):null,
        h2hHitRate:Number.isFinite(Number(leg.h2hHitRate))?Number(leg.h2hHitRate):null,
        h2hMatches:Number(leg.h2hMatches??0),sampleMatches:Number(leg.sampleMatches??0),
      }))
      byTier.set("most-likely",{
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,
        riskTier:"most-likely",targetFractional:"Best",targetDecimal:0,referenceOdds:Math.round(product*100)/100,
        modelAllHitProbability:Math.round(raw*10000)/10000,conservativeAllHitProbability:Math.round(raw*10000)/10000,
        includesCard:most.some(l=>family(l.market)==="card"),cardPick:most.find(l=>family(l.market)==="card")?.player??null,
        lineupsConfirmed:Boolean(scorecard.lineupsConfirmed),preMatchSnapshot:new Date(scan.fixture.kickoff).getTime()<=Date.now(),legs:mapped,
      })
    }

    const targets=buildTargetOddsSlips(scorecard,scan.fixture)
    for(const target of targets){
      if(!target.available||!target.legs.length)continue
      const sourceTarget=target.legs.map(t=>sourceByKey.get(normName(t.player)+"|"+t.market)).filter(Boolean) as SlipLeg[]
      const mapped:MultiMatchLeg[]=target.legs.map(t=>{
        const src=sourceByKey.get(normName(t.player)+"|"+t.market)
        return {
          fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
          home:scan.fixture.home.name,away:scan.fixture.away.name,player:t.player,team:t.team,market:t.market,label:t.label,
          probability:t.probability,bookmakerOdds:t.price,bookmaker:"Bet365",confidence:t.confidence,
          recent5HitRate:Number.isFinite(Number(src?.recent5HitRate))?Number(src?.recent5HitRate):null,
          seasonHitRate:Number.isFinite(Number(src?.seasonHitRate))?Number(src?.seasonHitRate):null,
          h2hHitRate:Number.isFinite(Number(src?.h2hHitRate))?Number(src?.h2hHitRate):null,
          h2hMatches:Number(src?.h2hMatches??0),sampleMatches:Number(src?.sampleMatches??0),
        }
      })
      const cardLeg=sourceTarget.find(l=>family(l.market)==="card")??null
      byTier.set(target.targetFractional.replace("/","-"),{
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,
        riskTier:target.targetFractional.replace("/","-"),targetFractional:target.targetFractional,targetDecimal:target.targetDecimal,
        referenceOdds:Number(target.referenceOdds??0),modelAllHitProbability:Number(target.modelAllHitProbability??0),
        conservativeAllHitProbability:Number(target.conservativeAllHitProbability??0),includesCard:Boolean(cardLeg),cardPick:cardLeg?.player??null,
        lineupsConfirmed:Boolean(scorecard.lineupsConfirmed),preMatchSnapshot:new Date(scan.fixture.kickoff).getTime()<=Date.now(),legs:mapped,
      })
    }
    routesByFixture.set(scan.fixture.id,byTier)
  }

  const tiers:MultiMatchTier[]=tierConfigs.map(cfg=>{
    const built=eligible.map(scan=>routesByFixture.get(scan.fixture.id)?.get(cfg.id)??null).filter(Boolean) as MultiMatchGameBuilder[]
    built.sort((a,b)=>b.conservativeAllHitProbability-a.conservativeAllHitProbability||b.modelAllHitProbability-a.modelAllHitProbability)
    const matchBuilders=built.slice(0,10)
    const legs=matchBuilders.flatMap(x=>x.legs)
    const combined=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.referenceOdds,1):null
    const allHit=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.conservativeAllHitProbability,1):null
    return {
      id:cfg.id,title:cfg.title,
      description:cfg.id==="most-likely"
        ?"The strongest natural-price player-prop route in each match."
        :`The same probability-first, correlation-aware player-prop search as Match Builder, clearing ${cfg.targetFractional} in each match.`,
      targetFractionalPerMatch:cfg.targetFractional,targetDecimalPerMatch:cfg.targetDecimal,
      available:matchBuilders.length>=1,matchBuilders,legs,
      combinedBet365Odds:combined==null?null:Math.round(combined*100)/100,
      conservativeAllHitProbability:allHit==null?null:Math.round(allHit*10000)/10000,
      note:cfg.id==="most-likely"
        ?"Start here for the strongest estimated win chance from verified Bet365 player markets."
        :`Probability first, odds floor second. No weaker selection is forced when ${cfg.targetFractional} cannot be reached safely.`,
    }
  })

  const first=tiers.find(t=>t.id==="most-likely")??tiers[0]
  return {
    available:Boolean(first?.available),targetFractionalPerMatch:first?.targetFractionalPerMatch??"Best",maxMatches:10,
    eligibleFixtureCount:eligible.length,matchBuilders:first?.matchBuilders??[],legs:first?.legs??[],
    combinedBet365Odds:first?.combinedBet365Odds??null,modelAllHitProbability:first?.conservativeAllHitProbability??null,
    conservativeAllHitProbability:first?.conservativeAllHitProbability??null,tiers,defaultTier:"most-likely",
    note:"Multi-Match now reuses the individual probability-first, correlation-aware target search for 3/1 through 100/1. Confirmed starters and verified Bet365 player markets remain hard eligibility gates.",
  }
}
function buildYellowCardWatchFromScans(scans:FixtureScan[]):YellowCardWatchRow[]{
  const rows:YellowCardWatchRow[]=[]
  const seen=new Set<string>()

  for(const scan of scans){
    const scorecard=scan.scorecard
    if(!scorecard?.ok||scorecard.marketAvailability?.card!=="available")continue

    // Prefer Match Edge model probabilities when a current player row exists.
    for(const player of scorecard.players??[]){
      const market=player.markets?.card
      if(!market||market.bookmakerName!=="Bet365"||market.bookmakerOdds==null||Number(market.bookmakerOdds)<=1||market.confidence==="D"||!cardEvidenceEligible(player,market))continue
      const key=scan.fixture.id+"|"+normName(player.name)
      if(seen.has(key))continue
      seen.add(key)
      rows.push({
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,
        player:player.name,team:player.team,probability:Number(market.probability),evidenceScore:Number(market.recommendationScore??market.probability),
        bookmakerOdds:Number(market.bookmakerOdds),confidence:market.confidence,
        reason:(market.reasons??[]).join(" · ")||"Verified Bet365 player-card market",
        probabilityBasis:"model",
      })
    }

    // Do not fall back to bookmaker-implied card prices. Cards only appear here
    // when the player model has supporting H2H/current-form/foul-pressure evidence.
  }

  return rows
    .sort((a,b)=>{
      if(a.probabilityBasis!==b.probabilityBasis)return a.probabilityBasis==="model"?-1:1
      const evidenceDiff=Number(b.evidenceScore??b.probability)-Number(a.evidenceScore??a.probability)
      if(Math.abs(evidenceDiff)>.0001)return evidenceDiff
      return b.probability-a.probability
    })
    .slice(0,16)
}

const LIVE_PROP_MARKETS=["card","foul1","fouled1","shot1","sot1","goal1","assist1"] as const
function remainingEventProbability(fullMatchProbability:number,elapsed:number){
  const p=Math.max(.001,Math.min(.995,Number(fullMatchProbability)||0))
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,elapsed)))/96))
  const lambda=-Math.log(1-p)
  return Math.max(.001,Math.min(.99,1-Math.exp(-lambda*remaining)))
}
function liveStatActive(stat:LivePlayerStat){
  if(stat.subbedOff)return false
  return stat.starter||stat.subbedOn||stat.minutes>0||stat.foulsCommitted>0||stat.foulsDrawn>0||stat.shots>0||
    stat.shotsOnTarget>0||stat.goals>0||stat.assists>0||stat.yellowCards>0||stat.redCards>0
}
function buildLivePlayerProps(scorecard:Scorecard|null,elapsed:number,liveStats:Map<string,LivePlayerStat>,referee:RefereeLiveContext|null=null){
  if(!scorecard?.ok)return []
  const candidates:any[]=[]
  const teamTotals=new Map<string,{fc:number;fd:number}>()
  for(const stat of liveStats.values()){
    if(!liveStatActive(stat))continue
    const key=normName(stat.team)
    const cur=teamTotals.get(key)??{fc:0,fd:0}
    cur.fc+=stat.foulsCommitted
    cur.fd+=stat.foulsDrawn
    teamTotals.set(key,cur)
  }
  const teamKeys=[...teamTotals.keys()]
  const per90=(value:number)=>value*90/Math.max(12,elapsed)
  const logit=(p:number)=>Math.log(Math.max(.001,Math.min(.999,p))/(1-Math.max(.001,Math.min(.999,p))))
  const logistic=(x:number)=>1/(1+Math.exp(-x))

  for(const player of scorecard.players??[]){
    const stat=liveStats.get(normName(player.name))??(player.dbName?liveStats.get(normName(player.dbName)):undefined)
    if(stat&&!liveStatActive(stat))continue

    for(const marketKey of LIVE_PROP_MARKETS){
      const market=player.markets?.[marketKey]
      if(!market||market.confidence==="D")continue

      let currentCount=0
      if(stat){
        if(marketKey==="foul1")currentCount=stat.foulsCommitted
        else if(marketKey==="fouled1")currentCount=stat.foulsDrawn
        else if(marketKey==="shot1")currentCount=stat.shots
        else if(marketKey==="sot1")currentCount=stat.shotsOnTarget
        else if(marketKey==="goal1")currentCount=stat.goals
        else if(marketKey==="assist1")currentCount=stat.assists
        else if(marketKey==="card")currentCount=stat.yellowCards+stat.redCards
      }

      // Settled player markets disappear. For count markets the next threshold
      // becomes the target, exactly like the Spain v England Match Builder.
      if((marketKey==="card"||marketKey==="goal1"||marketKey==="assist1")&&currentCount>0)continue
      const nextThreshold=currentCount+1
      const nextLabel=marketKey==="foul1"?nextThreshold+"+ fouls committed"
        :marketKey==="fouled1"?nextThreshold+"+ fouls drawn"
        :marketKey==="shot1"?nextThreshold+"+ shots"
        :marketKey==="sot1"?nextThreshold+"+ shots on target"
        :market.label

      const base=Math.max(.001,Math.min(.995,Number(market.probability??0)))
      let probability=remainingEventProbability(base,elapsed)
      let pressureNote=""

      const ownKey=normName(stat?.team??player.team)
      const oppKey=teamKeys.find(k=>k!==ownKey)??""
      const own=teamTotals.get(ownKey)??{fc:0,fd:0}
      const opp=teamTotals.get(oppKey)??{fc:0,fd:0}
      const ownCommitRate=per90(own.fc)
      const oppDrawRate=per90(opp.fd)

      if(marketKey==="card"&&stat){
        const fouls=Math.max(0,stat.foulsCommitted)
        const cond=fouls>=3?player.yellowConditionals?.after3PlusFouls
          :fouls>=2?player.yellowConditionals?.after2PlusFouls
          :fouls>=1?player.yellowConditionals?.after1PlusFouls:null
        const overall=player.yellowConditionals?.overall
        const disciplineHeat=Math.max(0,Math.min(1,Number(stat.disciplineHeat??0)))
        const recentBurst=Math.min(.34,Number(stat.recentFouls10??0)*.17+Math.max(0,Number(stat.recentFouls15??0)-Number(stat.recentFouls10??0))*.07)
        const refHistorical=Math.max(-.18,Math.min(.18,Number(referee?.historicalModifier??0)))
        const refLive=Math.max(-.34,Math.min(.34,Number(referee?.liveDecisionModifier??0)))
        const refDelta=Math.max(-.30,Math.min(.30,refHistorical*.45+refLive))
        const refInteraction=refDelta*(.72+disciplineHeat*.45+Math.min(.18,fouls*.035))
        let delta=Math.min(1.18,.14*fouls+Math.max(0,oppDrawRate-7)*.010+disciplineHeat*.52+recentBurst+refInteraction)
        if(cond?.rate!=null&&Number(overall?.rate)>0&&Number(cond.matches??0)>=2){
          const reliability=Math.min(1,Number(cond.matches??0)/10)
          const observed=logit(Number(cond.rate))-logit(Math.max(.02,Number(overall!.rate)))
          delta=Math.max(delta,Math.max(-.10,Math.min(.95,observed*.72*reliability+.11*fouls)))
          pressureNote=`Live: ${fouls} foul${fouls===1?"":"s"} committed; historical booking rate after this foul load ${Math.round(Number(cond.rate)*100)}% (${cond.matches} matches).`
        }else if(fouls>0){
          pressureNote=`Live: ${fouls} foul${fouls===1?"":"s"} committed.`
        }
        probability=logistic(logit(probability)+delta)
        probability=Math.max(.001,Math.min(.95,probability))
        const liveSignals=(stat.aggressionSignals??[]).slice(0,2)
        if(Number(stat.recentFouls10??0)>0)pressureNote+=(pressureNote?" ":"")+`${stat.recentFouls10} new foul${stat.recentFouls10===1?"":"s"} in the recent 10-minute window.`
        if(liveSignals.length)pressureNote+=(pressureNote?" ":"")+`Live discipline signal: ${liveSignals.join(", ")}.`
        pressureNote+=(pressureNote?" ":"")+`Discipline heat ${Math.round(disciplineHeat*100)}/100; opponent fouls drawn ${oppDrawRate.toFixed(1)}/90.`
        if(referee?.name){
          pressureNote+=` Referee ${referee.name}: ${referee.strictnessLabel} live profile`
          if(referee.historicalYellowsPerGame!=null)pressureNote+=`, historical ${Number(referee.historicalYellowsPerGame).toFixed(1)} yellows/game`
          if(referee.liveYellowsPer90!=null)pressureNote+=`, running ${Number(referee.liveYellowsPer90).toFixed(1)} yellows/90`
          if(referee.liveFoulsPer90!=null)pressureNote+=` from ${Number(referee.liveFoulsPer90).toFixed(1)} fouls/90`
          pressureNote+="."
        }
      }else if(marketKey==="foul1"&&stat){
        const delta=Math.min(.58,stat.foulsCommitted*.12+Math.max(0,oppDrawRate-7)*.012)
        probability=logistic(logit(probability)+delta)
        pressureNote=`Live: ${stat.foulsCommitted} fouls committed; opponent fouls drawn ${oppDrawRate.toFixed(1)}/90.`
      }else if(marketKey==="fouled1"&&stat){
        const delta=Math.min(.42,stat.foulsDrawn*.07+Math.max(0,per90(own.fd)-7)*.008)
        probability=logistic(logit(probability)+delta)
        pressureNote=`Live: fouled ${stat.foulsDrawn} times already.`
      }else if((marketKey==="shot1"||marketKey==="sot1")&&stat){
        const delta=Math.min(.38,stat.shots*.07+stat.shotsOnTarget*.11)
        probability=logistic(logit(probability)+delta)
        pressureNote=`Live: ${stat.shots} shots, ${stat.shotsOnTarget} on target.`
      }else if(marketKey==="goal1"&&stat&&stat.shots>0){
        probability=logistic(logit(probability)+Math.min(.30,stat.shots*.07+stat.shotsOnTarget*.12))
        pressureNote=`Live: ${stat.shots} shots, ${stat.shotsOnTarget} on target.`
      }

      const marketGroup=marketKey==="card"?"card":marketKey==="foul1"?"foul":marketKey==="fouled1"?"fouled":
        marketKey==="shot1"?"shot":marketKey==="sot1"?"sot":marketKey==="goal1"?"goal":"assist"
      const status=(scorecard.marketAvailability as any)?.[marketGroup]??"unknown"
      const historicalRank=Math.max(0,Math.min(1,Number(market.recommendationScore??base)))
      const liveFoulRank=stat?Math.min(.24,stat.foulsCommitted*.055)+Math.min(.04,stat.foulsDrawn*.010):0
      const heat=stat?Math.max(0,Math.min(1,Number(stat.disciplineHeat??0))):0
      const burst=stat?Math.min(.16,Number(stat.recentFouls10??0)*.08):0
      const rankScore=marketKey==="card"
        ?Math.max(0,Math.min(1,probability*.40+historicalRank*.28+liveFoulRank+heat*.22+burst))
        :probability

      candidates.push({
        player:player.name,team:player.team,market:marketKey,label:nextLabel,
        probability:Math.round(probability*1000)/1000,
        rankScore:Math.round(rankScore*1000)/1000,
        fullMatchProbability:Math.round(base*1000)/1000,
        fairOdds:Math.round((1/Math.max(.01,probability))*100)/100,
        confidence:market.confidence,marketStatus:status,
        bookmakerOdds:market.bookmakerName==="Bet365"&&Number(market.bookmakerOdds)>1?Number(market.bookmakerOdds):null,
        bookmakerName:market.bookmakerName==="Bet365"?"Bet365":null,
        currentCount,liveStatsAvailable:Boolean(stat),
        currentFouls:stat?.foulsCommitted??null,currentFouled:stat?.foulsDrawn??null,
        currentShots:stat?.shots??null,currentSot:stat?.shotsOnTarget??null,
        currentGoals:stat?.goals??null,currentAssists:stat?.assists??null,
        currentYellowCards:stat?.yellowCards??null,currentRedCards:stat?.redCards??null,
        disciplineHeat:stat?.disciplineHeat??0,recentFouls10:stat?.recentFouls10??0,recentFouls15:stat?.recentFouls15??0,
        aggressionSignals:stat?.aggressionSignals??[],lastAggressionMinute:stat?.lastAggressionMinute??null,
        recent5HitRate:Number.isFinite(Number(market.recent5HitRate))?Number(market.recent5HitRate):null,
        seasonHitRate:Number.isFinite(Number(market.seasonHitRate))?Number(market.seasonHitRate):null,
        h2hHitRate:Number.isFinite(Number(market.h2hHitRate))?Number(market.h2hHitRate):null,
        h2hMatches:Number(market.h2hMatches??0),sampleMatches:Number(market.sampleMatches??0),
        referee:referee?{name:referee.name,strictnessScore:referee.strictnessScore,strictnessLabel:referee.strictnessLabel,historicalYellowsPerGame:referee.historicalYellowsPerGame,liveYellowsPer90:referee.liveYellowsPer90,liveFoulsPer90:referee.liveFoulsPer90}:null,
        reason:"Remaining-match estimate from the active-player model and current match events. "+pressureNote,
      })
    }
  }
  const out:any[]=[]
  for(const market of LIVE_PROP_MARKETS){
    out.push(...candidates
      .filter(x=>x.market===market)
      .sort((a,b)=>Number(b.rankScore??b.probability)-Number(a.rankScore??a.probability)||b.probability-a.probability)
      .slice(0,5))
  }
  return out
}

function sameBet365Player(a:string,b:string){
  const clean=(v:string)=>normName(String(v??"").replace(/\s*\(\d+\)\s*$/,""))
  const x=clean(a),y=clean(b)
  if(!x||!y)return false
  if(x===y)return true
  const xt=x.split(" "),yt=y.split(" ")
  return xt.length>1&&yt.length>1&&xt[xt.length-1]===yt[yt.length-1]&&(x.includes(yt[0])||y.includes(xt[0]))
}
function livePropKind(market:string){
  return market==="card"?"card":market==="foul1"?"foul":market==="fouled1"?"fouled":
    market==="shot1"?"shot":market==="sot1"?"sot":market==="goal1"?"goal":"assist"
}
function propThreshold(prop:any){
  if(prop.market==="card"||prop.market==="goal1"||prop.market==="assist1")return 1
  return Math.max(1,Number(prop.currentCount??0)+1)
}
function oddsThreshold(label:string){
  const m=String(label??"").match(/(\d+)\s*\+/)
  return m?Number(m[1]):1
}
async function liveBet365ForFixture(f:Fixture){
  try{
    const q=new URLSearchParams({
      date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,live:"1",
    })
    const res=await betBuilderOddsGET(new Request("http://local/api/bet-builder-odds?"+q.toString()))
    return res.ok?await res.json():null
  }catch{return null}
}
function overlayBet365OnLiveProps(props:any[],odds:any){
  const selections=Array.isArray(odds?.selections)?odds.selections:[]
  if(!selections.length)return props
  const fresh=odds?.priceAvailable===true&&odds?.liveVerified===true
  return props.map(prop=>{
    const kind=livePropKind(prop.market)
    const threshold=propThreshold(prop)
    const match=selections.find((sel:any)=>{
      if(sel?.bookmaker!=="Bet365"||sel?.kind!==kind||!(Number(sel?.odd)>1))return false
      const player=String(sel?.label??"").split("·")[0]?.trim()??""
      return sameBet365Player(player,prop.player)&&oddsThreshold(String(sel?.label??""))===threshold
    })
    if(!match)return prop
    const price=Number(match.odd)
    const implied=Math.max(.001,Math.min(.99,1/price))
    const model=Math.max(.001,Math.min(.99,Number(prop.probability)))
    const weight=fresh?.22:.08
    const calibrated=Math.max(.001,Math.min(.99,model*(1-weight)+implied*weight))
    const rankScore=prop.market==="card"
      ?Math.max(.001,Math.min(.999,Number(prop.rankScore??model)+(implied-model)*(fresh?.10:.04)))
      :calibrated
    return {
      ...prop,
      probability:Math.round(calibrated*1000)/1000,
      rankScore:Math.round(rankScore*1000)/1000,
      bookmakerOdds:price,
      bookmakerName:"Bet365",
      bookmakerPriceState:fresh?"live":"reference",
    }
  }).sort((a,b)=>{
    if(a.market!==b.market)return 0
    return Number(b.probability)-Number(a.probability)
  })
}


let lastGoodRecommended:any=null
let lastGoodAt=0
let lastGoodMulti:any=null
let lastGoodMultiAt=0
const STALE_CACHE_MS=60*60*1000

// Tracking/calibration is useful background data, but it should not turn every
// Recommended page load into several Neon reads and writes.
const TRACKING_CACHE_MS=15*60*1000
const RECOMMENDATION_SAVE_MS=15*60*1000
let trackingCache:any={available:false,topPickLegs:0}
let trackingCacheAt=0
let lastGradeAt=0
let lastRecommendationSaveAt=0

async function maybeGradeRecommendations(){
  const now=Date.now()
  if(now-lastGradeAt<TRACKING_CACHE_MS)return
  lastGradeAt=now
  try{await Promise.all([gradeHistoricalRecommendations(250),gradePredictionLedger(750)])}catch{}
}
async function cachedTrackingSummary(){
  const now=Date.now()
  if(trackingCacheAt&&now-trackingCacheAt<TRACKING_CACHE_MS)return trackingCache
  try{
    trackingCache=await recommendationTrackingSummary(30)
    trackingCacheAt=now
  }catch{}
  return trackingCache
}

function beta(hits:number,total:number,prior:number,strength=6){
  return (hits+prior*strength)/(total+strength)
}
function calibrateSnapshot(market:"foul1"|"card",raw:number){
  const source=(calibrationSnapshot as any)?.global?.[market]
  const bands=source?.bands
  if(!Array.isArray(bands)||bands.length!==20)return raw
  const idx=Math.max(0,Math.min(19,Math.floor(Math.max(0,Math.min(.999999,raw))/.05)))
  const v=Number(bands[idx]?.calibratedProbability)
  return Number.isFinite(v)?v:raw
}
async function fallbackScorecard(f:Fixture):Promise<Scorecard|null>{
  try{
    return await buildSnapshotScorecard({
      date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,
    }) as Scorecard
  }catch{return null}
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const refresh=url.searchParams.get("refresh")==="1"
  const multiOnly=url.searchParams.get("mode")==="multi"
  if(!refresh&&multiOnly&&lastGoodMulti&&Date.now()-lastGoodMultiAt<30*1000){
    return NextResponse.json({...lastGoodMulti,staleFallback:false,servedFrom:"server-multi-cache"},{
      headers:{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=30"}
    })
  }
  if(!refresh&&!multiOnly&&lastGoodRecommended&&Date.now()-lastGoodAt<30*1000){
    return NextResponse.json({...lastGoodRecommended,staleFallback:false,servedFrom:"server-last-good"},{
      headers:{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=30"}
    })
  }
  const maxFixtures=Math.max(6,Math.min(24,Number(url.searchParams.get("limit")??18)||18))

  try{
    await maybeGradeRecommendations()
    const trackingBefore:any=await cachedTrackingSummary()
    const liveTopSample=Number(trackingBefore?.topPickLegs??0)
    const liveTopHit=Number(trackingBefore?.topPickHitRate??0)
    const liveTopModel=Number(trackingBefore?.topPickAvgProbability??0)
    const liveReliabilityFactor=liveTopSample>=50&&liveTopModel>0
      ? Math.max(.82,Math.min(1.05,liveTopHit/liveTopModel))
      : 1

    // Recommended is deliberately today-only. Matches/Accumulator can browse
    // future dates, but Picks must never silently switch the user to tomorrow.
    const resolvedDate=londonDate(0)
    const autoAdvanced=false
    const fixtureData=await fixturesFor(resolvedDate,refresh)
    const fixtureMap=new Map<string,Fixture>()
    if(fixtureData){
      for(const competition of competitions){
        for(const f of fixtureData.leagues?.[competition]??[])fixtureMap.set(String(f.id),f)
      }
    }

    if(multiOnly){
      const nowMs=Date.now()
      const allCandidates=[...fixtureMap.values()]
        .filter(f=>{
          const status=String(f.status??"").toLowerCase()
          const blocked=["postponed","cancelled","canceled","finished","ft","full time","after extra time","aet","abandoned","suspended"]
          const kickoffMs=new Date(f.kickoff).getTime()
          return Number.isFinite(kickoffMs)&&kickoffMs>nowMs-180*60*1000&&!blocked.includes(status)
        })
        .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
        .slice(0,maxFixtures)

      const liveFixtures=allCandidates.filter(f=>{
        const status=String(f.status??"").toLowerCase()
        const explicitLive=["live","halftime","in progress","1h","2h","et","extra time"].includes(status)
        const home=Number(f.score?.home),away=Number(f.score?.away)
        const hasScore=Number.isFinite(home)&&Number.isFinite(away)
        const kickoffMs=new Date(f.kickoff).getTime()
        const mins=Number.isFinite(kickoffMs)?Math.floor((Date.now()-kickoffMs)/60000):-1
        return explicitLive||(hasScore&&mins>=0&&mins<=180)
      })

      if(liveFixtures.length){
        const liveMatches=await Promise.all(liveFixtures.map(async f=>{
          try{
            const [liveStatData,bet365Live]=await Promise.all([
              livePlayerStatsForFixture(f),
              liveBet365ForFixture(f),
            ])
            const activeNames=[...liveStatData.players.values()].filter(liveStatActive).map(p=>p.player)
            let scorecard:Scorecard|null=null

            if(activeNames.length>=20){
              try{
                scorecard=await buildSnapshotScorecard({
                  date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition,
                  confirmedStarterNames:activeNames,
                }) as Scorecard
              }catch{}
            }
            if(!scorecard?.ok)scorecard=await fallbackScorecard(f)

            const kickoffMs=new Date(f.kickoff).getTime()
            const inferredElapsed=Number.isFinite(kickoffMs)?Math.max(0,Math.min(96,Math.floor((Date.now()-kickoffMs)/60000))):0
            const elapsed=Math.max(0,Math.min(96,Number(liveStatData.elapsed??f.elapsed??inferredElapsed)))
            const rawLivePlayerProps=buildLivePlayerProps(scorecard,elapsed,liveStatData.players,liveStatData.referee)
            const livePlayerProps=overlayBet365OnLiveProps(rawLivePlayerProps,bet365Live)
            const score=liveStatData.score??f.score??null
            return {
              id:String(f.id),competition:f.competition,kickoff:f.kickoff,status:liveStatData.status??f.status??"live",
              inPlay:true,elapsed,score,
              home:f.home.name,away:f.away.name,homeCrest:f.home.crest??null,awayCrest:f.away.crest??null,
              probabilities:null,winnerPick:null,bttsPick:null,
              bttsSettled:Boolean(Number(score?.home??0)>0&&Number(score?.away??0)>0),
              livePlayerProps,livePlayerStatsSource:liveStatData.source,referee:liveStatData.referee,
              reasons:["Live player intelligence uses the active roster, current event counts and the same remaining-match logic as Match Builder."],
            }
          }catch{
            return null
          }
        }))

        const payload={
          ok:true,date:resolvedDate,updatedAt:new Date().toISOString(),
          fixturesScanned:liveFixtures.length,
          liveMode:true,
          liveMatches:liveMatches.filter(Boolean),
          staleFallback:false,
          methodology:{
            multiMatch:"When any tracked game is in play, Multi switches to the same live player engine as Match Builder: active players only, including substitutes who come on, with current fouls committed, fouls drawn, shots, SOT, cards, goals and assists recalculating the remaining-match probabilities. When no games are live, Multi returns to the original Safe/Balanced/Risky pre-match builder.",
          },
        }
        lastGoodMulti=payload
        lastGoodMultiAt=Date.now()
        return NextResponse.json(payload,{headers:{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=45"}})
      }

      // No games are live: preserve the original pre-match Multi builder.
      const upcoming=allCandidates.filter(f=>new Date(f.kickoff).getTime()>nowMs)
      const coverage=await Promise.all(upcoming.map(async fixture=>{
        try{
          const q=new URLSearchParams({
            date:fixtureDate(fixture),home:fixture.home.name,away:fixture.away.name,competition:fixture.competition,
          })
          if(refresh)q.set("refresh",String(Date.now()))
          const response=await betBuilderOddsGET(new Request("http://local/api/bet-builder-odds?"+q.toString()))
          if(!response.ok)return null
          const odds=await response.json()
          return usablePlayerPropCoverage(odds?.marketAvailability)?fixture:null
        }catch{return null}
      }))

      const eligibleFixtures=coverage.filter(Boolean) as Fixture[]
      const scans:FixtureScan[]=await Promise.all(eligibleFixtures.map(async fixture=>{
        try{
          let scorecard=await scorecardFor(fixture,refresh)
          if(!scorecard?.ok)scorecard=await fallbackScorecard(fixture)
          if(!scorecard?.ok)return {fixture,scorecard:null,recommendations:[]}
          const minutesToKickoff=(new Date(fixture.kickoff).getTime()-Date.now())/60000
          const officialLineup=minutesToKickoff<=120?await officialLineupForFixture(fixture):{confirmed:false,starters:new Set<string>()}
          if(officialLineup.confirmed)scorecard=filterScorecardToOfficialStarters(scorecard,officialLineup)
          return {fixture,scorecard,recommendations:[]}
        }catch{return {fixture,scorecard:null,recommendations:[]}}
      }))

      const multiMatchBuild=buildMultiMatchFromScans(scans)
      const yellowCardWatch=buildYellowCardWatchFromScans(scans)
      const payload={
        ok:true,date:resolvedDate,updatedAt:new Date().toISOString(),
        fixturesScanned:upcoming.length,eligibleFixtures:eligibleFixtures.length,
        multiMatchBuild,yellowCardWatch,liveMatches:[],staleFallback:false,
        methodology:{
          multiMatch:"Pre-match Multi remains the original Safe/Balanced/Risky verified Bet365 player-prop builder. Once a tracked game goes live, the page automatically switches to live per-game player intelligence.",
        },
      }
      lastGoodMulti=payload
      lastGoodMultiAt=Date.now()
      return NextResponse.json(payload,{
        headers:refresh
          ?{"Cache-Control":"public, s-maxage=30, stale-while-revalidate=300"}
          :{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=1800"},
      })
    }

    const liveFixtures=[...fixtureMap.values()]
      .filter(f=>{
        const status=String(f.status??"").toLowerCase()
        const explicitLive=["live","halftime","in progress","1h","2h","et","extra time"].includes(status)
        const explicitFinished=["finished","ft","full time","after extra time","aet"].includes(status)
        const cancelled=["postponed","cancelled","canceled","abandoned","suspended"].includes(status)
        const home=Number(f.score?.home),away=Number(f.score?.away)
        const hasScore=Number.isFinite(home)&&Number.isFinite(away)
        const kickoffMs=new Date(f.kickoff).getTime()
        const mins=Number.isFinite(kickoffMs)?Math.floor((Date.now()-kickoffMs)/60000):-1
        const inferredLive=hasScore&&!explicitFinished&&!cancelled&&mins>=0&&mins<=180
        return explicitLive||inferredLive
      })
      .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))

    let liveMatches:any[]=[]
    try{
      const liveResponse=await matchAccaGET(new Request("http://local/api/match-acca?date="+resolvedDate+(refresh?"&refresh="+Date.now():"")))
      const liveData=liveResponse.ok?await liveResponse.json():null
      const livePredictions=(liveData?.predictions??[]).filter((p:any)=>p?.inPlay)
      const byId=new Map<string,any>(livePredictions.map((p:any)=>[String(p.id),p]))
      const byTeams=new Map<string,any>(livePredictions.map((p:any)=>[normName(String(p.home??""))+"|"+normName(String(p.away??"")),p]))
      liveMatches=await Promise.all(liveFixtures.map(async f=>{
        const model=byId.get(String(f.id))??byTeams.get(normName(f.home.name)+"|"+normName(f.away.name))
        const elapsed=Math.max(0,Math.min(96,Number(model?.elapsed??f.elapsed??0)))
        const [liveStatData,primaryScorecard]=await Promise.all([livePlayerStatsForFixture(f),scorecardFor(f,refresh)])
        let scorecard=primaryScorecard
        if(!scorecard?.ok)scorecard=await fallbackScorecard(f)
        const livePlayerProps=buildLivePlayerProps(scorecard,elapsed,liveStatData.players,liveStatData.referee)
        if(model)return {...model,homeCrest:f.home.crest??model.homeCrest??null,awayCrest:f.away.crest??model.awayCrest??null,livePlayerProps,livePlayerStatsSource:liveStatData.source}
        const home=Number(f.score?.home),away=Number(f.score?.away)
        const hasScore=Number.isFinite(home)&&Number.isFinite(away)
        const bttsSettled=Boolean(hasScore&&home>0&&away>0)
        return {
          id:String(f.id),competition:f.competition,kickoff:f.kickoff,status:f.status??"live",
          inPlay:true,elapsed:f.elapsed??null,score:hasScore?{home,away}:null,
          home:f.home.name,away:f.away.name,homeCrest:f.home.crest??null,awayCrest:f.away.crest??null,probabilities:null,winnerPick:null,bttsPick:null,bttsSettled,
          livePlayerProps,livePlayerStatsSource:liveStatData.source,
          reasons:["Live score available. The live win-probability model is not currently available for this competition."],
        }
      }))
    }catch{
      liveMatches=await Promise.all(liveFixtures.map(async f=>{
        const [liveStatData,primaryScorecard]=await Promise.all([livePlayerStatsForFixture(f),scorecardFor(f,refresh)])
        let scorecard=primaryScorecard
        if(!scorecard?.ok)scorecard=await fallbackScorecard(f)
        const elapsed=Math.max(0,Math.min(96,Number(f.elapsed??0)))
        return {
          id:String(f.id),competition:f.competition,kickoff:f.kickoff,status:f.status??"live",
          inPlay:true,elapsed:f.elapsed??null,
          score:f.score??null,home:f.home.name,away:f.away.name,homeCrest:f.home.crest??null,awayCrest:f.away.crest??null,
          probabilities:null,winnerPick:null,bttsPick:null,
          bttsSettled:Boolean((f.score?.home??0)>0&&(f.score?.away??0)>0),
          livePlayerProps:buildLivePlayerProps(scorecard,elapsed,liveStatData.players,liveStatData.referee),
          livePlayerStatsSource:liveStatData.source,
          reasons:["Live score available while the live probability refresh is temporarily unavailable."],
        }
      }))
    }

    const upcoming=[...fixtureMap.values()]
      .filter(f=>{
        const status=String(f.status??"").toLowerCase()
        const blocked=["postponed","cancelled","canceled","finished","halftime","in progress","live"]
        return new Date(f.kickoff).getTime()>Date.now()&&!blocked.includes(status)
      })
      .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
      .slice(0,maxFixtures)

    const scans:FixtureScan[]=await Promise.all(upcoming.map(async fixture=>{
      try{
        let scorecard=await scorecardFor(fixture,refresh)
        if(!scorecard?.ok)scorecard=await fallbackScorecard(fixture)
        if(!scorecard?.ok)return {fixture,scorecard:null,recommendations:[]}
        const minutesToKickoff=(new Date(fixture.kickoff).getTime()-Date.now())/60000
        const officialLineup=minutesToKickoff<=120?await officialLineupForFixture(fixture):{confirmed:false,starters:new Set<string>()}
        if(officialLineup.confirmed)scorecard=filterScorecardToOfficialStarters(scorecard,officialLineup)
        const confirmed=officialLineup.confirmed||Boolean(scorecard.lineupsConfirmed)
        const predicted=!confirmed&&scorecard.lineupMode==="predicted"
        if(!confirmed&&!predicted)return {fixture,scorecard,recommendations:[]}
        const builderSlips:BetSlip[]=(scorecard.riskBuilders??[])
          .filter(b=>b.legs?.length)
          .map(b=>({
            id:b.id,title:b.title,risk:b.risk,legs:b.legs,
            averageLegProbability:b.averageLegProbability,
            placeable:false,
            marketAvailability:b.legs.map(leg=>({player:leg.player,market:leg.market,status:"unknown" as MarketStatus})),
          }))
        // Use the target builders as the primary Picks recommendation source because
        // they compare market families per player. Fall back to legacy slips only
        // when a scorecard cannot build a target combination.
        const rawStandards=builderSlips
        const rawFouls=scorecard.foulTargetSlips??[]
        const standards=officialLineup.confirmed?rawStandards.map(s=>filterSlipToOfficialStarters(s,officialLineup)).filter(Boolean) as BetSlip[]:rawStandards
        const fouls=officialLineup.confirmed?rawFouls.map(s=>filterSlipToOfficialStarters(s,officialLineup)).filter(Boolean) as FoulTargetSlip[]:rawFouls
        const candidates:Recommendation[]=[]

        for(const slip of standards){
          if(!slip.legs?.length)continue
          const verified=(scorecard.eligibleBooks?.length??0)>0
          const blocked=verified
            ? blockedReason(scorecard,slip,"standard")
            : "Bookmaker player markets are not verified yet — model-only recommendation"
          const placeable=verified&&Boolean(slip.placeable)&&!blocked
          const displaySlip=verified?slip:{...slip,bookmaker:null}
          candidates.push({
            id:fixture.id+"|"+slip.id,fixture,slip:displaySlip,confirmed,kind:"standard",
            rank:rankSlip(displaySlip,confirmed,placeable,liveReliabilityFactor),placeable,blockedReason:blocked,
            recommendationReliability:recommendationReliability(avgProbability(displaySlip),liveReliabilityFactor),
            fullPlayerMarkets:fullPlayerMarketSet(scorecard.marketAvailability),
            playerMarketAvailability:scorecard.marketAvailability as Record<string,MarketStatus>,
          })
        }

        const preferredFoul=fouls
          .filter(s=>s.legs?.length)
          .sort((a,b)=>rankSlip(b,confirmed,Boolean(b.placeable),liveReliabilityFactor)-rankSlip(a,confirmed,Boolean(a.placeable),liveReliabilityFactor))[0]
        if(preferredFoul?.legs?.length){
          const verified=(scorecard.eligibleBooks?.length??0)>0
          const blocked=verified
            ? blockedReason(scorecard,preferredFoul,"foul")
            : "Bookmaker foul market is not verified yet — model-only recommendation"
          const placeable=verified&&Boolean(preferredFoul.placeable)&&!blocked
          const displayFoul=verified?preferredFoul:{...preferredFoul,bookmaker:null}
          candidates.push({
            id:fixture.id+"|"+preferredFoul.id,fixture,slip:displayFoul,confirmed,kind:"foul",
            rank:rankSlip(displayFoul,confirmed,placeable,liveReliabilityFactor),placeable,blockedReason:blocked,
            recommendationReliability:recommendationReliability(avgProbability(displayFoul),liveReliabilityFactor),
            fullPlayerMarkets:fullPlayerMarketSet(scorecard.marketAvailability),
            playerMarketAvailability:scorecard.marketAvailability as Record<string,MarketStatus>,
          })
        }
        return {fixture,scorecard,recommendations:candidates}
      }catch{return {fixture,scorecard:null,recommendations:[]}}
    }))

    const allRecommendations=scans.flatMap(x=>x.recommendations).sort((a,b)=>b.rank-a.rank)
    const recommendations=selectDiversifiedRecommendations(allRecommendations,8)
    const targetOddsGames=buildTargetOddsGames(scans,upcoming)
    const multiMatchBuild=buildMultiMatchFromScans(scans)
    const yellowCardWatch=buildYellowCardWatchFromScans(scans)
    const nowForSave=Date.now()
    if(nowForSave-lastRecommendationSaveAt>=RECOMMENDATION_SAVE_MS){
      lastRecommendationSaveAt=nowForSave
      try{await saveRecommendationSnapshots(recommendations.map((rec,index)=>({
        fixture:rec.fixture,
        slip:{
          id:rec.slip.id,
          title:rec.kind==="foul"?"Foul builder "+(rec.slip as FoulTargetSlip).targetFractional:(rec.slip as BetSlip).title,
          bookmaker:rec.slip.bookmaker??null,
          legs:rec.slip.legs,
        },
        rank:rec.rank,
        position:index+1,
        confirmed:rec.confirmed,
        placeable:rec.placeable,
      })))}catch{}
    }
    const tracking:any=trackingBefore

    const payload={
      ok:true,
      updatedAt:new Date().toISOString(),
      date:resolvedDate,
      autoAdvanced,
      fixturesScanned:upcoming.length+liveFixtures.length,
      recommendations,
      liveMatches,
      targetOddsGames,
      multiMatchBuild,
      yellowCardWatch,
      tracking,
      staleFallback:false,
      methodology:{
        recommendationCalibration:"Final ranking uses a second walk-forward calibration layer built from historical recommendations that survived the selection process.",
        cache:"Recommended scans today's matchday only. It never silently advances to tomorrow. Manual refresh bypasses the normal scan cadence, while provider and last-good caches protect against temporary source failures.",
        tracking:"Predicted-XI recommendations remain visible before official teams. As soon as confirmed lineups arrive, the scorecard is rebuilt and benched players disappear. Recommendations are saved before kickoff and graded later from imported player-match data.",
        targetOdds:"Select a match, then 3/1 through 50/1 targets search every verified Bet365 player prop for eligible starters: goals, assists, cards, fouls committed, fouls drawn, shots and shots on target. Match/team markets such as match winner, double chance, BTTS, total goals and corners are excluded. The target price is a constraint, not the objective: the chosen route maximises conservative whole-slip hit probability and applies a stability preference to repeated 1+ events so they beat scorer/card legs whenever they are genuinely safer.",
        multiMatch:"The Multi-Match Builder uses the same probability-first engine as individual Target Odds. Safe (~3/1), Balanced (~5/1) and Risky (~10/1) search all verified Bet365 player props — goals, assists, cards, fouls committed, fouls drawn, shots and SOT — while excluding match/team markets such as BTTS, corners, total goals and match winner. Repeated high-frequency events receive a stability preference, and scorer/assist/card exposure is capped by tier. Confirmed starters are a hard eligibility gate.",
        liveRecommended:"Matches remain on Recommended after kick-off. Live rows use the current score and minute plus current player event counts. Confirmed-XI card, foul, fouled, shot and SOT models become next-threshold remaining-match probabilities; already-carded players are removed from the card market, and stale pre-match bookmaker prices are never relabelled as live prices.",
        liveFeedback:liveTopSample>=50
          ? "Live top-pick calibration is active. Current 30-day reliability multiplier: "+liveReliabilityFactor.toFixed(3)
          : "Live top-pick calibration activates after 50 graded top-pick legs.",
      },
    }
    lastGoodRecommended=payload
    lastGoodAt=Date.now()
    return NextResponse.json(payload,{
      headers:refresh
        ?{"Cache-Control":"public, s-maxage=15, stale-while-revalidate=120"}
        :{"Cache-Control":"public, s-maxage=120, stale-while-revalidate=600"},
    })
  }catch(error){
    if(lastGoodRecommended&&Date.now()-lastGoodAt<STALE_CACHE_MS){
      return NextResponse.json({...lastGoodRecommended,staleFallback:true,warning:"Fresh pull failed; showing the last successful Recommended snapshot."},{headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=1800"}})
    }
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Recommended scan failed"},{status:500})
  }
}
