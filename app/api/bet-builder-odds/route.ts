import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { oddsSnapshots } from "@/lib/db/schema"
import { and, desc, eq } from "drizzle-orm"

export const dynamic = "force-dynamic"
export const revalidate = 0

const API_BASE = "https://v3.football.api-sports.io"
const UK_ODDS_BASE = "https://api.ukoddsapi.com"
const ODDS_API_DEV_BASE = "https://api.oddsapi.dev/v1"
const ODDS_API_IO_BASE = "https://api.odds-api.io/v3"
const FREE_ODDS_CACHE_MS = 3 * 60 * 60 * 1000
const SNAPSHOT_WRITE_MS = 30 * 60 * 1000
const snapshotWriteAt = new Map<string,number>()
const PREFERRED_UK_BOOKMAKERS = ["Bet365","Paddy Power","BetMGM UK","Sky Bet","William Hill"] as const
const LEAGUE_IDS: Record<string, string> = {
  "Premier League": "39",
  Championship: "40",
  "League One": "41",
  "League Two": "42",
}
const ODDS_API_DEV_BET365_LEAGUES:Record<string,string[]>={
  "Premier League":["lg_60298"],
  Championship:["lg_73017"],
  "League One":["lg_98740"],
  "League Two":["lg_52188"],
  International:["lg_200098"],
}
const ODDS_API_DEV_INTL_SEARCHES=[
  "uefa nations league",
  "world cup qualifying",
  "international friendly",
  "euro qualifying",
] as const
const oddsDevLeagueCache=new Map<string,{ids:string[];expires:number}>()

