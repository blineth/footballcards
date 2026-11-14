import { NextResponse } from "next/server"
import { db, isDatabaseConfigured } from "@/lib/db"
import { ensureResearchSchema } from "@/lib/db/ensure-research-schema"
import { playerH2H } from "@/lib/db/schema"

export const dynamic = "force-dynamic"
export const revalidate = 0

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.2"

function norm(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(afc|fc)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}
function teamMatch(a?: string | null, b?: string | null) {
  const na = norm(a), nb = norm(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}
function n(value: unknown) {
  const v = Number(value ?? 0)
  return Number.isFinite(v) ? v : 0
}
function stat(row: any, name: string) {
  const found = (row?.stats ?? []).find((s: any) => s?.name === name)
  return n(found?.value ?? found?.displayValue)
}
async function espn(path: string) {
  const response = await fetch(`${ESPN_BASE}/${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`ESPN ${response.status} for ${path}`)
  return response.json()
}

async function currentTeams() {
  const data = await espn("teams")
  return (data?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x: any) => x?.team).filter(Boolean)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const home = url.searchParams.get("home") ?? ""
  const away = url.searchParams.get("away") ?? ""
  if (!home || !away) return NextResponse.json({ ok: false, matches: [], error: "home and away are required" }, { status: 400 })

  try {
    const teams = await currentTeams()
    const homeTeam = teams.find((t: any) => teamMatch(t?.displayName ?? t?.name, home))
    const awayTeam = teams.find((t: any) => teamMatch(t?.displayName ?? t?.name, away))
    if (!homeTeam?.id || !awayTeam?.id) {
      return NextResponse.json({ ok: false, matches: [], error: "Could not resolve both teams in ESPN Championship directory" }, { status: 404 })
    }

    // ESPN's team schedule retains the full 2025/26 event list when season=2025.
    const schedule = await espn(`teams/${homeTeam.id}/schedule?season=2025`)
    const events = (schedule?.events ?? [])
      .filter((event: any) => {
        const displaySeason = String(event?.season?.displayName ?? event?.season?.year ?? "")
        const competition = event?.competitions?.[0]
        const opponents = competition?.competitors ?? []
        const hasAway = opponents.some((c: any) => String(c?.team?.id ?? "") === String(awayTeam.id) || teamMatch(c?.team?.displayName, away))
        return hasAway && (displaySeason.includes("2025-26") || String(event?.date ?? "").slice(0, 10) >= "2025-08-01" && String(event?.date ?? "").slice(0, 10) <= "2026-06-30")
      })
      .sort((a: any, b: any) => String(b?.date ?? "").localeCompare(String(a?.date ?? "")))
      .slice(0, 6)

    const matches = await Promise.all(events.map(async (event: any) => {
      const id = String(event?.id ?? event?.competitions?.[0]?.id ?? "")
      const summary = await espn(`summary?event=${id}`)
      const comp = event?.competitions?.[0] ?? {}
      const competitors = comp?.competitors ?? []
      const homeRow = competitors.find((c: any) => c?.homeAway === "home")
      const awayRow = competitors.find((c: any) => c?.homeAway === "away")
      const fixtureHome = String(homeRow?.team?.displayName ?? "")
      const fixtureAway = String(awayRow?.team?.displayName ?? "")
      const players: any[] = []

      for (const section of summary?.rosters ?? []) {
        const team = String(section?.team?.displayName ?? section?.team?.name ?? "")
        const opponent = teamMatch(team, fixtureHome) ? fixtureAway : fixtureHome
        for (const row of section?.roster ?? []) {
          const name = String(row?.athlete?.displayName ?? row?.athlete?.fullName ?? "").trim()
          if (!name) continue
          const goals = stat(row, "totalGoals")
          const assists = stat(row, "goalAssists")
          const shots = stat(row, "totalShots")
          const shotsOnTarget = stat(row, "shotsOnTarget")
          const foulsCommitted = stat(row, "foulsCommitted")
          const foulsDrawn = stat(row, "foulsSuffered")
          const yellowCards = stat(row, "yellowCards")
          const redCards = stat(row, "redCards")
          players.push({
            name,
            team,
            opponent,
            position: row?.position?.abbreviation ?? row?.position?.displayName ?? row?.athlete?.position?.abbreviation ?? null,
            starter: row?.starter === true,
            minutes: null,
            goals,
            assists,
            shots,
            shotsOnTarget,
            foulsCommitted,
            foulsDrawn,
            yellowCard: yellowCards > 0,
            yellowCards,
            redCard: redCards > 0,
            redCards,
            externalPlayerId: row?.athlete?.id != null ? String(row.athlete.id) : null,
          })
        }
      }

      const official = summary?.gameInfo?.officials?.[0]?.displayName ?? summary?.gameInfo?.officials?.[0]?.fullName ?? null
      return {
        id,
        date: String(event?.date ?? "").slice(0, 10),
        competition: "Championship",
        home: fixtureHome,
        away: fixtureAway,
        homeGoals: n(homeRow?.score?.value ?? homeRow?.score?.displayValue),
        awayGoals: n(awayRow?.score?.value ?? awayRow?.score?.displayValue),
        referee: official,
        players,
      }
    }))

    if (isDatabaseConfigured && matches.length) {
      await ensureResearchSchema()
      const inserts: Array<typeof playerH2H.$inferInsert> = []
      for (const match of matches) {
        for (const p of match.players) {
          inserts.push({
            playerName: p.name,
            team: p.team,
            opponent: p.opponent,
            matchDate: match.date,
            competition: "Championship",
            venue: teamMatch(p.team, match.home) ? "Home" : "Away",
            position: p.position,
            starter: p.starter,
            minutes: p.minutes,
            foulsCommitted: p.foulsCommitted,
            foulsDrawn: p.foulsDrawn,
            shots: p.shots,
            shotsOnTarget: p.shotsOnTarget,
            yellowCard: p.yellowCard,
            redCard: p.redCard,
            goals: p.goals,
            assists: p.assists,
            externalPlayerId: p.externalPlayerId,
          })
        }
      }
      for (let i = 0; i < inserts.length; i += 400) {
        await db.insert(playerH2H).values(inserts.slice(i, i + 400)).onConflictDoNothing()
      }
    }

    return NextResponse.json({
      ok: true,
      source: "ESPN 2025/26 historical Championship match summaries",
      crossCheck: "FBref 2025/26 Championship schedule/match reports",
      period: "2025/26",
      home,
      away,
      matches,
      matchCount: matches.length,
      loadedAt: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, matches: [], error: error instanceof Error ? error.message : "H2H lookup failed" }, { status: 502 })
  }
}
