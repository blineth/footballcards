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
  bookmakerProbability?:number|null
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
  name:string;dbName?:string;team:string;
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
  const coreRatio=legs.filter(l=>l.market==="card"||l.market.startsWith("foul")).length/legs.length
  return geo*.38+min*.19+reliability*.16+grade*.08+coreRatio*.07+exactRatio*.04+(confirmed?.05:0)+(placeable?.03:0)-Math.max(0,legs.length-5)*.006
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
  const baseMarket=(market:string)=>market==="goal1"||market==="assist1"||market==="foul1"||market==="fouled1"||market==="card"||market==="shot1"||market==="sot1"

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
    if(leg.market.startsWith("goal")||leg.market.startsWith("assist"))p*=.98
    if(leg.market==="card")p*=.985
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
    return state.conservativeProb*Math.pow(Math.max(.12,minP)/.50,.72)*Math.pow(Math.max(.35,avgP)/.60,.18)
  }

  function search(targetDecimal:number){
    type State={
      legs:Candidate[];odds:number;modelProb:number;conservativeProb:number;
      players:Set<string>;families:Record<string,number>;teamCounts:Record<string,number>;baseCount:number
    }
    let states:State[]=[{legs:[],odds:1,modelProb:1,conservativeProb:1,players:new Set(),families:{},teamCounts:{},baseCount:0}]
    const pool=[...candidates]
      .sort((a,b)=>b.conservativeP-a.conservativeP||b.modelP-a.modelP||((baseMarket(a.leg.market)?0:1)-(baseMarket(b.leg.market)?0:1))||a.exactPrice-b.exactPrice)
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
      const balanced=acceptable.filter(state=>(state.teamCounts.home??0)>0&&(state.teamCounts.away??0)>0)
      if(balanced.length)acceptable=balanced
    }
    if(!acceptable.length)return null

    return acceptable.sort((a,b)=>{
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
      note:"Safest-route search: up to 12 Bet365 selections, max six different players per team, both teams considered, and one prop per player to reduce same-player correlation. Each leg is conservatively calibrated against Bet365's implied/no-vig probability before whole-slip optimisation. The engine can use all 12 selections if that is safer than reaching the target with one or two speculative legs. Match winner, double chance, total goals and corners are excluded.",
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
    .map(fixture=>({fixture,targets:buildTargetOddsSlips(scorecards.get(fixture.id)??null,fixture)}))
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
type MultiMatchGameBuilder={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  targetFractional:"3/1";referenceOdds:number;modelAllHitProbability:number;
  conservativeAllHitProbability:number;legs:MultiMatchLeg[]
}
type MultiMatchBuild={
  available:boolean;targetFractionalPerMatch:"3/1";maxMatches:number;eligibleFixtureCount:number;
  matchBuilders:MultiMatchGameBuilder[];legs:MultiMatchLeg[];
  combinedBet365Odds:number|null;modelAllHitProbability:number|null;note:string
}
type YellowCardWatchRow={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;homeCrest?:string|null;awayCrest?:string|null;
  player:string;team:string;probability:number;evidenceScore?:number;bookmakerOdds:number;confidence:SlipLeg["confidence"];reason:string;
  probabilityBasis:"model"|"bet365-implied"
}
function fullPlayerMarketSet(status:Scorecard["marketAvailability"]){
  return ["card","foul","fouled","shot","sot"].every(key=>(status as any)?.[key]==="available")
}
type FixtureScan={fixture:Fixture;scorecard:Scorecard|null;recommendations:Recommendation[]}

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
      })
    }
  }
  return out
}

