import { isDatabaseConfigured, pool } from "@/lib/db"

export type OfficialCompetition="Premier League"|"Championship"|"League One"|"League Two"|"International"
export type OfficialLineupPlayer={
  id:string;name:string;shortName:string;number:string|null;position:string|null;formationPlace:number|null;
  starter:boolean;captain:boolean;subbedIn:boolean;subbedOut:boolean
}
export type OfficialTeamLineup={
  team:string;crest:string|null;formation:string|null;formationSource:"official-feed"|"position-inferred"|null;
  starters:OfficialLineupPlayer[];substitutes:OfficialLineupPlayer[];starterCount:number;benchAvailable:boolean
}
export type OfficialLineupResult={
  ok:true;eventId:string|null;source:string;checkedAt:string;confirmedAt?:string|null;
  date:string;competition:OfficialCompetition;home:string;away:string;
  confirmed:boolean;lineupAvailable:boolean;cachedConfirmed:boolean;providerAvailable:boolean;
  status:string;venue:string|null;homeLineup:OfficialTeamLineup;awayLineup:OfficialTeamLineup;reason:string
}

const LEAGUES:Record<OfficialCompetition,string[]>={
  "Premier League":["eng.1"],
  Championship:["eng.2"],
  "League One":["eng.3"],
  "League Two":["eng.4"],
  International:["uefa.nations","fifa.friendly","fifa.world","fifa.worldq.uefa","fifa.worldq.conmebol","fifa.worldq.concacaf","fifa.worldq.afc","fifa.worldq.caf","uefa.euro","uefa.euroq"],
}
let cacheReady=false
const memory=new Map<string,{expires:number,value:OfficialLineupResult}>()

