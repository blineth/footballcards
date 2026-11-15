export type TeamStakesContext={
  team:string
  score:number
  category:"title"|"europe"|"promotion"|"playoff"|"relegation"|"qualification"|"survival"|"knockout"|"neutral"
  reason:string
  position:number|null
  points:number|null
  matchesPlayed:number|null
  matchesRemaining:number|null
  gapToBoundary:number|null
}
export type MatchStakesContext={
  available:boolean
  source:string|null
  tournament:string|null
  stage:string|null
  home:TeamStakesContext
  away:TeamStakesContext
  matchScore:number
  bothHighStakes:boolean
  reason:string
}

type TableRow={team:string;played:number;points:number;gd:number;gf:number;position:number}
const cache=new Map<string,{expires:number,value:MatchStakesContext}>()

function clamp(v:number,a=0,b=1){return Math.max(a,Math.min(b,v))}
function norm(v:any){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/&/g," and ").replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function canonicalTeam(v:any){
  return norm(v)
    .replace(/^manchester /,"man ")
    .replace(/^nottingham forest$/,"nottm forest")
    .replace(/^wolverhampton wanderers$/,"wolves")
    .replace(/^tottenham hotspur$/,"tottenham")
    .replace(/^brighton and hove albion$/,"brighton")
    .replace(/^newcastle united$/,"newcastle")
    .replace(/^west ham united$/,"west ham")
    .replace(/^leeds united$/,"leeds")
    .replace(/^sheffield wednesday$/,"sheffield wed")
    .replace(/^sheffield united$/,"sheffield utd")
    .replace(/^leicester city$/,"leicester")
    .replace(/^norwich city$/,"norwich")
    .replace(/^stoke city$/,"stoke")
    .replace(/^swansea city$/,"swansea")
    .replace(/^coventry city$/,"coventry")
    .replace(/^bristol city$/,"bristol city")
}
function sameTeam(a:any,b:any){
  const x=canonicalTeam(a),y=canonicalTeam(b)
  if(!x||!y)return false
  if(x===y||x.includes(y)||y.includes(x))return true
  const ax=new Set(x.split(" ").filter(t=>t.length>2)), ay=new Set(y.split(" ").filter(t=>t.length>2))
  const common=[...ax].filter(t=>ay.has(t)).length
  return common>=Math.min(2,Math.max(1,Math.min(ax.size,ay.size)))
}
function neutral(team:string):TeamStakesContext{
  return {team,score:0,category:"neutral",reason:"No material competition-pressure signal",position:null,points:null,matchesPlayed:null,matchesRemaining:null,gapToBoundary:null}
}
function empty(home:string,away:string):MatchStakesContext{
  return {available:false,source:null,tournament:null,stage:null,home:neutral(home),away:neutral(away),matchScore:0,bothHighStakes:false,reason:"No reliable match-stakes context available"}
}
function parseCsvLine(line:string){
  const out:string[]=[];let cur="",quoted=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if(ch==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted}
    else if(ch===","&&!quoted){out.push(cur);cur=""}
    else cur+=ch
  }
  out.push(cur);return out
}
function parseDate(value:string){
  const m=String(value??"").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if(!m)return ""
  const y=m[3].length===2?"20"+m[3]:m[3]
  return y+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0")
}
function seasonCode(date:string){
  const d=new Date(date+"T12:00:00Z"),year=d.getUTCFullYear(),month=d.getUTCMonth()+1
  const start=month>=7?year:year-1
  return String(start).slice(-2)+String(start+1).slice(-2)
}
const DOMESTIC_CONFIG:Record<string,{code:string;relegation:number;autoPromotion?:number;playoffEnd?:number;europeEnd?:number}> = {
  "Premier League":{code:"E0",relegation:3,europeEnd:6},
  "Championship":{code:"E1",relegation:3,autoPromotion:2,playoffEnd:6},
  "League One":{code:"E2",relegation:4,autoPromotion:2,playoffEnd:6},
  "League Two":{code:"E3",relegation:2,autoPromotion:3,playoffEnd:7},
}
function closeness(gap:number){
  if(gap<=1)return 1
  if(gap<=3)return .9
  if(gap<=6)return .68
  if(gap<=9)return .42
  if(gap<=12)return .20
  return 0
}
function phaseFactor(played:number,total:number){
  if(!(total>0))return .45
  const phase=clamp(played/total)
  return .32+.68*clamp((phase-.12)/.80)
}
function boundaryGap(row:TableRow,table:TableRow[],boundary:number){
  const target=table[boundary-1]
  return target?Math.abs(row.points-target.points):99
}
function domesticTeamContext(team:string,row:TableRow,table:TableRow[],cfg:(typeof DOMESTIC_CONFIG)[string]){
  const n=table.length,totalGames=Math.max(1,(n-1)*2),remaining=Math.max(0,totalGames-row.played),phase=phaseFactor(row.played,totalGames)
  const candidates:Array<{category:TeamStakesContext["category"];gap:number;reason:string;base:number}>=[]
  const leader=table[0]
  if(row.position<=5&&leader){
    const gap=Math.max(0,leader.points-row.points)
    if(gap<=12)candidates.push({category:"title",gap,reason:gap===0?"in the title race":gap+" points from the league lead",base:closeness(gap)})
  }
  if(cfg.europeEnd){
    const gap=boundaryGap(row,table,cfg.europeEnd)
    if(row.position<=cfg.europeEnd+4&&gap<=12)candidates.push({category:"europe",gap,reason:gap+" points from the European-place boundary",base:closeness(gap)})
  }
  if(cfg.autoPromotion){
    const gap=boundaryGap(row,table,cfg.autoPromotion)
    if(row.position<=cfg.autoPromotion+5&&gap<=12)candidates.push({category:"promotion",gap,reason:gap+" points from the automatic-promotion boundary",base:closeness(gap)})
  }
  if(cfg.playoffEnd){
    const gap=boundaryGap(row,table,cfg.playoffEnd)
    if(row.position<=cfg.playoffEnd+5&&gap<=12)candidates.push({category:"playoff",gap,reason:gap+" points from the play-off boundary",base:closeness(gap)*.92})
  }
  const relegationStart=n-cfg.relegation+1
  const safeBoundary=Math.max(1,relegationStart-1)
  const relegationGap=Math.min(boundaryGap(row,table,safeBoundary),boundaryGap(row,table,relegationStart))
  if(row.position>=safeBoundary-4&&relegationGap<=12){
    candidates.push({category:"relegation",gap:relegationGap,reason:relegationGap+" points from the relegation/survival boundary",base:closeness(relegationGap)*1.06})
  }
  candidates.sort((a,b)=>b.base-a.base)
  const best=candidates[0]
  if(!best)return {...neutral(team),position:row.position,points:row.points,matchesPlayed:row.played,matchesRemaining:remaining}
  const score=clamp(best.base*phase)
  return {
    team,score:Math.round(score*1000)/1000,category:best.category,
    reason:"Position "+row.position+": "+best.reason,
    position:row.position,points:row.points,matchesPlayed:row.played,matchesRemaining:remaining,gapToBoundary:best.gap,
  } satisfies TeamStakesContext
}
async function domesticStakes(date:string,competition:string,home:string,away:string){
  const cfg=DOMESTIC_CONFIG[competition]
  if(!cfg)return null
  const url="https://www.football-data.co.uk/mmz4281/"+seasonCode(date)+"/"+cfg.code+".csv"
  const response=await fetch(url,{next:{revalidate:300},signal:AbortSignal.timeout(5000)})
  if(!response.ok)return null
  const text=await response.text(),lines=text.split(/\r?\n/).filter(Boolean)
  if(lines.length<2)return null
  const headers=parseCsvLine(lines[0]).map(x=>x.replace(/^\uFEFF/,"").trim())
  const idx=(name:string)=>headers.indexOf(name)
  const hi=idx("HomeTeam"),ai=idx("AwayTeam"),hgi=idx("FTHG"),agi=idx("FTAG"),di=idx("Date")
  if([hi,ai,hgi,agi,di].some(i=>i<0))return null
  const map=new Map<string,{team:string;played:number;points:number;gf:number;ga:number}>()
  const ensure=(team:string)=>{const k=canonicalTeam(team);if(!map.has(k))map.set(k,{team,played:0,points:0,gf:0,ga:0});return map.get(k)!}
  for(const line of lines.slice(1)){
    const cells=parseCsvLine(line),matchDate=parseDate(cells[di]??"")
    if(!matchDate||matchDate>=date)continue
    const h=String(cells[hi]??"").trim(),a=String(cells[ai]??"").trim(),hg=Number(cells[hgi]),ag=Number(cells[agi])
    if(!h||!a||!Number.isFinite(hg)||!Number.isFinite(ag))continue
    const hr=ensure(h),ar=ensure(a)
    hr.played++;ar.played++;hr.gf+=hg;hr.ga+=ag;ar.gf+=ag;ar.ga+=hg
    if(hg>ag)hr.points+=3;else if(hg<ag)ar.points+=3;else{hr.points++;ar.points++}
  }
  const table=[...map.values()].map(r=>({...r,gd:r.gf-r.ga,position:0})).sort((a,b)=>b.points-a.points||b.gd-a.gd||b.gf-a.gf).map((r,i)=>({...r,position:i+1}))
  const homeRow=table.find(r=>sameTeam(r.team,home)),awayRow=table.find(r=>sameTeam(r.team,away))
  if(!homeRow||!awayRow)return null
  const hc=domesticTeamContext(home,homeRow,table,cfg),ac=domesticTeamContext(away,awayRow,table,cfg)
  let matchScore=Math.max(hc.score,ac.score)
  const sameBattle=hc.category!=="neutral"&&hc.category===ac.category&&Math.min(hc.score,ac.score)>=.45
  if(sameBattle)matchScore=clamp(matchScore+.12)
  return {
    available:true,source:"Football-Data current league table",tournament:competition,stage:"League",
    home:hc,away:ac,matchScore:Math.round(matchScore*1000)/1000,bothHighStakes:hc.score>=.6&&ac.score>=.6,
    reason:sameBattle
      ?"Both teams are directly involved in the "+hc.category+" battle."
      :[hc.score>.25?home+" "+hc.reason:null,ac.score>.25?away+" "+ac.reason:null].filter(Boolean).join(" · ")||"No strong table-pressure signal",
  } satisfies MatchStakesContext
}
async function fetchJson(url:string){
  try{
    const r=await fetch(url,{next:{revalidate:180},signal:AbortSignal.timeout(4500),headers:{accept:"application/json"}})
    if(!r.ok)return null
    return await r.json()
  }catch{return null}
}
const INTL_SLUGS=["uefa.nations","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf","uefa.euro","uefa.euroq","fifa.friendly"]
function stat(entry:any,names:string[]){
  const wanted=names.map(norm)
  for(const s of entry?.stats??[]){
    const keys=[s?.name,s?.abbreviation,s?.type,s?.displayName].map(norm)
    if(keys.some(k=>wanted.includes(k))){
      const v=Number(s?.value??s?.displayValue)
      if(Number.isFinite(v))return v
    }
  }
  return null
}
function extractStandingGroups(node:any,out:any[][]=[]):any[][]{
  if(!node||typeof node!=="object")return out
  const entries=Array.isArray(node?.standings?.entries)?node.standings.entries:Array.isArray(node?.entries)?node.entries:null
  if(entries?.length&&entries.some((e:any)=>e?.team)){
    out.push(entries)
  }
  for(const value of Object.values(node)){
    if(value&&typeof value==="object")extractStandingGroups(value,out)
  }
  return out
}
function groupTable(entries:any[]):TableRow[]{
  return entries.map((entry:any,index)=>({
    team:String(entry?.team?.displayName??entry?.team?.name??""),
    played:Number(stat(entry,["gamesplayed","gp","played"])??0),
    points:Number(stat(entry,["points","pts"])??0),
    gd:Number(stat(entry,["pointdifferential","goaldifference","gd"])??0),
    gf:Number(stat(entry,["pointsfor","goalsfor","gf"])??0),
    position:Number(stat(entry,["rank","position"])??index+1),
  })).filter(r=>r.team).sort((a,b)=>a.position-b.position)
}
function internationalCutoffs(slug:string,size:number){
  if(slug==="fifa.worldq.conmebol")return {qualify:Math.min(6,size),secondary:Math.min(7,size),survival:null}
  if(slug==="uefa.nations")return {qualify:Math.min(2,size),secondary:null,survival:Math.max(2,size-1)}
  if(slug==="fifa.world"||slug==="uefa.euro")return {qualify:Math.min(3,size),secondary:null,survival:null}
  return {qualify:Math.min(2,size),secondary:null,survival:null}
}
function intlTeamContext(team:string,row:TableRow,table:TableRow[],slug:string){
  const size=table.length,expected=Math.max(1,(size-1)*2),remaining=Math.max(0,expected-row.played),phase=phaseFactor(row.played,expected)
  const cut=internationalCutoffs(slug,size)
  const candidates:Array<{category:TeamStakesContext["category"];gap:number;reason:string;base:number}>=[]
  const qGap=boundaryGap(row,table,cut.qualify)
  if(row.position<=Math.min(size,cut.qualify+3)&&qGap<=9)candidates.push({category:"qualification",gap:qGap,reason:qGap+" points from the qualification/progression boundary",base:closeness(qGap)})
  if(cut.secondary){
    const gap=boundaryGap(row,table,cut.secondary)
    if(row.position<=Math.min(size,cut.secondary+2)&&gap<=9)candidates.push({category:"qualification",gap,reason:gap+" points from the final qualification/play-off place",base:closeness(gap)*.96})
  }
  if(cut.survival){
    const gap=Math.min(boundaryGap(row,table,cut.survival),boundaryGap(row,table,Math.min(size,cut.survival+1)))
    if(row.position>=Math.max(1,cut.survival-1)&&gap<=9)candidates.push({category:"survival",gap,reason:gap+" points from the Nations League survival/relegation boundary",base:closeness(gap)*1.04})
  }
  candidates.sort((a,b)=>b.base-a.base)
  const best=candidates[0]
  if(!best)return {...neutral(team),position:row.position,points:row.points,matchesPlayed:row.played,matchesRemaining:remaining}
  const score=clamp(best.base*(.40+.60*phase))
  return {team,score:Math.round(score*1000)/1000,category:best.category,reason:"Position "+row.position+": "+best.reason,position:row.position,points:row.points,matchesPlayed:row.played,matchesRemaining:remaining,gapToBoundary:best.gap} satisfies TeamStakesContext
}
async function internationalStakes(date:string,home:string,away:string){
  const ymd=date.replaceAll("-","")
  const boards=await Promise.all(INTL_SLUGS.map(async slug=>({slug,data:await fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+ymd+"&limit=300")})))
  let found:{slug:string;data:any;event:any}|null=null
  for(const board of boards){
    const event=(board.data?.events??[]).find((e:any)=>{
      const c=e?.competitions?.[0],rows=c?.competitors??[]
      const h=rows.find((x:any)=>x?.homeAway==="home")?.team
      const a=rows.find((x:any)=>x?.homeAway==="away")?.team
      return sameTeam(h?.displayName??h?.name,home)&&sameTeam(a?.displayName??a?.name,away)
    })
    if(event){found={...board,event};break}
  }
  if(!found)return null
  const leagueName=String(found.data?.leagues?.[0]?.name??found.data?.leagues?.[0]?.abbreviation??found.slug)
  const comp=found.event?.competitions?.[0]??{}
  const stage=String(found.event?.season?.type?.name??comp?.type?.text??comp?.type?.abbreviation??"").trim()||null
  if(found.slug==="fifa.friendly"||/friendly/i.test(leagueName)){
    return {...empty(home,away),available:true,source:"ESPN tournament context",tournament:leagueName,stage:stage??"Friendly",reason:"International friendly: no qualification or survival pressure applied"}
  }
  const stageText=norm([stage,leagueName,...(comp?.notes??[]).map((n:any)=>n?.headline??n?.text??"")].join(" "))
  if(/quarter|semi|final|round of|knockout|playoff|play off/.test(stageText)&&!/qualifying/.test(stageText)){
    const hc={...neutral(home),score:.82,category:"knockout" as const,reason:"Knockout progression is at stake"}
    const ac={...neutral(away),score:.82,category:"knockout" as const,reason:"Knockout progression is at stake"}
    return {available:true,source:"ESPN tournament stage",tournament:leagueName,stage,home:hc,away:ac,matchScore:.9,bothHighStakes:true,reason:"Knockout match: elimination/progression pressure applies"} satisfies MatchStakesContext
  }
  const season=new Date(date+"T12:00:00Z").getUTCFullYear()
  const standings=await fetchJson("https://site.api.espn.com/apis/v2/sports/soccer/"+found.slug+"/standings?season="+season)
  const groups=extractStandingGroups(standings).map(groupTable).filter(g=>g.length>=2)
  const table=groups.find(g=>g.some(r=>sameTeam(r.team,home))&&g.some(r=>sameTeam(r.team,away)))
    ??groups.find(g=>g.some(r=>sameTeam(r.team,home)))
    ??groups.find(g=>g.some(r=>sameTeam(r.team,away)))
  if(table){
    const hr=table.find(r=>sameTeam(r.team,home)),ar=table.find(r=>sameTeam(r.team,away))
    if(hr&&ar){
      const hc=intlTeamContext(home,hr,table,found.slug),ac=intlTeamContext(away,ar,table,found.slug)
      const sameBattle=hc.category!=="neutral"&&hc.category===ac.category&&Math.min(hc.score,ac.score)>=.45
      let matchScore=Math.max(hc.score,ac.score)
      if(sameBattle)matchScore=clamp(matchScore+.12)
      return {available:true,source:"ESPN tournament standings",tournament:leagueName,stage,home:hc,away:ac,matchScore:Math.round(matchScore*1000)/1000,bothHighStakes:hc.score>=.6&&ac.score>=.6,reason:sameBattle?"Both countries are directly contesting the same "+hc.category+" boundary.":[hc.score>.25?home+" "+hc.reason:null,ac.score>.25?away+" "+ac.reason:null].filter(Boolean).join(" · ")||"No strong group-table pressure signal"} satisfies MatchStakesContext
    }
  }
  const qualifier=/qualif|worldq|euroq/.test(norm(found.slug+" "+leagueName))
  const nations=found.slug==="uefa.nations"
  const fallbackScore=qualifier?.38:nations?.34:.22
  const reason=qualifier?"Qualification fixture; live table boundary could not be resolved":nations?"Nations League fixture; live group boundary could not be resolved":"Competitive international fixture"
  return {available:true,source:"ESPN tournament context",tournament:leagueName,stage,home:{...neutral(home),score:fallbackScore,category:qualifier?"qualification":"survival",reason},away:{...neutral(away),score:fallbackScore,category:qualifier?"qualification":"survival",reason},matchScore:fallbackScore,bothHighStakes:false,reason} satisfies MatchStakesContext
}
export async function getMatchStakes(input:{date:string;competition:string;home:string;away:string}):Promise<MatchStakesContext>{
  const key=[input.date,input.competition,canonicalTeam(input.home),canonicalTeam(input.away)].join("|")
  const cached=cache.get(key)
  if(cached&&cached.expires>Date.now())return cached.value
  let value:MatchStakesContext|null=null
  try{
    value=input.competition==="International"
      ?await internationalStakes(input.date,input.home,input.away)
      :await domesticStakes(input.date,input.competition,input.home,input.away)
  }catch{}
  const final=value??empty(input.home,input.away)
  cache.set(key,{expires:Date.now()+5*60*1000,value:final})
  return final
}
