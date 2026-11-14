import fs from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerBaselines } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

function parseCSV(text:string){
  const rows:string[][]=[]; let field=""; let row:string[]=[]; let quoted=false
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(quoted){
      if(c==='"'){ if(text[i+1]==='"'){field+='"';i++} else quoted=false } else field+=c
    } else if(c==='"') quoted=true
    else if(c===","){row.push(field);field=""}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);field="";if(row.some(v=>v.trim()))rows.push(row);row=[]}
    else field+=c
  }
  if(field||row.length){row.push(field);if(row.some(v=>v.trim()))rows.push(row)}
  const h=rows[0]?.map(x=>x.trim().replace(/^\uFEFF/,""))??[]
  return rows.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]??"").trim()])))
}
const int=(v:string|undefined)=>!v?null:Number.isFinite(Number(v))?Math.trunc(Number(v)):null
const dec=(v:string|undefined)=>!v?null:Number.isFinite(Number(v))?String(Number(v)):null
const str=(v:string|undefined)=>!v?.trim()?null:v.trim()

export async function GET(request:Request){
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not connected"},{status:503})
  await ensureResearchSchema()
  const url=new URL(request.url)
  const offset=Math.max(0,Number(url.searchParams.get("offset")??"0")||0)
  const limit=Math.max(1,Math.min(1000,Number(url.searchParams.get("limit")??"1000")||1000))
  const file=path.join(process.cwd(),"data","previous-season","player_baselines_2025_26.csv")
  const rows=parseCSV(await fs.readFile(file,"utf8"))
  const competitions=[...new Set(rows.map(r=>r.competition).filter(Boolean))]
  if(offset===0){
    for(const competition of competitions){
      await db.delete(playerBaselines).where(and(eq(playerBaselines.competition,competition),eq(playerBaselines.season,"2025/26")))
    }
  }
  const slice=rows.slice(offset,offset+limit)
  if(slice.length){
    await db.insert(playerBaselines).values(slice.map(r=>({
      playerName:r.player_name,
      team:r.team,
      competition:r.competition,
      season:r.season,
      appearances:int(r.appearances),
      starts:int(r.starts),
      minutes:int(r.minutes),
      yellowCards:int(r.yellow_cards),
      redCards:int(r.red_cards),
      goals:int(r.goals),
      assists:int(r.assists),
      foulsCommitted:int(r.fouls_committed),
      foulsDrawn:int(r.fouls_drawn),
      shots:int(r.shots),
      shotsOnTarget:int(r.shots_on_target),
      foulsPer90:dec(r.fouls_per_90),
      cardsPer90:dec(r.cards_per_90),
      shotsPer90:dec(r.shots_per_90),
      shotsOnTargetPer90:dec(r.shots_on_target_per_90),
      position:str(r.position),
      externalPlayerId:str(r.external_player_id),
    }))).onConflictDoNothing()
  }
  const nextOffset=offset+slice.length
  return NextResponse.json({ok:true,season:"2025/26",competitions,total:rows.length,processed:slice.length,nextOffset,done:nextOffset>=rows.length})
}
