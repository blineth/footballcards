import calibrationSnapshot from "@/data/model/calibration.json"
import { internationalPlayersForFixture, snapshotPlayersForFixture } from "@/lib/current-season-snapshot"

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"

const ESPN_INTL_SLUGS=[
  "uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa",
  "fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf",
  "uefa.euro","uefa.euroq",
]
const ESPN_LEAGUE_SLUGS:Partial<Record<Competition,string>>={
  "Premier League":"eng.1",
  Championship:"eng.2",
  "League One":"eng.3",
  "League Two":"eng.4",
}

function normName(value:string){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
}
function sameTeamName(a:string,b:string){
  const x=normName(a).replace(/\b(afc|fc)\b/g,"").trim()
  const y=normName(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function beta(hits:number,total:number,prior:number,strength=6){
  return (hits+prior*strength)/(total+strength)
}
function calibrateSnapshot(market:"foul1"|"fouled1"|"card"|"shot1"|"sot1",raw:number){
  const source=(calibrationSnapshot as any)?.global?.[market]
  const bands=source?.bands
  if(!Array.isArray(bands)||bands.length!==20)return raw
  const idx=Math.max(0,Math.min(19,Math.floor(Math.max(0,Math.min(.999999,raw))/.05)))
  const value=Number(bands[idx]?.calibratedProbability)
  return Number.isFinite(value)?value:raw
}

export async function confirmedStartersForFixture(input:{
  date:string;home:string;away:string;competition:Competition
}){
  const slugs=input.competition==="International"
    ? ESPN_INTL_SLUGS
    : [ESPN_LEAGUE_SLUGS[input.competition]].filter(Boolean) as string[]
  const ymd=input.date.replaceAll("-","")

  for(const slug of slugs){
    try{
      const scoreboard=await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+ymd+"&limit=300",
        {cache:"no-store",signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}},
      )
      if(!scoreboard.ok)continue
      const data=await scoreboard.json()
      const event=(data?.events??[]).find((e:any)=>{
        const competitors=e?.competitions?.[0]?.competitors??[]
        const home=competitors.find((x:any)=>x.homeAway==="home")
        const away=competitors.find((x:any)=>x.homeAway==="away")
        return sameTeamName(String(home?.team?.displayName??""),input.home)
          && sameTeamName(String(away?.team?.displayName??""),input.away)
      })
      if(!event?.id)continue

      const summaryResponse=await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/summary?event="+event.id,
        {cache:"no-store",signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}},
      )
      if(!summaryResponse.ok)continue
      const summary=await summaryResponse.json()
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
      return {confirmed:homeCount>=11&&awayCount>=11,starters,source:"ESPN"}
    }catch{}
  }
  return {confirmed:false,starters:new Set<string>(),source:null}
}

function leg(input:{
  player:string;team:string;market:"foul1"|"fouled1"|"card"|"shot1"|"sot1";label:string;probability:number;
  confidence:"A"|"B"|"C"|"D";reason:string
}){
  const probability=Math.max(.01,Math.min(.99,input.probability))
  return {
    player:input.player,
    dbPlayerName:input.player,
    team:input.team,
    market:input.market,
    label:input.label,
    probability:Math.round(probability*1000)/1000,
    fairOdds:Math.round((1/probability)*100)/100,
    bookmakerOdds:null,
    bookmakerName:null,
    edge:null,
    confidence:input.confidence,
    reason:input.reason,
    priceSource:null,
  }
}

function slip(id:string,title:string,legs:any[],note:string){
  return {
    id,
    title,
    risk:"model-only",
    legs,
    averageLegProbability:legs.length?legs.reduce((sum:number,row:any)=>sum+row.probability,0)/legs.length:null,
    note,
    placeable:false,
    marketAvailability:legs.map((row:any)=>({player:row.player,market:row.market,status:"unknown"})),
  }
}

function baseResponse(confirmed:boolean){
  return {
    ok:true,
    lineupsConfirmed:confirmed,
    status:confirmed?"confirmed-lineup-snapshot-fallback":"waiting-for-confirmed-lineup",
    snapshotFallback:true,
    fallbackReason:"Live research database is temporarily unavailable; using the checked-in player snapshot.",
    bookmaker:null,
    oddsSource:null,
    oddsCapturedAt:null,
    oddsAgeSeconds:null,
    oddsFreshness:"UNKNOWN",
    freeTier:true,
    marketAvailability:{card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},
    bookmakerAvailability:{},
    eligibleBooks:[],
    priceAvailable:false,
    referee:null,
    exactCardOffers:[],
    exactFoulOffers:[],
    estimatedFoulOffers:[],
    foulTargetSlips:[],
    previewFoulTargetSlips:[],
    previewSlips:[],
    generatedAt:new Date().toISOString(),
  }
}

