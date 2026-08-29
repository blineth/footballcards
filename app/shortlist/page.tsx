"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"

type Fixture={id:string;competition:"Premier League";dateIso:string;day:string;date:string;time:string;home:string;away:string}
type Candidate={name:string;dbName:string;team:string;sampleLabel:string;yellows:number;cards90:number;fouls90:number;fouled90?:number|null;h2hYellows:number;h2hFouls:number;cardRiskScore?:number;score:number;shortlistReasons?:string[];currentSeason?:{yellows?:number;fouls?:number;minutes?:number};recentFive?:{yellows?:number;fouls?:number;fouls90?:number|null};likelyMatchup?:{name:string;fouled90?:number|null}|null;refereePlayer?:{matches:number;yellows:number}|null}
type Radar={lineupsConfirmed?:boolean;referee?:{name:string;yellowsPerGame?:number|null}|null;candidates?:Candidate[]}

const fixtures:Fixture[]=[
{id:"pl-palace-city",competition:"Premier League",dateIso:"2026-08-28",day:"Friday",date:"28 Aug",time:"20:00",home:"Crystal Palace",away:"Manchester City"},
{id:"pl-liverpool-forest",competition:"Premier League",dateIso:"2026-08-29",day:"Saturday",date:"29 Aug",time:"12:30",home:"Liverpool",away:"Nottingham Forest"},
{id:"pl-bournemouth-everton",competition:"Premier League",dateIso:"2026-08-29",day:"Saturday",date:"29 Aug",time:"15:00",home:"AFC Bournemouth",away:"Everton"},
{id:"pl-coventry-hull",competition:"Premier League",dateIso:"2026-08-29",day:"Saturday",date:"29 Aug",time:"15:00",home:"Coventry City",away:"Hull City"},
{id:"pl-spurs-newcastle",competition:"Premier League",dateIso:"2026-08-29",day:"Saturday",date:"29 Aug",time:"17:30",home:"Tottenham Hotspur",away:"Newcastle United"},
{id:"pl-chelsea-brighton",competition:"Premier League",dateIso:"2026-08-30",day:"Sunday",date:"30 Aug",time:"14:00",home:"Chelsea",away:"Brighton & Hove Albion"},
{id:"pl-leeds-brentford",competition:"Premier League",dateIso:"2026-08-30",day:"Sunday",date:"30 Aug",time:"14:00",home:"Leeds United",away:"Brentford"},
{id:"pl-sunderland-fulham",competition:"Premier League",dateIso:"2026-08-30",day:"Sunday",date:"30 Aug",time:"14:00",home:"Sunderland",away:"Fulham"},
{id:"pl-man-utd-ipswich",competition:"Premier League",dateIso:"2026-08-30",day:"Sunday",date:"30 Aug",time:"16:30",home:"Manchester United",away:"Ipswich Town"},
{id:"pl-villa-arsenal",competition:"Premier League",dateIso:"2026-08-31",day:"Monday",date:"31 Aug",time:"20:00",home:"Aston Villa",away:"Arsenal"},
]
function query(f:Fixture){const p=new URLSearchParams({date:f.dateIso,home:f.home,away:f.away,competition:f.competition});return `/api/fixture-radar?${p}`}
function strength(c:Candidate){return Number(c.cardRiskScore??c.score??0)}
function picks(cs:Candidate[]){const ordered=[...cs].sort((a,b)=>strength(b)-strength(a));const chosen=ordered.slice(0,2);for(const c of ordered.slice(2)){if(chosen.length>=4)break;const reasons=c.shortlistReasons??[];if(strength(c)>=72||c.h2hYellows>=2||(c.h2hYellows>=1&&reasons.length>=2))chosen.push(c)}return chosen}

