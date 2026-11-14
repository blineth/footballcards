import { NextResponse } from "next/server"
import { pool, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { londonToday } from "@/lib/date"
import { GET as fixturesGET } from "../fixtures/route"

export const dynamic="force-dynamic"
export const revalidate=900

const COMPETITIONS=["Premier League","Championship","League One","League Two"] as const
type Competition=typeof COMPETITIONS[number]
const LEAGUE_IDS:Record<Competition,string>={
  "Premier League":"39",Championship:"40","League One":"41","League Two":"42",
}
const BOOKS=["Bet365","Sky Bet","William Hill","Paddy Power"] as const

type MatchRow={date:string;team:string;opponent:string;venue:"home"|"away"|"";gf:number;ga:number;result:"W"|"D"|"L";btts:boolean}
type Metrics={team:string;position:number;teams:number;played:number;points:number;ppg:number;winRate:number;drawRate:number;lossRate:number;gd:number;recentForm:string;recentPPG:number;streak:string;venueWinRate:number;venuePPG:number;venueBttsRate:number;venueScoreRate:number;venueConcedeRate:number;bttsRate:number}
type PriceSet={homeWin?:number;draw?:number;awayWin?:number;bttsYes?:number;bttsNo?:number}

function norm(v:any){return String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\b(afc|fc)\b/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")}
function same(a:any,b:any){const x=norm(a),y=norm(b);return Boolean(x&&y&&(x===y||x.includes(y)||y.includes(x)))}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v))}
function pct(v:number){return Math.round(v*1000)/1000}
function seasonYear(date:string){const d=new Date(date+"T12:00:00Z");return d.getUTCMonth()>=6?d.getUTCFullYear():d.getUTCFullYear()-1}
function seasonStart(date:string){return String(seasonYear(date))+"-07-01"}
function historyStart(date:string){const d=new Date(date+"T12:00:00Z");d.setUTCFullYear(d.getUTCFullYear()-3);return d.toISOString().slice(0,10)}
function points(r:"W"|"D"|"L"){return r==="W"?3:r==="D"?1:0}
function ordinal(n:number){const x=n%100;if(x>=11&&x<=13)return n+"th";return n+(n%10===1?"st":n%10===2?"nd":n%10===3?"rd":"th")}

