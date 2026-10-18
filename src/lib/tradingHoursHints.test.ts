import { describe, it, expect } from 'vitest'
import { tradingHourHints, weekdaysWithSales, tradingHoursSalesHint, UNSAVED_TRADING_HOURS_HINT } from './tradingHoursHints'
import type { HeatmapCell, TradingHoursEntry } from '@/types'

/**
 * The real payload shape: `transactions` is an AVERAGE per observed day and
 * `totalTransactions` is the count. The fixture keeps them different on
 * purpose, so reading the wrong one shows up here rather than in production.
 */
const cell = (dayOfWeek: number, hour: number, total: number, observedDays = 8): HeatmapCell => ({
  dayOfWeek,
  hour,
  revenue: parseFloat(((total * 42) / observedDays).toFixed(2)),
  transactions: parseFloat((total / observedDays).toFixed(1)),
  totalRevenue: total * 42,
  totalTransactions: total,
  observedDays,
})

const day = (dayOfWeek: number, isOpen: boolean): TradingHoursEntry => ({
  dayOfWeek,
  isOpen,
  openTime: isOpen ? '07:00' : '',
  closeTime: isOpen ? '17:00' : '',
})

describe('weekdaysWithSales', () => {
  it('sums every hour of a weekday, not just the busiest', () => {
    const counts = weekdaysWithSales([cell(0, 9, 12), cell(0, 10, 8), cell(1, 9, 30)])
    expect(counts.get(0)).toBe(20)
    expect(counts.get(1)).toBe(30)
  })

  it('counts sales, not the per-day average', () => {
    // `transactions` is totalTransactions / observedDays and comes back
    // fractional. Summing it told an owner their cafe had "51,2 sales" on a
    // Sunday, which is not a thing that can happen.
    const counts = weekdaysWithSales([cell(0, 9, 433, 8)])
    expect(counts.get(0)).toBe(433)
    expect(Number.isInteger(counts.get(0))).toBe(true)
  })

  it('stays silent about a cell with no count, rather than guessing one', () => {
    const counts = weekdaysWithSales([
      { dayOfWeek: 0, hour: 9, revenue: 100, transactions: 51.2 } as HeatmapCell,
    ])
    expect(counts.has(0)).toBe(false)
  })

  it('ignores a weekday whose cells are all zero', () => {
    // An empty hour is a row in the payload, not an absence. Counting rows
    // rather than transactions would flag every day of the week.
    const counts = weekdaysWithSales([cell(3, 9, 0), cell(3, 10, 0)])
    expect(counts.has(3)).toBe(false)
  })
})

describe('tradingHourHints', () => {
  it('flags a day marked closed that has recorded sales', () => {
    const hints = tradingHourHints(
      [day(0, false), day(1, true)],
      weekdaysWithSales([cell(0, 9, 12), cell(0, 10, 8), cell(1, 9, 30)])
    )

    expect(hints).toEqual([{ dayOfWeek: 0, kind: 'closed_but_sales', salesCount: 20 }])
  })

  it('says nothing about a closed day the cafe genuinely does not trade', () => {
    expect(tradingHourHints([day(0, false)], weekdaysWithSales([cell(1, 9, 30)]))).toEqual([])
  })

  it('says nothing about an open day, however quiet', () => {
    expect(tradingHourHints([day(2, true)], weekdaysWithSales([cell(2, 9, 1)]))).toEqual([])
  })

  it('returns nothing when there is no sales history to argue with', () => {
    // A cafe that has not uploaded yet must not be told its hours are wrong.
    expect(tradingHourHints([day(0, false), day(1, false)], weekdaysWithSales([]))).toEqual([])
  })

  it('flags every contradicted day, in weekday order', () => {
    const hints = tradingHourHints(
      [day(3, false), day(0, false)],
      weekdaysWithSales([cell(0, 9, 5), cell(3, 14, 11)])
    )

    expect(hints.map((h) => h.dayOfWeek)).toEqual([0, 3])
  })

  describe('saved and unsaved trading-hours copy', () => {
    it('explains an owner-saved closure and an inferred open day differently', () => {
      expect(tradingHoursSalesHint(200, true)).toBe('Your sales show trading on this day (200 sales in the last 8 weeks). While it is marked closed, this day forecasts zero.')
      expect(tradingHoursSalesHint(200, false)).toBe('Your sales show trading on this day (200 sales in the last 8 weeks). Your hours are not saved yet, so Planning treats this day as open. Save your trading hours to confirm.')
      expect(tradingHoursSalesHint(200)).toBe(tradingHoursSalesHint(200, true))
    })
    it('keeps suggested hours visibly described as unsaved', () => {
      expect(UNSAVED_TRADING_HOURS_HINT).toBe('These are suggested hours, not saved yet. Until you save them, Planning treats any day with sales as open.')
    })
  })

})
