/**
 * The product's one money format: whole rands, no space after the R, en-ZA grouping ("R5 268").
 *
 * Today had its own copy of this while Planning, its day detail, the chart and Factors each wrote
 * `R ${n.toLocaleString('en-ZA')}`, so one day read "R5 169" on Today and "R 5 168,78" on Planning beside
 * an axis tick of a third shape (FB-015, UAT-05-S02). Cents on a forecast also claimed a precision it never had.
 * A missing or non-finite amount reads as a dash: null is not zero takings.
 */
const isAmount = (amount: number | null | undefined): amount is number => Number.isFinite(amount)

export function formatZAR(amount: number | null | undefined): string {
  if (!isAmount(amount)) return '—'
  const rands = Math.round(amount)
  const digits = Math.abs(rands).toLocaleString('en-ZA', { maximumFractionDigits: 0 })
  return rands < 0 ? `-R${digits}` : `R${digits}`
}

/** A chart's axis below ten thousand reads like any other amount; from there it compacts to "R20k". */
const COMPACT_FROM = 10000

export function formatZARCompact(amount: number | null | undefined): string {
  if (!isAmount(amount)) return '—'
  if (Math.abs(amount) < COMPACT_FROM) return formatZAR(amount)
  const thousands = `R${(Math.abs(amount) / 1000).toFixed(0)}k`
  return amount < 0 ? `-${thousands}` : thousands
}
