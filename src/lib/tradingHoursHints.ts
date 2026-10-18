import type { HeatmapCell, TradingHoursEntry } from '@/types'

/**
 * Where the cafe's configured trading hours disagree with its own sales.
 *
 * Nothing checked these two against each other, and they drift silently: a
 * weekday left marked closed still forecasts zero however many months of sales
 * exist for it, and the day scores 0% accuracy every week without anyone being
 * told why. The forecast engine spots the same contradiction per day
 * (`describeClosedDay`); this is the settings-side view, so the fix is offered
 * where it is made.
 *
 * Both functions are pure and take what the caller already has: the heatmap
 * Analytics fetches, and the trading hours Settings already holds.
 */

export interface TradingHourHint {
  dayOfWeek: number
  kind: 'closed_but_sales'
  salesCount: number
}

/**
 * Transactions per weekday, summed across every hour. Only weekdays that
 * actually sold something appear — an empty hour is a row in the payload
 * rather than an absence, so counting rows would flag all seven days.
 *
 * Reads `totalTransactions`, never `transactions`. The latter is an average
 * per observed day (`totalTransactions / observedDays`, analytics.controller
 * line 557) and comes back fractional, which put "51,2 sales recorded" in
 * front of an owner. A cell without the total contributes nothing: silence is
 * the right failure for a message that accuses someone's settings of being
 * wrong.
 */
export function weekdaysWithSales(cells: HeatmapCell[]): Map<number, number> {
  const byDay = new Map<number, number>()
  for (const cell of cells) {
    const count = Math.round(cell.totalTransactions ?? 0)
    if (count <= 0) continue
    byDay.set(cell.dayOfWeek, (byDay.get(cell.dayOfWeek) || 0) + count)
  }
  return byDay
}

/**
 * States the contradiction; never resolves it. The owner may have closed a day
 * deliberately and the history may be stale, so this is a hint beside the
 * control, not an automatic change to their settings.
 */
export function tradingHourHints(
  tradingHours: TradingHoursEntry[],
  salesByDay: Map<number, number>
): TradingHourHint[] {
  return tradingHours
    .filter((day) => !day.isOpen && (salesByDay.get(day.dayOfWeek) || 0) > 0)
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      kind: 'closed_but_sales' as const,
      salesCount: salesByDay.get(day.dayOfWeek) || 0,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
}

export const UNSAVED_TRADING_HOURS_HINT =
  'These are suggested hours, not saved yet. Until you save them, Planning treats any day with sales as open.'

/** Shared by the view and edit rows so a suggested closure never reads as saved. */
export function tradingHoursSalesHint(salesCount: number, saved = true): string {
  const consequence = saved
    ? 'While it is marked closed, this day forecasts zero.'
    : 'Your hours are not saved yet, so Planning treats this day as open. Save your trading hours to confirm.'
  return `Your sales show trading on this day (${salesCount.toLocaleString('en-ZA')} sales in the last 8 weeks). ${consequence}`
}
