const LONDON_TZ = "Europe/London"

/** Today's date as yyyy-mm-dd in the Europe/London timezone. */
export function londonToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
  return parts // en-CA formats as yyyy-mm-dd
}

/** Format an ISO kickoff string as a London kick-off time, e.g. "15:00". */
export function londonKickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

/** Format an ISO string as a London time-of-day for "Last updated" labels. */
export function londonTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

/** Human friendly date like "16 Aug 2026". */
export function formatMatchDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d)
}