export async function buildSnapshotScorecard(input:{
  date:string;home:string;away:string;competition:Competition
}){
  const official=await confirmedStartersForFixture(input)
  if(!official.confirmed){
    return {...baseResponse(false),playerCount:0,players:[],slips:[]}
  }

  if(input.competition==="International"){
    const profiles=(await internationalPlayersForFixture(input.home,input.away))
      .filter((p:any)=>official.starters.has(normName(String(p?.name??""))))

    const scored=profiles.map((p:any)=>{
      const intl=p?.international??{}
      const current=p?.domesticCurrent??null
      const previous=p?.domesticPrevious??null
      const appearances=Number(current?.appearances??0)+Number(intl?.matches??0)
      const starts=Number(current?.starts??0)+Number(intl?.starts??0)
      const expectedMinutes=Math.max(45,Math.min(90,appearances>0?60+30*(starts/appearances):65))
      const blended=p?.blended??{}
      const foulRate=Math.max(0,Number(blended?.fouls90??current?.fouls90??intl?.fouls90??previous?.fouls90??0))
      const fouledRate=Math.max(0,Number(blended?.fouled90??current?.fouled90??intl?.fouled90??previous?.fouled90??0))
      const shotsRate=Math.max(0,Number(blended?.shots90??current?.shots90??intl?.shots90??previous?.shots90??0))
      const sotRate=Math.max(0,Number(blended?.shotsOnTarget90??blended?.sot90??current?.shotsOnTarget90??current?.sot90??intl?.shotsOnTarget90??intl?.sot90??previous?.shotsOnTarget90??previous?.sot90??0))
      const cardRates=[
        current?Number(current.cards90??0):null,
        Number(intl.cards90??0),
        previous?Number(previous.cards90??0):null,
      ].filter((v:any)=>v!=null&&Number.isFinite(v)) as number[]
      const cardRate=cardRates.length?cardRates.reduce((a,b)=>a+b,0)/cardRates.length:0
      const minutesScale=expectedMinutes/90
      const foul=calibrateSnapshot("foul1",1-Math.exp(-foulRate*minutesScale))
      const fouled=calibrateSnapshot("fouled1",1-Math.exp(-fouledRate*minutesScale))
      const shot=calibrateSnapshot("shot1",1-Math.exp(-shotsRate*minutesScale))
      const sot=calibrateSnapshot("sot1",1-Math.exp(-sotRate*minutesScale))
      const card=calibrateSnapshot("card",1-Math.exp(-cardRate*minutesScale))
      const confidence:"A"|"B"|"C"|"D"=appearances>=12&&expectedMinutes>=65?"B":appearances>=6?"C":"D"
      return {p,foul,fouled,shot,sot,card,confidence}
    }).filter((x:any)=>x.confidence!=="D")

    const foulLegs=[...scored].sort((a:any,b:any)=>b.foul-a.foul).slice(0,4).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"foul1",label:"1+ foul committed",
      probability:x.foul,confidence:x.confidence,
      reason:"Confirmed-XI snapshot fallback: blended current domestic and international foul rate.",
    }))
    const fouledLegs=[...scored].sort((a:any,b:any)=>b.fouled-a.fouled).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"fouled1",label:"1+ foul drawn",
      probability:x.fouled,confidence:x.confidence,
      reason:"Confirmed-XI snapshot fallback: blended current domestic and international fouls-drawn rate.",
    }))
    const shotLegs=[...scored].sort((a:any,b:any)=>b.shot-a.shot).slice(0,4).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"shot1",label:"1+ shot",
      probability:x.shot,confidence:x.confidence,
      reason:"Confirmed-XI snapshot fallback: blended current domestic and international shot rate.",
    }))
    const sotLegs=[...scored].sort((a:any,b:any)=>b.sot-a.sot).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"sot1",label:"1+ shot on target",
      probability:x.sot,confidence:x.confidence,
      reason:"Confirmed-XI snapshot fallback: blended current domestic and international shot-on-target rate.",
    }))
    const cardLegs=[...scored].sort((a:any,b:any)=>b.card-a.card).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"card",label:"Yellow card",
      probability:x.card,confidence:x.confidence,
      reason:"Confirmed-XI snapshot fallback: blended domestic, international and prior-season booking rate.",
    }))

    const slips:any[]=[]
    if(foulLegs.length>=2)slips.push(slip("intl-snapshot-fouls","Confirmed XI foul picks",foulLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(fouledLegs.length>=2)slips.push(slip("intl-snapshot-fouled","Confirmed XI fouled picks",fouledLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(shotLegs.length>=2)slips.push(slip("intl-snapshot-shots","Confirmed XI shot picks",shotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(sotLegs.length>=2)slips.push(slip("intl-snapshot-sot","Confirmed XI SOT picks",sotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(cardLegs.length>=2)slips.push(slip("intl-snapshot-cards","Confirmed XI card picks",cardLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))

    return {
      ...baseResponse(true),
      playerCount:profiles.length,
      players:profiles.map((p:any)=>({name:p.name,team:p.nationalTeam})),
      slips,
    }
  }

  const snapshot=await snapshotPlayersForFixture(input.competition,input.home,input.away)
  const players=snapshot.players.filter(p=>official.starters.has(normName(p.player_name)))
  const before=snapshot.rows.filter(row=>row.match_date<input.date)
  const scored=players.map(p=>{
    const history=before.filter(row=>row.player_name===p.player_name).sort((a,b)=>a.match_date.localeCompare(b.match_date))
    if(history.length<3)return null
    const recent=history.slice(-5)
    const foulHits=history.filter(row=>row.fouls_committed>=1).length
    const fouledHits=history.filter(row=>row.fouls_drawn>=1).length
    const shotHits=history.filter(row=>row.shots>=1).length
    const sotHits=history.filter(row=>row.shots_on_target>=1).length
    const cardHits=history.filter(row=>row.yellow_card).length
    const recentFoul=recent.filter(row=>row.fouls_committed>=1).length
    const recentFouled=recent.filter(row=>row.fouls_drawn>=1).length
    const recentShot=recent.filter(row=>row.shots>=1).length
    const recentSot=recent.filter(row=>row.shots_on_target>=1).length
    const recentCard=recent.filter(row=>row.yellow_card).length
    const foul=calibrateSnapshot("foul1",beta(foulHits,history.length,.50,6)*.72+beta(recentFoul,recent.length,.50,4)*.28)
    const fouled=calibrateSnapshot("fouled1",beta(fouledHits,history.length,.45,6)*.72+beta(recentFouled,recent.length,.45,4)*.28)
    const shot=calibrateSnapshot("shot1",beta(shotHits,history.length,.58,6)*.72+beta(recentShot,recent.length,.58,4)*.28)
    const sot=calibrateSnapshot("sot1",beta(sotHits,history.length,.32,6)*.72+beta(recentSot,recent.length,.32,4)*.28)
    const card=calibrateSnapshot("card",beta(cardHits,history.length,.20,7)*.72+beta(recentCard,recent.length,.20,4)*.28)
    const confidence:"A"|"B"|"C"|"D"=history.length>=10&&p.minutes>=600?"B":history.length>=5?"C":"D"
    return {p,foul,fouled,shot,sot,card,confidence}
  }).filter(Boolean) as Array<{p:any;foul:number;fouled:number;shot:number;sot:number;card:number;confidence:"A"|"B"|"C"|"D"}>

  const foulLegs=[...scored].sort((a,b)=>b.foul-a.foul).slice(0,4).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"foul1",label:"1+ foul committed",
    probability:x.foul,confidence:x.confidence,
    reason:"Confirmed-XI snapshot fallback: season and recent foul history.",
  }))
  const fouledLegs=[...scored].sort((a,b)=>b.fouled-a.fouled).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"fouled1",label:"1+ foul drawn",
    probability:x.fouled,confidence:x.confidence,
    reason:"Confirmed-XI snapshot fallback: season and recent fouls-drawn history.",
  }))
  const shotLegs=[...scored].sort((a,b)=>b.shot-a.shot).slice(0,4).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"shot1",label:"1+ shot",
    probability:x.shot,confidence:x.confidence,
    reason:"Confirmed-XI snapshot fallback: season and recent shot history.",
  }))
  const sotLegs=[...scored].sort((a,b)=>b.sot-a.sot).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"sot1",label:"1+ shot on target",
    probability:x.sot,confidence:x.confidence,
    reason:"Confirmed-XI snapshot fallback: season and recent shot-on-target history.",
  }))
  const cardLegs=[...scored].sort((a,b)=>b.card-a.card).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"card",label:"Yellow card",
    probability:x.card,confidence:x.confidence,
    reason:"Confirmed-XI snapshot fallback: season and recent booking history.",
  }))

  const slips:any[]=[]
  if(foulLegs.length>=2)slips.push(slip("snapshot-fouls","Confirmed XI foul picks",foulLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(fouledLegs.length>=2)slips.push(slip("snapshot-fouled","Confirmed XI fouled picks",fouledLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(shotLegs.length>=2)slips.push(slip("snapshot-shots","Confirmed XI shot picks",shotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(sotLegs.length>=2)slips.push(slip("snapshot-sot","Confirmed XI SOT picks",sotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(cardLegs.length>=2)slips.push(slip("snapshot-cards","Confirmed XI card picks",cardLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))

  return {
    ...baseResponse(true),
    playerCount:players.length,
    players:players.map(p=>({name:p.player_name,team:p.team})),
    slips,
  }
}
