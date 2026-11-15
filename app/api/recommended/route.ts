import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { GET as matchAccaGET } from "../match-acca/route"
import { GET as livePlayerStatsGET } from "../live-player-stats/route"
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
  home:{name:string};away:{name:string};lineupStatus?:"expected"|"confirmed"|"unavailable"
}
type MarketStatus="available"|"unavailable"|"unknown"
type SlipLeg={
  player:string;dbPlayerName?:string|null;team:string;market:string;label:string;
  probability:number;fairOdds:number|null;bookmakerOdds:number|null;bookmakerName?:string|null;
  edge:number|null;confidence:"A"|"B"|"C"|"D";reason:string;priceSource?:"exact"|"estimated"|null
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
  bookmakerName?:string|null;edge?:number|null;confidence:"A"|"B"|"C"|"D";reasons?:string[]
}
type ScorecardPlayer={
  name:string;dbName?:string;team:string;
  markets?:Record<string,ScorecardMarket>;
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
  }>
}
type Recommendation={
  id:string;fixture:Fixture;slip:BetSlip|FoulTargetSlip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null;
  fullPlayerMarkets?:boolean;playerMarketAvailability?:Record<string,MarketStatus>
}
type TargetOddsLeg={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;
  player:string;team:string;market:string;label:string;probability:number;
  price:number;priceSource:"exact";bookmaker:"Bet365";confidence:SlipLeg["confidence"]
}
type TargetOddsSlip={
  id:string;targetFractional:string;targetDecimal:number;available:boolean;
  referenceOdds:number|null;modelAllHitProbability:number|null;bookmaker:string|null;
  priceSource:"bookmaker-singles"|null;marketsVerified:boolean;legs:TargetOddsLeg[];
  note:string
}
type TargetOddsGame={
  fixture:Fixture
  targets:TargetOddsSlip[]
}

const competitions:Competition[]=["Premier League","Championship","League One","League Two","International"]

const ESPN_INTL_SLUGS=["uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf"]
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

