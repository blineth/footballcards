import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60

const ESPN_ROOT = "https://site.api.espn.com/apis/site/v2/sports/soccer"

type DatasetConfig={
  label:string
  sources:Array<{slug:string;months:string[]}>
}

const DATASETS:Record<string,DatasetConfig>={
  euro:{
    label:"UEFA European Championship",
    sources:[{slug:"uefa.euro",months:["201606","201607","202106","202107","202406","202407"]}],
  },
  "euro-qualifiers":{
    label:"UEFA European Championship qualifying",
    sources:[{slug:"uefa.euroq",months:[
      "202303","202306","202309","202310","202311","202403"
    ]}],
  },
  nations:{
    label:"UEFA Nations League",
    sources:[{slug:"uefa.nations",months:[
      "202206","202209","202306",
      "202409","202410","202411","202503","202506",
      "202609","202610","202611"
    ]}],
  },
  "world-cup":{
    label:"FIFA World Cup",
    sources:[{slug:"fifa.world",months:["202211","202212"]}],
  },
  "world-cup-uefa-qualifiers":{
    label:"FIFA World Cup UEFA qualifying",
    sources:[{slug:"fifa.worldq.uefa",months:[
      "202503","202506","202509","202510","202511","202603"
    ]}],
  },
}

function n(value:unknown){const v=Number(value??0);return Number.isFinite(v)?v:0}
function stat(row:any,name:string){const found=(row?.stats??[]).find((s:any)=>s?.name===name);return n(found?.value??found?.displayValue)}
async function espn(slug:string,path:string){
  const r=await fetch(`${ESPN_ROOT}/${slug}/${path}`,{cache:"no-store",signal:AbortSignal.timeout(15000),headers:{accept:"application/json"}})
  if(!r.ok)throw new Error(`ESPN ${slug} ${r.status}`)
  return r.json()
}
function minuteFromClock(event:any){
  const seconds=Number(event?.clock?.value??NaN)
  if(Number.isFinite(seconds))return Math.max(0,Math.min(120,Math.floor(seconds/60)))
  const match=String(event?.clock?.displayValue??"").match(/(\d+)/)
  return match?Math.max(0,Math.min(120,Number(match[1]))):null
}
function minuteMap(summary:any){
  const minutes=new Map<string,number>()
  for(const section of summary?.rosters??[])for(const row of section?.roster??[]){
    const id=String(row?.athlete?.id??"")
    if(id)minutes.set(id,row?.starter===true?90:0)
  }
  for(const event of summary?.keyEvents??[]){
    const type=String(event?.type?.type??event?.type?.text??"").toLowerCase().replaceAll(" ","-")
    if(type!=="substitution")continue
    const minute=minuteFromClock(event)
    if(minute==null)continue
    const parts=event?.participants??[]
    const incoming=String(parts?.[0]?.athlete?.id??"")
    const outgoing=String(parts?.[1]?.athlete?.id??"")
    if(outgoing)minutes.set(outgoing,minute)
    if(incoming)minutes.set(incoming,Math.max(0,90-minute))
  }
  for(const event of summary?.keyEvents??[]){
    const type=String(event?.type?.type??event?.type?.text??"").toLowerCase()
    if(!type.includes("red"))continue
    const minute=minuteFromClock(event)
    const id=String(event?.participants?.[0]?.athlete?.id??"")
    if(id&&minute!=null)minutes.set(id,Math.min(minutes.get(id)??90,minute))
  }
  return minutes
}

async function completedEvents(config:DatasetConfig){
  const byId=new Map<string,any>()
  for(const source of config.sources){
    for(const month of source.months){
      try{
        const data=await espn(source.slug,`scoreboard?dates=${month}&limit=500`)
        for(const event of data?.events??[]){
          const id=String(event?.id??"")
          const date=String(event?.date??"").slice(0,10)
          const completed=event?.status?.type?.completed===true||String(event?.status?.type?.state??"")==="post"
          if(!id||!date||!completed)continue
          byId.set(`${source.slug}:${id}`,{...event,__slug:source.slug,__dataset:config.label})
        }
      }catch{}
    }
  }
  return [...byId.values()].sort((a,b)=>String(a?.date??"").localeCompare(String(b?.date??"")))
}

