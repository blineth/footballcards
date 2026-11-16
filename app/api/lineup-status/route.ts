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
  const id=url.searchParams.get("id")
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})
  const lineup=await getOfficialLineup({date,home,away,competition,eventId:id,force:true})
  return NextResponse.json({
    ok:true,confirmed:lineup.confirmed,eventId:lineup.eventId,source:lineup.source,
    homeStarters:lineup.homeLineup.starterCount,awayStarters:lineup.awayLineup.starterCount,
    checkedAt:lineup.checkedAt,cachedConfirmed:lineup.cachedConfirmed,providerAvailable:lineup.providerAvailable,
    formations:{home:lineup.homeLineup.formation,away:lineup.awayLineup.formation},
  },{headers:{"Cache-Control":"no-store"}})
}
