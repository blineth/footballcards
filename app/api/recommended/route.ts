import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { GET as matchAccaGET } from "../match-acca/route"
import { gradeHistoricalRecommendations, recommendationTrackingSummary, saveRecommendationSnapshots } from "@/lib/recommendation-tracking"
import recommendationBacktest from "@/data/model/recommendation-backtest.json"
import calibrationSnapshot from "@/data/model/calibration.json"
import { snapshotPlayersForFixture, internationalPlayersForFixture } from "@/lib/current-season-snapshot"

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
type ScorecardPlayer={
  name:string;dbName?:string;team:string;
  yellowConditionals?:{
    overall?:{matches:number;yellows:number;rate:number};
    after1PlusFouls?:{matches:number;yellows:number;rate:number|null};
    after2PlusFouls?:{matches:number;yellows:number;rate:number|null};
    after3PlusFouls?:{matches:number;yellows:number;rate:number|null};
  }
}
type Scorecard={
  ok:boolean;lineupsConfirmed?:boolean;eligibleBooks?:string[];
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus};
  slips?:BetSlip[];previewSlips?:BetSlip[];foulTargetSlips?:FoulTargetSlip[];previewFoulTargetSlips?:FoulTargetSlip[];
  players?:ScorecardPlayer[]
}
type Recommendation={
  id:string;fixture:Fixture;slip:BetSlip|FoulTargetSlip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null
}
type TargetOddsLeg={
  fixtureId:string;competition:Competition;kickoff:string;home:string;away:string;
  player:string;team:string;market:string;label:string;probability:number;
  price:number;priceSource:"exact"|"model";bookmaker:string|null;confidence:SlipLeg["confidence"]
}
type TargetOddsSlip={
  id:string;targetFractional:string;targetDecimal:number;available:boolean;
  referenceOdds:number|null;modelAllHitProbability:number|null;bookmaker:string|null;
  priceSource:"bookmaker-singles"|"model"|null;marketsVerified:boolean;legs:TargetOddsLeg[];
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
  yellowCards:number;redCards:number
}
function espnStat(row:any,name:string){
  const found=(row?.stats??[]).find((s:any)=>String(s?.name??"")===name)
  const value=Number(found?.value??found?.displayValue??0)
  return Number.isFinite(value)?value:0
}
async function livePlayerStatsForFixture(f:Fixture){
  const preferred=String(f.id??"").includes(":")?String(f.id).split(":")[0]:null
  const slugs=[
    ...(preferred?[preferred]:[]),
    ...(f.competition==="International"?ESPN_INTL_SLUGS:[ESPN_LEAGUE_SLUGS[f.competition]].filter(Boolean) as string[]),
  ].filter((v,i,a)=>Boolean(v)&&a.indexOf(v)===i) as string[]
  const date=fixtureDate(f).replaceAll("-","")
  for(const slug of slugs){
    try{
      let eventId=preferred===slug&&String(f.id).includes(":")?String(f.id).split(":").slice(1).join(":"):""
      if(!eventId){
        const scoreboard=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+date+"&limit=300",{cache:"no-store",signal:AbortSignal.timeout(4500),headers:{accept:"application/json"}})
        if(!scoreboard.ok)continue
        const data=await scoreboard.json()
        const event=(data?.events??[]).find((e:any)=>{
          const comps=e?.competitions?.[0]?.competitors??[]
          const h=comps.find((x:any)=>x.homeAway==="home")
          const a=comps.find((x:any)=>x.homeAway==="away")
          return sameTeamName(String(h?.team?.displayName??""),f.home.name)&&sameTeamName(String(a?.team?.displayName??""),f.away.name)
        })
        eventId=String(event?.id??"")
      }
      if(!eventId)continue
      const summaryRes=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/summary?event="+eventId,{cache:"no-store",signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}})
      if(!summaryRes.ok)continue
      const summary=await summaryRes.json()
      const map=new Map<string,LivePlayerStat>()
      for(const section of summary?.rosters??[]){
        const team=String(section?.team?.displayName??section?.team?.name??"")
        for(const row of section?.roster??[]){
          const player=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim()
          if(!player)continue
          map.set(normName(player),{
            player,team,
            foulsCommitted:espnStat(row,"foulsCommitted"),
            foulsDrawn:espnStat(row,"foulsSuffered"),
            shots:espnStat(row,"totalShots"),
            shotsOnTarget:espnStat(row,"shotsOnTarget"),
            yellowCards:espnStat(row,"yellowCards"),
            redCards:espnStat(row,"redCards"),
          })
        }
      }
      // Card events are also read from the event stream because roster totals can lag briefly.
      for(const event of summary?.keyEvents??[]){
        const type=String(event?.type?.type??event?.type?.text??"").toLowerCase()
        const isYellow=type.includes("yellow")
        const isRed=type.includes("red")
        if(!isYellow&&!isRed)continue
        for(const p of event?.participants??[]){
          const name=String(p?.athlete?.displayName??p?.athlete?.fullName??"").trim()
          if(!name)continue
          const key=normName(name),current=map.get(key)
          if(!current)continue
          if(isYellow)current.yellowCards=Math.max(1,current.yellowCards)
          if(isRed)current.redCards=Math.max(1,current.redCards)
        }
      }
      if(map.size)return {source:"ESPN-live",players:map}
    }catch{}
  }
  return {source:null,players:new Map<string,LivePlayerStat>()}
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
const TARGET_BOOKS=["Bet365","Sky Bet","William Hill","Paddy Power"] as const

