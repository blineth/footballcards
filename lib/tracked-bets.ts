"use client"

export type TrackedBetStatus="open"|"won"|"lost"|"void"
export type TrackedBetLeg={
  label:string
  player?:string|null
  team?:string|null
  fixture?:string|null
  market?:string|null
  modelProbability?:number|null
  bet365Odds?:number|null
}
export type TrackedBet={
  id:string
  source:"match-builder"|"acca"|"custom"
  title:string
  fixture?:string|null
  createdAt:string
  settledAt?:string|null
  status:TrackedBetStatus
  bookmaker:"Bet365"
  odds:number
  stake:number
  modelProbability?:number|null
  legs:TrackedBetLeg[]
}
const KEY="matchedge:tracked-bets:v1"
const EVENT="matchedge:tracked-bets"

function safeParse(raw:string|null):TrackedBet[]{
  if(!raw)return[]
  try{
    const rows=JSON.parse(raw)
    return Array.isArray(rows)?rows.filter(Boolean):[]
  }catch{return[]}
}
export function getTrackedBets():TrackedBet[]{
  if(typeof window==="undefined")return[]
  return safeParse(window.localStorage.getItem(KEY))
}
function write(rows:TrackedBet[]){
  if(typeof window==="undefined")return
  window.localStorage.setItem(KEY,JSON.stringify(rows))
  window.dispatchEvent(new CustomEvent(EVENT))
}
export function addTrackedBet(input:Omit<TrackedBet,"id"|"createdAt"|"status"|"settledAt"|"bookmaker">){
  const row:TrackedBet={
    ...input,
    id:typeof crypto!=="undefined"&&"randomUUID"in crypto?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
    createdAt:new Date().toISOString(),
    status:"open",
    settledAt:null,
    bookmaker:"Bet365",
  }
  write([row,...getTrackedBets()])
  return row
}
export function settleTrackedBet(id:string,status:Exclude<TrackedBetStatus,"open">){
  write(getTrackedBets().map(row=>row.id===id?{...row,status,settledAt:new Date().toISOString()}:row))
}
export function removeTrackedBet(id:string){write(getTrackedBets().filter(row=>row.id!==id))}
export function trackedBetEventName(){return EVENT}
export function betReturn(row:TrackedBet){
  if(row.status==="won")return row.stake*row.odds
  if(row.status==="void")return row.stake
  if(row.status==="lost")return 0
  return null
}
export function betProfit(row:TrackedBet){
  const returned=betReturn(row)
  return returned==null?null:returned-row.stake
}
