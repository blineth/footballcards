import {pool,isDatabaseConfigured} from "@/lib/db"
import {ensureResearchSchema} from "@/lib/db/ensure-research-schema"

const ESPN:Record<string,string>={
  "Premier League":"eng.1",Championship:"eng.2","League One":"eng.3","League Two":"eng.4",
}
function norm(value:string){
 return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
   .replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
}
function matchesTeam(a:string,b:string){
 const x=norm(a),y=norm(b)
 return x.length>=4&&y.length>=4&&(x===y||(Math.min(x.length,y.length)>=6&&(x.includes(y)||y.includes(x))))
}
function nameOf(p:any){return String(p?.athlete?.displayName??p?.athlete?.fullName??p?.name??"").trim()}
function minuteOf(event:any){
 const input=String(event?.clock?.displayValue??event?.time?.displayValue??event?.time??event?.minute??"")
 const m=input.match(/\b(\d{1,3})\b/)
 return m?Math.max(0,Math.min(130,Number(m[1]))):null
}
function bookingReason(text:string){
 if(/dissent|argu(?:ing|ed)? with (?:the )?referee|protest(?:ing|ed)? (?:the )?decision|abusive language/i.test(text))
   return "dissent (explicit booking event)"
 if(/unsporting behaviour/i.test(text))return "unsporting behaviour (explicit booking event)"
 if(/reckless|late challenge|tactical foul|professional foul/i.test(text))return "challenge/foul (explicit booking event)"
 return null
}
type Fixture={fixture_date:string;competition:string;team_a:string;team_b:string;watched:boolean}
export async function backfillCardConduct(limit=8){
 if(!isDatabaseConfigured)throw Error("Historical database unavailable")
 await ensureResearchSchema()
 await pool.query(`CREATE TABLE IF NOT EXISTS card_conduct_backfill_audit (
  fixture_date date NOT NULL,competition text NOT NULL,team_a text NOT NULL,team_b text NOT NULL,
  status text NOT NULL,reason_count int NOT NULL DEFAULT 0,minute_count int NOT NULL DEFAULT 0,
  last_checked timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_date,competition,team_a,team_b))`)
 const fixtures=await pool.query<Fixture>(`WITH target AS (
    SELECT match_date::date AS fixture_date, competition::text,
     LEAST(team,opponent)::text AS team_a,GREATEST(team,opponent)::text AS team_b,
     bool_or(player_name ~* '(Pedro Neto|Dan Burn|Mac Allister|McAllister|Enzo Fern.ndez)') AS watched
    FROM player_h2h
    WHERE match_date >= CURRENT_DATE-interval '24 months' AND match_date < CURRENT_DATE
      AND yellow_card IS TRUE AND team IS NOT NULL AND opponent IS NOT NULL
      AND competition IN ('Premier League','Championship','League One','League Two')
      AND (booking_reason IS NULL OR yellow_card_minute IS NULL)
    GROUP BY match_date,competition,LEAST(team,opponent),GREATEST(team,opponent)
   )
   SELECT t.fixture_date::text,t.competition,t.team_a,t.team_b,t.watched FROM target t
   WHERE NOT EXISTS (SELECT 1 FROM card_conduct_backfill_audit a
     WHERE a.fixture_date=t.fixture_date AND a.competition=t.competition
       AND a.team_a=t.team_a AND a.team_b=t.team_b
       AND a.last_checked > now()-interval '180 days')
   ORDER BY t.watched DESC,t.fixture_date DESC
   LIMIT $1`,[Math.max(1,Math.min(12,limit))])
 let checked=0,reasonCount=0,minuteCount=0
 const summary:{match:string;date:string;status:string;reasons:number;minutes:number}[]=[]
 for(const fixture of fixtures.rows){
   let reasons=0,minutes=0,status="unavailable"
   try{
     const slug=ESPN[fixture.competition]
     const scoreboard=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${fixture.fixture_date.replaceAll("-","")}&limit=300`,{cache:"no-store",signal:AbortSignal.timeout(4500)})
     if(!scoreboard.ok)throw Error("scoreboard HTTP "+scoreboard.status)
     const board=await scoreboard.json()
     const event=(board?.events??[]).find((e:any)=>{
       const opponents=e?.competitions?.[0]?.competitors??[]
       const h=opponents.find((x:any)=>x.homeAway==="home"),a=opponents.find((x:any)=>x.homeAway==="away")
       const first=String(h?.team?.displayName??""),second=String(a?.team?.displayName??"")
       return (matchesTeam(first,fixture.team_a)&&matchesTeam(second,fixture.team_b))
         ||(matchesTeam(first,fixture.team_b)&&matchesTeam(second,fixture.team_a))
     })
     if(event?.id){
       const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${event.id}`,{cache:"no-store",signal:AbortSignal.timeout(4500)})
       if(response.ok){
         const data=await response.json()
         let found=0
         for(const booking of data?.keyEvents??[]){
           const t=String(booking?.type?.type??booking?.type?.text??"").toLowerCase()
           const raw=String(booking?.text??booking?.shortText??"")
           if(!(t.includes("yellow")||/yellow card/i.test(raw)))continue
           const reason=bookingReason(raw),minute=minuteOf(booking)
           const names=(booking?.participants??[]).map(nameOf).filter(Boolean)
           // Never attribute a booking to the wrong participant when the feed
           // names multiple people without a clear booked-player role.
           if(names.length!==1)continue
           const name=norm(names[0])
           const matched=await pool.query(`UPDATE player_h2h SET
              booking_reason=COALESCE($5,booking_reason),
              yellow_card_minute=COALESCE($6,yellow_card_minute)
             WHERE match_date=$1 AND competition=$2
               AND (team=$3 OR opponent=$3 OR team=$4 OR opponent=$4)
               AND regexp_replace(lower(player_name),'[^a-z0-9]','','g')=$7
               AND yellow_card IS TRUE
             RETURNING id`,[
              fixture.fixture_date,fixture.competition,fixture.team_a,fixture.team_b,
              reason,minute,name.replace(/[^a-z0-9]/g,""),
             ])
           if((matched.rowCount??0)>0){found++;if(reason)reasons+=matched.rowCount??0;if(minute!=null)minutes+=matched.rowCount??0}
         }
         status=found>0?"matched-bookings":"no-explicit-evidence"
       }
     }
   }catch{status="feed-unavailable"}
   checked++;reasonCount+=reasons;minuteCount+=minutes
   await pool.query(`INSERT INTO card_conduct_backfill_audit
       (fixture_date,competition,team_a,team_b,status,reason_count,minute_count,last_checked)
       VALUES($1,$2,$3,$4,$5,$6,$7,now())
       ON CONFLICT (fixture_date,competition,team_a,team_b)
       DO UPDATE SET status=EXCLUDED.status,reason_count=EXCLUDED.reason_count,
         minute_count=EXCLUDED.minute_count,last_checked=now()`,[
        fixture.fixture_date,fixture.competition,fixture.team_a,fixture.team_b,status,reasons,minutes,
       ])
   summary.push({match:fixture.team_a+" v "+fixture.team_b,date:fixture.fixture_date,status,reasons,minutes})
 }
 return {checked,reasons:reasonCount,minutes:minuteCount,fixtures:summary,
   note:"Only explicitly named yellow-card participants and reasons are credited. Source can leave cause unknown."}
}