function buildTargetOddsSlips(recommendations:Recommendation[],fixtureId:string):TargetOddsSlip[]{
  type Candidate={
    fixture:Fixture;leg:SlipLeg;bookmaker:string|null;exactPrice:number|null;
    fairPrice:number;marketVerified:boolean
  }
  const candidates:Candidate[]=[]
  const seen=new Set<string>()
  for(const rec of recommendations){
    if(rec.fixture.id!==fixtureId)continue
    for(const leg of rec.slip.legs??[]){
      const p=Math.max(.01,Math.min(.99,Number(leg.probability??0)))
      if(p<.12||leg.confidence==="D")continue
      const fair=Number(leg.fairOdds??(1/p))
      if(!Number.isFinite(fair)||fair<=1)continue
      const book=leg.bookmakerName??rec.slip.bookmaker??null
      const exact=leg.bookmakerOdds!=null&&leg.priceSource!=="estimated"?Number(leg.bookmakerOdds):null
      const key=[leg.player,leg.market,leg.label,book??"model"].join("|")
      if(seen.has(key))continue
      seen.add(key)
      candidates.push({
        fixture:rec.fixture,leg,bookmaker:book,exactPrice:exact,fairPrice:fair,
        marketVerified:Boolean(rec.placeable&&book&&exact),
      })
    }
  }

  function search(targetDecimal:number,bookmaker:string|null){
    type State={legs:Candidate[];odds:number;prob:number;players:Set<string>}
    let states:State[]=[{legs:[],odds:1,prob:1,players:new Set()}]
    const pool=candidates
      .filter(x=>bookmaker?x.bookmaker===bookmaker&&x.exactPrice!=null:true)
      .sort((a,b)=>b.leg.probability-a.leg.probability)
      .slice(0,24)

    for(const option of pool){
      const next=[...states]
      for(const state of states){
        if(state.legs.length>=8||state.players.has(option.leg.player))continue
        const price=bookmaker?option.exactPrice:option.fairPrice
        if(price==null)continue
        const odds=state.odds*price
        if(odds>targetDecimal*1.65&&state.legs.length>=1)continue
        next.push({
          legs:[...state.legs,option],
          odds,
          prob:state.prob*option.leg.probability,
          players:new Set([...state.players,option.leg.player]),
        })
      }
      const score=(s:State)=>{
        if(!s.legs.length)return 999
        const distance=Math.abs(Math.log(Math.max(1.01,s.odds))-Math.log(targetDecimal))
        const minProb=Math.min(...s.legs.map(x=>x.leg.probability))
        const avgProb=s.legs.reduce((sum,x)=>sum+x.leg.probability,0)/s.legs.length
        const confidence=s.legs.filter(x=>x.leg.confidence==="A"||x.leg.confidence==="B").length/s.legs.length
        return distance*2.45-avgProb*.48-minProb*.18-confidence*.08+s.legs.length*.01
      }
      states=next.sort((a,b)=>score(a)-score(b)).slice(0,420)
    }
    const acceptable=states.filter(s=>s.legs.length>=2&&s.odds>=targetDecimal*.76&&s.odds<=targetDecimal*1.32)
    if(!acceptable.length)return null
    return acceptable.sort((a,b)=>{
      const da=Math.abs(Math.log(a.odds)-Math.log(targetDecimal))
      const db=Math.abs(Math.log(b.odds)-Math.log(targetDecimal))
      if(Math.abs(da-db)>.02)return da-db
      return b.prob-a.prob
    })[0]
  }

  return TARGET_ODDS.map(target=>{
    let chosen:{legs:Candidate[];odds:number;prob:number;players:Set<string>}|null=null
    let chosenBook:string|null=null
    for(const book of TARGET_BOOKS){
      const result=search(target.decimal,book)
      if(!result)continue
      if(!chosen||result.prob>chosen.prob){chosen=result;chosenBook=book}
    }
    let source:"bookmaker-singles"|"model"|null=chosen?"bookmaker-singles":null
    if(!chosen){
      chosen=search(target.decimal,null)
      chosenBook=null
      source=chosen?"model":null
    }
    if(!chosen)return {
      id:"target-"+fixtureId+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,
      available:false,referenceOdds:null,modelAllHitProbability:null,bookmaker:null,
      priceSource:null,marketsVerified:false,legs:[],
      note:"Not enough strong legs in this match to reach the target without forcing weaker selections.",
    }
    const legs:TargetOddsLeg[]=chosen.legs.map(x=>{
      const price=source==="bookmaker-singles"?Number(x.exactPrice):x.fairPrice
      return {
        fixtureId:x.fixture.id,competition:x.fixture.competition,kickoff:x.fixture.kickoff,
        home:x.fixture.home.name,away:x.fixture.away.name,player:x.leg.player,team:x.leg.team,
        market:x.leg.market,label:x.leg.label,probability:x.leg.probability,
        price:Math.round(price*100)/100,priceSource:source==="bookmaker-singles"?"exact":"model",
        bookmaker:chosenBook,confidence:x.leg.confidence,
      }
    })
    const marketsVerified=source==="bookmaker-singles"&&chosen.legs.every(x=>x.marketVerified&&x.bookmaker===chosenBook)
    return {
      id:"target-"+fixtureId+"-"+target.fractional.replace("/","-"),
      targetFractional:target.fractional,targetDecimal:target.decimal,available:true,
      referenceOdds:Math.round(chosen.odds*100)/100,
      modelAllHitProbability:Math.round(chosen.prob*10000)/10000,
      bookmaker:chosenBook,priceSource:source,marketsVerified,legs,
      note:source==="bookmaker-singles"
        ? "Uses exact individual "+chosenBook+" prices as a reference. The final same-game Bet Builder price can differ because the bookmaker applies correlation."
        : "Uses model fair prices as a guide. Add these legs in your bookmaker and check the actual same-game Builder price before placing.",
    }
  })
}

