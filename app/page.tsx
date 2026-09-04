"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Database, RefreshCw } from "lucide-react"

type Competition = "Premier League" | "Championship"
type Fixture = { id: string; competition: Competition; dateIso: string; day: string; date: string; time: string; home: string; away: string }
type MatchRow = { matchDate: string; opponent?: string | null; minutes?: number | null; foulsCommitted?: number | null; foulsDrawn?: number | null; yellowCard?: boolean | null }
type Candidate = {
  name: string; dbName: string; team: string; position?: string | null; predictedRole?: string | null; predictedStarter?: boolean; predictedLineupConfidence?: string | null; predictedFormation?: string | null; yellows: number; cards90: number; fouls90: number; fouled90?: number | null; sampleLabel: string;
  h2hYellows: number; h2hFouls: number; h2hMatches?: MatchRow[]; score: number; cardRiskScore?: number; band: "STRONG" | "GOOD" | "WATCH";
  currentSeason?: { games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; cards90?: number | null };
  recentFive?: { games?: number; minutes?: number; fouls?: number; yellows?: number; fouls90?: number | null; matches?: MatchRow[] };
  likelyMatchup?: { name: string; position?: string | null; role?: string | null; fouled90?: number | null; type?: string | null; confidence?: string | null } | null;
  refereePlayer?: { matches: number; yellows: number; fouls: number; cardRate?: number | null } | null;
  shortlistReasons?: string[];
}
type Radar = { lineupsConfirmed?: boolean; deepEvidence?: { description?: string }; referee?: { name: string; yellowsPerGame?: number | null; foulsPerGame?: number | null } | null; candidates?: Candidate[] }

