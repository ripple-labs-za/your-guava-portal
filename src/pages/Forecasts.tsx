import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router'
import { CalendarClock, TrendingUp, Upload } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { forecastDateKey, parseDateOnly } from '@/lib/date'
import type { Forecast } from '@/types'
import { WeekHeader } from '@/components/forecasts/WeekHeader'
import { WeekTrajectoryChart } from '@/components/forecasts/WeekTrajectoryChart'
import { DayCard } from '@/components/forecasts/DayCard'
import { DayDetailDrawer } from '@/components/forecasts/DayDetailDrawer'
import { ItemsHeatmap } from '@/components/forecasts/ItemsHeatmap'
import type { AccuracyPayload } from '@/lib/historyAccuracy'

interface WeekMeta {
  expectedDays: number
  generatedDays: number
  failedDays: { dateKey: string; message: string }[]
  isPartial: boolean
  insufficientData: boolean
  insufficientDays: string[]
}

function formatTrainingDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * How much of an answer the engine has for a day.
 *
 * A `closed` day and a day still building history both come back as R0, but
 * they mean opposite things: the first is a real prediction (nobody is
 * trading), the second is the absence of one. Only the first may be summed,
 * charted or shown as a rand figure.
 */
type DayAvailability = 'ready' | 'closed' | 'awaiting_history'

function dayAvailability(forecast: Forecast): DayAvailability {
  const status = forecast.availability?.status
  if (status === 'closed') return 'closed'
  if (status === 'insufficient_data') return 'awaiting_history'
  // Forecasts stored before availability existed carry no status; they were
  // only ever written for days the engine could answer.
  return 'ready'
}

function dayName(forecast: Forecast): string {
  return parseDateOnly(forecastDateKey(forecast)).toLocaleDateString('en-ZA', { weekday: 'long' })
}

function dayDate(forecast: Forecast): string {
  return parseDateOnly(forecastDateKey(forecast)).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
  })
}

const AWAITING_HISTORY_FALLBACK =
  'There are not yet enough matching trading days on record to forecast this day.'

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

/**
 * Stands in for a day the engine cannot answer, in its normal place in the
 * week. Deliberately carries no rand figure: R0 here would read as "you will
 * take nothing", which is not what the engine said.
 */
