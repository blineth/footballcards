import { NextResponse } from "next/server"
import { GET as fixturesGET } from "../fixtures/route"
import { GET as scorecardGET } from "../fixture-scorecard/route"
import { gradeHistoricalRecommendations, recommendationTrackingSummary, saveRecommendationSnapshots } from "@/lib/recommendation-tracking"
import recommendationBacktest from "@/data/model/recommendation-backtest.json"
import calibrationSnapshot from "@/data/model/calibration.json"
import { snapshotPlayersForFixture, internationalPlayersForFixture } from "@/lib/current-season-snapshot"

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
  try{
    const q=new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition})
    if(refresh)q.set("refresh",String(Date.now()))
    const res=await scorecardGET(new Request("http://local/api/fixture-scorecard?"+q.toString()))
    return res.ok?await res.json() as Scorecard:null
  }catch{return null}
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
    if(f.competition==="International"){
      const profiles=await internationalPlayersForFixture(f.home.name,f.away.name)
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
      return {ok:true,lineupsConfirmed:false,eligibleBooks:[],marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},previewSlips:slips,previewFoulTargetSlips:[]}
    }

    const {players,rows}=await snapshotPlayersForFixture(f.competition,f.home.name,f.away.name)
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
    return {ok:true,lineupsConfirmed:false,eligibleBooks:[],marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},previewSlips:slips,previewFoulTargetSlips:[]}
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
      fixturesScanned:upcoming.length,
      recommendations,
      tracking,
      staleFallback:false,
      methodology:{
        recommendationCalibration:"Final ranking uses a second walk-forward calibration layer built from historical recommendations that survived the selection process.",
        cache:"Recommended scans today only and is served from one server endpoint with a five-minute shared-cache target; manual refresh bypasses the normal scan cadence.",
        tracking:"Recommendations are saved before kickoff and graded later from imported player-match data. Model-only recommendations remain visible when bookmaker verification is missing; only verified same-bookmaker markets are marked placeable.",
        liveFeedback:liveTopSample>=50
          ? "Live top-pick calibration is active. Current 30-day reliability multiplier: "+liveReliabilityFactor.toFixed(3)
          : "Live top-pick calibration activates after 50 graded top-pick legs.",
      },
    }
    lastGoodRecommended=payload
    lastGoodAt=Date.now()
    return NextResponse.json(payload,{
      headers:refresh
        ?{"Cache-Control":"public, s-maxage=30, stale-while-revalidate=300"}
        :{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=1800"},
    })
  }catch(error){
    if(lastGoodRecommended&&Date.now()-lastGoodAt<STALE_CACHE_MS){
      return NextResponse.json({...lastGoodRecommended,staleFallback:true,warning:"Fresh pull failed; showing the last successful Recommended snapshot."},{headers:{"Cache-Control":"public, s-maxage=60, stale-while-revalidate=1800"}})
    }
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Recommended scan failed"},{status:500})
  }
}
