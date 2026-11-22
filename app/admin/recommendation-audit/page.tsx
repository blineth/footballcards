"use client"

import {useEffect,useMemo,useState} from "react"
import Link from "next/link"
import {ArrowLeft,RefreshCw} from "lucide-react"

type Market={market:string;predictions:number;graded:number;won:number;predicted_pct:string}
type Leg={run_id:number;surface:string;slip_title:string;captured_at:string;home_team:string;away_team:string;
  player_name:string|null;label:string;market:string;model_probability:string;bookmaker_odds:string|null;
  outcome:boolean|null;result_value:string|null;graded_at:string|null;actual_fouls:number|null;actual_fouled:number|null;
  actual_shots:number|null;actual_sot:number|null;actual_yellow:boolean|null;actual_red:boolean|null}
type Audit={ok:boolean;error?:string;summary?:{runs:number;legs:number;graded:number;won:number;graded_slips:number;winning_slips:number};
  playerHistory?:{player_rows:number};markets?:Market[];examples?:Leg[]}
function dateYesterday(){const d=new Date();d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
export default function RecommendationAudit(){
 const[date,setDate]=useState(dateYesterday)
 const[market,setMarket]=useState("all")
 const[mode,setMode]=useState("all")
 const[data,setData]=useState<Audit|null>(null)
 const[loading,setLoading]=useState(false)
 useEffect(()=>{
  let cancelled=false
  setLoading(true)
  fetch("/api/admin/recommendation-audit?date="+encodeURIComponent(date),{cache:"no-store"})
   .then(async r=>r.json()).then(d=>{if(!cancelled)setData(d)})
   .catch(()=>{if(!cancelled)setData({ok:false,error:"Couldn't load audit"})})
   .finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[date])
 const rows=useMemo(()=>(data?.examples??[]).filter(x=>{
  const kind=x.market.startsWith("fouled")?"fouled":x.market.startsWith("foul")?"fouls":x.market.startsWith("shot")?"shots":x.market==="card"?"cards":x.market.startsWith("sot")?"sot":x.market
  return (market==="all"||market===kind)&&(mode==="all"||mode==="won"&&x.outcome===true||mode==="lost"&&x.outcome===false||mode==="pending"&&x.graded_at==null)
 }),[data,market,mode])
 const s=data?.summary
 return <main className="min-h-screen bg-[#07120e] pb-24 text-white">
  <header className="border-b border-white/10 bg-[#07120e]"><div className="mx-auto max-w-5xl px-4 py-5">
   <div className="flex items-center gap-3"><Link href="/admin/model-performance" className="rounded-xl bg-white/10 p-2"><ArrowLeft className="size-4"/></Link>
   <div className="flex-1"><p className="text-[0.56rem] font-black uppercase tracking-widest text-emerald-300">Model Lab · Historic audit</p>
   <h1 className="text-xl font-black">Suggested vs actual</h1></div>
   {loading?<RefreshCw className="size-4 animate-spin text-emerald-300"/>:null}</div>
   <div className="mt-4 flex flex-wrap items-center gap-3"><label className="text-xs font-bold text-white/50">Match date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm [color-scheme:dark]"/></div>
  </div></header>
  <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
   {data&&!data.ok?<p className="rounded-xl bg-rose-300/10 p-4 text-rose-100">{data.error}</p>:null}
   {s?<><section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {[[ "Prediction runs",s.runs],["Selections saved",s.legs],["Graded",s.graded],["Winning selections",s.won]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3"><p className="text-[0.52rem] text-white/45">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>)}
   </section>
   <p className="text-xs leading-relaxed text-white/45">Each live update is kept as a timestamped snapshot. Repeated predictions are not independent bets. Missing results remain ungraded. The detailed list below shows the earliest 150 saved pre-match/accumulator selections; market totals cover the full date.</p>
   <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-3"><h2 className="font-black">Accuracy by market</h2>
    <div className="mt-3 space-y-2">{(data?.markets??[]).map(x=><div key={x.market} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-black/20 p-3">
     <div><p className="text-xs font-black">{x.market}</p><p className="mt-0.5 text-[0.52rem] text-white/40">{x.graded}/{x.predictions} graded · predicted average {x.predicted_pct}%</p></div>
     <p className="font-mono text-sm font-black">{x.graded?((x.won/x.graded)*100).toFixed(1)+"%":"—"} <span className="text-[0.48rem] text-white/40">{x.won}/{x.graded}</span></p>
    </div>)}</div>
   </section>
   <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
    <h2 className="font-black">Saved suggestions and results</h2>
    <div className="mt-3 flex flex-wrap gap-2">
      <select value={market} onChange={e=>setMarket(e.target.value)} className="rounded-xl border border-white/10 bg-[#16231c] px-3 py-2 text-xs">
       {["all","fouls","cards","shots","sot","fouled","homeWin","awayWin","bttsYes","goal1"].map(x=><option key={x} value={x}>{x==="all"?"All markets":x}</option>)}
      </select>
      <select value={mode} onChange={e=>setMode(e.target.value)} className="rounded-xl border border-white/10 bg-[#16231c] px-3 py-2 text-xs">
       {["all","won","lost","pending"].map(x=><option key={x} value={x}>{x==="all"?"All outcomes":x}</option>)}
      </select>
    </div>
    <div className="mt-3 space-y-2">{rows.map((x,i)=><div key={x.run_id+"|"+i} className="rounded-xl border border-white/8 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-black">{x.player_name?x.player_name+" · ":""}{x.label}</p>
        <p className="mt-1 text-[0.52rem] text-white/40">{x.home_team} v {x.away_team} · {x.slip_title}</p>
        <p className="mt-1 text-[0.48rem] text-white/35">Suggested {(Number(x.model_probability)*100).toFixed(1)}% · {new Date(x.captured_at).toLocaleTimeString("en-GB",{timeZone:"Europe/London",hour:"2-digit",minute:"2-digit"})} UK</p>
        {x.player_name?<p className="mt-1 text-[0.52rem] text-cyan-100/65">Actual: fouls {x.actual_fouls??"—"} · fouled {x.actual_fouled??"—"} · shots {x.actual_shots??"—"} · SOT {x.actual_sot??"—"} · YC {x.actual_yellow==null?"—":x.actual_yellow?1:0}</p>:null}
      </div><span className={"shrink-0 rounded-lg px-2 py-1 text-[0.53rem] font-black "+(x.outcome===true?"bg-emerald-300/15 text-emerald-200":x.outcome===false?"bg-rose-300/15 text-rose-200":"bg-white/10 text-white/40")}>{x.outcome===true?"WON":x.outcome===false?"LOST":"UNVERIFIED"}</span></div>
    </div>)}
    {!rows.length?<p className="py-8 text-center text-xs text-white/40">No records match these filters.</p>:null}
    </div>
   </section></>:null}
  </div>
 </main>
}