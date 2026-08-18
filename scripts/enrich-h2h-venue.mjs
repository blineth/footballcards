import fs from 'node:fs/promises'

const H2H_PATH = new URL('../h2h.csv', import.meta.url)
const FOOTBALL_DATA = 'https://www.football-data.co.uk/mmz4281/2526/E0.csv'

function parseCSV(text) {
  const rows = []
  let field = '', row = [], quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); if (row.some(Boolean)) rows.push(row) }
  if (!rows.length) return []
  const headers = rows[0].map((v) => v.trim().replace(/^\uFEFF/, ''))
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function cell(value) {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCSV(headers, rows) {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n') + '\n'
}

function dateOnly(value) {
  if (!value) return ''
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!uk) return ''
  const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3]
  return `${year}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`
}

const aliases = new Map([
  ['manchester united', 'man united'], ['man utd', 'man united'],
  ['manchester city', 'man city'],
  ['nottingham forest', 'nottm forest'], ["nott'm forest", 'nottm forest'],
  ['tottenham hotspur', 'tottenham'], ['spurs', 'tottenham'],
  ['afc bournemouth', 'bournemouth'],
  ['brighton & hove albion', 'brighton'],
  ['newcastle united', 'newcastle'],
  ['leeds united', 'leeds'],
  ['west ham united', 'west ham'],
  ['wolverhampton wanderers', 'wolves'],
])

function teamKey(value) {
  const raw = String(value ?? '').toLowerCase().replace(/[.’']/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return aliases.get(raw) ?? raw
}

const response = await fetch(FOOTBALL_DATA, { headers: { 'user-agent': 'footballcards-venue-enrichment/1.0' } })
if (!response.ok) throw new Error(`Could not fetch Football-Data E0: ${response.status}`)

const schedule = parseCSV(await response.text())
const matches = new Map()
for (const m of schedule) {
  const date = dateOnly(m.Date)
  if (!date || !m.HomeTeam || !m.AwayTeam) continue
  const home = teamKey(m.HomeTeam)
  const away = teamKey(m.AwayTeam)
  matches.set(`${date}|${home}|${away}`, { home, away })
  matches.set(`${date}|${away}|${home}`, { home, away })
}

const h2h = parseCSV(await fs.readFile(H2H_PATH, 'utf8'))
let enriched = 0
let unresolved = 0

for (const row of h2h) {
  if (row.venue) continue
  const team = teamKey(row.team)
  const opponent = teamKey(row.opponent)
  const match = matches.get(`${dateOnly(row.match_date)}|${team}|${opponent}`)
  if (!match) { unresolved++; continue }
  row.venue = team === match.home ? 'home' : team === match.away ? 'away' : ''
  if (row.venue) enriched++
}

const headers = [
  'player_name', 'team', 'opponent', 'match_date', 'competition', 'venue',
  'minutes', 'fouls_committed', 'fouls_drawn', 'yellow_card', 'red_card', 'external_player_id',
]
await fs.writeFile(H2H_PATH, toCSV(headers, h2h))
console.log(JSON.stringify({ rows: h2h.length, enriched, unresolved }, null, 2))
