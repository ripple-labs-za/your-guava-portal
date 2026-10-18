import { TrendingUp, Star, Target } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Forecast } from '@/types'
import { forecastDateKey, parseDateOnly } from '@/lib/date'
import { ACCURACY_BAND_LABEL, ACCURACY_MIN_SAMPLE, accuracyBand, accuracyTextClass } from './accuracyBand'

function getDayName(dateStr: string): string {
  const date = parseDateOnly(dateStr)
  return date.toLocaleDateString('en-ZA', { weekday: 'long' })
}

interface Props {
  weekTotal: number
  peakDay: Forecast | null
  accuracy: number | null
  /**
   * How many matched days the average was computed over. The API returns them
   * and the page used to throw them away, so one lucky day rendered "88% ·
   * Strong" with exactly the authority of thirty days of evidence — under a
   * heading that also asserted a 30-day window.
   */
  matchedDays?: number | null
  /**
   * Where the figure comes from. A backfilled day was scored against sales the
   * model had not seen, so it measures something real — but retrospectively,
   * and the owner is entitled to know which they are looking at before they
   * trust it. See DECISIONS D-004.
   */
  basis?: 'live' | 'backtest' | 'none' | null
  itemAccuracy?: number | null
  itemAccuracyDays?: number
  excludedInsufficientDays?: number
  basisNote?: string | null
}

export function WeekHeader({
  weekTotal,
  peakDay,
  accuracy,
  matchedDays = null,
  basis = null,
  itemAccuracy = null,
  itemAccuracyDays,
  excludedInsufficientDays = 0,
  basisNote = null,
}: Props) {
  const accuracyColor = accuracyTextClass(accuracy)

  const accuracyLabel =
    accuracy === null ? 'Awaiting matched sales data' : `${Math.round(accuracy)}%`

  const hasEnoughSample = matchedDays == null || matchedDays >= ACCURACY_MIN_SAMPLE
  const accuracyStatus =
    accuracy === null ? '' : hasEnoughSample ? ACCURACY_BAND_LABEL[accuracyBand(accuracy)] : ''

  const dayWord = matchedDays === 1 ? 'day' : 'days'
  const sampleNote =
    matchedDays == null
      ? ''
      : matchedDays === 0
        ? 'No matched days yet'
        : basis === 'backtest'
          ? `Estimated from ${matchedDays} backtested ${dayWord} — not yet measured live`
          : `From ${matchedDays} matched ${dayWord}${
              hasEnoughSample ? '' : ' — too few for a verdict yet'
            }`

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Weekly predicted revenue */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-guava-red/10">
              <TrendingUp className="w-4 h-4 text-guava-red-text" />
            </div>
            <div>
              <p className="text-muted text-xs mb-1">Weekly predicted revenue</p>
              <p className="text-text text-xl font-semibold">
                R {weekTotal.toLocaleString('en-ZA')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Peak day */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-guava-green/10">
              <Star className="w-4 h-4 text-guava-green" />
            </div>
            <div>
              <p className="text-muted text-xs mb-1">Peak day</p>
              {peakDay ? (
                <p className="text-text text-xl font-semibold">
                  {getDayName(forecastDateKey(peakDay))}{' '}
                  <span className="text-sm text-muted font-normal">
                    — R {peakDay.totalPredictedRevenue.toLocaleString('en-ZA')}
                  </span>
                </p>
              ) : (
                <p className="text-muted text-sm">—</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 30-day accuracy */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[#555555]/20">
              <Target className="w-4 h-4 text-muted" />
            </div>
            <div>
              <p className="text-muted text-xs mb-1">30-day accuracy</p>
              <p className={`text-xl font-semibold ${accuracyColor}`}>
                {accuracyLabel}
                {accuracyStatus && (
                  <span className="text-xs font-normal text-muted ml-2">
                    {accuracyStatus}
                  </span>
                )}
              </p>
              {sampleNote && <p className="text-muted text-xs mt-1">{sampleNote}</p>}
              {itemAccuracy != null && <p className="text-muted text-xs mt-1">Per item: {Math.round(itemAccuracy)}%</p>}
              {itemAccuracy != null && <p className="text-muted text-xs mt-1">How close each menu item was; units can match overall while single items are off.</p>}
              {itemAccuracy != null && itemAccuracyDays != null && (
                <p className="text-muted text-xs mt-1">Per-item figure from {itemAccuracyDays} day{itemAccuracyDays === 1 ? '' : 's'}.</p>
              )}
              {excludedInsufficientDays > 0 && (
                <p className="text-muted text-xs mt-1">{excludedInsufficientDays} building-history day{excludedInsufficientDays === 1 ? '' : 's'} not counted.</p>
              )}
              {basis === 'backtest' && basisNote && <p className="text-muted text-xs mt-1">{basisNote}</p>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
