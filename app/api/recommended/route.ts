import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { GET as matchAccaGET } from "../match-acca/route"
import { GET as livePlayerStatsGET } from "../live-player-stats/route"
import { GET as betBuilderOddsGET } from "../bet-builder-odds/route"
import { gradeHistoricalRecommendations, recommendationTrackingSummary, saveRecommendationSnapshots } from "@/lib/recommendation-tracking"
import recommendationBacktest from "@/data/model/recommendation-backtest.json"
import calibrationSnapshot from "@/data/model/calibration.json"
import { snapshotPlayersForFixture, internationalPlayersForFixture } from "@/lib/current-season-snapshot"
import { buildSnapshotScorecard } from "@/lib/snapshot-scorecard"

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
  recent5HitRate?:number|null;seasonHitRate?:number|null;h2hHitRate?:number|null;h2hMatches?:number;
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
  sampleMatches?:number;recent5HitRate?:number;seasonHitRate?:number;h2hHitRate?:number|null;h2hMatches?:number;recommendationScore?:number;
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
  }>
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

const ESPN_INTL_SLUGS=["uefa.euro","uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf"]
const ESPN_LEAGUE_SLUGS:Partial<Record<Competition,string>>={
  "Premier League":"eng.1",Championship:"eng.2","League One":"eng.3","League Two":"eng.4",
}
type OfficialLineup={confirmed:boolean;starters:Set<string>}
function normName(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
}
function sameTeamName(a:string,b:string){
  const x=normName(a).replace(/\b(afc|fc)\b/g,"").trim(),y=normName(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
async function officialLineupForFixture(f:Fixture):Promise<OfficialLineup>{
  const slugs=f.competition==="International"?ESPN_INTL_SLUGS:[ESPN_LEAGUE_SLUGS[f.competition]].filter(Boolean) as string[]
  const date=fixtureDate(f).replaceAll("-","")
  for(const slug of slugs){
    try{
      const scoreboard=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+date+"&limit=300",{next:{revalidate:30},signal:AbortSignal.timeout(4500)})
      if(!scoreboard.ok)continue
      const data=await scoreboard.json()
      const event=(data?.events??[]).find((e:any)=>{
        const comps=e?.competitions?.[0]?.competitors??[]
        const h=comps.find((x:any)=>x.homeAway==="home")
        const a=comps.find((x:any)=>x.homeAway==="away")
        return sameTeamName(String(h?.team?.displayName??""),f.home.name)&&sameTeamName(String(a?.team?.displayName??""),f.away.name)
      })
      if(!event?.id)continue
      const summaryRes=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/summary?event="+event.id,{next:{revalidate:30},signal:AbortSignal.timeout(4500)})
      if(!summaryRes.ok)continue
      const summary=await summaryRes.json()
      const starters=new Set<string>()
      let homeCount=0,awayCount=0
      for(const section of summary?.rosters??[]){
        for(const row of section?.roster??[]){
          if(row?.starter!==true)continue
          const name=String(row?.athlete?.displayName??row?.athlete?.fullName??"")
          if(!name)continue
          starters.add(normName(name))
          if(section.homeAway==="home")homeCount++
          else if(section.homeAway==="away")awayCount++
        }
      }
      return {confirmed:homeCount>=11&&awayCount>=11,starters}
    }catch{}
  }
  return {confirmed:false,starters:new Set()}
}

type LivePlayerStat={
  player:string;team:string;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  yellowCards:number;redCards:number;tackles:number;interceptions:number;blocks:number;duelsTotal:number;duelsWon:number;defensiveInterventions:number
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
    if(!response.ok)return {source:null,players:new Map<string,LivePlayerStat>()}
    const data=await response.json()
    const rows:Array<any>=Array.isArray(data?.players)?data.players:[]
    return {
      source:data?.source??null,
      players:new Map<string,LivePlayerStat>(rows.map((row:any)=>[normName(String(row.player??"")),{
        player:String(row.player??""),team:String(row.team??""),
        foulsCommitted:Number(row.foulsCommitted??0),foulsDrawn:Number(row.foulsDrawn??0),
        shots:Number(row.shots??0),shotsOnTarget:Number(row.shotsOnTarget??0),
        yellowCards:Number(row.yellowCards??0),redCards:Number(row.redCards??0),
        tackles:Number(row.tackles??0),interceptions:Number(row.interceptions??0),blocks:Number(row.blocks??0),
        duelsTotal:Number(row.duelsTotal??0),duelsWon:Number(row.duelsWon??0),defensiveInterventions:Number(row.defensiveInterventions??0),
      }]))
    }
  }catch{
    return {source:null,players:new Map<string,LivePlayerStat>()}
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
          conservativeProb:state.conservativeProb*option.conservativeP,
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
  bookmakerOdds:number;bookmaker:"Bet365";confidence:SlipLeg["confidence"]
}
type MultiMatchRiskTier="safe"|"balanced"|"risky"
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
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const baseMarket=(market:string)=>market==="foul1"||market==="fouled1"||market==="shot1"||market==="sot1"
  const confidenceReliability=(leg:SlipLeg)=>leg.confidence==="A"?1:leg.confidence==="B"?.99:leg.confidence==="C"?.965:.90
  const marketReliability=(leg:SlipLeg)=>{
    const f=family(leg.market)
    if(f==="foul")return .998
    if(f==="fouled")return .997
    if(f==="shot")return .995
    if(f==="sot")return .975
    if(f==="card")return .90
    if(f==="goal")return .90
    if(f==="assist")return .86
    return .95
  }
  const safetyLegProbability=(leg:SlipLeg)=>{
    const model=Math.max(.01,Math.min(.99,Number(leg.probability)))
    const price=Number(leg.bookmakerOdds??0)
    const book=Math.max(.01,Math.min(.99,Number(leg.bookmakerProbability??(price>1?1/price:model))))
    const uplift=leg.confidence==="A"?1.18:leg.confidence==="B"?1.12:leg.confidence==="C"?1.07:1
    return Math.max(.01,Math.min(.99,Math.min(model,book*uplift)*evidenceReliability(leg)))
  }
  const conservativeJoint=(legs:SlipLeg[])=>{
    const counts:Record<string,number>={}
    let conservative=1
    for(const leg of legs){
      const f=family(leg.market)
      counts[f]=(counts[f]??0)+1
      conservative*=safetyLegProbability(leg)*confidenceReliability(leg)*marketReliability(leg)
    }
    let concentration=1
    for(const [f,count] of Object.entries(counts)){
      if(count<=1)continue
      concentration*=Math.pow(f==="foul"||f==="fouled"?.997:f==="shot"?.995:.985,count-1)
    }
    return Math.max(0,Math.min(.99,conservative*concentration))
  }

  const tierConfigs:Array<{
    id:MultiMatchRiskTier;title:string;description:string;targetFractional:string;targetDecimal:number;
    minLeg:number;maxFactor:number;allowHighVariance:boolean;forceBestCard:boolean;maxHighVariance:number
  }>=[
    {
      id:"safe",title:"Safe",targetFractional:"3/1",targetDecimal:4,minLeg:.32,maxFactor:1.45,
      allowHighVariance:true,forceBestCard:false,maxHighVariance:1,
      description:"All verified player props are eligible. The route is still probability-first, so repeated 1+ fouls/fouled/shots/SOT are preferred and at most one higher-variance scorer, assist or card can enter only when it materially improves the whole-slip chance.",
    },
    {
      id:"balanced",title:"Balanced",targetFractional:"5/1",targetDecimal:6,minLeg:.25,maxFactor:1.42,
      allowHighVariance:true,forceBestCard:false,maxHighVariance:2,
      description:"All verified player props are eligible, but the engine still favours the safest combination. Scorers, assists and cards are only used when they beat safer repeated-event alternatives on the conservative safety score.",
    },
    {
      id:"risky",title:"Risky",targetFractional:"10/1",targetDecimal:11,minLeg:.15,maxFactor:1.38,
      allowHighVariance:true,forceBestCard:false,maxHighVariance:3,
      description:"All verified player props are eligible. Higher target odds allow more scorer/assist/card exposure, but only where the evidence-adjusted route is safer than simply stacking weaker low-frequency selections.",
    },
  ]

  function buildTierForMatch(scan:FixtureScan,config:(typeof tierConfigs)[number]):MultiMatchGameBuilder|null{
    const scorecard=scan.scorecard
    if(!scorecard)return null
    let candidates=directPlayerCandidates(scorecard)
      .filter(leg=>leg.bookmakerName==="Bet365"&&leg.bookmakerOdds!=null&&Number(leg.bookmakerOdds)>1)
      .filter(leg=>safetyLegProbability(leg)>=config.minLeg)
      .sort((a,b)=>(safetyLegProbability(b)*marketStabilityFactor(b))-(safetyLegProbability(a)*marketStabilityFactor(a))||safetyLegProbability(b)-safetyLegProbability(a)||b.probability-a.probability||Number(a.bookmakerOdds)-Number(b.bookmakerOdds))
      .slice(0,120)

    if(!config.allowHighVariance){
      candidates=candidates.filter(leg=>{
        const f=family(leg.market)
        return f==="foul"||f==="fouled"||f==="shot"||f==="sot"
      })
    }

    const homeKey=normName(scan.fixture.home.name)
    const awayKey=normName(scan.fixture.away.name)
    const bothTeamsAvailable=candidates.some(leg=>normName(leg.team)===homeKey)&&candidates.some(leg=>normName(leg.team)===awayKey)
    if(!bothTeamsAvailable)return null

    const bestCard=config.forceBestCard
      ?candidates.filter(leg=>family(leg.market)==="card")
        .sort((a,b)=>safetyLegProbability(b)-safetyLegProbability(a)||b.probability-a.probability||Number(a.bookmakerOdds)-Number(b.bookmakerOdds))[0]??null
      :null

    type State={
      legs:SlipLeg[];product:number;raw:number;conservative:number;
      families:Record<string,number>;teamCounts:Record<string,number>;players:Set<string>;highVarianceCount:number
    }
    const initialLegs=bestCard?[bestCard]:[]
    const initialTeams:Record<string,number>={}
    const initialFamilies:Record<string,number>={}
    const initialPlayers=new Set<string>()
    let initialProduct=1,initialRaw=1
    if(bestCard){
      const tk=normName(bestCard.team),pk=normName(bestCard.player)
      initialTeams[tk]=1;initialFamilies.card=1;initialPlayers.add(pk)
      initialProduct=Number(bestCard.bookmakerOdds);initialRaw=bestCard.probability
    }
    let states:State[]=[{
      legs:initialLegs,product:initialProduct,raw:initialRaw,
      conservative:initialLegs.length?conservativeJoint(initialLegs):1,
      families:initialFamilies,teamCounts:initialTeams,players:initialPlayers,highVarianceCount:bestCard?1:0,
    }]

    const pool=candidates.filter(leg=>!bestCard||normName(leg.player)!==normName(bestCard.player))
    const orderedPool=[
      ...pool.filter(leg=>baseMarket(leg.market)),
      ...pool.filter(leg=>!baseMarket(leg.market)),
    ]
    const maxProduct=config.targetDecimal*config.maxFactor

    for(const option of orderedPool){
      const next=[...states]
      for(const state of states){
        if(state.legs.length>=12)continue
        const playerKey=normName(option.player)
        if(state.players.has(playerKey))continue
        const teamKey=normName(option.team)
        if((state.teamCounts[teamKey]??0)>=6)continue
        const fam=family(option.market)
        const isHigh=fam==="goal"||fam==="assist"||fam==="card"
        if(fam==="card"&&(state.families.card??0)>=1)continue
        if(isHigh&&state.highVarianceCount>=config.maxHighVariance)continue
        const product=state.product*Number(option.bookmakerOdds)
        if(product>maxProduct)continue
        const legs=[...state.legs,option]
        const families={...state.families,[fam]:(state.families[fam]??0)+1}
        const teamCounts={...state.teamCounts,[teamKey]:(state.teamCounts[teamKey]??0)+1}
        next.push({
          legs,product,raw:state.raw*option.probability,conservative:conservativeJoint(legs),
          families,teamCounts,players:new Set([...state.players,playerKey]),
          highVarianceCount:state.highVarianceCount+(isHigh?1:0),
        })
      }

      const buckets=new Map<string,State[]>()
      for(const state of next){
        const oddsBucket=Math.floor(Math.log(Math.max(1,state.product))*120)
        const key=oddsBucket+"|"+state.legs.length+"|"+(state.teamCounts[homeKey]??0)+"|"+(state.teamCounts[awayKey]??0)+"|"+state.highVarianceCount
        const rows=buckets.get(key)??[]
        rows.push(state)
        rows.sort((a,b)=>{
          const routeA=routeSelectionSafety(a.legs,a.conservative)
          const routeB=routeSelectionSafety(b.legs,b.conservative)
          if(Math.abs(routeA-routeB)>.000001)return routeB-routeA
          if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
          const weakA=a.legs.length?Math.min(...a.legs.map(safetyLegProbability)):0
          const weakB=b.legs.length?Math.min(...b.legs.map(safetyLegProbability)):0
          if(Math.abs(weakA-weakB)>.0001)return weakB-weakA
          return b.raw-a.raw
        })
        buckets.set(key,rows.slice(0,10))
      }
      states=[...buckets.values()].flat()
        .sort((a,b)=>routeSelectionSafety(b.legs,b.conservative)-routeSelectionSafety(a.legs,a.conservative)||b.conservative-a.conservative||b.raw-a.raw)
        .slice(0,5000)
    }

    const valid=states.filter(state=>
      state.legs.length>=2&&
      state.product>=config.targetDecimal&&
      state.product<=maxProduct&&
      (state.teamCounts[homeKey]??0)>0&&
      (state.teamCounts[awayKey]??0)>0&&
      (!config.forceBestCard||!bestCard||(state.families.card??0)===1)
    )
    if(!valid.length)return null

    const best=valid.sort((a,b)=>{
      const routeA=routeSelectionSafety(a.legs,a.conservative)
      const routeB=routeSelectionSafety(b.legs,b.conservative)
      if(Math.abs(routeA-routeB)>.000001)return routeB-routeA
      if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
      const weakA=Math.min(...a.legs.map(safetyLegProbability))
      const weakB=Math.min(...b.legs.map(safetyLegProbability))
      if(Math.abs(weakA-weakB)>.0001)return weakB-weakA
      if(Math.abs(a.raw-b.raw)>.000001)return b.raw-a.raw
      return Math.abs(a.product-config.targetDecimal)-Math.abs(b.product-config.targetDecimal)
    })[0]

    const legs:MultiMatchLeg[]=best.legs.map(leg=>({
      fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
      home:scan.fixture.home.name,away:scan.fixture.away.name,
      player:leg.player,team:leg.team,market:leg.market,label:leg.label,
      probability:leg.probability,bookmakerOdds:Number(leg.bookmakerOdds),bookmaker:"Bet365",confidence:leg.confidence,
    }))
    const cardLeg=best.legs.find(leg=>family(leg.market)==="card")??null
    return {
      fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
      home:scan.fixture.home.name,away:scan.fixture.away.name,homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,
      riskTier:config.id,targetFractional:config.targetFractional,targetDecimal:config.targetDecimal,
      referenceOdds:Math.round(best.product*100)/100,
      modelAllHitProbability:Math.round(best.raw*10000)/10000,
      conservativeAllHitProbability:Math.round(best.conservative*10000)/10000,
      includesCard:Boolean(cardLeg),cardPick:cardLeg?cardLeg.player:null,lineupsConfirmed:Boolean(scan.scorecard?.lineupsConfirmed),
      preMatchSnapshot:new Date(scan.fixture.kickoff).getTime()<=Date.now(),legs,
    }
  }

  const tiers:MultiMatchTier[]=tierConfigs.map(config=>{
    const built=eligible.map(scan=>buildTierForMatch(scan,config)).filter(Boolean) as MultiMatchGameBuilder[]
    built.sort((a,b)=>b.conservativeAllHitProbability-a.conservativeAllHitProbability||b.modelAllHitProbability-a.modelAllHitProbability||a.referenceOdds-b.referenceOdds)
    const matchBuilders=built.slice(0,10)
    const legs=matchBuilders.flatMap(x=>x.legs)
    const combined=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.referenceOdds,1):null
    const allHit=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.conservativeAllHitProbability,1):null
    const cardCount=matchBuilders.reduce((sum,b)=>sum+(b.includesCard?1:0),0)
    const note=config.id==="safe"
      ?"Safe considers all verified player props, but heavily prefers repeated high-frequency events and permits no more than one scorer/assist/card leg per match."
      :config.id==="balanced"
        ?"Balanced considers all verified player props and still prefers extra high-probability 1+ legs whenever their conservative joint chance beats a lower-frequency alternative."
        :"Risky considers all verified player props. Higher target odds can use more scorer/assist/card legs, but only when the evidence-adjusted route ranks better than the available foul/shot alternatives."
    return {
      id:config.id,title:config.title,description:config.description,targetFractionalPerMatch:config.targetFractional,targetDecimalPerMatch:config.targetDecimal,
      available:matchBuilders.length>=2,matchBuilders,legs,
      combinedBet365Odds:combined==null?null:Math.round(combined*100)/100,
      conservativeAllHitProbability:allHit==null?null:Math.round(allHit*10000)/10000,
      note,
    }
  })

  const safe=tiers.find(t=>t.id==="safe")!
  return {
    available:safe.available,
    targetFractionalPerMatch:safe.targetFractionalPerMatch,
    maxMatches:10,
    eligibleFixtureCount:eligible.length,
    matchBuilders:safe.matchBuilders,
    legs:safe.legs,
    combinedBet365Odds:safe.combinedBet365Odds,
    modelAllHitProbability:safe.conservativeAllHitProbability,
    conservativeAllHitProbability:safe.conservativeAllHitProbability,
    tiers,
    defaultTier:"safe",
    note:"Multi-Match has three probability-led target levels: Safe (~3/1), Balanced (~5/1) and Risky (~10/1) per match. All verified Bet365 player props are eligible — goals, assists, cards, fouls, fouls drawn, shots and SOT — while match/team markets such as corners, BTTS, total goals, match winner and double chance are excluded. The engine prefers higher-frequency repeated events when they offer the better whole-slip chance. Once official lineups are confirmed, only those starters are eligible.",
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

const LIVE_PROP_MARKETS=["card","foul1","fouled1","shot1","sot1"] as const
function remainingEventProbability(fullMatchProbability:number,elapsed:number){
  const p=Math.max(.001,Math.min(.995,Number(fullMatchProbability)||0))
  const remaining=Math.max(.03,Math.min(1,(96-Math.max(0,Math.min(96,elapsed)))/96))
  const lambda=-Math.log(1-p)
  return Math.max(.001,Math.min(.99,1-Math.exp(-lambda*remaining)))
}
function buildLivePlayerProps(scorecard:Scorecard|null,elapsed:number,liveStats:Map<string,LivePlayerStat>){
  if(!scorecard?.ok||!scorecard.lineupsConfirmed)return []
  const candidates:any[]=[]
  const seen=new Set<string>()
  for(const slip of scorecard.slips??[]){
    for(const leg of slip.legs??[]){
      const market=String(leg.market)
      if(!(LIVE_PROP_MARKETS as readonly string[]).includes(market)||leg.confidence==="D")continue
      const key=normName(leg.player)+"|"+market
      if(seen.has(key))continue
      seen.add(key)
      const stat=liveStats.get(normName(leg.player))
      if(market==="card"){
        const player=(scorecard.players??[]).find(p=>normName(p.name)===normName(leg.player)||normName(String(p.dbName??""))===normName(leg.player))
        const cardMarket=player?.markets?.card
        if(!player||!cardMarket||!cardEvidenceEligible(player,cardMarket))continue
        if(stat&&(stat.yellowCards>0||stat.redCards>0))continue
      }

      let currentCount=0
      let nextLabel=leg.label
      if(stat){
        if(market==="foul1"){currentCount=stat.foulsCommitted;nextLabel=String(currentCount+1)+"+ fouls committed"}
        else if(market==="fouled1"){currentCount=stat.foulsDrawn;nextLabel=String(currentCount+1)+"+ fouls drawn"}
        else if(market==="shot1"){currentCount=stat.shots;nextLabel=String(currentCount+1)+"+ shots"}
        else if(market==="sot1"){currentCount=stat.shotsOnTarget;nextLabel=String(currentCount+1)+"+ shots on target"}
      }

      let probability=remainingEventProbability(Number(leg.probability??0),elapsed)
      let pressureNote=""
      const workload=stat?Math.max(0,Math.min(.48,
        Number(stat.tackles??0)*.07+Number(stat.interceptions??0)*.045+Number(stat.blocks??0)*.025+
        Number(stat.duelsTotal??0)*.009+Number(stat.duelsWon??0)*.006+Number(stat.defensiveInterventions??0)*.025
      )):0
      const logit=(p:number)=>Math.log(Math.max(.001,Math.min(.999,p))/(1-Math.max(.001,Math.min(.999,p))))
      const logistic=(x:number)=>1/(1+Math.exp(-x))
      if(market==="card"&&stat&&stat.foulsCommitted>0){
        const player=(scorecard.players??[]).find(p=>normName(p.name)===normName(leg.player)||normName(String(p.dbName??""))===normName(leg.player))
        const fouls=Math.max(0,Number(stat.foulsCommitted??0))
        const cond=fouls>=3?player?.yellowConditionals?.after3PlusFouls
          :fouls>=2?player?.yellowConditionals?.after2PlusFouls
          :player?.yellowConditionals?.after1PlusFouls
        const overall=player?.yellowConditionals?.overall
        let delta=Math.min(.65,.14*fouls)
        if(cond?.rate!=null&&Number(overall?.rate)>0&&Number(cond.matches??0)>=2){
          const reliability=Math.min(1,Number(cond.matches??0)/10)
          const observed=logit(Number(cond.rate))-logit(Math.max(.02,Number(overall!.rate)))
          delta=Math.max(-.10,Math.min(.90,observed*.72*reliability+.10*fouls))
          pressureNote=` Live: ${fouls} foul${fouls===1?"":"s"} committed; historical booking rate after this foul load ${Math.round(Number(cond.rate)*100)}% (${cond.matches} matches).`
        }else{
          pressureNote=` Live: ${fouls} foul${fouls===1?"":"s"} committed; foul-pressure uplift applied.`
        }
        probability=logistic(logit(probability)+delta)
        const refYellows=Number(scorecard?.referee?.yellowsPerGame??0)
        if(refYellows>0){
          probability=logistic(logit(probability)+Math.max(-.18,Math.min(.22,(refYellows-4.2)*.055)))
          pressureNote+=` Referee context ${refYellows.toFixed(1)} yellows/game.`
        }
        if(workload>0){
          probability=logistic(logit(probability)+Math.min(.30,workload*.55))
          pressureNote+=` Defensive workload: ${Number(stat.tackles??0)} tackles, ${Number(stat.interceptions??0)} interceptions, ${Number(stat.duelsTotal??0)} duels.`
        }
        probability=Math.max(.001,Math.min(.95,probability))
      }else if(market==="foul1"&&stat&&workload>0){
        probability=logistic(logit(probability)+workload)
        pressureNote=` Defensive workload: ${Number(stat.tackles??0)} tackles, ${Number(stat.interceptions??0)} interceptions, ${Number(stat.blocks??0)} blocks, ${Number(stat.duelsTotal??0)} duels; future foul probability increased.`
      }

      const marketGroup=market==="card"?"card":market==="foul1"?"foul":market==="fouled1"?"fouled":market==="shot1"?"shot":"sot"
      const status=(scorecard.marketAvailability as any)?.[marketGroup]??"unknown"
      candidates.push({
        player:leg.player,team:leg.team,market,label:nextLabel,
        probability:Math.round(probability*1000)/1000,
        fullMatchProbability:Math.round(Number(leg.probability??0)*1000)/1000,
        fairOdds:Math.round((1/Math.max(.01,probability))*100)/100,
        confidence:leg.confidence,marketStatus:status,
        bookmakerOdds:null,bookmakerName:null,
        currentCount,liveStatsAvailable:Boolean(stat),
        currentFouls:stat?.foulsCommitted??null,currentFouled:stat?.foulsDrawn??null,
        currentShots:stat?.shots??null,currentSot:stat?.shotsOnTarget??null,
        currentTackles:stat?.tackles??null,currentInterceptions:stat?.interceptions??null,
        currentBlocks:stat?.blocks??null,currentDuels:stat?.duelsTotal??null,currentDuelsWon:stat?.duelsWon??null,currentDefensiveInterventions:stat?.defensiveInterventions??null,
        currentYellowCards:stat?.yellowCards??null,currentRedCards:stat?.redCards??null,
        reason:"Remaining-match estimate from the confirmed-XI player model, updated from live match event counts."+pressureNote,
      })
    }
  }
  const out:any[]=[]
  for(const market of LIVE_PROP_MARKETS){
    out.push(...candidates.filter(x=>x.market===market).sort((a,b)=>b.probability-a.probability).slice(0,3))
  }
  return out
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
  try{await gradeHistoricalRecommendations(250)}catch{}
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
      const upcoming=[...fixtureMap.values()]
        .filter(f=>{
          const status=String(f.status??"").toLowerCase()
          const blocked=["postponed","cancelled","canceled","finished","ft","full time","after extra time","aet","abandoned","suspended"]
          const kickoffMs=new Date(f.kickoff).getTime()
          // Keep a verified pre-match Multi visible after kickoff instead of
          // deleting it the instant the clock passes the scheduled start.
          return Number.isFinite(kickoffMs)&&kickoffMs>nowMs-180*60*1000&&!blocked.includes(status)
        })
        .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
        .slice(0,maxFixtures)

      // Cheap first pass: only inspect Bet365 market coverage. Full scorecards
      // are built for the small set that actually has every required player prop.
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
      const coveredIds=new Set(eligibleFixtures.map(f=>f.id))
      const scans:FixtureScan[]=await Promise.all(upcoming.map(async fixture=>{
        try{
          // Every match gets a model board. Only fixtures with usable Bet365
          // coverage pay the cost of the full bookmaker-enriched scorecard.
          let scorecard=coveredIds.has(fixture.id)?await scorecardFor(fixture,refresh):await fallbackScorecard(fixture)
          if(!scorecard?.ok)scorecard=await fallbackScorecard(fixture)
          if(!scorecard?.ok)return {fixture,scorecard:null,recommendations:[]}
          const minutesToKickoff=(new Date(fixture.kickoff).getTime()-Date.now())/60000
          const officialLineup=minutesToKickoff<=120?await officialLineupForFixture(fixture):{confirmed:false,starters:new Set<string>()}
          if(officialLineup.confirmed)scorecard=filterScorecardToOfficialStarters(scorecard,officialLineup)
          return {fixture,scorecard,recommendations:[]}
        }catch{return {fixture,scorecard:null,recommendations:[]}}
      }))

      const multiGameBoards=buildMultiGameBoards(scans)
      const multiMatchBuild=buildMultiMatchFromScans(scans)
      const yellowCardWatch=buildYellowCardWatchFromScans(scans)
      const payload={
        ok:true,
        date:resolvedDate,
        updatedAt:new Date().toISOString(),
        fixturesScanned:upcoming.length,
        eligibleFixtures:eligibleFixtures.length,
        multiGameBoards,
        multiMatchBuild,
        yellowCardWatch,
        liveMatches:[],
        staleFallback:false,
        methodology:{
          multiMatch:"Every match gets a per-game player likelihood board with the top three cards, fouls committed, fouls drawn, shots, SOT, goals and assists. Ranking uses the model probability plus recent/season/H2H evidence, with card-specific recommendation evidence for bookings. Bet365 prices are added when available but are not required for a match or player to appear. Once official XIs are confirmed, the board is hard-filtered to current starters.",
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
        const livePlayerProps=buildLivePlayerProps(scorecard,elapsed,liveStatData.players)
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
          livePlayerProps:buildLivePlayerProps(scorecard,elapsed,liveStatData.players),
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
