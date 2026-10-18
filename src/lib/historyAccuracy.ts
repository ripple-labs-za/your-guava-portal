import type { ForecastHistoryAccuracySummary } from '@/types'

export interface AccuracyPayload {
  avgAccuracy: number | null
  avgItemAccuracy?: number | null
  itemAccuracyDays?: number
  excludedInsufficientDays?: number
  basisNote?: string | null
  /** Which set avgAccuracy was computed over. See DECISIONS D-004. */
  basis?: 'live' | 'backtest' | 'none'
  liveCount?: number
  backtestCount?: number
  liveFrom?: string | null
  forecasts: {
    date: string
    accuracy: number
    totalPredictedRevenue: number
    actualRevenue?: number | null
    actualTransactionCount?: number | null
    actualsUpdatedAt?: string | null
  }[]
}

export const NOT_COUNTED_REASON =
  'This day was still building history, so it is not in the accuracy figures.'

export function formatAccuracyPercent(value: number | null | undefined, showSign = false) {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${showSign && value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

export function excludedNote(summary?: ForecastHistoryAccuracySummary) {
  const n = summary?.excludedRowCount ?? 0
  return n > 0 ? ` · ${n} building-history day${n === 1 ? '' : 's'} not counted` : ''
}

export function historyAccuracyDetail(
  summary: ForecastHistoryAccuracySummary | undefined,
  basis: 'live' | 'backtest',
) {
  const n = summary?.rowCount ?? 0
  const description = basis === 'live' ? 'live' : 'retrospective'
  const empty = basis === 'live'
    ? 'No completed live forecasts in this period'
    : (summary?.excludedRowCount ?? 0) > 0
      ? 'No counted retrospective backtests in this period'
      : 'No retrospective backtests in this period'
  const detail = n > 0
    ? `Typical day across ${n} ${description} day${n === 1 ? '' : 's'} · ${formatAccuracyPercent(summary?.overallRevenueAccuracy)} on period totals`
    : empty
  const item = n > 0 && Number.isFinite(summary?.avgItemAccuracy)
    ? ` · Per item: ${formatAccuracyPercent(summary?.avgItemAccuracy)}`
    : ''
  return `${detail}${item}${excludedNote(summary)}`
}
