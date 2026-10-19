import { weatherTempLabel } from '@/lib/forecastSignals'
import { Cloud, Zap, Calendar, Banknote, Megaphone, ChevronRight } from 'lucide-react'
import { ClosedDayNotice } from './ClosedDayNotice'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { Forecast } from '@/types'
import { forecastDateKey, parseDateOnly } from '@/lib/date'
import { isOccasionalSeller, OCCASIONAL_SELLER_MAX_QTY } from '@/lib/forecastItems'
import { accuracyTextClass } from './accuracyBand'
import { formatZAR } from '@/lib/money'
import {
  isLoadSheddingAvailable,
  isWeatherAvailable,
  loadSheddingUnavailableReason,
  weatherUnavailableReason,
} from '@/lib/forecastSignals'

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

function formatDate(dateStr: string): string {
  return parseDateOnly(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}

function deltaColor(pct: number): string {
  const abs = Math.abs(pct)
  if (abs <= 5) return 'text-guava-green'
  if (abs <= 15) return 'text-guava-yellow'
  return 'text-guava-red-text'
}

function hasMatchedActuals(forecast: Forecast): boolean {
  return Boolean(
    forecast.actualsUpdatedAt ||
    (forecast.actualTransactionCount != null && forecast.actualTransactionCount > 0) ||
    (forecast.accuracy != null && forecast.items.some((item) => item.actualQty != null))
  )
}

/**
 * The card's own "open this day" control.
 *
 * The card used to be the button: `role="button"` on the container. That role
 * is Children Presentational, so every number inside it — predicted revenue,
 * the top five items with their suggested stock, the accuracy, the signal
 * badges — was stripped from the accessibility tree. A screen-reader user
 * arrowing the week heard "Open forecast details for Tuesday, button" seven
 * times and none of the figures they order stock against.
 */
function OpenDetailButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={`Open forecast details for ${label}`}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-[#111111] px-2 py-1 text-[10px] font-medium text-muted transition-colors hover:border-[#3A3A3A] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
    >
      View detail
      <ChevronRight className="h-3 w-3" />
    </button>
  )
}

interface Props {
  forecast: Forecast
  weekAvg: number
  mode?: 'plan' | 'review'
  onClick: () => void
}

