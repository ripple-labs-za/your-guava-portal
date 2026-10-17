import { describe, expect, it } from 'vitest'
import { formatDayKey, queriedWindowFrom, trendCaptionFrom } from './analyticsWindow'

describe('analytics window captions', () => {
  it.each([
    ['no_data_in_window', 'No completed days with sales in this range'],
    ['window_not_complete', 'Today is still in progress, so nothing is complete to compare yet'],
    ['insufficient_history', 'Not enough history before this range to compare'],
    ['no_previous_revenue', 'Sales in the comparison period were zero or negative'],
  ] as const)('explains %s', (trendReason, text) => {
    expect(trendCaptionFrom({ trendReason })).toBe(text)
  })
  it('keeps each date together and explains an unfinished today or stale upload', () => {
    const effectiveWindow = { startDate: '2026-07-06', endDate: '2026-08-03', days: 29 }
    const comparisonWindow = { startDate: '2026-06-07', endDate: '2026-07-05', days: 29 }
    expect(trendCaptionFrom({ effectiveWindow: { ...effectiveWindow, endReason: 'today_incomplete' }, comparisonWindow }))
      .toBe('6\u00a0Jul – 3\u00a0Aug vs 7\u00a0Jun – 5\u00a0Jul · today left out')
    expect(trendCaptionFrom({ effectiveWindow: { ...effectiveWindow, endReason: 'data_ends' }, comparisonWindow }))
      .toBe('6\u00a0Jul – 3\u00a0Aug vs 7\u00a0Jun – 5\u00a0Jul · your data ends 3\u00a0Aug')
  })
  it.each(['bad', '2026-13-01', '2026-02-30', '', '2026-1-01'])('rejects malformed day %s', (key) => {
    expect(formatDayKey(key)).toBe('')
  })
  it('handles legacy metadata and absent windows', () => {
    expect(trendCaptionFrom()).toBe('')
    expect(queriedWindowFrom()).toBeNull()
    expect(queriedWindowFrom({ effectiveStartDay: '2026-07-06', effectiveEndDay: '2026-08-04', effectiveDays: 30, defaultedStartDate: true }))
      .toEqual({ startDay: '2026-07-06', endDay: '2026-08-04', days: 30, defaulted: true })
  })
})
