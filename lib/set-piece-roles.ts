export type SetPieceRole={
  player:string
  team:string
  penaltiesOrder:number|null
  directFreeKicksOrder:number|null
  cornersOrder:number|null
  confidence:"high"|"medium"|"low"
  source:string
  evidence:string[]
}
export type SetPieceContext={
  available:boolean
  source:string|null
  roles:SetPieceRole[]
  fetchedAt:string
}

const cache=new Map<string,{expires:number,value:SetPieceContext}>()

function norm(v:any){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function sameTeam(a:any,b:any){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function nameMatch(a:any,b:any){
  const x=norm(a),y=norm(b)
  if(!x||!y)return false
  if(x===y||x.includes(y)||y.includes(x))return true
  const xa=x.split(" "),ya=y.split(" ")
  return xa.length>1&&ya.length>1&&xa.at(-1)===ya.at(-1)
}
function orderValue(v:any){
  const n=Number(v)
  return Number.isFinite(n)&&n>0?n:null
}
function confidenceForOrders(values:Array<number|null>){
  const best=Math.min(...values.filter((v):v is number=>v!=null),99)
  return best===1?"high":best===2?"medium":"low"
}
async function fetchJson(url:string,timeout=4500){
  try{
    const r=await fetch(url,{next:{revalidate:300},signal:AbortSignal.timeout(timeout),headers:{accept:"application/json"}})
    if(!r.ok)return null
    return await r.json()
  }catch{return null}
}

async function premierLeagueRoles(home:string,away:string,playersByTeam:Record<string,string[]>){
  const data=await fetchJson("https://fantasy.premierleague.com/api/bootstrap-static/",5000)
  const teams=new Map<number,string>((data?.teams??[]).map((t:any)=>[Number(t.id),String(t.name??t.short_name??"")]))
  const roles:SetPieceRole[]=[]
  for(const p of data?.elements??[]){
    const team=teams.get(Number(p.team))??""
    if(!sameTeam(team,home)&&!sameTeam(team,away))continue
    const candidates=Object.entries(playersByTeam).find(([t])=>sameTeam(t,team))?.[1]??[]
    const full=String([p.first_name,p.second_name].filter(Boolean).join(" ")).trim()
    const web=String(p.web_name??"").trim()
    const matched=candidates.find(name=>nameMatch(name,full)||nameMatch(name,web))
    if(!matched)continue
    const penaltiesOrder=orderValue(p.penalties_order)
    const directFreeKicksOrder=orderValue(p.direct_freekicks_order)
    const cornersOrder=orderValue(p.corners_and_indirect_freekicks_order)
    if(!penaltiesOrder&&!directFreeKicksOrder&&!cornersOrder)continue
    const evidence:string[]=[]
    if(penaltiesOrder)evidence.push("Penalty priority "+penaltiesOrder)
    if(directFreeKicksOrder)evidence.push("Direct free-kick priority "+directFreeKicksOrder)
    if(cornersOrder)evidence.push("Corner/indirect free-kick priority "+cornersOrder)
    roles.push({
      player:matched,team:team,penaltiesOrder,directFreeKicksOrder,cornersOrder,
      confidence:confidenceForOrders([penaltiesOrder,directFreeKicksOrder,cornersOrder]),
      source:"Fantasy Premier League current set-piece order",evidence,
    })
  }
  return roles
}

const ESPN_SLUGS:Record<string,string[]>={
  "Championship":["eng.2"],
  "League One":["eng.3"],
  "League Two":["eng.4"],
  "International":["uefa.nations","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf","uefa.euro","uefa.euroq","fifa.friendly"],
}
function collectStrings(node:any,out:string[]=[]){
  if(node==null)return out
  if(typeof node==="string"){if(node.length>=5&&node.length<=500)out.push(node);return out}
  if(Array.isArray(node)){for(const v of node)collectStrings(v,out);return out}
  if(typeof node==="object"){
    for(const [k,v] of Object.entries(node)){
      if(["text","shortText","description","headline","detail","playText","type"].includes(k)&&typeof v==="string")out.push(v)
      else if(typeof v==="object")collectStrings(v,out)
    }
  }
  return out
}
function recentEventEvidence(texts:string[],players:string[]){
  const counts=new Map<string,{pen:number;fk:number;corner:number;evidence:string[]}>()
  for(const player of players)counts.set(player,{pen:0,fk:0,corner:0,evidence:[]})
  for(const raw of texts){
    const text=String(raw).replace(/\s+/g," ").trim()
    const lower=text.toLowerCase()
    for(const player of players){
      const n=norm(player)
      const surname=n.split(" ").at(-1)??n
      if(!(norm(text).includes(n)||surname.length>=4&&norm(text).includes(surname)))continue
      const row=counts.get(player)!
      if(/penalt/.test(lower)&&/(scor|miss|saved|goal|attempt|taken|takes)/.test(lower)){
        row.pen+=1;if(row.evidence.length<4)row.evidence.push("Recent penalty event: "+text.slice(0,130))
      }
      if(/free[ -]?kick/.test(lower)&&/(shot|goal|attempt|saved|miss|blocked|takes|taken)/.test(lower)){
        row.fk+=1;if(row.evidence.length<4)row.evidence.push("Recent direct free-kick event: "+text.slice(0,130))
      }
      if(/corner/.test(lower)&&/(taken|takes|cross|assist|kick)/.test(lower)){
        row.corner+=1;if(row.evidence.length<4)row.evidence.push("Recent corner event: "+text.slice(0,130))
      }
    }
  }
  return counts
}
async function findFixture(slugs:string[],date:string,home:string,away:string){
  const ymd=date.replaceAll("-","")
  const boards=await Promise.all(slugs.map(async slug=>({slug,data:await fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+ymd+"&limit=300",3500)})))
  for(const board of boards){
    const event=(board.data?.events??[]).find((e:any)=>{
      const rows=e?.competitions?.[0]?.competitors??[]
      const h=rows.find((x:any)=>x?.homeAway==="home")?.team
      const a=rows.find((x:any)=>x?.homeAway==="away")?.team
      return sameTeam(h?.displayName??h?.name,home)&&sameTeam(a?.displayName??a?.name,away)
    })
    if(event)return {slug:board.slug,event}
  }
  return null
}
async function recentEspnRoles(date:string,competition:string,home:string,away:string,playersByTeam:Record<string,string[]>){
  const slugs=ESPN_SLUGS[competition]??[]
  if(!slugs.length)return [] as SetPieceRole[]
  const found=await findFixture(slugs,date,home,away)
  if(!found)return []
  const rows=found.event?.competitions?.[0]?.competitors??[]
  const teams=[
    {team:home,id:String(rows.find((x:any)=>x?.homeAway==="home")?.team?.id??"")},
    {team:away,id:String(rows.find((x:any)=>x?.homeAway==="away")?.team?.id??"")},
  ]
  const year=new Date(date+"T12:00:00Z").getUTCFullYear()
  const roles:SetPieceRole[]=[]
  for(const side of teams){
    if(!side.id)continue
    const schedule=await fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+found.slug+"/teams/"+side.id+"/schedule?season="+year,4000)
    const prior=(schedule?.events??[])
      .filter((e:any)=>String(e?.date??"").slice(0,10)<date)
      .sort((a:any,b:any)=>String(b?.date??"").localeCompare(String(a?.date??"")))
      .slice(0,5)
    if(!prior.length)continue
    const summaries=await Promise.all(prior.map((e:any)=>fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+found.slug+"/summary?event="+encodeURIComponent(String(e?.id??"")),3500)))
    const texts=summaries.flatMap(x=>collectStrings(x))
    const players=Object.entries(playersByTeam).find(([t])=>sameTeam(t,side.team))?.[1]??[]
    const counts=recentEventEvidence(texts,players)
    const sorted=(key:"pen"|"fk"|"corner")=>[...counts.entries()].filter(([,v])=>v[key]>0).sort((a,b)=>b[1][key]-a[1][key])
    const penalties=sorted("pen"),fks=sorted("fk"),corners=sorted("corner")
    for(const player of players){
      const row=counts.get(player)
      if(!row||!(row.pen||row.fk||row.corner))continue
      const order=(list:typeof penalties,key:"pen"|"fk"|"corner")=>{
        const idx=list.findIndex(([name])=>name===player)
        return idx<0?null:idx+1
      }
      const penaltiesOrder=order(penalties,"pen")
      const directFreeKicksOrder=order(fks,"fk")
      const cornersOrder=order(corners,"corner")
      const total=row.pen+row.fk+row.corner
      roles.push({
        player,team:side.team,penaltiesOrder,directFreeKicksOrder,cornersOrder,
        confidence:total>=3?"high":total>=2?"medium":"low",
        source:"ESPN recent set-piece events",evidence:row.evidence,
      })
    }
  }
  return roles
}
export async function getSetPieceContext(input:{date:string;competition:string;home:string;away:string;playersByTeam:Record<string,string[]>}):Promise<SetPieceContext>{
  const key=[input.date,input.competition,norm(input.home),norm(input.away),Object.values(input.playersByTeam).flat().map(norm).sort().join(",")].join("|")
  const cached=cache.get(key)
  if(cached&&cached.expires>Date.now())return cached.value
  let roles:SetPieceRole[]=[]
  try{
    roles=input.competition==="Premier League"
      ?await premierLeagueRoles(input.home,input.away,input.playersByTeam)
      :await recentEspnRoles(input.date,input.competition,input.home,input.away,input.playersByTeam)
  }catch{}
  const value:SetPieceContext={
    available:roles.length>0,
    source:roles.length?[...new Set(roles.map(r=>r.source))].join(" + "):null,
    roles,
    fetchedAt:new Date().toISOString(),
  }
  cache.set(key,{expires:Date.now()+30*60*1000,value})
  return value
}
