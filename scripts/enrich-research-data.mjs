import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'data', 'source', 'player_match_log_2025_26.json')
const BASELINES = path.join(ROOT, 'player_baselines.csv')
const OUT_H2H = path.join(ROOT, 'h2h.csv')
const OUT_REFS = path.join(ROOT, 'referees.csv')
const OUT_PLAYER_REFS = path.join(ROOT, 'player_referee_history.csv')
const OUT_CARD_EVENTS = path.join(ROOT, 'data', 'identified_card_events.csv')
const OUT_UNRESOLVED = path.join(ROOT, 'data', 'unresolved_card_events.csv')
const OUT_REPORT = path.join(ROOT, 'data', 'research-data-quality.json')

const UPSTREAM = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026'
const FOOTBALL_DATA = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv'

function parseCSV(text) {
  const rows = []
  let field = '', row = [], inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some(v => v !== '')) rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map(v => v.trim().replace(/^\uFEFF/, ''))
  return rows.slice(1).map(r =>
    Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))
  )
}

function csvCell(value) {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCSV(headers, rows) {
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))
  ].join('\n') + '\n'
}

function n(v) {
  if (v == null || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

async function fetchText(url, attempts = 5) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'footballcards-full-card-enrichment/2.0' }
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.text()
    } catch (e) {
      last = e
      await new Promise(r => setTimeout(r, 750 * (i + 1)))
    }
  }
  throw new Error(`Failed to fetch ${url}: ${last instanceof Error ? last.message : last}`)
}

const teamSlug = new Map([
  ['Arsenal', 'arsenal'],
  ['Aston Villa', 'aston-villa'],
  ['Bournemouth', 'afc-bournemouth'],
  ['Brentford', 'brentford'],
  ['Brighton', 'brighton-hove-albion'],
  ['Burnley', 'burnley'],
  ['Chelsea', 'chelsea'],
  ['Crystal Palace', 'crystal-palace'],
  ['Everton', 'everton'],
  ['Fulham', 'fulham'],
  ['Leeds', 'leeds-united'],
  ['Liverpool', 'liverpool'],
  ['Man City', 'manchester-city'],
  ['Man United', 'manchester-united'],
  ['Newcastle', 'newcastle-united'],
  ["Nott'm Forest", 'nottingham-forest'],
  ['Nottingham Forest', 'nottingham-forest'],
  ['Sunderland', 'sunderland'],
  ['Tottenham', 'tottenham-hotspur'],
  ['West Ham', 'west-ham-united'],
  ['Wolves', 'wolverhampton-wanderers'],
])

const refereeFullName = new Map([
  ['M Donohue', 'Matthew Donohue'],
  ['L Smith', 'Lewis Smith'],
  ['S Attwell', 'Stuart Attwell'],
  ['D England', 'Darren England'],
  ['M Salisbury', 'Michael Salisbury'],
  ['R Jones', 'Robert Jones'],
  ['C Kavanagh', 'Chris Kavanagh'],
  ['T Bramall', 'Thomas Bramall'],
  ['A Taylor', 'Anthony Taylor'],
  ['S Hooper', 'Simon Hooper'],
  ['P Bankes', 'Peter Bankes'],
  ['A Kitchen', 'Andrew Kitchen'],
  ['S Barrott', 'Sam Barrott'],
  ['J Brooks', 'John Brooks'],
  ['J Gillett', 'Jarred Gillett'],
  ['P Tierney', 'Paul Tierney'],
  ['A Madley', 'Andy Madley'],
  ['T Robinson', 'Tim Robinson'],
  ['M Oliver', 'Michael Oliver'],
  ['T Harrington', 'Tony Harrington'],
  ['T Kirk', 'Thomas Kirk'],
  ['C Pawson', 'Craig Pawson'],
  ['F Hallam', 'Farai Hallam'],
])

function footballDataMatchId(home, away) {
  const h = teamSlug.get(home)
  const a = teamSlug.get(away)
  return h && a ? `25-26-prem-${h}-vs-${a}` : null
}

function dateOnly(value) {
  if (!value) return ''
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (uk) {
    let y = uk[3]
    if (y.length === 2) y = Number(y) >= 70 ? `19${y}` : `20${y}`
    return `${y}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`
  }
  return ''
}

const [baselineText, sourceText] = await Promise.all([
  fs.readFile(BASELINES, 'utf8'),
  fs.readFile(SOURCE, 'utf8'),
])

const baselines = parseCSV(baselineText)
const groupedSource = JSON.parse(sourceText)

