"use client"
import {useEffect,useMemo,useState} from "react"
import Link from "next/link"
type Leg={player_name:string|null;market:string;label:string;result_value:string|null;outcome:boolean|null;graded_at:string|null;model_probability:string|null}
type Run={surface:string;slip_title:string;slip_id:string;live:boolean;live_minute:number|null;captured_at:string;fully_graded:boolean;won:boolean|null;legs:Leg[]}
export default function HullReview(){
 const [runs,setRuns]=useState<Run[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState("")
 const [filter,setFilter]=useState("builders")
 useEffect(()=>{fetch("/api/hull-audit",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"Audit unavailable");setRuns(d.runs||[])}).catch(e=>setError(String(e.message||e))).finally(()=>setLoading(false))},[])
 const builders=runs.filter(r=>r.surface.includes("builder"))
 const selected=filter==="winners"?builders.filter(r=>r.fully_graded&&r.won):filter==="builders"?builders:filter==="cards"?runs.filter(r=>r.surface.includes("card")):runs.filter(r=>r.surface.includes("likelihood"))
 const stats=useMemo(()=>{const legs=runs.flatMap(r=>r.legs);return {runs:runs.length,legs:legs.length,graded:legs.filter(l=>l.graded_at).length,hits:legs.filter(l=>l.outcome===true).length,allHit:builders.filter(r=>r.fully_graded&&r.won).length,gradedBuilders:builders.filter(r=>r.fully_graded).length}},[runs])
 return <main className="min-h-screen bg-[#07120e] px-4 py-8 text-white"><div className="mx-auto max-w-3xl">
 <Link href="/" className="text-sm text-emerald-300">← Matches</Link>
 <p className="mt-6 text-xs font-black uppercase tracking-widest text-emerald-300">Prediction performance</p>
 <h1 className="mt-2 text-3xl font-black">Hull v Brighton</h1>
 <p className="mt-2 text-sm text-white/55">Original live recommendations, saved before the result. Each recorded snapshot is shown with its actual settled legs. Repeated recommendations are separate snapshots, not independent bets. No verified Bet365 combined odds were stored for these historical Hull slips: none can be classified as a verified 3/1, 5/1, 10/1 or higher winner.</p>
 {loading?<p className="mt-8">Loading saved recommendations…</p>:error?<p className="mt-8 text-rose-300">{error}</p>:<>
 <div className="mt-6 grid grid-cols-2 gap-3">{[{label:"Recorded legs correct",value:stats.graded?stats.hits+"/"+stats.graded:"Not graded"},{label:"Leg hit rate",value:stats.graded?(100*stats.hits/stats.graded).toFixed(1)+"%":"Pending"},{label:"All-leg-hit snapshots (odds unverified)",value:stats.allHit+"/"+stats.gradedBuilders},{label:"Saved snapshots",value:String(stats.runs)}].map(x=><div key={x.label} className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/50">{x.label}</p><p className="mt-2 text-xl font-bold">{x.value}</p></div>)}</div>
 <p className="mt-3 text-xs text-amber-200/75">Snapshot hit rates repeat some players across different minutes. They do not measure betting profit or unique prediction accuracy. A target title is not a verified bookmaker price.</p>
 <div className="mt-7 flex flex-wrap gap-2">{[["winners","All legs hit"],["builders","All builders"],["cards","Card risk"],["likelihood","Player likelihood"]].map(([k,label])=><button key={k} onClick={()=>setFilter(k)} className={"rounded-full px-3 py-2 text-xs font-semibold "+(filter===k?"bg-emerald-400 text-[#07120e]":"bg-white/10 text-white/70")}>{label}</button>)}</div>
 <p className="mt-4 text-sm text-white/55">{selected.length} recorded snapshots</p>
 <div className="mt-3 space-y-3">{selected.map((r,i)=><details key={r.surface+"-"+r.captured_at+"-"+i} className="rounded-xl border border-white/10 bg-white/[0.04] p-4" open={filter==="winners"&&i===0}><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><p className="font-bold">{r.slip_title}</p><p className="mt-1 text-xs text-white/50">Minute {r.live_minute??"pre-match"} · {r.legs.length} legs · {new Date(r.captured_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"})} UK</p></div><span className={"rounded-full px-2 py-1 text-xs font-bold "+(!r.fully_graded?"bg-amber-400/15 text-amber-200":r.won?"bg-emerald-400/15 text-emerald-300":"bg-rose-400/15 text-rose-300")}>{!r.fully_graded?"Pending":r.won?"ALL LEGS HIT · ODDS UNVERIFIED":r.legs.filter(l=>l.outcome).length+"/"+r.legs.length+" hit"}</span></div></summary><div className="mt-4 space-y-2 border-t border-white/10 pt-3">{r.legs.map((l,j)=><div key={j} className="flex items-center justify-between gap-3 text-sm"><div><p>{l.player_name||"Match"} · {l.label}</p><p className="text-xs text-white/45">Actual: {l.result_value??"not available"} · Predicted {l.model_probability?(Number(l.model_probability)*100).toFixed(0)+"%":"—"}</p></div><span className={l.graded_at?(l.outcome?"text-emerald-300":"text-rose-300"):"text-amber-200"}>{!l.graded_at?"Pending":l.outcome?"✓":"✕"}</span></div>)}</div></details>)}</div>
 </>}
 </div></main>
}
