import {NextResponse} from "next/server"
import {inArray,lt,and,sql} from "drizzle-orm"
import {db,isDatabaseConfigured} from "@/lib/db"
import {playerH2H} from "@/lib/db/schema"

export const dynamic="force-dynamic"
export const revalidate=0

const norm=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")
const dateString=(v:unknown)=>String(v??"").slice(0,10)
export async function GET(request:Request){
  const url=new URL(request.url)
  const date=url.searchParams.get("date")??""
  const names=url.searchParams.getAll("player").filter(Boolean).slice(0,60)
  const home=url.searchParams.get("home")??""
  const away=url.searchParams.get("away")??""
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!names.length||!home||!away)
    return NextResponse.json({ok:false,error:"Date, teams and player names required"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Player history database unavailable"},{status:503})
  try{
    // Read-only, dated source records; no fabricated zero-stat matches.
    const rows=await db.select().from(playerH2H).where(and(lt(playerH2H.matchDate,date),inArray(sql<string>`regexp_replace(translate(lower(${playerH2H.playerName}), 'áàâãäåéèêëíìîïóòôõöúùûüçñø', 'aaaaaaeeeeiiiiooooouuuucno'), '[^a-z0-9]', '', 'g')`,names.map(norm))))
    const result=names.map(name=>{
      const matched=rows.filter(r=>norm(r.playerName)===norm(name))
      const teamRows=matched.filter(r=>norm(r.team)===norm(home)||norm(r.team)===norm(away))
      const eligible=teamRows.length?teamRows:matched
      const ordered=[...eligible].sort((a,b)=>dateString(b.matchDate).localeCompare(dateString(a.matchDate)))
      const toLog=(r:typeof playerH2H.$inferSelect)=>({
        date:dateString(r.matchDate),opponent:String(r.opponent??""),
        fouls:r.foulsCommitted===null?null:Number(r.foulsCommitted),foulsWon:r.foulsDrawn===null?null:Number(r.foulsDrawn),
        shots:r.shots===null?null:Number(r.shots),shotsOnTarget:r.shotsOnTarget===null?null:Number(r.shotsOnTarget),
        yellow:r.yellowCard===null?null:r.yellowCard===true,
      })
      const h2h=ordered.filter(r=>
        (norm(r.team??"")===norm(home)&&norm(r.opponent)===norm(away))||
        (norm(r.team??"")===norm(away)&&norm(r.opponent)===norm(home))
      )
      return {name,recentGameLog:ordered.slice(0,5).map(toLog).reverse(),
        h2hGameLog:h2h.slice(0,5).map(toLog),h2hMeetings:h2h.length,h2hNoRecordedAppearances:h2h.length===0,sampleMatches:eligible.length,
        seasonMatches:eligible.filter(r=>dateString(r.matchDate)>=date.slice(0,4)+"-08-01").length}
    })
    return NextResponse.json({ok:true,players:result,source:"Stored dated player match records",completeFive:result.filter(p=>p.recentGameLog.length===5).length},{headers:{"Cache-Control":"no-store"}})
  }catch{
    return NextResponse.json({ok:false,error:"Historical player records could not be retrieved"},{status:503})
  }
}