function norm(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(afc|fc)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function seasonFor(date: string) {
  const d = new Date(date + "T12:00:00Z")
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  return String(month >= 7 ? year : year - 1)
}
async function saveSnapshots(input:{date:string;home:string;away:string;competition:string;bookmaker?:string;source?:string|null;capturedAt?:string|null;selections:Array<{market:string;kind:string;label:string;odd:number|null;bookmaker?:string|null}>}) {
  if (!isDatabaseConfigured || !input.selections.length) return

  // Odds are already held in the provider/Vercel cache. Neon only needs a
  // periodic last-good history point, not another insert on every scorecard call.
  const nowMs=Date.now()
  const snapshotKey=[input.date,input.competition,norm(input.home),norm(input.away),norm(input.bookmaker??"")].join("|")
  if(nowMs-(snapshotWriteAt.get(snapshotKey)??0)<SNAPSHOT_WRITE_MS)return
  snapshotWriteAt.set(snapshotKey,nowMs)

  try {
    await ensureResearchSchema()
    const now = new Date(nowMs)
    const bucket = new Date(Math.floor(now.getTime() / SNAPSHOT_WRITE_MS) * SNAPSHOT_WRITE_MS)
    const captured = input.capturedAt ? new Date(input.capturedAt) : now
    const capturedAt = Number.isNaN(captured.getTime()) ? now : captured
    const rows = input.selections
      .filter(s => s.odd != null && Number.isFinite(Number(s.odd)) && Number(s.odd) > 1)
      .map(s => ({
        competition: input.competition,
        fixtureDate: input.date,
        homeTeam: input.home,
        awayTeam: input.away,
        bookmaker: s.bookmaker ?? input.bookmaker ?? "Unknown",
        source: input.source ?? null,
        market: s.market,
        kind: s.kind,
        label: s.label,
        odds: String(Number(s.odd)),
        snapshotBucket: bucket,
        capturedAt,
      }))
    if (rows.length) await db.insert(oddsSnapshots).values(rows).onConflictDoNothing()
  } catch (error) {
    console.log("[bet-builder-odds] snapshot save skipped:", error instanceof Error ? error.message : error)
  }
}

async function attachMovement(input:{date:string;home:string;away:string;competition:string;bookmaker?:string;selections:Array<{market:string;kind:string;label:string;odd:number|null}>}) {
  if (!isDatabaseConfigured || !input.selections.length || !input.bookmaker) return input.selections
  try {
    const rows = await db.select().from(oddsSnapshots)
      .where(and(
        eq(oddsSnapshots.competition, input.competition),
        eq(oddsSnapshots.fixtureDate, input.date),
        eq(oddsSnapshots.homeTeam, input.home),
        eq(oddsSnapshots.awayTeam, input.away),
        eq(oddsSnapshots.bookmaker, input.bookmaker),
      ))
      .orderBy(desc(oddsSnapshots.capturedAt))
      .limit(300)

    return input.selections.map(selection => {
      if (selection.odd == null) return { ...selection, previousOdd:null, movement:null }
      const current = Number(selection.odd)
      const previous = rows.find(row =>
        norm(row.market) === norm(selection.market) &&
        norm(row.label) === norm(selection.label) &&
        Math.abs(Number(row.odds) - current) > 0.0001
      )
      const previousOdd = previous ? Number(previous.odds) : null
      return {
        ...selection,
        previousOdd,
        movement: previousOdd == null ? null : Math.round((current - previousOdd) * 1000) / 1000,
      }
    })
  } catch {
    return input.selections
  }
}


type MarketAvailabilityState = "available" | "unavailable" | "unknown"
type MarketAvailability = Record<"goal"|"assist"|"card"|"foul"|"fouled"|"shot"|"sot", MarketAvailabilityState>
type BookmakerAvailability = Record<string,MarketAvailability>

function isPlayerPropSelection(selection:{market?:string;label?:string;kind:string}) {
  const market = norm(selection.market)
  const label = norm(selection.label)
  const text = (market + " " + label).trim()

  if (selection.kind === "goal") {
    return /\bplayer\b/.test(market) || /\bgoalscorer\b|\bgoal scorer\b|\bto score\b|\banytime scorer\b/.test(text)
  }
  if (selection.kind === "assist") {
    return /\bplayer\b/.test(market) || /\bassist\b/.test(text)
  }
  if (selection.kind === "card") {
    return /\bplayer\b/.test(market) || /\bto be booked\b|\bbooked\b|\bto receive a card\b|\bcarded\b/.test(text)
  }
  if (selection.kind === "foul") {
    return /\bplayer\b/.test(market) || /\bto commit\b|\bplayer fouls committed\b|\bfouls committed by\b/.test(text)
  }
  if (selection.kind === "fouled") {
    return /\bplayer\b/.test(market) || /\bto be fouled\b|\bfouls drawn\b|\bfouls won\b/.test(text)
  }
  if (selection.kind === "sot") {
    return /\bplayer\b/.test(market) || /\bplayer shots on target\b|\bshots on target by\b/.test(text)
  }
  if (selection.kind === "shot") {
    return /\bplayer\b/.test(market) || /\bplayer shots\b|\bshots by\b/.test(text)
  }
  return false
}

function marketAvailability(selections:Array<{market?:string;label?:string;kind:string}>, verified:boolean):MarketAvailability {
  const playerSelections = selections.filter(isPlayerPropSelection)
  const state = (kind:string):MarketAvailabilityState => playerSelections.some(s=>s.kind===kind) ? "available" : verified ? "unavailable" : "unknown"
  return {
    goal:state("goal"),
    assist:state("assist"),
    card:state("card"),
    foul:state("foul"),
    fouled:state("fouled"),
    shot:state("shot"),
    sot:state("sot"),
  }
}
function bookmakerAvailability(
  selections:Array<{market?:string;label?:string;kind:string;bookmaker?:string|null}>,
  verifiedBooks:string[],
):BookmakerAvailability{
  const result:BookmakerAvailability={}
  for(const book of PREFERRED_UK_BOOKMAKERS){
    const verified=verifiedBooks.includes(book)
    result[book]=marketAvailability(selections.filter(s=>s.bookmaker===book),verified)
  }
  return result
}

async function cachedSnapshot(input:{date:string;home:string;away:string;competition:string}) {
  if (!isDatabaseConfigured) return null
  try {
    await ensureResearchSchema()
    const rows = await db.select().from(oddsSnapshots)
      .where(and(
        eq(oddsSnapshots.competition,input.competition),
        eq(oddsSnapshots.fixtureDate,input.date),
        eq(oddsSnapshots.homeTeam,input.home),
        eq(oddsSnapshots.awayTeam,input.away),
      ))
      .orderBy(desc(oddsSnapshots.capturedAt))
      .limit(300)
    if (!rows.length) return null

    const latest = rows[0]
    const capturedAt = latest.capturedAt instanceof Date ? latest.capturedAt : new Date(latest.capturedAt)
    if (Number.isNaN(capturedAt.getTime())) return null
    const ageMs = Date.now() - capturedAt.getTime()
    if (ageMs > FREE_ODDS_CACHE_MS) return null

    const latestBucket = new Date(latest.snapshotBucket).getTime()
    const sameBucket = rows.filter(row =>
      new Date(row.snapshotBucket).getTime() === latestBucket &&
      preferredBookmakerName(row.bookmaker) === "Bet365"
    )
    if (!sameBucket.length) return null
    const rawSelections = sameBucket.map(row => ({
      market:row.market,
      kind:row.kind,
      label:row.label,
      odd:Number(row.odds),
      bookmaker:preferredBookmakerName(row.bookmaker) ?? row.bookmaker,
    }))
    const selections = rawSelections
    const cachedBooks = Array.from(new Set(rawSelections.map(s=>s.bookmaker).filter(Boolean)))
    return {
      connected:true,
      bookmaker:cachedBooks.length===1 ? cachedBooks[0] : "Best of preferred UK books",
      bookmakers:cachedBooks,
      source:(latest.source ?? "verified odds feed")+" · last-good Bet365 cache",
      capturedAt:capturedAt.toISOString(),
      selections,
      priceAvailable:selections.length>0,
      freeTier:true,
      cached:true,
      maxUsableAgeSeconds:10800,
      snapshotAgeSeconds:Math.max(0,Math.round(ageMs/1000)),
      marketAvailability:marketAvailability(selections,true),
      bookmakerAvailability:bookmakerAvailability(selections,cachedBooks),
    }
  } catch {
    return null
  }
}

function preferredBookmakerName(name:string){
  const n=norm(name)
  if(n.includes("bet365")) return "Bet365"
  if(n.includes("sky bet") || n.includes("skybet")) return "Sky Bet"
  if(n.includes("william hill")) return "William Hill"
  if(n.includes("paddy power")) return "Paddy Power"
  if(n.includes("betmgm")) return "BetMGM UK"
  return null
}
function isUkBookmaker(name:string){
  return preferredBookmakerName(name) != null
}

function marketKind(name: string) {
  const n = norm(name)
  if (/anytime.*score|goal\s*scorer|goalscorer|player.*goal|to score/.test(n)) return "goal"
  if (/assist/.test(n)) return "assist"
  if (/shot.*target|target.*shot/.test(n)) return "sot"
  if (/fouled|fouls won|fouls drawn/.test(n)) return "fouled"
  if (/foul/.test(n)) return "foul"
  if (/card|book/.test(n)) return "card"
  if (/shot/.test(n)) return "shot"
  return "other"
}


const ODDS_API_IO_LEAGUES:Record<string,string>={
  "Premier League":"england-premier-league",
  Championship:"england-championship",
  "League One":"england-league-one",
  "League Two":"england-league-two",
}
const oddsIoEventCache=new Map<string,{expires:number,rows:any[]}>()
let oddsIoSelectedCache:{expires:number,names:string[]}|null=null

async function oddsApiIo(path:string,params:Record<string,string>,key:string){
  const url=new URL(ODDS_API_IO_BASE+path)
  url.searchParams.set("apiKey",key)
  for(const[k,v]of Object.entries(params))url.searchParams.set(k,v)
  // Persist successful provider responses in Vercel/Next's data cache.
  // Odds refresh quickly; fixture/bookmaker metadata can live longer.
  const revalidateSeconds=path==="/odds"?10:path==="/events"?(params.status==="live"?10:60):600
  const response=await fetch(url,{
    next:{revalidate:revalidateSeconds},
    signal:AbortSignal.timeout(10000),
    headers:{accept:"application/json"},
  })
  if(!response.ok)throw new Error("Odds-API.io "+path+" "+response.status)
  return response.json()
}
async function oddsIoSelectedBooks(key:string){
  if(oddsIoSelectedCache&&oddsIoSelectedCache.expires>Date.now())return oddsIoSelectedCache.names
  try{
    const payload=await oddsApiIo("/bookmakers/selected",{},key)
    const rows=Array.isArray(payload)?payload:Array.isArray(payload?.bookmakers)?payload.bookmakers:Array.isArray(payload?.data)?payload.data:[]
    const names=rows.map((x:any)=>String(x?.name??x?.bookmaker??x)).filter(Boolean)
    oddsIoSelectedCache={expires:Date.now()+10*60*1000,names}
    return names
  }catch{return []}
}
async function oddsIoEvents(input:{date:string;competition:string;key:string;liveOnly?:boolean}){
  const league=ODDS_API_IO_LEAGUES[input.competition]??""
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())
  const isToday=input.date===today
  const cacheKey=[input.date,league||"international",input.liveOnly?"live":"all"].join("|")
  const cached=oddsIoEventCache.get(cacheKey)
  if(cached&&cached.expires>Date.now())return cached.rows

  let rows:any[]=[]
  if(!input.liveOnly){
    const params:Record<string,string>={sport:"football",bookmaker:"Bet365",status:"pending",limit:"500"}
    if(league)params.league=league
    let pending=await oddsApiIo("/events",params,input.key)
    if(!Array.isArray(pending))pending=Array.isArray(pending?.events)?pending.events:[]
    rows=[...pending]
  }
  if(isToday){
    try{
      const liveParams:Record<string,string>={sport:"football",bookmaker:"Bet365",status:"live",limit:"500"}
      if(league)liveParams.league=league
      let live=await oddsApiIo("/events",liveParams,input.key)
      if(!Array.isArray(live))live=Array.isArray(live?.events)?live.events:[]
      rows=[...rows,...live]
    }catch{}
  }
  const dedup=[...new Map(rows.map((x:any)=>[String(x?.id??""),x])).values()]
  oddsIoEventCache.set(cacheKey,{expires:Date.now()+(input.liveOnly?12_000:isToday?20_000:2*60*1000),rows:dedup})
  return dedup
}
function oddsIoDistanceHours(value:any,date:string){
  const a=new Date(String(value??"")).getTime()
  const b=new Date(date+"T12:00:00Z").getTime()
  return Number.isFinite(a)&&Number.isFinite(b)?Math.abs(a-b)/3600000:9999
}
function numericOdd(...values:any[]){
  for(const value of values){
    const n=Number(value)
    if(Number.isFinite(n)&&n>1)return n
  }
  return null
}
function oddsIoPlayerKind(name:string){
  const n=norm(name)
  if(n==="anytime goalscorer")return "goal"
  if(n==="player to assist")return "assist"
  if(n==="player to be booked")return "card"
  if(n==="player fouls")return "foul"
  if(n==="player to be fouled")return "fouled"
  if(n==="player shots")return "shot"
  if(n==="player shots on target")return "sot"
  return "other"
}
type AvailableBet={
  market:string;kind:string;label:string;odd:number;bookmaker:string;
  probability:number|null;probabilityBasis:"no-vig"|"implied";line?:number|null;side?:string|null
}
function pairNoVig(a:number|null,b:number|null){
  if(!(a&&a>1&&b&&b>1))return [null,null] as const
  const qa=1/a,qb=1/b,total=qa+qb
  return [qa/total,qb/total] as const
}
function tripleNoVig(a:number|null,b:number|null,d:number|null){
  if(!(a&&a>1&&b&&b>1&&d&&d>1))return [null,null,null] as const
  const qa=1/a,qb=1/b,qd=1/d,total=qa+qb+qd
  return [qa/total,qb/total,qd/total] as const
}
function flattenGeneralOddsApiIo(payload:any,home:string,away:string){
  const out:AvailableBet[]=[]
  const bookmakers=payload?.bookmakers&&typeof payload.bookmakers==="object"?payload.bookmakers:{}
  const push=(market:string,kind:string,label:string,odd:any,probability:number|null,basis:"no-vig"|"implied",line?:number|null,side?:string|null)=>{
    const price=Number(odd)
    if(!Number.isFinite(price)||price<=1)return
    out.push({market,kind,label,odd:price,bookmaker:"Bet365",probability:probability==null?null:Math.max(.001,Math.min(.999,probability)),probabilityBasis:basis,line:line??null,side:side??null})
  }
  for(const [rawBook,marketsRaw] of Object.entries(bookmakers)){
    if(preferredBookmakerName(String(rawBook))!=="Bet365")continue
    for(const market of (Array.isArray(marketsRaw)?marketsRaw:[]) as any[]){
      const name=String(market?.name??"")
      const n=norm(name)
      const rows=Array.isArray(market?.odds)?market.odds:[]
      for(const row of rows){
        if(n==="ml"){
          const h=numericOdd(row?.home),d=numericOdd(row?.draw),a=numericOdd(row?.away)
          const [hp,dp,ap]=tripleNoVig(h,d,a)
          if(h)push(name,"result",home+" to win",h,hp,"no-vig",null,"home")
          if(d)push(name,"result","Draw",d,dp,"no-vig",null,"draw")
          if(a)push(name,"result",away+" to win",a,ap,"no-vig",null,"away")
        }else if(n==="draw no bet"){
          const h=numericOdd(row?.home),a=numericOdd(row?.away)
          const [hp,ap]=pairNoVig(h,a)
          if(h)push(name,"draw-no-bet",home+" draw no bet",h,hp,"no-vig",null,"home")
          if(a)push(name,"draw-no-bet",away+" draw no bet",a,ap,"no-vig",null,"away")
        }else if(n==="double chance"){
          for(const [key,label] of [["1X",home+" or Draw"],["12",home+" or "+away],["X2","Draw or "+away]] as const){
            const odd=numericOdd(row?.[key],row?.[key.toLowerCase()])
            if(odd)push(name,"double-chance",label,odd,1/odd,"implied",null,key)
          }
        }else if(n==="both teams to score"){
          const yes=numericOdd(row?.yes),no=numericOdd(row?.no)
          const [yp,np]=pairNoVig(yes,no)
          if(yes)push(name,"btts","Both teams to score · Yes",yes,yp,"no-vig",null,"yes")
          if(no)push(name,"btts","Both teams to score · No",no,np,"no-vig",null,"no")
        }else if(n==="first team to score"){
          const h=numericOdd(row?.home),a=numericOdd(row?.away),none=numericOdd(row?.none)
          const [hp,ap,np]=tripleNoVig(h,a,none)
          if(h)push(name,"first-team-score",home+" to score first",h,hp,"no-vig",null,"home")
          if(a)push(name,"first-team-score",away+" to score first",a,ap,"no-vig",null,"away")
          if(none)push(name,"first-team-score","No goal",none,np,"no-vig",null,"none")
        }else if(["totals","team total home","team total away","corners totals","bookings totals"].includes(n)){
          const lineRaw=Number(row?.hdp??row?.line)
          const line=Number.isFinite(lineRaw)?lineRaw:null
          const over=numericOdd(row?.over),under=numericOdd(row?.under)
          const [op,up]=pairNoVig(over,under)
          const prefix=n==="totals"?"Total goals":n==="team total home"?home+" team goals":n==="team total away"?away+" team goals":n==="corners totals"?"Total corners":"Total bookings"
          const kind=n==="totals"?"total-goals":n==="team total home"||n==="team total away"?"team-goals":n==="corners totals"?"corners":"bookings"
          if(over)push(name,kind,prefix+" over "+(line??""),over,op,"no-vig",line,"over")
          if(under)push(name,kind,prefix+" under "+(line??""),under,up,"no-vig",line,"under")
        }else if(n==="corners spread"){
          const lineRaw=Number(row?.hdp??row?.line)
          const line=Number.isFinite(lineRaw)?lineRaw:null
          const h=numericOdd(row?.home),a=numericOdd(row?.away)
          const [hp,ap]=pairNoVig(h,a)
          if(h)push(name,"corners-handicap",home+" corners "+(line!=null?(line>=0?"+":"")+line:"handicap"),h,hp,"no-vig",line,"home")
          if(a)push(name,"corners-handicap",away+" corners "+(line!=null?(line<=0?"+":"")+String(line!=null?-line:""):"handicap"),a,ap,"no-vig",line==null?null:-line,"away")
        }
      }
    }
  }
  return out.sort((a,b)=>(b.probability??0)-(a.probability??0)||a.odd-b.odd)
}
function flattenOddsApiIo(payload:any){
  const out:Array<{market:string;kind:string;label:string;odd:number|null;underOdd?:number|null;noVigProbability?:number|null;bookmaker?:string|null}>=[]
  const bookmakers=payload?.bookmakers&&typeof payload.bookmakers==="object"?payload.bookmakers:{}
  for(const [rawBook,marketsRaw] of Object.entries(bookmakers)){
    const book=preferredBookmakerName(String(rawBook))
    if(!book)continue
    const markets=Array.isArray(marketsRaw)?marketsRaw:[]
    for(const market of markets as any[]){
      const marketName=String(market?.name??"")
      const kind=oddsIoPlayerKind(marketName)
      if(kind==="other")continue
      for(const row of Array.isArray(market?.odds)?market.odds:[]){
        const player=String(row?.label??row?.player??row?.name??"").trim()
        const hdp=Number(row?.hdp??row?.line??row?.max)
        const threshold=Number.isFinite(hdp)?Math.floor(hdp)+1:1
        let odd:number|null=null
        let underOdd:number|null=null
        // Count props are normally represented as over/under lines. Keep both
        // sides when available so Match Edge can derive a no-vig Bet365 probability.
        if(["assist","foul","fouled","shot","sot","card"].includes(kind)){
          odd=numericOdd(row?.over,row?.yes,row?.odds,row?.price)
          underOdd=numericOdd(row?.under,row?.no)
        }else if(kind==="goal"){
          odd=numericOdd(row?.odds,row?.price,row?.yes,row?.over)
          underOdd=numericOdd(row?.no,row?.under)
        }
        if(odd==null)continue
        const qOver=1/odd
        const qUnder=underOdd&&underOdd>1?1/underOdd:0
        const noVigProbability=qUnder>0?qOver/(qOver+qUnder):null
        const suffix=
          kind==="goal"?"Anytime goalscorer":
          kind==="assist"?threshold+"+ assist"+(threshold===1?"":"s"):
          kind==="card"?"to be booked":
          kind==="foul"?threshold+"+ foul"+(threshold===1?"":"s")+" committed":
          kind==="fouled"?threshold+"+ foul"+(threshold===1?"":"s")+" drawn":
          kind==="sot"?threshold+"+ shot"+(threshold===1?"":"s")+" on target":
          threshold+"+ shot"+(threshold===1?"":"s")
        const label=(player?player+" · ":"")+suffix
        out.push({market:marketName,kind,label,odd,underOdd,noVigProbability,bookmaker:book})
      }
    }
  }
  return out
}
async function fromOddsApiIo(input:{date:string;home:string;away:string;competition:string;key:string;liveOnly?:boolean}){
  const events=await oddsIoEvents(input)
  const candidates=events
    .filter((row:any)=>teamMatch(row?.home,input.home)&&teamMatch(row?.away,input.away))
    .sort((a:any,b:any)=>oddsIoDistanceHours(a?.date,input.date)-oddsIoDistanceHours(b?.date,input.date))
  const event=candidates[0]
  const id=String(event?.id??"")
  if(!id)return null
  const selectedBookmakers=await oddsIoSelectedBooks(input.key)
  const requestedMarkets=[
    "ML","Draw No Bet","Double Chance","Totals","Both Teams To Score","First Team To Score",
    "Team Total Home","Team Total Away","Corners Totals","Corners Spread","Bookings Totals",
    "Anytime Goalscorer","Player To Assist","Player to be Booked","Player Fouls","Player To Be Fouled","Player Shots","Player Shots on Target",
  ].join(",")
  const payload=await oddsApiIo("/odds",{eventId:id,bookmakers:"Bet365",markets:requestedMarkets},input.key)
  const selections=flattenOddsApiIo(payload)
  const rawAvailableBets=flattenGeneralOddsApiIo(payload,input.home,input.away)
  const availableBets=[...new Map(rawAvailableBets.map(b=>[
    [b.kind,b.label].join("|").toLowerCase(),b
  ])).values()]
    .sort((a,b)=>(b.probability??0)-(a.probability??0)||a.odd-b.odd)
  const books=[...new Set([...selections.map(s=>s.bookmaker),...availableBets.map(s=>s.bookmaker)].filter(Boolean))] as string[]
  if(!selections.length&&!availableBets.length)return null
  const updatedTimes=Object.values(payload?.bookmakers??{}).flatMap((markets:any)=>Array.isArray(markets)?markets.map((m:any)=>String(m?.updatedAt??"")).filter(Boolean):[])
  const providerUpdatedAt=updatedTimes.sort().reverse()[0]??null
  // capturedAt means when Match Edge verified this board from the provider.
  // providerUpdatedAt is retained separately because a bookmaker may not move
  // a price for several minutes even though we have just re-verified it.
  const capturedAt=new Date().toISOString()
  return {
    connected:true,
    bookmaker:"Bet365",
    bookmakers:["Bet365"],
    source:"Odds-API.io",
    capturedAt,
    providerUpdatedAt,
    eventId:id,
    selections,
    availableBets,
    availableMarketNames:[...new Set(availableBets.map(x=>x.market))],
    bookmakerUrls:payload?.urls??{},
    provider:"odds-api.io",
    selectedBookmakers:selectedBookmakers.filter((x:string)=>norm(x).includes("bet365")),
  }
}

