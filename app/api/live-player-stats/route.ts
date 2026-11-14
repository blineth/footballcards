import { NextResponse } from "next/server"

export const dynamic="force-dynamic"
export const revalidate=0

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"
type LivePlayerStat={
  player:string;team:string;minutes:number|null;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;yellowCards:number;redCards:number;subbedOff:boolean
}
type LivePayload={
  ok:boolean;source:string|null;status:"scheduled"|"live"|"halftime"|"finished"|"unknown";elapsed:number;
  score:{home:number|null;away:number|null};players:LivePlayerStat[];fixtureId?:string|null;updatedAt:string
}

const ESPN:Record<Competition,string[]>={
  "Premier League":["eng.1"],
  Championship:["eng.2"],
  "League One":["eng.3"],
  "League Two":["eng.4"],
  International:["uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","uefa.euro","uefa.euroq"],
}
const API_LEAGUES:Record<string,string>={
  "Premier League":"39",Championship:"40","League One":"41","League Two":"42",
}
const cache=new Map<string,{expires:number,payload:LivePayload}>()

function norm(v:string|null|undefined){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function sameTeam(a:string,b:string){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function espnStat(row:any,name:string){
  const s=(row?.stats??[]).find((x:any)=>String(x?.name??"")===name)
  const v=Number(s?.value??s?.displayValue??0)
  return Number.isFinite(v)?v:0
}
function espnStatus(event:any):LivePayload["status"]{
  const state=String(event?.status?.type?.state??"").toLowerCase()
  const name=String(event?.status?.type?.name??event?.status?.type?.description??"").toLowerCase()
  if(state==="post"||name.includes("final")||name.includes("full time"))return "finished"
  if(name.includes("half"))return "halftime"
  if(state==="in"||name.includes("progress")||name.includes("live"))return "live"
  if(state==="pre")return "scheduled"
  return "unknown"
}
function elapsedFrom(event:any){
  const raw=String(event?.status?.displayClock??event?.status?.type?.detail??"")
  const m=raw.match(/(\d{1,3})/)
  return m?Math.max(0,Math.min(130,Number(m[1]))):0
}
async function espnLive(input:{date:string;home:string;away:string;competition:Competition}):Promise<LivePayload|null>{
  for(const slug of ESPN[input.competition]??[]){
    try{
      const date=input.date.replaceAll("-","")
      const board=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${date}&limit=300`,{cache:"no-store",signal:AbortSignal.timeout(4500)})
      if(!board.ok)continue
      const json=await board.json()
      const event=(json?.events??[]).find((e:any)=>{
        const cs=e?.competitions?.[0]?.competitors??[]
        const h=cs.find((x:any)=>x.homeAway==="home"),a=cs.find((x:any)=>x.homeAway==="away")
        return sameTeam(String(h?.team?.displayName??""),input.home)&&sameTeam(String(a?.team?.displayName??""),input.away)
      })
      if(!event?.id)continue
      const summaryRes=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${event.id}`,{cache:"no-store",signal:AbortSignal.timeout(5000)})
      if(!summaryRes.ok)continue
      const summary=await summaryRes.json()
      const map=new Map<string,LivePlayerStat>()
      for(const section of summary?.rosters??[]){
        const team=String(section?.team?.displayName??section?.team?.name??"")
        for(const row of section?.roster??[]){
          const player=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim()
          if(!player)continue
          const minutesRaw=espnStat(row,"minutes")
          map.set(norm(player),{
            player,team,minutes:minutesRaw>0?minutesRaw:null,
            foulsCommitted:espnStat(row,"foulsCommitted"),
            foulsDrawn:espnStat(row,"foulsSuffered"),
            shots:espnStat(row,"totalShots"),
            shotsOnTarget:espnStat(row,"shotsOnTarget"),
            goals:espnStat(row,"goals"),
            yellowCards:espnStat(row,"yellowCards"),
            redCards:espnStat(row,"redCards"),
            subbedOff:false,
          })
        }
      }
      for(const ev of summary?.keyEvents??[]){
        const type=String(ev?.type?.type??ev?.type?.text??"").toLowerCase()
        const text=String(ev?.text??ev?.shortText??"").toLowerCase()
        const isYellow=type.includes("yellow")||text.includes("yellow card")
        const isRed=type.includes("red")||text.includes("red card")
        if(isYellow||isRed){
          for(const p of ev?.participants??[]){
            const name=String(p?.athlete?.displayName??p?.athlete?.fullName??"").trim()
            const row=map.get(norm(name));if(!row)continue
            if(isYellow)row.yellowCards=Math.max(1,row.yellowCards)
            if(isRed)row.redCards=Math.max(1,row.redCards)
          }
        }
      }
      const cs=event?.competitions?.[0]?.competitors??[]
      const h=cs.find((x:any)=>x.homeAway==="home"),a=cs.find((x:any)=>x.homeAway==="away")
      return {
        ok:true,source:"ESPN live",status:espnStatus(event),elapsed:elapsedFrom(event),
        score:{home:Number.isFinite(Number(h?.score))?Number(h.score):null,away:Number.isFinite(Number(a?.score))?Number(a.score):null},
        players:[...map.values()],fixtureId:String(event.id),updatedAt:new Date().toISOString(),
      }
    }catch{}
  }
  return null
}

async function apiFootball(path:string,params:Record<string,string>,key:string){
  const u=new URL("https://v3.football.api-sports.io"+path)
  for(const[k,v]of Object.entries(params))u.searchParams.set(k,v)
  const r=await fetch(u,{headers:{"x-apisports-key":key},cache:"no-store",signal:AbortSignal.timeout(7000)})
  if(!r.ok)throw new Error("API-Football "+r.status)
  const j=await r.json();return j?.response??[]
}
function apiStatus(short:string):LivePayload["status"]{
  if(["FT","AET","PEN"].includes(short))return "finished"
  if(short==="HT")return "halftime"
  if(["1H","2H","ET","BT","P"].includes(short))return "live"
  if(["NS","TBD"].includes(short))return "scheduled"
  return "unknown"
}
async function apiFootballLive(input:{date:string;home:string;away:string;competition:Competition},key:string):Promise<LivePayload|null>{
  try{
    const params:Record<string,string>={date:input.date,timezone:"Europe/London"}
    const league=API_LEAGUES[input.competition]
    if(league)params.league=league
    const fixtures=await apiFootball("/fixtures",params,key)
    const fixture=fixtures.find((x:any)=>sameTeam(String(x?.teams?.home?.name??""),input.home)&&sameTeam(String(x?.teams?.away?.name??""),input.away))
    const id=String(fixture?.fixture?.id??"");if(!id)return null
    const playerRows=await apiFootball("/fixtures/players",{fixture:id},key)
    const players:LivePlayerStat[]=[]
    for(const teamRow of playerRows??[]){
      const team=String(teamRow?.team?.name??"")
      for(const p of teamRow?.players??[]){
        const s=p?.statistics?.[0]??{}
        const player=String(p?.player?.name??"").trim();if(!player)continue
        players.push({
          player,team,minutes:Number.isFinite(Number(s?.games?.minutes))?Number(s.games.minutes):null,
          foulsCommitted:Number(s?.fouls?.committed??0)||0,
          foulsDrawn:Number(s?.fouls?.drawn??0)||0,
          shots:Number(s?.shots?.total??0)||0,
          shotsOnTarget:Number(s?.shots?.on??0)||0,
          goals:Number(s?.goals?.total??0)||0,
          yellowCards:Number(s?.cards?.yellow??0)||0,
          redCards:Number(s?.cards?.red??0)||0,
          subbedOff:false,
        })
      }
    }
    const st=String(fixture?.fixture?.status?.short??"")
    return {
      ok:true,source:"API-Football live players",status:apiStatus(st),elapsed:Number(fixture?.fixture?.status?.elapsed??0)||0,
      score:{home:fixture?.goals?.home==null?null:Number(fixture.goals.home),away:fixture?.goals?.away==null?null:Number(fixture.goals.away)},
      players,fixtureId:id,updatedAt:new Date().toISOString(),
    }
  }catch{return null}
}

export async function GET(request:Request){
  const u=new URL(request.url)
  const date=u.searchParams.get("date")??"",home=u.searchParams.get("home")??"",away=u.searchParams.get("away")??""
  const competition=(u.searchParams.get("competition")??"Premier League") as Competition
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})
  const key=[date,competition,norm(home),norm(away)].join("|")
  const cached=cache.get(key)
  if(cached&&cached.expires>Date.now())return NextResponse.json({...cached.payload,cached:true})

  let payload=await espnLive({date,home,away,competition})
  if((!payload||!payload.players.length)&&process.env.API_FOOTBALL_KEY){
    payload=await apiFootballLive({date,home,away,competition},process.env.API_FOOTBALL_KEY)
  }
  if(!payload){
    payload={ok:true,source:null,status:"unknown",elapsed:0,score:{home:null,away:null},players:[],updatedAt:new Date().toISOString()}
  }
  const ttl=payload.status==="live"||payload.status==="halftime"?45_000:payload.status==="scheduled"?120_000:300_000
  cache.set(key,{expires:Date.now()+ttl,payload})
  return NextResponse.json(payload)
}
