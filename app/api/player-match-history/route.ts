import {NextResponse} from "next/server"
import {pool,isDatabaseConfigured} from "@/lib/db"

export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=15

type Row={
  match_date:string;player_name:string;team:string|null;opponent:string;competition:string|null;
  minutes:number|null;fouls_committed:number|null;fouls_drawn:number|null;
  shots:number|null;shots_on_target:number|null;yellow_card:boolean|null;red_card:boolean|null;
  goals:number|null;assists:number|null;venue:string|null;
}
function norm(s:string){
  return String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/\b(?:afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim()
}
function matchTeam(a:string,b:string){
  const x=norm(a),y=norm(b)
  return !!x&&!!y&&(x===y||(Math.min(x.length,y.length)>=7&&(x.includes(y)||y.includes(x))))
}
function targetHit(row:Row,market:string){
  if(market==="card")return row.yellow_card==null?null:row.yellow_card===true
  const field=market.startsWith("fouled")?row.fouls_drawn:market.startsWith("foul")?row.fouls_committed:
   market.startsWith("sot")?row.shots_on_target:market.startsWith("shot")?row.shots:
   market.startsWith("goal")?row.goals:market.startsWith("assist")?row.assists:null
  if(field==null)return null
  const n=Number(market.match(/\d+$/)?.[0]??1)
  return Number(field)>=n
}
function summarise(rows:Row[],market:string){
  const outcomes=rows.map(row=>targetHit(row,market)).filter((v):v is boolean=>v!==null)
  return {matches:rows.length,graded:outcomes.length,hits:outcomes.filter(Boolean).length,
    rate:outcomes.length?outcomes.filter(Boolean).length/outcomes.length:null}
}
export async function GET(request:Request){
  const u=new URL(request.url)
  const player=(u.searchParams.get("player")??"").trim()
  const team=(u.searchParams.get("team")??"").trim()
  const opposition=(u.searchParams.get("opponent")??"").trim()
  const competition=(u.searchParams.get("competition")??"").trim()
  const date=(u.searchParams.get("date")??"").trim()
  const market=(u.searchParams.get("market")??"card").trim()
  if(!player||!team||!opposition||!competition||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!player.match(/^[\p{L}\p{M} .'-]{2,100}$/u))
    return NextResponse.json({ok:false,error:"Invalid player or fixture details"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:true,source:"unavailable",lastFive:[],h2h:[],lastFiveSummary:null,h2hSummary:null,
    note:"No historical database connection"},{headers:{"Cache-Control":"no-store"}})
  try{
    // The SQL filters before the target kickoff, then the application verifies
    // player/team identities and H2H opponent aliases without name guesswork.
    const result=await pool.query<Row>(`SELECT match_date::text,player_name,team,opponent,competition,minutes,
      fouls_committed,fouls_drawn,shots,shots_on_target,yellow_card,red_card,goals,assists,venue
      FROM player_h2h
      WHERE lower(player_name)=lower($1) AND lower(team)=lower($2)
        AND lower(competition)=lower($3) AND match_date<$4::date
      ORDER BY match_date DESC LIMIT 60`,[player,team,competition,date])
    const unique=new Set<string>()
    const history=result.rows.filter(row=>{
      const key=[row.match_date,norm(row.opponent),norm(row.team)].join("|")
      if(unique.has(key))return false
      unique.add(key);return true
    })
    const lastFive=history.slice(0,5)
    // H2H needs its own lookup. Searching only the last 60 current-club
    // appearances misses earlier seasons and matches at former clubs.
    const opponentRows=await pool.query<Row>(`SELECT match_date::text,player_name,team,opponent,competition,minutes,
      fouls_committed,fouls_drawn,shots,shots_on_target,yellow_card,red_card,goals,assists,venue
      FROM player_h2h
      WHERE lower(player_name)=lower($1) AND match_date<$2::date
      AND (minutes IS NULL OR minutes>0) ORDER BY match_date DESC`,[player,date])
    const h2hSeen=new Set<string>()
    const allH2h=opponentRows.rows.filter(row=>{
      if(!matchTeam(row.opponent,opposition))return false
      const key=[row.match_date,norm(row.opponent),norm(row.team)].join("|")
      if(h2hSeen.has(key))return false
      h2hSeen.add(key);return true
    })
    const h2h=allH2h.slice(0,12)
    const bookingSummary=(rows:Row[])=>({
      booked:rows.filter(row=>row.yellow_card===true).length,
      withKnownOutcome:rows.length,
      reds:rows.filter(row=>row.red_card===true).length,
    })
    const cast=(row:Row)=>({
      date:row.match_date,opponent:row.opponent,team:row.team,minutes:row.minutes,
      foulsCommitted:row.fouls_committed,foulsDrawn:row.fouls_drawn,
      shots:row.shots,shotsOnTarget:row.shots_on_target,yellow:row.yellow_card,red:row.red_card,
      goals:row.goals,assists:row.assists,venue:row.venue,
      hit:targetHit(row,market)
    })
    return NextResponse.json({ok:true,source:"player_h2h",player,team,opponent:opposition,
      market,cutoff:date,lastFive:lastFive.map(cast),h2h:h2h.map(cast),
      lastFiveSummary:summarise(lastFive,market),h2hSummary:summarise(allH2h,market),
      lastFiveBookings:bookingSummary(lastFive),h2hBookings:bookingSummary(allH2h),
      h2hOpponent:opposition,h2hTotalAppearances:allH2h.length,h2hDisplayed:h2h.length,
      note:"Only matches before this fixture. H2H searches across earlier seasons and clubs; a dash means the historical source did not record that statistic."},
      {headers:{"Cache-Control":"public, max-age=0, s-maxage=900, stale-while-revalidate=3600"}})
  }catch(e){
    return NextResponse.json({ok:false,error:"Historical player records temporarily unavailable"},{status:503,
      headers:{"Cache-Control":"no-store"}})
  }
}
