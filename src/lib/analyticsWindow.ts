export type TrendReason = 'no_data_in_window' | 'window_not_complete' | 'insufficient_history' | 'no_previous_revenue'

export interface DayWindow {
  startDate: string
  endDate: string
  days: number
  endReason?: 'requested' | 'today_incomplete' | 'data_ends'
  revenue?: number | null
}

export interface RangeMeta {
  effectiveStartDay?: string
  effectiveEndDay?: string
  effectiveDays?: number
  defaultedStartDate?: boolean
  timezone?: string
}

export interface TrendMeta extends RangeMeta {
  effectiveWindow?: DayWindow | null
  comparisonWindow?: DayWindow | null
  trendReason?: TrendReason | null
}

export interface QueriedWindow {
  startDay: string
  endDay: string
  days: number
  defaulted: boolean
  timezone?: string
}

export function openDaysCaption(days?: number) {
  return days ? `across ${days} open ${days === 1 ? 'day' : 'days'}` : undefined
}

export const TREND_REASON_COPY: Record<TrendReason, string> = {
  no_data_in_window: 'No completed days with sales in this range',
  window_not_complete: 'Today is still in progress, so nothing is complete to compare yet',
  insufficient_history: 'Not enough history before this range to compare',
  no_previous_revenue: 'Sales in the comparison period were zero or negative',
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Built from the key, not toLocaleDateString('en-ZA'): ICU 78 prints "06 Sept", older ICU "6 Sep".
export function formatDayKey(dayKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return ''
  const parsed = new Date(`${dayKey}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dayKey) return ''
  const [, month, day] = dayKey.split('-').map(Number)
  return `${day}\u00a0${MONTH_ABBR[month - 1]}`
}

export function formatDayRange(window: { startDate: string; endDate: string }) {
  return `${formatDayKey(window.startDate)} – ${formatDayKey(window.endDate)}`
}

export function trendCaptionFrom(meta?: TrendMeta): string {
  if (!meta) return ''
  if (meta.trendReason) return TREND_REASON_COPY[meta.trendReason] ?? ''
  if (!meta.effectiveWindow || !meta.comparisonWindow) return ''
  const compared = `${formatDayRange(meta.effectiveWindow)} vs ${formatDayRange(meta.comparisonWindow)}`
  return meta.effectiveWindow.endReason === 'data_ends'
    ? `${compared} · your data ends ${formatDayKey(meta.effectiveWindow.endDate)}`
    : meta.effectiveWindow.endReason === 'today_incomplete' ? `${compared} · today left out` : compared
}

export function queriedWindowFrom(meta?: RangeMeta): QueriedWindow | null {
  if (!meta?.effectiveStartDay || !meta.effectiveEndDay || !meta.effectiveDays) return null
  return {
    startDay: meta.effectiveStartDay,
    endDay: meta.effectiveEndDay,
    days: meta.effectiveDays,
    defaulted: Boolean(meta.defaultedStartDate),
    ...(meta.timezone ? { timezone: meta.timezone } : {}),
  }
}
