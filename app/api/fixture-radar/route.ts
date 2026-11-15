import { db, isDatabaseConfigured } from "@/lib/db"
import { playerBaselines, playerH2H, playerRefereeHistory } from "@/lib/db/schema"
import { getRefereeByName } from "@/lib/historical"
import { directOpponentRoles, getPredictedFixture, getPredictedPlayer, normalisePredictedName } from "@/lib/predicted-lineups"
import { and, eq, inArray } from "drizzle-orm"
import { NextResponse } from "next/server"
import { GET as espnGET } from "../fixture-radar-espn/route"
import { GET as internationalPlayersGET } from "../international/players/route"

export const dynamic = "force-dynamic"
const PREMIER_LEAGUE_SEASON_START = "2026-08-21"
const CHAMPIONSHIP_SEASON_START = "2026-08-01"
const LEAGUE_ONE_SEASON_START = "2026-08-01"
const LEAGUE_TWO_SEASON_START = "2026-08-01"
const INTERNATIONAL_FORM_START = "2026-01-01"
const INTERNATIONAL_COMPETITIONS=[
  "International",
  "UEFA European Championship",
  "UEFA European Championship Qualifying",
  "UEFA Nations League",
  "FIFA World Cup",
  "FIFA World Cup Qualifying - UEFA",
  "FIFA World Cup Qualifying - CONMEBOL",
  "FIFA World Cup Qualifying - CONCACAF",
  "FIFA World Cup Qualifying - AFC",
  "FIFA World Cup Qualifying - CAF",
  "FIFA World Cup Qualifying - OFC",
  "International Friendly",
]
function competitionHistoryCondition(competition:string){
  return competition==="International"
    ? inArray(playerH2H.competition,INTERNATIONAL_COMPETITIONS)
    : eq(playerH2H.competition,competition)
}

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function csvDate(value: string) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return ""
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
}
async function footballDataReferee(date: string, home: string, away: string, competition: string) {
  if (competition !== "Premier League") return null
  try {
    const response = await fetch("https://www.football-data.co.uk/mmz4281/2627/E0.csv", { cache: "no-store", signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const lines = (await response.text()).split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    const headers = lines[0].split(",").map((value) => value.replace(/^\uFEFF/, "").trim())
    const dateIndex = headers.indexOf("Date"), homeIndex = headers.indexOf("HomeTeam"), awayIndex = headers.indexOf("AwayTeam"), refereeIndex = headers.indexOf("Referee")
    if ([dateIndex, homeIndex, awayIndex, refereeIndex].some((index) => index < 0)) return null
    for (const line of lines.slice(1)) {
      const cells = line.split(",")
      if (csvDate(cells[dateIndex] ?? "") !== date) continue
      if (!teamMatch(cells[homeIndex], home) || !teamMatch(cells[awayIndex], away)) continue
      const referee = String(cells[refereeIndex] ?? "").trim()
      if (referee) return referee
    }
  } catch {}
  return null
}
function confirmedAppointmentFallback(date: string, home: string, away: string, competition: string) {
  if (competition !== "Premier League") return null
  const appointments: Record<string, string> = { "2026-08-22|nottingham forest|leeds united": "Robert Jones" }
  return appointments[`${date}|${norm(home)}|${norm(away)}`] ?? null
}

async function mergeInternationalProfiles(data:any,home:string,away:string){
  if(!Array.isArray(data?.candidates))data.candidates=[]
  const load=async(team:string)=>{
    try{
      const response=await internationalPlayersGET(new Request("http://local/api/international/players?team="+encodeURIComponent(team)))
      if(!response.ok)return [] as any[]
      const json=await response.json()
      return Array.isArray(json?.players)?json.players:[]
    }catch{return [] as any[]}
  }
  const [homeProfiles,awayProfiles]=await Promise.all([load(home),load(away)])
  const profiles=[...homeProfiles,...awayProfiles]
  if(!profiles.length)return data

  const existing=new Map<string,any>()
  for(const candidate of data.candidates){
    const key=norm(String(candidate?.name??candidate?.dbName??""))+"|"+norm(String(candidate?.team??""))
    if(key)existing.set(key,candidate)
  }
  // Once ESPN has published both starting XIs, that 22-player set is immutable.
  // Profile enrichment may add history to those starters, but must never append
  // squad players or substitutes back into the confirmed pool.
  const confirmedKeys=data?.lineupsConfirmed===true?new Set(existing.keys()):null

  const merged:any[]=[]
  const used=new Set<string>()
  for(const profile of profiles){
    const name=String(profile?.name??"").trim()
    const team=String(profile?.nationalTeam??"").trim()
    if(!name||!team)continue
    const key=norm(name)+"|"+norm(team)
    if(confirmedKeys&&!confirmedKeys.has(key))continue
    const current=profile?.domesticCurrent??null
    const intl=profile?.international??{}
    const intlMatches=Number(intl?.matches??0)
    const intlStarts=Number(intl?.starts??0)
    const intlMinutes=Number(intl?.minutes??0)
    const intlStartRate=intlMatches>0?intlStarts/intlMatches:0
    const intlMinutesRate=intlMatches>0?Math.min(1,intlMinutes/(intlMatches*90)):0
    const clubApps=Number(current?.appearances??0)
    const clubStarts=Number(current?.starts??0)
    const clubStartRate=clubApps>0?clubStarts/clubApps:0
    // Never let a 1/1 or 2/2 international sample look as certain as 10+/10+.
    // Shrink start rate toward a normal senior-squad prior and grow trust with caps.
    const intlReliability=Math.min(1,intlMatches/8)
    const smoothedIntlStart=(intlStarts+0.55*4)/(intlMatches+4)
    const intlUsage=smoothedIntlStart*.65+intlMinutesRate*.35
    const startLikelihood=Math.max(.05,Math.min(.95,
      .18+intlUsage*(.12+.62*intlReliability)+clubStartRate*.10
    ))
    const profilePosition=String(profile?.position??"")
    const position=norm(profilePosition)==="sub"
      ? String(current?.position ?? profilePosition ?? "")
      : (profilePosition||String(current?.position??""))
    const base=existing.get(key)??{}
    merged.push({
      ...base,
      name:base?.name??name,
      dbName:base?.dbName??name,
      team:base?.team??team,
      position:position || base?.position || null,
      appearances:intlMatches,
      starts:intlStarts,
      minutes:intlMinutes,
      internationalMatches:intlMatches,
      internationalStarts:intlStarts,
      internationalMinutes:intlMinutes,
      startLikelihood,
      fouls90:Number.isFinite(Number(intl?.fouls90))?Number(intl.fouls90):Number(current?.fouls90??base?.fouls90??0),
      fouled90:Number.isFinite(Number(intl?.fouled90))?Number(intl.fouled90):Number(current?.fouled90??base?.fouled90??0),
      cards90:Number.isFinite(Number(intl?.cards90))?Number(intl.cards90):Number(current?.cards90??base?.cards90??0),
      shots90:Number.isFinite(Number(intl?.shots90))?Number(intl.shots90):Number(current?.shots90??base?.shots90??0),
      shotsOnTarget90:Number.isFinite(Number(intl?.shotsOnTarget90))?Number(intl.shotsOnTarget90):Number(current?.shotsOnTarget90??base?.shotsOnTarget90??0),
      domesticCurrent:current?{
        club:String(current?.club??current?.team??""),
        competition:String(current?.competition??""),
        season:String(current?.season??"2026/27"),
        appearances:Number(current?.appearances??0),
        starts:Number(current?.starts??0),
        minutes:Number(current?.minutes??0),
        yellowCards:Number(current?.yellowCards??0),
        redCards:Number(current?.redCards??0),
        foulsCommitted:Number(current?.foulsCommitted??0),
        foulsDrawn:Number(current?.foulsDrawn??0),
        cards90:Number(current?.cards90??0),
        fouls90:Number(current?.fouls90??0),
      }:base?.domesticCurrent??null,
      score:Number(profile?.blended?.foulResearchScore??base?.score??0),
      internationalProfile:true,
    })
    used.add(key)
  }

  for(const candidate of data.candidates){
    const key=norm(String(candidate?.name??candidate?.dbName??""))+"|"+norm(String(candidate?.team??""))
    if(!used.has(key))merged.push(candidate)
  }

  data.candidates=merged
  data.internationalProfileMerge={
    source:"International senior history + current domestic form",
    profiles:profiles.length,
    homeProfiles:homeProfiles.length,
    awayProfiles:awayProfiles.length,
    rule:"Before confirmed XIs, senior international starts/minutes drive starter likelihood; club starts are secondary only.",
  }
  return data
}

async function addCurrentSeasonLayer(data: any, competition: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const names = Array.from(new Set(data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean))) as string[]
  const rows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), competitionHistoryCondition(competition))) : []
  const seasonStart = competition === "Championship" ? CHAMPIONSHIP_SEASON_START : competition === "League One" ? LEAGUE_ONE_SEASON_START : competition === "League Two" ? LEAGUE_TWO_SEASON_START : competition === "International" ? INTERNATIONAL_FORM_START : PREMIER_LEAGUE_SEASON_START
  const currentRows = rows.filter((row) => String(row.matchDate ?? "") >= seasonStart)
  data.candidates = data.candidates.map((candidate: any) => {
    const playerRows = currentRows.filter((row) => row.playerName === candidate.dbName)
    const games = playerRows.length
    const minutes = playerRows.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const fouls = playerRows.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const yellows = playerRows.filter((row) => row.yellowCard === true).length
    const goals = playerRows.reduce((sum, row) => sum + Number(row.goals ?? 0), 0)
    const assists = playerRows.reduce((sum, row) => sum + Number(row.assists ?? 0), 0)
    const shots = playerRows.reduce((sum, row) => sum + Number(row.shots ?? 0), 0)
    const shotsOnTarget = playerRows.reduce((sum, row) => sum + Number(row.shotsOnTarget ?? 0), 0)
    const foulsDrawn = playerRows.reduce((sum, row) => sum + Number(row.foulsDrawn ?? 0), 0)
    const fouls90 = minutes > 0 ? (fouls * 90) / minutes : null
    const cards90 = minutes > 0 ? (yellows * 90) / minutes : null
    const recentScore = minutes > 0 ? Math.min(100, (Math.min(1, Number(fouls90) / 2.5) * 55) + (Math.min(1, Number(cards90) / 0.6) * 45)) : Number(candidate.score ?? 0)
    const recentWeight = Math.min(0.35, minutes / 900)
    const score = Math.round(((Number(candidate.score ?? 0) * (1 - recentWeight)) + (recentScore * recentWeight)) * 10) / 10
    return { ...candidate, score, band: score >= 70 ? "STRONG" : score >= 55 ? "GOOD" : "WATCH", currentSeason: { season: "2026/27", games, minutes, fouls, foulsDrawn, yellows, goals, assists, shots, shotsOnTarget, fouls90: fouls90 == null ? null : Math.round(fouls90 * 100) / 100, cards90: cards90 == null ? null : Math.round(cards90 * 100) / 100, evidenceWeight: Math.round(recentWeight * 100) } }
  })
  data.currentSeasonLayer = { season: "2026/27", from: seasonStart, playerMatchRows: currentRows.length, weighting: "Recent season starts at about 10% after one full match and grows to a 35% cap" }
  return data
}

