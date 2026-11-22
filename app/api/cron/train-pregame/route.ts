import {NextResponse} from "next/server"
import {runPregameLearning} from "@/lib/model/pregame-learning"
export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=300
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET
 if(!secret||request.headers.get("authorization")!=="Bearer "+secret)
   return NextResponse.json({ok:false,error:"Unauthorized"},{status:401})
 try{
   const result=await runPregameLearning()
   return NextResponse.json({ok:true,...result},{headers:{"Cache-Control":"no-store"}})
 }catch(e){
   return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Retraining failed"},{status:500})
 }
}
