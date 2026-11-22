"use client"

import {useEffect,useState} from "react"
import {ChevronDown} from "lucide-react"

type Summary={hits:number;total:number;known:number;events:number;threshold:number}
type Stats={lastFive:Summary;h2h:Summary}
type Match={date:string;opponent:string;minutes:number|null;yellow:boolean|null;foulsCommitted:number|null;foulsDrawn:number|null;shots:number|null;shotsOnTarget:number|null;hit:boolean|null}
type History={ok:boolean;lastFive?:Match[];h2h?:Match[];h2hTotalAppearances?:number}
const cache=new Map<string,Promise<Stats|null>>()
function labelFor(market:string){if(market==="card")return "🟨";if(market.startsWith("fouled"))return "drawn";if(market.startsWith("foul"))return "fouls";if(market.startsWith("sot"))return "SOT";if(market.startsWith("shot"))return "shots";if(market.startsWith("goal"))return "goals";if(market.startsWith("assist"))return "assists";return "events"}
function display(summary:Summary|undefined,market:string){
 if(!summary||!summary.total)return "—"
 if(!summary.known)return "no stats"
 if(market==="card")return summary.hits+"/"+summary.total
 // Actual number of market events and games; threshold hits are in detail.
 return summary.events+" "+labelFor(market)+"/"+summary.total
}
function keyFor(name:string,team:string,market:string,date:string,home:string,away:string){return [date,home,away,name,team,market].join("|").toLowerCase()}
export function MarketHistoryBadge({player,team,market,date,home,away,competition=""}:{player:string;team:string;market:string;date:string;home:string;away:string;competition?:string}){
 const key=keyFor(player,team,market,date,home,away)
 const[summary,setSummary]=useState<Stats|null>(null)
 const[open,setOpen]=useState(false)
 const[history,setHistory]=useState<History|null>(null)
 useEffect(()=>{
  let active=true
  setSummary(null);setOpen(false);setHistory(null)
  let task=cache.get(key)
  if(!task){
   task=fetch("/api/player-booking-summaries",{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({date,home,away,players:[{name:player,team,market}]})})
     .then(r=>r.ok?r.json():null).then(d=>d?.ok&&d.profiles?.length?{lastFive:d.profiles[0].lastFive,h2h:d.profiles[0].h2h}:null)
     .catch(()=>null)
   cache.set(key,task)
  }
  void task.then(value=>{if(active)setSummary(value)})
  return()=>{active=false}
 },[key,date,home,away,player,team,market])
 const expand=()=>{
  setOpen(v=>!v)
  if(history||open||!competition)return
  const opponent=(team.trim().toLowerCase()===home.trim().toLowerCase())?away:home
  const qs=new URLSearchParams({date,competition:"",player,team,opponent,market})
  // Dedicated match history uses a competition; the optional prop from
  // callers is applied via the component's own lookup argument.
  qs.set("competition",competition)
  fetch("/api/player-match-history?"+qs,{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setHistory(d)).catch(()=>setHistory(null))
 }
 return <span className="inline-flex max-w-full flex-col items-start">
  <button type="button" onClick={expand} className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.58rem] font-bold text-amber-100/80" aria-expanded={open}>
   <span>L5 {display(summary?.lastFive,market)}</span>
   <span>H2H {display(summary?.h2h,market)}</span>
   <ChevronDown className={"size-3 text-white/45 transition "+(open?"rotate-180":"")}/>
  </button>
  {open?<span className="mt-2 block w-full max-w-md rounded-lg border border-white/10 bg-black/30 p-2 text-[0.58rem] text-white/70">
   <span className="block font-bold">Historical {labelFor(market)} · played appearances including substitutes</span>
   <span className="mt-1 block">L5: {summary?.lastFive.known??0} with stat data · {summary?.lastFive.hits??0}/{summary?.lastFive.total??0} met {market} threshold</span>
   <span className="mt-1 block">H2H: {summary?.h2h.known??0} with stat data · {summary?.h2h.hits??0}/{summary?.h2h.total??0} met {market} threshold</span>
   {history?.ok?<span className="mt-2 block border-t border-white/10 pt-2">
     {(history.h2h??[]).length?<span className="block font-bold">Latest H2H matches</span>:<span className="block">No imported H2H match rows.</span>}
     {(history.h2h??[]).slice(0,12).map(m=><span key={m.date+m.opponent} className="mt-1 flex justify-between gap-2">
       <span>{m.date} · {m.opponent} · {m.minutes??"?"} min</span>
       <span className="font-bold">{m.yellow===true?"🟨 ":""}{m.hit===true?"✓":m.hit===false?"✕":"—"}</span>
      </span>)}
   </span>:null}
  </span>:null}
 </span>
}