function h2hRank(candidate: any) {
  if (Number(candidate.h2hYellows ?? 0) > 0) return 2
  if (Number(candidate.h2hFouls ?? 0) > 0) return 1
  return 0
}
function candidateOrder(a: any, b: any) {
  return h2hRank(b) - h2hRank(a) || Number(b.h2hYellows ?? 0) - Number(a.h2hYellows ?? 0) || Number(b.h2hFouls ?? 0) - Number(a.h2hFouls ?? 0) || Number(b.score ?? 0) - Number(a.score ?? 0)
}

function positionGroup(position:string|null|undefined){
  const p=norm(position)
  const compact=p.replace(/\s+/g,"")
  if(p.includes("goal")||compact==="gk"||compact==="g")return "gk"
  if(p.includes("back")||p.includes("def")||/(^|[^a-z])(cb|lb|rb|lwb|rwb)([^a-z]|$)/.test(" "+p+" ")||compact.startsWith("cd"))return "def"
  if(p.includes("forward")||p.includes("striker")||p.includes("wing")||compact==="f"||compact.startsWith("st")||compact.startsWith("cf")||["lw","rw","lf","rf","ss"].includes(compact))return "att"
  if(p.includes("mid")||compact.startsWith("dm")||compact.startsWith("cm")||compact.startsWith("am")||compact==="lm"||compact==="rm"||compact.startsWith("cdm")||compact.startsWith("cam"))return "mid"
  return "other"
}
function predictedStarterScore(candidate:any){
  const starts=Number(candidate.internationalStarts??candidate.starts??0)
  const apps=Number(candidate.internationalMatches??candidate.appearances??0)
  const minutes=Number(candidate.internationalMinutes??candidate.minutes??0)
  const minutesPerCap=apps>0?Math.min(1,minutes/(apps*90)):0
  const likelihood=Number(candidate.startLikelihood??0)
  const sampleReliability=Math.min(1,apps/8)
  const smoothedStart=(starts+0.55*4)/(apps+4)
  const usage=smoothedStart*.65+minutesPerCap*.35
  const subPenalty=norm(candidate.position)==="sub"?.18:0
  return Math.max(0,
    likelihood*.50+
    usage*(.12+.24*sampleReliability)+
    Math.min(1,apps/12)*.08+
    Math.min(1,Number(candidate.score??0)/100)*.06-
    subPenalty
  )
}
function candidateMatchesName(candidate:any,name:string){
  const a=normalisePredictedName(candidate?.name??candidate?.dbName??"")
  const b=normalisePredictedName(name)
  return Boolean(a&&b&&(a===b||a.includes(b)||b.includes(a)))
}
function buildPredictedTeam(candidates:any[],teamName:string,curatedTeam:any|null){
  const teamCandidates=candidates.filter(c=>teamMatch(c.team,teamName))
  const chosen:any[]=[]
  const used=new Set<string>()
  const add=(candidate:any,role?:string|null,confidence?:string|null,formation?:string|null)=>{
    if(!candidate||chosen.length>=11)return
    const key=String(candidate.dbName??candidate.name)
    if(used.has(key))return
    chosen.push({...candidate,predictedStarter:true,predictedRole:role??candidate.position??null,predictedLineupConfidence:confidence??curatedTeam?.confidence??"recent-xi-fallback",predictedFormation:formation??curatedTeam?.formation??null})
    used.add(key)
  }

  if(curatedTeam?.players?.length){
    for(const p of curatedTeam.players){
      const hit=teamCandidates.find(c=>!used.has(String(c.dbName??c.name))&&candidateMatchesName(c,p.name))
      if(hit)add(hit,p.role,curatedTeam.confidence,curatedTeam.formation)
    }
  }

  const ranked=teamCandidates
    .filter(c=>!used.has(String(c.dbName??c.name)))
    .sort((a,b)=>predictedStarterScore(b)-predictedStarterScore(a)||Number(b.internationalMinutes??b.minutes??0)-Number(a.internationalMinutes??a.minutes??0))

  // If there is no trusted published XI, build a football-shaped XI instead of
  // simply taking the top 10 outfield scores (which could be 7-8 defenders).
  if(!curatedTeam?.players?.length){
    const byGroup=(group:string)=>ranked.filter(c=>positionGroup(c.position)===group)
    add(byGroup("gk")[0],byGroup("gk")[0]?.position??"GK")

    const quotas:{group:string;count:number}[]=[
      {group:"def",count:4},
      {group:"mid",count:4},
      {group:"att",count:2},
    ]
    for(const quota of quotas){
      for(const candidate of byGroup(quota.group)){
        if(chosen.filter(c=>positionGroup(c.predictedRole??c.position)===quota.group).length>=quota.count)break
        add(candidate)
      }
    }
  }else if(!chosen.some(c=>positionGroup(c.position)==="gk")){
    add(ranked.find(c=>positionGroup(c.position)==="gk"))
  }

  // Fill any gaps from the strongest remaining players, but avoid an implausible
  // defender pile-up when role data is available.
  for(const candidate of ranked){
    if(chosen.length>=11)break
    const group=positionGroup(candidate.position)
    if(group==="def"&&chosen.filter(c=>positionGroup(c.predictedRole??c.position)==="def").length>=5)continue
    add(candidate)
  }
  // Absolute fallback if sparse role metadata prevented 11 selections.
  for(const candidate of ranked){
    if(chosen.length>=11)break
    add(candidate)
  }
  return chosen.slice(0,11)
}
function applyLineupMode(data:any,date:string,home:string,away:string,competition:string){
  if(!Array.isArray(data?.candidates)||!data.candidates.length)return data
  if(data?.lineupsConfirmed===true){
    data.lineupMode="confirmed"
    data.lineupSource="Official starting XI"
    data.candidates=data.candidates.map((c:any)=>({...c,predictedStarter:false}))
    return data
  }
  // Before the official XI is confirmed, keep modelling from a probable XI.
  // For internationals without a published current squad, the upstream candidate
  // pool is restricted to players with recent senior international appearances.
  // A verified current squad, when available, narrows this pool further; the
  // official starting XI always replaces the prediction immediately.
  if(competition==="International"&&data?.squadVerified!==true){
    data.predictedLineupEligibility="recent-senior-international-history"
    data.recommendationsBlockedReason=null
  }
  const curated=getPredictedFixture(date,home,away)
  const curatedHome=curated ? Object.entries(curated.teams).find(([name])=>teamMatch(name,home))?.[1] : null
  const curatedAway=curated ? Object.entries(curated.teams).find(([name])=>teamMatch(name,away))?.[1] : null
  const homeXI=buildPredictedTeam(data.candidates,home,curatedHome)
  const awayXI=buildPredictedTeam(data.candidates,away,curatedAway)
  const predicted=[...homeXI,...awayXI]
  if(predicted.length){
    data.candidates=predicted
    data.lineupMode="predicted"
    data.lineupSource=curated
      ?"Published predicted XI with recent-start fallback for any unmatched positions"
      :"Probable XI from current squad, start rate, minutes and recent selection history"
    data.predictedLineups={
      source:data.lineupSource,
      home:{formation:curatedHome?.formation??null,confidence:curatedHome?.confidence??"recent-xi-fallback",players:homeXI.map((c:any)=>({name:c.name,role:c.predictedRole??c.position??null,startLikelihood:Number(c.startLikelihood??0)}))},
      away:{formation:curatedAway?.formation??null,confidence:curatedAway?.confidence??"recent-xi-fallback",players:awayXI.map((c:any)=>({name:c.name,role:c.predictedRole??c.position??null,startLikelihood:Number(c.startLikelihood??0)}))},
    }
  }
  return data
}
async function addH2HMatchesAndBalance(data: any, home: string, away: string, competition: string, fixtureDate: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const names = Array.from(new Set(data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean))) as string[]
  const rows = names.length ? await db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, names), competitionHistoryCondition(competition))) : []
  data.candidates = data.candidates.map((candidate: any) => {
    const opponent = teamMatch(candidate.team, home) ? away : home
    const matches = rows.filter((row) => row.playerName === candidate.dbName && teamMatch(row.opponent, opponent) && (!fixtureDate || String(row.matchDate) < fixtureDate)).sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate))).slice(0, 8)
    return { ...candidate, h2hYellows: matches.filter((row) => row.yellowCard === true).length, h2hFouls: matches.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0), h2hMatches: matches.map((row) => ({ matchDate: String(row.matchDate), opponent: row.opponent, venue: row.venue, competition: row.competition, minutes: row.minutes, goals: row.goals, assists: row.assists, shots: row.shots, shotsOnTarget: row.shotsOnTarget, foulsCommitted: row.foulsCommitted, foulsDrawn: row.foulsDrawn, yellowCard: row.yellowCard, redCard: row.redCard })) }
  })
  const maxPerTeam=data?.lineupsConfirmed===true?11:11
  const homeCandidates = data.candidates.filter((c: any) => teamMatch(c.team, home)).sort(candidateOrder).slice(0, maxPerTeam)
  const awayCandidates = data.candidates.filter((c: any) => teamMatch(c.team, away)).sort(candidateOrder).slice(0, maxPerTeam)
  data.candidates = [...homeCandidates, ...awayCandidates].sort(candidateOrder)
  data.rankingMethod = data?.lineupsConfirmed===true
    ? "Official starters ranked by H2H, fouls/cards and wider evidence"
    : "Predicted starters ranked by H2H, fouls/cards and wider evidence"
  return data
}

