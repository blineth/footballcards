import { NextResponse } from "next/server"

export const dynamic="force-dynamic"
export const revalidate=0

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"
type LivePlayerStat={
  player:string;team:string;minutes:number|null;foulsCommitted:number;foulsDrawn:number;shots:number;shotsOnTarget:number;
  goals:number;assists:number;yellowCards:number;redCards:number;starter:boolean;subbedOn:boolean;subbedOff:boolean;
  tackles:number;interceptions:number;blocks:number;duelsTotal:number;duelsWon:number;defensiveInterventions:number
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
  if(name==="ht"||name.includes("halftime")||name.includes("half time"))return "halftime"
  if(state==="in"||name.includes("progress")||name.includes("live")||name.includes("first half")||name.includes("second half"))return "live"
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
            goals:Math.max(espnStat(row,"goals"),espnStat(row,"totalGoals")),
            assists:espnStat(row,"goalAssists"),
            yellowCards:espnStat(row,"yellowCards"),
            redCards:espnStat(row,"redCards"),
            starter:row?.starter===true,
            subbedOn:false,
            tackles:Math.max(espnStat(row,"tackles"),espnStat(row,"totalTackles"),espnStat(row,"wonTackles")),
            interceptions:Math.max(espnStat(row,"interceptions"),espnStat(row,"totalInterceptions")),
            blocks:Math.max(espnStat(row,"blocks"),espnStat(row,"blockedShots")),
            duelsTotal:Math.max(espnStat(row,"duels"),espnStat(row,"totalDuels")),
            duelsWon:Math.max(espnStat(row,"duelsWon"),espnStat(row,"wonDuels")),
            defensiveInterventions:espnStat(row,"defensiveInterventions"),
            subbedOff:Boolean(row?.subbedOut),
          })
        }
      }
      // ESPN exposes richer defensive work for match leaders separately from
      // the roster rows. Merge those exact player stats where available.
      for(const teamLeaders of summary?.leaders??[]){
        for(const category of teamLeaders?.leaders??[]){
          for(const leader of category?.leaders??[]){
            const name=String(leader?.athlete?.displayName??leader?.athlete?.fullName??"").trim()
            const row=map.get(norm(name));if(!row)continue
            const stat=(name:string)=>{
              const hit=(leader?.statistics??[]).find((s:any)=>String(s?.name??"")===name)
              const value=Number(hit?.value??hit?.displayValue??0)
              return Number.isFinite(value)?value:0
            }
            row.tackles=Math.max(row.tackles,stat("effectiveTackles"),stat("totalTackles"))
            row.interceptions=Math.max(row.interceptions,stat("interceptions"))
            row.blocks=Math.max(row.blocks,stat("blocks"),stat("outfielderBlocks"))
            row.duelsTotal=Math.max(row.duelsTotal,stat("duels"),stat("totalDuels"))
            row.duelsWon=Math.max(row.duelsWon,stat("duelsWon"))
            row.defensiveInterventions=Math.max(row.defensiveInterventions,stat("defensiveInterventions"))
          }
        }
      }

      for(const ev of summary?.keyEvents??[]){
        const type=String(ev?.type?.type??ev?.type?.text??"").toLowerCase()
        const rawText=String(ev?.text??ev?.shortText??"")
        const text=rawText.toLowerCase()
        const isYellow=type.includes("yellow")||text.includes("yellow card")
        const isRed=type.includes("red")||text.includes("red card")
        const isSub=type.includes("substitution")||type.includes("subst")||text.includes("substitution")||text.includes("replaces")
        if(isYellow||isRed){
          for(const p of ev?.participants??[]){
            const name=String(p?.athlete?.displayName??p?.athlete?.fullName??"").trim()
            const row=map.get(norm(name));if(!row)continue
            if(isYellow)row.yellowCards=Math.max(1,row.yellowCards)
            if(isRed)row.redCards=Math.max(1,row.redCards)
          }
        }
        if(isSub){
          // ESPN commonly phrases substitutions as "Incoming replaces Outgoing".
          const pair=rawText.match(/^(.+?)\s+replaces\s+(.+?)(?:[,.]|$)/i)
          if(pair?.[1]){
            const incoming=map.get(norm(pair[1]))
            if(incoming)incoming.subbedOn=true
          }
          if(pair?.[2]){
            const outgoing=map.get(norm(pair[2]))
            if(outgoing)outgoing.subbedOff=true
          }else{
            const replaces=rawText.match(/replaces\s+([^,.]+(?:\s+[^,.]+){0,3})/i)
            if(replaces?.[1]){
              const outgoing=map.get(norm(replaces[1]))
              if(outgoing)outgoing.subbedOff=true
            }
          }
          // Some feeds expose participant roles/order instead of useful text.
          for(const p of ev?.participants??[]){
            const name=String(p?.athlete?.displayName??p?.athlete?.fullName??"").trim()
            const role=String(p?.type??p?.role??p?.participantType??"").toLowerCase()
            if(!name)continue
            const row=map.get(norm(name))
            if(!row)continue
            if(role.includes("out")||role.includes("replaced")||role.includes("subbed off"))row.subbedOff=true
            if(role==="in"||role.includes("subbed on")||role.includes("replacement"))row.subbedOn=true
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

function mergeLivePlayers(primary:LivePayload,secondary:LivePayload|null){
  if(!secondary?.players?.length)return primary
  const secondaryMap=new Map(secondary.players.map(p=>[norm(p.player),p]))
  const merged=primary.players.map(player=>{
    const other=secondaryMap.get(norm(player.player))
    if(!other)return player
    return {
      ...player,
      tackles:Math.max(Number(player.tackles??0),Number(other.tackles??0)),
      interceptions:Math.max(Number(player.interceptions??0),Number(other.interceptions??0)),
      blocks:Math.max(Number(player.blocks??0),Number(other.blocks??0)),
      duelsTotal:Math.max(Number(player.duelsTotal??0),Number(other.duelsTotal??0)),
      duelsWon:Math.max(Number(player.duelsWon??0),Number(other.duelsWon??0)),
      defensiveInterventions:Math.max(Number(player.defensiveInterventions??0),Number(other.defensiveInterventions??0)),
      foulsCommitted:Math.max(Number(player.foulsCommitted??0),Number(other.foulsCommitted??0)),
      foulsDrawn:Math.max(Number(player.foulsDrawn??0),Number(other.foulsDrawn??0)),
      shots:Math.max(Number(player.shots??0),Number(other.shots??0)),
      shotsOnTarget:Math.max(Number(player.shotsOnTarget??0),Number(other.shotsOnTarget??0)),
      yellowCards:Math.max(Number(player.yellowCards??0),Number(other.yellowCards??0)),
      redCards:Math.max(Number(player.redCards??0),Number(other.redCards??0)),
      subbedOn:Boolean(player.subbedOn||other.subbedOn),
      subbedOff:Boolean(player.subbedOff||other.subbedOff),
    }
  })
  return {
    ...primary,
    players:merged,
    source:secondary.source?primary.source+" + defensive stats "+secondary.source:primary.source,
  }
}

async function apiFootballLive(input:{date:string;home:string;away:string;competition:Competition},key:string):Promise<LivePayload|null>{
  try{
    const params:Record<string,string>={date:input.date,timezone:"Europe/London"}
    const league=API_LEAGUES[input.competition]
    if(league)params.league=league
    const fixtures=await apiFootball("/fixtures",params,key)
    const fixture=fixtures.find((x:any)=>sameTeam(String(x?.teams?.home?.name??""),input.home)&&sameTeam(String(x?.teams?.away?.name??""),input.away))
    const id=String(fixture?.fixture?.id??"");if(!id)return null
    const [playerRows,eventRows]=await Promise.all([
      apiFootball("/fixtures/players",{fixture:id},key),
      apiFootball("/fixtures/events",{fixture:id},key).catch(()=>[]),
    ])
    const subbedOffNames=new Set<string>()
    const subbedOnNames=new Set<string>()
    for(const event of eventRows??[]){
      const type=String(event?.type??"").toLowerCase()
      const detail=String(event?.detail??"").toLowerCase()
      if(type==="subst"||type.includes("subst")||detail.includes("substitution")){
        // API-Football substitution events use player = outgoing, assist = incoming.
        const outgoing=String(event?.player?.name??"").trim()
        const incoming=String(event?.assist?.name??"").trim()
        if(outgoing)subbedOffNames.add(norm(outgoing))
        if(incoming)subbedOnNames.add(norm(incoming))
      }
    }
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
          assists:Number(s?.goals?.assists??0)||0,
          yellowCards:Number(s?.cards?.yellow??0)||0,
          redCards:Number(s?.cards?.red??0)||0,
          starter:s?.games?.substitute===false,
          subbedOn:subbedOnNames.has(norm(player))||Boolean(s?.games?.substitute===true&&Number(s?.games?.minutes??0)>0),
          tackles:Number(s?.tackles?.total??0)||0,
          interceptions:Number(s?.tackles?.interceptions??0)||0,
          blocks:Number(s?.tackles?.blocks??0)||0,
          duelsTotal:Number(s?.duels?.total??0)||0,
          duelsWon:Number(s?.duels?.won??0)||0,
          defensiveInterventions:0,
          subbedOff:subbedOffNames.has(norm(player)),
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
  if(process.env.API_FOOTBALL_KEY){
    const apiPayload=await apiFootballLive({date,home,away,competition},process.env.API_FOOTBALL_KEY)
    if(payload?.players?.length)payload=mergeLivePlayers(payload,apiPayload)
    else if(apiPayload?.players?.length)payload=apiPayload
  }
  if(!payload){
    payload={ok:true,source:null,status:"unknown",elapsed:0,score:{home:null,away:null},players:[],updatedAt:new Date().toISOString()}
  }
  const ttl=payload.status==="live"||payload.status==="halftime"?45_000:payload.status==="scheduled"?120_000:300_000
  cache.set(key,{expires:Date.now()+ttl,payload})
  return NextResponse.json(payload)
}
