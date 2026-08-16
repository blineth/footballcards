import type { Fixture, LineupsResponse } from "@/lib/types"

/**
 * The provider abstraction. Any football-data source (API-Football,
 * football-data.org, a mock, etc.) implements this interface so the rest of the
 * app never talks to a specific vendor directly.
 */
export interface FootballDataProvider {
  readonly name: string
  /** Whether the provider has the credentials it needs to serve live data. */
  isConfigured(): boolean
  /**
   * Fixtures for a specific yyyy-mm-dd date (Europe/London), for both the
   * Premier League and the Championship.
   */
  getFixturesForDate(date: string): Promise<Fixture[]>
  /** A single fixture by id. */
  getFixture(matchId: string): Promise<Fixture | null>
  /** Lineups for a fixture. */
  getLineups(matchId: string): Promise<Pick<LineupsResponse, "status" | "home" | "away">>
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`${providerName} is not configured`)
    this.name = "ProviderNotConfiguredError"
  }
}
