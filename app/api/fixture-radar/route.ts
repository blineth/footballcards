import { getRefereeByName } from "@/lib/historical"
import { NextResponse } from "next/server"
import { GET as espnGET } from "../fixture-radar-espn/route"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const response = await espnGET(request)
  if (!response.ok) return response

  try {
    const data = await response.json()
    const refereeName = data?.referee?.name

    if (refereeName) {
      const historical = await getRefereeByName(refereeName)
      if (historical) {
        data.referee = {
          ...data.referee,
          matchedHistoricalName: historical.refereeName,
          yellowsPerGame: historical.yellowsPerGame != null ? Number(historical.yellowsPerGame) : data.referee.yellowsPerGame ?? null,
          foulsPerGame: historical.foulsPerGame != null ? Number(historical.foulsPerGame) : data.referee.foulsPerGame ?? null,
          matches: historical.matchesRefereed ?? data.referee.matches ?? null,
          historicalCompetition: historical.competition ?? data.referee.historicalCompetition ?? null,
        }
      }
    }

    return NextResponse.json(data)
  } catch {
    return response
  }
}