function buildTargetOddsGames(recommendations:Recommendation[]):TargetOddsGame[]{
  const fixtures=new Map<string,Fixture>()
  for(const rec of recommendations)fixtures.set(rec.fixture.id,rec.fixture)
  return [...fixtures.values()]
    .sort((a,b)=>a.kickoff.localeCompare(b.kickoff))
    .map(fixture=>({fixture,targets:buildTargetOddsSlips(recommendations,fixture.id)}))
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
      if(market==="card"&&stat&&stat.foulsCommitted>0){
        const player=(scorecard.players??[]).find(p=>normName(p.name)===normName(leg.player)||normName(String(p.dbName??""))===normName(leg.player))
        const cond=stat.foulsCommitted>=3?player?.yellowConditionals?.after3PlusFouls
          :stat.foulsCommitted>=2?player?.yellowConditionals?.after2PlusFouls
          :player?.yellowConditionals?.after1PlusFouls
        const overall=player?.yellowConditionals?.overall
        if(cond?.rate!=null&&Number(overall?.rate)>0&&Number(cond.matches??0)>=4){
          const multiplier=Math.max(.75,Math.min(1.8,Number(cond.rate)/Number(overall!.rate)))
          probability=Math.max(.001,Math.min(.99,probability*multiplier))
          pressureNote=" Live foul pressure adjusted from the player's historical card-after-foul profile."
        }
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
    const officialLineup=await officialLineupForFixture(f)
    if(!officialLineup.confirmed){
      return {
        ok:true,
        lineupsConfirmed:false,
        eligibleBooks:[],
        marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},
        slips:[],previewSlips:[],foulTargetSlips:[],previewFoulTargetSlips:[],
      }
    }
    if(f.competition==="International"){
      const profiles=(await internationalPlayersForFixture(f.home.name,f.away.name))
        .filter((p:any)=>officialLineup.starters.has(normName(String(p?.name??""))))
      if(!profiles.length)return null
      const scored=profiles.map((p:any)=>{
        const intl=p?.international??{}
        const current=p?.domesticCurrent??null
        const previous=p?.domesticPrevious??null
        const appearances=Number(current?.appearances??0)+Number(intl?.matches??0)
        const starts=Number(current?.starts??0)+Number(intl?.starts??0)
        const expectedMinutes=Math.max(45,Math.min(90,appearances>0?60+30*(starts/appearances):65))
        const foulRate=Math.max(0,Number(p?.blended?.fouls90??current?.fouls90??intl?.fouls90??0))
        const cardRateParts=[
          current?Number(current.cards90??0):null,
          Number(intl.cards90??0),
          previous?Number(previous.cards90??0):null,
        ].filter((v:any)=>Number.isFinite(v)&&v!=null) as number[]
        const cardRate=cardRateParts.length?cardRateParts.reduce((a,b)=>a+b,0)/cardRateParts.length:0
        const rawFoul=1-Math.exp(-foulRate*(expectedMinutes/90))
        const rawCard=1-Math.exp(-cardRate*(expectedMinutes/90))
        const foul=calibrateSnapshot("foul1",Math.max(.01,Math.min(.99,rawFoul)))
        const card=calibrateSnapshot("card",Math.max(.01,Math.min(.99,rawCard)))
        const confidence:SlipLeg["confidence"]=appearances>=12&&expectedMinutes>=65?"B":appearances>=6?"C":"D"
        return {p,foul,card,confidence,expectedMinutes}
      }).filter((x:any)=>x.confidence!=="D")
      const foulLegs=scored.sort((a:any,b:any)=>b.foul-a.foul).slice(0,4).map((x:any)=>({
        player:String(x.p.name),dbPlayerName:String(x.p.name),team:String(x.p.nationalTeam),market:"foul1",
        label:"1+ foul committed",probability:Math.round(x.foul*1000)/1000,fairOdds:Math.round((1/x.foul)*100)/100,
        bookmakerOdds:null,bookmakerName:null,edge:null,confidence:x.confidence,
        reason:"International snapshot fallback: blended current domestic + international foul rate",priceSource:null,
      } as SlipLeg))
      const cardLegs=scored.sort((a:any,b:any)=>b.card-a.card).slice(0,3).map((x:any)=>({
        player:String(x.p.name),dbPlayerName:String(x.p.name),team:String(x.p.nationalTeam),market:"card",
        label:"Yellow card",probability:Math.round(x.card*1000)/1000,fairOdds:Math.round((1/x.card)*100)/100,
        bookmakerOdds:null,bookmakerName:null,edge:null,confidence:x.confidence,
        reason:"International snapshot fallback: blended current domestic + international card rate",priceSource:null,
      } as SlipLeg))
      const slips:BetSlip[]=[]
      if(foulLegs.length>=2)slips.push({id:"intl-snapshot-fouls",title:"International foul picks",risk:"model-only",legs:foulLegs,averageLegProbability:foulLegs.reduce((s,l)=>s+l.probability,0)/foulLegs.length,placeable:false,marketAvailability:foulLegs.map(l=>({player:l.player,market:l.market,status:"unknown" as MarketStatus}))})
      if(cardLegs.length>=2)slips.push({id:"intl-snapshot-cards",title:"International card picks",risk:"model-only",legs:cardLegs,averageLegProbability:cardLegs.reduce((s,l)=>s+l.probability,0)/cardLegs.length,placeable:false,marketAvailability:cardLegs.map(l=>({player:l.player,market:l.market,status:"unknown" as MarketStatus}))})
      return {ok:true,lineupsConfirmed:true,eligibleBooks:[],marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},slips,previewSlips:[],foulTargetSlips:[],previewFoulTargetSlips:[]}
    }

    const snapshot=await snapshotPlayersForFixture(f.competition,f.home.name,f.away.name)
    const players=snapshot.players.filter(p=>officialLineup.starters.has(normName(p.player_name)))
    const rows=snapshot.rows
    const before=rows.filter(r=>r.match_date<fixtureDate(f))
    if(!players.length||!before.length)return null
    const scored=players.map(p=>{
      const history=before.filter(r=>r.player_name===p.player_name)
      if(history.length<3)return null
      const recent=history.slice(-5)
      const foulHits=history.filter(r=>r.fouls_committed>=1).length
      const cardHits=history.filter(r=>r.yellow_card).length
      const recentFoul=recent.filter(r=>r.fouls_committed>=1).length
      const recentCard=recent.filter(r=>r.yellow_card).length
      const rawFoul=beta(foulHits,history.length,.50,6)*.72+beta(recentFoul,recent.length,.50,4)*.28
      const rawCard=beta(cardHits,history.length,.20,7)*.72+beta(recentCard,recent.length,.20,4)*.28
      const foul=calibrateSnapshot("foul1",Math.max(.01,Math.min(.99,rawFoul)))
      const card=calibrateSnapshot("card",Math.max(.01,Math.min(.99,rawCard)))
      const confidence:SlipLeg["confidence"]=history.length>=10&&p.minutes>=600?"B":history.length>=5?"C":"D"
      return {p,history,foul,card,confidence}
    }).filter(Boolean) as Array<{p:any;history:any[];foul:number;card:number;confidence:SlipLeg["confidence"]}>
    const foulLegs=scored.sort((a,b)=>b.foul-a.foul).slice(0,4).map(x=>({
      player:x.p.player_name,dbPlayerName:x.p.player_name,team:x.p.team,market:"foul1",
      label:"1+ foul committed",probability:Math.round(x.foul*1000)/1000,fairOdds:Math.round((1/x.foul)*100)/100,
      bookmakerOdds:null,bookmakerName:null,edge:null,confidence:x.confidence,
      reason:"Repository snapshot fallback: season + recent foul history",priceSource:null,
    } as SlipLeg))
    const cardLegs=scored.sort((a,b)=>b.card-a.card).slice(0,3).map(x=>({
      player:x.p.player_name,dbPlayerName:x.p.player_name,team:x.p.team,market:"card",
      label:"Yellow card",probability:Math.round(x.card*1000)/1000,fairOdds:Math.round((1/x.card)*100)/100,
      bookmakerOdds:null,bookmakerName:null,edge:null,confidence:x.confidence,
      reason:"Repository snapshot fallback: season + recent booking history",priceSource:null,
    } as SlipLeg))
    const slips:BetSlip[]=[]
    if(foulLegs.length>=2)slips.push({id:"snapshot-fouls",title:"Snapshot foul picks",risk:"model-only",legs:foulLegs,averageLegProbability:foulLegs.reduce((s,l)=>s+l.probability,0)/foulLegs.length,placeable:false,marketAvailability:foulLegs.map(l=>({player:l.player,market:l.market,status:"unknown" as MarketStatus}))})
    if(cardLegs.length>=2)slips.push({id:"snapshot-cards",title:"Snapshot card picks",risk:"model-only",legs:cardLegs,averageLegProbability:cardLegs.reduce((s,l)=>s+l.probability,0)/cardLegs.length,placeable:false,marketAvailability:cardLegs.map(l=>({player:l.player,market:l.market,status:"unknown" as MarketStatus}))})
    return {ok:true,lineupsConfirmed:officialLineup.confirmed,eligibleBooks:[],marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},slips:officialLineup.confirmed?slips:[],previewSlips:officialLineup.confirmed?[]:slips,foulTargetSlips:[],previewFoulTargetSlips:[]}
  }catch{return null}
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const refresh=url.searchParams.get("refresh")==="1"
  const maxFixtures=Math.max(6,Math.min(24,Number(url.searchParams.get("limit")??18)||18))

  try{
    try{await gradeHistoricalRecommendations(500)}catch{}
    let trackingBefore:any={available:false,topPickLegs:0}
    try{trackingBefore=await recommendationTrackingSummary(30)}catch{}
    const liveTopSample=Number(trackingBefore?.topPickLegs??0)
    const liveTopHit=Number(trackingBefore?.topPickHitRate??0)
    const liveTopModel=Number(trackingBefore?.topPickAvgProbability??0)
    const liveReliabilityFactor=liveTopSample>=50&&liveTopModel>0
      ? Math.max(.82,Math.min(1.05,liveTopHit/liveTopModel))
      : 1

    const dates=[londonDate(0)]
    const fixtureResponses=await Promise.all(dates.map(date=>fixturesFor(date,refresh)))
    const fixtureMap=new Map<string,Fixture>()
    for(const data of fixtureResponses){
      if(!data)continue
      for(const competition of competitions){
        for(const f of data.leagues?.[competition]??[])fixtureMap.set(String(f.id),f)
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
      const liveResponse=await matchAccaGET(new Request("http://local/api/match-acca?date="+londonDate(0)+(refresh?"&refresh="+Date.now():"")))
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

    const rows=await Promise.all(upcoming.map(async fixture=>{
      try{
        let scorecard=await scorecardFor(fixture,refresh)
        if(!scorecard?.ok)scorecard=await fallbackScorecard(fixture)
        if(!scorecard?.ok)return [] as Recommendation[]
        const minutesToKickoff=(new Date(fixture.kickoff).getTime()-Date.now())/60000
        const officialLineup=minutesToKickoff<=120?await officialLineupForFixture(fixture):{confirmed:false,starters:new Set<string>()}
        const confirmed=officialLineup.confirmed||Boolean(scorecard.lineupsConfirmed)
        // Recommended is confirmed-XI only. Never promote preview/expected-player
        // slips into the betting feed.
        if(!confirmed)return [] as Recommendation[]
        const rawStandards=scorecard.slips??[]
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
          })
        }
        return candidates
      }catch{return [] as Recommendation[]}
    }))

    const allRecommendations=rows.flat().sort((a,b)=>b.rank-a.rank)
    const recommendations=allRecommendations.slice(0,8)
    const targetOddsGames=buildTargetOddsGames(allRecommendations)
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
    let tracking:any=trackingBefore
    try{tracking=await recommendationTrackingSummary(30)}catch{}

    const payload={
      ok:true,
      updatedAt:new Date().toISOString(),
      fixturesScanned:upcoming.length+liveFixtures.length,
      recommendations,
      liveMatches,
      targetOddsGames,
      tracking,
      staleFallback:false,
      methodology:{
        recommendationCalibration:"Final ranking uses a second walk-forward calibration layer built from historical recommendations that survived the selection process.",
        cache:"Recommended scans today only and is served from one server endpoint with a five-minute shared-cache target; manual refresh bypasses the normal scan cadence.",
        tracking:"Recommendations are saved before kickoff and graded later from imported player-match data. Model-only recommendations remain visible when bookmaker verification is missing; only verified same-bookmaker markets are marked placeable.",
        targetOdds:"Select a match, then 5/1 through 50/1 same-game targets search the strongest recommended legs for that fixture only. Exact individual same-bookmaker prices are preferred as a reference, but the final Bet Builder quote can differ because of correlation.",
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
