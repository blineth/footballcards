import { NextResponse } from "next/server"

export const dynamic="force-dynamic"
export const revalidate=0

type Competition="Premier League"|"Championship"|"League One"|"League Two"|"International"
const LEAGUES:Record<Competition,string[]>={
  "Premier League":["eng.1"],
  Championship:["eng.2"],
  "League One":["eng.3"],
  "League Two":["eng.4"],
  International:["uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf","uefa.euro","uefa.euroq"],
}
const cache=new Map<string,{expires:number;value:any}>()

function norm(v:any){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function teamMatch(a:any,b:any){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
async function espn(url:string,ttl=45){
  const response=await fetch(url,{
    next:{revalidate:ttl},
    headers:{accept:"application/json"},
    signal:AbortSignal.timeout(6500),
  })
  if(!response.ok)throw new Error("ESPN "+response.status)
  return response.json()
}
async function findEvent(date:string,competition:Competition,home:string,away:string){
  const ymd=date.replaceAll("-","")
  for(const slug of LEAGUES[competition]??[]){
    try{
      const data=await espn("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+ymd+"&limit=300",45)
      const event=(data?.events??[]).find((event:any)=>{
        const rows=event?.competitions?.[0]?.competitors??[]
        const h=rows.find((x:any)=>x?.homeAway==="home")?.team
        const a=rows.find((x:any)=>x?.homeAway==="away")?.team
        return teamMatch(h?.displayName??h?.name,home)&&teamMatch(a?.displayName??a?.name,away)
      })
      if(event)return {slug,event}
    }catch{}
  }
  return null
}
function playerRow(row:any){
  const athlete=row?.athlete??row?.player??{}
  const formationPlaceRaw=row?.formationPlace??row?.formation_place??null
  const formationPlace=formationPlaceRaw==null?null:Number(formationPlaceRaw)
  return {
    id:String(athlete?.id??row?.id??""),
    name:String(athlete?.displayName??athlete?.fullName??athlete?.shortName??row?.displayName??"").trim(),
    shortName:String(athlete?.shortName??athlete?.displayName??athlete?.fullName??row?.displayName??"").trim(),
    number:String(row?.jersey??athlete?.jersey??row?.shirtNumber??"").trim()||null,
    position:String(
      row?.position?.abbreviation??row?.position?.displayName??
      athlete?.position?.abbreviation??athlete?.position?.displayName??""
    ).trim()||null,
    formationPlace:Number.isFinite(formationPlace)?formationPlace:null,
    starter:row?.starter===true,
    captain:row?.captain===true||row?.isCaptain===true,
    subbedIn:row?.subbedIn===true,
    subbedOut:row?.subbedOut===true,
  }
}
function teamLineup(section:any,fallbackName:string,fallbackCrest:string|null){
  const roster=(section?.roster??[]).map(playerRow).filter((p:any)=>p.name)
  const starters=roster.filter((p:any)=>p.starter).slice(0,11)
  const substitutes=roster.filter((p:any)=>!p.starter)
  const team=section?.team??section?.teamInfo??{}
  const rawFormation=String(section?.formation??section?.formationName??section?.formation?.name??"").trim()
  const formation=/^\d(?:-\d){2,4}$/.test(rawFormation)?rawFormation:rawFormation||null
  return {
    team:String(team?.displayName??team?.name??fallbackName),
    crest:String(team?.logo??team?.logos?.[0]?.href??fallbackCrest??"")||null,
    formation,
    starters,
    substitutes,
    starterCount:starters.length,
    benchAvailable:substitutes.length>0,
  }
}
function chooseSection(rosters:any[],side:"home"|"away",name:string){
  return rosters.find((x:any)=>String(x?.homeAway??x?.team?.homeAway??"").toLowerCase()===side)
    ??rosters.find((x:any)=>teamMatch(x?.team?.displayName??x?.team?.name,name))
    ??null
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  const competition=(url.searchParams.get("competition")??"Premier League") as Competition
  const refresh=url.searchParams.get("refresh")==="1"
  if(!date||!home||!away||!(competition in LEAGUES)){
    return NextResponse.json({ok:false,error:"Invalid fixture parameters"},{status:400})
  }
  const key=[date,competition,norm(home),norm(away)].join("|")
  const cached=cache.get(key)
  if(!refresh&&cached&&cached.expires>Date.now())return NextResponse.json(cached.value)

  const found=await findEvent(date,competition,home,away)
  if(!found){
    const value={ok:true,confirmed:false,lineupAvailable:false,date,competition,home,away,source:"ESPN",reason:"Fixture not found in ESPN lineup feed yet."}
    cache.set(key,{expires:Date.now()+45_000,value})
    return NextResponse.json(value)
  }

  let summary:any=null
  try{
    summary=await espn("https://site.api.espn.com/apis/site/v2/sports/soccer/"+found.slug+"/summary?event="+encodeURIComponent(String(found.event?.id??"")),20)
  }catch{}

  const rosters=Array.isArray(summary?.rosters)?summary.rosters:[]
  const contest=found.event?.competitions?.[0]??{}
  const homeComp=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="home")
  const awayComp=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="away")
  const homeSection=chooseSection(rosters,"home",home)
  const awaySection=chooseSection(rosters,"away",away)
  const homeLineup=homeSection?teamLineup(homeSection,home,homeComp?.team?.logo??null):{team:home,crest:homeComp?.team?.logo??null,formation:null,starters:[],substitutes:[],starterCount:0,benchAvailable:false}
  const awayLineup=awaySection?teamLineup(awaySection,away,awayComp?.team?.logo??null):{team:away,crest:awayComp?.team?.logo??null,formation:null,starters:[],substitutes:[],starterCount:0,benchAvailable:false}
  const confirmed=homeLineup.starterCount>=11&&awayLineup.starterCount>=11
  const lineupAvailable=homeLineup.starterCount>0||awayLineup.starterCount>0
  const value={
    ok:true,
    eventId:String(found.event?.id??""),
    source:"ESPN official match summary",
    checkedAt:new Date().toISOString(),
    date,competition,home,away,
    confirmed,lineupAvailable,
    status:String(found.event?.status?.type?.description??found.event?.status?.type?.name??""),
    venue:contest?.venue?.fullName??null,
    homeLineup,awayLineup,
    reason:confirmed
      ?"Both official starting XIs are published."
      :lineupAvailable
        ?"A partial team sheet is published; waiting for both official starting XIs."
        :"Official starting XIs are not published yet.",
  }
  cache.set(key,{expires:Date.now()+(confirmed?120_000:45_000),value})
  return NextResponse.json(value,{
    headers:{"Cache-Control":confirmed?"public, s-maxage=60, stale-while-revalidate=300":"public, s-maxage=20, stale-while-revalidate=60"}
  })
}