export default function ShortlistPage(){
 const[radar,setRadar]=useState<Record<string,Radar>>({});const[loading,setLoading]=useState(false)
 async function refresh(){setLoading(true);try{await Promise.all(fixtures.map(async f=>{try{const r=await fetch(query(f),{cache:"no-store"});if(r.ok)setRadar(x=>({...x,[f.id]:await r.json()}))}catch{}}))}finally{setLoading(false)}}
 useEffect(()=>{void refresh();const t=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(t)},[])
 const rows=useMemo(()=>fixtures.map(f=>({f,d:radar[f.id],p:picks(radar[f.id]?.candidates??[])})),[radar])
 return <main className="min-h-screen bg-background pb-24"><header className="sticky top-0 z-30 bg-navy text-white"><div className="mx-auto flex max-w-2xl items-center justify-between px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]"><div><h1 className="text-xl font-bold">Card Shortlist</h1><p className="text-sm text-white/70">Strongest yellow-card evidence, with the reasons why</p></div><button onClick={()=>void refresh()} className="rounded-xl bg-white/10 p-2.5"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button></div></header>
 <div className="mx-auto max-w-2xl space-y-4 px-4 py-4"><section className="rounded-2xl border border-border bg-card p-4"><p className="font-bold">Simple view</p><p className="mt-1 text-sm text-muted-foreground">Usually the best 2 candidates per match. Extra players only appear when several signals line up. The score is an evidence ranking, not a guaranteed probability of a booking.</p></section>
 {rows.map(({f,d,p})=><section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="border-b p-4"><p className="text-[0.65rem] font-bold uppercase text-muted-foreground">{f.day} · {f.date} · {f.time}</p><p className="mt-1 font-bold">{f.home} v {f.away}</p><p className="mt-1 text-xs text-muted-foreground">{d?.lineupsConfirmed?"Lineups confirmed":"Pre-lineup"}{d?.referee?` · ${d.referee.name}${d.referee.yellowsPerGame!=null?` · ${d.referee.yellowsPerGame.toFixed(2)} YC/game`:""}`:""}</p></div><div className="space-y-3 p-3">{p.length?p.map((c,i)=><article key={c.dbName} className="rounded-xl border border-border bg-secondary/25 p-3"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-navy font-mono text-xs font-black text-white">{i+1}</span><p className="font-bold">{c.name}</p></div><p className="mt-1 text-xs text-muted-foreground">{c.team} · {c.sampleLabel}</p></div><div className="rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-center text-slate-900"><p className="font-mono text-lg font-black">{Math.round(strength(c))}</p><p className="text-[0.55rem] font-bold uppercase">card evidence</p></div></div>
 <div className="mt-3 grid grid-cols-4 gap-2 text-center"><Mini l="25/26 YC" v={c.yellows}/><Mini l="Cards/90" v={c.cards90} d/><Mini l="Fouls/90" v={c.fouls90} d/><Mini l="H2H YC" v={c.h2hYellows}/></div>
 <div className="mt-3 rounded-xl bg-card p-3"><p className="text-[0.62rem] font-bold uppercase tracking-wide text-muted-foreground">Why they are here</p><div className="mt-2 space-y-1.5">{(c.shortlistReasons?.length?c.shortlistReasons:[`${c.cards90.toFixed(2)} cards/90 historical rate`,`${c.fouls90.toFixed(2)} fouls/90 historical rate`]).slice(0,3).map((r,j)=><div key={j} className="flex gap-2 text-sm"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-yellow-400"/><span>{r}</span></div>)}</div></div>
 <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{c.recentFive?<span className="rounded-lg bg-card px-2 py-1">Recent 5: {c.recentFive.yellows??0} YC · {c.recentFive.fouls??0} fouls</span>:null}{c.currentSeason?.minutes?<span className="rounded-lg bg-card px-2 py-1">26/27: {c.currentSeason.yellows??0} YC · {c.currentSeason.fouls??0} fouls · {c.currentSeason.minutes} min</span>:null}{c.refereePlayer?<span className="rounded-lg bg-card px-2 py-1">Ref history: {c.refereePlayer.yellows}/{c.refereePlayer.matches} booked</span>:null}</div>
 </article>):<div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No reliable shortlist data for this fixture yet.</div>}</div></section>)}
 </div></main>
}
function Mini({l,v,d=false}:{l:string;v:number|null|undefined;d?:boolean}){return <div className="rounded-lg bg-card p-2"><p className="font-mono font-bold">{v==null?"—":d?Number(v).toFixed(2):Math.round(Number(v))}</p><p className="text-[0.55rem] font-semibold uppercase text-muted-foreground">{l}</p></div>}