function compatibleRole(position: string | null | undefined, opponentPosition: string | null | undefined) {
  const p = norm(position), o = norm(opponentPosition)
  if (!p || !o) return true
  if (p.includes("def")) return o.includes("for") || o.includes("mid")
  if (p.includes("for")) return o.includes("def")
  if (p.includes("mid")) return o.includes("mid") || o.includes("def")
  return true
}

async function addDeepEvidence(data: any, home: string, away: string, competition: string, refereeName: string | null, fixtureDate: string) {
  if (!isDatabaseConfigured || !Array.isArray(data?.candidates) || !data.candidates.length) return data
  const predicted = getPredictedFixture(fixtureDate, home, away)
  const predictedNames = predicted ? Object.values(predicted.teams).flatMap((t) => t.players.map((p) => p.name)) : []
  const candidateNames = data.candidates.map((c: any) => String(c.dbName ?? "")).filter(Boolean)
  const allNames = Array.from(new Set([...candidateNames, ...predictedNames])) as string[]
  const [baselines, matchRows, refereeRows] = await Promise.all([
    db.select().from(playerBaselines).where(eq(playerBaselines.season, "2026/27")),
    db.select().from(playerH2H).where(and(inArray(playerH2H.playerName, allNames), competitionHistoryCondition(competition))),
    refereeName ? db.select().from(playerRefereeHistory).where(and(inArray(playerRefereeHistory.playerName, candidateNames), eq(playerRefereeHistory.refereeName, refereeName))) : Promise.resolve([]),
  ])

  const baselineForName = (name: string) => {
    const b = normalisePredictedName(name)
    return baselines
      .filter((row) => {
        const a = normalisePredictedName(row.playerName)
        return a === b || a.includes(b) || b.includes(a)
      })
      .sort((a, z) => Number(z.minutes ?? 0) - Number(a.minutes ?? 0))[0]
  }
  const foulDrawnProfile = (name: string) => {
    const baseline = baselineForName(name)
    const minutes = Number(baseline?.minutes ?? 0)
    const season = minutes > 0 ? (Number(baseline?.foulsDrawn ?? 0) * 90) / minutes : null
    const actualName=baseline?.playerName ?? name
    const recent=matchRows
      .filter((row:any)=>normalisePredictedName(row.playerName)===normalisePredictedName(actualName))
      .sort((a:any,b:any)=>String(b.matchDate).localeCompare(String(a.matchDate)))
      .slice(0,5)
    const recentMinutes=recent.reduce((sum:any,row:any)=>sum+Number(row.minutes??0),0)
    const recentDrawn=recent.reduce((sum:any,row:any)=>sum+Number(row.foulsDrawn??0),0)
    const recent90=recentMinutes>0?(recentDrawn*90)/recentMinutes:null
    const pressure=season==null
      ? recent90
      : recent90==null
        ? season
        : season*0.62+recent90*0.38
    return {
      seasonFouled90:season==null?null:Math.round(season*100)/100,
      recentFouled90:recent90==null?null:Math.round(recent90*100)/100,
      pressureFouled90:pressure==null?null:Math.round(pressure*100)/100,
      recentGames:recent.length,
    }
  }

  let enriched = data.candidates.map((candidate: any) => {
    const baseline = baselineForName(candidate.dbName)
    const baselineMinutes = Number(baseline?.minutes ?? candidate.minutes ?? 0)
    const foulsDrawn = Number(baseline?.foulsDrawn ?? 0)
    const fouled90 = baselineMinutes > 0 ? Math.round(((foulsDrawn * 90) / baselineMinutes) * 100) / 100 : null
    const recent = matchRows.filter((row) => row.playerName === candidate.dbName).sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate))).slice(0, 5)
    const recentMinutes = recent.reduce((sum, row) => sum + Number(row.minutes ?? 0), 0)
    const recentFouls = recent.reduce((sum, row) => sum + Number(row.foulsCommitted ?? 0), 0)
    const recentYellows = recent.filter((row) => row.yellowCard === true).length
    const recentFouls90 = recentMinutes > 0 ? Math.round(((recentFouls * 90) / recentMinutes) * 100) / 100 : null
    const ref = refereeRows.find((row: any) => row.playerName === candidate.dbName)
    const refMatches = Number(ref?.matchesTogether ?? 0)
    const refYellows = Number(ref?.yellowCards ?? 0)
    const refereeCardRate = refMatches > 0 ? Math.round((refYellows / refMatches) * 100) / 100 : null
    const predictedTeam = predicted ? Object.entries(predicted.teams).find(([teamName]) => teamMatch(teamName, candidate.team))?.[1] : undefined
    const predictedPlayer = getPredictedPlayer(predictedTeam, candidate.name) ?? getPredictedPlayer(predictedTeam, candidate.dbName)
    const recentFoulsDrawn=recent.reduce((sum,row)=>sum+Number(row.foulsDrawn??0),0)
    const recentFouled90=recentMinutes>0?Math.round(((recentFoulsDrawn*90)/recentMinutes)*100)/100:null
    const pressureFouled90=fouled90==null?recentFouled90:recentFouled90==null?fouled90:Math.round((fouled90*0.62+recentFouled90*0.38)*100)/100
    return { ...candidate, predictedRole: predictedPlayer?.role ?? candidate.predictedRole ?? null, predictedStarter: predicted ? Boolean(predictedPlayer) : candidate.predictedStarter===true, predictedLineupConfidence: predictedTeam?.confidence ?? candidate.predictedLineupConfidence ?? null, predictedFormation: predictedTeam?.formation ?? candidate.predictedFormation ?? null, fouled90, recentFouled90, pressureFouled90, recentFive: { games: recent.length, minutes: recentMinutes, fouls: recentFouls, foulsDrawn:recentFoulsDrawn, yellows: recentYellows, fouls90: recentFouls90, fouled90:recentFouled90, matches: recent.map((row) => ({ matchDate: String(row.matchDate), opponent: row.opponent, minutes: row.minutes, foulsCommitted: row.foulsCommitted, foulsDrawn: row.foulsDrawn, yellowCard: row.yellowCard })) }, refereePlayer: ref ? { matches: refMatches, yellows: refYellows, fouls: Number(ref.foulsCommitted ?? 0), cardRate: refereeCardRate } : null }
  })

  enriched = enriched.map((candidate: any) => {
    let matchup: any = null
    let matchupType = "broad-role"
    if (predicted && candidate.predictedRole) {
      const opponentTeamEntry = Object.entries(predicted.teams).find(([teamName]) => !teamMatch(teamName, candidate.team))
      const desired = directOpponentRoles(candidate.predictedRole)
      if (opponentTeamEntry && desired.length) {
        const direct = opponentTeamEntry[1].players.filter((player) => desired.includes(player.role.toUpperCase()))
          .map((player) => {
            const profile=foulDrawnProfile(player.name)
            return { name: player.name, role: player.role, fouled90: profile.pressureFouled90, ...profile, confidence: opponentTeamEntry[1].confidence }
          })
          .sort((a, b) => Number(b.fouled90 ?? -1) - Number(a.fouled90 ?? -1))[0]
        if (direct) { matchup = direct; matchupType = "direct-predicted-role" }
      }
    }
    if (!matchup) {
      const opposing = enriched.filter((other: any) => !teamMatch(other.team, candidate.team) && compatibleRole(candidate.position, other.position))
      matchup = opposing.sort((a: any, b: any) => Number(b.pressureFouled90 ?? b.fouled90 ?? -1) - Number(a.pressureFouled90 ?? a.fouled90 ?? -1))[0] ?? null
    }

    const repeatedH2H = Number(candidate.h2hYellows ?? 0)
    const recentYC = Number(candidate.recentFive?.yellows ?? 0)
    const recentF90 = Number(candidate.recentFive?.fouls90 ?? 0)
    const matchupPressure = Number(matchup?.pressureFouled90 ?? matchup?.fouled90 ?? 0)
    const refPlayerRate = Number(candidate.refereePlayer?.cardRate ?? 0)
    const starterBoost = candidate.predictedStarter ? 3 : 0
    const directMatchupBoost = matchupType === "direct-predicted-role" ? Math.min(8, matchupPressure * 3) : Math.min(5, matchupPressure * 2)
    const base = Number(candidate.score ?? 0)
    const deepScore = Math.min(100, Math.round((base * 0.55 + Math.min(24, repeatedH2H * 12) + Math.min(10, Number(candidate.h2hFouls ?? 0) * 1.5) + Math.min(10, recentYC * 5) + Math.min(8, recentF90 * 3) + directMatchupBoost + Math.min(7, refPlayerRate * 7) + starterBoost) * 10) / 10)
    const reasons: string[] = []
    if (repeatedH2H >= 2) reasons.push(`Booked in ${repeatedH2H} previous H2Hs`)
    else if (repeatedH2H === 1) reasons.push("Has a previous H2H booking")
    if (Number(candidate.h2hFouls ?? 0) >= 3) reasons.push(`${candidate.h2hFouls} fouls in previous H2Hs`)
    if (recentYC >= 2) reasons.push(`${recentYC} yellows in last ${candidate.recentFive?.games ?? 5} matches`)
    else if (recentYC === 1) reasons.push("Booked in recent 5-match sample")
    if (recentF90 >= 1.5) reasons.push(`${recentF90.toFixed(2)} fouls/90 over recent matches`)
    if (Number(candidate.cards90 ?? 0) >= 0.3) reasons.push(`${Number(candidate.cards90).toFixed(2)} cards/90 this season`)
    if (matchup && matchupType === "direct-predicted-role") reasons.push(`${candidate.predictedRole} likely facing ${matchup.role} ${matchup.name}${matchupPressure > 0 ? ` (${matchupPressure.toFixed(2)} fouls drawn/90)` : ""}`)
    else if (matchup && matchupPressure >= 1.5) reasons.push(`Likely matchup ${matchup.name} draws ${matchupPressure.toFixed(2)} fouls/90`)
    if (candidate.refereePlayer?.matches >= 2 && refPlayerRate >= 0.4) reasons.push(`Booked in ${candidate.refereePlayer.yellows}/${candidate.refereePlayer.matches} games under this referee`)
    return { ...candidate, likelyMatchup: matchup ? { name: matchup.name, role: matchup.role ?? matchup.position ?? null, position: matchup.position ?? null, fouled90: matchupPressure || matchup.fouled90, seasonFouled90:matchup.seasonFouled90 ?? matchup.fouled90 ?? null, recentFouled90:matchup.recentFouled90 ?? null, pressureFouled90:matchupPressure || null, recentGames:matchup.recentGames ?? null, type: matchupType, confidence: matchup.confidence ?? null } : null, cardRiskScore: deepScore, shortlistReasons: reasons.slice(0, 4) }
  }).sort((a: any, b: any) => Number(b.cardRiskScore ?? 0) - Number(a.cardRiskScore ?? 0))

  data.candidates = enriched
  if(predicted){
    data.predictedLineups = {
      source: "Published predicted XI / recent-XI fallback where no crowd prediction was available",
      home: predicted.teams[home] ?? Object.entries(predicted.teams).find(([name]) => teamMatch(name, home))?.[1] ?? data.predictedLineups?.home ?? null,
      away: predicted.teams[away] ?? Object.entries(predicted.teams).find(([name]) => teamMatch(name, away))?.[1] ?? data.predictedLineups?.away ?? null,
    }
  }
  data.deepEvidence = { description: "Card/foul evidence combines historical cards/fouls, H2H, recent-five form, current-season evidence, referee history and predicted direct positional duels. Direct-opponent pressure blends season and recent-five fouls drawn/90, with predicted role/confidence used before official lineups; confirmed teams remain the final authority." }
  return data
}

