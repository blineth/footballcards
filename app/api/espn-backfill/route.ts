import {NextResponse} from "next/server"
import {db,isDatabaseConfigured} from "@/lib/db"
import {playerH2H} from "@/lib/db/schema"
import {ensureResearchSchema} from "@/lib/db/ensure-research-schema"
import {sql} from "drizzle-orm"

export const dynamic="force-dynamic"
export const maxDuration=60
const BASE="https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1"
const getJson=async(url:string)=>{
  const r=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(12000)})
  if(!r.ok)throw Error("ESPN returned "+r.status)
  return r.json()
}
const clean=(s:unknown)=>String(s??"").trim()
const metric=(stats:any[],key:string):number|null=>{
  const item=stats.find(s=>s.name===key)
  const n=Number(item?.value)
  return item&&Number.isFinite(n)?n:null
}
export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  // Only historical dates in the current Premier League season; never accept future fixtures.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<"2026-08-21"||date>="2026-11-21")
    return NextResponse.json({ok:false,error:"Date outside permitted completed-fixture window"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    const scoreboard=await getJson(BASE+"/scoreboard?dates="+date.replace(/-/g,""))
    const events=(scoreboard.events??[]).filter((e:any)=>e.status?.type?.name==="STATUS_FULL_TIME").slice(0,12)
    let inserted=0,checked=0,skipped=0,eligible=0,verified=0
    const errors:string[]=[]
    // Bounded concurrency: provider requests and Neon writes are deliberately rate limited.
    for(const event of events){
      try{
        const summary=await getJson(BASE+"/summary?event="+encodeURIComponent(clean(event.id)))
        const competition=summary.header?.competitions?.[0]
        const matchDate=clean(competition?.date??event.date).slice(0,10)
        const rosters=summary.rosters??[]
        if(matchDate!==date||rosters.length!==2){skipped++;continue}
        const teams=rosters.map((r:any)=>clean(r.team?.displayName))
        if(teams.some((t:string)=>!t)){skipped++;continue}
        const rows:any[]=[]
        for(let side=0;side<2;side++){
          const team=teams[side],opponent=teams[1-side]
          for(const player of rosters[side].roster??[]){
            const stats=player.stats??[]
            const name=clean(player.athlete?.displayName??player.athlete?.fullName)
            if(!name||metric(stats,"appearances")!==1)continue
            const fouls=metric(stats,"foulsCommitted")
            const foulsDrawn=metric(stats,"foulsSuffered")
            const shots=metric(stats,"totalShots")
            const sot=metric(stats,"shotsOnTarget")
            const yellow=metric(stats,"yellowCards")
            // Missing ESPN fields must never be converted into recorded zeroes.
            if([fouls,foulsDrawn,shots,sot,yellow].some(x=>x===null))continue
            rows.push({playerName:name,team,opponent,matchDate,competition:"Premier League",
              starter:player.starter===true,externalMatchId:"espn:"+clean(event.id),
              externalPlayerId:"espn:"+clean(player.athlete?.id),
              foulsCommitted:fouls,foulsDrawn,shots,shotsOnTarget:sot,yellowCard:yellow>0,
              redCard:(metric(stats,"redCards")??0)>0,
              goals:metric(stats,"totalGoals"),assists:metric(stats,"goalAssists")})
          }
        }
        eligible+=rows.length
        if(rows.length){
          const saved=await db.insert(playerH2H).values(rows).onConflictDoUpdate({
            target:[playerH2H.playerName,playerH2H.team,playerH2H.opponent,playerH2H.matchDate,playerH2H.competition],
            set:{
              externalMatchId:sql`excluded.external_match_id`,
              externalPlayerId:sql`excluded.external_player_id`,
              starter:sql`excluded.starter`,
              foulsCommitted:sql`excluded.fouls_committed`,
              foulsDrawn:sql`excluded.fouls_drawn`,
              shots:sql`excluded.shots`,
              shotsOnTarget:sql`excluded.shots_on_target`,
              yellowCard:sql`excluded.yellow_card`,
              redCard:sql`excluded.red_card`,
              goals:sql`excluded.goals`,
              assists:sql`excluded.assists`
            }
          }).returning({id:playerH2H.id})
          verified+=saved.length
        }
        checked++
      }catch(e){errors.push(clean(event.id)+": "+String((e as any)?.cause?.message??(e as any)?.message??e).slice(-850))}
    }
    return NextResponse.json({ok:true,date,events:events.length,checked,inserted,verified,eligible,skipped,errors,source:"ESPN verified completed-match player boxscores"},{headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({ok:false,error:String(e).slice(0,200)},{status:502})}
}
