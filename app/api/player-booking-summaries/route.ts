import {NextResponse} from "next/server"
import {pool,isDatabaseConfigured} from "@/lib/db"

export const dynamic="force-dynamic"
export const maxDuration=15
type InputPlayer={name:string;team:string}
type Row={player_name:string;team:string|null;opponent:string;match_date:string;yellow_card:boolean|null}
const norm=(v:string)=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(?:afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()
function sameTeam(a:string,b:string){
 const x=norm(a),y=norm(b)
 return Boolean(x&&y&&(x===y||(Math.min(x.length,y.length)>=7&&(x.includes(y)||y.includes(x)))))
}
function countBooked(rows:Row[]){
 const graded=rows.filter(r=>r.yellow_card!=null)
 return {booked:graded.filter(r=>r.yellow_card===true).length,total:rows.length,knownCardStatus:graded.length}
}
export async function POST(request:Request){
 let body:{date?:string;home?:string;away?:string;players?:InputPlayer[]}
 try{body=await request.json()}catch{return NextResponse.json({ok:false,error:"Invalid request"},{status:400})}
 const date=String(body.date??""),home=String(body.home??""),away=String(body.away??"")
 const players=Array.isArray(body.players)?body.players.slice(0,24):[]
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!home||!away||home.length>100||away.length>100||
    !players.length||players.some(p=>!p.name||!p.team||p.name.length>100||p.team.length>100))
   return NextResponse.json({ok:false,error:"Invalid fixture or player list"},{status:400})
 if(!isDatabaseConfigured)return NextResponse.json({ok:true,profiles:[],source:"unavailable"},{headers:{"Cache-Control":"no-store"}})
 try{
   const unique=[...new Set(players.map(p=>p.name.toLowerCase()))]
   // All known appearances before kickoff, including substitute appearances.
   // Crucially, no 12-match H2H or last-220-match cutoff.
   const query=await pool.query<Row&{minutes:number|null;starter:boolean|null}>(`
    SELECT player_name,team,opponent,match_date::text,yellow_card,minutes,starter
    FROM player_h2h WHERE lower(player_name)=ANY($1::text[]) AND match_date<$2::date
    AND (minutes IS NULL OR minutes>0)
    ORDER BY match_date DESC`,[unique,date])
   const profiles=players.map(p=>{
     const matches=query.rows.filter(r=>norm(r.player_name)===norm(p.name))
     const seen=new Set<string>()
     const deduped=matches.filter(r=>{
       const key=[r.match_date,norm(r.team??""),norm(r.opponent)].join("|")
       if(seen.has(key))return false
       seen.add(key);return true
     })
     const recent=deduped.filter(r=>sameTeam(r.team??"",p.team)).slice(0,5)
     const opponent=sameTeam(p.team,home)?away:home
     const h2h=deduped.filter(r=>sameTeam(r.opponent,opponent))
     return {name:p.name,team:p.team,lastFive:countBooked(recent),h2h:countBooked(h2h),
       recordedRecent:recent.length,recordedH2h:h2h.length}
   })
   return NextResponse.json({ok:true,profiles,source:"player_h2h",cutoff:date},
    {headers:{"Cache-Control":"no-store"}})
 }catch{
   return NextResponse.json({ok:false,error:"Booking summaries unavailable"},{status:503})
 }
}