function AwaitingHistoryDayCard({ forecast }: { forecast: Forecast }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-text font-semibold text-sm">{dayName(forecast)}</p>
            <p className="text-muted text-xs">{dayDate(forecast)}</p>
          </div>
          <Badge variant="outline">Building history</Badge>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-3">
          <p className="text-sm font-medium text-text">No forecast for this day yet</p>
          <p className="mt-1 text-xs text-muted">
            {forecast.availability?.reason || AWAITING_HISTORY_FALLBACK}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The whole-week state for a cafe that has not traded long enough yet. This is
 * an expected stage of onboarding, not a failure, so it reads as a status and
 * ends on the one action that moves it forward.
 */
function AwaitingHistoryPanel({
  reason,
  perDay,
  hasImportedSales,
}: {
  reason: string
  /** One entry per distinct reason, naming the weekdays it covers. */
  perDay: { days: string[]; reason: string }[]
  hasImportedSales: boolean
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2">
          <CalendarClock className="h-6 w-6 text-muted" />
        </div>
        <h2 className="text-text text-base font-semibold">Not enough trading history yet</h2>
        <p className="mt-2 max-w-lg text-sm text-muted">
          Planning builds each day from the same weekday in earlier weeks — a Tuesday from
          previous Tuesdays.{' '}
          {hasImportedSales
            ? 'Your sales are on record, but not enough matching weekdays have accumulated yet.'
            : 'No sales have been imported for this cafe yet, so there is nothing to build from.'}
        </p>
        {perDay.length > 0 ? (
          <div className="mt-4 w-full max-w-lg rounded-lg border border-border bg-surface-2 px-3 py-2 text-left">
            <p className="text-xs font-medium text-text">What each day is still waiting for</p>
            <ul className="mt-1.5 space-y-1">
              {perDay.map((entry) => (
                <li key={entry.reason} className="text-xs text-muted">
                  <span className="font-medium text-text">{entry.days.join(', ')}</span>
                  {' — '}
                  {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : reason ? (
          <p className="mt-4 max-w-lg rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            What each day needs: {reason}
          </p>
        ) : null}
        <Button asChild className="mt-5">
          <Link to="/data-health">
            <Upload className="h-4 w-4" />
            Import sales data
          </Link>
        </Button>
        <p className="mt-4 max-w-lg text-xs text-muted">
          This is the normal starting point for a new cafe. Days fill in here on their own as
          matching history builds up.
        </p>
      </CardContent>
    </Card>
  )
}

export default function Forecasts() {
  const [futureForecasts, setFutureForecasts] = useState<Forecast[]>([])
  const [pastForecasts, setPastForecasts] = useState<Forecast[]>([])
  const [accuracy, setAccuracy] = useState<AccuracyPayload | null>(null)
  const [weekMeta, setWeekMeta] = useState<WeekMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [supportingDataError, setSupportingDataError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    setSupportingDataError(false)

    Promise.allSettled([
      api.get<{ forecasts: Forecast[]; meta?: WeekMeta }>('/forecasts/week', { signal: controller.signal }),
      api.get<{ forecasts: Forecast[] }>('/forecasts/recent', { signal: controller.signal }),
      api.get<AccuracyPayload>('/forecasts/accuracy', { signal: controller.signal }),
    ]).then(([weekResult, recentResult, accuracyResult]) => {
      if (controller.signal.aborted) return
      if (weekResult.status === 'rejected') {
        setLoadError('Forecasts could not be loaded. Your existing data has not been removed.')
        return
      }

      setFutureForecasts(weekResult.value.data.forecasts || [])
      setWeekMeta(weekResult.value.data.meta || null)
      setPastForecasts(recentResult.status === 'fulfilled' ? recentResult.value.data.forecasts || [] : [])
      setAccuracy(accuracyResult.status === 'fulfilled' ? accuracyResult.value.data : null)
      setSupportingDataError(recentResult.status === 'rejected' || accuracyResult.status === 'rejected')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })

    return () => controller.abort()
  }, [reloadKey])

  // Days the engine actually answered. A closed day belongs here: its R0 is a
  // real prediction. A day still building history does not.
  const usableForecasts = futureForecasts.filter(
    (forecast) => dayAvailability(forecast) !== 'awaiting_history'
  )
  const tradingForecasts = usableForecasts.filter(
    (forecast) => dayAvailability(forecast) !== 'closed'
  )
  const awaitingForecasts = futureForecasts.filter(
    (forecast) => dayAvailability(forecast) === 'awaiting_history'
  )
  // A week whose only "usable" days are closed ones carries no forecast at all:
  // summing it produces R0 for a cafe that has never traded. A genuinely
  // all-closed week (no pending days) is still a real answer and stays.
  const allForecastsInsufficient =
    futureForecasts.length > 0 && tradingForecasts.length === 0 && awaitingForecasts.length > 0
  const allForecastGenerationFailed =
    futureForecasts.length === 0 &&
    weekMeta?.isPartial === true &&
    (weekMeta.failedDays?.length || 0) > 0
  const weekTotal = usableForecasts.reduce((s, f) => s + (f.totalPredictedRevenue || 0), 0)
  const peakDay = tradingForecasts.reduce(
    (best, f) => (!best || f.totalPredictedRevenue > best.totalPredictedRevenue ? f : best),
    null as Forecast | null
  )
  const tradingTotal = tradingForecasts.reduce((s, f) => s + (f.totalPredictedRevenue || 0), 0)
  const weekAvg = tradingForecasts.length > 0 ? tradingTotal / tradingForecasts.length : 0
  // The engine's own words for why a day is missing, so this copy cannot drift
  // from the backend rule that produced it — but per weekday, not one day's
  // reason shown for all seven. Planning builds a Tuesday from Tuesdays, so
  // each weekday is a different distance from being forecastable, and showing
  // the first day's count against every day understates some and overstates
  // others.
  // Grouped by reason, because most weeks every day is the same distance and
  // seven identical sentences is noise rather than detail. When they differ,
  // the difference is the whole point.
  const awaitingByDay = (() => {
    const byReason = new Map<string, string[]>()
    for (const forecast of awaitingForecasts) {
      const reason = forecast.availability?.reason
      if (!reason) continue
      const day = parseDateOnly(forecastDateKey(forecast)).toLocaleDateString('en-ZA', {
        weekday: 'long',
      })
      const days = byReason.get(reason) || []
      if (!days.includes(day)) days.push(day)
      byReason.set(reason, days)
    }
    return [...byReason.entries()].map(([reason, days]) => ({ days, reason }))
  })()
  const awaitingReason = awaitingByDay[0]?.reason || ''
  const hasImportedSales = futureForecasts.some(
    (forecast) => (forecast.trainingData?.transactionCount ?? 0) > 0
  )
  const coverageNote =
    `Weekly total and peak day cover the ${usableForecasts.length} ` +
    `${plural(usableForecasts.length, 'day')} with a forecast. ` +
    `${awaitingForecasts.length} ${plural(awaitingForecasts.length, 'day')} ` +
    `${plural(awaitingForecasts.length, 'is', 'are')} still building history and ` +
    `${plural(awaitingForecasts.length, 'is', 'are')} not counted.`
  const oldestTrainingDate = futureForecasts
    .map((forecast) => forecast.trainingData?.latestSaleDate ?? forecast.trainingData?.lastTransactionDate)
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
  const worstStaleDays = futureForecasts
    .map((f) => f.trainingData?.staleDays)
    .filter((days): days is number => typeof days === 'number')
    .sort((a, b) => b - a)[0]
  const showStaleDataNotice = oldestTrainingDate != null && worstStaleDays != null && worstStaleDays > 30

  // Stable across renders: the drawer saves the element to return focus to when
  // this effect mounts, so a fresh closure on every parent render tore the
  // effect down mid-interaction and threw a keyboard user back to the top of
  // the dialog.
  const closeDrawer = useCallback(() => setSelectedForecastId(null), [])

  // The week payload starts at the cafe's own calendar today, which is the only
  // trustworthy source for "today" — the device clock is not the cafe's.
  const cafeTodayKey = futureForecasts[0] ? forecastDateKey(futureForecasts[0]) : undefined

  // Look up selected forecast from either array
  const selectedForecast =
    selectedForecastId != null
      ? [...futureForecasts, ...pastForecasts].find((f) => f._id === selectedForecastId) ?? null
      : null

  return (
    <AppLayout title="Planning">
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-muted text-sm">
          <TrendingUp className="w-4 h-4 text-guava-red-text" />
          7-day rolling sales forecast · Updated daily
        </div>

        {loading && (
          <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading this week&apos;s forecast</span>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-72 w-full" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-48" />
              ))}
            </div>
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-4" role="alert">
            <p className="text-sm text-red-300">{loadError}</p>
            <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !loadError && allForecastGenerationFailed && (
          <div className="rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-4" role="alert">
            <p className="text-sm text-red-300">
              No forecast days could be generated. Your uploaded sales data is still safe.
            </p>
            <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !loadError && !allForecastGenerationFailed && (futureForecasts.length === 0 || allForecastsInsufficient) && (
          <AwaitingHistoryPanel
            reason={awaitingReason}
            perDay={awaitingByDay}
            hasImportedSales={hasImportedSales}
          />
        )}

        {!loading && !loadError && !allForecastsInsufficient && usableForecasts.length > 0 && (
          <>
            {weekMeta?.isPartial && (
              <div className="rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-3 text-sm text-red-300" role="alert">
                Only {weekMeta.generatedDays} of {weekMeta.expectedDays} forecast days are available.
                Do not treat this as a complete weekly plan. Try again before ordering or staffing.
              </div>
            )}
            {supportingDataError && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="status">
                Forecasts are current, but recent comparisons or accuracy metrics are temporarily unavailable.
              </div>
            )}
            <WeekHeader
              weekTotal={weekTotal}
              peakDay={peakDay}
              accuracy={accuracy?.avgAccuracy ?? null}
              matchedDays={accuracy ? accuracy.forecasts?.length ?? 0 : null}
              basis={accuracy?.basis ?? null}
              itemAccuracy={accuracy?.avgItemAccuracy ?? null}
              itemAccuracyDays={accuracy?.itemAccuracyDays}
              excludedInsufficientDays={accuracy?.excludedInsufficientDays}
              basisNote={accuracy?.basisNote ?? null}
            />
            {/* Say what the headline figures are drawn from. Without this the
                total reads as a whole week even when part of it is still
                building history. */}
            {awaitingForecasts.length > 0 && (
              <p className="text-muted text-xs" role="status">
                {coverageNote}
              </p>
            )}
            {showStaleDataNotice && oldestTrainingDate && (
              <div className="rounded-lg border border-guava-yellow/30 bg-guava-yellow/10 px-4 py-3">
                <p className="text-guava-yellow text-sm font-medium">Forecast data is getting stale</p>
                <p className="text-muted text-xs mt-1">
                  Some days are based on sales history ending as early as {formatTrainingDate(oldestTrainingDate)}.
                  Upload newer transactions before relying on these numbers for ordering or staffing.
                </p>
              </div>
            )}
            <WeekTrajectoryChart
              futureForecasts={usableForecasts}
              pastForecasts={pastForecasts}
              todayDateKey={cafeTodayKey}
            />

            {/* This week's plan */}
            <div className="space-y-3">
              <div>
                <h2 className="text-text text-base font-semibold">This week's plan</h2>
                <p className="text-muted text-xs mt-0.5">
                  Predicted output for the next 7 days. Stock suggestions appear only when returned by the forecast service.
                </p>
              </div>
              {/* Every day keeps its slot in the week. A day the engine cannot
                  answer is marked as such rather than dropped, so the plan is
                  never quietly shorter than seven days. */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {futureForecasts.map((f) =>
                  dayAvailability(f) === 'awaiting_history' ? (
                    <AwaitingHistoryDayCard key={f._id} forecast={f} />
                  ) : (
                    <DayCard
                      key={f._id}
                      forecast={f}
                      weekAvg={weekAvg}
                      mode="plan"
                      onClick={() => setSelectedForecastId(f._id)}
                    />
                  )
                )}
              </div>
            </div>

            {/* Last week's results */}
            <div className="space-y-3">
              <div>
                <h2 className="text-text text-base font-semibold">Last week's results</h2>
                <p className="text-muted text-xs mt-0.5">
                  Predicted vs actual — see where we missed
                </p>
              </div>
              {pastForecasts.length === 0 ? (
                <p className="text-muted text-sm py-4">
                  No past forecasts yet — your first comparison will appear once today's predictions
                  can be checked against tomorrow's data.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pastForecasts.map((f) => (
                    <DayCard
                      key={f._id}
                      forecast={f}
                      weekAvg={weekAvg}
                      mode="review"
                      onClick={() => setSelectedForecastId(f._id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <ItemsHeatmap forecasts={usableForecasts} />
          </>
        )}

        {selectedForecast && (
          <DayDetailDrawer
            forecast={selectedForecast}
            weekAvg={weekAvg}
            onClose={closeDrawer}
          />
        )}
      </div>
    </AppLayout>
  )
}
