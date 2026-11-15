import { NextResponse } from "next/server"
import { buildSnapshotScorecard } from "@/lib/snapshot-scorecard"

export const dynamic="force-dynamic"
export const revalidate=0

export async function GET(request:Request){
  const u=new URL(request.url)
  const date=u.searchParams.get("date")??""
  const home=u.searchParams.get("home")??""
  const away=u.searchParams.get("away")??""
  const competition=u.searchParams.get("competition")??"Premier League"
  const starterNames=u.searchParams.getAll("starter").map(x=>x.trim()).filter(Boolean)
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})

  try{
    const snapshot:any=await buildSnapshotScorecard({
      date,home,away,competition:competition as any,
      confirmedStarterNames:starterNames.length>=20?starterNames:undefined,
    })
    const payload={
      ok:Boolean(snapshot?.ok),
      competition,date,home,away,
      lineupsConfirmed:snapshot?.lineupsConfirmed===true,
      lineupMode:snapshot?.lineupMode,
      lineupSource:snapshot?.lineupSource,
      status:snapshot?.status,
      snapshotFallback:true,
      fallbackReason:"Fast in-play baseline from the checked-in player snapshot. Live match events are applied separately.",
      bookmaker:null,
      oddsSource:null,
      oddsCapturedAt:null,
      oddsAgeSeconds:null,
      oddsFreshness:"UNKNOWN",
      priceAvailable:false,
      marketAvailability:{goal:"unknown",assist:"unknown",card:"unknown",foul:"unknown",fouled:"unknown",shot:"unknown",sot:"unknown"},
      bookmakerAvailability:{},
      eligibleBooks:[],
      availableBets:[],
      referee:null,
      players:Array.isArray(snapshot?.players)?snapshot.players.map((p:any)=>({
        name:p.name,dbName:p.dbName,team:p.team,position:p.position,expectedMinutes:p.expectedMinutes,
        yellowConditionals:p.yellowConditionals,
        markets:p.markets,
      })):[],
    }
    return NextResponse.json(payload,{
      headers:{
        "Cache-Control":"public, max-age=0, s-maxage=21600, stale-while-revalidate=86400",
        "Vercel-CDN-Cache-Control":"public, s-maxage=21600, stale-while-revalidate=86400",
      },
    })
  }catch(error){
    return NextResponse.json({ok:false,error:"Unable to build live player baseline"},{status:500})
  }
}