const sourceRows = Object.entries(groupedSource).flatMap(([match_id, entries]) =>
  entries.map(([player_id, opponent, minutes, fouls_committed, fouls_drawn]) => ({
    player_id: String(player_id),
    opponent,
    match_id,
    minutes: String(minutes),
    fouls_committed: String(fouls_committed),
    fouls_drawn: String(fouls_drawn),
  }))
)

const profileById = new Map(
  baselines.map(r => [String(r.external_player_id), r])
)

// Exact match dates + exact player-level card incidents.
const dates = new Map()
const cardByMatchPlayer = new Map()
const identifiedCardEvents = []
const gwStats = []

async function loadGw(gw) {
  const dir = `${UPSTREAM}/By%20Tournament/Premier%20League/GW${gw}`
  const [matchText, incidentText] = await Promise.all([
    fetchText(`${dir}/matches.csv`),
    fetchText(`${dir}/incidents.csv`),
  ])

  const matches = parseCSV(matchText)
  const incidents = parseCSV(incidentText)

  for (const m of matches) {
    const d = dateOnly(m.kickoff_time)
    if (m.match_id && d) dates.set(m.match_id, d)
  }

  let identifiedCards = 0

  for (const i of incidents) {
    if (i.incident_type !== 'card' || !i.match_id || !i.player_id) continue

    const type = String(i.card_type || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')

    if (!['yellow', 'red', 'yellowred'].includes(type)) continue

    const key = `${i.match_id}|${i.player_id}`
    const rec = cardByMatchPlayer.get(key) ?? { yellow: false, red: false }

    if (type === 'yellow' || type === 'yellowred') rec.yellow = true
    if (type === 'red' || type === 'yellowred') rec.red = true

    cardByMatchPlayer.set(key, rec)

    identifiedCardEvents.push({
      gameweek: gw,
      match_id: i.match_id,
      player_id: i.player_id,
      player_name_source: i.player_name,
      minute: i.minute,
      added_time: i.added_time,
      card_type: i.card_type,
      yellow_card: (type === 'yellow' || type === 'yellowred') ? '1' : '0',
      red_card: (type === 'red' || type === 'yellowred') ? '1' : '0',
    })

    identifiedCards++
  }

  return { gw, matches: matches.length, identifiedCardIncidents: identifiedCards }
}

const concurrency = 6
for (let start = 1; start <= 38; start += concurrency) {
  const batch = []
  for (let gw = start; gw < start + concurrency && gw <= 38; gw++) {
    batch.push(loadGw(gw))
  }
  gwStats.push(...await Promise.all(batch))
}

// Quarantined incidents: a card is known to have happened but the player cannot be identified.
// For these matches, affected card types stay NULL/blank unless the player's card is explicitly known.
const quarantineText = await fetchText(
  `${UPSTREAM}/supplemental/incidents_quarantined.csv`
)
const quarantined = parseCSV(quarantineText)

const uncertainByMatch = new Map()
const unresolvedCardEvents = []

for (const q of quarantined) {
  if (q.incident_type !== 'card' || !q.match_id) continue

  const type = String(q.card_type || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

  const rec = uncertainByMatch.get(q.match_id) ?? {
    yellow: false,
    red: false,
  }

  if (type === 'yellow' || type === 'yellowred') rec.yellow = true
  if (type === 'red' || type === 'yellowred') rec.red = true

  uncertainByMatch.set(q.match_id, rec)

  unresolvedCardEvents.push({
    gameweek: q.gameweek,
    match_id: q.match_id,
    team_side: q.team_side,
    minute: q.minute,
    card_type: q.card_type,
    quarantine_reason: q.quarantine_reason,
  })
}

let missingDates = 0
let missingProfiles = 0
let nullYellowRows = 0
let nullRedRows = 0
let yellowTrueRows = 0
let redTrueRows = 0

const h2hRows = sourceRows.map(r => {
  const id = String(r.player_id)
  const p = profileById.get(id)

  if (!p) missingProfiles++

  const matchDate = dates.get(r.match_id) ?? ''
  if (!matchDate) missingDates++

  const known = cardByMatchPlayer.get(`${r.match_id}|${id}`) ?? {
    yellow: false,
    red: false,
  }

  const uncertain = uncertainByMatch.get(r.match_id) ?? {
    yellow: false,
    red: false,
  }

  const yellow = known.yellow ? '1' : uncertain.yellow ? '' : '0'
  const red = known.red ? '1' : uncertain.red ? '' : '0'

  if (yellow === '') nullYellowRows++
  if (red === '') nullRedRows++
  if (yellow === '1') yellowTrueRows++
  if (red === '1') redTrueRows++

  return {
    player_name: p?.player_name ?? `Player ${id}`,
    team: p?.team ?? '',
    opponent: r.opponent,
    match_date: matchDate,
    competition: 'Premier League',
    minutes: r.minutes,
    fouls_committed: r.fouls_committed,
    fouls_drawn: r.fouls_drawn,
    yellow_card: yellow,
    red_card: red,
    external_player_id: id,

    _knownYellow: known.yellow,
    _knownRed: known.red,
    _yellowCertain: yellow !== '',
    _redCertain: red !== '',
    _match_id: r.match_id,
  }
})

if (missingDates) {
  throw new Error(
    `Refusing to write invalid H2H: ${missingDates} source rows have no match_date.`
  )
}

if (missingProfiles) {
  throw new Error(
    `Refusing to write mismatched H2H: ${missingProfiles} source rows have no player profile.`
  )
}

await fs.writeFile(
  OUT_H2H,
  toCSV(
    [
      'player_name',
      'team',
      'opponent',
      'match_date',
      'competition',
      'minutes',
      'fouls_committed',
      'fouls_drawn',
      'yellow_card',
      'red_card',
      'external_player_id',
    ],
    h2hRows
  )
)

// Referee source: final completed 2025/26 Premier League Football-Data file.
const fdRows = parseCSV(await fetchText(FOOTBALL_DATA))
const refByMatch = new Map()
const refAgg = new Map()

let unmappedFootballDataMatches = 0

for (const r of fdRows) {
  const matchId = footballDataMatchId(r.HomeTeam, r.AwayTeam)
  if (!matchId) {
    unmappedFootballDataMatches++
    continue
  }

  const rawReferee = r.Referee
  if (!rawReferee) continue

  const referee = refereeFullName.get(rawReferee) ?? rawReferee

  refByMatch.set(matchId, referee)

  const a = refAgg.get(referee) ?? {
    matches: 0,
    yellows: 0,
    reds: 0,
    fouls: 0,
  }

  a.matches++
  a.yellows += (n(r.HY) ?? 0) + (n(r.AY) ?? 0)
  a.reds += (n(r.HR) ?? 0) + (n(r.AR) ?? 0)
  a.fouls += (n(r.HF) ?? 0) + (n(r.AF) ?? 0)

  refAgg.set(referee, a)
}

const refRows = [...refAgg.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, a]) => ({
    referee_name: name,
    matches_refereed: a.matches,
    yellow_cards: a.yellows,
    red_cards: a.reds,
    yellows_per_game: a.matches
      ? (a.yellows / a.matches).toFixed(3)
      : '',
    fouls_per_game: a.matches
      ? (a.fouls / a.matches).toFixed(3)
      : '',
    competition: 'Premier League',
    season: '2025/26',
    external_referee_id: '',
  }))