function buildMultiMatchFromScans(scans:FixtureScan[]):MultiMatchBuild{
  const eligible=scans.filter(x=>x.scorecard?.ok&&fullPlayerMarketSet(x.scorecard.marketAvailability))

  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const baseMarket=(market:string)=>market==="goal1"||market==="assist1"||market==="foul1"||market==="fouled1"||market==="card"||market==="shot1"||market==="sot1"
  const confidenceReliability=(leg:SlipLeg)=>leg.confidence==="A"?1:leg.confidence==="B"?.96:leg.confidence==="C"?.88:.74
  const marketReliability=(leg:SlipLeg)=>{
    const f=family(leg.market)
    if(f==="foul")return .99
    if(f==="fouled")return .985
    if(f==="shot")return .98
    if(f==="sot")return .95
    if(f==="card")return .93
    if(f==="goal")return .92
    if(f==="assist")return .90
    return .95
  }
  const conservativeJoint=(legs:SlipLeg[],raw:number)=>{
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

  function safestThreeToOne(scan:FixtureScan):MultiMatchGameBuilder|null{
    const scorecard=scan.scorecard
    if(!scorecard)return null
    const candidates=directPlayerCandidates(scorecard)
      .filter(leg=>leg.bookmakerName==="Bet365"&&leg.bookmakerOdds!=null&&Number(leg.bookmakerOdds)>1&&leg.probability>=.40)
      .sort((a,b)=>b.probability-a.probability||((baseMarket(a.market)?0:1)-(baseMarket(b.market)?0:1))||Number(a.bookmakerOdds)-Number(b.bookmakerOdds))
      .slice(0,90)

    type State={legs:SlipLeg[];product:number;raw:number;conservative:number;players:Set<string>;families:Record<string,number>}

    const runSearch=(pool:SlipLeg[])=>{
      const minLegProbability=.34
      const byPlayer=new Map<string,SlipLeg[]>()
      for(const leg of pool){
        if(leg.probability<minLegProbability)continue
        const key=normName(leg.player)
        if(!byPlayer.has(key))byPlayer.set(key,[])
        byPlayer.get(key)!.push(leg)
      }

      type State={legs:SlipLeg[];product:number;raw:number;conservative:number;families:Record<string,number>;teamCounts:Record<string,number>}
      const maxProduct=6.2
      const maxLog=Math.log(maxProduct)
      const buckets=700
      const bucketFor=(product:number)=>Math.max(0,Math.min(buckets,Math.round(Math.log(Math.max(1,product))/maxLog*buckets)))

      let states=new Map<number,State>()
      states.set(0,{legs:[],product:1,raw:1,conservative:1,families:{},teamCounts:{}})

      for(const options of byPlayer.values()){
        const next=new Map(states)
        for(const state of states.values()){
          if(state.legs.length>=12)continue
          for(const leg of options){
            const fam=family(leg.market)
            const familyCount=state.families[fam]??0
            if(familyCount>=12)continue
            const teamKey=normName(leg.team)
            const teamCount=state.teamCounts[teamKey]??0
            if(teamCount>=6)continue
            const product=state.product*Number(leg.bookmakerOdds)
            if(product>maxProduct)continue
            const legs=[...state.legs,leg]
            const raw=state.raw*leg.probability
            const candidate:State={
              legs,product,raw,conservative:conservativeJoint(legs,raw),
              families:{...state.families,[fam]:familyCount+1},
              teamCounts:{...state.teamCounts,[teamKey]:teamCount+1},
            }
            const bucket=bucketFor(product)
            const existing=next.get(bucket)
            if(!existing||
              candidate.raw>existing.raw+.000001||
              (Math.abs(candidate.raw-existing.raw)<=.000001&&candidate.conservative>existing.conservative)
            )next.set(bucket,candidate)
          }
        }
        const ordered=[...next.entries()].sort(([,a],[,b])=>{
          const aHit=a.product>=4,bHit=b.product>=4
          if(aHit!==bHit)return aHit?-1:1
          if(Math.abs(a.raw-b.raw)>.000001)return b.raw-a.raw
          if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
          return Math.abs(a.product-4)-Math.abs(b.product-4)
        })
        states=new Map(ordered.slice(0,Math.min(900,ordered.length)))
      }

      return [...states.values()]
        .filter(s=>s.legs.length>=2&&s.product>=4&&s.product<=5.8)
        .sort((a,b)=>{
          if(Math.abs(a.raw-b.raw)>.000001)return b.raw-a.raw
          if(Math.abs(a.conservative-b.conservative)>.000001)return b.conservative-a.conservative
          return Math.abs(a.product-4)-Math.abs(b.product-4)
        })[0]
    }

    // First try only the safer low thresholds spread across different players.
    // Escalated thresholds are fallback-only if those cannot reach ~3/1.
    let best=runSearch(candidates.filter(leg=>baseMarket(leg.market)))
    if(!best)best=runSearch(candidates)
    if(!best)return null

    const legs:MultiMatchLeg[]=best.legs.map(leg=>({
      fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
      home:scan.fixture.home.name,away:scan.fixture.away.name,
      player:leg.player,team:leg.team,market:leg.market,label:leg.label,
      probability:leg.probability,bookmakerOdds:Number(leg.bookmakerOdds),bookmaker:"Bet365",confidence:leg.confidence,
    }))
    return {
      fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
      home:scan.fixture.home.name,away:scan.fixture.away.name,homeCrest:scan.fixture.home.crest??null,awayCrest:scan.fixture.away.crest??null,targetFractional:"3/1",
      referenceOdds:Math.round(best.product*100)/100,
      modelAllHitProbability:Math.round(best.raw*10000)/10000,
      conservativeAllHitProbability:Math.round(best.conservative*10000)/10000,
      legs,
    }
  }

  const built=eligible.map(safestThreeToOne).filter(Boolean) as MultiMatchGameBuilder[]
  built.sort((a,b)=>b.modelAllHitProbability-a.modelAllHitProbability||b.conservativeAllHitProbability-a.conservativeAllHitProbability||a.referenceOdds-b.referenceOdds)

  // A Bet Builder Acca is capped by matches here, not by the number of
  // underlying player selections inside each same-game builder.
  const matchBuilders=built.slice(0,10)
  const legs=matchBuilders.flatMap(x=>x.legs)
  const combined=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.referenceOdds,1):null
  const allHit=matchBuilders.length?matchBuilders.reduce((v,x)=>v*x.conservativeAllHitProbability,1):null

  return {
    available:matchBuilders.length>=2,
    targetFractionalPerMatch:"3/1",
    maxMatches:10,
    eligibleFixtureCount:eligible.length,
    matchBuilders,
    legs,
    combinedBet365Odds:combined==null?null:Math.round(combined*100)/100,
    modelAllHitProbability:allHit==null?null:Math.round(allHit*10000)/10000,
    note:matchBuilders.length
      ?"Each included match uses the safest verified Bet365 route that reaches roughly 3/1 using the same probability-first player-prop logic as the individual Match Builder, with up to 12 selections and six players per team when that improves the all-hit chance. Predicted-XI players are allowed before confirmation but carry a heavier reliability penalty; the official XI replaces them automatically. The overall number is the product of verified Bet365 leg prices; Bet365 can reprice correlated same-game selections in the final Bet Builder Acca."
      :"No two fully-covered matches currently have a verified Safe 3/1 player-prop route.",
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
  if(!refresh&&multiOnly&&lastGoodMulti&&Date.now()-lastGoodMultiAt<STALE_CACHE_MS){
    return NextResponse.json({...lastGoodMulti,staleFallback:false,servedFrom:"server-multi-cache"},{
      headers:{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=1800"}
    })
  }
  if(!refresh&&!multiOnly&&lastGoodRecommended&&Date.now()-lastGoodAt<STALE_CACHE_MS){
    return NextResponse.json({...lastGoodRecommended,staleFallback:false,servedFrom:"server-last-good"},{
      headers:{"Cache-Control":"public, s-maxage=120, stale-while-revalidate=1800"}
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
      const upcoming=[...fixtureMap.values()]
        .filter(f=>{
          const status=String(f.status??"").toLowerCase()
          const blocked=["postponed","cancelled","canceled","finished","halftime","in progress","live"]
          return new Date(f.kickoff).getTime()>Date.now()&&!blocked.includes(status)
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
          return fullPlayerMarketSet(odds?.marketAvailability)?fixture:null
        }catch{return null}
      }))

      const eligibleFixtures=coverage.filter(Boolean) as Fixture[]
      const scans:FixtureScan[]=await Promise.all(eligibleFixtures.map(async fixture=>{
        try{
          let scorecard=await scorecardFor(fixture,refresh)
          if(!scorecard?.ok)scorecard=await fallbackScorecard(fixture)
          return {fixture,scorecard:scorecard?.ok?scorecard:null,recommendations:[]}
        }catch{return {fixture,scorecard:null,recommendations:[]}}
      }))

      const multiMatchBuild=buildMultiMatchFromScans(scans)
      const yellowCardWatch=buildYellowCardWatchFromScans(scans)
      const payload={
        ok:true,
        date:resolvedDate,
        updatedAt:new Date().toISOString(),
        fixturesScanned:upcoming.length,
        eligibleFixtures:eligibleFixtures.length,
        multiMatchBuild,
        yellowCardWatch,
        liveMatches:[],
        staleFallback:false,
        methodology:{
          multiMatch:"Fast path: Bet365 coverage is checked first. Full scorecards are only built for fixtures with Cards, Fouls Committed, Fouls Drawn, Shots and SOT all available.",
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
        const rawStandards=builderSlips.length?builderSlips:(scorecard.slips??[])
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
        targetOdds:"Select a match, then 3/1 through 50/1 targets use every eligible verified Bet365 player-prop option from the scorecard. The target price is only a constraint: the chosen route maximises estimated whole-slip hit probability, can use several safer 1+ events across different players, and never adds match winner, double chance, total goals or corners. Cards require supporting H2H/current-form/foul-pressure evidence. Model/fair odds are never substituted for Bet365 prices.",
        multiMatch:"The Multi-Match Builder only admits fixtures where Bet365 has Cards, Fouls Committed, Fouls Drawn, Shots and Shots on Target all available. It builds the safest verified same-game route to roughly 3/1 in each included match using the same probability-first logic as the individual Match Builder, then combines up to 10 match builders. Each match can contain multiple underlying player selections.",
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
