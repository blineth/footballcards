import { readFile } from "node:fs/promises"
import path from "node:path"

export type SnapshotH2HRow={
  player_name:string;team:string;opponent:string;match_date:string;competition:string;venue:string;
  minutes:number;goals:number;assists:number;fouls_committed:number;fouls_drawn:number;shots:number;
  shots_on_target:number;yellow_card:boolean;red_card:boolean;external_player_id:string
}
export type SnapshotBaseline={
  player_name:string;team:string;competition:string;season:string;appearances:number;starts:number;minutes:number;
  goals:number;assists:number;yellow_cards:number;red_cards:number;fouls_committed:number;fouls_drawn:number;
  shots:number;shots_on_target:number;fouls_per_90:number;cards_per_90:number;shots_per_90:number;
  shots_on_target_per_90:number;position:string;external_player_id:string
}

let h2hCache:SnapshotH2HRow[]|null=null
let baselineCache:SnapshotBaseline[]|null=null
let internationalCache:any|null=null
let loadedAt=0
const MAX_AGE=15*60*1000

function parseCsvLine(line:string){
  const out:string[]=[]
  let current="",quoted=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if(ch==='"'){
      if(quoted&&line[i+1]==='"'){current+='"';i++}
      else quoted=!quoted
    }else if(ch===","&&!quoted){out.push(current);current=""}
    else current+=ch
  }
  out.push(current)
  return out
}
function parseCsv(text:string){
  const lines=text.split(/\r?\n/).filter(Boolean)
  if(!lines.length)return [] as Record<string,string>[]
  const headers=parseCsvLine(lines[0])
  return lines.slice(1).map(line=>{
    const values=parseCsvLine(line),row:Record<string,string>={}
    headers.forEach((h,i)=>row[h]=values[i]??"")
    return row
  })
}
function num(v:any){const n=Number(v);return Number.isFinite(n)?n:0}
function bool(v:any){return ["1","true","yes","y"].includes(String(v??"").toLowerCase())}
async function load(){
  if(h2hCache&&baselineCache&&Date.now()-loadedAt<MAX_AGE)return
  const root=process.cwd()
  const [h2hText,baselineText]=await Promise.all([
    readFile(path.join(root,"data","current-season","h2h.csv"),"utf8"),
    readFile(path.join(root,"data","current-season","player_baselines.csv"),"utf8"),
  ])
  h2hCache=parseCsv(h2hText).map(r=>({
    player_name:r.player_name,team:r.team,opponent:r.opponent,match_date:r.match_date,competition:r.competition,venue:r.venue,
    minutes:num(r.minutes),goals:num(r.goals),assists:num(r.assists),fouls_committed:num(r.fouls_committed),
    fouls_drawn:num(r.fouls_drawn),shots:num(r.shots),shots_on_target:num(r.shots_on_target),
    yellow_card:bool(r.yellow_card),red_card:bool(r.red_card),external_player_id:r.external_player_id,
  }))
  baselineCache=parseCsv(baselineText).map(r=>({
    player_name:r.player_name,team:r.team,competition:r.competition,season:r.season,appearances:num(r.appearances),starts:num(r.starts),
    minutes:num(r.minutes),goals:num(r.goals),assists:num(r.assists),yellow_cards:num(r.yellow_cards),red_cards:num(r.red_cards),
    fouls_committed:num(r.fouls_committed),fouls_drawn:num(r.fouls_drawn),shots:num(r.shots),shots_on_target:num(r.shots_on_target),
    fouls_per_90:num(r.fouls_per_90),cards_per_90:num(r.cards_per_90),shots_per_90:num(r.shots_per_90),
    shots_on_target_per_90:num(r.shots_on_target_per_90),position:r.position,external_player_id:r.external_player_id,
  }))
  loadedAt=Date.now()
}
export async function snapshotH2H(){
  await load();return h2hCache??[]
}
export async function snapshotBaselines(){
  await load();return baselineCache??[]
}
export async function snapshotRowsForCompetition(competition:string,from?:string,to?:string){
  const rows=await snapshotH2H()
  return rows.filter(r=>r.competition===competition&&(!from||r.match_date>=from)&&(!to||r.match_date<to))
}
export async function snapshotPlayersForFixture(competition:string,home:string,away:string){
  const n=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()
  const same=(a:string,b:string)=>{const x=n(a),y=n(b);return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))}
  const [baselines,h2h]=await Promise.all([snapshotBaselines(),snapshotH2H()])
  const players=baselines.filter(r=>r.competition===competition&&(same(r.team,home)||same(r.team,away)))
  const rows=h2h.filter(r=>r.competition===competition&&(same(r.team,home)||same(r.team,away)))
  return {players,rows}
}


async function loadInternational(){
  if(internationalCache&&Date.now()-loadedAt<MAX_AGE)return internationalCache
  const text=await readFile(path.join(process.cwd(),"data","international","player_profiles.json"),"utf8")
  internationalCache=JSON.parse(text)
  return internationalCache
}
export async function internationalPlayersForFixture(home:string,away:string){
  const data=await loadInternational()
  const n=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
  const same=(a:string,b:string)=>{const x=n(a),y=n(b);return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))}
  const players=Array.isArray(data?.players)?data.players:[]
  return players.filter((p:any)=>same(String(p?.nationalTeam??""),home)||same(String(p?.nationalTeam??""),away))
}