export async function GET(request:Request){
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not connected"},{status:503})
  await ensureResearchSchema()
  const url=new URL(request.url)
  const dataset=String(url.searchParams.get("dataset")??"euro").toLowerCase()
  const config=DATASETS[dataset]
  if(!config)return NextResponse.json({ok:false,error:"Unknown dataset",availableDatasets:Object.keys(DATASETS)},{status:400})
  const offset=Math.max(0,Number(url.searchParams.get("offset")??"0")||0)
  const limit=Math.max(1,Math.min(15,Number(url.searchParams.get("limit")??"10")||10))

  try{
    const all=await completedEvents(config)
    const selected=all.slice(offset,offset+limit)
    const results=await Promise.all(selected.map(async(event:any)=>{
      const id=String(event?.id??"")
      const slug=String(event?.__slug??"")
      const summary=await espn(slug,`summary?event=${id}`)
      const comp=summary?.header?.competitions?.[0]??event?.competitions?.[0]??{}
      const competitors=comp?.competitors??[]
      const homeRow=competitors.find((x:any)=>x?.homeAway==="home")
      const awayRow=competitors.find((x:any)=>x?.homeAway==="away")
      const home=String(homeRow?.team?.displayName??homeRow?.team?.name??"")
      const away=String(awayRow?.team?.displayName??awayRow?.team?.name??"")
      const date=String(event?.date??comp?.date??"").slice(0,10)
      const mins=minuteMap(summary)
      const rows:Array<typeof playerH2H.$inferInsert>=[]

      for(const section of summary?.rosters??[]){
        const team=String(section?.team?.displayName??section?.team?.name??"")
        const opponent=team===home?away:home
        for(const row of section?.roster??[]){
          const name=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim()
          const pid=String(row?.athlete?.id??"")
          if(!name||!team||!opponent||!date)continue
          const minutes=mins.get(pid)??(row?.starter===true?90:0)
          const foulsCommitted=stat(row,"foulsCommitted")
          const foulsDrawn=stat(row,"foulsSuffered")
          const shots=stat(row,"totalShots")
          const shotsOnTarget=stat(row,"shotsOnTarget")
          const yellowCards=stat(row,"yellowCards")
          const redCards=stat(row,"redCards")
          const goals=stat(row,"totalGoals")
          const assists=stat(row,"goalAssists")
          const appeared=row?.starter===true||minutes>0||foulsCommitted>0||foulsDrawn>0||shots>0||shotsOnTarget>0||yellowCards>0||redCards>0||goals>0||assists>0
          if(!appeared)continue
          rows.push({
            playerName:name,team,opponent,matchDate:date,competition:"International",
            venue:team===home?"Home":"Away",
            position:row?.position?.abbreviation??row?.position?.displayName??row?.athlete?.position?.abbreviation??null,
            starter:row?.starter===true,minutes,
            foulsCommitted,foulsDrawn,shots,shotsOnTarget,
            yellowCard:yellowCards>0,redCard:redCards>0,goals,assists,
            externalPlayerId:pid||null,
          })
        }
      }
      return{id:`${slug}:${id}`,slug,dataset:config.label,date,home,away,rows}
    }))

    let rowCount=0
    for(const match of results){
      for(let i=0;i<match.rows.length;i+=250){
        const rows=match.rows.slice(i,i+250)
        if(!rows.length)continue
        rowCount+=rows.length
        await db.insert(playerH2H).values(rows).onConflictDoNothing()
      }
    }

    const nextOffset=offset+selected.length
    return NextResponse.json({
      ok:true,dataset,label:config.label,totalFixtures:all.length,offset,
      processedFixtures:selected.length,playerMatchRowsSeen:rowCount,
      matches:results.map(x=>({id:x.id,date:x.date,home:x.home,away:x.away,players:x.rows.length})),
      nextOffset,done:nextOffset>=all.length,availableDatasets:Object.keys(DATASETS),
      refreshedAt:new Date().toISOString(),
    })
  }catch(error){
    return NextResponse.json({ok:false,dataset,error:error instanceof Error?error.message:"International history sync failed"},{status:502})
  }
}
