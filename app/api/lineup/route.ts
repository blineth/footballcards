import { NextResponse } from "next/server"

export const dynamic="force-dynamic"
export const revalidate=0

const ESPN_INTL_SLUGS=["uefa.euro","uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf"]
const ESPN_LEAGUE_SLUGS:Record<string,string>={
  "Premier League":"eng.1",
  "Championship":"eng.2",
  "League One":"eng.3",
  "League Two":"eng.4",
}

function norm(value:any){
  return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
}
function sameTeam(a:any,b:any){
  const x=norm(a).replace(/\b(afc|fc)\b/g,"").trim()
  const y=norm(b).replace(/\b(afc|fc)\b/g,"").trim()
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function formationValue(section:any){
  const values=[
    section?.formation,
    section?.formation?.displayValue,
    section?.formation?.name,
    section?.team?.formation,
    section?.team?.formation?.displayValue,
  ]
  for(const value of values){
    const text=typeof value==="string"?value.trim():""
    if(/^\d(?:-\d){2,4}$/.test(text))return text
  }
  return null
}
function positionCode(row:any){
  return String(
    row?.position?.abbreviation??
    row?.position?.name??
    row?.athlete?.position?.abbreviation??
    row?.athlete?.position?.name??
    ""
  ).trim()||null
}
function positionGroup(position:string|null){
  const p=norm(position)
  if(!p)return "other"
  if(p==="gk"||p.includes("goal"))return "gk"
  if(p.includes("back")||p.includes("def")||["cb","lb","rb","lwb","rwb"].includes(p))return "def"
  if(p.includes("mid")||["dm","cm","am","lm","rm","cdm","cam"].includes(p))return "mid"
  if(p.includes("forward")||p.includes("striker")||p.includes("wing")||["f","st","cf","lw","rw","lf","rf","ss"].includes(p))return "att"
  return "other"
}
function playerRow(row:any){
  const athlete=row?.athlete??{}
  const position=positionCode(row)
  return {
    id:String(athlete?.id??""),
    name:String(athlete?.displayName??athlete?.fullName??athlete?.shortName??"").trim(),
    shortName:String(athlete?.shortName??athlete?.displayName??athlete?.fullName??"").trim(),
    jersey:String(row?.jersey??athlete?.jersey??"").trim()||null,
    position,
    group:positionGroup(position),
    starter:row?.starter===true,
    captain:row?.captain===true,
    headshot:athlete?.headshot?.href??null,
  }
}
function inferredFormation(players:Array<ReturnType<typeof playerRow>>){
  const defs=players.filter(p=>p.group==="def").length
  const mids=players.filter(p=>p.group==="mid").length
  const atts=players.filter(p=>p.group==="att").length
  if(defs>=3&&mids>=2&&atts>=1&&defs+mids+atts>=9)return [defs,mids,atts].join("-")
  return null
}
function sortStarters(players:Array<ReturnType<typeof playerRow>>){
  const order:Record<string,number>={gk:0,def:1,mid:2,att:3,other:4}
  return [...players].sort((a,b)=>(order[a.group]??9)-(order[b.group]??9)||Number(a.jersey??99)-Number(b.jersey??99))
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  const competition=url.searchParams.get("competition")??"Premier League"
  if(!date||!home||!away)return NextResponse.json({ok:false,error:"Missing fixture parameters"},{status:400})

  const slugs=competition==="International"
    ?ESPN_INTL_SLUGS
    :[ESPN_LEAGUE_SLUGS[competition]].filter(Boolean)
  const ymd=date.replaceAll("-","")

  for(const slug of slugs){
    try{
      const board=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+ymd+"&limit=300",{
        next:{revalidate:20},signal:AbortSignal.timeout(4500),headers:{accept:"application/json"},
      })
      if(!board.ok)continue
      const data=await board.json()
      const event=(data?.events??[]).find((e:any)=>{
        const competitors=e?.competitions?.[0]?.competitors??[]
        const h=competitors.find((x:any)=>x?.homeAway==="home")?.team
        const a=competitors.find((x:any)=>x?.homeAway==="away")?.team
        return sameTeam(h?.displayName??h?.name,home)&&sameTeam(a?.displayName??a?.name,away)
      })
      if(!event?.id)continue

      const summaryRes=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/summary?event="+encodeURIComponent(String(event.id)),{
        next:{revalidate:20},signal:AbortSignal.timeout(4500),headers:{accept:"application/json"},
      })
      if(!summaryRes.ok)continue
      const summary=await summaryRes.json()
      const rosters=Array.isArray(summary?.rosters)?summary.rosters:[]
      const section=(side:"home"|"away")=>rosters.find((r:any)=>r?.homeAway===side)
        ??rosters.find((r:any)=>sameTeam(r?.team?.displayName??r?.team?.name,side==="home"?home:away))

      const build=(side:"home"|"away",fallbackName:string)=>{
        const sec=section(side)
        const rows=Array.isArray(sec?.roster)?sec.roster:[]
        const all=rows.map(playerRow).filter((p:any)=>p.name)
        const starters=sortStarters(all.filter((p:any)=>p.starter))
        const subs=all.filter((p:any)=>!p.starter)
        const supplied=formationValue(sec)
        const inferred=supplied?null:inferredFormation(starters)
        return {
          team:String(sec?.team?.displayName??sec?.team?.name??fallbackName),
          formation:supplied??inferred,
          formationSource:supplied?"official-feed":inferred?"position-inferred":null,
          crest:sec?.team?.logos?.[0]?.href??null,
          starters,
          substitutes:subs,
        }
      }

      const homeSheet=build("home",home)
      const awaySheet=build("away",away)
      const confirmed=homeSheet.starters.length>=11&&awaySheet.starters.length>=11
      return NextResponse.json({
        ok:true,
        confirmed,
        eventId:String(event.id),
        source:"ESPN official match sheet",
        checkedAt:new Date().toISOString(),
        competition,
        home:homeSheet,
        away:awaySheet,
      },{
        headers:{"Cache-Control":"public, s-maxage=20, stale-while-revalidate=60"}
      })
    }catch{}
  }

  return NextResponse.json({
    ok:true,confirmed:false,source:"ESPN official match sheet",checkedAt:new Date().toISOString(),competition,
    home:{team:home,formation:null,formationSource:null,crest:null,starters:[],substitutes:[]},
    away:{team:away,formation:null,formationSource:null,crest:null,starters:[],substitutes:[]},
  },{headers:{"Cache-Control":"public, s-maxage=20, stale-while-revalidate=60"}})
}
