import { NextResponse } from "next/server"
import { getOfficialLineup, type OfficialCompetition } from "@/lib/official-lineup"

export const dynamic="force-dynamic"
export const revalidate=0

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  const competition=(url.searchParams.get("competition")??"Premier League") as OfficialCompetition
  const eventId=url.searchParams.get("id")??url.searchParams.get("eventId")
  const force=url.searchParams.get("refresh")==="1"
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})
  const value=await getOfficialLineup({date,home,away,competition,eventId,force})
  const maxAge=value.confirmed?60:20
  return NextResponse.json(value,{headers:{
    "Cache-Control":`public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${value.confirmed?300:40}`,
  }})
}
