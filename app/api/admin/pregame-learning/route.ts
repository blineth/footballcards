import {NextResponse} from "next/server"
import {latestPregameLearning} from "@/lib/model/pregame-learning"
export const dynamic="force-dynamic"
export const revalidate=0
export async function GET(){
 try{
  const result=await latestPregameLearning()
  return NextResponse.json({ok:true,available:Boolean(result),run:result??null},
   {headers:{"Cache-Control":"no-store"}})
 }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Learning report unavailable"},{status:500})}
}
