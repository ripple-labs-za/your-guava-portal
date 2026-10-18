import { describe, expect, it } from 'vitest'
import { excludedNote, formatAccuracyPercent, historyAccuracyDetail } from './historyAccuracy'

describe('history accuracy explanations', () => {
  it('separates measured revenue, item error and excluded days', () => {
    expect(historyAccuracyDetail({
      rowCount: 2, avgDailyRevenueAccuracy: 83.3, overallRevenueAccuracy: 99,
      avgItemAccuracy: 61.6, excludedRowCount: 3,
      totalPredictedRevenue: 100, totalActualRevenue: 100, variance: 0, variancePct: 0,
    }, 'live')).toBe('Typical day across 2 live days · 99.0% on period totals · Per item: 61.6% · 3 building-history days not counted')
  })

  it('distinguishes missing backtests from backtests that were all excluded', () => {
    expect(historyAccuracyDetail(undefined, 'backtest')).toBe('No retrospective backtests in this period')
    expect(historyAccuracyDetail({
      rowCount: 0, excludedRowCount: 1, overallRevenueAccuracy: null,
      avgDailyRevenueAccuracy: null, totalPredictedRevenue: 0, totalActualRevenue: 0,
      variance: 0, variancePct: null,
    }, 'backtest')).toBe('No counted retrospective backtests in this period · 1 building-history day not counted')
  })

  it('keeps absent item figures absent and formats signed percentages safely', () => {
    expect(excludedNote()).toBe('')
    expect(formatAccuracyPercent(null)).toBe('-')
    expect(formatAccuracyPercent(Number.NaN)).toBe('-')
    expect(formatAccuracyPercent(12.25, true)).toBe('+12.3%')
    expect(formatAccuracyPercent(-12.25, true)).toBe('-12.3%')
    expect(historyAccuracyDetail(undefined, 'live')).not.toContain('Per item:')
  })
})
