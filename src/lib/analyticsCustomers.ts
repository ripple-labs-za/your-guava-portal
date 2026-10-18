import type { CustomerInsights } from '@/types'

export function analyticsCustomersFrom(data?: CustomerInsights | null) {
  const split = data?.cashVsCardRatio
  const otherShare = split?.other
  const refunds = data?.refunds
  const unknown = data?.paymentMethodCoverage?.unknown ?? 0
  const noSales = data?.transactions === 0
  const coverageNote = unknown > 0
    ? `${unknown} ${unknown === 1 ? 'sale has' : 'sales have'} no payment method and ${unknown === 1 ? 'is' : 'are'} left out of this split.`
    : undefined
  const refundCaption = refunds && refunds.count > 0
    ? `${refunds.count} ${refunds.count === 1 ? 'refund' : 'refunds'} (R${refunds.value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) not counted as ${refunds.count === 1 ? 'a sale' : 'sales'}`
    : undefined
  const shares = split ? [
    { name: 'Card', value: split.card }, { name: 'Cash', value: split.cash },
    ...(otherShare !== undefined && otherShare > 0 ? [{ name: 'Other', value: otherShare }] : []),
  ] : []
  const donutLabel = split
    ? `Payment method split: card ${split.card.toFixed(1)} percent, cash ${split.cash.toFixed(1)} percent` +
      (otherShare !== undefined ? `, other ${otherShare.toFixed(1)} percent` : '') +
      (coverageNote ? `. ${coverageNote}` : '')
    : ''
  return {
    noSales, otherShare, refundCaption, shares, donutLabel, coverageNote,
    emptyPaymentMessage: noSales
      ? 'No sales in this range, so there is nothing to split'
      : 'Your import does not include payment methods, so cash and card cannot be split.',
  }
}
