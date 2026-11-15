import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

type Competition = "Premier League" | "Championship" | "League One" | "League Two" | "International"
const leagueSlug: Partial<Record<Competition,string>> = {
  "Premier League":"eng.1",
  Championship:"eng.2",
  "League One":"eng.3",
  "League Two":"eng.4",
}
const internationalSlugs=[
  "uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa",
  "fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf",
]

function norm(value:string|null|undefined){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function teamMatch(a?:string|null,b?:string|null){
  const na=norm(a),nb=norm(b)
  return Boolean(na&&nb&&(na===nb||na.includes(nb)||nb.includes(na)))
}
async function espn(slug:string,path:string){
  const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/${path}`,{
    cache:"no-store",
    signal:AbortSignal.timeout(6000),
    headers:{accept:"application/json"},
  })
  if(!response.ok)throw new Error("ESPN "+response.status)
  return response.json()
}
function starters(summary:any){
  let home=0,away=0
  for(const section of summary?.rosters??[]){
    const side=section?.homeAway==="home"?"home":section?.homeAway==="away"?"away":null
    if(!side)continue
    for(const row of section?.roster??[]){
      if(row?.starter!==true)continue
      if(side==="home")home++
      else away++
    }
  }
  return {home,away,confirmed:home>=11&&away>=11}
}
async function findByTeams(slug:string,date:string,home:string,away:string){
  const board=await espn(slug,`scoreboard?dates=${date.replaceAll("-","")}&limit=300`)
  for(const event of board?.events??[]){
    const competitors=event?.competitions?.[0]?.competitors??[]
    const h=competitors.find((row:any)=>row.homeAway==="home")
    const a=competitors.find((row:any)=>row.homeAway==="away")
    if(teamMatch(h?.team?.displayName,home)&&teamMatch(a?.team?.displayName,away))return String(event?.id??"")
  }
  return ""
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  const competition=(url.searchParams.get("competition")??"Premier League") as Competition
  const suppliedId=url.searchParams.get("id")??""
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})

  const slugs=competition==="International"?internationalSlugs:[leagueSlug[competition]].filter(Boolean) as string[]
  for(const slug of slugs){
    try{
      let eventId=suppliedId
      if(eventId){
        try{
          const summary=await espn(slug,`summary?event=${encodeURIComponent(eventId)}`)
          const counts=starters(summary)
          if(counts.home||counts.away){
            return NextResponse.json({
              ok:true,confirmed:counts.confirmed,eventId,source:"ESPN",homeStarters:counts.home,awayStarters:counts.away,
              checkedAt:new Date().toISOString(),
            })
          }
        }catch{}
      }
      eventId=await findByTeams(slug,date,home,away)
      if(!eventId)continue
      const summary=await espn(slug,`summary?event=${encodeURIComponent(eventId)}`)
      const counts=starters(summary)
      return NextResponse.json({
        ok:true,confirmed:counts.confirmed,eventId,source:"ESPN",homeStarters:counts.home,awayStarters:counts.away,
        checkedAt:new Date().toISOString(),
      })
    }catch{}
  }

  return NextResponse.json({
    ok:true,confirmed:false,eventId:suppliedId||null,source:"ESPN",homeStarters:0,awayStarters:0,
    checkedAt:new Date().toISOString(),
  })
}
