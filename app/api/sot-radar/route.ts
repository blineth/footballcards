import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

const API_BASE = "https://v3.football.api-sports.io"
const LEAGUE_IDS: Record<string,string> = {
  "Premier League":"39",
  Championship:"40",
}

function norm(value:string|null|undefined){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function teamMatch(a?:string|null,b?:string|null){
  const na=norm(a),nb=norm(b)
  return Boolean(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na)))
}
function seasonFor(date:string){
  const d=new Date(date+"T12:00:00Z")
  const y=d.getUTCFullYear(),m=d.getUTCMonth()
  return String(m>=7?y:y-1)
}
async function api(path:string,params:Record<string,string>,key:string){
  const url=new URL(API_BASE+path)
  for(const[k,v]of Object.entries(params))url.searchParams.set(k,v)
  const r=await fetch(url,{headers:{"x-apisports-key":key},cache:"no-store",signal:AbortSignal.timeout(10000)})
  if(!r.ok)throw new Error(`API-Football ${path} ${r.status}`)
  const j=await r.json()
  return j?.response??[]
}
async function resolveTeam(name:string,key:string){
  const rows=await api("/teams",{search:name},key)
  const exact=rows.find((r:any)=>teamMatch(r?.team?.name,name))
  return exact?.team??null
}
function matchDate(row:any){
  return String(row?.fixture?.date??"").slice(0,10)
}
function playerTeamBlock(rows:any[],teamId:number){
  return rows.find((r:any)=>Number(r?.team?.id)===Number(teamId))
}
async function recentFixtures(teamId:number,key:string){
  const rows=await api("/fixtures",{team:String(teamId),last:"8",timezone:"Europe/London"},key)
  return rows.filter((r:any)=>["FT","AET","PEN"].includes(String(r?.fixture?.status?.short??"").toUpperCase())).slice(0,5)
}
async function teamSot(team:any,key:string){
  const fixtures=await recentFixtures(Number(team.id),key)
  const players=new Map<string,{
    name:string;team:string;games:number;minutes:number;sot:number;onePlus:number;twoPlus:number;
    matches:Array<{date:string;opponent:string;sot:number;minutes:number}>
  }>()

  await Promise.all(fixtures.map(async(f:any)=>{
    let rows:any[]=[]
    try{rows=await api("/fixtures/players",{fixture:String(f.fixture.id)},key)}catch{return}
    const block=playerTeamBlock(rows,Number(team.id))
    if(!block)return
    const isHome=Number(f?.teams?.home?.id)===Number(team.id)
    const opponent=isHome?f?.teams?.away?.name:f?.teams?.home?.name
    const date=matchDate(f)

    for(const row of block?.players??[]){
      const p=row?.player
      const stats=row?.statistics?.[0]??{}
      const minutes=Number(stats?.games?.minutes??0)
      if(!p?.name||!minutes)continue
      const sot=Number(stats?.shots?.on??0)
      const keyName=norm(p.name)
      const current=players.get(keyName)??{name:String(p.name),team:String(team.name),games:0,minutes:0,sot:0,onePlus:0,twoPlus:0,matches:[]}
      current.games+=1
      current.minutes+=minutes
      current.sot+=Number.isFinite(sot)?sot:0
      if(sot>=1)current.onePlus+=1
      if(sot>=2)current.twoPlus+=1
      current.matches.push({date,opponent:String(opponent??""),sot:Number.isFinite(sot)?sot:0,minutes})
      players.set(keyName,current)
    }
  }))

  return [...players.values()].map(p=>{
    const sot90=p.minutes?p.sot/p.minutes*90:0
    const onePlusRate=p.games?p.onePlus/p.games:0
    const twoPlusRate=p.games?p.twoPlus/p.games:0
    const score=Math.round((Math.min(1,sot90/1.2)*45+onePlusRate*35+twoPlusRate*20)*10)/10
    return {...p,sot90,onePlusRate,twoPlusRate,score}
  })
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  const competition=url.searchParams.get("competition")??"Premier League"
  const league=LEAGUE_IDS[competition]
  const key=process.env.API_FOOTBALL_KEY

  if(!date||!home||!away||!league)return NextResponse.json({connected:false,players:[],error:"Invalid fixture parameters"},{status:400})
  if(!key)return NextResponse.json({connected:false,players:[],error:"API_FOOTBALL_KEY is not configured"},{status:503})

  try{
    const [homeTeam,awayTeam]=await Promise.all([resolveTeam(home,key),resolveTeam(away,key)])
    if(!homeTeam?.id||!awayTeam?.id){
      return NextResponse.json({connected:true,source:"API-Football",players:[],note:"Teams could not be resolved for SOT research."})
    }
    const [homeRows,awayRows]=await Promise.all([
      teamSot(homeTeam,key),
      teamSot(awayTeam,key),
    ])
    const players=[...homeRows,...awayRows]
      .filter(p=>p.games>=2)
      .sort((a,b)=>b.score-a.score||b.sot90-a.sot90||b.sot-a.sot)
      .slice(0,20)

    return NextResponse.json({
      connected:true,
      source:"API-Football recent fixture player stats",
      updatedAt:new Date().toISOString(),
      players,
    })
  }catch(error){
    console.log("[sot-radar]",error instanceof Error?error.message:error)
    return NextResponse.json({connected:false,source:"API-Football",players:[],error:"SOT research feed unavailable."},{status:502})
  }
}
