import calibrationSnapshot from "@/data/model/calibration.json"
import { internationalPlayersForFixture, snapshotPlayersForFixture } from "@/lib/current-season-snapshot"
import { getPredictedFixture, normalisePredictedName } from "@/lib/predicted-lineups"

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
function reliability(minutes:number,full:number){
  return Math.max(0,Math.min(1,Number(minutes||0)/full))
}
function blendedRate(input:{
  international:any;current:any;previous:any;key:string;prior:number;cap:number
}){
  const sources=[
    {row:input.international,weight:.25*reliability(Number(input.international?.minutes??0),900)},
    {row:input.current,weight:.60*reliability(Number(input.current?.minutes??0),1800)},
    {row:input.previous,weight:.15*reliability(Number(input.previous?.minutes??0),1800)},
  ]
  let weighted=0,total=0
  for(const source of sources){
    const value=Number(source.row?.[input.key])
    if(!Number.isFinite(value)||value<0||source.weight<=0)continue
    weighted+=Math.min(input.cap,value)*source.weight
    total+=source.weight
  }
  const priorWeight=Math.max(.15,1-Math.min(.85,total))
  return (weighted+input.prior*priorWeight)/(total+priorWeight)
}
function calibrateSnapshot(market:"goal1"|"assist1"|"foul1"|"fouled1"|"card"|"shot1"|"sot1",raw:number){
  const source=(calibrationSnapshot as any)?.global?.[market]
  const bands=source?.bands
  if(!Array.isArray(bands)||bands.length!==20)return raw
  const idx=Math.max(0,Math.min(19,Math.floor(Math.max(0,Math.min(.999999,raw))/.05)))
  const value=Number(bands[idx]?.calibratedProbability)
  return Number.isFinite(value)?value:raw
}
function poissonAtLeastFromOne(p1:number,threshold:number){
  const p=Math.max(.001,Math.min(.995,p1))
  if(threshold<=1)return p
  const lambda=Math.max(.001,-Math.log(1-p))
  let cumulative=0
  let term=Math.exp(-lambda)
  cumulative+=term
  for(let k=1;k<threshold;k++){
    term*=lambda/k
    cumulative+=term
  }
  return Math.max(.001,Math.min(.995,1-cumulative))
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
        {next:{revalidate:300},signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}},
      )
      if(!scoreboard.ok)continue
      const data=await scoreboard.json()
      const event=(data?.events??[]).find((e:any)=>{
        const competitors=e?.competitions?.[0]?.competitors??[]
        const h=competitors.find((x:any)=>x.homeAway==="home")
        const a=competitors.find((x:any)=>x.homeAway==="away")
        return sameTeamName(String(h?.team?.displayName??""),input.home)
          && sameTeamName(String(a?.team?.displayName??""),input.away)
      })
      if(!event?.id)continue

      const competitionRow=event?.competitions?.[0]
      const competitors=competitionRow?.competitors??[]
      const homeCompetitor=competitors.find((x:any)=>x.homeAway==="home")
      const awayCompetitor=competitors.find((x:any)=>x.homeAway==="away")

      const summaryResponse=await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/summary?event="+event.id,
        {next:{revalidate:180},signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}},
      )
      const summary=summaryResponse.ok?await summaryResponse.json():null

      const starters=new Set<string>()
      const homeSquad=new Set<string>()
      const awaySquad=new Set<string>()
      let homeCount=0,awayCount=0

      for(const section of summary?.rosters??[]){
        const target=section.homeAway==="home"?homeSquad:section.homeAway==="away"?awaySquad:null
        if(!target)continue
        for(const row of section?.roster??[]){
          const name=String(row?.athlete?.displayName??row?.athlete?.fullName??"")
          if(!name)continue
          target.add(normName(name))
          if(row?.starter===true){
            starters.add(normName(name))
            if(section.homeAway==="home")homeCount++
            else awayCount++
          }
        }
      }

      const fetchRoster=async(teamId:any,target:Set<string>)=>{
        if(!teamId||target.size>=15)return
        try{
          const response=await fetch(
            "https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/teams/"+teamId+"/roster",
            {next:{revalidate:900},signal:AbortSignal.timeout(5000),headers:{accept:"application/json"}},
          )
          if(!response.ok)return
          const roster=await response.json()
          for(const athlete of roster?.athletes??[]){
            const name=String(athlete?.displayName??athlete?.fullName??"")
            if(name)target.add(normName(name))
          }
        }catch{}
      }
      await Promise.all([
        fetchRoster(homeCompetitor?.team?.id,homeSquad),
        fetchRoster(awayCompetitor?.team?.id,awaySquad),
      ])

      return {
        confirmed:homeCount>=11&&awayCount>=11,
        starters,
        source:"ESPN",
        eventId:String(event.id),
        slug,
        squads:{home:homeSquad,away:awaySquad},
        squadCounts:{home:homeSquad.size,away:awaySquad.size},
      }
    }catch{}
  }
  return {
    confirmed:false,
    starters:new Set<string>(),
    source:null,
    eventId:null,
    slug:null,
    squads:{home:new Set<string>(),away:new Set<string>()},
    squadCounts:{home:0,away:0},
  }
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


