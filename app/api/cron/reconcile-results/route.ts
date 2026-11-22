import {NextResponse} from "next/server"
import {GET as importResults} from "@/app/api/admin/import-match-results/route"

export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=300

export async function GET(request:Request){
  const secret=process.env.CRON_SECRET
  if(!secret||request.headers.get("authorization")!=="Bearer "+secret)
    return NextResponse.json({ok:false,error:"Unauthorized"},{status:401})
  // 05:00 UTC is safely after midnight in both UK time zones.
  const day=new Date()
  day.setUTCDate(day.getUTCDate()-1)
  const date=day.toISOString().slice(0,10)
  const started=Date.now()
  let offset=0,imported=0,gradedPlayer=0,gradedMatch=0,finished=0
  const errors:string[]=[]
  let complete=false
  // Each batch is small enough for the provider and Neon; stop before the
  // platform timeout rather than pretending a partial import is complete.
  for(let batch=0;batch<50&&Date.now()-started<255_000;batch++){
    const q=new URLSearchParams({date,offset:String(offset),limit:"4"})
    const response=await importResults(new Request("http://internal/api/admin/import-match-results?"+q,{
      headers:{authorization:"Bearer "+secret},
    }))
    const data=await response.json()
    if(!response.ok||!data.ok){
      errors.push(String(data.error??"Import failed"))
      break
    }
    finished=Number(data.totalFinished??0)
    for(const row of data.results??[]){
      imported+=Number(row.imported??0)
      if(row.status==="error")errors.push(String(row.fixture??"Fixture")+": "+String(row.error??"error"))
    }
    gradedPlayer+=Number(data.graded?.player??0)
    gradedMatch+=Number(data.graded?.match??0)
    if(data.nextOffset==null){complete=true;break}
    offset=Number(data.nextOffset)
  }
  return NextResponse.json({ok:complete&&errors.length===0,date,complete,
    totalFinished:finished,processedToOffset:offset,
    importedPlayerRows:imported,gradedPlayerLegs:gradedPlayer,
    gradedMatchLegs:gradedMatch,errors,
    durationMs:Date.now()-started},{headers:{"Cache-Control":"no-store"}})
}
