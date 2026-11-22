import {pool,isDatabaseConfigured} from "@/lib/db"
import {ensureResearchSchema} from "@/lib/db/ensure-research-schema"

type Market="card"|"foul1"|"foul2"|"fouled1"|"shot1"|"shot2"|"sot1"
type HistoryRow={player_name:string;team:string|null;opponent:string|null;competition:string|null;match_date:string;minutes:number|null;yellow_card:boolean|null;red_card:boolean|null;fouls_committed:number|null;fouls_drawn:number|null;shots:number|null;shots_on_target:number|null;booking_reason:string|null;yellow_card_minute:number|null}
type PriorSample={date:string;player:string;team:string;competition:string;fixture:string;market:Market;outcome:boolean;history:boolean[];nonFoulCards:boolean[];confirmedDissent:boolean[];lateCards:boolean[]}
type Score={market:Market;model:string;phase:"train"|"holdout";sample:number;hits:number;hitRate:number;brier:number;avgPredicted:number;distinctDates:number;fixtureCount:number}
type Policy={id:string;recentWeight:number;priorStrength:number;minHistory:number;behaviourWeight?:number;dissentWeight?:number;lateWeight?:number}
const MARKET_TYPES:Market[]=["card","foul1","foul2","fouled1","shot1","shot2","sot1"]
const POLICIES:Policy[]=[
 {id:"baseline",recentWeight:0,priorStrength:8,minHistory:4},
 {id:"recent-25",recentWeight:.25,priorStrength:8,minHistory:4},
 {id:"recent-50",recentWeight:.50,priorStrength:8,minHistory:4},
 {id:"recent-65",recentWeight:.65,priorStrength:8,minHistory:4},
 {id:"recent-25-strong-prior",recentWeight:.25,priorStrength:16,minHistory:4},
 {id:"recent-50-strong-prior",recentWeight:.50,priorStrength:16,minHistory:4},
 // Explicitly test card pathways not explained by recorded fouls.
 {id:"card-no-foul",recentWeight:.25,priorStrength:8,minHistory:4,behaviourWeight:.65},
 {id:"card-no-foul-strong",recentWeight:.25,priorStrength:8,minHistory:4,behaviourWeight:1.2},
 {id:"card-dissent-late",recentWeight:.25,priorStrength:8,minHistory:4,behaviourWeight:.65,dissentWeight:.8,lateWeight:.35},
]
const marketPrior:Record<Market,number>={card:.18,foul1:.65,foul2:.32,fouled1:.56,shot1:.60,shot2:.30,sot1:.30}
function outcome(row:HistoryRow,m:Market):boolean|null{
 const n=(v:number|null)=>v==null?null:Number(v)
 if(m==="card")return row.yellow_card==null&&row.red_card==null?null:row.yellow_card===true||row.red_card===true
 const key=m==="foul1"||m==="foul2"?row.fouls_committed:m==="fouled1"?row.fouls_drawn:m==="sot1"?row.shots_on_target:row.shots
 const x=n(key);return x==null?null:x>=(m.endsWith("2")?2:1)
}
function predict(history:boolean[],market:Market,policy:Policy,evidence?:Pick<PriorSample,"nonFoulCards"|"confirmedDissent"|"lateCards">){
 const n=history.length
 const hits=history.reduce((a,x)=>a+Number(x),0)
 const rate=(hits+marketPrior[market]*policy.priorStrength)/(n+policy.priorStrength)
 const recent=history.slice(-5)
 const recentRate=(recent.reduce((a,x)=>a+Number(x),0)+marketPrior[market]*4)/(recent.length+4)
 let p=(1-policy.recentWeight)*rate+policy.recentWeight*recentRate
 if(market==="card"&&n>=8&&evidence){
   const smoothed=(arr:boolean[],prior:number)=>(arr.filter(Boolean).length+prior*12)/(arr.length+12)
   // A yellow with zero recorded fouls is NOT automatically a dissent card.
   // These independent, shrinkage-stabilised features remain research candidates.
   const nonFoulRate=smoothed(evidence.nonFoulCards,.04)
   const dissentRate=smoothed(evidence.confirmedDissent,.01)
   const lateRate=smoothed(evidence.lateCards,.04)
   const reliable=Math.min(1,(n-4)/20)
   p+=reliable*((policy.behaviourWeight??0)*(nonFoulRate-.04)
       +(policy.dissentWeight??0)*(dissentRate-.01)
       +(policy.lateWeight??0)*(lateRate-.04))
 }
 return Math.max(.02,Math.min(.98,p))
}
function emptyScore(m:Market,policy:string,phase:"train"|"holdout"):Score{
 return {market:m,model:policy,phase,sample:0,hits:0,hitRate:0,brier:0,avgPredicted:0,distinctDates:0,fixtureCount:0}
}
function summarize(rows:Array<{date:string;fixture:string;p:number;hit:boolean}>,market:Market,policy:string,phase:"train"|"holdout"):Score{
 const value=emptyScore(market,policy,phase)
 value.sample=rows.length
 if(!rows.length)return value
 value.hits=rows.filter(x=>x.hit).length
 value.hitRate=Number((value.hits/rows.length).toFixed(4))
 value.brier=Number((rows.reduce((a,x)=>a+(x.p-Number(x.hit))**2,0)/rows.length).toFixed(5))
 value.avgPredicted=Number((rows.reduce((a,x)=>a+x.p,0)/rows.length).toFixed(4))
 value.distinctDates=new Set(rows.map(x=>x.date)).size
 value.fixtureCount=new Set(rows.map(x=>x.fixture)).size
 return value
}
type LearningPick={date:string;fixture:string;player:string;team:string;competition:string;market:Market;model:string;probability:number;hit:boolean;priorMatches:number;lastFiveHits:number;nonFoulCards:number;confirmedDissentBookings:number;lateBookings:number;period:"train"|"holdout"}
function getTopPicks(samples:PriorSample[],policy:Policy,period:"train"|"holdout",market:Market){
 const best=new Map<string,LearningPick>()
 for(const row of samples){
  if(row.market!==market||row.history.length<policy.minHistory)continue
  const p=predict(row.history,market,policy,row)
  const old=best.get(row.fixture)
  if(!old||p>old.probability)best.set(row.fixture,{date:row.date,fixture:row.fixture,player:row.player,team:row.team,
     competition:row.competition,market,model:policy.id,probability:Number(p.toFixed(4)),
     hit:row.outcome,priorMatches:row.history.length,lastFiveHits:row.history.slice(-5).filter(Boolean).length,
     nonFoulCards:row.nonFoulCards.filter(Boolean).length,
     confirmedDissentBookings:row.confirmedDissent.filter(Boolean).length,
     lateBookings:row.lateCards.filter(Boolean).length,period})
 }
 return [...best.values()]
}
function selectTop(samples:PriorSample[],policy:Policy,phase:"train"|"holdout",market:Market){
 const best=new Map<string,{date:string;fixture:string;p:number;hit:boolean}>()
 for(const row of samples){
   if(row.market!==market||row.history.length<policy.minHistory)continue
   const p=predict(row.history,market,policy,row)
   const key=row.fixture
   const previous=best.get(key)
   if(!previous||p>previous.p)best.set(key,{date:row.date,fixture:key,p,hit:row.outcome})
 }
 return summarize([...best.values()],market,policy.id,phase)
}
export async function runPregameLearning(){
 if(!isDatabaseConfigured)throw Error("Historical database unavailable")
 await ensureResearchSchema()
 await pool.query(`CREATE TABLE IF NOT EXISTS pregame_learning_runs (
    id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL, source_rows integer NOT NULL, unique_fixtures integer NOT NULL,
    first_date date,last_date date, training_end date, results jsonb NOT NULL,
    recommendations jsonb NOT NULL, methodology text NOT NULL,
    review_examples jsonb NOT NULL DEFAULT '[]'::jsonb)`)
 await pool.query(`ALTER TABLE pregame_learning_runs ADD COLUMN IF NOT EXISTS review_examples jsonb NOT NULL DEFAULT '[]'::jsonb`)
 const query=await pool.query<HistoryRow>(`SELECT player_name,team,opponent,competition,
     match_date::text,minutes,yellow_card,red_card,fouls_committed,fouls_drawn,shots,shots_on_target,booking_reason,yellow_card_minute
     FROM player_h2h
     WHERE match_date >= current_date-interval '36 months'
       AND match_date < current_date AND player_name IS NOT NULL
       AND competition IS NOT NULL AND team IS NOT NULL AND opponent IS NOT NULL
     ORDER BY match_date,player_name,opponent
     LIMIT 70000`)
 const rows=query.rows
 const first=rows[0]?.match_date??null,last=rows[rows.length-1]?.match_date??null
 const dates=[...new Set(rows.map(r=>r.match_date))].sort()
 const boundary=dates[Math.max(0,Math.floor(dates.length*.8)-1)]??""
 const history=new Map<string,Record<Market,boolean[]>>()
 const behaviour=new Map<string,{nonFoulCards:boolean[];confirmedDissent:boolean[];lateCards:boolean[]}>()
 const examples:PriorSample[]=[]
 const seen=new Set<string>()
 const fixtures=new Set<string>()
 let openDate:string|null=null
 let pending:Array<{prior:Record<Market,boolean[]>;market:Market;hit:boolean}>=[]
 let pendingBehaviour:Array<{list:boolean[];hit:boolean}>=[]
 const pushCapped=(list:boolean[],hit:boolean)=>{list.push(hit);if(list.length>30)list.shift()}
 const commitDay=()=>{
   for(const item of pending){
     item.prior[item.market].push(item.hit)
     if(item.prior[item.market].length>30)item.prior[item.market].shift()
   }
   pending=[]
   for(const item of pendingBehaviour)pushCapped(item.list,item.hit)
   pendingBehaviour=[]
 }
 for(const row of rows){
   if(openDate!==row.match_date){
     commitDay()
     openDate=row.match_date
   }
   const name=String(row.player_name).toLowerCase().trim()
   const league=String(row.competition).toLowerCase().trim()
   // Never mix separate players merely because they share a short surname.
   const playerKey=league+"|"+String(row.team).toLowerCase().trim()+"|"+name
   const fixture=row.match_date+"|"+league+"|"+[String(row.team).toLowerCase().trim(),String(row.opponent).toLowerCase().trim()].sort().join("|")
   const rowKey=fixture+"|"+playerKey
   if(seen.has(rowKey))continue
   seen.add(rowKey);fixtures.add(fixture)
   let past=history.get(playerKey)
   if(!past){past=Object.fromEntries(MARKET_TYPES.map(m=>[m,[]])) as Record<Market,boolean[]>;history.set(playerKey,past)}
   let conduct=behaviour.get(playerKey)
   if(!conduct){conduct={nonFoulCards:[],confirmedDissent:[],lateCards:[]};behaviour.set(playerKey,conduct)}
   const observedConduct={nonFoulCards:[...conduct.nonFoulCards],confirmedDissent:[...conduct.confirmedDissent],lateCards:[...conduct.lateCards]}
   const before=Object.fromEntries(MARKET_TYPES.map(m=>[m,[...past![m]]])) as Record<Market,boolean[]>
   // Avoid including zero-minute squad members and non-appearance records.
   if(row.minutes!=null&&Number(row.minutes)<25)continue
   for(const market of MARKET_TYPES){
     const hit=outcome(row,market)
     if(hit===null)continue
     if(before[market].length>=4)examples.push({date:row.match_date,player:name,team:String(row.team),competition:league,fixture,market,outcome:hit,history:before[market],...observedConduct})
     pending.push({prior:past,market,hit})
   }
   const booked=row.yellow_card===true||row.red_card===true
   if(row.fouls_committed!=null)pendingBehaviour.push({list:conduct.nonFoulCards,hit:booked&&Number(row.fouls_committed)===0})
   // An explicit reason, not zero fouls, is required to call it dissent.
   pendingBehaviour.push({list:conduct.confirmedDissent,hit:booked&&/dissent/i.test(row.booking_reason??"")})
   pendingBehaviour.push({list:conduct.lateCards,hit:row.yellow_card===true&&row.yellow_card_minute!=null&&Number(row.yellow_card_minute)>=80})
 }
 commitDay()
 const train=examples.filter(x=>x.date<=boundary)
 const holdout=examples.filter(x=>x.date>boundary)
 const results:Score[]=[]
 const examplesAudit:LearningPick[]=[]
 const recommendations:Array<{market:Market;candidate:string;baselineHoldout:Score;candidateHoldout:Score;training:Score;adopted:boolean;reason:string}>=[]
 for(const market of MARKET_TYPES){
   const candidates=market==="card"?POLICIES:POLICIES.filter(x=>!(x.behaviourWeight||x.dissentWeight||x.lateWeight))
   const trainRows=candidates.map(policy=>selectTop(train,policy,"train",market))
   const baseline=trainRows[0]
   // Rank on earlier fixtures only. Later outcomes do not select the policy.
   const champion=trainRows.filter(x=>x.sample>=60).sort((a,b)=>a.brier-b.brier)[0]??baseline
   const baseHoldout=selectTop(holdout,POLICIES[0],"holdout",market)
   const chosen=POLICIES.find(x=>x.id===champion.model)??POLICIES[0]
   const testedHoldout=selectTop(holdout,chosen,"holdout",market)
   const holdoutPicks=getTopPicks(holdout,chosen,"holdout",market).sort((a,b)=>b.date.localeCompare(a.date))
   examplesAudit.push(...holdoutPicks.filter(x=>!x.hit).slice(0,12),...holdoutPicks.filter(x=>x.hit).slice(0,8))
   results.push(...trainRows,baseHoldout,testedHoldout)
   const meetsSize=champion.sample>=200&&baseHoldout.sample>=80&&testedHoldout.sample>=80&&testedHoldout.distinctDates>=10
   const exceeds=champion.model!=="baseline"&&champion.brier+0.004<baseline.brier&&testedHoldout.brier+0.004<baseHoldout.brier
   // No automatic changes to actual betting recommendations from an unvalidated proxy backtest.
   recommendations.push({market,candidate:champion.model,baselineHoldout:baseHoldout,candidateHoldout:testedHoldout,training:champion,adopted:false,
     reason:!meetsSize?"Insufficient independent holdout fixtures for production promotion":!exceeds?"No reliable out-of-sample Brier improvement":"Promising shadow candidate; must be validated against the real published model and prices before adoption"})
 }
 const status=dates.length<12||examples.length<200?"insufficient-history":"shadow-evaluated"
 const methodology="Yellow-card candidates additionally test earlier bookings with zero recorded fouls, documented dissent booking events, and late-match bookings. Zero recorded fouls is a behavioural proxy, NOT evidence of dissent. Explicit booking causes are only counted when the match feed states them. Candidate performance must beat the unadjusted model on later fixtures. Chronological fixture-date split (first 80% train, last 20% holdout). For each player, league and fixture, rolling binary market rates use strictly earlier player matches only; fewer than four prior appearances are excluded. Candidate recency/prior weights are selected on training dates, then independently scored on held-out dates. Top single player per match and market, not every player, is graded. Baseline is an historical Bayesian proxy, not an exact replay of the website's old scoring engine; historical exact bookmaker odds and commentary are not reconstructed. Shadow research only; no automatic production promotion."
 const saved=await pool.query(`INSERT INTO pregame_learning_runs
   (status,source_rows,unique_fixtures,first_date,last_date,training_end,results,recommendations,methodology,review_examples)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb) RETURNING id,created_at`,
   [status,rows.length,fixtures.size,first,last,boundary,JSON.stringify(results),JSON.stringify(recommendations),methodology,JSON.stringify(examplesAudit)])
 return {id:saved.rows[0].id,createdAt:saved.rows[0].created_at,status,sourceRows:rows.length,
   uniqueFixtures:fixtures.size,matchDates:dates.length,trainingEnd:boundary,trainingSamples:train.length,holdoutSamples:holdout.length,
   results,recommendations,reviewExamples:examplesAudit,methodology}
}
export async function latestPregameLearning(){
 if(!isDatabaseConfigured)return null
 await ensureResearchSchema()
 const check=await pool.query(`SELECT to_regclass('public.pregame_learning_runs') AS exists`)
 if(!check.rows[0]?.exists)return null
 const result=await pool.query(`SELECT * FROM pregame_learning_runs ORDER BY id DESC LIMIT 1`)
 return result.rows[0]??null
}
