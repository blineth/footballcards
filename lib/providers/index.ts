import { ApiFootballProvider } from "./api-football"
import type { FootballDataProvider } from "./types"

export type { FootballDataProvider } from "./types"
export { ProviderNotConfiguredError } from "./types"

/**
 * Returns the active football-data provider. Swap the implementation here to
 * change vendors (e.g. football-data.org) without touching API routes or UI.
 *
 * The default is API-Football, driven by the API_FOOTBALL_KEY env var.
 */
export function getProvider(): FootballDataProvider {
  return new ApiFootballProvider()
}

/** Convenience: is a live data source configured right now? */
export function isProviderConfigured(): boolean {
  return getProvider().isConfigured()
}
