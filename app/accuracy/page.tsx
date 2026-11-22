"use client"
import {useEffect,useMemo,useState} from "react"
import Link from "next/link"
import {ArrowLeft,RefreshCw,Target,Activity,AlertTriangle} from "lucide-react"

type Rate={phase:string;graded:number;hits:number;avg_confidence:string|null;brier?:string;total?:number;market_group?:string;band?:string}
type Signal={signal:string;graded:number;hits:number;avg_confidence:string|null}
type Test={phase:string;market_group:string;split:string;threshold:number;graded:number;hits:number;avg_confidence:string|null}
type Gap={phase:string;market_group:string;graded:number;no_sample:number;no_h2h:number;lineup_unconfirmed:number;no_feed_provenance:number;commentary_signals:number}
type Timing={phase:string;timing_quality:string;selections:number}
type LearningScore={market:string;model:string;phase:string;sample:number;hits:number;hitRate:number;brier:number;avgPredicted:number;distinctDates:number}
type LearningRecommendation={market:string;candidate:string;baselineHoldout:LearningScore;candidateHoldout:LearningScore;training:LearningScore;adopted:boolean;reason:string}
type LearningPick={date:string;fixture:string;player:string;team:string;market:string;model:string;probability:number;hit:boolean;priorMatches:number;lastFiveHits:number;nonFoulCards?:number;confirmedDissentBookings?:number;lateBookings?:number;period:string}
type ConductProfile={player:string;team:string;matches:number;yellows:number;nonFoulBookings:number;zeroFoulAppearances:number;verifiedZeroFoulAppearances:number;confirmedDissentBookings:number;lateBookings:number;knownReasons:number;knownMinutes:number}
type LearningResponse={ok:boolean;available:boolean;run?:{id:number;created_at:string;status:string;source_rows:number;unique_fixtures:number;training_end:string;recommendations:LearningRecommendation[];review_examples?:LearningPick[];player_profiles?:ConductProfile[];methodology:string}}
type Data={ok:boolean;error?:string;days:number;updatedAt:string;walkForward?:Test[];featureCoverage?:Gap[];timingQuality?:Timing[];
  phases:Rate[];markets:Rate[];confidence:Rate[];liveCardSignals:Signal[];
  coverage:{unique_saved:number;ungraded:number;match_days:number}}
