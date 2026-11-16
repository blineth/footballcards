import { NextResponse } from "next/server"
import { gradePredictionLedger, predictionPerformanceSummary } from "@/lib/prediction-ledger"

export const dynamic="force-dynamic"
export const revalidate=0

export async function GET(request:Request){
  const url=new URL(request.url)
  const days=Math.max(1,Math.min(365,Number(url.searchParams.get("days")??30)||30))
  const grade=url.searchParams.get("grade")!=="0"
  try{
    const grading=grade?await gradePredictionLedger(2000):{graded:0,runsUpdated:0}
    const performance=await predictionPerformanceSummary(days)
    return NextResponse.json({ok:true,grading,performance,updatedAt:new Date().toISOString()},{
      headers:{"Cache-Control":"no-store"}
    })
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Performance analytics unavailable"},{status:500})
  }
}
