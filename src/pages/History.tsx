import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudRain,
  History as HistoryIcon,
  RefreshCw,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { ModelLearningPanel } from '@/components/forecasts/ModelLearningPanel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import api, { isSessionRejection } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ForecastHistoryResponse, ForecastHistoryRow, ForecastHistoryAccuracySummary } from '@/types'
import { parseDateOnly } from '@/lib/date'
import {
  isLoadSheddingAvailable,
  isWeatherAvailable,
  weatherUnavailableReason,
} from '@/lib/forecastSignals'

const PERIODS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '365d', days: 365 },
]

const HISTORY_PAGE_SIZE = 30
const HISTORY_BACKFILL_BATCH_SIZE = 14
// `backfill=sync` runs up to a full batch of forecast generations inside one
// request. The shared axios client times out at 20s, which aborted legitimate
// batches; the upload confirm sets 120s for the same reason.
const HISTORY_BACKFILL_TIMEOUT_MS = 180_000

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  return currency.format(value)
}

function formatDate(date: string) {
  return parseDateOnly(date).toLocaleDateString('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function formatPercent(value: number | null | undefined, showSign = false) {
  if (value == null || Number.isNaN(value)) return '-'
  const sign = showSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function excludedNote(summary?: ForecastHistoryAccuracySummary) {
  const n = summary?.excludedRowCount ?? 0
  return n > 0 ? ` · ${n} building-history day${n === 1 ? '' : 's'} not counted` : ''
}

function weatherLabel(row: ForecastHistoryRow) {
  const weather = row.weather
  if (!weather) return '-'
  if (!isWeatherAvailable(weather)) return weatherUnavailableReason(weather)
  const rain = weather.precipMm != null && weather.precipMm > 0 ? `, ${weather.precipMm.toFixed(1)}mm` : ''
  return `${Math.round(weather.temp)}C, ${weather.condition}${rain}`
}

function factorLabels(row: ForecastHistoryRow) {
  const labels = new Map<string, string>()

  for (const factor of row.factorSummary || []) {
    if (!factor.label) continue
    labels.set(factor.key, factor.effect ? `${factor.label} ${factor.effect}` : factor.label)
  }

  if (row.signals.isPublicHoliday) labels.set('publicHoliday', 'Public holiday')
  if (row.signals.isSchoolHoliday) labels.set('schoolHoliday', 'School holiday')
  if (row.signals.isPayday) labels.set('paydaySignal', 'Payday')
  if (isLoadSheddingAvailable(row.signals) && row.signals.loadSheddingStage > 0) {
    labels.set('loadSheddingSignal', `Stage ${row.signals.loadSheddingStage}`)
  } else if (!isLoadSheddingAvailable(row.signals)) {
    labels.set('loadSheddingUnavailable', 'Load shedding unavailable')
  }
  for (const event of row.signals.events || []) {
    labels.set(`event-${event.name}`, event.name)
  }

  return [...labels.values()]
}

function StatPanel({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#9E9E9E]">{label}</p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold text-text',
          tone === 'good' && 'text-guava-green',
          tone === 'bad' && 'text-guava-red-text'
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  )
}

export default function History() {
  const [days, setDays] = useState(90)
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState<ForecastHistoryRow[]>([])
  const [meta, setMeta] = useState<ForecastHistoryResponse['meta'] | null>(null)
  const [pagination, setPagination] = useState<ForecastHistoryResponse['pagination'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [buildingHistory, setBuildingHistory] = useState(false)
  // Kept apart from `error`, which belongs to the page load. Putting a backfill
  // failure there unmounted the table, the accuracy panels and the learning
  // panel, so a failed extra batch read as if the history had been lost.
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const [backfillNote, setBackfillNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .get<ForecastHistoryResponse>('/forecasts/history', {
        params: { days, page, limit: HISTORY_PAGE_SIZE },
      })
      .then(({ data }) => {
        if (cancelled) return
        setHistory(data.history || data.rows || [])
        setMeta(data.meta)
        setPagination(data.pagination || null)
      })
      .catch(() => {
        if (cancelled) return
        setHistory([])
        setMeta(null)
        setPagination(null)
        setError('History could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [days, page, refreshNonce])

  const buildNextHistoryBatch = async () => {
    if (buildingHistory) return
    setBuildingHistory(true)
    setBackfillError(null)
    setBackfillNote(null)
    try {
      const { data } = await api.get<ForecastHistoryResponse>('/forecasts/history', {
        params: {
          days,
          page,
          limit: HISTORY_PAGE_SIZE,
          backfill: 'sync',
          backfillLimit: meta?.backfill?.batchSize || HISTORY_BACKFILL_BATCH_SIZE,
        },
        timeout: HISTORY_BACKFILL_TIMEOUT_MS,
      })
      setHistory(data.history || data.rows || [])
      setMeta(data.meta)
      setPagination(data.pagination || null)
      const generated = data.meta?.generated ?? 0
      setBackfillNote(
        generated > 0
          ? `Built ${generated} retrospective day${generated === 1 ? '' : 's'}.`
          : 'No further days could be built from the sales data available.'
      )
    } catch (err) {
      // The server writes each day as it goes, with no transaction and no
      // rollback, so "existing history is unchanged" was a claim the client
      // could not make and was most likely false.
      setBackfillError(
        isSessionRejection(err)
          ? 'Your sign-in has expired. Sign in again to carry on building history.'
          : 'We lost contact before this batch finished. Days built before that point were kept — this page has been reloaded to show exactly what landed.'
      )
      setRefreshNonce((value) => value + 1)
    } finally {
      setBuildingHistory(false)
    }
  }

  const varianceTone = useMemo(() => {
    if (!meta || meta.variance === 0) return 'neutral'
    return meta.variance > 0 ? 'good' : 'bad'
  }, [meta])
  const pageInfo = pagination || {
    total: history.length,
    page: 1,
    limit: HISTORY_PAGE_SIZE,
    pages: 1,
  }
  const rowStart = pageInfo.total === 0 ? 0 : (pageInfo.page - 1) * pageInfo.limit + 1
  const rowEnd = Math.min(pageInfo.page * pageInfo.limit, pageInfo.total)
  const showPagination = pageInfo.total > pageInfo.limit
  const selectPeriod = (nextDays: number) => {
    setDays(nextDays)
    setPage(1)
  }

  return (
    <AppLayout title="History">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm text-[#9E9E9E]">
            <HistoryIcon className="h-4 w-4 text-guava-red-text" />
            Live prediction history and clearly marked retrospective estimates
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((period) => (
              <Button
                key={period.days}
                variant={days === period.days ? 'default' : 'outline'}
                size="sm"
                onClick={() => selectPeriod(period.days)}
              >
                {period.label}
              </Button>
            ))}
          </div>
        </div>

        {loading && <LoadingState />}

        {!loading && error && (
          <div className="rounded-lg border border-guava-red/30 bg-guava-red/10 p-4 text-guava-red-text">
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setRefreshNonce((value) => value + 1)}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        )}


        {!loading && !error && history.length > 0 && meta && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              {meta.liveAccuracy || meta.backtestAccuracy ? (
                <>
                  {/* Lead with the average of each day's accuracy, not the
                      accuracy of the summed totals. Over a month a day forecast
                      20% high and a day 20% low cancel out to a near-perfect
                      aggregate, which reads as ~98% while typical days are far
                      further off. The daily average is what an operator
                      actually experiences when ordering stock. */}
                  <StatPanel
                    label="Live forecast accuracy"
                    value={formatPercent(meta.liveAccuracy?.avgDailyRevenueAccuracy)}
                    detail={`${meta.liveAccuracy?.rowCount
                      ? `Typical day across ${meta.liveAccuracy.rowCount} live day${meta.liveAccuracy.rowCount === 1 ? '' : 's'} · ${formatPercent(meta.liveAccuracy.overallRevenueAccuracy)} on period totals`
                      : 'No completed live forecasts in this period'}${excludedNote(meta.liveAccuracy)}`}
                  />
                  <StatPanel
                    label="Backtest accuracy"
                    value={formatPercent(meta.backtestAccuracy?.avgDailyRevenueAccuracy)}
                    detail={`${meta.backtestAccuracy?.rowCount
                      ? `Typical day across ${meta.backtestAccuracy.rowCount} retrospective day${meta.backtestAccuracy.rowCount === 1 ? '' : 's'} · ${formatPercent(meta.backtestAccuracy.overallRevenueAccuracy)} on period totals`
                      : 'No retrospective backtests in this period'}${excludedNote(meta.backtestAccuracy)}`}
                  />
                </>
              ) : (
                <StatPanel
                  label="Combined accuracy"
                  value={formatPercent(meta.avgDailyRevenueAccuracy ?? meta.avgRevenueAccuracy)}
                  detail={`Typical day · ${formatPercent(meta.overallRevenueAccuracy ?? meta.avgRevenueAccuracy)} on period totals`}
                />
              )}
              <StatPanel label="Combined predicted" value={formatCurrency(meta.totalPredictedRevenue)} />
              <StatPanel label="Combined actual" value={formatCurrency(meta.totalActualRevenue)} />
              <StatPanel
                label="Combined variance"
                value={`${formatCurrency(meta.variance)} (${formatPercent(meta.variancePct, true)})`}
                tone={varianceTone}
              />
            </div>

            {meta.backtestAccuracy?.note && <p className="text-xs text-muted">{meta.backtestAccuracy.note}</p>}
            <ModelLearningPanel sources={history} />

            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">Daily prediction history</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Showing {rowStart.toLocaleString('en-ZA')}-{rowEnd.toLocaleString('en-ZA')} of {pageInfo.total.toLocaleString('en-ZA')} completed trading days
                  </p>
                </div>
                {showPagination && (
                  <HistoryPagination
                    page={pageInfo.page}
                    pages={pageInfo.pages}
                    onPrevious={() => setPage(Math.max(1, pageInfo.page - 1))}
                    onNext={() => setPage(Math.min(pageInfo.pages, pageInfo.page + 1))}
                  />
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border bg-[#151515] text-left text-xs uppercase tracking-wide text-[#9E9E9E]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Weather</th>
                      <th className="px-4 py-3 font-semibold">Factors</th>
                      <th className="px-4 py-3 text-right font-semibold">Predicted</th>
                      <th className="px-4 py-3 text-right font-semibold">Actual</th>
                      <th className="px-4 py-3 text-right font-semibold">Variance</th>
                      <th className="px-4 py-3 text-right font-semibold">Accuracy</th>
                      <th className="px-4 py-3 text-right font-semibold">Txns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.map((row) => {
                      const labels = factorLabels(row)
                      const positiveVariance = row.variance >= 0
                      const VarianceIcon = positiveVariance ? ArrowUpRight : ArrowDownRight

                      return (
                        <tr key={`${row.forecastId}-${row.date}`} className="hover:bg-white/[0.03]">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-text">
                            <div>{formatDate(row.dateKey || row.date)}</div>
                            {row.origin === 'backfill' && (
                              <span className="mt-1 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-normal text-amber-200">
                                Retrospective backtest
                              </span>
                            )}
                          </td>
                          <td className="min-w-52 px-4 py-3 text-muted">
                            <div className="flex items-center gap-2">
                              <CloudRain className="h-4 w-4 shrink-0 text-[#9E9E9E]" />
                              <span>{weatherLabel(row)}</span>
                            </div>
                          </td>
                          <td className="min-w-72 px-4 py-3">
                            {labels.length === 0 ? (
                              <span className="text-muted">None</span>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {labels.slice(0, 4).map((label) => (
                                  <span
                                    key={label}
                                    className="rounded-full border border-border bg-[#1B1B1B] px-2 py-1 text-xs text-muted"
                                  >
                                    {label}
                                  </span>
                                ))}
                                {labels.length > 4 && (
                                  <span className="rounded-full border border-border bg-[#1B1B1B] px-2 py-1 text-xs text-muted">
                                    +{labels.length - 4}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                            {formatCurrency(row.predictedRevenue)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-text">
                            {formatCurrency(row.actualRevenue)}
                          </td>
                          <td
                            className={cn(
                              'whitespace-nowrap px-4 py-3 text-right font-medium',
                              positiveVariance ? 'text-guava-green' : 'text-guava-red-text'
                            )}
                          >
                            <span className="inline-flex items-center justify-end gap-1">
                              <VarianceIcon className="h-4 w-4" />
                              {formatCurrency(row.variance)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                            {formatPercent(row.revenueAccuracy)}
                            {row.countsTowardAccuracy === false && (
                              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted"
                                title="This day was still building history, so it is not in the accuracy figures.">
                                Not counted
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                            {row.transactionCount}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {showPagination && (
                <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
                  <span>
                    Page {pageInfo.page.toLocaleString('en-ZA')} of {pageInfo.pages.toLocaleString('en-ZA')}
                  </span>
                  <HistoryPagination
                    page={pageInfo.page}
                    pages={pageInfo.pages}
                    onPrevious={() => setPage(Math.max(1, pageInfo.page - 1))}
                    onNext={() => setPage(Math.min(pageInfo.pages, pageInfo.page + 1))}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {!loading && backfillError && (
          <div className="rounded-lg border border-guava-red/30 bg-guava-red/10 p-4 text-sm text-guava-red-text" role="alert">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{backfillError}</p>
            </div>
          </div>
        )}

        {!loading && !backfillError && backfillNote && (
          <div className="rounded-lg border border-guava-green/25 bg-guava-green/10 p-4 text-sm text-guava-green" role="status">
            {backfillNote}
          </div>
        )}

        {!loading && !error && meta?.pendingDays ? (
          <div className="rounded-lg border border-guava-yellow/30 bg-guava-yellow/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-guava-yellow">
                  {history.length === 0
                    ? `Check the model against your last ${meta.totalTradingDays} trading ${meta.totalTradingDays === 1 ? 'day' : 'days'}`
                    : 'More historical estimates are available'}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Showing {meta.totalRows} of {meta.totalTradingDays} completed trading
                  {' '}{meta.totalTradingDays === 1 ? 'day' : 'days'}.
                  Building a batch creates retrospective estimates marked as backtests; they are not original live predictions.
                </p>
                {/* Every other compute-ish action in the portal states its
                    credit cost, so silence here read as a bill of unknown size.
                    The backfill path does no metering at all. */}
                <p className="mt-1 text-sm text-muted">
                  Free — building history uses no Guava Credits. A batch of{' '}
                  {meta.backfill?.batchSize || HISTORY_BACKFILL_BATCH_SIZE} days can take up to a minute.
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={buildingHistory} onClick={buildNextHistoryBatch}>
                <RefreshCw className="h-4 w-4" />
                {buildingHistory
                  ? 'Building…'
                  : `Build next ${meta.backfill?.batchSize || HISTORY_BACKFILL_BATCH_SIZE}`}
              </Button>
            </div>
          </div>
        ) : null}

        {!loading && !error && history.length === 0 && !meta?.pendingDays && (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-[#9E9E9E]" />
            <p className="mt-3 font-medium text-text">No completed trading days found</p>
            <p className="mt-1 text-sm text-muted">Upload approved transaction data to start building history.</p>
            <Button asChild className="mt-4" size="sm">
              <Link to="/data-health">Open Data Health</Link>
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function HistoryPagination({
  page,
  pages,
  onPrevious,
  onNext,
}: {
  page: number
  pages: number
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        aria-label="Previous history page"
        onClick={onPrevious}
        disabled={page <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Next history page"
        onClick={onNext}
        disabled={page >= pages}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
