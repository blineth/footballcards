"use client"

import { useEffect, useMemo, useState } from "react"
import { RefreshCw, ShieldAlert, Target, Zap } from "lucide-react"

type Competition = "Premier League" | "Championship"
type LiveFixture = { id:string; competition:Competition; kickoff:string; home:{name:string}; away:{name:string} }
type FixturesResponse = { leagues:Record<Competition,LiveFixture[]> }
type Candidate = {
  name:string; dbName:string; team:string; position?:string|null; predictedRole?:string|null;
  yellows:number; cards90:number; fouls90:number; fouled90?:number|null;
  h2hYellows:number; h2hFouls:number; h2hMatches?:{matchDate:string;yellowCard?:boolean|null}[];
  score:number; cardRiskScore?:number;
  currentSeason?:{yellows?:number;fouls?:number;minutes?:number};
  recentFive?:{yellows?:number;fouls?:number;fouls90?:number|null};
  likelyMatchup?:{name:string;fouled90?:number|null;role?:string|null}|null;
  shortlistReasons?:string[];
}
type Radar={lineupsConfirmed?:boolean;candidates?:Candidate[]}

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return `${v("year")}-${v("month")}-${v("day")}`
}
function query(f:LiveFixture){
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.kickoff))
  return `/api/fixture-radar?${new URLSearchParams({date,home:f.home.name,away:f.away.name,competition:f.competition})}`
}
function cardScore(c:Candidate){
  const recentY=Number(c.recentFive?.yellows??0)
  const seasonY=Number(c.currentSeason?.yellows??0)
  const h2hMeetings=c.h2hMatches?.length??0
  const h2hRate=h2hMeetings?c.h2hYellows/h2hMeetings:0
  return Math.min(100,Math.round((Number(c.cardRiskScore??c.score??0)*0.55)+(Math.min(1,recentY/2)*18)+(Math.min(1,seasonY/3)*12)+(Math.min(1,h2hRate)*15)))
}
function foulScore(c:Candidate){
  const recentF90=Number(c.recentFive?.fouls90??0)
  const matchup=Number(c.likelyMatchup?.fouled90??0)
  return Math.min(100,Math.round((Math.min(1,Number(c.fouls90??0)/2.5)*45)+(Math.min(1,recentF90/2.5)*30)+(Math.min(1,matchup/2.5)*25)))
}

export default function BetBuilderPage(){
  const [competition,setCompetition]=useState<Competition>("Premier League")
  const [fixtures,setFixtures]=useState<LiveFixture[]>([])
  const [radar,setRadar]=useState<Record<string,Radar>>({})
  const [loading,setLoading]=useState(false)

  async function refresh(){
    setLoading(true)
    try{
      const fr=await fetch(`/api/fixtures?date=${londonDate()}&refresh=${Date.now()}`,{cache:"no-store"})
      if(!fr.ok) return
      const fd=await fr.json() as FixturesResponse
      const fs=fd.leagues?.[competition]??[]
      setFixtures(fs)
      await Promise.all(fs.map(async f=>{
        try{
          const r=await fetch(query(f),{cache:"no-store"})
          if(r.ok){const d=await r.json() as Radar;setRadar(x=>({...x,[f.id]:d}))}
        }catch{}
      }))
    }finally{setLoading(false)}
  }

  useEffect(()=>{void refresh();const t=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(t)},[competition])

  const rows=useMemo(()=>fixtures.map(f=>({f,d:radar[f.id]})),[fixtures,radar])

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white">
      <div className="mx-auto max-w-2xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Bet Builder</h1><p className="text-sm text-white/70">Cards, fouls, matchup pressure and form</p></div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-950"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">
          {(["Premier League","Championship"] as Competition[]).map(c=><button key={c} onClick={()=>setCompetition(c)} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="font-bold">Evidence-led builder</p>
        <p className="mt-1 text-sm text-muted-foreground">Card and foul legs are ranked from season rate, recent form, H2H bookings/fouls and direct matchup pressure. Shots-on-target will only be shown once the underlying SOT match data is available — it will not invent a number.</p>
      </section>

      {rows.length===0&&!loading?<section className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">No fixtures loaded for today.</section>:null}

      {rows.map(({f,d})=>{
        const cs=d?.candidates??[]
        const cards=[...cs].sort((a,b)=>cardScore(b)-cardScore(a)).slice(0,3)
        const fouls=[...cs].sort((a,b)=>foulScore(b)-foulScore(a)).slice(0,3)
        return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-4">
            <p className="text-[0.65rem] font-bold uppercase text-muted-foreground">{new Date(f.kickoff).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</p>
            <p className="mt-1 font-bold">{f.home.name} v {f.away.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{d?.lineupsConfirmed?"Confirmed lineups":"Pre-lineup research"}</p>
          </div>

          <div className="space-y-4 p-3">
            <BuilderGroup icon={<ShieldAlert className="size-4"/>} title="Yellow cards" subtitle="Recent yellows + H2H + card rate + matchup">
              {cards.map(c=><Pick key={c.dbName} name={c.name} team={c.team} score={cardScore(c)} detail={`H2H: ${c.h2hYellows} YC in ${c.h2hMatches?.length??0} meetings · Recent 5: ${c.recentFive?.yellows??0} YC · ${Number(c.cards90??0).toFixed(2)} cards/90`}/>)}
            </BuilderGroup>

            <BuilderGroup icon={<Zap className="size-4"/>} title="Player fouls" subtitle="Fouls committed + recent form + fouls drawn by matchup">
              {fouls.map(c=><Pick key={c.dbName} name={c.name} team={c.team} score={foulScore(c)} detail={`Recent: ${c.recentFive?.fouls??0} fouls · ${Number(c.fouls90??0).toFixed(2)} fouls/90${c.likelyMatchup?.name?` · faces ${c.likelyMatchup.name}${c.likelyMatchup.fouled90!=null?` (${Number(c.likelyMatchup.fouled90).toFixed(2)} fouls drawn/90)`:""}`:""}`}/>)}
            </BuilderGroup>

            <BuilderGroup icon={<Target className="size-4"/>} title="Shots on target" subtitle="Recent SOT + SOT/90 + opponent matchup">
              <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">SOT data layer not imported yet. This section will populate once recent player shot-on-target history is added.</div>
            </BuilderGroup>
          </div>
        </section>
      })}
    </div>
  </main>
}

function BuilderGroup({icon,title,subtitle,children}:{icon:React.ReactNode;title:string;subtitle:string;children:React.ReactNode}){
  return <div className="rounded-xl border border-border bg-secondary/20 p-3"><div className="flex items-center gap-2">{icon}<div><p className="text-sm font-bold">{title}</p><p className="text-[0.65rem] text-muted-foreground">{subtitle}</p></div></div><div className="mt-3 space-y-2">{children}</div></div>
}
function Pick({name,team,score,detail}:{name:string;team:string;score:number;detail:string}){
  return <div className="rounded-xl bg-card p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{name}</p><p className="text-xs text-muted-foreground">{team}</p></div><div className="rounded-lg bg-secondary px-2 py-1 text-center"><p className="font-mono text-base font-black">{score}</p><p className="text-[0.5rem] font-bold uppercase text-muted-foreground">evidence</p></div></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
}