const pl: Fixture[] = [
  { id:"pl-ipswich-liverpool-gw3",competition:"Premier League",dateIso:"2026-09-04",day:"Friday",date:"4 Sep",time:"20:00",home:"Ipswich Town",away:"Liverpool" },
  { id:"pl-newcastle-bournemouth-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"12:30",home:"Newcastle United",away:"AFC Bournemouth" },
  { id:"pl-brentford-sunderland-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"15:00",home:"Brentford",away:"Sunderland" },
  { id:"pl-brighton-leeds-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"15:00",home:"Brighton & Hove Albion",away:"Leeds United" },
  { id:"pl-fulham-palace-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"15:00",home:"Fulham",away:"Crystal Palace" },
  { id:"pl-city-coventry-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"15:00",home:"Manchester City",away:"Coventry City" },
  { id:"pl-forest-spurs-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"15:00",home:"Nottingham Forest",away:"Tottenham Hotspur" },
  { id:"pl-hull-villa-gw3",competition:"Premier League",dateIso:"2026-09-05",day:"Saturday",date:"5 Sep",time:"17:30",home:"Hull City",away:"Aston Villa" },
  { id:"pl-everton-man-utd-gw3",competition:"Premier League",dateIso:"2026-09-06",day:"Sunday",date:"6 Sep",time:"14:00",home:"Everton",away:"Manchester United" },
  { id:"pl-arsenal-chelsea-gw3",competition:"Premier League",dateIso:"2026-09-06",day:"Sunday",date:"6 Sep",time:"16:30",home:"Arsenal",away:"Chelsea" },
]
const ch: Fixture[] = [
  { id:"ch-birmingham-bristol",competition:"Championship",dateIso:"2026-08-22",day:"Saturday",date:"22 Aug",time:"12:30",home:"Birmingham City",away:"Bristol City" },
  { id:"ch-lincoln-portsmouth",competition:"Championship",dateIso:"2026-08-22",day:"Saturday",date:"22 Aug",time:"12:30",home:"Lincoln City",away:"Portsmouth" },
  { id:"ch-millwall-norwich",competition:"Championship",dateIso:"2026-08-22",day:"Saturday",date:"22 Aug",time:"12:30",home:"Millwall",away:"Norwich City" },
  { id:"ch-west-brom-burnley",competition:"Championship",dateIso:"2026-08-23",day:"Sunday",date:"23 Aug",time:"12:00",home:"West Bromwich Albion",away:"Burnley" },
]
const byCompetition: Record<Competition, Fixture[]> = { "Premier League": pl, Championship: ch }

function query(f: Fixture) { const p = new URLSearchParams({ date:f.dateIso,home:f.home,away:f.away,competition:f.competition }); return `/api/fixture-radar?${p}` }
function fmtDate(v:string){ const d=new Date(`${v.slice(0,10)}T12:00:00Z`); return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric"}).format(d) }
function minLabel(v:number|null|undefined){ if(v==null)return "minutes unknown"; if(v===0)return "did not play"; return `${v} min` }
function bandClass(b:Candidate["band"]){ return b==="STRONG"?"border-emerald-200 bg-emerald-50 text-emerald-800":b==="GOOD"?"border-amber-200 bg-amber-50 text-amber-800":"border-slate-200 bg-slate-50 text-slate-700" }

export default function HomePage(){
  const [competition,setCompetition]=useState<Competition>("Premier League")
  const [open,setOpen]=useState<string|null>(null)
  const [radar,setRadar]=useState<Record<string,Radar>>({})
  const [loading,setLoading]=useState<Record<string,boolean>>({})
  const fixtures=useMemo(()=>byCompetition[competition],[competition])
  const refresh=useCallback(async(target:Competition)=>{
    const fs=byCompetition[target]; setLoading(x=>({...x,...Object.fromEntries(fs.map(f=>[f.id,true]))}))
    await Promise.all(fs.map(async f=>{ try{ const r=await fetch(query(f),{cache:"no-store"}); if(r.ok){ const data=await r.json() as Radar; setRadar(x=>({...x,[f.id]:data})) } }finally{ setLoading(x=>({...x,[f.id]:false})) }}))
  },[])
  useEffect(()=>{ void refresh(competition); const t=window.setInterval(()=>void refresh(competition),60000); return()=>window.clearInterval(t) },[competition,refresh])

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white shadow-sm"><div className="mx-auto max-w-2xl px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]"><h1 className="text-xl font-bold">Card Research</h1><p className="text-sm text-white/70">Full evidence behind every yellow-card candidate</p><div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">{(["Premier League","Championship"] as Competition[]).map(c=><button key={c} onClick={()=>{setCompetition(c);setOpen(null)}} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}</div></div></header>
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-4"><div className="flex gap-3"><Database className="mt-0.5 size-5"/><div><p className="font-bold">How the research view works</p><p className="mt-1 text-sm text-muted-foreground">It combines season card rate, fouls, recent-five form, H2H history, 2026/27 evidence, referee history and direct positional matchup pressure. Before confirmed teams, current predicted XIs map channels such as LB↔RW, RB↔LW, CB↔ST and DM↔AM; those roles remain labelled predicted until official lineups arrive.</p></div></div></section>
      {fixtures.map(f=>{ const d=radar[f.id], candidates=d?.candidates??[], isOpen=open===f.id; return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <button onClick={()=>setOpen(x=>x===f.id?null:f.id)} className="w-full p-4 text-left"><div className="flex items-center justify-between gap-3"><div><p className="text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">{f.day} · {f.date} · {f.time}</p><p className="mt-1 font-bold">{f.home} v {f.away}</p><p className="mt-1 text-xs font-semibold text-yellow-500">{isOpen?"Hide full research":"View full card research"}</p></div>{isOpen?<ChevronUp/>:<ChevronDown/>}</div></button>
        {isOpen?<div className="border-t border-border bg-secondary/20 p-3"><div className="mb-3 flex items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase text-muted-foreground">Top 10 evidence-ranked candidates</p><p className="text-[0.67rem] text-muted-foreground">{d?.lineupsConfirmed?"Confirmed XI":"Predicted XI / pre-lineup"}{d?.referee?` · Ref ${d.referee.name}${d.referee.yellowsPerGame!=null?` (${d.referee.yellowsPerGame.toFixed(2)} YC/game)`:""}`:""}</p></div><button onClick={()=>void refresh(competition)} className="rounded-lg border bg-card p-2"><RefreshCw className={`size-4 ${loading[f.id]?"animate-spin":""}`}/></button></div>
          <div className="space-y-3">{candidates.slice(0,10).map((c,i)=><article key={c.dbName} className="rounded-xl border border-border bg-card p-3"><div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-sm font-bold">{i+1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="font-bold">{c.name}</p><span className={`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold ${bandClass(c.band)}`}>{c.band}</span><span className="rounded-full bg-secondary px-2 py-0.5 text-[0.62rem] font-bold">risk evidence {Math.round(c.cardRiskScore??c.score)}</span></div><p className="text-xs text-muted-foreground">{c.team} · {c.predictedRole??c.position??"position unknown"} · {c.predictedStarter&&!d?.lineupsConfirmed?"predicted starter":c.sampleLabel}</p>{c.predictedFormation&&!d?.lineupsConfirmed?<p className="mt-0.5 text-[0.65rem] font-semibold text-amber-700">Predicted {c.predictedFormation} · not confirmed</p>:null}
            <div className="mt-2 grid grid-cols-3 gap-2 text-center sm:grid-cols-6"><Stat label="25/26 YC" value={c.yellows}/><Stat label="Cards/90" value={c.cards90} dec/><Stat label="Fouls/90" value={c.fouls90} dec/><Stat label="Fouled/90" value={c.fouled90} dec/><Stat label="H2H YC" value={c.h2hYellows}/><Stat label="H2H fouls" value={c.h2hFouls}/></div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-secondary p-2"><b>Recent 5:</b> {c.recentFive?.yellows??0} YC · {c.recentFive?.fouls??0} fouls · {c.recentFive?.fouls90!=null?`${c.recentFive.fouls90.toFixed(2)} fouls/90`:"rate unknown"}</div><div className="rounded-lg bg-secondary p-2"><b>2026/27:</b> {c.currentSeason?.yellows??0} YC · {c.currentSeason?.fouls??0} fouls · {c.currentSeason?.minutes??0} min</div></div>
            {c.likelyMatchup?<div className="mt-2 rounded-lg border border-border p-2 text-xs"><b>{c.likelyMatchup.type==="direct-predicted-role"&&!d?.lineupsConfirmed?"Predicted direct matchup":"Likely matchup pressure"}:</b> {c.predictedRole??c.position??"Player"} → {c.likelyMatchup.role?`${c.likelyMatchup.role} `:""}{c.likelyMatchup.name}{c.likelyMatchup.fouled90!=null?` · draws ${c.likelyMatchup.fouled90.toFixed(2)} fouls/90`:" · foul-drawn rate unavailable"}{c.likelyMatchup.type==="direct-predicted-role"&&!d?.lineupsConfirmed?" · predicted, not confirmed":""}</div>:null}
            {c.refereePlayer?<div className="mt-2 rounded-lg border border-border p-2 text-xs"><b>With this referee:</b> {c.refereePlayer.yellows} yellows in {c.refereePlayer.matches} matches · {c.refereePlayer.fouls} fouls</div>:null}
            {c.h2hMatches?.length?<div className="mt-3"><p className="mb-1 text-[0.62rem] font-bold uppercase text-muted-foreground">Previous H2H meetings</p><div className="space-y-1">{c.h2hMatches.map((m,j)=><MatchLine key={`${m.matchDate}-${j}`} m={m}/>)}</div></div>:null}
            {c.recentFive?.matches?.length?<div className="mt-3"><p className="mb-1 text-[0.62rem] font-bold uppercase text-muted-foreground">Recent match sample</p><div className="space-y-1">{c.recentFive.matches.map((m,j)=><MatchLine key={`${m.matchDate}-${j}`} m={m}/>)}</div></div>:null}
          </div></div></article>)}</div>
        </div>:null}
      </section>})}
    </div>
  </main>
}

function Stat({label,value,dec=false}:{label:string;value:number|null|undefined;dec?:boolean}){ return <div className="rounded-lg bg-secondary p-2"><p className="font-mono font-bold">{value==null?"—":dec?Number(value).toFixed(2):Math.round(Number(value))}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">{label}</p></div> }
function MatchLine({m}:{m:MatchRow}){ return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary px-2.5 py-2 text-xs"><span className="font-semibold">{fmtDate(m.matchDate)} · {m.opponent??"opponent"} · {minLabel(m.minutes)}</span><span className="text-muted-foreground">{m.foulsCommitted??0} fouls · {m.foulsDrawn??0} drawn{m.yellowCard===true?" · booked":""}</span></div> }