export async function GET(request: Request) {
  const response = await espnGET(request)
  if (!response.ok) return response
  try {
    let data = await response.json()
    const url = new URL(request.url)
    const date = url.searchParams.get("date") ?? "", home = url.searchParams.get("home") ?? "", away = url.searchParams.get("away") ?? "", competition = url.searchParams.get("competition") ?? "Premier League"
    if(competition==="International")data=await mergeInternationalProfiles(data,home,away)
    data = await addCurrentSeasonLayer(data, competition)
    data = applyLineupMode(data, date, home, away, competition)
    data = await addH2HMatchesAndBalance(data, home, away, competition, date)

    let refereeName = data?.referee?.name ?? null
    let refereeSource = refereeName ? "ESPN" : null
    if (!refereeName && date && home && away) { refereeName = await footballDataReferee(date, home, away, competition); if (refereeName) refereeSource = "Football-Data" }
    if (!refereeName && date && home && away) { refereeName = confirmedAppointmentFallback(date, home, away, competition); if (refereeName) refereeSource = "confirmed appointment fallback" }
    if (refereeName) {
      const historical = await getRefereeByName(refereeName)
      data.referee = { ...(data.referee ?? {}), name: refereeName, source: refereeSource, yellowsPerGame: historical?.yellowsPerGame != null ? Number(historical.yellowsPerGame) : data.referee?.yellowsPerGame ?? null, foulsPerGame: historical?.foulsPerGame != null ? Number(historical.foulsPerGame) : data.referee?.foulsPerGame ?? null, matches: historical?.matchesRefereed ?? data.referee?.matches ?? null }
    }
    data = await addDeepEvidence(data, home, away, competition, refereeName, date)
    return NextResponse.json(data)
  } catch {
    return response
  }
}
