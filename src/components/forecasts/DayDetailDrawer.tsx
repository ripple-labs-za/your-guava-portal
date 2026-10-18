import { useEffect, useRef } from 'react'
import { X, Coffee, Droplets, UtensilsCrossed, Waves, Sparkles } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ModifierBreakdown } from './ModifierBreakdown'
import { forecastBasisSentence } from './forecastBasis'
import type { Forecast, ForecastItem } from '@/types'
import { forecastDateKey, parseDateOnly } from '@/lib/date'
import { isOccasionalSeller, OCCASIONAL_SELLER_MAX_QTY } from '@/lib/forecastItems'

function getDayLabel(dateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = parseDateOnly(dateStr)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return target.toLocaleDateString('en-ZA', { weekday: 'long' })
}

function fullDate(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Inventory keyword rollup
const COFFEE_KEYWORDS = ['flat white', 'cappuccino', 'long white', 'espresso', 'cortado', 'americano', 'mocha', 'latte', 'pour over']
const COLD_KEYWORDS = ['iced', 'cold brew']
const FOOD_KEYWORDS = ['muffin', 'brownie', 'cookie', 'sandwich', 'cake', 'croissant']
const WATER_KEYWORDS = ['water', 'still', 'sparkling']
const SHOW_INVENTORY_ROLLUP = false

const CONFIDENCE_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

function matchesAny(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase()
  return keywords.some((k) => lower.includes(k))
}

function hasMatchedActuals(forecast: Forecast): boolean {
  return Boolean(
    forecast.actualsUpdatedAt ||
    (forecast.actualTransactionCount != null && forecast.actualTransactionCount > 0) ||
    (forecast.accuracy != null && forecast.items.some((item) => item.actualQty != null))
  )
}

interface InventoryRollup {
  coffee: number
  cold: number
  food: number
  water: number
}

function computeInventory(items: Forecast['items']): InventoryRollup {
  const rollup: InventoryRollup = { coffee: 0, cold: 0, food: 0, water: 0 }
  for (const item of items) {
    const stock = item.suggestedStock
    if (stock == null) continue
    if (matchesAny(item.itemName, COFFEE_KEYWORDS)) rollup.coffee += stock
    else if (matchesAny(item.itemName, COLD_KEYWORDS)) rollup.cold += stock
    else if (matchesAny(item.itemName, FOOD_KEYWORDS)) rollup.food += stock
    else if (matchesAny(item.itemName, WATER_KEYWORDS)) rollup.water += stock
  }
  return rollup
}

interface ReviewRow extends ForecastItem {
  actual: number | null
  /** Units sold against a prediction of zero — a miss with no percentage. */
  missedUnits: number
  pct: number | null
}

/**
 * Ranks the day's items by how badly the forecast was wrong.
 *
 * Predicting 0 and selling 40 is the largest miss the model can make, and it
 * is the one the review screen used to be unable to show: the percentage
 * divides by the prediction, so it was forced to 0 and the row sorted to the
 * bottom. An owner reading "What we missed" was told the day went fine while a
 * whole line ran out.
 */
function buildReviewRows(items: ForecastItem[], hasActuals: boolean): ReviewRow[] {
  return items
    .map((item) => {
      const actual = hasActuals && item.actualQty != null ? item.actualQty : null
      const missedUnits = actual != null && item.predictedQty === 0 ? actual : 0
      const pct =
        actual != null && item.predictedQty > 0
          ? ((actual - item.predictedQty) / item.predictedQty) * 100
          : null
      return { ...item, actual, missedUnits, pct }
    })
    .sort((a, b) => {
      if (a.missedUnits !== b.missedUnits) return b.missedUnits - a.missedUnits
      const aPct = a.pct == null ? -1 : Math.abs(a.pct)
      const bPct = b.pct == null ? -1 : Math.abs(b.pct)
      return bPct - aPct
    })
}

interface Props {
  forecast: Forecast
  weekAvg: number
  onClose: () => void
}

export function DayDetailDrawer({ forecast, weekAvg, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const { items, totalPredictedRevenue } = forecast
  const calendarDate = forecastDateKey(forecast)
  const isClosed = forecast.availability?.status === 'closed'

  // Determine if this is a past day
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const forecastDate = parseDateOnly(calendarDate)
  forecastDate.setHours(0, 0, 0, 0)
  const isPast = forecastDate < today

  // Save and restore focus exactly once per open. Tying this to `onClose` meant
  // every re-render of the page behind the drawer tore the effect down, threw
  // focus back to the top of the dialog, and overwrote the element we have to
  // return focus to on close.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => {
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const delta = weekAvg > 0 ? ((totalPredictedRevenue - weekAvg) / weekAvg) * 100 : 0
  const isNeutral = Math.abs(delta) <= 5
  const deltaColor = isNeutral ? 'text-muted' : delta > 0 ? 'text-guava-green' : 'text-guava-red-text'
  const deltaPrefix = delta > 0 ? '+' : ''

  // ── Past (review) mode helpers ─────────────────────────────────────────────
  const hasActuals = hasMatchedActuals(forecast)
  const actualRevenue = hasActuals && forecast.actualRevenue != null ? forecast.actualRevenue : null

  const revDelta =
    actualRevenue != null && totalPredictedRevenue > 0
      ? ((actualRevenue - totalPredictedRevenue) / totalPredictedRevenue) * 100
      : null

  const reviewRows = buildReviewRows(items, hasActuals)

  // Worst misses: an unforecast line first, then anything more than 15% out.
  const worstMiss = reviewRows
    .filter((row) => row.actual != null && (row.missedUnits > 0 || Math.abs(row.pct ?? 0) > 15))
    .slice(0, 3)

  // ── Plan mode helpers ──────────────────────────────────────────────────────
  const sortedItems = [...items].sort((a, b) => b.predictedQty - a.predictedQty)
  // The drawer is where an owner builds an order, so it must not be the one
  // surface that prints a stock instruction against a line selling under two a
  // day. Today and the day cards already split these out.
  const plannedItems = sortedItems.filter((item) => !isOccasionalSeller(item))
  const occasionalItems = sortedItems.filter((item) => isOccasionalSeller(item))
  const showConfidence = items.some((item) => item.confidence != null)
  const coverage = forecast.forecastCoverage
  const itemsTruncated =
    coverage != null &&
    typeof coverage.itemCount === 'number' &&
    typeof coverage.storedItemCount === 'number' &&
    coverage.storedItemCount < coverage.itemCount
  const inventory = computeInventory(items)
  const basis = isPast ? null : forecastBasisSentence(forecast)

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={dialogRef}
        className="fixed right-0 top-0 h-full bg-surface border-l border-border z-50 overflow-y-auto
                   w-full sm:w-130"
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-forecast-dialog-title"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-border px-5 py-4 flex items-start justify-between gap-4 z-10">
          <div>
            <p id="day-forecast-dialog-title" className="text-text font-semibold text-base">
              {isClosed ? 'Closed day' : isPast ? 'Day review' : 'Day forecast'} — {getDayLabel(calendarDate)}
            </p>
            <p className="text-muted text-xs mt-0.5">{fullDate(calendarDate)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text p-1 -mr-1 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
            aria-label="Close forecast details"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {forecast.availability?.scheduleSource === 'inferred_from_sales' && (
            <p className="text-xs text-muted">Assumed open: hours not saved</p>
          )}
          {/* Revenue tile */}
          <div className="rounded-lg bg-[#111111] border border-border p-4">
            {isClosed ? (
              <>
                <p className="text-guava-red-text text-xs font-semibold uppercase tracking-wide">Closed</p>
                <p className="mt-2 text-text text-lg font-semibold">No trading forecast</p>
                <p className="mt-1 text-sm text-muted">
                  {forecast.availability?.reason || 'This café is closed for the day.'}
                </p>
              </>
            ) : isPast && hasActuals && actualRevenue != null ? (
              <>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-muted text-xs mb-1">Predicted revenue</p>
                    <p className="text-muted text-2xl font-bold">
                      R {totalPredictedRevenue.toLocaleString('en-ZA')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted text-xs mb-1">Actual revenue</p>
                    <p className="text-text text-2xl font-bold">
                      R {actualRevenue.toLocaleString('en-ZA')}
                    </p>
                  </div>
                </div>
                {revDelta !== null && (
                  <p
                    className={`text-sm mt-2 ${
                      Math.abs(revDelta) <= 5
                        ? 'text-guava-green'
                        : Math.abs(revDelta) <= 15
                        ? 'text-guava-yellow'
                        : 'text-guava-red-text'
                    }`}
                  >
                    {revDelta >= 0 ? '+' : ''}{revDelta.toFixed(0)}% vs predicted
                  </p>
                )}
              </>
            ) : isPast && !hasActuals ? (
              <>
                <p className="text-muted text-xs mb-1">Predicted revenue</p>
                <p className="text-text text-3xl font-bold">
                  R {totalPredictedRevenue.toLocaleString('en-ZA')}
                </p>
                <p className="text-muted text-sm mt-2">
                  Awaiting matched sales data for this day.
                </p>
              </>
            ) : isPast && hasActuals ? (
              <>
                <p className="text-muted text-xs mb-1">Predicted revenue</p>
                <p className="text-text text-3xl font-bold">
                  R {totalPredictedRevenue.toLocaleString('en-ZA')}
                </p>
                <p className="text-muted text-sm mt-2">
                  Actual item counts are available, but actual revenue was not stored for this day.
                </p>
              </>
            ) : (
              <>
                <p className="text-muted text-xs mb-1">Predicted revenue</p>
                <p className="text-text text-3xl font-bold">
                  R {totalPredictedRevenue.toLocaleString('en-ZA')}
                </p>
                {weekAvg > 0 && (
                  <p className={`text-sm mt-1 ${deltaColor}`}>
                    {isNeutral ? 'On par with' : `${deltaPrefix}${delta.toFixed(0)}% vs`} weekly average
                  </p>
                )}
              </>
            )}
          </div>

          {/* ── PAST: What we missed ────────────────────────────────────────── */}
          {!isClosed && isPast && worstMiss.length > 0 && (
            <div>
              <p className="text-text text-xs font-semibold uppercase tracking-wider mb-3">
                What we missed
              </p>
              <div className="space-y-2">
                {worstMiss.map((item) => {
                  const actual = item.actual ?? 0
                  const diff = actual - item.predictedQty
                  const absDiff = Math.abs(diff)
                  return (
                    <div key={item.itemName} className="text-xs text-muted">
                      <span className="text-text">{item.itemName}</span>
                      {' — '}predicted {item.predictedQty}, actual {actual},{' '}
                      <span className={diff > 0 ? 'text-guava-green' : 'text-guava-red-text'}>
                        {item.missedUnits > 0
                          ? `${item.missedUnits} units the forecast did not see at all`
                          : `${diff > 0 ? 'over by' : 'under by'} ${absDiff} units`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── FUTURE: Why this prediction ────────────────────────────────── */}
          {!isClosed && !isPast && (
            <div>
              <p className="text-text text-xs font-semibold uppercase tracking-wider mb-3">
                Why this prediction?
              </p>
              <ModifierBreakdown forecast={forecast} basis={basis} />
            </div>
          )}

          {!isClosed && <Separator className="bg-border" />}

          {/* Item breakdown */}
          {!isClosed && <div>
            <p className="text-text text-xs font-semibold uppercase tracking-wider mb-3">
              Item breakdown
            </p>

            {isPast ? (
              // Review mode: Item · Predicted · Actual · Δ%
              <div className="overflow-x-auto" role="region" aria-label="Predicted versus actual by item, scrollable" tabIndex={0}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-left font-medium pb-2">Item</th>
                      <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Predicted</th>
                      <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Actual</th>
                      <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(hasActuals ? reviewRows : buildReviewRows(sortedItems, false)).map((item) => {
                      const pct = item.pct
                      const pctColor =
                        item.missedUnits > 0
                          ? 'text-guava-red-text'
                          : pct == null
                          ? 'text-muted'
                          : Math.abs(pct) <= 5
                          ? 'text-guava-green'
                          : Math.abs(pct) <= 15
                          ? 'text-guava-yellow'
                          : 'text-guava-red-text'
                      return (
                        <tr key={item.itemName} className="border-b border-[#1F1F1F] last:border-0">
                          <th scope="row" className="text-text text-xs font-normal text-left truncate pr-1 py-2 max-w-40">
                            {item.itemName}
                          </th>
                          <td className="text-muted text-xs text-right py-2">{item.predictedQty}</td>
                          <td className="text-muted text-xs text-right py-2">
                            {item.actual != null ? item.actual : '---'}
                          </td>
                          <td className={`text-xs text-right py-2 ${pctColor}`}>
                            {item.missedUnits > 0
                              ? `+${item.missedUnits} units`
                              : pct != null
                              ? `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
                              : '---'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              // Plan mode: Item · Predicted · Suggested stock (+ confidence)
              <div className="space-y-4">
                <div className="overflow-x-auto" role="region" aria-label="Predicted quantity and suggested stock by item, scrollable" tabIndex={0}>
                  <table className="w-full text-xs">
                    <caption className="sr-only">
                      Predicted demand and suggested stock for each item you plan to sell
                    </caption>
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-left font-medium pb-2">Item</th>
                        <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Predicted demand</th>
                        <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Suggested stock</th>
                        {showConfidence && (
                          <th scope="col" className="text-muted text-[10px] uppercase tracking-wider text-right font-medium pb-2">Confidence</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {plannedItems.length === 0 && (
                        <tr>
                          <td colSpan={showConfidence ? 4 : 3} className="text-muted text-xs py-3">
                            Every line on this day sells under {OCCASIONAL_SELLER_MAX_QTY} a day. Keep a few of each
                            on hand rather than ordering to a number.
                          </td>
                        </tr>
                      )}
                      {plannedItems.map((item) => (
                        <tr key={item.itemName} className="border-b border-[#1F1F1F] last:border-0">
                          <th scope="row" className="text-text text-xs font-normal text-left truncate pr-1 py-2 max-w-40">
                            {item.itemName}
                          </th>
                          <td className="text-muted text-xs text-right py-2">{item.predictedQty}</td>
                          <td className="text-muted text-xs text-right py-2">{item.suggestedStock ?? '—'}</td>
                          {showConfidence && (
                            <td
                              className={`text-xs text-right py-2 ${
                                item.confidence === 'low' ? 'text-guava-yellow' : 'text-muted'
                              }`}
                            >
                              {item.confidence ? CONFIDENCE_LABEL[item.confidence] ?? item.confidence : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {occasionalItems.length > 0 && (
                  <div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                        Occasional sellers
                      </h4>
                      <span className="text-[10px] text-muted">
                        under {OCCASIONAL_SELLER_MAX_QTY} a day — keep a few on hand rather than ordering to a number
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {occasionalItems.map((item) => (
                        <span
                          key={item.itemName}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-[#161616] px-2.5 py-1 text-[11px] text-muted"
                        >
                          <span className="truncate max-w-45">{item.itemName}</span>
                          <span className="tabular-nums text-muted">
                            {item.predictedQty > 0 ? `~${item.predictedQty}` : 'rare'}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {itemsTruncated && coverage && (
                  <p className="text-[11px] text-muted">
                    Showing the {coverage.storedItemCount} largest of {coverage.itemCount} forecast lines.
                    Predicted revenue covers all {coverage.itemCount}.
                  </p>
                )}
              </div>
            )}
          </div>}

          {/* ── FUTURE only: Inventory rollup + AI insight ─────────────────── */}
          {!isClosed && !isPast && SHOW_INVENTORY_ROLLUP && (
            <>
              <Separator className="bg-border" />

              <div>
                <p className="text-text text-xs font-semibold uppercase tracking-wider mb-3">
                  Rough inventory hint
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-[#111111] border border-border p-3 flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-guava-red-text shrink-0" />
                    <div>
                      <p className="text-text text-sm font-semibold">≈ {inventory.coffee}</p>
                      <p className="text-muted text-[10px]">coffee drinks</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#111111] border border-border p-3 flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-guava-green shrink-0" />
                    <div>
                      <p className="text-text text-sm font-semibold">≈ {inventory.cold}</p>
                      <p className="text-muted text-[10px]">cold drinks</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#111111] border border-border p-3 flex items-center gap-2">
                    <UtensilsCrossed className="w-4 h-4 text-guava-yellow shrink-0" />
                    <div>
                      <p className="text-text text-sm font-semibold">≈ {inventory.food}</p>
                      <p className="text-muted text-[10px]">food items</p>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#111111] border border-border p-3 flex items-center gap-2">
                    <Waves className="w-4 h-4 text-muted shrink-0" />
                    <div>
                      <p className="text-text text-sm font-semibold">≈ {inventory.water}</p>
                      <p className="text-muted text-[10px]">waters</p>
                    </div>
                  </div>
                </div>
                <p className="text-muted text-[10px] mt-3 leading-relaxed">
                  Rollup uses only suggested stock values returned by the forecast service.
                </p>
              </div>

              <Separator className="bg-border" />

              <div className="rounded-lg bg-[#111111] border border-border p-4 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-guava-red-text shrink-0 mt-0.5" />
                <p className="text-muted text-xs leading-relaxed">
                  AI insights load globally - see{' '}
                  <span className="text-guava-red-text">Ask Guava</span> for the full list powered by Claude.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
