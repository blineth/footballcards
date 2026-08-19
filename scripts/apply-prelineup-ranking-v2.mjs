import fs from "node:fs"

const path = "app/page.tsx"
let source = fs.readFileSync(path, "utf8")

const oldScoring = `function researchScore(candidate: Candidate, detail?: PlayerDetail) {
  const h2h = getH2HSummary(detail)
  return Math.min(99, Math.round(candidate.cards90 * 60 + candidate.fouls90 * 8 + candidate.yellows * 2 + Math.min(h2h.foulsCommitted, 8) * 2 + h2h.yellowCards * 12))
}

function scoreBand(score: number) {
  if (score >= 75) return { label: "STRONG", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
  if (score >= 60) return { label: "GOOD", cls: "bg-amber-50 text-amber-700 border-amber-200" }
  return { label: "WATCH", cls: "bg-slate-50 text-slate-700 border-slate-200" }
}`

const newScoring = `function starterProfile(candidate: Candidate, detail?: PlayerDetail) {
  const apps = detail?.baseline?.appearances ?? 0
  const starts = detail?.baseline?.starts ?? 0
  const minutes = detail?.baseline?.minutes ?? 0
  const startRate = apps > 0 ? starts / apps : 0
  const sample = Math.min(1, minutes / 1800)
  const transferred = candidate.currentTeamDb !== candidate.dbTeam

  // Previous-season starts are a pre-lineup proxy, not a claimed team-sheet probability.
  // New-club players are deliberately capped because their role has changed.
  let likelihood = (0.25 + startRate * 0.75) * (0.55 + sample * 0.45)
  if (transferred) likelihood = Math.min(likelihood, 0.72)

  if (minutes < 600) return { likelihood, label: "LIMITED SAMPLE", cls: "bg-slate-100 text-slate-700 border-slate-300" }
  if (transferred) return { likelihood, label: "NEW CLUB · ROLE TBC", cls: "bg-violet-50 text-violet-700 border-violet-200" }
  if (likelihood >= 0.7) return { likelihood, label: "LIKELY STARTER", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
  if (likelihood >= 0.5) return { likelihood, label: "START CHANCE", cls: "bg-blue-50 text-blue-700 border-blue-200" }
  return { likelihood, label: "ROTATION RISK", cls: "bg-slate-100 text-slate-700 border-slate-300" }
}

function researchScore(candidate: Candidate, detail?: PlayerDetail) {
  const h2h = getH2HSummary(detail)
  const minutes = detail?.baseline?.minutes ?? 0
  const sampleReliability = Math.min(1, minutes / 1800)
  const starter = starterProfile(candidate, detail)

  // Per-90 rates are shrunk when the sample is small so a short hot spell cannot dominate.
  const adjustedCards90 = candidate.cards90 * (0.35 + sampleReliability * 0.65)
  const cardTendency = Math.min(1, adjustedCards90 / 0.5)
  const seasonCards = Math.min(1, candidate.yellows / 10)
  const foulTendency = Math.min(1, candidate.fouls90 / 2.5)
  const h2hEvidence = Math.min(1, h2h.yellowCards * 0.5 + Math.min(h2h.foulsCommitted, 8) / 16)

  const score =
    starter.likelihood * 30 +
    cardTendency * 18 +
    seasonCards * 12 +
    foulTendency * 14 +
    h2hEvidence * 18 +
    sampleReliability * 8

  return Math.min(99, Math.round(score))
}

function scoreBand(score: number) {
  if (score >= 72) return { label: "STRONG EVIDENCE", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
  if (score >= 56) return { label: "GOOD EVIDENCE", cls: "bg-amber-50 text-amber-700 border-amber-200" }
  return { label: "WATCH", cls: "bg-slate-50 text-slate-700 border-slate-200" }
}

function rankedCandidates(fixture: Fixture, evidence: Record<string, PlayerDetail>) {
  return [...fixture.candidates].sort((a, b) => {
    const aDetail = evidence[candidateKey(fixture, a)]
    const bDetail = evidence[candidateKey(fixture, b)]
    return researchScore(b, bDetail) - researchScore(a, aDetail)
  })
}`

if (!source.includes(oldScoring)) throw new Error("Scoring block not found")
source = source.replace(oldScoring, newScoring)

source = source.replace(
  `Tap a match to view its top five yellow-card potentials. Each player can then be opened for their full baseline and H2H evidence.`,
  `Before lineups, the top five balances card/foul evidence with previous-season starting frequency and minutes. Small samples are penalised. Once lineups are confirmed, confirmed starters should take priority.`
)

source = source.replace(
  `{fixture.candidates.slice(0, 5).map((candidate, index) => {`,
  `{rankedCandidates(fixture, evidence).slice(0, 5).map((candidate, index) => {`
)

source = source.replace(
  `const band = scoreBand(researchScore(candidate, detail))\n                      const transferred`,
  `const band = scoreBand(researchScore(candidate, detail))\n                      const starter = starterProfile(candidate, detail)\n                      const transferred`
)

source = source.replace(
  `<div className="flex flex-wrap items-center gap-2"><p className="font-bold">{candidate.name}</p><span className={\`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold \${band.cls}\`}>{band.label}</span></div>`,
  `<div className="flex flex-wrap items-center gap-2"><p className="font-bold">{candidate.name}</p><span className={\`rounded-full border px-2 py-0.5 text-[0.62rem] font-bold \${band.cls}\`}>{band.label}</span><span className={\`rounded-full border px-2 py-0.5 text-[0.58rem] font-bold \${starter.cls}\`}>{starter.label}</span></div>`
)

source = source.replace(
  `<span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">Lineups TBC</span>`,
  `<span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">PRE-LINEUP · START-RISK ADJUSTED</span>`
)

fs.writeFileSync(path, source)
console.log("Applied pre-lineup ranking v2")