function marketRow(input:{
  key:string;label:string;probability:number;confidence:"A"|"B"|"C"|"D";reason:string;
  recent5HitRate?:number;seasonHitRate?:number
}){
  const probability=Math.max(.01,Math.min(.99,input.probability))
  return {
    key:input.key,
    label:input.label,
    probability:Math.round(probability*1000)/1000,
    rawProbability:Math.round(probability*1000)/1000,
    fairOdds:Math.round((1/probability)*100)/100,
    confidence:input.confidence,
    bookmakerOdds:null,
    bookmakerName:null,
    impliedProbability:null,
    edge:null,
    expectedValue:null,
    recent5HitRate:input.recent5HitRate??probability,
    seasonHitRate:input.seasonHitRate??probability,
    h2hHitRate:null,
    reasons:[input.reason],
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
function snapshotSelections(players:any[]){
  const out:any[]=[]
  for(const p of players){
    for(const m of Object.values(p.markets??{}) as any[]){
      if(!m||m.confidence==="D")continue
      out.push({
        id:[p.name,m.key,m.label].join("|").toLowerCase(),
        player:p.name,
        dbPlayerName:p.name,
        team:p.team,
        market:m.key,
        label:m.label,
        probability:Number(m.probability),
        fairOdds:Number(m.fairOdds??(m.probability>0?1/m.probability:0)),
        bookmakerOdds:null,
        bookmakerName:null,
        previousBookmakerOdds:null,
        bookmakerMovement:null,
        edge:null,
        expectedValue:null,
        confidence:m.confidence,
        reason:Array.isArray(m.reasons)?String(m.reasons[0]??"Snapshot model"):String(m.reason??"Snapshot model"),
        priceSource:null,
      })
    }
  }
  return out
}
function buildSnapshotRiskBuilders(players:any[]){
  const rows=snapshotSelections(players)
  const configs=[
    {id:"safe-3-1",title:"Safe 3/1",risk:"Safe",targetFractional:"3/1",targetDecimal:4,minProb:.40,maxLegs:6,minFamilies:1,maxPerFamily:4},
    {id:"balanced-10-1",title:"Balanced 10/1",risk:"Balanced",targetFractional:"10/1",targetDecimal:11,minProb:.15,maxLegs:7,minFamilies:2,maxPerFamily:3},
    {id:"high-20-1",title:"High Risk 20/1+",risk:"High Risk",targetFractional:"20/1+",targetDecimal:21,minProb:.09,maxLegs:8,minFamilies:2,maxPerFamily:3},
  ]
  const family=(market:string)=>market.startsWith("goal")?"goal":market.startsWith("assist")?"assist":market.startsWith("fouled")?"fouled":market.startsWith("foul")?"foul":market.startsWith("sot")?"sot":market.startsWith("shot")?"shot":"card"
  const floor=(market:string)=>{
    if(market==="card")return {green:.20,amber:.14}
    if(market==="goal1")return {green:.32,amber:.18}
    if(market==="assist1")return {green:.24,amber:.14}
    if(market==="shot1")return {green:.72,amber:.48}
    if(market==="sot1")return {green:.42,amber:.25}
    if(market==="foul1")return {green:.68,amber:.48}
    if(market==="fouled1")return {green:.62,amber:.42}
    return {green:.30,amber:.15}
  }
  const percentile=(values:number[],value:number)=>{
    if(values.length<=1)return .5
    const below=values.filter(v=>v<value).length
    const equal=values.filter(v=>v===value).length
    return Math.max(0,Math.min(1,(below+equal*.5)/values.length))
  }
  const peers=new Map<string,number[]>()
  for(const row of rows){
    const arr=peers.get(row.market)??[]
    arr.push(row.probability);peers.set(row.market,arr)
  }
  const signal=(row:any)=>{
    const f=floor(row.market)
    const rel=Math.max(-.5,Math.min(1.5,(row.probability-f.amber)/Math.max(.04,f.green-f.amber)))
    const pct=percentile(peers.get(row.market)??[],row.probability)
    const confidence=row.confidence==="A"?.08:row.confidence==="B"?.05:row.confidence==="C"?.02:0
    return pct*.55+Math.max(0,rel)*.25+row.probability*.12+confidence
  }
  const confidenceReliability=(row:any)=>row.confidence==="A"?1:row.confidence==="B"?.96:row.confidence==="C"?.88:.74
  const marketReliability=(row:any)=>{
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
  const conservativeJoint=(legs:any[],raw:number)=>{
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
  const preferred=new Map<string,{family:string;signal:number}>()
  for(const player of players){
    const options=rows.filter(r=>String(r.player).toLowerCase()===String(player.name).toLowerCase()&&r.confidence!=="D")
      .map(r=>({family:family(r.market),signal:signal(r)})).sort((a,b)=>b.signal-a.signal)
    if(options[0])preferred.set(String(player.name).toLowerCase(),options[0])
  }
  const candidates=rows
    .filter(r=>r.confidence!=="D"&&r.fairOdds>1)
    .map(r=>({row:r,family:family(r.market),signal:preferred.get(String(r.player).toLowerCase())?.signal??0,preferredFamily:preferred.get(String(r.player).toLowerCase())?.family}))
    .filter(x=>x.family===x.preferredFamily)
    .sort((a,b)=>(b.signal-a.signal)||(b.row.probability-a.row.probability))

  return configs.map(cfg=>{
    type State={legs:any[];product:number;prob:number;conservative:number;players:Set<string>;quality:number;families:Record<string,number>}
    let states:State[]=[{legs:[],product:1,prob:1,conservative:1,players:new Set(),quality:0,families:{}}]
    for(const option of candidates.filter(x=>x.row.probability>=cfg.minProb||x.signal>=.88)){
      const leg=option.row
      const next=[...states]
      for(const state of states){
        const pkey=String(leg.player).toLowerCase()
        if(state.legs.length>=cfg.maxLegs||state.players.has(pkey))continue
        const count=state.families[option.family]??0
        if(count>=cfg.maxPerFamily)continue
        const odd=Number(leg.fairOdds)
        if(!(odd>1))continue
        const product=state.product*odd
        if(product>cfg.targetDecimal*1.45&&state.legs.length>=1)continue
        const legs=[...state.legs,leg]
        const raw=state.prob*leg.probability
        next.push({
          legs,product,prob:raw,conservative:conservativeJoint(legs,raw),
          players:new Set([...state.players,pkey]),
          quality:state.quality+option.signal+leg.probability*.25,
          families:{...state.families,[option.family]:count+1},
        })
      }
      states=next.sort((a,b)=>{
        const score=(x:State)=>{
          if(!x.legs.length)return 999
          const gap=Math.abs(Math.log(Math.max(1.01,x.product))-Math.log(cfg.targetDecimal))
          const diversity=Object.keys(x.families).length
          const avg=x.quality/Math.max(1,x.legs.length)
          return gap*1.15+(x.product<cfg.targetDecimal?.8:0)-x.conservative*2.1-avg*.18-diversity*(cfg.risk==="Safe"?.01:.05)+x.legs.length*.015
        }
        return score(a)-score(b)
      }).slice(0,650)
    }
    const best=states.filter(s=>s.legs.length>=2&&s.product>=cfg.targetDecimal&&Object.keys(s.families).length>=cfg.minFamilies)
      .sort((a,b)=>{
        if(Math.abs(a.conservative-b.conservative)>.002)return b.conservative-a.conservative
        const da=Math.abs(Math.log(a.product)-Math.log(cfg.targetDecimal))
        const db=Math.abs(Math.log(b.product)-Math.log(cfg.targetDecimal))
        if(Math.abs(da-db)>.015)return da-db
        return a.legs.length-b.legs.length
      })[0]
    if(!best)return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:[],referenceProductOdds:null,averageLegProbability:null,minimumLegProbability:null,modelAllHitProbability:null,conservativeAllHitProbability:null,safetyScore:null,
      exactPriced:false,bookmaker:null,note:"No strong, market-diverse combination reaches "+cfg.targetFractional+" yet.",
    }
    const families=[...new Set(best.legs.map(l=>family(l.market)))]
    return {
      id:cfg.id,title:cfg.title,risk:cfg.risk,targetFractional:cfg.targetFractional,targetDecimal:cfg.targetDecimal,
      legs:best.legs,referenceProductOdds:Math.round(best.product*100)/100,
      averageLegProbability:best.legs.reduce((s,l)=>s+l.probability,0)/best.legs.length,
      minimumLegProbability:Math.min(...best.legs.map(l=>l.probability)),
      modelAllHitProbability:best.prob,conservativeAllHitProbability:best.conservative,safetyScore:best.conservative,exactPriced:false,bookmaker:null,
      note:"Snapshot safety-first build from each player's strongest market family ("+families.join(", ")+"). Confidence and same-market concentration are penalised before choosing the highest conservative hit chance at or above "+cfg.targetFractional+".",
    }
  })
}

function baseResponse(mode:"confirmed"|"predicted"|"squad"){
  const confirmed=mode==="confirmed"
  return {
    ok:true,
    lineupsConfirmed:confirmed,
    lineupMode:mode,
    lineupSource:confirmed?"Official starting XI":mode==="predicted"?"Snapshot probable XI":"Current squad",
    status:confirmed?"confirmed-lineup-snapshot-fallback":mode==="predicted"?"predicted-lineup-snapshot-fallback":"waiting-for-lineup",
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
    cacheLayer:{
      stats:"repository snapshot",
      persistence:"checked-in durable cache",
      purpose:"player baselines, historical match stats and model fallback when live/database sources fail",
    },
    generatedAt:new Date().toISOString(),
  }
}


function sameName(a:string,b:string){
  const x=normalisePredictedName(a),y=normalisePredictedName(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function isGoalkeeper(position:string|null|undefined){
  const p=normName(String(position??""))
  return p==="gk"||p.includes("goalkeeper")
}
function startScore(row:any){
  const apps=Number(row?.appearances??row?.international?.matches??0)
  const starts=Number(row?.starts??row?.international?.starts??0)
  const minutes=Number(row?.minutes??row?.international?.minutes??0)
  const rate=apps>0?starts/apps:0
  return rate*.7+Math.min(1,minutes/1800)*.3
}
function probableDomestic(players:any[],home:string,away:string,date:string){
  const curated=getPredictedFixture(date,home,away)
  const choose=(teamName:string)=>{
    const pool=players.filter(p=>sameTeamName(String(p.team??""),teamName))
    const curatedTeam=curated?Object.entries(curated.teams).find(([name])=>sameTeamName(name,teamName))?.[1]:null
    const selected:any[]=[]
    const used=new Set<string>()
    if(curatedTeam?.players?.length){
      for(const cp of curatedTeam.players){
        const hit=pool.find(p=>!used.has(String(p.player_name))&&sameName(String(p.player_name),cp.name))
        if(hit){selected.push(hit);used.add(String(hit.player_name))}
      }
    }
    const remaining=pool.filter(p=>!used.has(String(p.player_name))).sort((a,b)=>startScore(b)-startScore(a)||Number(b.minutes??0)-Number(a.minutes??0))
    if(!selected.some(p=>isGoalkeeper(p.position))){
      const gk=remaining.find(p=>isGoalkeeper(p.position))
      if(gk){selected.push(gk);used.add(String(gk.player_name))}
    }
    for(const p of remaining){
      if(selected.length>=11)break
      if(used.has(String(p.player_name)))continue
      selected.push(p);used.add(String(p.player_name))
    }
    return selected.slice(0,11)
  }
  return [...choose(home),...choose(away)]
}
function probableInternational(
  profiles:any[],
  home:string,
  away:string,
  squads?:{home:Set<string>;away:Set<string>},
){
  const choose=(team:string,squad:Set<string>|undefined)=>{
    let pool=profiles.filter(p=>sameTeamName(String(p?.nationalTeam??""),team))
    // A current senior squad is a hard eligibility gate. Club form only ranks
    // eligible internationals; it can never promote an uncapped/out-of-squad player.
    if(squad&&squad.size>=12){
      pool=pool.filter(p=>{
        const name=normName(String(p?.name??""))
        return [...squad].some(current=>current===name||current.includes(name)||name.includes(current))
      })
    }else{
      // Provider roster unavailable: require actual senior international usage.
      pool=pool.filter(p=>Number(p?.international?.matches??0)>0&&Number(p?.international?.minutes??0)>0)
    }
    return pool.sort((a,b)=>{
      const aIntl=Number(a?.international?.starts??0)*3+Number(a?.international?.matches??0)+Math.min(20,Number(a?.international?.minutes??0)/90)
      const bIntl=Number(b?.international?.starts??0)*3+Number(b?.international?.matches??0)+Math.min(20,Number(b?.international?.minutes??0)/90)
      return bIntl-aIntl||startScore(b)-startScore(a)
    }).slice(0,11)
  }
  return [...choose(home,squads?.home),...choose(away,squads?.away)]
}

export async function buildSnapshotScorecard(input:{
  date:string;home:string;away:string;competition:Competition
}){
  const official=await confirmedStartersForFixture(input)

  if(input.competition==="International"){
    const allProfiles=await internationalPlayersForFixture(input.home,input.away)
    const profiles=official.confirmed
      ? allProfiles.filter((p:any)=>official.starters.has(normName(String(p?.name??""))))
      : probableInternational(allProfiles,input.home,input.away,official.squads)

    const scored=profiles.map((p:any)=>{
      const intl=p?.international??{}
      const current=p?.domesticCurrent??null
      const previous=p?.domesticPrevious??null
      const appearances=Number(current?.appearances??0)+Number(intl?.matches??0)
      const starts=Number(current?.starts??0)+Number(intl?.starts??0)
      const expectedMinutes=Math.max(45,Math.min(90,appearances>0?60+30*(starts/appearances):65))
      const foulRate=blendedRate({international:intl,current,previous,key:"fouls90",prior:1.2,cap:4.5})
      const fouledRate=blendedRate({international:intl,current,previous,key:"fouled90",prior:1.15,cap:4.5})
      const shotsRate=blendedRate({international:intl,current,previous,key:"shots90",prior:1.45,cap:5.5})
      const sotRate=blendedRate({international:intl,current,previous,key:"shotsOnTarget90",prior:.48,cap:2.2})
      const cardRate=blendedRate({international:intl,current,previous,key:"cards90",prior:.20,cap:1.0})
      const goalRate=(()=>{
        const rows=[intl,current,previous].filter(Boolean)
        let weighted=0,total=0
        for(const row of rows){
          const minutes=Number(row?.minutes??0)
          const direct=Number(row?.goals90)
          const rate=Number.isFinite(direct)&&direct>=0?direct:(minutes>0?(Number(row?.goals??0)*90)/minutes:NaN)
          if(!Number.isFinite(rate))continue
          const w=Math.min(1,minutes/1200)
          weighted+=Math.min(2.5,rate)*w
          total+=w
        }
        return total>0?weighted/total:.22
      })()
      const assistRate=(()=>{
        const rows=[intl,current,previous].filter(Boolean)
        let weighted=0,total=0
        for(const row of rows){
          const minutes=Number(row?.minutes??0)
          const direct=Number(row?.assists90)
          const rate=Number.isFinite(direct)&&direct>=0?direct:(minutes>0?(Number(row?.assists??0)*90)/minutes:NaN)
          if(!Number.isFinite(rate))continue
          const w=Math.min(1,minutes/1200)
          weighted+=Math.min(1.8,rate)*w
          total+=w
        }
        return total>0?weighted/total:.14
      })()
      const minutesScale=expectedMinutes/90
      const goal=calibrateSnapshot("goal1",1-Math.exp(-goalRate*minutesScale))
      const assist=calibrateSnapshot("assist1",1-Math.exp(-assistRate*minutesScale))
      const foul=calibrateSnapshot("foul1",1-Math.exp(-foulRate*minutesScale))
      const fouled=calibrateSnapshot("fouled1",1-Math.exp(-fouledRate*minutesScale))
      const shot=calibrateSnapshot("shot1",1-Math.exp(-shotsRate*minutesScale))
      const sot=calibrateSnapshot("sot1",1-Math.exp(-sotRate*minutesScale))
      const card=calibrateSnapshot("card",1-Math.exp(-cardRate*minutesScale))
      const confidence:"A"|"B"|"C"|"D"=appearances>=12&&expectedMinutes>=65?"B":appearances>=6?"C":"D"
      return {p,goal,assist,foul,fouled,shot,sot,card,confidence}
    })

    const foulLegs=[...scored].filter((x:any)=>x.confidence!=="D").sort((a:any,b:any)=>b.foul-a.foul).slice(0,4).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"foul1",label:"1+ foul committed",
      probability:x.foul,confidence:x.confidence,
      reason:"Snapshot lineup model: blended current domestic and international foul rate.",
    }))
    const fouledLegs=[...scored].filter((x:any)=>x.confidence!=="D").sort((a:any,b:any)=>b.fouled-a.fouled).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"fouled1",label:"1+ foul drawn",
      probability:x.fouled,confidence:x.confidence,
      reason:"Snapshot lineup model: blended current domestic and international fouls-drawn rate.",
    }))
    const shotLegs=[...scored].filter((x:any)=>x.confidence!=="D").sort((a:any,b:any)=>b.shot-a.shot).slice(0,4).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"shot1",label:"1+ shot",
      probability:x.shot,confidence:x.confidence,
      reason:"Snapshot lineup model: blended current domestic and international shot rate.",
    }))
    const sotLegs=[...scored].filter((x:any)=>x.confidence!=="D").sort((a:any,b:any)=>b.sot-a.sot).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"sot1",label:"1+ shot on target",
      probability:x.sot,confidence:x.confidence,
      reason:"Snapshot lineup model: blended current domestic and international shot-on-target rate.",
    }))
    const cardLegs=[...scored].filter((x:any)=>x.confidence!=="D").sort((a:any,b:any)=>b.card-a.card).slice(0,3).map((x:any)=>leg({
      player:String(x.p.name),team:String(x.p.nationalTeam),market:"card",label:"Yellow card",
      probability:x.card,confidence:x.confidence,
      reason:"Snapshot lineup model: blended domestic, international and prior-season booking rate.",
    }))

    const slips:any[]=[]
    if(foulLegs.length>=2)slips.push(slip("intl-snapshot-fouls","Foul picks",foulLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(fouledLegs.length>=2)slips.push(slip("intl-snapshot-fouled","Fouled picks",fouledLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(shotLegs.length>=2)slips.push(slip("intl-snapshot-shots","Shot picks",shotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(sotLegs.length>=2)slips.push(slip("intl-snapshot-sot","SOT picks",sotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
    if(cardLegs.length>=2)slips.push(slip("intl-snapshot-cards","Card picks",cardLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))

    const playerRows=scored.map((x:any)=>({
      name:x.p.name,
      team:x.p.nationalTeam,
      lineupStatus:official.confirmed?"confirmed":"predicted",
      lineupConfidence:official.confirmed?"official":"snapshot-predicted",
      markets:{
        goal1:marketRow({key:"goal1",label:"Anytime goalscorer",probability:x.goal,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international scoring rate."}),
        assist1:marketRow({key:"assist1",label:"1+ assist",probability:x.assist,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international assist rate."}),
        foul1:marketRow({key:"foul1",label:"1+ foul committed",probability:x.foul,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international foul rate."}),
        foul2:marketRow({key:"foul2",label:"2+ fouls committed",probability:poissonAtLeastFromOne(x.foul,2),confidence:x.confidence,reason:"Snapshot count model derived from blended foul rate."}),
        foul3:marketRow({key:"foul3",label:"3+ fouls committed",probability:poissonAtLeastFromOne(x.foul,3),confidence:x.confidence,reason:"Snapshot count model derived from blended foul rate."}),
        foul4:marketRow({key:"foul4",label:"4+ fouls committed",probability:poissonAtLeastFromOne(x.foul,4),confidence:x.confidence,reason:"Snapshot count model derived from blended foul rate."}),
        foul5:marketRow({key:"foul5",label:"5+ fouls committed",probability:poissonAtLeastFromOne(x.foul,5),confidence:x.confidence,reason:"Snapshot count model derived from blended foul rate."}),
        fouled1:marketRow({key:"fouled1",label:"1+ foul drawn",probability:x.fouled,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international fouls-drawn rate."}),
        shot1:marketRow({key:"shot1",label:"1+ shot",probability:x.shot,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international shot rate."}),
        shot2:marketRow({key:"shot2",label:"2+ shots",probability:poissonAtLeastFromOne(x.shot,2),confidence:x.confidence,reason:"Snapshot count model derived from blended shot rate."}),
        sot1:marketRow({key:"sot1",label:"1+ shot on target",probability:x.sot,confidence:x.confidence,reason:"Snapshot model: blended current domestic and international shot-on-target rate."}),
        sot2:marketRow({key:"sot2",label:"2+ shots on target",probability:poissonAtLeastFromOne(x.sot,2),confidence:x.confidence,reason:"Snapshot count model derived from blended shots-on-target rate."}),
        card:marketRow({key:"card",label:"Yellow card",probability:x.card,confidence:x.confidence,reason:"Snapshot model: blended domestic, international and prior-season booking rate."}),
      },
    }))
    return {
      ...baseResponse(official.confirmed?"confirmed":"predicted"),
      lineupSource:official.confirmed?"Official starting XI":"Probable international XI restricted to current ESPN senior squad/roster",
      playerCount:profiles.length,
      squadEligibility:{
        source:official.source,
        eventId:official.eventId,
        homeSquadCount:official.squadCounts.home,
        awaySquadCount:official.squadCounts.away,
        rule:"Only current senior-squad players are eligible when ESPN roster coverage is available.",
      },
      players:playerRows,
      slips,
      riskBuilders:[],
    }
  }

  const snapshot=await snapshotPlayersForFixture(input.competition,input.home,input.away)
  const players=official.confirmed
    ? snapshot.players.filter(p=>official.starters.has(normName(p.player_name)))
    : probableDomestic(snapshot.players,input.home,input.away,input.date)
  const before=snapshot.rows.filter(row=>row.match_date<input.date)
  const scored=players.map(p=>{
    const history=before.filter(row=>row.player_name===p.player_name).sort((a,b)=>a.match_date.localeCompare(b.match_date))
    const recent=history.slice(-5)
    const goalHits=history.filter(row=>row.goals>=1).length
    const assistHits=history.filter(row=>row.assists>=1).length
    const foulHits=history.filter(row=>row.fouls_committed>=1).length
    const fouledHits=history.filter(row=>row.fouls_drawn>=1).length
    const shotHits=history.filter(row=>row.shots>=1).length
    const sotHits=history.filter(row=>row.shots_on_target>=1).length
    const cardHits=history.filter(row=>row.yellow_card).length
    const recentGoal=recent.filter(row=>row.goals>=1).length
    const recentAssist=recent.filter(row=>row.assists>=1).length
    const recentFoul=recent.filter(row=>row.fouls_committed>=1).length
    const recentFouled=recent.filter(row=>row.fouls_drawn>=1).length
    const recentShot=recent.filter(row=>row.shots>=1).length
    const recentSot=recent.filter(row=>row.shots_on_target>=1).length
    const recentCard=recent.filter(row=>row.yellow_card).length
    const goal=calibrateSnapshot("goal1",beta(goalHits,history.length,.18,7)*.72+beta(recentGoal,recent.length,.18,4)*.28)
    const assist=calibrateSnapshot("assist1",beta(assistHits,history.length,.12,7)*.72+beta(recentAssist,recent.length,.12,4)*.28)
    const foul=calibrateSnapshot("foul1",beta(foulHits,history.length,.50,6)*.72+beta(recentFoul,recent.length,.50,4)*.28)
    const fouled=calibrateSnapshot("fouled1",beta(fouledHits,history.length,.45,6)*.72+beta(recentFouled,recent.length,.45,4)*.28)
    const shot=calibrateSnapshot("shot1",beta(shotHits,history.length,.58,6)*.72+beta(recentShot,recent.length,.58,4)*.28)
    const sot=calibrateSnapshot("sot1",beta(sotHits,history.length,.32,6)*.72+beta(recentSot,recent.length,.32,4)*.28)
    const card=calibrateSnapshot("card",beta(cardHits,history.length,.20,7)*.72+beta(recentCard,recent.length,.20,4)*.28)
    const foul2=beta(history.filter(row=>row.fouls_committed>=2).length,history.length,.38,6)*.72+beta(recent.filter(row=>row.fouls_committed>=2).length,recent.length,.38,4)*.28
    const foul3=beta(history.filter(row=>row.fouls_committed>=3).length,history.length,.17,6)*.72+beta(recent.filter(row=>row.fouls_committed>=3).length,recent.length,.17,4)*.28
    const foul4=beta(history.filter(row=>row.fouls_committed>=4).length,history.length,.055,6)*.72+beta(recent.filter(row=>row.fouls_committed>=4).length,recent.length,.055,4)*.28
    const foul5=beta(history.filter(row=>row.fouls_committed>=5).length,history.length,.018,6)*.72+beta(recent.filter(row=>row.fouls_committed>=5).length,recent.length,.018,4)*.28
    const shot2=beta(history.filter(row=>row.shots>=2).length,history.length,.36,6)*.72+beta(recent.filter(row=>row.shots>=2).length,recent.length,.36,4)*.28
    const sot2=beta(history.filter(row=>row.shots_on_target>=2).length,history.length,.12,6)*.72+beta(recent.filter(row=>row.shots_on_target>=2).length,recent.length,.12,4)*.28
    const confidence:"A"|"B"|"C"|"D"=history.length>=10&&p.minutes>=600?"B":history.length>=5?"C":"D"
    return {p,goal,assist,foul,foul2,foul3,foul4,foul5,fouled,shot,shot2,sot,sot2,card,confidence}
  }).filter(Boolean) as Array<{p:any;goal:number;assist:number;foul:number;foul2:number;foul3:number;foul4:number;foul5:number;fouled:number;shot:number;shot2:number;sot:number;sot2:number;card:number;confidence:"A"|"B"|"C"|"D"}>

  const foulLegs=[...scored].filter(x=>x.confidence!=="D").sort((a,b)=>b.foul-a.foul).slice(0,4).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"foul1",label:"1+ foul committed",
    probability:x.foul,confidence:x.confidence,
    reason:"Snapshot lineup model: season and recent foul history.",
  }))
  const fouledLegs=[...scored].filter(x=>x.confidence!=="D").sort((a,b)=>b.fouled-a.fouled).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"fouled1",label:"1+ foul drawn",
    probability:x.fouled,confidence:x.confidence,
    reason:"Snapshot lineup model: season and recent fouls-drawn history.",
  }))
  const shotLegs=[...scored].filter(x=>x.confidence!=="D").sort((a,b)=>b.shot-a.shot).slice(0,4).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"shot1",label:"1+ shot",
    probability:x.shot,confidence:x.confidence,
    reason:"Snapshot lineup model: season and recent shot history.",
  }))
  const sotLegs=[...scored].filter(x=>x.confidence!=="D").sort((a,b)=>b.sot-a.sot).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"sot1",label:"1+ shot on target",
    probability:x.sot,confidence:x.confidence,
    reason:"Snapshot lineup model: season and recent shot-on-target history.",
  }))
  const cardLegs=[...scored].filter(x=>x.confidence!=="D").sort((a,b)=>b.card-a.card).slice(0,3).map(x=>leg({
    player:x.p.player_name,team:x.p.team,market:"card",label:"Yellow card",
    probability:x.card,confidence:x.confidence,
    reason:"Snapshot lineup model: season and recent booking history.",
  }))

  const slips:any[]=[]
  if(foulLegs.length>=2)slips.push(slip("snapshot-fouls","Foul picks",foulLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(fouledLegs.length>=2)slips.push(slip("snapshot-fouled","Fouled picks",fouledLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(shotLegs.length>=2)slips.push(slip("snapshot-shots","Shot picks",shotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(sotLegs.length>=2)slips.push(slip("snapshot-sot","SOT picks",sotLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))
  if(cardLegs.length>=2)slips.push(slip("snapshot-cards","Card picks",cardLegs,"Model-only fallback from the repository snapshot; verify the bookmaker market and price before placing."))

  const playerRows=scored.map(x=>({
    name:x.p.player_name,
    team:x.p.team,
    lineupStatus:official.confirmed?"confirmed":"predicted",
    lineupConfidence:official.confirmed?"official":"snapshot-predicted",
    markets:{
      goal1:marketRow({key:"goal1",label:"Anytime goalscorer",probability:x.goal,confidence:x.confidence,reason:"Snapshot model: season and recent scoring history."}),
      assist1:marketRow({key:"assist1",label:"1+ assist",probability:x.assist,confidence:x.confidence,reason:"Snapshot model: season and recent assist history."}),
      foul1:marketRow({key:"foul1",label:"1+ foul committed",probability:x.foul,confidence:x.confidence,reason:"Snapshot model: season and recent foul history."}),
      foul2:marketRow({key:"foul2",label:"2+ fouls committed",probability:x.foul2,confidence:x.confidence,reason:"Snapshot model: season and recent 2+ foul history."}),
      foul3:marketRow({key:"foul3",label:"3+ fouls committed",probability:x.foul3,confidence:x.confidence,reason:"Snapshot model: season and recent 3+ foul history."}),
      foul4:marketRow({key:"foul4",label:"4+ fouls committed",probability:x.foul4,confidence:x.confidence,reason:"Snapshot model: season and recent 4+ foul history."}),
      foul5:marketRow({key:"foul5",label:"5+ fouls committed",probability:x.foul5,confidence:x.confidence,reason:"Snapshot model: season and recent 5+ foul history."}),
      fouled1:marketRow({key:"fouled1",label:"1+ foul drawn",probability:x.fouled,confidence:x.confidence,reason:"Snapshot model: season and recent fouls-drawn history."}),
      shot1:marketRow({key:"shot1",label:"1+ shot",probability:x.shot,confidence:x.confidence,reason:"Snapshot model: season and recent shot history."}),
      shot2:marketRow({key:"shot2",label:"2+ shots",probability:x.shot2,confidence:x.confidence,reason:"Snapshot model: season and recent 2+ shot history."}),
      sot1:marketRow({key:"sot1",label:"1+ shot on target",probability:x.sot,confidence:x.confidence,reason:"Snapshot model: season and recent shot-on-target history."}),
      sot2:marketRow({key:"sot2",label:"2+ shots on target",probability:x.sot2,confidence:x.confidence,reason:"Snapshot model: season and recent 2+ shot-on-target history."}),
      card:marketRow({key:"card",label:"Yellow card",probability:x.card,confidence:x.confidence,reason:"Snapshot model: season and recent booking history."}),
    },
  }))
  return {
    ...baseResponse(official.confirmed?"confirmed":"predicted"),
    lineupSource:official.confirmed?"Official starting XI":"Probable XI from current-season starts, appearances and minutes snapshot",
    playerCount:players.length,
    players:playerRows,
    slips,
    riskBuilders:[],
  }
}
