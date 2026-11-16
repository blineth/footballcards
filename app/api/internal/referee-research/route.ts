import { NextResponse } from "next/server"
import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"

export const dynamic="force-dynamic"
export const revalidate=0
export const maxDuration=300

const API_BASE="https://v3.football.api-sports.io"
const DOMESTIC:Record<number,string>={
  39:"Premier League",
  40:"Championship",
  41:"League One",
  42:"League Two",
}
const INTERNATIONAL_NAMES=[
  "World Cup",
  "World Cup - Qualification Europe",
  "Friendlies",
  "Euro Championship",
  "Euro Championship - Qualification",
  "UEFA Nations League",
]

function authorized(url:URL){
  const expected=process.env.REFEREE_IMPORT_SECRET
  return Boolean(expected&&url.searchParams.get("token")===expected)
}
function n(value:any){
  if(value==null)return null
  const x=Number(String(value).replace("%","").trim())
  return Number.isFinite(x)?x:null
}
function refereeName(value:any){
  return String(value??"").split(",")[0]?.trim()??""
}
function eventMinute(event:any){
  const e=Number(event?.time?.elapsed??0),x=Number(event?.time?.extra??0)
  return Number.isFinite(e)?Math.max(0,Math.round(e+(Number.isFinite(x)?x:0))):null
}
async function api(path:string,params:Record<string,string>={}){
  const key=process.env.API_FOOTBALL_KEY
  if(!key)throw new Error("API_FOOTBALL_KEY is not configured")
  const url=new URL(API_BASE+path)
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v))
  const res=await fetch(url,{headers:{"x-apisports-key":key},cache:"no-store",signal:AbortSignal.timeout(30000)})
  if(!res.ok)throw new Error(`API-Football ${path} failed: ${res.status}`)
  const body=await res.json()
  return {
    response:Array.isArray(body?.response)?body.response:body?.response,
    paging:body?.paging??null,
    errors:body?.errors??null,
    results:body?.results??null,
    remaining:res.headers.get("x-ratelimit-requests-remaining")??res.headers.get("x-ratelimit-remaining"),
    limit:res.headers.get("x-ratelimit-requests-limit")??res.headers.get("x-ratelimit-limit"),
  }
}
function teamTotals(players:any[],teamId:number){
  let fouls=0,yellows=0,reds=0,penalties=0
  for(const block of players??[]){
    if(Number(block?.team?.id)!==teamId)continue
    for(const row of block?.players??[]){
      const s=row?.statistics?.[0]??{}
      fouls+=Number(s?.fouls?.committed??0)||0
      yellows+=Number(s?.cards?.yellow??0)||0
      reds+=Number(s?.cards?.red??0)||0
      penalties+=(Number(s?.penalty?.scored??0)||0)+(Number(s?.penalty?.missed??0)||0)
    }
  }
  return {fouls,yellows,reds,penalties}
}
async function alreadyImported(ids:string[]){
  if(!ids.length)return new Set<string>()
  const r=await pool.query(`SELECT fixture_id FROM referee_match_history WHERE fixture_id=ANY($1::text[])`,[ids])
  return new Set(r.rows.map((x:any)=>String(x.fixture_id)))
}
async function importFixture(fixture:any,competitionGroup:string,season:string){
  const ref=refereeName(fixture?.fixture?.referee)
  const fixtureId=String(fixture?.fixture?.id??"")
  const date=String(fixture?.fixture?.date??"").slice(0,10)
  if(!ref||!fixtureId||!date)return {ok:false,players:0,reason:"no referee"}

  const [playersRes,eventsRes]=await Promise.all([
    api("/fixtures/players",{fixture:fixtureId}),
    api("/fixtures/events",{fixture:fixtureId}),
  ])
  const players=playersRes.response??[]
  const events=eventsRes.response??[]
  const homeId=Number(fixture?.teams?.home?.id),awayId=Number(fixture?.teams?.away?.id)
  const home=teamTotals(players,homeId),away=teamTotals(players,awayId)
  const yellowEvents=(events??[]).filter((e:any)=>String(e?.type??"").toLowerCase()==="card"&&String(e?.detail??"").toLowerCase().includes("yellow"))
  const redEvents=(events??[]).filter((e:any)=>String(e?.type??"").toLowerCase()==="card"&&String(e?.detail??"").toLowerCase().includes("red"))
  const cardMinutes=[...(yellowEvents??[]),...(redEvents??[])].map(eventMinute).filter((x:any):x is number=>Number.isFinite(x))
  const yellowMinutes=(yellowEvents??[]).map(eventMinute).filter((x:any):x is number=>Number.isFinite(x))
  const homeY=Math.max(home.yellows,yellowEvents.filter((e:any)=>Number(e?.team?.id)===homeId).length)
  const awayY=Math.max(away.yellows,yellowEvents.filter((e:any)=>Number(e?.team?.id)===awayId).length)
  const homeR=Math.max(home.reds,redEvents.filter((e:any)=>Number(e?.team?.id)===homeId).length)
  const awayR=Math.max(away.reds,redEvents.filter((e:any)=>Number(e?.team?.id)===awayId).length)

  await pool.query(`
    INSERT INTO referee_match_history (
      fixture_id,referee_name,fixture_date,competition,league_id,season,round,
      home_team,away_team,home_score,away_score,
      home_fouls,away_fouls,total_fouls,home_yellows,away_yellows,total_yellows,
      home_reds,away_reds,total_reds,first_half_yellows,second_half_yellows,
      first_card_minute,last_card_minute,home_penalties,away_penalties,total_penalties,source,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,'API-Football',now())
    ON CONFLICT (fixture_id) DO UPDATE SET
      referee_name=EXCLUDED.referee_name,fixture_date=EXCLUDED.fixture_date,competition=EXCLUDED.competition,
      league_id=EXCLUDED.league_id,season=EXCLUDED.season,round=EXCLUDED.round,
      home_team=EXCLUDED.home_team,away_team=EXCLUDED.away_team,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,
      home_fouls=EXCLUDED.home_fouls,away_fouls=EXCLUDED.away_fouls,total_fouls=EXCLUDED.total_fouls,
      home_yellows=EXCLUDED.home_yellows,away_yellows=EXCLUDED.away_yellows,total_yellows=EXCLUDED.total_yellows,
      home_reds=EXCLUDED.home_reds,away_reds=EXCLUDED.away_reds,total_reds=EXCLUDED.total_reds,
      first_half_yellows=EXCLUDED.first_half_yellows,second_half_yellows=EXCLUDED.second_half_yellows,
      first_card_minute=EXCLUDED.first_card_minute,last_card_minute=EXCLUDED.last_card_minute,
      home_penalties=EXCLUDED.home_penalties,away_penalties=EXCLUDED.away_penalties,total_penalties=EXCLUDED.total_penalties,
      source=EXCLUDED.source,updated_at=now()
  `,[
    fixtureId,ref,date,competitionGroup,Number(fixture?.league?.id)||null,season,String(fixture?.league?.round??"")||null,
    String(fixture?.teams?.home?.name??""),String(fixture?.teams?.away?.name??""),
    n(fixture?.goals?.home),n(fixture?.goals?.away),
    home.fouls,away.fouls,home.fouls+away.fouls,homeY,awayY,homeY+awayY,homeR,awayR,homeR+awayR,
    yellowMinutes.filter((m:number)=>m<=45).length,yellowMinutes.filter((m:number)=>m>45).length,
    cardMinutes.length?Math.min(...cardMinutes):null,cardMinutes.length?Math.max(...cardMinutes):null,
    home.penalties,away.penalties,home.penalties+away.penalties,
  ])

  let playerCount=0
  for(const block of players??[]){
    const teamId=Number(block?.team?.id)
    const team=String(block?.team?.name??"")
    const opponent=teamId===homeId?String(fixture?.teams?.away?.name??""):String(fixture?.teams?.home?.name??"")
    for(const row of block?.players??[]){
      const player=String(row?.player?.name??"").trim()
      if(!player)continue
      const s=row?.statistics?.[0]??{}
      const minutes=Number(s?.games?.minutes??0)||0
      const appeared=minutes>0||s?.games?.substitute===false||Number(s?.cards?.yellow??0)>0||Number(s?.cards?.red??0)>0
      if(!appeared)continue
      await pool.query(`
        INSERT INTO player_referee_match_history (
          fixture_id,referee_name,fixture_date,player_name,team,opponent,competition,season,
          minutes,starter,position,fouls_committed,fouls_drawn,yellow_card,red_card,
          tackles,duels_total,duels_won,external_player_id,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
        ON CONFLICT (fixture_id,player_name,team) DO UPDATE SET
          referee_name=EXCLUDED.referee_name,fixture_date=EXCLUDED.fixture_date,opponent=EXCLUDED.opponent,
          competition=EXCLUDED.competition,season=EXCLUDED.season,minutes=EXCLUDED.minutes,starter=EXCLUDED.starter,
          position=EXCLUDED.position,fouls_committed=EXCLUDED.fouls_committed,fouls_drawn=EXCLUDED.fouls_drawn,
          yellow_card=EXCLUDED.yellow_card,red_card=EXCLUDED.red_card,tackles=EXCLUDED.tackles,
          duels_total=EXCLUDED.duels_total,duels_won=EXCLUDED.duels_won,external_player_id=EXCLUDED.external_player_id,updated_at=now()
      `,[
        fixtureId,ref,date,player,team,opponent,competitionGroup,season,minutes,s?.games?.substitute===false,
        String(s?.games?.position??"")||null,Number(s?.fouls?.committed??0)||0,Number(s?.fouls?.drawn??0)||0,
        Number(s?.cards?.yellow??0)>0,Number(s?.cards?.red??0)>0,Number(s?.tackles?.total??0)||0,
        Number(s?.duels?.total??0)||0,Number(s?.duels?.won??0)||0,row?.player?.id==null?null:String(row.player.id),
      ])
      playerCount++
    }
  }
  return {ok:true,players:playerCount,remaining:playersRes.remaining??eventsRes.remaining}
}
async function refreshRefereeProfiles(competition:string,season:string){
  // Aggregates are fully derived from raw match history. Remove legacy/stale rows
  // first so an older thin referee import cannot sit beside the rebuilt profile.
  await pool.query(`DELETE FROM referees WHERE competition=$1 AND season=$2`,[competition,season])
  await pool.query(`
    WITH ranked AS (
      SELECT *,row_number() OVER (PARTITION BY referee_name ORDER BY fixture_date DESC,fixture_id DESC) rn
      FROM referee_match_history WHERE competition=$1 AND season=$2
    ), base AS (
      SELECT referee_name,count(*)::int matches,
        sum(COALESCE(total_yellows,0))::int yellows,sum(COALESCE(total_reds,0))::int reds,
        sum(COALESCE(total_fouls,0))::int fouls,sum(COALESCE(total_penalties,0))::int penalties,
        sum(COALESCE(first_half_yellows,0))::int fh,sum(COALESCE(second_half_yellows,0))::int sh,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)=0 THEN 1 ELSE 0 END)::int zero_cards,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)>=5 THEN 1 ELSE 0 END)::int five_plus,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)>=7 THEN 1 ELSE 0 END)::int seven_plus,
        avg(first_card_minute) FILTER (WHERE first_card_minute IS NOT NULL) avg_first,
        avg(COALESCE(home_yellows,0)) home_y,avg(COALESCE(away_yellows,0)) away_y
      FROM ranked GROUP BY referee_name
    ), r10 AS (
      SELECT referee_name,avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf
      FROM ranked WHERE rn<=10 GROUP BY referee_name
    ), r25 AS (
      SELECT referee_name,avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf
      FROM ranked WHERE rn<=25 GROUP BY referee_name
    ), comp AS (
      SELECT avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf
      FROM ranked
    )
    INSERT INTO referees (
      referee_name,matches_refereed,yellow_cards,red_cards,fouls_called,penalties_awarded,
      first_half_yellows,second_half_yellows,zero_card_matches,five_plus_card_matches,seven_plus_card_matches,
      yellows_per_game,reds_per_game,fouls_per_game,cards_per_foul,fouls_per_card,penalties_per_game,
      first_half_yellows_per_game,second_half_yellows_per_game,average_first_card_minute,
      home_yellows_per_game,away_yellows_per_game,home_card_share,zero_card_rate,five_plus_card_rate,seven_plus_card_rate,
      recent10_yellows_per_game,recent10_fouls_per_game,recent10_cards_per_foul,
      recent25_yellows_per_game,recent25_fouls_per_game,recent25_cards_per_foul,strictness_score,
      competition,season,updated_at
    )
    SELECT b.referee_name,b.matches,b.yellows,b.reds,b.fouls,b.penalties,b.fh,b.sh,b.zero_cards,b.five_plus,b.seven_plus,
      b.yellows::numeric/NULLIF(b.matches,0),b.reds::numeric/NULLIF(b.matches,0),b.fouls::numeric/NULLIF(b.matches,0),
      (b.yellows+b.reds)::numeric/NULLIF(b.fouls,0),b.fouls::numeric/NULLIF(b.yellows+b.reds,0),b.penalties::numeric/NULLIF(b.matches,0),
      b.fh::numeric/NULLIF(b.matches,0),b.sh::numeric/NULLIF(b.matches,0),b.avg_first,b.home_y,b.away_y,
      b.home_y/NULLIF(b.home_y+b.away_y,0),b.zero_cards::numeric/NULLIF(b.matches,0),b.five_plus::numeric/NULLIF(b.matches,0),b.seven_plus::numeric/NULLIF(b.matches,0),
      r10.ypg,r10.fpg,r10.cpf,r25.ypg,r25.fpg,r25.cpf,
      GREATEST(0,LEAST(1,0.5
        +COALESCE((b.yellows::numeric/NULLIF(b.matches,0)-comp.ypg)/NULLIF(comp.ypg,0),0)*0.24
        +COALESCE(((b.yellows+b.reds)::numeric/NULLIF(b.fouls,0)-comp.cpf)/NULLIF(comp.cpf,0),0)*0.18
        +COALESCE((b.fouls::numeric/NULLIF(b.matches,0)-comp.fpg)/NULLIF(comp.fpg,0),0)*0.08
        +COALESCE((r10.ypg-comp.ypg)/NULLIF(comp.ypg,0),0)*0.10
      )),
      $1,$2,now()
    FROM base b CROSS JOIN comp LEFT JOIN r10 USING(referee_name) LEFT JOIN r25 USING(referee_name)
    ON CONFLICT (referee_name,competition,season) DO UPDATE SET
      matches_refereed=EXCLUDED.matches_refereed,yellow_cards=EXCLUDED.yellow_cards,red_cards=EXCLUDED.red_cards,
      fouls_called=EXCLUDED.fouls_called,penalties_awarded=EXCLUDED.penalties_awarded,
      first_half_yellows=EXCLUDED.first_half_yellows,second_half_yellows=EXCLUDED.second_half_yellows,
      zero_card_matches=EXCLUDED.zero_card_matches,five_plus_card_matches=EXCLUDED.five_plus_card_matches,seven_plus_card_matches=EXCLUDED.seven_plus_card_matches,
      yellows_per_game=EXCLUDED.yellows_per_game,reds_per_game=EXCLUDED.reds_per_game,fouls_per_game=EXCLUDED.fouls_per_game,
      cards_per_foul=EXCLUDED.cards_per_foul,fouls_per_card=EXCLUDED.fouls_per_card,penalties_per_game=EXCLUDED.penalties_per_game,
      first_half_yellows_per_game=EXCLUDED.first_half_yellows_per_game,second_half_yellows_per_game=EXCLUDED.second_half_yellows_per_game,
      average_first_card_minute=EXCLUDED.average_first_card_minute,home_yellows_per_game=EXCLUDED.home_yellows_per_game,
      away_yellows_per_game=EXCLUDED.away_yellows_per_game,home_card_share=EXCLUDED.home_card_share,
      zero_card_rate=EXCLUDED.zero_card_rate,five_plus_card_rate=EXCLUDED.five_plus_card_rate,seven_plus_card_rate=EXCLUDED.seven_plus_card_rate,
      recent10_yellows_per_game=EXCLUDED.recent10_yellows_per_game,recent10_fouls_per_game=EXCLUDED.recent10_fouls_per_game,
      recent10_cards_per_foul=EXCLUDED.recent10_cards_per_foul,recent25_yellows_per_game=EXCLUDED.recent25_yellows_per_game,
      recent25_fouls_per_game=EXCLUDED.recent25_fouls_per_game,recent25_cards_per_foul=EXCLUDED.recent25_cards_per_foul,
      strictness_score=EXCLUDED.strictness_score,updated_at=now()
  `,[competition,season])

  await pool.query(`
    INSERT INTO player_referee_history (
      referee_name,player_name,team,competition,season,matches_together,yellow_cards,red_cards,
      fouls_committed,fouls_drawn,minutes,card_rate,fouls_per_match,cards_per_foul,external_player_id,updated_at
    )
    SELECT referee_name,player_name,max(team),$1,$2,count(*)::int,
      sum(CASE WHEN yellow_card THEN 1 ELSE 0 END)::int,sum(CASE WHEN red_card THEN 1 ELSE 0 END)::int,
      sum(COALESCE(fouls_committed,0))::int,sum(COALESCE(fouls_drawn,0))::int,sum(COALESCE(minutes,0))::int,
      sum(CASE WHEN yellow_card OR red_card THEN 1 ELSE 0 END)::numeric/NULLIF(count(*),0),
      sum(COALESCE(fouls_committed,0))::numeric/NULLIF(count(*),0),
      sum(CASE WHEN yellow_card OR red_card THEN 1 ELSE 0 END)::numeric/NULLIF(sum(COALESCE(fouls_committed,0)),0),
      max(external_player_id),now()
    FROM player_referee_match_history WHERE competition=$1 AND season=$2
    GROUP BY referee_name,player_name
    ON CONFLICT (referee_name,player_name,competition,season) DO UPDATE SET
      team=EXCLUDED.team,matches_together=EXCLUDED.matches_together,yellow_cards=EXCLUDED.yellow_cards,red_cards=EXCLUDED.red_cards,
      fouls_committed=EXCLUDED.fouls_committed,fouls_drawn=EXCLUDED.fouls_drawn,minutes=EXCLUDED.minutes,
      card_rate=EXCLUDED.card_rate,fouls_per_match=EXCLUDED.fouls_per_match,cards_per_foul=EXCLUDED.cards_per_foul,
      external_player_id=EXCLUDED.external_player_id,updated_at=now()
  `,[competition,season])
}
function parseCsv(text:string){
  const rows:string[][]=[]
  let row:string[]=[],field="",quoted=false
  for(let i=0;i<text.length;i++){
    const ch=text[i]
    if(ch==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++}
      else quoted=!quoted
    }else if(ch===","&&!quoted){row.push(field);field=""}
    else if((ch==="\n"||ch==="\r")&&!quoted){
      if(ch==="\r"&&text[i+1]==="\n")i++
      row.push(field);field=""
      if(row.some(x=>x!==""))rows.push(row)
      row=[]
    }else field+=ch
  }
  if(field||row.length){row.push(field);if(row.some(x=>x!==""))rows.push(row)}
  const headers=(rows.shift()??[]).map(x=>x.trim())
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,String(values[i]??"").trim()])))
}
function footballDataSeasonLabel(code:string){
  if(!/^\d{4}$/.test(code))return code
  return `20${code.slice(0,2)}/${code.slice(2)}`
}
async function importFootballDataDivision(seasonCode:string,division:string){
  const competition=division==="E0"?"Premier League":division==="E1"?"Championship":division==="E2"?"League One":division==="E3"?"League Two":null
  if(!competition)throw new Error("Unsupported division")
  const url=`https://www.football-data.co.uk/mmz4281/${seasonCode}/${division}.csv`
  const res=await fetch(url,{
    cache:"no-store",
    signal:AbortSignal.timeout(30000),
    headers:{
      accept:"text/csv,text/plain,*/*",
      "user-agent":"Mozilla/5.0 (compatible; MatchEdgeRefereeResearch/1.0)",
      referer:"https://www.football-data.co.uk/englandm.php",
    },
  })
  if(!res.ok)throw new Error(`Football-Data ${division} ${seasonCode} failed: ${res.status}`)
  const rows=parseCsv(await res.text())
  const season=footballDataSeasonLabel(seasonCode)
  let imported=0
  for(const row of rows){
    const ref=String(row.Referee??"").trim()
    const dateRaw=String(row.Date??"").trim()
    const home=String(row.HomeTeam??"").trim(),away=String(row.AwayTeam??"").trim()
    if(!ref||!dateRaw||!home||!away)continue
    const parts=dateRaw.split(/[\/\-]/).map(x=>x.trim())
    let date=""
    if(parts.length===3){
      const [d,m,y]=parts
      const year=Number(y)<100?2000+Number(y):Number(y)
      date=`${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue
    const hf=Number(row.HF??0)||0,af=Number(row.AF??0)||0
    const hy=Number(row.HY??0)||0,ay=Number(row.AY??0)||0
    const hr=Number(row.HR??0)||0,ar=Number(row.AR??0)||0
    const fthg=n(row.FTHG),ftag=n(row.FTAG)
    const fixtureId=`fd:${seasonCode}:${division}:${date}:${home}:${away}`
    await pool.query(`
      INSERT INTO referee_match_history (
        fixture_id,referee_name,fixture_date,competition,season,home_team,away_team,home_score,away_score,
        home_fouls,away_fouls,total_fouls,home_yellows,away_yellows,total_yellows,
        home_reds,away_reds,total_reds,source,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Football-Data.co.uk',now())
      ON CONFLICT (fixture_id) DO UPDATE SET
        referee_name=EXCLUDED.referee_name,fixture_date=EXCLUDED.fixture_date,competition=EXCLUDED.competition,season=EXCLUDED.season,
        home_team=EXCLUDED.home_team,away_team=EXCLUDED.away_team,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,
        home_fouls=EXCLUDED.home_fouls,away_fouls=EXCLUDED.away_fouls,total_fouls=EXCLUDED.total_fouls,
        home_yellows=EXCLUDED.home_yellows,away_yellows=EXCLUDED.away_yellows,total_yellows=EXCLUDED.total_yellows,
        home_reds=EXCLUDED.home_reds,away_reds=EXCLUDED.away_reds,total_reds=EXCLUDED.total_reds,source=EXCLUDED.source,updated_at=now()
    `,[fixtureId,ref,date,competition,season,home,away,fthg,ftag,hf,af,hf+af,hy,ay,hy+ay,hr,ar,hr+ar])
    imported++
  }
  if(imported)await refreshRefereeProfiles(competition,season)
  return {competition,season,division,rows:rows.length,imported,url}
}

const ESPN_ROOT="https://site.api.espn.com/apis/site/v2/sports/soccer"
const ESPN_INTL_DATASETS:Record<string,{label:string;sources:Array<{slug:string;months:string[]}>}>={
  euro:{label:"UEFA European Championship",sources:[{slug:"uefa.euro",months:["202106","202107","202406","202407"]}]},
  "euro-qualifiers":{label:"UEFA European Championship Qualifying",sources:[{slug:"uefa.euroq",months:["202303","202306","202309","202310","202311","202403"]}]},
  nations:{label:"UEFA Nations League",sources:[{slug:"uefa.nations",months:["202206","202209","202306","202409","202410","202411","202503","202506","202609","202610","202611"]}]},
  "world-cup":{label:"FIFA World Cup",sources:[{slug:"fifa.world",months:["202211","202212","202606","202607"]}]},
  "world-cup-uefa-qualifiers":{label:"FIFA World Cup Qualifying - UEFA",sources:[{slug:"fifa.worldq.uefa",months:["202503","202506","202509","202510","202511","202603"]}]},
  friendlies:{label:"International Friendly",sources:[{slug:"fifa.friendly",months:[
    "202401","202402","202403","202404","202405","202406","202407","202408","202409","202410","202411","202412",
    "202501","202502","202503","202504","202505","202506","202507","202508","202509","202510","202511","202512",
    "202601","202602","202603","202604","202605","202606","202607","202608","202609","202610","202611"
  ]}]},
}
async function espn(slug:string,path:string){
  const r=await fetch(`${ESPN_ROOT}/${slug}/${path}`,{cache:"no-store",signal:AbortSignal.timeout(15000),headers:{accept:"application/json"}})
  if(!r.ok)throw new Error(`ESPN ${slug} ${r.status}`)
  return r.json()
}
function espnStat(row:any,name:string){
  const found=(row?.stats??[]).find((s:any)=>s?.name===name)
  return Number(found?.value??found?.displayValue??0)||0
}
function espnReferee(summary:any,event:any){
  const arrays=[
    summary?.gameInfo?.officials,
    summary?.header?.competitions?.[0]?.officials,
    summary?.officials,
    event?.competitions?.[0]?.officials,
  ].filter(Array.isArray)
  for(const list of arrays){
    const main=list.find((o:any)=>{
      const role=String(o?.position?.displayName??o?.position?.name??o?.role??o?.type??"").toLowerCase()
      return role==="referee"||role.includes("main referee")||role.includes("match referee")
    })??list[0]
    const name=String(main?.fullName??main?.displayName??main?.name??main?.athlete?.displayName??"").trim()
    if(name)return name
  }
  const simple=String(summary?.gameInfo?.referee?.displayName??summary?.gameInfo?.referee??"").trim()
  return simple||""
}
function espnMinute(ev:any){
  const seconds=Number(ev?.clock?.value??NaN)
  if(Number.isFinite(seconds))return Math.max(0,Math.min(130,Math.floor(seconds/60)))
  const m=String(ev?.clock?.displayValue??ev?.time?.displayValue??"").match(/(\d{1,3})/)
  return m?Math.max(0,Math.min(130,Number(m[1]))):null
}
async function espnCompletedEvents(dataset:string){
  const config=ESPN_INTL_DATASETS[dataset]
  if(!config)throw new Error("Unknown ESPN international dataset")
  const map=new Map<string,any>()
  for(const source of config.sources){
    for(const month of source.months){
      try{
        const data=await espn(source.slug,`scoreboard?dates=${month}&limit=500`)
        for(const event of data?.events??[]){
          const id=String(event?.id??"")
          const completed=event?.status?.type?.completed===true||String(event?.status?.type?.state??"")==="post"
          if(id&&completed)map.set(`${source.slug}:${id}`,{...event,__slug:source.slug,__label:config.label})
        }
      }catch{}
    }
  }
  return [...map.values()].sort((a,b)=>String(a?.date??"").localeCompare(String(b?.date??"")))
}
async function importEspnInternationalEvent(event:any){
  const id=String(event?.id??""),slug=String(event?.__slug??"")
  if(!id||!slug)return {ok:false,reason:"missing id"}
  const summary=await espn(slug,`summary?event=${id}`)
  const ref=espnReferee(summary,event)
  if(!ref)return {ok:false,reason:"no referee"}
  const comp=summary?.header?.competitions?.[0]??event?.competitions?.[0]??{}
  const competitors=comp?.competitors??[]
  const homeRow=competitors.find((x:any)=>x?.homeAway==="home"),awayRow=competitors.find((x:any)=>x?.homeAway==="away")
  const home=String(homeRow?.team?.displayName??homeRow?.team?.name??"")
  const away=String(awayRow?.team?.displayName??awayRow?.team?.name??"")
  const date=String(event?.date??comp?.date??"").slice(0,10)
  if(!home||!away||!date)return {ok:false,reason:"missing fixture identity"}
  const fixtureId=`espn:${slug}:${id}`
  let homeFouls=0,awayFouls=0,homeY=0,awayY=0,homeR=0,awayR=0
  const playerRows:any[]=[]
  for(const section of summary?.rosters??[]){
    const team=String(section?.team?.displayName??section?.team?.name??"")
    const isHome=team===home
    const opponent=isHome?away:home
    for(const row of section?.roster??[]){
      const player=String(row?.athlete?.displayName??row?.athlete?.fullName??"").trim()
      if(!player)continue
      const fc=espnStat(row,"foulsCommitted"),fd=espnStat(row,"foulsSuffered")
      const y=espnStat(row,"yellowCards"),r=espnStat(row,"redCards")
      const minutes=Number((row?.stats??[]).find((s:any)=>s?.name==="minutes")?.value??(row?.starter===true?90:0))||0
      const appeared=row?.starter===true||minutes>0||fc>0||fd>0||y>0||r>0
      if(!appeared)continue
      if(isHome){homeFouls+=fc;homeY+=y;homeR+=r}else{awayFouls+=fc;awayY+=y;awayR+=r}
      playerRows.push({player,team,opponent,fc,fd,y:y>0,r:r>0,minutes,starter:row?.starter===true,position:String(row?.position?.abbreviation??row?.position?.displayName??row?.athlete?.position?.abbreviation??"")||null,externalPlayerId:String(row?.athlete?.id??"")||null})
    }
  }
  const cards=(summary?.keyEvents??[]).filter((e:any)=>{
    const t=String(e?.type?.type??e?.type?.text??"").toLowerCase()
    return t.includes("yellow")||t.includes("red")||t.includes("card")
  })
  const cardMinutes=cards.map(espnMinute).filter((x:any):x is number=>Number.isFinite(x))
  const yellowMinutes=(summary?.keyEvents??[]).filter((e:any)=>String(e?.type?.type??e?.type?.text??"").toLowerCase().includes("yellow")).map(espnMinute).filter((x:any):x is number=>Number.isFinite(x))
  const season=date.slice(0,4)
  await pool.query(`
    INSERT INTO referee_match_history (
      fixture_id,referee_name,fixture_date,competition,season,round,home_team,away_team,home_score,away_score,
      home_fouls,away_fouls,total_fouls,home_yellows,away_yellows,total_yellows,home_reds,away_reds,total_reds,
      first_half_yellows,second_half_yellows,first_card_minute,last_card_minute,source,updated_at
    ) VALUES ($1,$2,$3,'International',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'ESPN',now())
    ON CONFLICT (fixture_id) DO UPDATE SET
      referee_name=EXCLUDED.referee_name,fixture_date=EXCLUDED.fixture_date,competition=EXCLUDED.competition,season=EXCLUDED.season,
      round=EXCLUDED.round,home_team=EXCLUDED.home_team,away_team=EXCLUDED.away_team,home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,
      home_fouls=EXCLUDED.home_fouls,away_fouls=EXCLUDED.away_fouls,total_fouls=EXCLUDED.total_fouls,
      home_yellows=EXCLUDED.home_yellows,away_yellows=EXCLUDED.away_yellows,total_yellows=EXCLUDED.total_yellows,
      home_reds=EXCLUDED.home_reds,away_reds=EXCLUDED.away_reds,total_reds=EXCLUDED.total_reds,
      first_half_yellows=EXCLUDED.first_half_yellows,second_half_yellows=EXCLUDED.second_half_yellows,
      first_card_minute=EXCLUDED.first_card_minute,last_card_minute=EXCLUDED.last_card_minute,source=EXCLUDED.source,updated_at=now()
  `,[
    fixtureId,ref,date,season,String(event?.__label??"International"),home,away,
    n(homeRow?.score),n(awayRow?.score),homeFouls,awayFouls,homeFouls+awayFouls,homeY,awayY,homeY+awayY,homeR,awayR,homeR+awayR,
    yellowMinutes.filter((m:number)=>m<=45).length,yellowMinutes.filter((m:number)=>m>45).length,
    cardMinutes.length?Math.min(...cardMinutes):null,cardMinutes.length?Math.max(...cardMinutes):null,
  ])
  for(const p of playerRows){
    await pool.query(`
      INSERT INTO player_referee_match_history (
        fixture_id,referee_name,fixture_date,player_name,team,opponent,competition,season,minutes,starter,position,
        fouls_committed,fouls_drawn,yellow_card,red_card,external_player_id,updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'International',$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
      ON CONFLICT (fixture_id,player_name,team) DO UPDATE SET
        referee_name=EXCLUDED.referee_name,fixture_date=EXCLUDED.fixture_date,opponent=EXCLUDED.opponent,competition=EXCLUDED.competition,
        season=EXCLUDED.season,minutes=EXCLUDED.minutes,starter=EXCLUDED.starter,position=EXCLUDED.position,
        fouls_committed=EXCLUDED.fouls_committed,fouls_drawn=EXCLUDED.fouls_drawn,yellow_card=EXCLUDED.yellow_card,
        red_card=EXCLUDED.red_card,external_player_id=EXCLUDED.external_player_id,updated_at=now()
    `,[fixtureId,ref,date,p.player,p.team,p.opponent,season,p.minutes,p.starter,p.position,p.fc,p.fd,p.y,p.r,p.externalPlayerId])
  }
  return {ok:true,referee:ref,date,home,away,players:playerRows.length}
}

async function refreshInternationalRolling(){
  const season="rolling"
  await pool.query(`
    DELETE FROM referees WHERE competition='International' AND season=$1
  `,[season])
  await pool.query(`
    WITH src AS (
      SELECT * FROM referee_match_history
      WHERE competition='International' AND fixture_date>=CURRENT_DATE-INTERVAL '4 years'
    ), ranked AS (
      SELECT *,row_number() OVER (PARTITION BY referee_name ORDER BY fixture_date DESC,fixture_id DESC) rn FROM src
    ), base AS (
      SELECT referee_name,count(*)::int matches,sum(COALESCE(total_yellows,0))::int yellows,sum(COALESCE(total_reds,0))::int reds,
        sum(COALESCE(total_fouls,0))::int fouls,sum(COALESCE(total_penalties,0))::int penalties,
        sum(COALESCE(first_half_yellows,0))::int fh,sum(COALESCE(second_half_yellows,0))::int sh,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)=0 THEN 1 ELSE 0 END)::int zero_cards,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)>=5 THEN 1 ELSE 0 END)::int five_plus,
        sum(CASE WHEN COALESCE(total_yellows,0)+COALESCE(total_reds,0)>=7 THEN 1 ELSE 0 END)::int seven_plus,
        avg(first_card_minute) FILTER(WHERE first_card_minute IS NOT NULL) avg_first,
        avg(COALESCE(home_yellows,0)) home_y,avg(COALESCE(away_yellows,0)) away_y
      FROM ranked GROUP BY referee_name
    ), r10 AS (
      SELECT referee_name,avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf
      FROM ranked WHERE rn<=10 GROUP BY referee_name
    ), r25 AS (
      SELECT referee_name,avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf
      FROM ranked WHERE rn<=25 GROUP BY referee_name
    ), comp AS (
      SELECT avg(COALESCE(total_yellows,0)) ypg,avg(COALESCE(total_fouls,0)) fpg,
        sum(COALESCE(total_yellows,0)+COALESCE(total_reds,0))::numeric/NULLIF(sum(COALESCE(total_fouls,0)),0) cpf FROM src
    )
    INSERT INTO referees (
      referee_name,matches_refereed,yellow_cards,red_cards,fouls_called,penalties_awarded,first_half_yellows,second_half_yellows,
      zero_card_matches,five_plus_card_matches,seven_plus_card_matches,yellows_per_game,reds_per_game,fouls_per_game,cards_per_foul,
      fouls_per_card,penalties_per_game,first_half_yellows_per_game,second_half_yellows_per_game,average_first_card_minute,
      home_yellows_per_game,away_yellows_per_game,home_card_share,zero_card_rate,five_plus_card_rate,seven_plus_card_rate,
      recent10_yellows_per_game,recent10_fouls_per_game,recent10_cards_per_foul,recent25_yellows_per_game,recent25_fouls_per_game,
      recent25_cards_per_foul,strictness_score,competition,season,updated_at
    )
    SELECT b.referee_name,b.matches,b.yellows,b.reds,b.fouls,b.penalties,b.fh,b.sh,b.zero_cards,b.five_plus,b.seven_plus,
      b.yellows::numeric/NULLIF(b.matches,0),b.reds::numeric/NULLIF(b.matches,0),b.fouls::numeric/NULLIF(b.matches,0),
      (b.yellows+b.reds)::numeric/NULLIF(b.fouls,0),b.fouls::numeric/NULLIF(b.yellows+b.reds,0),b.penalties::numeric/NULLIF(b.matches,0),
      b.fh::numeric/NULLIF(b.matches,0),b.sh::numeric/NULLIF(b.matches,0),b.avg_first,b.home_y,b.away_y,b.home_y/NULLIF(b.home_y+b.away_y,0),
      b.zero_cards::numeric/NULLIF(b.matches,0),b.five_plus::numeric/NULLIF(b.matches,0),b.seven_plus::numeric/NULLIF(b.matches,0),
      r10.ypg,r10.fpg,r10.cpf,r25.ypg,r25.fpg,r25.cpf,
      GREATEST(0,LEAST(1,0.5+COALESCE((b.yellows::numeric/NULLIF(b.matches,0)-comp.ypg)/NULLIF(comp.ypg,0),0)*0.24
        +COALESCE(((b.yellows+b.reds)::numeric/NULLIF(b.fouls,0)-comp.cpf)/NULLIF(comp.cpf,0),0)*0.18
        +COALESCE((r10.ypg-comp.ypg)/NULLIF(comp.ypg,0),0)*0.10)),
      'International',$1,now()
    FROM base b CROSS JOIN comp LEFT JOIN r10 USING(referee_name) LEFT JOIN r25 USING(referee_name)
  `,[season])

  await pool.query(`
    INSERT INTO player_referee_history (
      referee_name,player_name,team,competition,season,matches_together,yellow_cards,red_cards,
      fouls_committed,fouls_drawn,minutes,card_rate,fouls_per_match,cards_per_foul,external_player_id,updated_at
    )
    SELECT referee_name,player_name,max(team),'International','rolling',count(*)::int,
      sum(CASE WHEN yellow_card THEN 1 ELSE 0 END)::int,sum(CASE WHEN red_card THEN 1 ELSE 0 END)::int,
      sum(COALESCE(fouls_committed,0))::int,sum(COALESCE(fouls_drawn,0))::int,sum(COALESCE(minutes,0))::int,
      sum(CASE WHEN yellow_card OR red_card THEN 1 ELSE 0 END)::numeric/NULLIF(count(*),0),
      sum(COALESCE(fouls_committed,0))::numeric/NULLIF(count(*),0),
      sum(CASE WHEN yellow_card OR red_card THEN 1 ELSE 0 END)::numeric/NULLIF(sum(COALESCE(fouls_committed,0)),0),
      max(external_player_id),now()
    FROM player_referee_match_history
    WHERE competition='International' AND fixture_date>=CURRENT_DATE-INTERVAL '4 years'
    GROUP BY referee_name,player_name
    ON CONFLICT (referee_name,player_name,competition,season) DO UPDATE SET
      team=EXCLUDED.team,matches_together=EXCLUDED.matches_together,yellow_cards=EXCLUDED.yellow_cards,red_cards=EXCLUDED.red_cards,
      fouls_committed=EXCLUDED.fouls_committed,fouls_drawn=EXCLUDED.fouls_drawn,minutes=EXCLUDED.minutes,
      card_rate=EXCLUDED.card_rate,fouls_per_match=EXCLUDED.fouls_per_match,cards_per_foul=EXCLUDED.cards_per_foul,
      external_player_id=EXCLUDED.external_player_id,updated_at=now()
  `)
}

export async function GET(request:Request){
  const url=new URL(request.url)
  if(!authorized(url))return NextResponse.json({ok:false,error:"Unauthorized"},{status:401})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not configured"},{status:500})
  await ensureResearchSchema()
  const mode=url.searchParams.get("mode")??"quota"

  if(mode==="quota"){
    const status=await api("/status")
    return NextResponse.json({ok:true,status:status.response,errors:status.errors,results:status.results,remaining:status.remaining,limit:status.limit})
  }
  if(mode==="probe"){
    const id=url.searchParams.get("id")??"39"
    const season=url.searchParams.get("season")??"2026"
    const row=await api("/leagues",{id,season})
    return NextResponse.json({ok:true,id,season,response:row.response,errors:row.errors,results:row.results,remaining:row.remaining,limit:row.limit})
  }

  if(mode==="discover"){
    const domestic=await Promise.all(Object.keys(DOMESTIC).map(async id=>{
      const row=await api("/leagues",{id})
      const item=(row.response??[])[0]
      return {id:Number(id),name:item?.league?.name??DOMESTIC[Number(id)],seasons:(item?.seasons??[]).map((s:any)=>s.year).slice(-6)}
    }))
    const international:any[]=[]
    for(const name of INTERNATIONAL_NAMES){
      const row=await api("/leagues",{search:name})
      const exact=(row.response??[]).filter((x:any)=>String(x?.league?.name??"").toLowerCase()===name.toLowerCase())
      for(const item of exact)international.push({id:item.league.id,name:item.league.name,seasons:(item.seasons??[]).map((s:any)=>s.year).slice(-8)})
    }
    const dedup=[...new Map(international.map(x=>[x.id,x])).values()]
    return NextResponse.json({ok:true,domestic,international:dedup})
  }

  if(mode==="espn-international"){
    const dataset=url.searchParams.get("dataset")??"nations"
    const all=await espnCompletedEvents(dataset)
    const offset=Math.max(0,Number(url.searchParams.get("offset")??0)||0)
    const limit=Math.max(1,Math.min(30,Number(url.searchParams.get("limit")??12)||12))
    const selected=all.slice(offset,offset+limit)
    const results:any[]=[]
    for(const event of selected){
      try{results.push(await importEspnInternationalEvent(event))}
      catch(error){results.push({ok:false,event:String(event?.id??""),error:error instanceof Error?error.message:String(error)})}
    }
    if(results.some(x=>x.ok))await refreshInternationalRolling()
    const nextOffset=offset+selected.length
    return NextResponse.json({
      ok:true,dataset,totalFixtures:all.length,offset,processed:selected.length,imported:results.filter(x=>x.ok).length,
      skipped:results.filter(x=>!x.ok),matches:results.filter(x=>x.ok),nextOffset,done:nextOffset>=all.length,
      availableDatasets:Object.keys(ESPN_INTL_DATASETS),
    })
  }

  if(mode==="football-data"){
    const seasonCode=url.searchParams.get("seasonCode")??"2627"
    const division=url.searchParams.get("division")??"all"
    const divisions=division==="all"?["E0","E1","E2","E3"]:[division]
    const results:any[]=[]
    for(const d of divisions)results.push(await importFootballDataDivision(seasonCode,d))
    return NextResponse.json({ok:true,source:"Football-Data.co.uk",results})
  }

  if(mode==="rebuild-profiles"){
    const groups=await pool.query(`
      SELECT DISTINCT competition,season
      FROM referee_match_history
      WHERE competition IN ('Premier League','Championship','League One','League Two')
      ORDER BY competition,season
    `)
    const rebuilt:any[]=[]
    for(const row of groups.rows){
      await refreshRefereeProfiles(String(row.competition),String(row.season))
      rebuilt.push({competition:row.competition,season:row.season})
    }
    await refreshInternationalRolling()
    return NextResponse.json({ok:true,rebuilt,international:"rolling"})
  }

  if(mode==="summary"){
    const refs=await pool.query(`
      SELECT competition,season,count(*)::int referees,sum(matches_refereed)::int referee_matches,
        round(avg(yellows_per_game)::numeric,2) avg_yellows,
        round(avg(fouls_per_game)::numeric,2) avg_fouls
      FROM referees GROUP BY competition,season ORDER BY competition,season DESC
    `)
    const raw=await pool.query(`
      SELECT competition,season,count(*)::int matches,count(DISTINCT referee_name)::int referees,
        min(fixture_date) first_date,max(fixture_date) last_date
      FROM referee_match_history GROUP BY competition,season ORDER BY competition,season DESC
    `)
    return NextResponse.json({ok:true,profiles:refs.rows,raw:raw.rows})
  }

  if(mode!=="import")return NextResponse.json({ok:false,error:"Unknown mode"},{status:400})
  const league=Number(url.searchParams.get("league"))
  const season=String(url.searchParams.get("season")??"")
  if(!Number.isFinite(league)||!season)return NextResponse.json({ok:false,error:"league and season required"},{status:400})
  const competition=DOMESTIC[league]??"International"
  const max=Math.max(1,Math.min(40,Number(url.searchParams.get("max")??12)))
  const refresh=url.searchParams.get("refresh")==="1"

  const fixturesRes=await api("/fixtures",{league:String(league),season,status:"FT",timezone:"Europe/London"})
  const fixtures=(fixturesRes.response??[])
    .filter((f:any)=>refereeName(f?.fixture?.referee))
    .sort((a:any,b:any)=>String(b?.fixture?.date??"").localeCompare(String(a?.fixture?.date??"")))
  const imported=refresh?new Set<string>():await alreadyImported(fixtures.map((f:any)=>String(f?.fixture?.id??"")))
  const pending=fixtures.filter((f:any)=>!imported.has(String(f?.fixture?.id??""))).slice(0,max)

  let matchCount=0,playerCount=0,remaining=fixturesRes.remaining
  const errors:any[]=[]
  for(const fixture of pending){
    try{
      const result=await importFixture(fixture,competition,season)
      if(result.ok){matchCount++;playerCount+=result.players}
      if(result.remaining!=null)remaining=result.remaining
    }catch(error){
      errors.push({fixture:String(fixture?.fixture?.id??""),error:error instanceof Error?error.message:String(error)})
    }
  }
  if(matchCount){
    await refreshRefereeProfiles(competition,season)
    if(competition==="International")await refreshInternationalRolling()
  }
  return NextResponse.json({
    ok:true,league,competition,season,totalFixturesWithReferee:fixtures.length,
    previouslyImported:imported.size,pendingBeforeBatch:fixtures.length-imported.size,
    importedMatches:matchCount,importedPlayers:playerCount,remainingAfterBatch:Math.max(0,fixtures.length-imported.size-matchCount),
    apiRemaining:remaining,errors,
  })
}
