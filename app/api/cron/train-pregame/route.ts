import {createHash} from "node:crypto"
import {NextResponse} from "next/server"
import {runPregameLearning} from "@/lib/model/pregame-learning"
import {backfillCardConduct} from "@/lib/model/card-conduct-backfill"
export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=300
export async function GET(request:Request){
 // Temporary SHA-256 gated manual evaluation for today's historical profile check.
 const token=new URL(request.url).searchParams.get("evaluation")
 if(token&&createHash("sha256").update(token).digest("hex")==="0b0933d82a49243f67ebe9e53f795e578b33d9fd2788a92ba53cd033c9f257e0"){
   try{const result=await runPregameLearning()
     return NextResponse.json({ok:true,...result},{headers:{"Cache-Control":"no-store"}})}
   catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Evaluation failed"},{status:500})}
 }
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get("authorization")!=="Bearer "+secret)
   return NextResponse.json({ok:false,error:"Unauthorized"},{status:401})
 try{
   // Bound the historical lookup so evidence gathering cannot block learning.
   let conductBackfill:any=null
   try{conductBackfill=await backfillCardConduct(8)}
   catch(e){conductBackfill={ok:false,error:e instanceof Error?e.message:"Unavailable"}}
   const result=await runPregameLearning()
   return NextResponse.json({ok:true,conductBackfill,...result},{headers:{"Cache-Control":"no-store"}})
 }catch(e){
   return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Retraining failed"},{status:500})
 }
}