function buildTargetOddsSlips(recommendations:Recommendation[],fixtureId:string):TargetOddsSlip[]{
  type Candidate={
    fixture:Fixture;leg:SlipLeg;bookmaker:string|null;exactPrice:number|null;
    marketVerified:boolean
  }
  const candidates:Candidate[]=[]
  const seen=new Set<string>()
  for(const rec of recommendations){
    if(rec.fixture.id!==fixtureId)continue
    for(const leg of rec.slip.legs??[]){
      const p=Math.max(.01,Math.min(.99,Number(leg.probability??0)))
      if(p<.12||leg.confidence==="D")continue
      const book=leg.bookmakerName??rec.slip.bookmaker??null
      const exact=book==="Bet365"&&leg.bookmakerOdds!=null&&leg.priceSource!=="estimated"?Number(leg.bookmakerOdds):null
      if(exact==null||!Number.isFinite(exact)||exact<=1)continue
      const key=[leg.player,leg.market,leg.label,"Bet365"].join("|")
      if(seen.has(key))continue
      seen.add(key)
      candidates.push({
        fixture:rec.fixture,leg,bookmaker:"Bet365",exactPrice:exact,
        marketVerified:true,
      })
    }
  }

  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  function search(targetDecimal:number,bookmaker:"Bet365"){
    const minFamilies=targetDecimal>=16?3:2
    type State={legs:Candidate[];odds:number;prob:number;players:Set<string>;families:Record<string,number>}
    let states:State[]=[{legs:[],odds:1,prob:1,players:new Set(),families:{}}]
    const pool=candidates
      .filter(x=>x.bookmaker===bookmaker&&x.exactPrice!=null)
      .sort((a,b)=>b.leg.probability-a.leg.probability)
      .slice(0,24)

    for(const option of pool){
      const next=[...states]
      for(const state of states){
        if(state.legs.length>=8||state.players.has(option.leg.player))continue
        const fam=family(option.leg.market)
        const familyCount=state.families[fam]??0
        if(familyCount>=2)continue
        const price=option.exactPrice
        if(price==null)continue
        const odds=state.odds*price
        if(odds>targetDecimal*1.65&&state.legs.length>=1)continue
        next.push({
          legs:[...state.legs,option],
          odds,
          prob:state.prob*option.leg.probability,
          players:new Set([...state.players,option.leg.player]),
          families:{...state.families,[fam]:familyCount+1},
        })
      }
      const score=(s:State)=>{
        if(!s.legs.length)return 999
        const distance=Math.abs(Math.log(Math.max(1.01,s.odds))-Math.log(targetDecimal))
        const minProb=Math.min(...s.legs.map(x=>x.leg.probability))
        const avgProb=s.legs.reduce((sum,x)=>sum+x.leg.probability,0)/s.legs.length
        const confidence=s.legs.filter(x=>x.leg.confidence==="A"||x.leg.confidence==="B").length/s.legs.length
        const diversity=Object.keys(s.families).length
        return distance*2.45-avgProb*.48-minProb*.18-confidence*.08-diversity*.07+s.legs.length*.015
      }
      // Preserve the most likely combinations across the whole price range.
      // A close-to-target but speculative combination must not crowd out a safer
      // combination that reaches the same target with more short-priced legs.
      const buckets=new Map<string,State[]>()
      for(const state of next){
        const oddsBucket=Math.floor(Math.log(Math.max(1,state.odds))*100)
        const key=oddsBucket+"|"+state.legs.length
        const rows=buckets.get(key)??[]
        rows.push(state)
        rows.sort((a,b)=>b.prob-a.prob||score(a)-score(b))
        buckets.set(key,rows.slice(0,10))
      }
      states=[...buckets.values()].flat()
        .sort((a,b)=>b.prob-a.prob||score(a)-score(b))
        .slice(0,2200)
    }
    const acceptable=states.filter(s=>s.legs.length>=2&&s.odds>=targetDecimal&&s.odds<=targetDecimal*1.35&&Object.keys(s.families).length>=minFamilies)
    if(!acceptable.length)return null
    return acceptable.sort((a,b)=>{
      // Primary objective: highest whole-slip hit probability. Odds proximity is
      // only a tie-breaker once both combinations genuinely meet the target.
      if(Math.abs(a.prob-b.prob)>.0005)return b.prob-a.prob
      const weakA=Math.min(...a.legs.map(x=>x.leg.probability))
      const weakB=Math.min(...b.legs.map(x=>x.leg.probability))
      if(Math.abs(weakA-weakB)>.005)return weakB-weakA
      const da=Math.abs(Math.log(a.odds)-Math.log(targetDecimal))
      const db=Math.abs(Math.log(b.odds)-Math.log(targetDecimal))
      if(Math.abs(da-db)>.01)return da-db
      return a.legs.length-b.legs.length
    })[0]
  }

  return TARGET_ODDS.map(target=>{
    let chosen:{legs:Candidate[];odds:number;prob:number;players:Set<string>}|null=search(target.decimal,"Bet365")
    const chosenBook:"Bet365"="Bet365"
    const source:"bookmaker-singles"|null=chosen?"bookmaker-singles":null
    if(!chosen)return {
      id:"target-"+fixtureId+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,
      available:false,referenceOdds:null,modelAllHitProbability:null,bookmaker:null,
      priceSource:null,marketsVerified:false,legs:[],
      note:"No strong, market-diverse combination actually reaches this target. A lower-priced slip is never labelled as this target.",
    }
    const legs:TargetOddsLeg[]=chosen.legs.map(x=>{
      const price=Number(x.exactPrice)
      return {
        fixtureId:x.fixture.id,competition:x.fixture.competition,kickoff:x.fixture.kickoff,
        home:x.fixture.home.name,away:x.fixture.away.name,player:x.leg.player,team:x.leg.team,
        market:x.leg.market,label:x.leg.label,probability:x.leg.probability,
        price:Math.round(price*1000)/1000,priceSource:"exact" as const,
        bookmaker:"Bet365" as const,confidence:x.leg.confidence,
      }
    })
    const marketsVerified=chosen.legs.every(x=>x.marketVerified&&x.bookmaker==="Bet365"&&x.exactPrice!=null)
    return {
      id:"target-"+fixtureId+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,available:true,
      referenceOdds:Math.round(chosen.odds*100)/100,
      modelAllHitProbability:Math.round(chosen.prob*10000)/10000,
      bookmaker:chosenBook,priceSource:source,marketsVerified,legs,
      note:"Uses verified Bet365 individual leg prices only. Once a combination reaches the target, the model chooses the highest estimated whole-slip hit probability rather than simply the closest price. No model/fair odds are used as bookmaker prices. Bet365 can still apply correlation when quoting the final same-game Bet Builder.",
    }
  })
}

