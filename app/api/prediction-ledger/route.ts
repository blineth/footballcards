import { NextResponse } from "next/server"
import { savePredictionLedger, type LedgerRun } from "@/lib/prediction-ledger"

export const dynamic="force-dynamic"
export const revalidate=0

export async function POST(request:Request){
  try{
    const body=await request.json().catch(()=>null)
    const runs=(Array.isArray(body?.runs)?body.runs:[]) as LedgerRun[]
    if(!runs.length)return NextResponse.json({ok:false,error:"No prediction runs supplied"},{status:400})
    if(runs.length>100)return NextResponse.json({ok:false,error:"Too many prediction runs"},{status:400})
    const cleaned=runs.filter(r=>r&&typeof r.surface==="string"&&r?.slip?.id&&Array.isArray(r.legs)&&r.legs.length)
    const result=await savePredictionLedger(cleaned)
    return NextResponse.json({ok:true,...result,capturedAt:new Date().toISOString()},{
      headers:{"Cache-Control":"no-store"}
    })
  }catch(error){
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Unable to save predictions"},{status:500})
  }
}
