const pad2 = (value: number) => String(value).padStart(2, '0')

/** Billing dates follow the platform's SAST calendar, like the server. */
export function formatBillingDate(value?: string | null, short = false): string {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: short ? 'short' : 'long', year: short ? undefined : 'numeric', timeZone: 'Africa/Johannesburg' })
}

/**
 * Formats a calendar date without converting it through UTC.
 * Use this for API fields whose contract is YYYY-MM-DD rather than an instant.
 */
export function toLocalDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12)
}

/**
 * Parses YYYY-MM-DD at local noon so timezone offsets and DST boundaries cannot
 * move the value onto a neighbouring calendar day.
 */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return new Date(value)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
}

/**
 * Returns the explicit cafe-local API calendar key when present. The fallback
 * supports legacy responses and date-only test fixtures.
 */
export function forecastDateKey(value: { date: string; dateKey?: string }): string {
  return value.dateKey || value.date
}

export function getLocalMonthBounds(date: Date): { startDate: string; endDate: string } {
  return {
    startDate: toLocalDateOnly(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
    endDate: toLocalDateOnly(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)),
  }
}