async function matches(competition:Competition,from:string,to:string){
  const sql="SELECT match_date::text AS date, team, opponent, COALESCE(venue,'') AS venue, SUM(COALESCE(goals,0))::int AS goals FROM player_h2h WHERE competition=$1 AND match_date >= $2 AND match_date < $3 AND team IS NOT NULL AND opponent IS NOT NULL GROUP BY match_date,team,opponent,venue ORDER BY match_date"
  const r=await pool.query(sql,[competition,from,to])
  const rows=r.rows.map((x:any)=>({date:String(x.date).slice(0,10),team:String(x.team),opponent:String(x.opponent),venue:String(x.venue??"").toLowerCase(),goals:Number(x.goals??0)}))
  const map=new Map(rows.map((x:any)=>[[x.date,norm(x.team),norm(x.opponent)].join("|"),x]))
  const out:MatchRow[]=[]
  for(const x of rows){
    const other=map.get([x.date,norm(x.opponent),norm(x.team)].join("|")) as any
    if(!other)continue
    const gf=x.goals,ga=other.goals
    out.push({date:x.date,team:x.team,opponent:x.opponent,venue:x.venue==="home"?"home":x.venue==="away"?"away":"",gf,ga,result:gf>ga?"W":gf<ga?"L":"D",btts:gf>0&&ga>0})
  }
  return out
}
function table(all:MatchRow[]){
  const teams=[...new Set(all.map(m=>m.team))]
  const rows=teams.map(team=>{const ms=all.filter(m=>same(m.team,team));const gf=ms.reduce((s,m)=>s+m.gf,0),ga=ms.reduce((s,m)=>s+m.ga,0);return{team,pts:ms.reduce((s,m)=>s+points(m.result),0),gd:gf-ga,gf}})
    .sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf)
  return {teams:rows.map(r=>r.team),positions:new Map(rows.map((r,i)=>[norm(r.team),i+1]))}
}
function canonical(name:string,teams:string[]){return teams.find(t=>norm(t)===norm(name))??teams.find(t=>same(t,name))??name}
function streak(rows:MatchRow[]){const r=[...rows].sort((a,b)=>b.date.localeCompare(a.date));if(!r.length)return "—";const first=r[0].result;let n=0;for(const m of r){if(m.result!==first)break;n++}return first+String(n)}
function metrics(team:string,all:MatchRow[],positions:Map<string,number>,teamCount:number,venue:"home"|"away"):Metrics{
  const rows=all.filter(m=>same(m.team,team)).sort((a,b)=>a.date.localeCompare(b.date)),recent=rows.slice(-5),split=rows.filter(m=>m.venue===venue)
  const rate=(xs:MatchRow[],f:(m:MatchRow)=>boolean)=>xs.length?xs.filter(f).length/xs.length:.5
  const pts=rows.reduce((s,m)=>s+points(m.result),0),gf=rows.reduce((s,m)=>s+m.gf,0),ga=rows.reduce((s,m)=>s+m.ga,0)
  return {team,position:positions.get(norm(team))??teamCount,teams:teamCount,played:rows.length,points:pts,ppg:rows.length?pts/rows.length:1.2,winRate:rate(rows,m=>m.result==="W"),drawRate:rate(rows,m=>m.result==="D"),lossRate:rate(rows,m=>m.result==="L"),gd:gf-ga,recentForm:recent.map(m=>m.result).join("")||"—",recentPPG:recent.length?recent.reduce((s,m)=>s+points(m.result),0)/recent.length:1.2,streak:streak(rows),venueWinRate:rate(split,m=>m.result==="W"),venuePPG:split.length?split.reduce((s,m)=>s+points(m.result),0)/split.length:1.2,venueBttsRate:rate(split,m=>m.btts),venueScoreRate:rate(split,m=>m.gf>0),venueConcedeRate:rate(split,m=>m.ga>0),bttsRate:rate(rows,m=>m.btts)}
}
function h2h(home:string,away:string,history:MatchRow[]){
  const rows=history.filter(m=>same(m.team,home)&&same(m.opponent,away)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6)
  const hw=rows.filter(m=>m.result==="W").length,d=rows.filter(m=>m.result==="D").length,aw=rows.filter(m=>m.result==="L").length
  return {matches:rows.length,homeWins:hw,draws:d,awayWins:aw,homeWinRate:rows.length?hw/rows.length:.5,bttsRate:rows.length?rows.filter(m=>m.btts).length/rows.length:.5}
}
function strength(m:Metrics){const pos=m.teams>1?1-(m.position-1)/(m.teams-1):.5;const gd=m.played?m.gd/m.played:0;const gdScore=1/(1+Math.exp(-gd*1.25));return pos*.25+(m.ppg/3)*.22+(m.recentPPG/3)*.22+(m.venuePPG/3)*.16+gdScore*.10+m.winRate*.05}
function resultProb(home:Metrics,away:Metrics,h:any){
  const reliability=clamp(Math.min(home.played,away.played)/8,.25,1)
  let diff=strength(home)-strength(away)+.055
  if(h.matches>=2)diff+=(h.homeWinRate-.5)*Math.min(.08,h.matches*.012)
  for(const [m,sign] of [[home,1],[away,-1]] as const){if(m.streak.startsWith("W"))diff+=sign*Math.min(.06,Number(m.streak.slice(1)||0)*.012);if(m.streak.startsWith("L"))diff-=sign*Math.min(.06,Number(m.streak.slice(1)||0)*.012)}
  const draw=clamp((home.drawRate+away.drawRate)/2*.55+.11,.18,.34),share=1/(1+Math.exp(-diff*4.2))
  let hp=(1-draw)*share,ap=(1-draw)*(1-share),dp=draw
  hp=hp*reliability+.42*(1-reliability);dp=dp*reliability+.28*(1-reliability);ap=ap*reliability+.30*(1-reliability)
  const t=hp+dp+ap;return{home:pct(hp/t),draw:pct(dp/t),away:pct(ap/t),reliability}
}
function bttsProb(home:Metrics,away:Metrics,h:any){
  const rel=clamp(Math.min(home.played,away.played)/8,.25,1)
  const scoring=((home.venueScoreRate*away.venueConcedeRate)+(away.venueScoreRate*home.venueConcedeRate))/2
  let p=home.venueBttsRate*.24+away.venueBttsRate*.24+home.bttsRate*.13+away.bttsRate*.13+scoring*.18+h.bttsRate*.08
  return pct(clamp(p*rel+.5*(1-rel),.16,.84))
}
function grade(certainty:number,reliability:number){const s=certainty*.72+reliability*.28;return s>=.72?"A":s>=.60?"B":s>=.49?"C":"D"}
function preferredBook(name:string){const n=norm(name);if(n.includes("bet365"))return "Bet365";if(n.includes("sky bet")||n.includes("skybet"))return "Sky Bet";if(n.includes("william hill"))return "William Hill";if(n.includes("paddy power"))return "Paddy Power";return null}
async function oddsRows(competition:Competition,date:string){
  const key=process.env.API_FOOTBALL_KEY;if(!key)return []
  try{const u=new URL("https://v3.football.api-sports.io/odds");u.searchParams.set("league",LEAGUE_IDS[competition]);u.searchParams.set("season",String(seasonYear(date)));u.searchParams.set("date",date);u.searchParams.set("timezone","Europe/London")
    const r=await fetch(u,{headers:{"x-apisports-key":key},next:{revalidate:900},signal:AbortSignal.timeout(10000)});if(!r.ok)return[];const j=await r.json();return Array.isArray(j?.response)?j.response:[]
  }catch{return[]}
}
function priceMap(rows:any[],home:string,away:string){
  const out:Record<string,PriceSet>={},row=rows.find((x:any)=>same(x?.teams?.home?.name,home)&&same(x?.teams?.away?.name,away));if(!row)return out
  for(const b of row?.bookmakers??[]){const book=preferredBook(String(b?.name??""));if(!book)continue;const p=out[book]??{}
    for(const bet of b?.bets??[]){const name=norm(bet?.name),isResult=/match winner|1x2|full time result|fulltime result/.test(name),isBtts=/both teams.*score|btts/.test(name);if(!isResult&&!isBtts)continue
      for(const v of bet?.values??[]){const odd=Number(v?.odd);if(!Number.isFinite(odd)||odd<=1)continue;const val=String(v?.value??"")
        if(isResult){if(same(val,home)||norm(val)==="home"||norm(val)==="1")p.homeWin=odd;else if(same(val,away)||norm(val)==="away"||norm(val)==="2")p.awayWin=odd;else if(norm(val)==="draw"||norm(val)==="x")p.draw=odd}
        else{if(norm(val)==="yes")p.bttsYes=odd;else if(norm(val)==="no")p.bttsNo=odd}
      }
    }out[book]=p
  }return out
}
function exactPrice(pred:any,market:string,book:string){const p=pred.oddsByBook?.[book];if(!p)return null;return market==="homeWin"?p.homeWin??null:market==="awayWin"?p.awayWin??null:market==="bttsYes"?p.bttsYes??null:market==="bttsNo"?p.bttsNo??null:null}
function buildSlip(id:string,title:string,subtitle:string,legs:any[]){
  const xs=legs.filter(Boolean),fair=xs.length?xs.reduce((v,l)=>v*(1/Math.max(.05,l.probability)),1):null
  let book:string|null=null,exact:number|null=null
  for(const b of BOOKS){const prices=xs.map(l=>exactPrice(l.prediction,l.market,b));if(!prices.length||prices.some(x=>x==null))continue;const combined=prices.reduce((v,x)=>v*Number(x),1);if(exact==null||combined>exact){book=b;exact=combined}}
  return {id,title,subtitle,legs:xs.map(l=>({fixtureId:l.prediction.id,competition:l.prediction.competition,kickoff:l.prediction.kickoff,home:l.prediction.home,away:l.prediction.away,market:l.market,label:l.label,probability:pct(l.probability),fairOdds:Math.round((1/Math.max(.05,l.probability))*100)/100,bookmakerOdds:book?exactPrice(l.prediction,l.market,book):null,bookmaker:book,grade:l.grade,reasons:l.reasons})),fairCombinedOdds:fair==null?null:Math.round(fair*100)/100,bookmaker:book,exactCombinedOdds:exact==null?null:Math.round(exact*100)/100,exactPriced:Boolean(book&&exact)}
}

