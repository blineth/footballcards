import { NextResponse } from "next/server"
import { pool,isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { GET as fixturesGET } from "@/app/api/fixtures/route"
import { GET as playerStatsGET } from "@/app/api/live-player-stats/route"

export const dynamic="force-dynamic"
export const revalidate=0
function ymd(v:string){return /^20\d{2}-\d{2}-\d{2}$/.test(v)}
export async function GET(request:Request){
  // Imports mutate history; reject unauthenticated public requests.
  const secret=process.env.CRON_SECRET
  if(!secret||request.headers.get("authorization")!=="Bearer "+secret)
    return NextResponse.json({ok:false,error:"Unauthorized import"},{status:401})
  const params=new URL(request.url).searchParams
  const date=params.get("date")??""
  const offset=Math.max(0,Math.min(500,Number(params.get("offset")??0)||0))
  const limit=Math.max(1,Math.min(5,Number(params.get("limit")??4)||4))
  if(!ymd(date)||date>=new Date().toISOString().slice(0,10))return NextResponse.json({ok:false,error:"Date must be a completed past day"},{status:400})
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database unavailable"},{status:503})
  try{
    await ensureResearchSchema()
    const response=await fixturesGET(new Request("http://internal/api/fixtures?date="+date+"&nextIfEmpty=0"))
    const board=await response.json()
    const fixtures=Object.values(board?.leagues??{}).flat() as any[]
    const finished=fixtures.filter(f=>f.status==="finished")
    await pool.query(`CREATE TABLE IF NOT EXISTS match_result_audit (
      fixture_date date NOT NULL,home_team text NOT NULL,away_team text NOT NULL,
      competition text,home_score integer NOT NULL,away_score integer NOT NULL,
      source text,updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(fixture_date,home_team,away_team)
    )`)
    if(offset===0)for(const f of finished){
      if(f.score?.home==null||f.score?.away==null)continue
      await pool.query(`INSERT INTO match_result_audit
        (fixture_date,home_team,away_team,competition,home_score,away_score,source)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(fixture_date,home_team,away_team) DO UPDATE
        SET home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,updated_at=now()`,
        [date,f.home.name,f.away.name,f.competition,f.score.home,f.score.away,"finished fixture feed"])
    }
    const selected=finished.slice(offset,offset+limit)
    const results=await Promise.all(selected.map(async f=>{
      const name=f.home.name+" v "+f.away.name
      try{
        const q=new URLSearchParams({date,home:f.home.name,away:f.away.name,competition:f.competition})
        const res=await playerStatsGET(new Request("http://internal/api/live-player-stats?"+q))
        const data=await res.json()
        if(data.status!=="finished"||!Array.isArray(data.players)||data.players.length<10){
          return {fixture:name,imported:0,status:"incomplete source",feed:data.source??null}
        }
        let imported=0
        for(const player of data.players){
          if(!player?.player||!player?.team)continue
          const home=String(f.home.name).toLowerCase(),team=String(player.team).toLowerCase()
          const isHome=team===home||team.includes(home)||home.includes(team)
          const opponent=isHome?f.away.name:f.home.name
          await pool.query(`INSERT INTO player_h2h
            (player_name,team,opponent,match_date,competition,minutes,
             fouls_committed,fouls_drawn,shots,shots_on_target,yellow_card,red_card,goals,assists,
             external_match_id,booking_reason,yellow_card_minute,fouls_stat_verified)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT DO NOTHING`,
            [player.player,player.team,opponent,date,f.competition,
             player.minutes??null,player.foulsCommitted??null,player.foulsDrawn??null,
             player.shots??null,player.shotsOnTarget??null,Number(player.yellowCards??0)>0,
             Number(player.redCards??0)>0,player.goals??null,player.assists??null,
             String(f.id??""),player.bookingReason??null,player.yellowCardMinute??null,player.foulsStatVerified===true])
          if(player.bookingReason||player.yellowCardMinute!=null||player.foulsStatVerified===true){
            await pool.query(`UPDATE player_h2h SET
              booking_reason=COALESCE($6,booking_reason),
              yellow_card_minute=COALESCE($7,yellow_card_minute),
              fouls_stat_verified=CASE WHEN $8 THEN TRUE ELSE fouls_stat_verified END
              WHERE player_name=$1 AND team=$2 AND opponent=$3 AND match_date=$4 AND competition=$5`,
              [player.player,player.team,opponent,date,f.competition,player.bookingReason??null,player.yellowCardMinute??null,player.foulsStatVerified===true])
          }
          imported++
        }
        const ref=String(data.referee?.name??"").trim()
        if(ref&&data.score?.home!=null&&data.score?.away!=null){
          await pool.query(`INSERT INTO referee_match_history
           (fixture_id,referee_name,fixture_date,competition,home_team,away_team,home_score,away_score,source,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT(fixture_id) DO UPDATE SET home_score=EXCLUDED.home_score,away_score=EXCLUDED.away_score,updated_at=now()`,
           [String(f.id??""),ref,date,f.competition,f.home.name,f.away.name,data.score.home,data.score.away,data.source??"fixture"])
        }
        return {fixture:name,imported,status:"saved",feed:data.source??null}
      }catch(e){return {fixture:name,imported:0,status:"error",error:e instanceof Error?e.message:"Import failed"}}
    }))
    // Grade only recorded player markets whose final player row is present.
    // Never turn missing final data into a loss, and never alter the saved probability.
    const graded=await pool.query(`UPDATE prediction_legs l SET
      result_value=CASE
        WHEN l.market='card' THEN CASE WHEN h.yellow_card OR h.red_card THEN 1 ELSE 0 END
        WHEN l.market LIKE 'fouled%' THEN COALESCE(h.fouls_drawn,0)
        WHEN l.market LIKE 'foul%' THEN COALESCE(h.fouls_committed,0)
        WHEN l.market LIKE 'sot%' THEN COALESCE(h.shots_on_target,0)
        WHEN l.market LIKE 'shot%' THEN COALESCE(h.shots,0)
        WHEN l.market LIKE 'goal%' THEN COALESCE(h.goals,0)
        WHEN l.market LIKE 'assist%' THEN COALESCE(h.assists,0)
        ELSE 0 END,
      outcome=CASE
        WHEN l.market='card' THEN h.yellow_card OR h.red_card
        WHEN l.market LIKE 'fouled%' THEN COALESCE(h.fouls_drawn,0)>=COALESCE(l.threshold,1)
        WHEN l.market LIKE 'foul%' THEN COALESCE(h.fouls_committed,0)>=COALESCE(l.threshold,1)
        WHEN l.market LIKE 'sot%' THEN COALESCE(h.shots_on_target,0)>=COALESCE(l.threshold,1)
        WHEN l.market LIKE 'shot%' THEN COALESCE(h.shots,0)>=COALESCE(l.threshold,1)
        WHEN l.market LIKE 'goal%' THEN COALESCE(h.goals,0)>=COALESCE(l.threshold,1)
        WHEN l.market LIKE 'assist%' THEN COALESCE(h.assists,0)>=COALESCE(l.threshold,1)
        ELSE NULL END,
      graded_at=now()
      FROM player_h2h h
      WHERE l.fixture_date=$1 AND h.match_date=$1 AND l.graded_at IS NULL
        AND lower(COALESCE(l.db_player_name,l.player_name))=lower(h.player_name)
        AND (l.player_team IS NULL OR lower(l.player_team)=lower(h.team))
        AND (l.opponent_team IS NULL OR lower(l.opponent_team)=lower(h.opponent))
        AND (l.market='card' OR l.market LIKE 'fouled%' OR l.market LIKE 'foul%' OR l.market LIKE 'sot%' OR l.market LIKE 'shot%' OR l.market LIKE 'goal%' OR l.market LIKE 'assist%')
    `,[date])
    const matchGraded=await pool.query(`UPDATE prediction_legs l SET
      result_value=CASE
        WHEN l.market='homeWin' THEN CASE WHEN m.home_score>m.away_score THEN 1 ELSE 0 END
        WHEN l.market='awayWin' THEN CASE WHEN m.away_score>m.home_score THEN 1 ELSE 0 END
        WHEN l.market='draw' THEN CASE WHEN m.away_score=m.home_score THEN 1 ELSE 0 END
        WHEN l.market IN ('bttsYes','bttsNo') THEN CASE WHEN m.home_score>0 AND m.away_score>0 THEN 1 ELSE 0 END
        ELSE 0 END,
      outcome=CASE
        WHEN l.market='homeWin' THEN m.home_score>m.away_score
        WHEN l.market='awayWin' THEN m.away_score>m.home_score
        WHEN l.market='draw' THEN m.home_score=m.away_score
        WHEN l.market='bttsYes' THEN m.home_score>0 AND m.away_score>0
        WHEN l.market='bttsNo' THEN m.home_score=0 OR m.away_score=0
        ELSE NULL END,
      graded_at=now()
      FROM match_result_audit m
      WHERE l.fixture_date=$1 AND m.fixture_date=$1 AND l.graded_at IS NULL
        AND lower(l.home_team)=lower(m.home_team)
        AND lower(l.away_team)=lower(m.away_team)
        AND l.market IN ('homeWin','awayWin','draw','bttsYes','bttsNo')
    `,[date])
    await pool.query(`UPDATE prediction_runs r SET
      fully_graded=true,won=t.won,graded_at=now()
      FROM (SELECT run_id,count(*) total,count(*) FILTER(WHERE graded_at IS NOT NULL) graded,bool_and(outcome IS TRUE) won
        FROM prediction_legs WHERE fixture_date=$1 GROUP BY run_id) t
      WHERE r.id=t.run_id AND t.total=t.graded AND t.total>0 AND r.fully_graded=false AND NOT EXISTS (SELECT 1 FROM prediction_legs pending WHERE pending.run_id=r.id AND pending.graded_at IS NULL)`,[date])
    const legacy={graded:0,note:"Legacy grading remains on existing scheduled process"}
    return NextResponse.json({ok:true,date,offset,limit,totalFinished:finished.length,
      nextOffset:offset+selected.length<finished.length?offset+selected.length:null,
      results,graded:{player:graded.rowCount??0,match:matchGraded.rowCount??0},legacy,updatedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}})
  }catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Import failed"},{status:500})}
}
