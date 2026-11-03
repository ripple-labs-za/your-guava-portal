import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { accuracyTextClass } from '@/components/forecasts/accuracyBand'

/** One cafe-local Monday-start week of GET /forecasts/accuracy `weekly` (L-4), oldest first. */
export interface AccuracyWeek {
  weekStart: string
  days: number
  avgAccuracy: number | null
  avgItemAccuracy?: number | null
  basis: 'live' | 'backtest'
}

const formatWeek = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

/**
 * Forecast accuracy by week (#117). Uses the same definition and the same name as Planning's figure, from the same
 * endpoint, so History and Planning can never show two different "accuracy" numbers for the same days. Renders nothing
 * until the endpoint reports weeks, and says nothing at all if it cannot be reached rather than implying a poor model.
 */
export function WeeklyAccuracy() {
  const [weeks, setWeeks] = useState<AccuracyWeek[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api
      .get<{ weekly?: AccuracyWeek[] }>('/forecasts/accuracy', { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setWeeks(Array.isArray(data.weekly) ? data.weekly : [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setWeeks(null)
      })
    return () => controller.abort()
  }, [])

  const scored = (weeks ?? []).filter((week) => week.days > 0 && week.avgAccuracy != null)
  if (scored.length === 0) return null

  return (
    <section aria-labelledby="weekly-accuracy-heading" className="rounded-lg border border-border bg-surface p-4">
      <h2 id="weekly-accuracy-heading" className="text-sm font-semibold text-text">Forecast accuracy by week</h2>
      <p className="mt-0.5 text-xs text-muted">
        The same forecast accuracy Planning shows, week by week. Backtested weeks are estimates, not yet measured live.
      </p>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
        {scored.map((week) => (
          <li key={week.weekStart} className="min-w-0 break-words rounded-md border border-border bg-[#111111] px-3 py-2">
            <p className="text-xs text-muted">Week of {formatWeek(week.weekStart)}</p>
            <p className={`text-lg font-semibold ${accuracyTextClass(week.avgAccuracy)}`}>{Math.round(week.avgAccuracy as number)}%</p>
            <p className="text-xs text-muted">
              {week.days} {week.days === 1 ? 'day' : 'days'}
              {week.basis === 'backtest' ? ' · backtest' : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