async function oddsApiDev(path:string,params:Record<string,string>,key:string){
  const url=new URL(ODDS_API_DEV_BASE+path)
  for(const[k,v]of Object.entries(params))url.searchParams.set(k,v)
  const response=await fetch(url,{
    headers:{Authorization:"Bearer "+key,accept:"application/json"},
    cache:"no-store",
    signal:AbortSignal.timeout(10000),
  })
  if(!response.ok)throw new Error("OddsAPI.dev "+path+" "+response.status)
  return response.json()
}
function oddsDevRows(payload:any){
  if(Array.isArray(payload?.data))return payload.data
  if(Array.isArray(payload?.data?.events))return payload.data.events
  if(Array.isArray(payload?.events))return payload.events
  if(Array.isArray(payload?.results))return payload.results
  if(Array.isArray(payload))return payload
  return []
}
function oddsDevLeagueRows(payload:any){
  if(Array.isArray(payload?.data))return payload.data
  if(Array.isArray(payload?.data?.leagues))return payload.data.leagues
  if(Array.isArray(payload?.leagues))return payload.leagues
  if(Array.isArray(payload?.results))return payload.results
  return []
}
async function oddsDevLeagueIds(search:string,key:string){
  const cacheKey=norm(search)
  const cached=oddsDevLeagueCache.get(cacheKey)
  if(cached&&cached.expires>Date.now())return cached.ids
  try{
    const payload=await oddsApiDev("/bet365/leagues",{search},key)
    const ids=oddsDevLeagueRows(payload)
      .map((row:any)=>String(row?.league_id??row?.id??row?.key??""))
      .filter((id:string)=>id.startsWith("lg_"))
      .slice(0,12)
    oddsDevLeagueCache.set(cacheKey,{ids,expires:Date.now()+6*60*60*1000})
    return ids
  }catch{return []}
}
function oddsDevTeam(row:any,side:"home"|"away"){
  return row?.[side+"_team"]?.name
    ??row?.[side+"_team"]
    ??row?.[side]?.name
    ??row?.[side]
    ??row?.teams?.[side]?.name
    ??row?.participants?.find?.((x:any)=>String(x?.role??x?.side??"").toLowerCase()===side)?.name
    ??""
}
function oddsDevStart(row:any){
  return String(row?.starts_at??row?.start_time??row?.start_at??row?.kickoff??row?.commence_time??row?.date??"")
}
function dateDistanceHours(a:string,b:string){
  const x=new Date(a).getTime(),y=new Date(b+"T12:00:00Z").getTime()
  return Number.isFinite(x)&&Number.isFinite(y)?Math.abs(x-y)/3600000:9999
}
function mapOddsDevMarketKey(key:string){
  const n=norm(key)
  if(/goal.*scorer.*anytime|anytime.*goal|goalscorer/.test(n))return "goal"
  if(/shots.*on.*target|shot.*on.*target/.test(n))return "sot"
  if(/fouls.*won|fouls.*drawn|fouled/.test(n))return "fouled"
  if(/player.*fouls|fouls/.test(n))return "foul"
  if(/to.*be.*booked|receive.*card|player.*cards|booked/.test(n))return "card"
  if(/player.*shots|shots/.test(n))return "shot"
  return "other"
}
function flattenOddsDev(payload:any,bookmakerName:string){
  const data=payload?.data??payload??{}
  const markets=Array.isArray(data?.markets)?data.markets:[]
  const out:Array<{market:string;kind:string;label:string;odd:number|null;bookmaker?:string|null}>=[]
  for(const market of markets){
    const marketKey=String(market?.key??market?.name??"")
    const kind=mapOddsDevMarketKey(marketKey)
    if(kind==="other")continue
    const player=String(market?.player??"").trim()
    for(const outcome of market?.outcomes??[]){
      const outcomeKey=String(outcome?.key??outcome?.name??"").toLowerCase()
      const price=Number(outcome?.price??outcome?.odds)
      if(!Number.isFinite(price)||price<=1)continue
      if((kind==="goal"||kind==="card")&&/(^no$|under|not)/.test(outcomeKey))continue
      if(["foul","fouled","shot","sot"].includes(kind)&&outcomeKey&&outcomeKey!=="over"&&!outcomeKey.includes("over"))continue
      const rawLine=Number(outcome?.line)
      const threshold=Number.isFinite(rawLine)?Math.floor(rawLine)+1:null
      const marketLabel=
        kind==="goal"?"Anytime goalscorer":
        kind==="card"?"Player to be booked":
        kind==="foul"?"Player fouls committed":
        kind==="fouled"?"Player fouls won":
        kind==="sot"?"Player shots on target":
        "Player shots"
      const label=
        kind==="goal"?((player?player+" · ":"")+"Anytime goalscorer"):
        kind==="card"?((player?player+" · ":"")+"to be booked"):
        threshold!=null?((player?player+" · ":"")+threshold+"+ "+(kind==="foul"?"fouls committed":kind==="fouled"?"fouls won":kind==="sot"?"shots on target":"shots")):
        ((player?player+" · ":"")+String(outcome?.name??outcome?.key??marketLabel))
      out.push({market:marketLabel,kind,label,odd:price,bookmaker:bookmakerName})
    }
  }
  return out
}
async function fromOddsApiDev(input:{date:string;home:string;away:string;competition:string;key:string}){
  const leagueIds=[...(ODDS_API_DEV_BET365_LEAGUES[input.competition]??[])]
  if(input.competition==="International"){
    for(const search of ODDS_API_DEV_INTL_SEARCHES){
      for(const id of await oddsDevLeagueIds(search,input.key))if(!leagueIds.includes(id))leagueIds.push(id)
    }
  }
  for(const leagueId of leagueIds){
    const eventsPayload=await oddsApiDev("/bet365/events",{league_id:leagueId},input.key)
    const rows=oddsDevRows(eventsPayload)
      .filter((row:any)=>teamMatch(oddsDevTeam(row,"home"),input.home)&&teamMatch(oddsDevTeam(row,"away"),input.away))
      .sort((a:any,b:any)=>dateDistanceHours(oddsDevStart(a),input.date)-dateDistanceHours(oddsDevStart(b),input.date))
    const event=rows[0]
    const id=String(event?.event_id??event?.id??"")
    if(!id)continue
    const oddsPayload=await oddsApiDev("/bet365/events/"+id+"/odds",{},input.key)
    const selections=flattenOddsDev(oddsPayload,"Bet365")
    if(!selections.length)continue
    const capturedAt=String(oddsPayload?.data?.updated_at??oddsPayload?.updated_at??new Date().toISOString())
    return {
      connected:true,
      bookmaker:"Bet365",
      bookmakers:["Bet365"],
      source:"OddsAPI.dev Bet365",
      capturedAt,
      eventId:id,
      selections,
      provider:"oddsapi.dev",
    }
  }
  return null
}

