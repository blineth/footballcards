import { NextResponse } from "next/server"
import { GET as oddsGET } from "../bet-builder-odds/route"

export const dynamic="force-dynamic"
export const revalidate=0

function norm(v:any){return String(v??"").toLowerCase().replace(/[^a-z0-9+.]+/g," ").trim()}
function threshold(market:string,label:string){
  const raw=(market+" "+label).toLowerCase()
  const plus=raw.match(/(?:^|\s)([1-9])\s*\+/)
  if(plus)return Number(plus[1])
  const over=raw.match(/\bover\s*([0-8])(?:\.5|,5)\b/)
  if(over)return Number(over[1])+1
  const more=norm(raw).match(/\b([1-9])\s*(?:or more|or over|and above|and over)\b/)
  return more?Number(more[1]):null
}

export async function GET(request:Request){
  const url=new URL(request.url)
  const required=["date","home","away","competition"]
  if(required.some(k=>!url.searchParams.get(k))){
    return NextResponse.json({ok:false,error:"date, home, away and competition are required"},{status:400})
  }

  const res=await oddsGET(request)
  const data=await res.json()
  if(!res.ok)return NextResponse.json(data,{status:res.status})

  const selections=Array.isArray(data?.selections)?data.selections:[]
  const books=["Bet365","Sky Bet","William Hill","Paddy Power"]
  const audit=books.map(book=>{
    const rows=selections.filter((s:any)=>s.bookmaker===book)
    const cards=rows.filter((s:any)=>s.kind==="card")
    const fouls=rows.filter((s:any)=>s.kind==="foul")
    const foulRows=fouls.map((s:any)=>({
      market:s.market,label:s.label,odds:s.odd,threshold:threshold(String(s.market??""),String(s.label??"")),
    }))
    const byThreshold=new Map<number,number[]>()
    for(const row of foulRows){
      if(row.threshold==null||row.odds==null)continue
      byThreshold.set(row.threshold,[...(byThreshold.get(row.threshold)??[]),Number(row.odds)])
    }
    const ladder=[...byThreshold.entries()]
      .map(([t,prices])=>({threshold:t,bestPrice:Math.max(...prices),prices}))
      .sort((a,b)=>a.threshold-b.threshold)
    const anomalies:string[]=[]
    for(let i=1;i<ladder.length;i++){
      if(ladder[i].bestPrice+0.03<ladder[i-1].bestPrice){
        anomalies.push(`${ladder[i].threshold}+ fouls is shorter than ${ladder[i-1].threshold}+ fouls`)
      }
    }
    return {
      bookmaker:book,
      verified:Boolean(data?.bookmakerAvailability?.[book]),
      availability:data?.bookmakerAvailability?.[book]??null,
      playerCardSelections:cards.length,
      playerFoulSelections:fouls.length,
      foulThresholds:ladder,
      cardMarkets:[...new Set(cards.map((s:any)=>String(s.market??"")))],
      foulMarkets:[...new Set(fouls.map((s:any)=>String(s.market??"")))],
      sampleCardLabels:cards.slice(0,12).map((s:any)=>({market:s.market,label:s.label,odds:s.odd})),
      sampleFoulLabels:foulRows.slice(0,20),
      anomalies,
    }
  })

  return NextResponse.json({
    ok:true,
    fixture:{date:url.searchParams.get("date"),home:url.searchParams.get("home"),away:url.searchParams.get("away"),competition:url.searchParams.get("competition")},
    source:data?.source??null,
    capturedAt:data?.capturedAt??null,
    cached:Boolean(data?.cached),
    books:audit,
    interpretation:{
      usable:"A bookmaker is suitable for the app only when its player-card and player-foul availability are both explicitly available.",
      thresholds:"A foul threshold is exact only when it can be parsed from the returned bookmaker market/selection label.",
      anomalies:"A higher foul threshold should not normally have a shorter price than a lower threshold for the same player/market ladder.",
    },
  })
}
