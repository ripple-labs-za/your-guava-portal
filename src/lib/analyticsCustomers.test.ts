import { describe, it, expect } from 'vitest'
import { analyticsCustomersFrom } from './analyticsCustomers'
import { openDaysCaption } from './analyticsWindow'

describe('customer analytics presentation', () => {
  const base = { avgTransactionValue: 50, avgItemsPerTransaction: 1, tippingRate: 0, avgTip: 0, cashVsCardRatio: null }
  it('explains a refund-only range without claiming absent payment columns', () => {
    const result = analyticsCustomersFrom({ ...base, transactions: 0, refunds: { count: 1, value: 50 } })
    expect(result.noSales).toBe(true)
    expect(result.emptyPaymentMessage).toBe('No sales in this range, so there is nothing to split')
    expect(result.refundCaption).toMatch(/1 refund/)
  })
  it('keeps legacy shapes free of optional new claims', () => {
    const result = analyticsCustomersFrom({ ...base, cashVsCardRatio: { cash: 25, card: 75 } })
    expect(result.donutLabel).not.toMatch(/other/)
    expect(result.refundCaption).toBeUndefined()
    expect(result.coverageNote).toBeUndefined()
    expect(openDaysCaption()).toBeUndefined()
  })
  it('names other shares and the sales excluded for unknown tender', () => {
    const result = analyticsCustomersFrom({ ...base, cashVsCardRatio: { cash: 20, card: 50, other: 30 }, paymentMethodCoverage: { known: 7, unknown: 2 } })
    expect(result.donutLabel).toMatch(/other 30.0 percent/)
    expect(result.donutLabel).toMatch(/2 sales/)
    expect(result.coverageNote).toMatch(/2 sales have/)
  })
  it.each([[1, 'across 1 open day'], [7, 'across 7 open days']] as const)('labels %i open days', (days, caption) => {
    expect(openDaysCaption(days)).toBe(caption)
  })
})