async function apiFootball(path: string, params: Record<string, string>, key: string) {
  const url = new URL(API_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`API-Football ${path} ${response.status}`)
  const json = await response.json()
  return json?.response ?? []
}
async function ukOdds(path: string, params: Record<string, string>, key: string) {
  const url = new URL(UK_ODDS_BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const response = await fetch(url, {
    headers: { "X-Api-Key": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`UK Odds API ${path} ${response.status}`)
  return response.json()
}
function eventRows(payload: any) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.events)) return payload.events
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.results)) return payload.results
  return []
}
function eventTeam(row: any, side: "home" | "away") {
  return row?.[side + "_team"]?.name ?? row?.[side + "_team"] ?? row?.[side]?.name ?? row?.[side] ?? ""
}
function eventId(row: any) {
  return row?.event_id ?? row?.id ?? row?.eventId ?? ""
}
function flattenUkSelections(payload: any) {
  const out: Array<{ market: string; kind: string; label: string; odd: number | null }> = []
  for (const market of payload?.markets ?? []) {
    const marketName = String(market?.market_name ?? market?.name ?? market?.market_key ?? "")
    const kind = marketKind(marketName)
    if (kind === "other") continue
    for (const selection of market?.selections ?? []) {
      const label = String(selection?.selection_name ?? selection?.name ?? selection?.label ?? "")
      const rows = Array.isArray(selection?.odds) ? selection.odds : [selection]
      for (const row of rows) {
        const bookmakerCode = String(row?.bookmaker_code ?? selection?.bookmaker_code ?? "")
        const bookmakerName = String(row?.bookmaker_name ?? selection?.bookmaker_name ?? "")
        if (bookmakerCode && bookmakerCode !== "UO004") continue
        if (bookmakerName && !norm(bookmakerName).includes("bet365")) continue
        const raw = Number(row?.odds ?? row?.price ?? selection?.odds)
        out.push({ market: marketName, kind, label, odd: Number.isFinite(raw) ? raw : null })
      }
    }
  }
  return out
}
async function fromUkOdds(input: { date: string; home: string; away: string; key: string }) {
  const eventsPayload = await ukOdds("/v1/football/events", { schedule_date: input.date, per_page: "200" }, input.key)
  const event = eventRows(eventsPayload).find((row: any) => teamMatch(eventTeam(row, "home"), input.home) && teamMatch(eventTeam(row, "away"), input.away))
  const id = eventId(event)
  if (!id) return null
  const oddsPayload = await ukOdds(`/v1/football/events/${id}/odds`, {
    package: "full",
    bookmakers: "bet365",
    odds_format: "decimal",
  }, input.key)
  return {
    connected: true,
    bookmaker: "Bet365",
    source: "UK Odds API",
    capturedAt: oddsPayload?.captured_at ?? oddsPayload?.capturedAt ?? null,
    eventId: String(id),
    selections: flattenUkSelections(oddsPayload),
  }
}
async function fromApiFootball(input: { date: string; home: string; away: string; competition: string; key: string }) {
  const league = LEAGUE_IDS[input.competition]
  if (!league && input.competition !== "International") return null
  const fixtureParams:Record<string,string> = {
    date: input.date,
    timezone: "Europe/London",
  }
  if(league){
    fixtureParams.league=league
    fixtureParams.season=seasonFor(input.date)
  }
  const fixtures = await apiFootball("/fixtures", fixtureParams, input.key)
  const fixture = fixtures.find((row: any) => teamMatch(row?.teams?.home?.name, input.home) && teamMatch(row?.teams?.away?.name, input.away))
  if (!fixture?.fixture?.id) return null

  const oddsRows = await apiFootball("/odds", {
    fixture: String(fixture.fixture.id),
  }, input.key)

  const selections: Array<{ market: string; kind: string; label: string; odd: number | null; bookmaker?:string|null }> = []
  const books = new Set<string>()
  for (const row of oddsRows) {
    for (const book of row?.bookmakers ?? []) {
      const rawBookmakerName=String(book?.name ?? "")
      const bookmakerName=preferredBookmakerName(rawBookmakerName)
      if (bookmakerName!=="Bet365") continue
      books.add(bookmakerName)
      for (const bet of book?.bets ?? []) {
        const kind = marketKind(String(bet?.name ?? ""))
        if (kind === "other") continue
        for (const value of bet?.values ?? []) {
          const raw = Number(value?.odd)
          selections.push({
            market: String(bet?.name ?? ""),
            kind,
            label: String(value?.value ?? ""),
            odd: Number.isFinite(raw) ? raw : null,
            bookmaker:bookmakerName,
          })
        }
      }
    }
  }

  return {
    connected: true,
    bookmaker: books.size === 1 ? [...books][0] : "Best of preferred UK books",
    bookmakers:[...books].sort(),
    source: "API-Football preferred UK bookmaker feed",
    capturedAt: null,
    fixtureId: String(fixture.fixture.id),
    selections,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get("date") ?? ""
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  const competition = url.searchParams.get("competition") ?? "Premier League"
  const liveOnly = url.searchParams.get("live") === "1"

  if (!date || !home || !away) {
    return NextResponse.json({ connected: false, selections: [], error: "Invalid fixture parameters" }, { status: 400 })
  }

  try {
    // 1) Primary paid feed: verified Bet365 prices from Odds-API.io.
    // Successful upstream responses are retained in the Vercel Data Cache.
    const oddsApiIoKey=process.env.ODDS_API_IO_KEY
    if(oddsApiIoKey){
      try{
        const primary=await fromOddsApiIo({date,home,away,competition,key:oddsApiIoKey,liveOnly})
        if(primary&&primary.selections.length){
          await saveSnapshots({date,home,away,competition,bookmaker:primary.bookmaker,source:primary.source,capturedAt:primary.capturedAt,selections:primary.selections})
          const selections=primary.selections
          return NextResponse.json({
            ...primary,selections,priceAvailable:true,liveVerified:liveOnly?true:undefined,freeTier:false,cached:false,maxUsableAgeSeconds:liveOnly?45:300,
            marketAvailability:marketAvailability(selections,true),
            bookmakerAvailability:bookmakerAvailability(selections,["Bet365"]),
            cacheLayer:{provider:"Vercel Data Cache",oddsTtlSeconds:10,eventTtlSeconds:liveOnly?12:20,lastGoodDatabase:liveOnly?"disabled for live verification":"oddsSnapshots when database is available"},
          })
        }
      }catch(error){
        console.log("[bet-builder-odds] Odds-API.io:",error instanceof Error?error.message:error)
      }
    }

    if(liveOnly){
      // A temporary empty live board must not erase the last Bet365 player board.
      // Return the last-good snapshot as reference data, but never label those
      // retained prices as current/live verified.
      const lastGood=await cachedSnapshot({date,home,away,competition})
      if(lastGood?.selections?.length){
        return NextResponse.json({
          ...lastGood,
          priceAvailable:false,
          liveVerified:false,
          cached:true,
          lastGoodReference:true,
          providerStatus:{oddsApiIo:Boolean(oddsApiIoKey)},
          note:"Bet365 has not returned a fresh live player board on this refresh. Keeping the last captured Bet365 player markets as a reference until a newer successful live refresh replaces them.",
        })
      }
      return NextResponse.json({
        connected:Boolean(oddsApiIoKey),
        bookmaker:"Bet365",
        bookmakers:["Bet365"],
        source:oddsApiIoKey?"Odds-API.io":null,
        selections:[],
        priceAvailable:false,
        liveVerified:false,
        freeTier:false,
        cached:false,
        maxUsableAgeSeconds:45,
        marketAvailability:marketAvailability([],Boolean(oddsApiIoKey)),
        bookmakerAvailability:bookmakerAvailability([],oddsApiIoKey?["Bet365"]:[]),
        providerStatus:{oddsApiIo:Boolean(oddsApiIoKey)},
        note:oddsApiIoKey
          ?"No current Bet365 live player-prop prices are available from the verified live feed for this fixture."
          :"No verified Bet365 live odds provider is configured.",
      })
    }

    // 2) Legacy dedicated player-props feed.
    const oddsApiDevKey=process.env.ODDS_API_DEV_KEY
    if(oddsApiDevKey){
      try{
        const primary=await fromOddsApiDev({date,home,away,competition,key:oddsApiDevKey})
        if(primary){
          await saveSnapshots({date,home,away,competition,bookmaker:primary.bookmaker,source:primary.source,capturedAt:primary.capturedAt,selections:primary.selections})
          const selections=await attachMovement({date,home,away,competition,bookmaker:"Bet365",selections:primary.selections})
          return NextResponse.json({
            ...primary,selections,priceAvailable:true,freeTier:false,cached:false,maxUsableAgeSeconds:900,
            marketAvailability:marketAvailability(selections,true),
            bookmakerAvailability:bookmakerAvailability(selections,["Bet365"]),
          })
        }
      }catch(error){
        console.log("[bet-builder-odds] OddsAPI.dev:",error instanceof Error?error.message:error)
      }
    }

    // 3) UK Odds API full package, when configured.
    const ukOddsKey=process.env.UK_ODDS_API_KEY
    if(ukOddsKey){
      try{
        const secondary=await fromUkOdds({date,home,away,key:ukOddsKey})
        if(secondary&&secondary.selections.length){
          const selections=secondary.selections.map(s=>({...s,bookmaker:"Bet365"}))
          await saveSnapshots({date,home,away,competition,bookmaker:"Bet365",source:secondary.source,capturedAt:secondary.capturedAt,selections})
          return NextResponse.json({
            ...secondary,bookmakers:["Bet365"],selections,priceAvailable:true,freeTier:false,cached:false,maxUsableAgeSeconds:900,
            marketAvailability:marketAvailability(selections,true),
            bookmakerAvailability:bookmakerAvailability(selections,["Bet365"]),
          })
        }
      }catch(error){
        console.log("[bet-builder-odds] UK Odds API:",error instanceof Error?error.message:error)
      }
    }

    // 4) Recent last-good Bet365 snapshot.
    const cached = await cachedSnapshot({ date, home, away, competition })
    if (cached) return NextResponse.json(cached)

    // When the paid Bet365 feed is configured, never substitute a different
    // bookmaker and present it as Bet365. A provider miss means no verified price.
    if(oddsApiIoKey){
      return NextResponse.json({
        connected:true,
        bookmaker:"Bet365",
        bookmakers:["Bet365"],
        source:"Odds-API.io",
        selections:[],
        priceAvailable:false,
        freeTier:false,
        cached:false,
        maxUsableAgeSeconds:300,
        marketAvailability:marketAvailability([],true),
        bookmakerAvailability:bookmakerAvailability([],["Bet365"]),
        providerStatus:{oddsApiIo:true,oddsApiDev:Boolean(oddsApiDevKey),ukOddsApi:Boolean(ukOddsKey),apiFootball:Boolean(process.env.API_FOOTBALL_KEY)},
        note:"Odds-API.io is connected, but Bet365 has not returned a verified board for this fixture/market yet.",
      })
    }

    // 5) API-Football is only a broad fallback. It is not treated as the primary player-props feed.
    const apiKey = process.env.API_FOOTBALL_KEY
    if (apiKey && (LEAGUE_IDS[competition] || competition==="International")) {
      try {
        const fallback = await fromApiFootball({ date, home, away, competition, key: apiKey })
        if (fallback?.selections?.length) {
          await saveSnapshots({date,home,away,competition,bookmaker:fallback.bookmaker,source:fallback.source,capturedAt:fallback.capturedAt,selections:fallback.selections})
          const selections = fallback.selections
          return NextResponse.json({
            ...fallback,selections,priceAvailable:true,freeTier:true,cached:false,maxUsableAgeSeconds:900,
            marketAvailability:marketAvailability(selections,true),
            bookmakerAvailability:bookmakerAvailability(selections,fallback.bookmakers??[]),
          })
        }
      } catch (error) {
        console.log("[bet-builder-odds] API-Football fallback:", error instanceof Error ? error.message : error)
      }
    }

    return NextResponse.json({
      connected:Boolean(oddsApiIoKey||oddsApiDevKey||ukOddsKey||apiKey),
      bookmaker:"Bet365",
      bookmakers:["Bet365"],
      source:null,
      selections:[],
      priceAvailable:false,
      freeTier:!oddsApiIoKey&&!oddsApiDevKey&&!ukOddsKey,
      cached:false,
      maxUsableAgeSeconds:900,
      marketAvailability:marketAvailability([],false),
      bookmakerAvailability:bookmakerAvailability([],[]),
      providerStatus:{
        oddsApiIo:Boolean(oddsApiIoKey),
        oddsApiDev:Boolean(oddsApiDevKey),
        ukOddsApi:Boolean(ukOddsKey),
        apiFootball:Boolean(apiKey),
      },
      note:oddsApiIoKey||oddsApiDevKey||ukOddsKey
        ?"A dedicated odds provider is configured but did not return a matching player-prop board for this fixture."
        :"No dedicated player-props odds key is configured. Add ODDS_API_IO_KEY; legacy feeds and API-Football remain fallbacks.",
    })
  } catch (error) {
    console.log("[bet-builder-odds]", error instanceof Error ? error.message : error)
    return NextResponse.json({
      connected:false,
      bookmaker:"Preferred UK books",
      bookmakers:[...PREFERRED_UK_BOOKMAKERS],
      selections:[],
      priceAvailable:false,
      freeTier:true,
      marketAvailability:marketAvailability([],false),
      bookmakerAvailability:bookmakerAvailability([],[]),
    })
  }
}