function pct(h:number,n:number){return n?((100*h)/n).toFixed(1)+"%":"—"}
function num(v:string|null|undefined){return v==null?"—":Number(v).toFixed(1)+"%"}
function RateCard({label,row}:{label:string;row?:Rate}){
  return <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
    <p className="text-[0.6rem] font-bold uppercase tracking-wider text-white/45">{label}</p>
    <p className="mt-2 font-mono text-3xl font-black">{row?.graded?pct(row.hits,row.graded):"—"}</p>
    <p className="mt-1 text-xs text-white/45">{row?.hits??0} / {row?.graded??0} graded unique selections</p>
    <p className="mt-2 text-xs text-cyan-200">Average model confidence: {num(row?.avg_confidence)}</p>
    {row?.brier?<p className="mt-1 text-[0.55rem] text-white/35">Brier score: {row.brier} · lower is better</p>:null}
  </div>
}
export default function AccuracyPage(){
  const[days,setDays]=useState(30)
  const[data,setData]=useState<Data|null>(null)
  const[loading,setLoading]=useState(true)
  const[learning,setLearning]=useState<LearningResponse|null>(null)
  const[tab,setTab]=useState<"pre-match"|"live">("pre-match")
  useEffect(()=>{let cancelled=false;setLoading(true)
    fetch("/api/admin/accuracy?days="+days,{cache:"no-store"})
      .then(async r=>{const d=await r.json();if(!cancelled)setData(d)})
      .catch(()=>{if(!cancelled)setData({ok:false,error:"Unable to load model accuracy"} as Data)})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[days])
  useEffect(()=>{let cancel=false
    fetch("/api/admin/pregame-learning",{cache:"no-store"})
     .then(async r=>r.json()).then(result=>{if(!cancel)setLearning(result)})
     .catch(()=>{if(!cancel)setLearning({ok:false,available:false})})
    return()=>{cancel=true}
  },[])
  const live=data?.phases?.find(p=>p.phase==="live")
  const pre=data?.phases?.find(p=>p.phase==="pre-match")
  const markets=useMemo(()=>data?.markets?.filter(x=>x.phase===tab)??[],[data,tab])
  const bands=useMemo(()=>data?.confidence?.filter(x=>x.phase===tab)??[],[data,tab])
  return <main className="min-h-screen bg-[#07120e] pb-28 text-white">
    <header className="border-b border-white/10 bg-[#07120e]/95"><div className="mx-auto max-w-4xl px-4 py-5">
      <div className="flex items-center gap-3"><Link href="/performance" className="rounded-xl bg-white/10 p-2.5"><ArrowLeft className="size-4"/></Link>
        <div className="flex-1"><p className="text-[0.55rem] font-black uppercase tracking-widest text-emerald-300">Match Edge · Model performance</p>
        <h1 className="text-2xl font-black">Accuracy & confidence</h1></div>
        {loading?<RefreshCw className="size-4 animate-spin text-emerald-300"/>:<Activity className="size-4 text-emerald-300"/>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{[7,30,90,365].map(d=><button key={d} onClick={()=>setDays(d)} className={"rounded-full border px-3 py-2 text-[0.58rem] font-bold "+(days===d?"border-emerald-200 bg-emerald-300 text-emerald-950":"border-white/10 bg-white/5 text-white/55")}>{d===365?"1 year":d+" days"}</button>)}</div>
    </div></header>
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      {data&&!data.ok?<p className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-200">{data.error}</p>:null}
      {data?.ok?<>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2"><RateCard label="Before match hit rate" row={pre}/><RateCard label="Live hit rate" row={live}/></section>
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.055] p-3 text-xs leading-relaxed text-white/60">
          <Target className="mt-0.5 size-4 shrink-0 text-amber-200"/>
          <p><strong className="text-white">75% is a target, not a guarantee.</strong> Accurate probabilities and sustainable results require forward testing. Higher hit rates may come from selecting fewer, lower-priced outcomes; winning bets also depend on the odds.</p>
        </div>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-2"><div><h2 className="font-black">Where the model is strongest</h2><p className="mt-1 text-xs text-white/40">First saved prediction, per event and phase · no repeated refreshes</p></div><span className="rounded-lg bg-white/10 px-2 py-1 text-xs">{data.coverage?.match_days} days</span></div>
          <div className="mt-4 flex gap-2">{(["pre-match","live"] as const).map(p=><button key={p} onClick={()=>setTab(p)} className={"flex-1 rounded-xl px-3 py-2 text-xs font-black "+(tab===p?"bg-emerald-300 text-emerald-950":"bg-white/10 text-white/55")}>{p==="live"?"Live":"Before match"}</button>)}</div>
          <div className="mt-3 space-y-2">{markets.length?markets.map(row=><div key={row.market_group} className="rounded-xl bg-black/25 p-3">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{row.market_group}</p><p className="mt-1 text-[0.58rem] text-white/40">{row.hits}/{row.graded} graded · predicted {num(row.avg_confidence)}</p></div>
              <p className="font-mono text-lg font-black">{pct(row.hits,row.graded)}</p></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-emerald-300" style={{width:(row.graded?row.hits/row.graded*100:0)+"%"}}/></div>
          </div>):<p className="py-5 text-center text-xs text-white/45">No settled unique picks for this category yet.</p>}</div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <h2 className="font-black">Confidence calibration · {tab==="live"?"live":"before match"}</h2>
          <p className="mt-1 text-xs text-white/40">When the model predicts a 75%+ chance, how often has it actually won?</p>
          <div className="mt-3 space-y-2">{bands.map(x=><div key={x.band} className="flex items-center justify-between gap-3 rounded-xl bg-black/25 p-3">
            <div><p className="text-sm font-bold">{x.band}</p><p className="text-[0.55rem] text-white/40">{x.hits}/{x.graded} · avg prediction {num(x.avg_confidence)}</p></div>
            <p className="font-mono text-lg font-black">{pct(x.hits,x.graded)}</p>
          </div>)}</div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center justify-between gap-2">
            <div><p className="text-[0.56rem] font-black uppercase tracking-wider text-cyan-200">Daily historical learning</p>
              <h2 className="mt-1 font-black">Pre-match replay · cards, fouls, shots</h2></div>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[0.55rem] text-white/50">SHADOW MODE</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/45">Every morning the system replays older matches using only earlier player appearances. It compares candidate recency weights with a baseline and validates against later fixtures before recommending a change. A proxy replay is not a replay of our entire production model.</p>
          {learning?.available&&learning.run?<><p className="mt-3 text-[0.58rem] text-white/40">Last run {new Date(learning.run.created_at).toLocaleString("en-GB")} · {learning.run.source_rows} player-history rows · {learning.run.unique_fixtures} fixtures · training through {String(learning.run.training_end).slice(0,10)}</p>
            <div className="mt-3 space-y-2">{(learning.run.recommendations??[]).map(x=><div key={x.market} className="rounded-xl bg-black/25 p-3">
              <p className="text-sm font-black">{x.market==="card"?"Yellow cards":x.market==="fouled1"?"1+ foul drawn":x.market==="foul1"?"1+ foul committed":x.market==="foul2"?"2+ fouls committed":x.market==="shot1"?"1+ shot":x.market==="shot2"?"2+ shots":"1+ shot on target"}</p>
              <p className="mt-1 text-[0.55rem] text-white/45">Candidate: {x.candidate} · holdout Brier baseline {x.baselineHoldout?.brier??"—"} vs challenger {x.candidateHoldout?.brier??"—"}</p>
              <p className="mt-1 text-[0.55rem] text-white/55">Latest holdout: {x.candidateHoldout?.hits??0}/{x.candidateHoldout?.sample??0} ({pct(x.candidateHoldout?.hits??0,x.candidateHoldout?.sample??0)}) · {x.reason}</p>
            </div>)}</div>
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-sm font-black">Dissent and off-the-ball booking research</p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">Yellow cards with zero recorded fouls, expressly identified dissent bookings and 80th-minute-or-later cards are examined separately. A booking without a foul is <strong className="text-white">not</strong> proof of dissent.</p>
              {(learning.run.recommendations??[]).filter(x=>x.market==="card").map(x=><div key="card-research" className="mt-2 rounded-xl bg-black/25 p-3">
                <p className="text-xs font-black">Best historical card candidate: {x.candidate}</p>
                <p className="mt-1 text-[0.58rem] text-white/50">Holdout Brier: baseline {x.baselineHoldout?.brier??"—"} · candidate {x.candidateHoldout?.brier??"—"}. Lower is better; no automatic adoption.</p>
              </div>)}
              <p className="mt-3 text-xs font-black">Players to investigate</p>
              {(learning.run.player_profiles??[]).length? <div className="mt-2 space-y-2">{(learning.run.player_profiles??[]).map(x=><div key={x.player+x.team} className="rounded-xl bg-black/25 p-3">
                <p className="text-sm font-black">{x.player} <span className="text-white/45">· {x.team}</span></p>
                <p className="mt-1 text-[0.58rem] text-white/55">{x.yellows}/{x.matches} booked · {x.nonFoulBookings}/{x.verifiedZeroFoulAppearances??0} verified zero-foul appearances with bookings</p>
                <p className="mt-1 text-[0.58rem] text-white/45">{x.confirmedDissentBookings} explicit dissent · {x.lateBookings} late bookings · {x.knownReasons} known reasons, {x.knownMinutes} known booking minutes · {x.zeroFoulAppearances} total recorded zero-foul games (may include unverified data)</p>
              </div>)}</div>:<p className="mt-2 text-xs text-white/45">No matching historical appearances found for the named players in the imported dataset.</p>}
              <p className="mt-2 text-[0.58rem] text-amber-100/70">Missing booking reasons and missing foul statistics are not assumed to mean dissent or no fouls.</p>
            </div>
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="text-sm font-black">Historical replay misses · latest holdout fixtures</p>
              <p className="mt-1 text-[0.58rem] text-white/40">What the challenger would have selected using prior player appearances, not the actual original app bet.</p>
              <div className="mt-2 space-y-2">{(learning.run.review_examples??[]).filter(x=>!x.hit).slice(0,14).map((x,i)=><div key={x.fixture+x.market+i} className="rounded-xl bg-black/20 p-3">
                <div className="flex justify-between gap-2"><p className="text-xs font-black">{x.player} · {x.market}</p><span className="text-xs font-black text-rose-200">MISSED</span></div>
                <p className="mt-1 text-[0.58rem] text-white/50">{x.date} · {x.team} · predicted {(x.probability*100).toFixed(1)}% · prior matches {x.priorMatches}, last five wins {x.lastFiveHits}{x.market==="card"?` · ${x.nonFoulCards??0} earlier zero-foul bookings · ${x.confirmedDissentBookings??0} documented dissent bookings`:""}</p>
              </div>)}</div>
            </div>
          </>:<p className="mt-3 rounded-xl bg-black/25 p-3 text-xs text-white/45">Historical training is scheduled daily at 06:00 UTC. No completed learning run has been recorded yet, so no new candidate has been validated or promoted.</p>}
          <p className="mt-3 text-[0.6rem] text-amber-100/70">Research stays separate from live recommendations until enough independent future evidence and bookmaker prices support an improvement.</p>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <h2 className="font-black">Reverse-engineering test · later matches held out</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/45">We test stricter original-confidence cutoffs using earlier match dates for training, then check the latest match date independently. This is a retrospective simulation, not a proven future strategy. A high hit rate with very few bets is not reliable.</p>
          <div className="mt-3 space-y-2">{(["pre-match","live"] as const).map(phase=><div key={phase} className="rounded-xl bg-black/25 p-3">
            <p className="mb-2 text-sm font-black">{phase==="live"?"Live":"Before match"} · 75%+ original model confidence</p>
            {(["training","holdout"] as const).map(split=>{
              const picks=(data.walkForward??[]).filter(x=>x.phase===phase&&x.split===split&&Number(x.threshold)===.75)
              const n=picks.reduce((a,x)=>a+x.graded,0),hits=picks.reduce((a,x)=>a+x.hits,0)
              return <div key={split} className="flex items-center justify-between gap-2 border-t border-white/5 py-2">
                <div><p className="text-xs font-bold">{split==="training"?"Earlier match days":"Latest match date (unseen holdout)"}</p><p className="text-[0.56rem] text-white/40">{hits}/{n} selections</p></div>
                <p className="font-mono text-lg font-black">{pct(hits,n)}</p>
              </div>
            })}
          </div>)}</div>
          <p className="mt-3 text-[0.62rem] leading-relaxed text-amber-100/70">A retrospective cutoff cannot by itself improve the underlying probabilities. We should only adopt a rule after sufficient independent forward results and odds-adjusted returns.</p>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-200"/><h2 className="font-black">Evidence gaps across the historical record</h2></div>
          <p className="mt-1 text-xs leading-relaxed text-white/45">Missing inputs may explain weaknesses, but do not prove an alternative model would have predicted correctly. Counts below use de-duplicated, graded selections.</p>
          <div className="mt-3 space-y-2">{(data.featureCoverage??[]).filter(x=>x.phase===tab&&x.graded>=5).map(x=><div key={x.phase+x.market_group} className="rounded-xl bg-black/25 p-3">
            <p className="text-sm font-black">{x.market_group} <span className="text-[0.56rem] font-normal text-white/40">· {x.graded} evaluated</span></p>
            <p className="mt-1 text-[0.58rem] text-amber-100/75">{x.no_sample} missing match sample · {x.no_h2h} missing H2H matches · {x.lineup_unconfirmed} without confirmed lineup</p>
            {x.phase==="live"?<p className="mt-1 text-[0.58rem] text-white/40">{x.no_feed_provenance} without archived live-feed provenance · {x.commentary_signals} with recorded commentary signals</p>:null}
          </div>)}</div>
          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="text-xs font-black">Prediction timing checks</p>
            {(data.timingQuality??[]).filter(x=>x.timing_quality!=="valid").map(x=><p key={x.phase+x.timing_quality} className="mt-1 text-xs text-amber-100/75">{x.selections} {x.phase} entries excluded: {x.timing_quality}</p>)}
            <p className="mt-1 text-[0.58rem] text-white/45">Selections that appear to have used unavailable match timing are excluded from the headline hit rate.</p>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-200"/><h2 className="font-black">Live yellow-card signal review</h2></div>
          <p className="mt-1 text-xs text-white/40">Observational breakdowns, not causal evidence. Small groups and late-game snapshots can distort results.</p>
          <div className="mt-3 space-y-2">{(data.liveCardSignals??[]).map(x=><div key={x.signal} className="flex justify-between gap-3 rounded-xl bg-black/25 p-3"><div><p className="text-sm font-bold">{x.signal}</p><p className="text-[0.58rem] text-white/40">{x.hits}/{x.graded} · predicted {num(x.avg_confidence)}</p></div><p className="font-mono text-lg font-black">{pct(x.hits,x.graded)}</p></div>)}</div>
        </section>
        <p className="text-[0.67rem] leading-relaxed text-white/45">Coverage: {data.coverage?.unique_saved} unique logged selections, {data.coverage?.ungraded} still awaiting verifiable results. The scores reflect published picks, not bets placed at a bookmaker. Referee pressure, fouls, dissent and dangerous challenges are candidate predictive signals, not proof that a player will be booked.</p>
        <Link href="/today" className="block rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-center text-sm font-black text-emerald-100">View today’s Hull & Manchester United research slips</Link>
        <Link href="/admin/recommendation-audit" className="block rounded-xl bg-white/10 px-4 py-3 text-center text-sm font-black">Inspect individual picks versus results</Link>
      </>:null}
    </div>
  </main>
}