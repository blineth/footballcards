import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { gradeHistoricalRecommendations, recommendationTrackingSummary, saveRecommendationSnapshots } from "@/lib/recommendation-tracking"
import recommendationBacktest from "@/data/model/recommendation-backtest.json"

export const dynamic="force-dynamic"
export const revalidate=300

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"
type Fixture={
  id:string;competition:Competition;tournament?:string;kickoff:string;status?:string;
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
type Scorecard={
  ok:boolean;lineupsConfirmed?:boolean;eligibleBooks?:string[];
  marketAvailability?:{card:MarketStatus;foul:MarketStatus;fouled:MarketStatus;shot:MarketStatus;sot:MarketStatus};
  slips?:BetSlip[];previewSlips?:BetSlip[];foulTargetSlips?:FoulTargetSlip[];previewFoulTargetSlips?:FoulTargetSlip[]
}
type Recommendation={
  id:string;fixture:Fixture;slip:BetSlip|FoulTargetSlip;confirmed:boolean;kind:"standard"|"foul";
  rank:number;placeable:boolean;blockedReason:string|null;recommendationReliability:number|null
}

const competitions:Competition[]=["Premier League","Championship","League One","League Two","International"]

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
  const q=new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition})
  if(refresh)q.set("refresh",String(Date.now()))
  const res=await scorecardGET(new Request("http://local/api/fixture-scorecard?"+q.toString()))
  return res.ok?await res.json() as Scorecard:null
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const refresh=url.searchParams.get("refresh")==="1"
  const maxFixtures=Math.max(6,Math.min(24,Number(url.searchParams.get("limit")??18)||18))

  try{
    await gradeHistoricalRecommendations(500)
    const trackingBefore:any=await recommendationTrackingSummary(30)
    const liveTopSample=Number(trackingBefore?.topPickLegs??0)
    const liveTopHit=Number(trackingBefore?.topPickHitRate??0)
    const liveTopModel=Number(trackingBefore?.topPickAvgProbability??0)
    const liveReliabilityFactor=liveTopSample>=50&&liveTopModel>0
      ? Math.max(.82,Math.min(1.05,liveTopHit/liveTopModel))
      : 1

    const dates=[londonDate(0),londonDate(1),londonDate(2)]
    const fixtureResponses=await Promise.all(dates.map(date=>fixturesFor(date,refresh)))
    const fixtureMap=new Map<string,Fixture>()
    for(const data of fixtureResponses){
      if(!data)continue
      for(const competition of competitions){
        for(const f of data.leagues?.[competition]??[])fixtureMap.set(String(f.id),f)
      }
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
        const scorecard=await scorecardFor(fixture,refresh)
        if(!scorecard?.ok)return [] as Recommendation[]
        const confirmed=Boolean(scorecard.lineupsConfirmed)
        const standards=confirmed?(scorecard.slips??[]):(scorecard.previewSlips??[])
        const fouls=confirmed?(scorecard.foulTargetSlips??[]):(scorecard.previewFoulTargetSlips??[])
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

    const recommendations=rows.flat().sort((a,b)=>b.rank-a.rank).slice(0,8)
    await saveRecommendationSnapshots(recommendations.map((rec,index)=>({
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
    })))
    const tracking=await recommendationTrackingSummary(30)

    return NextResponse.json({
      ok:true,
      updatedAt:new Date().toISOString(),
      fixturesScanned:upcoming.length,
      recommendations,
      tracking,
      methodology:{
        recommendationCalibration:"Final ranking uses a second walk-forward calibration layer built from historical recommendations that survived the selection process.",
        cache:"Recommended is served from one server endpoint with a five-minute shared-cache target; manual refresh bypasses the normal scan cadence.",
        tracking:"Recommendations are saved before kickoff and graded later from imported player-match data. Model-only recommendations remain visible when bookmaker verification is missing; only verified same-bookmaker markets are marked placeable.",
        liveFeedback:liveTopSample>=50
          ? "Live top-pick calibration is active. Current 30-day reliability multiplier: "+liveReliabilityFactor.toFixed(3)
          : "Live top-pick calibration activates after 50 graded top-pick legs.",
      },
    },{
      headers:refresh
        ?{"Cache-Control":"no-store"}
        :{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=300"},
    })
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Recommended scan failed"},{status:500})
  }
}
