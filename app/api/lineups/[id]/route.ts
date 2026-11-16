import { getProvider } from "@/lib/providers"
import { getOfficialLineup, type OfficialCompetition } from "@/lib/official-lineup"
import type { LineupsResponse, TeamLineup, LineupPlayer } from "@/lib/types"
import { NextResponse } from "next/server"

export const dynamic="force-dynamic"
export const revalidate=0

function mapPlayer(p:any):LineupPlayer{
  return {id:String(p.id??""),name:String(p.name??""),number:p.number==null?null:Number(p.number),position:p.position??null,isStarter:Boolean(p.starter)}
}
function mapTeam(raw:any,status:"confirmed"|"expected"):TeamLineup|null{
  if(!raw)return null
  return {
    team:{id:"",name:String(raw.team??""),crest:raw.crest??undefined},
    status,
    formation:raw.formation??null,
    formationSource:raw.formationSource??null,
    startingXI:(raw.starters??[]).map(mapPlayer),
    substitutes:(raw.substitutes??[]).map(mapPlayer),
  }
}
function londonDate(iso:string){
  const d=new Date(iso)
  if(Number.isNaN(d.getTime()))return ""
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)
}

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params
  const provider=getProvider()
  let fixture:any=null
  try{fixture=provider.isConfigured()?await provider.getFixture(id):null}catch{}
  if(!fixture&&id.includes(":")){
    const [slug,eventId]=id.split(":")
    try{
      const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${encodeURIComponent(eventId)}`,{cache:"no-store",signal:AbortSignal.timeout(6500)})
      if(response.ok){
        const data=await response.json()
        const contest=data?.header?.competitions?.[0]??{}
        const homeRow=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="home")
        const awayRow=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="away")
        const homeName=String(homeRow?.team?.displayName??homeRow?.team?.name??"")
        const awayName=String(awayRow?.team?.displayName??awayRow?.team?.name??"")
        const kickoff=String(contest?.date??data?.header?.season?.startDate??"")
        if(homeName&&awayName&&kickoff)fixture={
          id,competition:"International",kickoff,
          home:{name:homeName},away:{name:awayName},
        }
      }
    }catch{}
  }
  if(!fixture){
    return NextResponse.json({connected:provider.isConfigured(),updatedAt:new Date().toISOString(),matchId:id,status:"unavailable",home:null,away:null,source:null,checkedAt:new Date().toISOString()} satisfies LineupsResponse)
  }
  const date=londonDate(fixture.kickoff)
  const official=await getOfficialLineup({
    date,home:fixture.home.name,away:fixture.away.name,competition:fixture.competition as OfficialCompetition,eventId:id,force:true,
  })
  const status=official.confirmed?"confirmed":"expected"
  return NextResponse.json({
    connected:true,updatedAt:new Date().toISOString(),matchId:id,status,
    home:mapTeam(official.homeLineup,status),away:mapTeam(official.awayLineup,status),
    source:official.source,checkedAt:official.checkedAt,cachedConfirmed:official.cachedConfirmed,
  } satisfies LineupsResponse,{headers:{"Cache-Control":"no-store"}})
}
