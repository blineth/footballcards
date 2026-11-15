import { NextResponse } from "next/server"
import { and, eq, gte } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60

const ESPN_ROOT = "https://site.api.espn.com/apis/site/v2/sports/soccer"
const FORM_START = "2024-06-01"
const SLUGS = ["uefa.euro","uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf"]

function n(value:unknown){const v=Number(value??0);return Number.isFinite(v)?v:0}
function stat(row:any,name:string){const found=(row?.stats??[]).find((s:any)=>s?.name===name);return n(found?.value??found?.displayValue)}
async function espn(slug:string,path:string){
  const r=await fetch(`${ESPN_ROOT}/${slug}/${path}`,{cache:"no-store",signal:AbortSignal.timeout(15000),headers:{accept:"application/json"}})
  if(!r.ok) throw new Error(`ESPN ${slug} ${r.status}`)
  return r.json()
}
function months(){
  const out:string[]=[]; let y=2026,m=1; const now=new Date(), ey=now.getUTCFullYear(), em=now.getUTCMonth()+1
  while(y<ey||(y===ey&&m<=em)){out.push(`${y}${String(m).padStart(2,"0")}`);m++;if(m>12){m=1;y++}}
  return out
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
    const id=String(row?.athlete?.id??"");if(id)minutes.set(id,row?.starter===true?90:0)
  }
  for(const event of summary?.keyEvents??[]){
    const type=String(event?.type?.type??event?.type?.text??"").toLowerCase().replaceAll(" ","-")
    if(type!=="substitution")continue
    const minute=minuteFromClock(event);if(minute==null)continue
    const parts=event?.participants??[]
    const incoming=String(parts?.[0]?.athlete?.id??""),outgoing=String(parts?.[1]?.athlete?.id??"")
    if(outgoing)minutes.set(outgoing,minute)
    if(incoming)minutes.set(incoming,Math.max(0,90-minute))
  }
  return minutes
}
async function completedEvents(){
  const byId=new Map<string,any>()
  for(const slug of SLUGS){
    for(const month of months()){
      try{
        const data=await espn(slug,`scoreboard?dates=${month}&limit=500`)
        for(const event of data?.events??[]){
          const id=String(event?.id??""),date=String(event?.date??"").slice(0,10)
          const complete=event?.status?.type?.completed===true||String(event?.status?.type?.state??"")==="post"
          if(!id||!complete||date<FORM_START||date>new Date().toISOString().slice(0,10))continue
          byId.set(`${slug}:${id}`,{...event,__slug:slug})
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
  const offset=Math.max(0,Number(url.searchParams.get("offset")??"0")||0)
  const limit=Math.max(1,Math.min(12,Number(url.searchParams.get("limit")??"8")||8))
  try{
    const all=await completedEvents()
    if(offset===0)await db.delete(playerH2H).where(and(eq(playerH2H.competition,"International"),gte(playerH2H.matchDate,FORM_START)))
    const selected=all.slice(offset,offset+limit)
    const results=await Promise.all(selected.map(async(event:any)=>{
      const id=String(event?.id??""),slug=String(event?.__slug??"fifa.friendly")
      const summary=await espn(slug,`summary?event=${id}`)
      const comp=summary?.header?.competitions?.[0]??event?.competitions?.[0]??{}
      const competitors=comp?.competitors??[]
      const homeRow=competitors.find((x:any)=>x?.homeAway==="home"),awayRow=competitors.find((x:any)=>x?.homeAway==="away")
      const home=String(homeRow?.team?.displayName??homeRow?.team?.name??""),away=String(awayRow?.team?.displayName??awayRow?.team?.name??"")
      const date=String(event?.date??comp?.date??"").slice(0,10),mins=minuteMap(summary)
      const rows:Array<typeof playerH2H.$inferInsert>=[]
      for(const section of summary?.rosters??[]){
        const team=String(section?.team?.displayName??section?.team?.name??""),opponent=team===home?away:home
        for(const row of section?.roster??[]){
          const name=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim(),pid=String(row?.athlete?.id??"")
          if(!name||!team||!opponent||!date)continue
          const minutes=mins.get(pid)??(row?.starter===true?90:0)
          const foulsCommitted=stat(row,"foulsCommitted"),foulsDrawn=stat(row,"foulsSuffered")
          const shots=stat(row,"totalShots"),shotsOnTarget=stat(row,"shotsOnTarget")
          const yellowCards=stat(row,"yellowCards"),redCards=stat(row,"redCards")
          const goals=stat(row,"totalGoals"),assists=stat(row,"goalAssists")
          const appeared=row?.starter===true||minutes>0||foulsCommitted>0||foulsDrawn>0||shots>0||shotsOnTarget>0||yellowCards>0||redCards>0||goals>0||assists>0
          if(!appeared)continue
          rows.push({
            playerName:name,team,opponent,matchDate:date,competition:"International",venue:team===home?"Home":"Away",
            position:row?.position?.abbreviation??row?.position?.displayName??row?.athlete?.position?.abbreviation??null,
            starter:row?.starter===true,minutes,
            foulsCommitted,foulsDrawn,shots,shotsOnTarget,
            yellowCard:yellowCards>0,redCard:redCards>0,
            goals,assists,externalPlayerId:pid||null,
          })
        }
      }
      return{id:`${slug}:${id}`,slug,date,home,away,rows}
    }))
    let rowCount=0
    for(const match of results)for(let i=0;i<match.rows.length;i+=250){const rows=match.rows.slice(i,i+250);if(rows.length){rowCount+=rows.length;await db.insert(playerH2H).values(rows).onConflictDoNothing()}}
    const nextOffset=offset+selected.length
    return NextResponse.json({ok:true,competition:"International",from:FORM_START,totalFixtures:all.length,offset,processedFixtures:selected.length,playerMatchRowsSeen:rowCount,matches:results.map(x=>({id:x.id,date:x.date,home:x.home,away:x.away,players:x.rows.length})),nextOffset,done:nextOffset>=all.length,refreshedAt:new Date().toISOString()})
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"International sync failed"},{status:502})
  }
}
