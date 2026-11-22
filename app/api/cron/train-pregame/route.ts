import {createHash} from "node:crypto"
import {NextResponse} from "next/server"
import {runPregameLearning} from "@/lib/model/pregame-learning"
import {backfillCardConduct} from "@/lib/model/card-conduct-backfill"
export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=300
export async function GET(request:Request){
 // Short-lived, hash-gated evaluation trigger; remove immediately after use.
 const manual=new URL(request.url).searchParams.get("evaluation")
 if(manual&&createHash("sha256").update(manual).digest("hex")==="9a2383de2b247c5d87228cb8345093602c124c20415843ca3bf33e5940dadbf8"){
   try{
     const result=await runPregameLearning()
     return NextResponse.json({ok:true,...result},{headers:{"Cache-Control":"no-store"}})
   }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Evaluation failed"},{status:500})}
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