function buildTargetOddsGames(recommendations:Recommendation[],fixturePool:Fixture[]=[]):TargetOddsGame[]{
  const fixtures=new Map<string,Fixture>()
  // Let the user choose any remaining game today, even when that fixture does not
  // currently have enough qualified legs for a full recommendation card.
  for(const fixture of fixturePool)fixtures.set(fixture.id,fixture)
  for(const rec of recommendations)fixtures.set(rec.fixture.id,rec.fixture)
  return [...fixtures.values()]
    .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
    .map(fixture=>({fixture,targets:buildTargetOddsSlips(recommendations,fixture.id)}))
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
type MultiMatchBuild={
  available:boolean;targetLegProbability:number;maxLegs:number;eligibleFixtureCount:number;
  legs:MultiMatchLeg[];combinedBet365Odds:number|null;modelAllHitProbability:number|null;note:string
}
type YellowCardWatchRow={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;
  player:string;team:string;probability:number;bookmakerOdds:number;confidence:SlipLeg["confidence"];reason:string
}
function fullPlayerMarketSet(status:Scorecard["marketAvailability"]){
  return ["card","foul","fouled","shot","sot"].every(key=>(status as any)?.[key]==="available")
}
type FixtureScan={fixture:Fixture;scorecard:Scorecard|null;recommendations:Recommendation[]}

function directPlayerCandidates(scorecard:Scorecard){
  const out:SlipLeg[]=[]
  const seen=new Set<string>()
  for(const player of scorecard.players??[]){
    for(const [marketKey,market] of Object.entries(player.markets??{})){
      if(!["card","foul1","fouled1","shot1","sot1","goal1","assist1"].includes(marketKey))continue
      const exact=market.bookmakerName==="Bet365"&&market.bookmakerOdds!=null&&Number(market.bookmakerOdds)>1
      if(!exact||market.confidence==="D")continue
      const key=normName(player.name)+"|"+marketKey+"|"+market.label
      if(seen.has(key))continue
      seen.add(key)
      out.push({
        player:player.name,team:player.team,market:marketKey,label:market.label,
        probability:Number(market.probability),fairOdds:market.fairOdds??null,
        bookmakerOdds:Number(market.bookmakerOdds),bookmakerName:"Bet365",
        edge:market.edge??null,confidence:market.confidence,
        reason:(market.reasons??[]).join(" · ")||"Verified Bet365 player market",
        priceSource:"exact",
      })
    }
  }
  return out
}

function buildMultiMatchFromScans(scans:FixtureScan[]):MultiMatchBuild{
  const eligible=scans.filter(x=>x.scorecard?.ok&&fullPlayerMarketSet(x.scorecard.marketAvailability))
  const chosen:MultiMatchLeg[]=[]

  for(const scan of eligible){
    const scorecard=scan.scorecard!
    const candidates:Array<{
      player:string;team:string;market:string;label:string;probability:number;odds:number;confidence:SlipLeg["confidence"]
    }>=[]

    for(const leg of directPlayerCandidates(scorecard)){
      if(leg.bookmakerOdds==null||leg.bookmakerName!=="Bet365")continue
      candidates.push({
        player:leg.player,team:leg.team,market:leg.market,label:leg.label,
        probability:leg.probability,odds:Number(leg.bookmakerOdds),confidence:leg.confidence,
      })
    }

    for(const bet of scorecard.availableBets??[]){
      if(bet.bookmaker!=="Bet365"||!(bet.odd>1)||bet.probability==null)continue
      candidates.push({
        player:"",team:scan.fixture.home.name+" v "+scan.fixture.away.name,
        market:"board:"+bet.kind,label:bet.label,probability:Number(bet.probability),
        odds:Number(bet.odd),confidence:Number(bet.probability)>=.90?"A":Number(bet.probability)>=.80?"B":"C",
      })
    }

    // A ~90% leg is the target. Do not pad the multi with materially weaker legs.
    const best=candidates
      .filter(x=>x.probability>=.90&&x.odds>=1.02)
      .sort((a,b)=>b.probability-a.probability||a.odds-b.odds)[0]
    if(!best)continue

    chosen.push({
      fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
      home:scan.fixture.home.name,away:scan.fixture.away.name,
      player:best.player,team:best.team,market:best.market,label:best.label,
      probability:best.probability,bookmakerOdds:best.odds,bookmaker:"Bet365",confidence:best.confidence,
    })
  }

  chosen.sort((a,b)=>b.probability-a.probability||a.bookmakerOdds-b.bookmakerOdds)
  const legs=chosen.slice(0,10)
  const combined=legs.length?legs.reduce((v,l)=>v*l.bookmakerOdds,1):null
  const allHit=legs.length?legs.reduce((v,l)=>v*l.probability,1):null
  return {
    available:legs.length>=2,targetLegProbability:.90,maxLegs:10,
    eligibleFixtureCount:eligible.length,
    legs,
    combinedBet365Odds:combined==null?null:Math.round(combined*100)/100,
    modelAllHitProbability:allHit==null?null:Math.round(allHit*10000)/10000,
    note:legs.length
      ?"Every leg is 90%+ by the current model/market estimate, has a verified Bet365 price, and comes from a match where Cards, Fouls Committed, Fouls Drawn, Shots and SOT are all available."
      :"No remaining fixtures currently satisfy both the full-market gate and the 90%+ verified-leg threshold.",
  }
}

function buildYellowCardWatchFromScans(scans:FixtureScan[]):YellowCardWatchRow[]{
  const rows:YellowCardWatchRow[]=[]
  const seen=new Set<string>()
  for(const scan of scans){
    const scorecard=scan.scorecard
    if(!scorecard?.ok||scorecard.marketAvailability?.card!=="available")continue
    for(const player of scorecard.players??[]){
      const market=player.markets?.card
      if(!market||market.bookmakerName!=="Bet365"||market.bookmakerOdds==null||Number(market.bookmakerOdds)<=1||market.confidence==="D")continue
      const key=scan.fixture.id+"|"+normName(player.name)
      if(seen.has(key))continue
      seen.add(key)
      rows.push({
        fixtureId:scan.fixture.id,competition:scan.fixture.competition,kickoff:scan.fixture.kickoff,
        home:scan.fixture.home.name,away:scan.fixture.away.name,
        player:player.name,team:player.team,probability:Number(market.probability),
        bookmakerOdds:Number(market.bookmakerOdds),confidence:market.confidence,
        reason:(market.reasons??[]).join(" · ")||"Verified Bet365 player-card market",
      })
    }
  }
  return rows.sort((a,b)=>b.probability-a.probability).slice(0,16)
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
      if(market==="card"&&stat&&(stat.yellowCards>0||stat.redCards>0))continue

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
        if(model)return {...model,livePlayerProps,livePlayerStatsSource:liveStatData.source}
        const home=Number(f.score?.home),away=Number(f.score?.away)
        const hasScore=Number.isFinite(home)&&Number.isFinite(away)
        const bttsSettled=Boolean(hasScore&&home>0&&away>0)
        return {
          id:String(f.id),competition:f.competition,kickoff:f.kickoff,status:f.status??"live",
          inPlay:true,elapsed:f.elapsed??null,score:hasScore?{home,away}:null,
          home:f.home.name,away:f.away.name,probabilities:null,winnerPick:null,bttsPick:null,bttsSettled,
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
          score:f.score??null,home:f.home.name,away:f.away.name,
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
    const targetOddsGames=buildTargetOddsGames(allRecommendations,upcoming)
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
        targetOdds:"Select a match, then 5/1 through 50/1 targets use verified Bet365 individual leg prices only. If Bet365 prices are missing, the target is unavailable; model/fair odds are never substituted. The final Bet365 Bet Builder quote can still differ because of correlation.",
        multiMatch:"The Multi-Match Builder only admits fixtures where Bet365 has Cards, Fouls Committed, Fouls Drawn, Shots and Shots on Target all available. It uses one verified Bet365 selection per match, prefers 90%+ model legs and caps the build at 10 matches.",
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