export async function GET(request:Request){
  if(!isDatabaseConfigured)return NextResponse.json({ok:false,error:"Database not connected"},{status:503})
  await ensureResearchSchema()
  const url=new URL(request.url),date=url.searchParams.get("date")??londonToday()
  try{
    const fixtureRes=await fixturesGET(new Request("http://local/api/fixtures?"+new URLSearchParams({date,nextIfEmpty:"0"}).toString()))
    if(!fixtureRes.ok)return fixtureRes
    const fixtureData=await fixtureRes.json()
    const packs=new Map<Competition,{season:MatchRow[];history:MatchRow[];odds:any[]}>()
    await Promise.all(COMPETITIONS.map(async c=>{const [s,h,o]=await Promise.all([matches(c,seasonStart(date),date),matches(c,historyStart(date),date),oddsRows(c,date)]);packs.set(c,{season:s,history:h,odds:o})}))
    const predictions:any[]=[]
    for(const competition of COMPETITIONS){const pack=packs.get(competition)!,tbl=table(pack.season)
      for(const f of fixtureData?.leagues?.[competition]??[]){const home=canonical(String(f.home?.name??""),tbl.teams),away=canonical(String(f.away?.name??""),tbl.teams),hm=metrics(home,pack.season,tbl.positions,tbl.teams.length||24,"home"),am=metrics(away,pack.season,tbl.positions,tbl.teams.length||24,"away"),hh=h2h(home,away,pack.history),wp=resultProb(hm,am,hh),bp=bttsProb(hm,am,hh)
        const side=wp.home>=wp.away&&wp.home>=.43?"home":wp.away>wp.home&&wp.away>=.40?"away":null,winnerP=side==="home"?wp.home:side==="away"?wp.away:Math.max(wp.home,wp.away),bpick=bp>=.55?"yes":bp<=.45?"no":null,bprob=bpick==="yes"?bp:bpick==="no"?1-bp:Math.max(bp,1-bp),rel=wp.reliability
        const reasons=[ordinal(hm.position)+" vs "+ordinal(am.position)+" in "+competition,String(f.home.name)+" home win "+Math.round(hm.venueWinRate*100)+"% · "+String(f.away.name)+" away win "+Math.round(am.venueWinRate*100)+"%","Form "+String(f.home.name)+" "+hm.recentForm+" · "+String(f.away.name)+" "+am.recentForm]
        if(hh.matches>=2)reasons.push("H2H "+String(f.home.name)+" "+hh.homeWins+"W · "+hh.draws+"D · "+String(f.away.name)+" "+hh.awayWins+"W · BTTS "+Math.round(hh.bttsRate*100)+"%")
        predictions.push({id:String(f.id),competition,kickoff:String(f.kickoff),home:String(f.home.name),away:String(f.away.name),homeCrest:f.home?.crest??null,awayCrest:f.away?.crest??null,homeStats:hm,awayStats:am,h2h:hh,probabilities:{homeWin:wp.home,draw:wp.draw,awayWin:wp.away,bttsYes:bp,bttsNo:pct(1-bp)},winnerPick:side?{side,team:side==="home"?String(f.home.name):String(f.away.name),loser:side==="home"?String(f.away.name):String(f.home.name),probability:pct(winnerP),grade:grade(winnerP,rel)}:null,bttsPick:bpick?{selection:bpick,probability:pct(bprob),grade:grade(.5+Math.abs(bp-.5),rel)}:null,reasons,oddsByBook:priceMap(pack.odds,String(f.home.name),String(f.away.name))})
      }
    }
    const wins=predictions.filter(p=>p.winnerPick&&p.winnerPick.grade!=="D").map(p=>({prediction:p,market:p.winnerPick.side==="home"?"homeWin":"awayWin",label:p.winnerPick.team+" to win",probability:p.winnerPick.probability,grade:p.winnerPick.grade,reasons:p.reasons})).sort((a,b)=>b.probability-a.probability)
    const btts=predictions.filter(p=>p.bttsPick&&p.bttsPick.grade!=="D").map(p=>({prediction:p,market:p.bttsPick.selection==="yes"?"bttsYes":"bttsNo",label:"BTTS "+(p.bttsPick.selection==="yes"?"Yes":"No"),probability:p.bttsPick.probability,grade:p.bttsPick.grade,reasons:p.reasons})).sort((a,b)=>b.probability-a.probability)
    const mixed=predictions.map(p=>{const w=p.winnerPick?{prediction:p,market:p.winnerPick.side==="home"?"homeWin":"awayWin",label:p.winnerPick.team+" to win",probability:p.winnerPick.probability,grade:p.winnerPick.grade,reasons:p.reasons,score:(p.winnerPick.probability-.34)/.45}:null,b=p.bttsPick?{prediction:p,market:p.bttsPick.selection==="yes"?"bttsYes":"bttsNo",label:"BTTS "+(p.bttsPick.selection==="yes"?"Yes":"No"),probability:p.bttsPick.probability,grade:p.bttsPick.grade,reasons:p.reasons,score:(p.bttsPick.probability-.5)/.34}:null;return [w,b].filter(Boolean).sort((a:any,b:any)=>b.score-a.score)[0]??null}).filter(Boolean).sort((a:any,b:any)=>b.score-a.score)
    return NextResponse.json({ok:true,date,generatedAt:new Date().toISOString(),fixtureCount:predictions.length,predictions,slips:[buildSlip("safer","Safer 3-Leg Acca","Three strongest single-match selections.",mixed.slice(0,3)),buildSlip("win-lose","Win / Lose Acca","Strongest direct winner calls; the opposing team is the model's expected loser.",wins.slice(0,5)),buildSlip("btts","BTTS Acca","Strongest Both Teams To Score Yes/No selections.",btts.slice(0,5)),buildSlip("mixed","Mixed Acca","Best winner or BTTS selection from the strongest fixtures.",mixed.slice(0,6))],methodology:{resultModel:"League position, PPG, recent five-match form, streaks, home/away PPG and win rate, goal difference and recent H2H with sample shrinkage.",bttsModel:"Home/away BTTS, scoring and conceding rates, overall BTTS and H2H BTTS.",pricing:"Exact combined odds are shown only when one preferred bookmaker prices every leg. Otherwise model fair odds are shown.",caution:"Model estimates, not guarantees. Team news and match events can materially change outcomes."}},{headers:{"Cache-Control":"public, s-maxage=900, stale-while-revalidate=900"}})
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"Accumulator analysis failed"},{status:500})}
}