function norm(v:any){
  return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function teamMatch(a:any,b:any){
  const x=norm(a),y=norm(b)
  return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))
}
function keyOf(date:string,competition:string,home:string,away:string){
  return [date,competition,norm(home),norm(away)].join("|")
}
async function ensureCache(){
  if(!isDatabaseConfigured)return false
  if(cacheReady)return true
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS official_lineup_cache (
      lineup_key text PRIMARY KEY,
      fixture_date date NOT NULL,
      competition text NOT NULL,
      home_team text NOT NULL,
      away_team text NOT NULL,
      event_id text,
      payload jsonb NOT NULL,
      confirmed_at timestamptz NOT NULL DEFAULT now(),
      checked_at timestamptz NOT NULL DEFAULT now()
    )`)
    cacheReady=true
    return true
  }catch{return false}
}
async function readCached(key:string):Promise<OfficialLineupResult|null>{
  const warm=memory.get(key)
  if(warm?.value?.confirmed)return {...warm.value,cachedConfirmed:true,source:"Cached "+warm.value.source,providerAvailable:false}
  if(!(await ensureCache()))return null
  try{
    const row=(await pool.query(`SELECT payload,confirmed_at,checked_at FROM official_lineup_cache WHERE lineup_key=$1 LIMIT 1`,[key])).rows[0]
    if(!row?.payload)return null
    const value=row.payload as OfficialLineupResult
    if(value?.confirmed!==true)return null
    return {
      ...value,
      checkedAt:new Date(row.checked_at??Date.now()).toISOString(),
      confirmedAt:new Date(row.confirmed_at??Date.now()).toISOString(),
      cachedConfirmed:true,
      providerAvailable:false,
      source:String(value.source||"ESPN official match sheet")+" · cached confirmed",
      reason:"Using the last verified official starting XIs because the live lineup provider did not return a newer complete team sheet.",
    }
  }catch{return null}
}
async function writeCached(key:string,value:OfficialLineupResult){
  memory.set(key,{expires:Date.now()+6*60*60*1000,value})
  if(!(await ensureCache()))return
  try{
    await pool.query(`INSERT INTO official_lineup_cache
      (lineup_key,fixture_date,competition,home_team,away_team,event_id,payload,confirmed_at,checked_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())
      ON CONFLICT (lineup_key) DO UPDATE SET
        event_id=EXCLUDED.event_id,payload=EXCLUDED.payload,checked_at=now()`,
      [key,value.date,value.competition,value.home,value.away,value.eventId,JSON.stringify(value)])
  }catch{}
}
async function espn(slug:string,path:string){
  const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/${path}`,{
    cache:"no-store",signal:AbortSignal.timeout(6500),headers:{accept:"application/json"},
  })
  if(!response.ok)throw new Error("ESPN "+response.status)
  return response.json()
}
function positionGroup(position:string|null){
  const p=norm(position)
  if(!p)return "other"
  if(p==="g"||p==="gk"||p.includes("goal"))return "gk"
  if(p.includes("back")||p.includes("def")||["cb","lb","rb","lwb","rwb"].includes(p)||p.startsWith("cd"))return "def"
  if(p.includes("mid")||["dm","cm","am","lm","rm","cdm","cam"].includes(p))return "mid"
  if(p.includes("forward")||p.includes("striker")||p.includes("wing")||["f","st","cf","lw","rw","lf","rf","ss"].includes(p))return "att"
  return "other"
}
function inferredFormation(players:OfficialLineupPlayer[]){
  const defs=players.filter(p=>positionGroup(p.position)==="def").length
  const mids=players.filter(p=>positionGroup(p.position)==="mid").length
  const atts=players.filter(p=>positionGroup(p.position)==="att").length
  if(defs>=3&&mids>=2&&atts>=1&&defs+mids+atts>=9)return [defs,mids,atts].join("-")
  return null
}
function playerRow(row:any):OfficialLineupPlayer{
  const athlete=row?.athlete??row?.player??{}
  const formationPlaceRaw=row?.formationPlace??row?.formation_place??null
  const formationPlace=formationPlaceRaw==null?null:Number(formationPlaceRaw)
  return {
    id:String(athlete?.id??row?.id??""),
    name:String(athlete?.displayName??athlete?.fullName??athlete?.shortName??row?.displayName??"").trim(),
    shortName:String(athlete?.shortName??athlete?.displayName??athlete?.fullName??row?.displayName??"").trim(),
    number:String(row?.jersey??athlete?.jersey??row?.shirtNumber??"").trim()||null,
    position:String(row?.position?.abbreviation??row?.position?.displayName??athlete?.position?.abbreviation??athlete?.position?.displayName??"").trim()||null,
    formationPlace:Number.isFinite(formationPlace)?formationPlace:null,
    starter:row?.starter===true,
    captain:row?.captain===true||row?.isCaptain===true,
    subbedIn:row?.subbedIn===true,
    subbedOut:row?.subbedOut===true,
  }
}
function emptyTeam(team:string,crest:string|null=null):OfficialTeamLineup{
  return {team,crest,formation:null,formationSource:null,starters:[],substitutes:[],starterCount:0,benchAvailable:false}
}
function teamLineup(section:any,fallbackName:string,fallbackCrest:string|null):OfficialTeamLineup{
  const roster=(section?.roster??[]).map(playerRow).filter((p:OfficialLineupPlayer)=>p.name)
  const starters=roster.filter((p:OfficialLineupPlayer)=>p.starter).slice(0,11)
  const substitutes=roster.filter((p:OfficialLineupPlayer)=>!p.starter)
  const team=section?.team??section?.teamInfo??{}
  const raw=typeof section?.formation==="string"?section.formation:String(section?.formation?.name??section?.formationName??"")
  const official=/^\d(?:-\d){2,4}$/.test(raw.trim())?raw.trim():null
  const inferred=official?null:inferredFormation(starters)
  return {
    team:String(team?.displayName??team?.name??fallbackName),crest:String(team?.logo??team?.logos?.[0]?.href??fallbackCrest??"")||null,
    formation:official??inferred,formationSource:official?"official-feed":inferred?"position-inferred":null,
    starters,substitutes,starterCount:starters.length,benchAvailable:substitutes.length>0,
  }
}
function chooseSection(rosters:any[],side:"home"|"away",name:string){
  return rosters.find((x:any)=>String(x?.homeAway??x?.team?.homeAway??"").toLowerCase()===side)
    ??rosters.find((x:any)=>teamMatch(x?.team?.displayName??x?.team?.name,name))
    ??null
}
async function findEvent(slug:string,date:string,home:string,away:string){
  const board=await espn(slug,`scoreboard?dates=${date.replaceAll("-","")}&limit=300`)
  return (board?.events??[]).find((event:any)=>{
    const rows=event?.competitions?.[0]?.competitors??[]
    const h=rows.find((x:any)=>x?.homeAway==="home")?.team
    const a=rows.find((x:any)=>x?.homeAway==="away")?.team
    return teamMatch(h?.displayName??h?.name,home)&&teamMatch(a?.displayName??a?.name,away)
  })??null
}
function rawEventId(input?:string|null){
  const id=String(input??"")
  return id.includes(":")?id.split(":").at(-1)??id:id
}