await fs.writeFile(
  OUT_REFS,
  toCSV(
    [
      'referee_name',
      'matches_refereed',
      'yellow_cards',
      'red_cards',
      'yellows_per_game',
      'fouls_per_game',
      'competition',
      'season',
      'external_referee_id',
    ],
    refRows
  )
)

// Exact player × referee history.
const pairAgg = new Map()
let sourceRowsWithoutReferee = 0

for (const r of h2hRows) {
  const referee = refByMatch.get(r._match_id)

  if (!referee) {
    sourceRowsWithoutReferee++
    continue
  }

  const id = String(r.external_player_id)
  const key = `${referee}|${id}|${r.team}`

  const a = pairAgg.get(key) ?? {
    referee,
    player: r.player_name,
    team: r.team,
    playerId: id,
    matches: 0,
    yellows: 0,
    reds: 0,
    fouls: 0,
    yellowCertain: true,
    redCertain: true,
  }

  a.matches++

  if (r._knownYellow) a.yellows++
  if (r._knownRed) a.reds++

  a.fouls += n(r.fouls_committed) ?? 0

  if (!r._yellowCertain) a.yellowCertain = false
  if (!r._redCertain) a.redCertain = false

  pairAgg.set(key, a)
}

const playerRefRows = [...pairAgg.values()]
  .sort(
    (a, b) =>
      a.referee.localeCompare(b.referee) ||
      a.player.localeCompare(b.player) ||
      a.team.localeCompare(b.team)
  )
  .map(a => ({
    referee_name: a.referee,
    player_name: a.player,
    team: a.team,
    matches_together: a.matches,
    yellow_cards: a.yellowCertain ? a.yellows : '',
    red_cards: a.redCertain ? a.reds : '',
    fouls_committed: a.fouls,
    external_referee_id: '',
    external_player_id: a.playerId,
  }))

