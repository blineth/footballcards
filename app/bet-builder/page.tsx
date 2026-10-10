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
type OddSelection={market:string;kind:"card"|"foul"|"sot"|string;label:string;odd:number|null}
type OddsResponse={connected:boolean;bookmaker?:string;priceAvailable?:boolean;selections?:OddSelection[]}

function londonDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date())
  const v=(t:string)=>parts.find(p=>p.type===t)?.value??""
  return `${v("year")}-${v("month")}-${v("day")}`
}
function fixtureDate(f:LiveFixture){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(f.kickoff))
}
function query(f:LiveFixture){
  return `/api/fixture-radar?${new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition})}`
}
function oddsQuery(f:LiveFixture){
  return `/api/bet-builder-odds?${new URLSearchParams({date:fixtureDate(f),home:f.home.name,away:f.away.name,competition:f.competition})}`
}
function norm(v:string){
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()
}
function playerMatch(label:string,name:string){
  const a=norm(label), b=norm(name)
  const parts=b.split(" ").filter(Boolean)
  const surname=parts.at(-1)??b
  return a.includes(b)||a.includes(surname)
}
function findOdd(selections:OddSelection[],name:string,kind:string,prefer?:RegExp){
  const rows=selections.filter(s=>s.kind===kind&&playerMatch(s.label,name))
  const preferred=prefer?rows.filter(s=>prefer.test(s.label)):rows
  return (preferred.length?preferred:rows).sort((a,b)=>Number(a.odd??999)-Number(b.odd??999))[0]??null
}
function bestSot(selections:OddSelection[]){
  const sot=selections.filter(s=>s.kind==="sot"&&s.odd!=null)
  const twoPlus=sot.filter(s=>/(2\+|over\s*1\.5|2 or more)/i.test(s.label))
  const onePlus=sot.filter(s=>/(1\+|over\s*0\.5|1 or more)/i.test(s.label))
  const pool=twoPlus.length?twoPlus:onePlus.length?onePlus:sot
  return [...pool].sort((a,b)=>Number(a.odd??999)-Number(b.odd??999))[0]??null
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
  const [odds,setOdds]=useState<Record<string,OddsResponse>>({})
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
        await Promise.all([
          (async()=>{try{const r=await fetch(query(f),{cache:"no-store"});if(r.ok){const d=await r.json() as Radar;setRadar(x=>({...x,[f.id]:d}))}}catch{}})(),
          (async()=>{try{const r=await fetch(oddsQuery(f),{cache:"no-store"});if(r.ok){const d=await r.json() as OddsResponse;setOdds(x=>({...x,[f.id]:d}))}}catch{}})(),
        ])
      }))
    }finally{setLoading(false)}
  }

  useEffect(()=>{void refresh();const t=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(t)},[competition])

  const rows=useMemo(()=>fixtures.map(f=>({f,d:radar[f.id],o:odds[f.id]})),[fixtures,radar,odds])

  return <main className="min-h-screen bg-background pb-24">
    <header className="sticky top-0 z-30 bg-navy text-white">
      <div className="mx-auto max-w-2xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-bold">Bet Builder</h1><p className="text-sm text-white/70">Cards, shots on target, fouls and live prices</p></div>
          <button onClick={()=>void refresh()} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-950"><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></button>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-white/10 p-1">
          {(["Premier League","Championship"] as Competition[]).map(c=><button key={c} onClick={()=>setCompetition(c)} className={`rounded-lg px-3 py-2 text-xs font-bold ${competition===c?"bg-white text-slate-950":"text-white/75"}`}>{c}</button>)}
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="font-bold">Recommended same-game builder</p>
        <p className="mt-1 text-sm text-muted-foreground">Built around the same player markets you see in a bookmaker Bet Builder: player to be booked, fouls committed and shots on target. Card/foul legs use our form + H2H + matchup evidence. Prices shown are live bookmaker-feed prices when available.</p>
      </section>

      {rows.length===0&&!loading?<section className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">No fixtures loaded for today.</section>:null}

      {rows.map(({f,d,o})=>{
        const cs=d?.candidates??[]
        const selections=o?.selections??[]
        const card=[...cs].sort((a,b)=>cardScore(b)-cardScore(a))[0]
        const foul=[...cs].sort((a,b)=>foulScore(b)-foulScore(a))[0]
        const cardOdd=card?findOdd(selections,card.name,"card",/(book|card)/i):null
        const foulOdd=foul?findOdd(selections,foul.name,"foul",/(1\+|over\s*0\.5|1 or more)/i):null
        const sotOdd=bestSot(selections)
        const cards=[...cs].sort((a,b)=>cardScore(b)-cardScore(a)).slice(0,3)
        const fouls=[...cs].sort((a,b)=>foulScore(b)-foulScore(a)).slice(0,3)

        return <section key={f.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[0.65rem] font-bold uppercase text-muted-foreground">{new Date(f.kickoff).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</p><p className="mt-1 font-bold">{f.home.name} v {f.away.name}</p><p className="mt-1 text-xs text-muted-foreground">{d?.lineupsConfirmed?"Confirmed lineups":"Pre-lineup research"}</p></div>
              <span className="rounded-lg bg-secondary px-2 py-1 text-[0.62rem] font-bold text-muted-foreground">{o?.bookmaker??"Bet365"} prices</span>
            </div>
          </div>

          <div className="space-y-4 p-3">
            <div className="rounded-2xl border-2 border-navy bg-card p-3">
              <div className="flex items-center justify-between gap-2"><div><p className="text-[0.65rem] font-black uppercase tracking-wide text-muted-foreground">Suggested builder</p><p className="mt-0.5 text-sm font-bold">3-leg player builder</p></div><span className="rounded-full bg-navy px-2.5 py-1 text-[0.62rem] font-bold text-white">RESEARCH PICK</span></div>
              <div className="mt-3 space-y-2">
                {card?<BuilderLeg title={`${card.name} to be booked`} odd={cardOdd?.odd} meta={`Card evidence ${cardScore(card)}/100 · H2H ${card.h2hYellows} YC in ${card.h2hMatches?.length??0} meetings · recent 5: ${card.recentFive?.yellows??0} YC`}/>:null}
                {foul?<BuilderLeg title={`${foul.name} 1+ foul committed`} odd={foulOdd?.odd} meta={`Foul evidence ${foulScore(foul)}/100 · ${Number(foul.fouls90??0).toFixed(2)} fouls/90${foul.likelyMatchup?.name?` · faces ${foul.likelyMatchup.name}`:""}`}/>:null}
                {sotOdd?<BuilderLeg title={sotOdd.label} odd={sotOdd.odd} meta="Bet365 shots-on-target market · SOT form layer is being added, so this leg is currently market-led rather than model-led."/>:<BuilderLeg title="2+ shots on target" odd={null} meta="No Bet365 SOT price returned by the current odds feed for this fixture."/>}
              </div>
              <div className="mt-3 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground"><b>Combined odds:</b> shown only by the bookmaker once the selections are combined, because correlated legs are repriced rather than simply multiplied.</div>
            </div>

            <BuilderGroup icon={<ShieldAlert className="size-4"/>} title="Yellow-card options" subtitle="Recent yellows + H2H + card rate + matchup">
              {cards.map(c=>{const p=findOdd(selections,c.name,"card");return <Pick key={c.dbName} name={c.name} team={c.team} score={cardScore(c)} odd={p?.odd} detail={`H2H: ${c.h2hYellows} YC in ${c.h2hMatches?.length??0} meetings · Recent 5: ${c.recentFive?.yellows??0} YC · ${Number(c.cards90??0).toFixed(2)} cards/90`}/>})}
            </BuilderGroup>

            <BuilderGroup icon={<Zap className="size-4"/>} title="Player-foul options" subtitle="Fouls committed + recent form + fouls drawn by matchup">
              {fouls.map(c=>{const p=findOdd(selections,c.name,"foul");return <Pick key={c.dbName} name={c.name} team={c.team} score={foulScore(c)} odd={p?.odd} detail={`Recent: ${c.recentFive?.fouls??0} fouls · ${Number(c.fouls90??0).toFixed(2)} fouls/90${c.likelyMatchup?.name?` · faces ${c.likelyMatchup.name}${c.likelyMatchup.fouled90!=null?` (${Number(c.likelyMatchup.fouled90).toFixed(2)} fouls drawn/90)`:""}`:""}`}/>})}
            </BuilderGroup>

            <BuilderGroup icon={<Target className="size-4"/>} title="Shots on target" subtitle="Bookmaker SOT markets now shown; model form layer follows">
              {selections.filter(s=>s.kind==="sot").slice(0,6).map((s,i)=><div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-card p-3"><div><p className="text-sm font-bold">{s.label}</p><p className="text-[0.65rem] text-muted-foreground">{s.market}</p></div><Price odd={s.odd}/></div>)}
              {!selections.some(s=>s.kind==="sot")?<div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">No player SOT prices returned by the current bookmaker feed.</div>:null}
            </BuilderGroup>
          </div>
        </section>
      })}
    </div>
  </main>
}

function BuilderLeg({title,odd,meta}:{title:string;odd:number|null|undefined;meta:string}){
  return <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-3"><div className="min-w-0"><p className="font-bold">{title}</p><p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">{meta}</p></div><Price odd={odd}/></div>
}
function Price({odd}:{odd:number|null|undefined}){
  return <div className="shrink-0 rounded-lg bg-navy px-2.5 py-1.5 text-center text-white"><p className="font-mono text-sm font-black">{odd!=null?Number(odd).toFixed(2):"—"}</p><p className="text-[0.48rem] font-bold uppercase text-white/65">{odd!=null?"odds":"no price"}</p></div>
}
function BuilderGroup({icon,title,subtitle,children}:{icon:React.ReactNode;title:string;subtitle:string;children:React.ReactNode}){
  return <div className="rounded-xl border border-border bg-secondary/20 p-3"><div className="flex items-center gap-2">{icon}<div><p className="text-sm font-bold">{title}</p><p className="text-[0.65rem] text-muted-foreground">{subtitle}</p></div></div><div className="mt-3 space-y-2">{children}</div></div>
}
function Pick({name,team,score,odd,detail}:{name:string;team:string;score:number;odd:number|null|undefined;detail:string}){
  return <div className="rounded-xl bg-card p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{name}</p><p className="text-xs text-muted-foreground">{team}</p></div><div className="flex items-center gap-2"><div className="rounded-lg bg-secondary px-2 py-1 text-center"><p className="font-mono text-base font-black">{score}</p><p className="text-[0.5rem] font-bold uppercase text-muted-foreground">evidence</p></div><Price odd={odd}/></div></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
}