/** User-supplied match-screen starting XIs (22 Nov 2026).
 * Used only when the official provider has not returned both complete teams.
 * This is a pre-match snapshot, not a live substitution feed.
 */
function suppliedMatchSnapshot(input:{date:string;home:string;away:string;competition:OfficialCompetition}):OfficialLineupResult|null{
  if(input.date!=="2026-11-22"||input.competition!=="Premier League"||
    !teamMatch(input.home,"Liverpool")||!teamMatch(input.away,"Manchester United"))return null
  const make=(team:string,rows:Array<[string,string,string]>,captain:string):OfficialTeamLineup=>({
    team,crest:null,formation:"4-2-3-1",formationSource:"position-inferred",
    starters:rows.map(([number,name,position],i)=>({
      id:"supplied-"+norm(team)+"-"+number,name,shortName:name,number,position,
      formationPlace:i+1,starter:true,captain:name===captain,subbedIn:false,subbedOut:false
    })),
    substitutes:[],starterCount:11,benchAvailable:false
  })
  const homeLineup=make(input.home,[
    ["1","Alisson","GK"],["33","Ronald Araújo","RB"],["5","Jérémy Jacquet","CB"],
    ["4","Virgil van Dijk","CB"],["6","Milos Kerkez","LB"],
    ["8","Dominik Szoboszlai","CM"],["10","Alexis Mac Allister","CM"],
    ["73","Rio Ngumoha","LW"],["7","Florian Wirtz","CAM"],
    ["29","Bradley Barcola","RW"],["9","Alexander Isak","ST"]
  ],"Virgil van Dijk")
  const awayLineup=make(input.away,[
    ["1","Senne Lammens","GK"],["15","Leny Yoro","RB"],["4","Matthijs de Ligt","CB"],
    ["6","Lisandro Martínez","CB"],["2","Diogo Dalot","LB"],
    ["37","Kobbie Mainoo","CM"],["18","Youri Tielemans","CM"],
    ["13","Patrick Dorgu","LW"],["8","Bruno Fernandes","CAM"],
    ["19","Bryan Mbeumo","RW"],["10","Matheus Cunha","ST"]
  ],"Bruno Fernandes")
  return {ok:true,eventId:null,source:"User-supplied lineup screenshot (22 Nov 2026)",
    checkedAt:new Date().toISOString(),confirmedAt:"2026-11-22T15:27:00.000Z",
    date:input.date,competition:input.competition,home:input.home,away:input.away,
    confirmed:true,lineupAvailable:true,cachedConfirmed:false,providerAvailable:false,
    status:"Pre-match snapshot",venue:"Anfield",homeLineup,awayLineup,
    reason:"Both starting XIs supplied in a lineup screenshot; live changes must be checked against the provider."}
}