await fs.writeFile(
  OUT_PLAYER_REFS,
  toCSV(
    [
      'referee_name',
      'player_name',
      'team',
      'matches_together',
      'yellow_cards',
      'red_cards',
      'fouls_committed',
      'external_referee_id',
      'external_player_id',
    ],
    playerRefRows
  )
)

await fs.mkdir(path.dirname(OUT_CARD_EVENTS), { recursive: true })

await fs.writeFile(
  OUT_CARD_EVENTS,
  toCSV(
    [
      'gameweek',
      'match_id',
      'player_id',
      'player_name_source',
      'minute',
      'added_time',
      'card_type',
      'yellow_card',
      'red_card',
    ],
    identifiedCardEvents.sort(
      (a, b) =>
        Number(a.gameweek) - Number(b.gameweek) ||
        a.match_id.localeCompare(b.match_id) ||
        Number(a.minute || 999) - Number(b.minute || 999)
    )
  )
)

await fs.writeFile(
  OUT_UNRESOLVED,
  toCSV(
    [
      'gameweek',
      'match_id',
      'team_side',
      'minute',
      'card_type',
      'quarantine_reason',
    ],
    unresolvedCardEvents
  )
)

// Compare known H2H yellow totals against the season baseline as an audit.
// Mismatches are reported, not silently changed.
const knownYellowByPlayer = new Map()
const knownRedByPlayer = new Map()

for (const r of h2hRows) {
  const id = String(r.external_player_id)
  if (r.yellow_card === '1') {
    knownYellowByPlayer.set(id, (knownYellowByPlayer.get(id) ?? 0) + 1)
  }
  if (r.red_card === '1') {
    knownRedByPlayer.set(id, (knownRedByPlayer.get(id) ?? 0) + 1)
  }
}

const baselineCardAudit = baselines
  .filter(r => r.external_player_id)
  .map(r => {
    const id = String(r.external_player_id)
    const baselineY = n(r.yellow_cards)
    const baselineR = n(r.red_cards)
    const knownY = knownYellowByPlayer.get(id) ?? 0
    const knownR = knownRedByPlayer.get(id) ?? 0

    return {
      player_id: id,
      player_name: r.player_name,
      team: r.team,
      baseline_yellows: baselineY,
      identified_match_yellows: knownY,
      yellow_difference:
        baselineY == null ? null : knownY - baselineY,
      baseline_reds: baselineR,
      identified_match_reds: knownR,
      red_difference:
        baselineR == null ? null : knownR - baselineR,
    }
  })
  .filter(
    r =>
      (r.yellow_difference != null && r.yellow_difference !== 0) ||
      (r.red_difference != null && r.red_difference !== 0)
  )

const report = {
  generatedAt: new Date().toISOString(),
  season: '2025/26',
  competition: 'Premier League',

  sources: {
    matchAndIncidentData:
      'olbauday/FPL-Core-Insights — 2025/26 Premier League GW1-GW38',
    refereeAndTeamTotals:
      'football-data.co.uk — 2025/26 Premier League E0.csv',
  },

  sourcePlayerMatchRows: sourceRows.length,
  exactMatchDates: dates.size,

  identifiedCardIncidentRows: identifiedCardEvents.length,
  identifiedPlayerMatchCardPairs: cardByMatchPlayer.size,
  unresolvedCardIncidentRows: unresolvedCardEvents.length,
  quarantinedCardMatches: uncertainByMatch.size,

  h2hRows: h2hRows.length,
  h2hYellowTrueRows: yellowTrueRows,
  h2hRedTrueRows: redTrueRows,
  h2hRowsWithUnknownYellowBecausePlayerWasUnlocated: nullYellowRows,
  h2hRowsWithUnknownRedBecausePlayerWasUnlocated: nullRedRows,

  refereeMatchesMapped: refByMatch.size,
  refereeRows: refRows.length,
  playerRefereeRows: playerRefRows.length,
  sourcePlayerRowsWithoutReferee,
  unmappedFootballDataMatches,

  baselineCardAuditMismatchCount: baselineCardAudit.length,
  baselineCardAuditMismatches: baselineCardAudit,

  gameweeks: gwStats.sort((a, b) => a.gw - b.gw),

  integrityRules: [
    'Cards are joined by exact match_id + player_id.',
    'yellowRed counts as both yellow_card=1 and red_card=1.',
    'If the source confirms a card happened but cannot identify the player, the affected card field stays blank/NULL rather than being converted to 0.',
    'Known no-card rows are written as 0.',
    'The builder refuses to generate H2H if a source row has no match date or no player profile.',
  ],
}

await fs.writeFile(
  OUT_REPORT,
  JSON.stringify(report, null, 2) + '\n'
)

console.log(JSON.stringify(report, null, 2))