export function DayCard({ forecast, weekAvg, mode = 'plan', onClick }: Props) {
  const { signals, items, totalPredictedRevenue } = forecast
  const calendarDate = forecastDateKey(forecast)
  const weatherAvailable = isWeatherAvailable(signals.weather)
  const loadSheddingAvailable = isLoadSheddingAvailable(signals)
  const hasActuals = hasMatchedActuals(forecast)
  const actualRevenue = hasActuals && forecast.actualRevenue != null ? forecast.actualRevenue : null

  const delta = weekAvg > 0 ? ((totalPredictedRevenue - weekAvg) / weekAvg) * 100 : 0
  const isNeutral = Math.abs(delta) <= 5
  const revDeltaColor = isNeutral
    ? 'text-muted'
    : delta > 0
    ? 'text-guava-green'
    : 'text-guava-red-text'
  const deltaPrefix = delta > 0 ? '+' : ''

  // ── Plan mode ──────────────────────────────────────────────────────────────
  // Never put a suggested-stock number against a line selling under ~2 a day:
  // backtested error on those exceeds 100%, so the figure is noise dressed as a
  // plan. Today's dashboard groups them separately for the same reason. Judge
  // that on volume, not confidence, which the backend also caps by evidence.
  const top5Plan = [...items]
    .filter((item) => !isOccasionalSeller(item))
    .sort((a, b) => b.predictedQty - a.predictedQty)
    .slice(0, 5)
  // `|| 1` rather than a length check: a non-occasional line can still forecast
  // to 0 after a heavy negative multiplier (stage 6 plus rain), and dividing by
  // that produced `width: NaN%`, which the browser drops — every bar vanished.
  const maxQtyPlan = top5Plan[0]?.predictedQty || 1

  // ── Review mode ────────────────────────────────────────────────────────────
  const top5Review = [...items]
    .sort((a, b) => b.predictedQty - a.predictedQty)
    .slice(0, 5)

  // Accuracy badge colour. Graded by the one shared band so an 82% day card
  // cannot read amber beside an 82% week header reading green.
  const acc = forecast.accuracy ?? null
  const accColor = accuracyTextClass(acc)

  if (forecast.availability?.status === 'closed') {
    return (
      <Card onClick={onClick} className="cursor-pointer hover:border-[#444444] transition-colors">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-text font-semibold text-sm">{getDayLabel(calendarDate)}</p>
              <p className="text-muted text-xs">{formatDate(calendarDate)}</p>
            </div>
            <Badge variant="destructive">Closed</Badge>
          </div>
          {/* A closure the sales record contradicts is a setting to fix, not a
              fact to absorb, so it is an alert with a way out rather than the
              same muted line as a genuine day off. */}
          {forecast.availability.contradictsHistory ? (
            <ClosedDayNotice availability={forecast.availability} />
          ) : (
            <div className="rounded-lg border border-border bg-[#111111] px-3 py-3">
              <p className="text-sm font-medium text-text">No trading forecast</p>
              <p className="mt-1 text-xs text-muted">
                {forecast.availability.reason || 'This café is closed for the day.'}
              </p>
            </div>
          )}
          <OpenDetailButton label={getDayLabel(calendarDate)} onClick={onClick} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card onClick={onClick} className="cursor-pointer hover:border-[#444444] transition-colors">
      <CardContent className="p-4 space-y-3">
        {forecast.availability?.scheduleSource === 'inferred_from_sales' && (
          <p className="text-xs text-muted">Assumed open: hours not saved</p>
        )}
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-text font-semibold text-sm">{getDayLabel(calendarDate)}</p>
            <p className="text-muted text-xs">{formatDate(calendarDate)}</p>
          </div>
          <div className="text-right">
            {mode === 'review' && hasActuals && actualRevenue != null ? (
              <>
                <p className="text-text font-bold text-lg leading-tight">
                  {formatZAR(actualRevenue)}
                </p>
                <p className="text-xs text-muted">
                  pred {formatZAR(totalPredictedRevenue)}
                </p>
              </>
            ) : mode === 'review' && !hasActuals ? (
              <>
                <p className="text-muted font-semibold text-sm leading-tight">
                  Awaiting sales data
                </p>
                <p className="text-xs text-muted">
                  pred {formatZAR(totalPredictedRevenue)}
                </p>
              </>
            ) : (
              <p className="text-text font-bold text-lg leading-tight">
                {formatZAR(totalPredictedRevenue)}
              </p>
            )}
            {mode === 'plan' && !isNeutral && (
              <p className={`text-xs ${revDeltaColor}`}>
                {deltaPrefix}{delta.toFixed(0)}% vs avg
              </p>
            )}
            {mode === 'plan' && isNeutral && weekAvg > 0 && (
              <p className="text-xs text-muted">avg</p>
            )}
            {mode === 'review' && hasActuals && acc !== null && (
              <p className={`text-xs font-medium ${accColor}`}>
                Accuracy: {Math.round(acc)}%
              </p>
            )}
          </div>
        </div>

        {/* Items */}
        {mode === 'plan' && top5Plan.length > 0 && (
          <div className="space-y-1.5">
            {top5Plan.map((item) => {
              return (
                <div key={item.itemName} className="flex items-center gap-2">
                  <span className="text-muted text-[10px] w-28 truncate shrink-0">
                    {item.itemName}
                  </span>
                  <div className="flex-1 flex items-center gap-1.5">
                    <div
                      className="h-1.5 rounded-full bg-guava-red/60"
                      style={{ width: `${Math.max(8, (item.predictedQty / maxQtyPlan) * 100)}%` }}
                    />
                    <div className="flex flex-col leading-none">
                      <span className="text-muted text-[10px]">
                        Predicted: {item.predictedQty}
                      </span>
                      {item.suggestedStock != null && (
                        <span className="text-muted text-[10px]">
                          Suggested stock: {item.suggestedStock}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* A small or brand-new cafe is exactly the account whose whole menu
            sells under two a day. Without this the card rendered a revenue
            figure, some chips, and a blank space where the plan should be —
            which reads as broken rather than as a deliberate omission. */}
        {mode === 'plan' && top5Plan.length === 0 && items.length > 0 && (
          <p className="text-muted text-[10px] leading-snug">
            Every line here sells under {OCCASIONAL_SELLER_MAX_QTY} a day — keep a few of each on hand
            rather than ordering to a number.
          </p>
        )}

        {mode === 'plan' && items.length === 0 && (
          <p className="text-muted text-[10px] leading-snug">
            No item predictions for this day yet.
          </p>
        )}

        {mode === 'review' && top5Review.length > 0 && (
          <div className="space-y-1.5">
            {top5Review.map((item) => {
              const pred = item.predictedQty
              const actual = item.actualQty
              const maxBar = actual != null ? Math.max(pred, actual) : pred
              const barFill = actual != null
                ? actual >= pred
                  ? 'bg-guava-green/60'
                  : 'bg-guava-red/60'
                : 'bg-guava-red/60'
              const barWidth = actual != null
                ? Math.max(8, (actual / maxBar) * 100)
                : Math.max(8, (pred / (top5Review[0].predictedQty || 1)) * 100)

              let deltaLabel: React.ReactNode = null
              if (actual != null) {
                const pct = pred > 0 ? ((actual - pred) / pred) * 100 : 0
                const sign = pct >= 0 ? '+' : ''
                const color = deltaColor(pct)
                deltaLabel = (
                  <span className={`text-[10px] ${color}`}>
                    {sign}{pct.toFixed(0)}%
                  </span>
                )
              }

              return (
                <div key={item.itemName} className="flex items-center gap-2">
                  <span className="text-muted text-[10px] w-28 truncate shrink-0">
                    {item.itemName}
                  </span>
                  <div className="flex-1 flex items-center gap-1.5">
                    {hasActuals && (
                      <div
                        className={`h-1.5 rounded-full ${barFill}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    )}
                    {!hasActuals && (
                      <div
                        className="h-1.5 rounded-full bg-guava-red/60"
                        style={{ width: `${Math.max(8, (pred / (top5Review[0].predictedQty || 1)) * 100)}%` }}
                      />
                    )}
                    <div className="flex flex-col leading-none gap-0.5">
                      {hasActuals ? (
                        <>
                          <span className="text-muted text-[10px]">
                            pred: {pred}
                          </span>
                          {actual != null && (
                            <span className="text-muted text-[10px]">
                              actual: {actual} {deltaLabel}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted text-[10px]">{pred}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Signal chips — only in plan mode (review is in the past, signals are historical context) */}
        {mode === 'plan' && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge
              variant="outline"
              className="text-[10px] py-0 h-5 px-1.5 gap-1 border-border"
              title={weatherAvailable ? undefined : weatherUnavailableReason(signals.weather)}
            >
              <Cloud className="w-2.5 h-2.5" />
              {weatherAvailable ? (
                `${weatherTempLabel(signals.weather)} · ${signals.weather.condition}`
              ) : (
                <>
                  Weather unavailable
                  {/* The reason was in a `title` on a non-focusable badge —
                      mouse-hover only, so unreachable on a phone or by a
                      screen reader. */}
                  <span className="sr-only">: {weatherUnavailableReason(signals.weather)}</span>
                </>
              )}
            </Badge>

            {signals.isPayday && (
              <Badge variant="success" className="text-[10px] py-0 h-5 px-1.5">
                <Banknote className="w-2.5 h-2.5 mr-1" />
                Payday
              </Badge>
            )}

            {signals.isPublicHoliday && (
              <Badge variant="warning" className="text-[10px] py-0 h-5 px-1.5">
                <Calendar className="w-2.5 h-2.5 mr-1" />
                Public holiday
              </Badge>
            )}

            {signals.isSchoolHoliday && !signals.isPublicHoliday && (
              <Badge variant="warning" className="text-[10px] py-0 h-5 px-1.5">
                <Calendar className="w-2.5 h-2.5 mr-1" />
                School holiday
              </Badge>
            )}

            {loadSheddingAvailable && signals.loadSheddingStage > 0 && (
              <Badge variant="destructive" className="text-[10px] py-0 h-5 px-1.5">
                <Zap className="w-2.5 h-2.5 mr-1" />
                Stage {signals.loadSheddingStage}
              </Badge>
            )}

            {!loadSheddingAvailable && (
              <Badge
                variant="outline"
                className="text-[10px] py-0 h-5 px-1.5"
                title={loadSheddingUnavailableReason(signals)}
              >
                <Zap className="w-2.5 h-2.5 mr-1" />
                Load shedding unavailable
                <span className="sr-only">: {loadSheddingUnavailableReason(signals)}</span>
              </Badge>
            )}

            {(signals.events ?? []).map((ev) => (
              <Badge
                key={ev.name}
                className="text-[10px] py-0 h-5 px-1.5 bg-purple-900/30 text-purple-400 border-transparent"
              >
                <Megaphone className="w-2.5 h-2.5 mr-1" />
                {ev.name} · {ev.impact}
              </Badge>
            ))}
          </div>
        )}

        {/* In review mode show a minimal weather chip so context isn't totally lost */}
        {mode === 'review' && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge
              variant="outline"
              className="text-[10px] py-0 h-5 px-1.5 gap-1 border-border"
              title={weatherAvailable ? undefined : weatherUnavailableReason(signals.weather)}
            >
              <Cloud className="w-2.5 h-2.5" />
              {weatherAvailable ? (
                `${weatherTempLabel(signals.weather)} · ${signals.weather.condition}`
              ) : (
                <>
                  Weather unavailable
                  {/* The reason was in a `title` on a non-focusable badge —
                      mouse-hover only, so unreachable on a phone or by a
                      screen reader. */}
                  <span className="sr-only">: {weatherUnavailableReason(signals.weather)}</span>
                </>
              )}
            </Badge>
          </div>
        )}

        <OpenDetailButton label={getDayLabel(calendarDate)} onClick={onClick} />
      </CardContent>
    </Card>
  )
}