export async function getOfficialLineup(input:{
  date:string;home:string;away:string;competition:OfficialCompetition;eventId?:string|null;force?:boolean
}):Promise<OfficialLineupResult>{
  const key=keyOf(input.date,input.competition,input.home,input.away)
  const warm=memory.get(key)
  if(!input.force&&warm&&warm.expires>Date.now())return warm.value
  let providerAnswered=false
  for(const slug of LEAGUES[input.competition]??[]){
    try{
      let event:any=null
      const supplied=rawEventId(input.eventId)
      if(supplied){
        try{
          const summary=await espn(slug,`summary?event=${encodeURIComponent(supplied)}`)
          const rosters=Array.isArray(summary?.rosters)?summary.rosters:[]
          const hs=chooseSection(rosters,"home",input.home),as=chooseSection(rosters,"away",input.away)
          if(hs||as)event={id:supplied,summary}
        }catch{}
      }
      if(!event){
        const found=await findEvent(slug,input.date,input.home,input.away)
        if(!found?.id)continue
        event={id:String(found.id),found}
      }
      const summary=event.summary??await espn(slug,`summary?event=${encodeURIComponent(String(event.id))}`)
      providerAnswered=true
      const rosters=Array.isArray(summary?.rosters)?summary.rosters:[]
      const contest=event.found?.competitions?.[0]??summary?.header?.competitions?.[0]??{}
      const homeComp=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="home")
      const awayComp=(contest?.competitors??[]).find((x:any)=>x?.homeAway==="away")
      const homeSection=chooseSection(rosters,"home",input.home)
      const awaySection=chooseSection(rosters,"away",input.away)
      const homeLineup=homeSection?teamLineup(homeSection,input.home,homeComp?.team?.logo??null):emptyTeam(input.home,homeComp?.team?.logo??null)
      const awayLineup=awaySection?teamLineup(awaySection,input.away,awayComp?.team?.logo??null):emptyTeam(input.away,awayComp?.team?.logo??null)
      const confirmed=homeLineup.starterCount===11&&awayLineup.starterCount===11
      const lineupAvailable=homeLineup.starterCount>0||awayLineup.starterCount>0
      const now=new Date().toISOString()
      const result:OfficialLineupResult={
        ok:true,eventId:String(event.id),source:"ESPN official match sheet",checkedAt:now,confirmedAt:confirmed?now:null,
        date:input.date,competition:input.competition,home:input.home,away:input.away,confirmed,lineupAvailable,
        cachedConfirmed:false,providerAvailable:true,
        status:String(event.found?.status?.type?.description??summary?.header?.competitions?.[0]?.status?.type?.description??""),
        venue:contest?.venue?.fullName??null,homeLineup,awayLineup,
        reason:confirmed?"Both official starting XIs are published.":lineupAvailable?"A partial team sheet is published; waiting for both official starting XIs.":"Official starting XIs are not published yet.",
      }
      if(confirmed)await writeCached(key,result)
      else memory.set(key,{expires:Date.now()+20_000,value:result})
      if(!confirmed){
        const supplied=suppliedMatchSnapshot(input)
        if(supplied)return supplied
        const cached=await readCached(key)
        if(cached)return cached
      }
      return result
    }catch{}
  }
  const supplied=suppliedMatchSnapshot(input)
  if(supplied)return supplied
  const cached=await readCached(key)
  if(cached)return cached
  const now=new Date().toISOString()
  const result:OfficialLineupResult={
    ok:true,eventId:rawEventId(input.eventId)||null,source:"ESPN official match sheet",checkedAt:now,date:input.date,
    competition:input.competition,home:input.home,away:input.away,confirmed:false,lineupAvailable:false,
    cachedConfirmed:false,providerAvailable:providerAnswered,status:"",venue:null,
    homeLineup:emptyTeam(input.home),awayLineup:emptyTeam(input.away),
    reason:providerAnswered?"Official starting XIs are not published yet.":"Lineup provider unavailable and no cached confirmed XI exists.",
  }
  memory.set(key,{expires:Date.now()+15_000,value:result})
  return result
}
