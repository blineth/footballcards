from pathlib import Path

path = Path('app/page.tsx')
text = path.read_text(encoding='utf-8')

text = text.replace(
'''type Candidate = {
  name: string
  dbName: string
  team: string
  currentTeamDb: string
  dbTeam: string
  yellows: number
  cards90: number
  fouls90: number
}''',
'''type Candidate = {
  name: string
  dbName: string
  team: string
  currentTeamDb: string
  dbTeam: string
  yellows: number
  cards90: number
  fouls90: number
  confirmedStarter?: boolean
}''')

text = text.replace(
'''  candidates: Candidate[]
  noLeagueH2HReason?: string
}''',
'''  candidates: Candidate[]
  lineupsConfirmed?: boolean
  noLeagueH2HReason?: string
}''')

marker = '''function VenueBadge({ venue }: { venue?: string | null }) {'''
insert = '''function LineupStatusPill({ confirmed }: { confirmed?: boolean }) {
  return confirmed ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-emerald-800">
      <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Lineups confirmed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[0.62rem] font-extrabold uppercase tracking-wide text-red-800">
      <span className="size-1.5 rounded-full bg-red-500" aria-hidden="true" />
      Lineups not confirmed
    </span>
  )
}

'''
if 'function LineupStatusPill' not in text:
    text = text.replace(marker, insert + marker)

text = text.replace(
'''                    <p className="mt-1 text-xs font-semibold text-yellow-500">{fixtureOpen ? "Hide yellow card potentials" : "View yellow card potentials"}</p>''',
'''                    <p className="mt-1 text-xs font-semibold text-yellow-500">{fixtureOpen ? "Hide yellow card potentials" : "View yellow card potentials"}</p>
                    <div className="mt-2"><LineupStatusPill confirmed={fixture.lineupsConfirmed} /></div>''')

text = text.replace(
'''                  <div className="mb-2 flex items-center justify-between gap-2 px-1"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top 5 yellow card candidates</p><span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">Lineups TBC</span></div>''',
'''                  <div className="mb-2 flex items-center justify-between gap-2 px-1"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top 5 yellow card candidates</p><p className="mt-0.5 text-[0.65rem] font-semibold text-muted-foreground">{fixture.lineupsConfirmed ? "Confirmed XI · starters only" : "Pre-lineup · start-risk adjusted"}</p></div><LineupStatusPill confirmed={fixture.lineupsConfirmed} /></div>''')

text = text.replace(
'''                    {fixture.candidates.slice(0, 5).map((candidate, index) => {''',
'''                    {(fixture.lineupsConfirmed ? fixture.candidates.filter((candidate) => candidate.confirmedStarter === true) : fixture.candidates).slice(0, 5).map((candidate, index) => {''')

path.write_text(text, encoding='utf-8')
print('lineup status UI applied')
