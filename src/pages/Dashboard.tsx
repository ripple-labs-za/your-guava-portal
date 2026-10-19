import { useState, useCallback, useEffect, useMemo } from 'react'
import { ClosedDayNotice } from '@/components/forecasts/ClosedDayNotice'
import { SetupChecklistCard, type SetupItem } from '@/components/SetupChecklistCard'
import { Link } from 'react-router'
import {
  TrendingUp,
  Clock,
  Zap,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Sun,
  Wind,
  Upload,
  AlertTriangle,
  Coffee,
  Snowflake,
  UtensilsCrossed,
  ShoppingBag,
  Crown,
  CakeSlice,
  Croissant,
  Sandwich,
  Cookie,
  GlassWater,
  Leaf,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import type { Forecast, ForecastItem, TransactionStats } from '@/types'
import { cn } from '@/lib/utils'
import { forecastDateKey, parseDateOnly } from '@/lib/date'
import { isOccasionalSeller } from '@/lib/forecastItems'
import { formatZAR } from '@/lib/money'
import { accuracyBadgeVariant } from '@/components/forecasts/accuracyBand'
import { classifyForecastFactors, formatPlan } from '@/components/forecasts/factorState'
import { forecastBasisSentence } from '@/components/forecasts/forecastBasis'
import {
  isLoadSheddingAvailable,
  isWeatherAvailable,
  loadSheddingUnavailableReason,
  signalFix,
  weatherUnavailableReason,
  weatherTempLabel,
} from '@/lib/forecastSignals'

// Item categorisation

type ItemCategory = 'coffee' | 'cold_drink' | 'food' | 'water' | 'retail' | 'other'

const CATEGORY_COLORS: Record<ItemCategory, string> = {
  coffee: '#D43D3D',
  cold_drink: '#4A9ECC',
  food: '#E58A3C',
  water: '#4A9ECC',
  retail: '#8B7355',
  other: '#888888',
}
function categoriseItem(name: string): ItemCategory {
  const n = name.toLowerCase()
  if (n.includes('still') || n.includes('sparkling') || n.includes('water')) return 'water'
  if (n.includes('iced') || n.includes('cold brew') || n.includes('iced coffee')) return 'cold_drink'
  if (n.includes('matcha') && n.includes('iced')) return 'cold_drink'
  if (
    n.includes('flat white') || n.includes('long white') || n.includes('cappuccino') ||
    n.includes('cortado') || n.includes('espresso') || n.includes('americano') ||
    n.includes('black coffee') || n.includes('mocha') || n.includes('hot choc') ||
    n.includes('latte') || n.includes('pour over') || n.includes('red espresso') ||
    n.includes('matcha')
  ) return 'coffee'
  if (
    n.includes('muffin') || n.includes('croissant') || n.includes('brownie') ||
    n.includes('cookie') || n.includes('cake') || n.includes('sandwich') ||
    n.includes('crunch') || n.includes('lemon') || n.includes('banana') ||
    n.includes('simple square') || n.includes('poppyseed')
  ) return 'food'
  if (n.includes('250g') || n.includes('750g') || n.includes('blend')) return 'retail'
  return 'other'
}

function getItemColor(name: string): string {
  const n = name.toLowerCase()
  // Each item gets a distinct color
  if (n.includes('long white')) return '#D43D3D'
  if (n.includes('flat white') && !n.includes('honey')) return '#E06040'
  if (n.includes('flat white') && n.includes('honey')) return '#D4A43D'
  if (n.includes('black coffee')) return '#C07A3E'
  if (n.includes('cortado')) return '#CC7744'
  if (n.includes('espresso')) return '#B5651D'
  if (n.includes('mocha')) return '#A5654E'
  if (n.includes('hot choc')) return '#8B6B47'
  if (n.includes('pour over')) return '#B8860B'
  if (n.includes('red espresso')) return '#C62828'
  if (n.includes('muffin') || n.includes('banana')) return '#E58A3C'
  if (n.includes('croissant')) return '#D4A43D'
  if (n.includes('brownie')) return '#A8845C'
  if (n.includes('cake')) return '#C4853A'
  if (n.includes('cookie') || n.includes('crunch') || n.includes('simple square')) return '#D4A43D'
  if (n.includes('sandwich')) return '#7CB87A'
  if (n.includes('lemon') || n.includes('poppyseed')) return '#E5C43C'
  if (n.includes('still') || n.includes('water')) return '#5BB8E8'
  if (n.includes('sparkling')) return '#4A9ECC'
  if (n.includes('iced') || n.includes('cold brew')) return '#4A9ECC'
  if (n.includes('matcha') && n.includes('iced')) return '#3D9ECE'
  if (n.includes('matcha')) return '#7CB87A'
  return CATEGORY_COLORS[categoriseItem(name)]
}

function getItemIcon(name: string) {
  const n = name.toLowerCase()
  // Specific icons per item type
  if (n.includes('muffin') || n.includes('banana')) return CakeSlice
  if (n.includes('croissant')) return Croissant
  if (n.includes('brownie') || n.includes('cake')) return CakeSlice
  if (n.includes('cookie') || n.includes('crunch') || n.includes('simple square')) return Cookie
  if (n.includes('sandwich')) return Sandwich
  if (n.includes('lemon') || n.includes('poppyseed')) return CakeSlice
  if (n.includes('still') || n.includes('sparkling') || n.includes('water')) return GlassWater
  if (n.includes('iced') || n.includes('cold brew')) return Snowflake
  if (n.includes('matcha')) return Leaf
  if (n.includes('250g') || n.includes('750g')) return ShoppingBag
  if (categoriseItem(name) === 'coffee') return Coffee
  return UtensilsCrossed
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function getDayLabel(date: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'TMRW'
  return date.toLocaleDateString('en-ZA', { weekday: 'short' }).toUpperCase()
}

// Circular gauge

function CircularGauge({ value, color, size = 48 }: { value: number; color: string; size?: number }) {
  const strokeWidth = 4
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, Math.abs(value)))
  const offset = circumference - (pct / 100) * circumference

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#2A2A2A" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-300"
      />
    </svg>
  )
}

// Sub-components

function KpiCard({
  label, value, sub, icon: Icon, accent,
}: {
  label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; accent: string
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-muted text-xs font-medium uppercase tracking-wider mb-1">{label}</p>
            <p className="text-text text-2xl font-bold tracking-tight">{value}</p>
            {sub && <p className="text-muted text-xs mt-1">{sub}</p>}
          </div>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}18` }}>
            <Icon className="w-4 h-4" style={{ color: accent }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ForecastStatusCard({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-10 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-[#111111]">
          <AlertTriangle className="h-6 w-6 text-[#9E9E9E]" />
        </div>
        <h2 className="mb-1 text-base font-semibold text-text">{title}</h2>
        <p className="max-w-md text-sm text-muted">{message}</p>
        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  )
}

function WeatherCard({ signals, locationLabel }: { signals: Forecast['signals']; locationLabel: string }) {
  const { weather } = signals
  const weatherAvailable = isWeatherAvailable(weather)
  const weatherFix = weatherAvailable ? null : signalFix(weatherUnavailableReason(weather))
  const loadSheddingAvailable = isLoadSheddingAvailable(signals)
  const condition = weatherAvailable ? weather.condition.toLowerCase() : ''
  const WeatherIcon = condition.includes('storm')
    ? CloudLightning
    : condition.includes('rain')
      ? CloudRain
      : condition.includes('cloud')
        ? CloudSun
        : Sun

  return (
    <Card className="bg-gradient-to-br from-[#1A2030] to-surface border-[#2A3048]">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-end gap-3">
              <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-xl bg-[#4A9ECC]/10">
                <WeatherIcon className="h-7 w-7 text-[#4A9ECC]" />
              </div>
              {weatherAvailable ? (
                <div>
                  <span className="text-4xl font-bold text-text">{weatherTempLabel(weather)}</span>
                  <p className="text-[#AAB8CC] text-sm">{weather.condition}</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-text">Weather unavailable</p>
                  <p className="mt-1 max-w-xs text-xs text-muted">{weatherUnavailableReason(weather)}</p>
                  {/* Only when it is the owner's to fix. See signalFix. */}
                  {weatherFix && (
                    <Link
                      to={weatherFix.to}
                      className="mt-1 inline-block text-xs font-medium text-guava-red-text underline-offset-4 hover:underline"
                    >
                      {weatherFix.action}
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
          {loadSheddingAvailable && signals.loadSheddingStage > 0 ? (
            <div className="bg-guava-yellow/10 border border-guava-yellow/20 rounded-lg px-2.5 py-2 text-center">
              <Zap className="w-4 h-4 text-guava-yellow mx-auto mb-0.5" />
              <p className="text-guava-yellow text-xs font-bold">Stage {signals.loadSheddingStage}</p>
            </div>
          ) : !loadSheddingAvailable ? (
            <div className="max-w-36 rounded-lg border border-border bg-surface/60 px-2.5 py-2 text-center">
              <Zap className="mx-auto mb-0.5 h-4 w-4 text-muted" />
              <p className="text-xs font-medium text-muted">Load shedding unavailable</p>
              {/* Was a `title` on a plain div: invisible to touch, which is
                  where a cafe owner reads this, and to screen readers. */}
              <p className="mt-0.5 text-[10px] leading-tight text-muted">
                {loadSheddingUnavailableReason(signals)}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4 pt-3 border-t border-[#2A3048]">
          {weatherAvailable && typeof weather.humidity === 'number' && Number.isFinite(weather.humidity) && (
            <div className="flex items-center gap-1.5">
              <Wind className="w-3.5 h-3.5 text-[#4A9ECC]" />
              <span className="text-muted text-xs">{weather.humidity}% humidity</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Droplets className="w-3.5 h-3.5 text-muted" />
            <span className="text-muted text-xs">{locationLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ImpactFactorsCard({ forecast }: { forecast: Forecast }) {
  const colors: Record<string, string> = {
    weather: '#4A9ECC',
    loadShedding: '#EF476F',
    holiday: '#FFD166',
    payday: '#4DA63B',
    events: '#9B59B6',
    learning: '#FF8A3D',
  }
  const compactImpact = (adjustmentPct?: number | null, effect?: string) => {
    if (typeof adjustmentPct === 'number') {
      const rounded = Number(adjustmentPct.toFixed(1))
      return `${rounded > 0 ? '+' : ''}${rounded}%`
    }
    return effect && effect !== 'no effect' ? 'varies' : 'active'
  }
  const displayFactors = classifyForecastFactors(forecast).map((factor) => {
    const active = factor.state === 'active'
    const rawPct = Math.abs(factor.adjustmentPct ?? 0)
    return {
      key: factor.key,
      label: factor.label,
      pct: active ? Math.min(100, rawPct) : 0,
      impact:
        factor.state === 'locked'
          ? formatPlan(factor.requiredPlan)
          : factor.state === 'off'
            ? 'Off'
            : active
              ? compactImpact(factor.adjustmentPct, factor.effect)
              : '0%',
      detail: factor.detail,
      color: colors[factor.key] ?? '#9B59B6',
      active,
      locked: factor.state === 'locked',
      off: factor.state === 'off',
    }
  })
  const activeCount = displayFactors.filter((factor) => factor.active).length
  const basis = forecastBasisSentence(forecast)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Sales Impact Factors</CardTitle>
          <span className="text-muted text-xs">{activeCount} active</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Six grey zeros and three upsell badges is what an entry-plan cafe
            sees here, and it reads as a broken forecast. The truthful statement
            — what the number is actually made of — was never made anywhere in
            the product, though the engine has always sent it. */}
        {activeCount === 0 && basis && (
          <p className="mb-4 rounded-lg border border-border bg-[#111111] px-3 py-2 text-[11px] leading-relaxed text-muted">
            <span className="text-text">Nothing adjusted this forecast today.</span> {basis}
          </p>
        )}
        {displayFactors.length === 0 ? (
          <p className="py-5 text-center text-xs text-muted">
            Factor detail is unavailable for this forecast.
          </p>
        ) : (
        <div className="grid grid-cols-3 gap-3">
          {displayFactors.map((f) => (
            <div key={f.key} className="flex flex-col items-center text-center">
              <div className="relative mb-1.5">
                <CircularGauge value={f.pct} color={f.active ? f.color : '#2A2A2A'} size={48} />
                <span
                  className="absolute inset-0 flex items-center justify-center px-1 text-[10px] font-bold leading-none"
                  style={{ color: f.active ? f.color : f.locked || f.off ? '#9E9E9E' : '#8A8A8A' }}
                >
                  {f.impact}
                </span>
              </div>
              <span className={cn('max-w-full text-[10px] leading-tight', f.locked || f.off ? 'text-[#949494]' : 'text-muted')}>
                {f.label}
              </span>
              {/* The reason used to live only in a `title` on a non-focusable
                  div: unreachable on a phone, which is where an owner reads
                  this. "Unlock on Growth" and "Cafe coordinates are not
                  configured" are the whole point of a greyed-out gauge. */}
              {f.detail && (
                <span className="mt-0.5 max-w-full text-[10px] leading-tight text-[#949494]">
                  {f.detail}
                </span>
              )}
            </div>
          ))}
        </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Splits the day's items by how much volume stands behind the number.
 *
 * Roughly two thirds of a cafe's menu sells under two units a day, where
 * day-to-day randomness swamps any forecast (measured error above 100%).
 * Printing "1" next to those in the same card as a 37-unit flat white implies
 * a precision that does not exist, and buries the handful of lines that
 * actually drive the order. The quiet ones move to a compact list with honest
 * wording instead of a hero number. The split is by volume, not confidence:
 * the backend also caps confidence by evidence, so a 20-a-day line with one
 * week of history is `low` yet is anything but occasional.
 */
function PredictedOutput({
  items,
  coverage,
}: {
  items: ForecastItem[]
  coverage?: Forecast['forecastCoverage']
}) {
  const planned = items.filter((item) => !isOccasionalSeller(item))
  const occasional = items.filter((item) => isOccasionalSeller(item))
  const gradedItems = items.filter((item) => item.confidence != null)
  // The backend caps confidence by evidence on purpose, so a cafe one week in
  // gets `low` on every line however busy it is. Saying so once at the top is
  // more honest than twenty identical annotations.
  const allLowConfidence =
    gradedItems.length > 0 && gradedItems.every((item) => item.confidence === 'low')
  const itemsTruncated =
    coverage != null &&
    typeof coverage.itemCount === 'number' &&
    typeof coverage.storedItemCount === 'number' &&
    coverage.storedItemCount < coverage.itemCount

  return (
    <div className="space-y-5">
      {allLowConfidence && (
        <p className="text-xs text-muted">
          Every line below is low confidence — there is not much matching history behind these
          numbers yet, whatever the volume.
        </p>
      )}
      {itemsTruncated && coverage && (
        <p className="text-xs text-muted">
          Showing the {coverage.storedItemCount} largest of {coverage.itemCount} forecast lines.
          Forecast revenue and total items cover all {coverage.itemCount}.
        </p>
      )}
      {planned.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {planned.map((item) => (
            <ItemCard
              key={item.itemName}
              itemName={item.itemName}
              predictedQty={item.predictedQty}
              // When every line is low the grid says so once at the top, so
              // the tiles say nothing at all — repeating it twenty times in
              // text only a screen reader hears is the same flattening the
              // banner exists to avoid.
              confidence={allLowConfidence ? undefined : item.confidence}
              showNote={!allLowConfidence && item.confidence === 'low'}
            />
          ))}
        </div>
      )}

      {occasional.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#8A8A8A]">
              Occasional sellers
            </h4>
            <span className="text-[11px] text-[#8A8A8A]">
              under 2 a day — keep a few on hand rather than ordering to a number
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {occasional.map((item) => (
              <span
                key={item.itemName}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-[#161616] px-2.5 py-1 text-xs text-muted"
                title={`${item.itemName} — typically ${item.predictedQty} a day`}
              >
                <span className="truncate max-w-45">{item.itemName}</span>
                {/* "~0" reads as broken; for these lines the honest signal is
                    "some days none", not a number to order against. */}
                <span className="tabular-nums text-[#949494]">
                  {item.predictedQty > 0 ? `~${item.predictedQty}` : 'rare'}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ItemCard({
  itemName,
  predictedQty,
  confidence,
  showNote = false,
}: {
  itemName: string
  predictedQty: number
  confidence?: ForecastItem['confidence']
  /** Whether `low` is printed. False when every line is low and the grid says
   *  so once at the top; the grade is still announced either way. */
  showNote?: boolean
}) {
  const color = getItemColor(itemName)
  const Icon = getItemIcon(itemName)

  return (
    <div className="bg-[#111111] border border-border rounded-xl p-4 text-center hover:border-[#3A3A3A] transition-colors">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2"
        style={{ backgroundColor: `${color}18` }}
      >
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="text-3xl font-bold mb-1 tabular-nums" style={{ color }}>
        {predictedQty}
      </div>
      {/* Keep the variant. "Iced Coffee (Vanilla)" and "Iced Coffee (None)" are
          different products with different numbers; stripping the bracket
          rendered them as identical cards nobody could act on. */}
      <div className="text-muted text-[11px] leading-tight truncate" title={itemName}>
        {itemName}
      </div>
      {/* The engine grades every line and the portal used to discard it, so a
          line with three months behind it and one with a fortnight printed
          identically at 3xl. Only `low` earns a note: annotating all three
          grades would flatten the signal again.

          A grade that is never printed is also never announced, though, so a
          screen reader heard the same "33 Flat White" for both. The other two
          grades are carried in text only assistive technology reads, which
          keeps the tile's visual restraint without withholding the grade. */}
      {showNote ? (
        <div className="text-guava-yellow text-[10px] leading-tight mt-1">low confidence</div>
      ) : (
        confidence != null && <span className="sr-only">{confidence} confidence</span>
      )}
    </div>
  )
}

// Main dashboard

export default function Dashboard() {
  const [fallbackForecast, setFallbackForecast] = useState<Forecast | null>(null)
  const [weekForecasts, setWeekForecasts] = useState<Forecast[]>([])
  const [stats, setStats] = useState<TransactionStats | null>(null)
  const [locationLabel, setLocationLabel] = useState('Cafe location')
  const [forecastLoadFailed, setForecastLoadFailed] = useState(false)
  const [statsLoadFailed, setStatsLoadFailed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasData, setHasData] = useState(true)
  const [selectedDayIdx, setSelectedDayIdx] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      setForecastLoadFailed(false)
      setStatsLoadFailed(false)
      try {
        const [weekRes, statsRes, cafeRes] = await Promise.all([
          api.get('/forecasts/week')
            .then((res) => ({ res, failed: false }))
            .catch(() => ({ res: null, failed: true })),
          api.get('/transactions/stats')
            .then((res) => ({ res, failed: false }))
            .catch(() => ({ res: null, failed: true })),
          api.get('/cafe/me').catch(() => null),
        ])

        let todayFallback: Forecast | null = null
        let todayFailed = false
        const loadedWeek = Array.isArray(weekRes.res?.data?.forecasts) ? weekRes.res.data.forecasts : []

        if (loadedWeek.length === 0) {
          try {
            const todayRes = await api.get('/forecasts/today')
            todayFallback = todayRes.data?.forecast || null
          } catch {
            todayFailed = true
          }
        }

        if (cancelled) return

        const loadedStats = statsRes.res?.data?.stats || null
        const cafe = cafeRes?.data?.cafe
        const nextLocationLabel = [cafe?.location?.address, cafe?.location?.city].filter(Boolean).join(', ')

        setWeekForecasts(loadedWeek)
        setFallbackForecast(todayFallback)
        setForecastLoadFailed(
          loadedWeek.length === 0 && !todayFallback && (weekRes.failed || todayFailed)
        )
        setStatsLoadFailed(statsRes.failed)
        setSelectedDayIdx((current) => (
          loadedWeek.length === 0 ? 0 : Math.min(current, loadedWeek.length - 1)
        ))
        setStats(loadedStats)
        setLocationLabel(nextLocationLabel || cafe?.name || 'Cafe location')

        const forecastHasItems = (loadedWeek[0]?.items.length || todayFallback?.items.length || 0) > 0
        setHasData(statsRes.failed || (loadedStats?.totalTransactions || 0) > 0 || forecastHasItems)
      } catch {
        if (!cancelled) {
          setForecastLoadFailed(true)
          setHasData(false)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const activeForecast = weekForecasts[selectedDayIdx] || fallbackForecast
  const activeForecastHasItems = (activeForecast?.items.length ?? 0) > 0
  const topItem = activeForecast?.items.length
    ? activeForecast.items.reduce((a, b) => a.predictedQty > b.predictedQty ? a : b)
    : undefined
  // The backend stores only the 25 largest lines but accumulates revenue and
  // `forecastCoverage.totalPredictedQty` over every forecastable item. Summing
  // the stored array put a short Total Items beside a complete Forecast Revenue
  // — two headline numbers computed over different item sets, with nothing on
  // screen to reconcile them.
  const coverage = activeForecast?.forecastCoverage
  const totalItems =
    typeof coverage?.totalPredictedQty === 'number'
      ? coverage.totalPredictedQty
      : activeForecast?.items.reduce((sum, i) => sum + i.predictedQty, 0) ?? 0
  // The two settings a cafe can finish its first upload without, both of which
  // quietly cost it forecast quality. Derived from the week already loaded, so
  // there is no extra request and no second source of truth: the weather
  // signal is what knows the coordinates are missing, and the engine is what
  // knows a closed day contradicts the sales record.
  const setupItems = useMemo<SetupItem[]>(() => {
    const items: SetupItem[] = []
    const anyDay = weekForecasts[0] || fallbackForecast
    const weatherFix = anyDay && !isWeatherAvailable(anyDay.signals.weather)
      ? signalFix(weatherUnavailableReason(anyDay.signals.weather))
      : null
    if (weatherFix) {
      items.push({
        id: 'location',
        label: "Set your cafe's location so weather can adjust forecasts",
        href: weatherFix.to,
      })
    }
    const contradicted = weekForecasts.find((f) => f.availability?.contradictsHistory)
    if (contradicted) {
      // Name the weekday. "A day is set to closed" makes the owner hunt for
      // which switch, on a screen with seven of them.
      const dayName = parseDateOnly(forecastDateKey(contradicted)).toLocaleDateString('en-ZA', {
        weekday: 'long',
      })
      items.push({
        id: 'hours',
        label: `${dayName} is set to closed but you had sales — check trading hours`,
        href: '/settings?section=general',
      })
    }
    return items
  }, [weekForecasts, fallbackForecast])

  const isClosedDay = activeForecast?.availability?.status === 'closed'
  const isAwaitingHistory = activeForecast?.availability?.status === 'insufficient_data'
  // Average the week over trading days only, as Planning does. A closed day is
  // not a R0 day, and the historical stats average spreads revenue over the
  // whole calendar span, so either would drag the figure well under a real day.
  // A day still building history is not a R0 day either — it is the absence of
  // a prediction, and Planning already refuses to sum it.
  const tradingForecasts = weekForecasts.filter(
    (wf) =>
      wf.availability?.status !== 'closed' && wf.availability?.status !== 'insufficient_data'
  )
  const tradingDayAvg = tradingForecasts.length > 0
    ? tradingForecasts.reduce((sum, wf) => sum + (wf.totalPredictedRevenue || 0), 0) / tradingForecasts.length
    : null
  const kpis = [
    {
      label: 'Forecast Revenue',
      // R0 on a day the engine could not answer is not a forecast of nothing,
      // and this is the most prominent figure on the screen. Planning refuses
      // to print it; Today must not print it either.
      value:
        activeForecast && !(isAwaitingHistory && activeForecast.totalPredictedRevenue === 0)
          ? formatZAR(activeForecast.totalPredictedRevenue)
          : '-',
      sub:
        isAwaitingHistory
          ? 'Not enough history for this day yet'
          : tradingDayAvg != null
            ? `Avg: ${formatZAR(tradingDayAvg)}/day`
            : undefined,
      icon: TrendingUp,
      accent: '#4DA63B',
    },
    {
      label: 'Forecast Day',
      // Use the cafe-local calendar key, not the stored instant. A forecast for
      // 14 Aug is stored at local midnight (22:00 UTC on the 13th), and
      // parseDateOnly matches the leading YYYY-MM-DD of that ISO string, so
      // reading `.date` here labelled every forecast with the previous day.
      value: activeForecast ? formatDate(parseDateOnly(forecastDateKey(activeForecast))) : '-',
      sub: activeForecast ? getDayLabel(parseDateOnly(forecastDateKey(activeForecast))) : undefined,
      icon: Clock,
      accent: '#FFD166',
    },
    {
      label: 'Top Item',
      value: topItem ? topItem.itemName : '-',
      sub: topItem ? `${topItem.predictedQty} units predicted` : undefined,
      icon: Crown,
      accent: '#D43D3D',
    },
    {
      label: 'Total Items',
      value: Math.round(totalItems).toLocaleString(),
      sub: coverage?.itemCount
        ? `across ${coverage.itemCount} forecast ${coverage.itemCount === 1 ? 'line' : 'lines'}`
        : stats
          ? `${stats.totalTransactions.toLocaleString()} historical transactions`
          : undefined,
      icon: Zap,
      accent: '#4A9ECC',
    },
  ]

  // Empty state
  if (!isLoading && !hasData) {
    return (
      <AppLayout title="Today">
        <div className="flex flex-col items-center justify-center min-h-100 text-center">
          <div className="w-14 h-14 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7 text-muted" />
          </div>
          <h2 className="text-text text-lg font-semibold mb-2">No data yet</h2>
          <p className="text-muted text-sm mb-6 max-w-xs">Upload your transaction data to start generating forecasts.</p>
          <Button asChild>
            <Link to="/data-health"><Upload className="w-4 h-4" />Upload Sales Data</Link>
          </Button>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Today">
      {/* KPI Row */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6"
        role={isLoading ? 'status' : undefined}
        aria-busy={isLoading || undefined}
      >
        {isLoading
          ? (
            <>
              <span className="sr-only">Loading today&apos;s forecast</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="pt-5 pb-5"><Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-32 mb-2" /><Skeleton className="h-3 w-20" /></CardContent></Card>
              ))}
            </>
          )
          : kpis.map((kpi) => <KpiCard key={kpi.label} {...kpi} />)}
      </div>

      {/* Day Selector. Selection used to be carried by colour alone: no
          aria-pressed, no group name, no announcement, and the whole page below
          silently rewrote itself on every press. */}
      <div
        className="flex items-center gap-2 mb-6 overflow-x-auto pb-1"
        role="group"
        aria-label="Forecast day"
      >
        {weekForecasts.length > 0
          ? weekForecasts.map((wf, idx) => {
              const d = parseDateOnly(forecastDateKey(wf))
              const selected = selectedDayIdx === idx
              return (
                <button
                  key={idx}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedDayIdx(idx)}
                  className={cn(
                    'flex flex-col items-center px-3.5 py-2 rounded-lg border text-center shrink-0 transition-colors min-w-16',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red',
                    selected
                      // Solid rather than /40: the alpha border measured 1.93:1
                      // against the page, well under the 3:1 a state indicator
                      // needs, so the only cue that a day was selected failed.
                      ? 'bg-guava-green/10 border-guava-green text-guava-green'
                      : 'bg-[#111111] border-border text-muted hover:text-text hover:border-[#3A3A3A]'
                  )}
                >
                  <span className="text-xs font-bold tracking-wide">{getDayLabel(d)}</span>
                  {/* opacity-70 dropped the date to 3.39:1 on the selected day's
                      tinted ground and 3.94:1 on the unselected one — both under
                      4.5:1, on the smallest text in the product. The date is how
                      an owner knows which day they are ordering for, so it has to
                      be legible; it inherits the button's colour instead. */}
                  <span className="text-[10px] mt-0.5">{formatDate(d)}</span>
                </button>
              )
            })
          : isLoading
            ? Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="w-16 h-14 rounded-lg shrink-0" />)
            : null}
      </div>

      {/* Pressing a day rewrites the KPIs, the item grid, the weather card and
          the factors card. Say which day is on screen now. */}
      <p className="sr-only" role="status" aria-live="polite">
        {activeForecast
          ? `Showing ${formatDate(parseDateOnly(forecastDateKey(activeForecast)))}`
          : ''}
      </p>

      {!isLoading && !activeForecast && (
        <ForecastStatusCard
          title={statsLoadFailed ? 'Dashboard data unavailable' : forecastLoadFailed ? 'Forecast unavailable' : 'No forecast ready yet'}
          message={
            statsLoadFailed
              ? 'The portal could not verify your transaction history or load a forecast. Try again before treating this as an empty account.'
              : forecastLoadFailed
              ? 'Your sales data is safe, but the forecast could not be loaded just now. Try again in a moment; if it keeps happening, tell us on the Improvements page.'
              : 'Your sales data is available, but there is not enough matched history yet to build today\'s item forecast.'
          }
          action={statsLoadFailed || forecastLoadFailed ? <Button onClick={reload}>Try again</Button> : undefined}
        />
      )}

      {!isLoading && statsLoadFailed && activeForecast && (
        <div className="mb-5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="status">
          The forecast loaded, but the historical transaction summary is temporarily unavailable.
        </div>
      )}

      {/* Above the numbers: what the numbers are missing comes before the
          numbers themselves. Dismissible, and per item, so it does not become
          a permanent fixture for someone who has read it. */}
      {!isLoading && <SetupChecklistCard items={setupItems} />}

      {/* The engine flags a day it cannot yet stand behind. Planning already
          says so; Today is the screen people actually order from, so it has to
          say so too rather than presenting the same numbers unqualified. */}
      {!isLoading && activeForecast?.availability?.status === 'insufficient_data' && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <span className="font-semibold">Not enough history yet.</span>{' '}
          {/* The engine's own words. The old fallback asserted "three
              comparable weeks", but the requirement is dynamic — an owner who
              narrows the history lookback on Factors is chasing a different
              number, and the backend fixed exactly this incoherence. */}
          {activeForecast.availability.reason
            ? `${activeForecast.availability.reason}. `
            : 'This day does not yet have enough comparable trading days of sales. '}
          Treat these numbers as a rough starting point, not a prep list to order against.
        </div>
      )}

      {/* Predicted Output */}
      {!isLoading && activeForecast && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-text text-sm font-semibold uppercase tracking-wider">
              Predicted Output
            </h2>
            <div className="flex items-center gap-3">
              {isClosedDay && <Badge variant="destructive">Closed</Badge>}
              {activeForecast.totalPredictedRevenue > 0 && (
                <span className="text-guava-green text-sm font-bold">
                  Target {formatZAR(activeForecast.totalPredictedRevenue)}
                </span>
              )}
              {/* Graded, not always green: a 41% day used to wear the same
                  success badge as a 94% one, on the screen people order from.
                  And `accuracy && ...` rendered a bare `0` glyph for a zero. */}
              {activeForecast.accuracy != null && (
                <Badge variant={accuracyBadgeVariant(activeForecast.accuracy)} className="text-xs">
                  {activeForecast.accuracy}% accuracy
                </Badge>
              )}
            </div>
          </div>
          {/* A closed day has no items because nobody is trading, not because
              history is thin. Say so, as Planning does, with the engine's reason. */}
          {isClosedDay ? (
            activeForecast.availability?.contradictsHistory ? (
              /* Today is the screen people order from. A zero here that the
                 cafe's own sales contradict has to read as a broken setting
                 with a way out, not as a day off. */
              <ClosedDayNotice availability={activeForecast.availability} />
            ) : (
              <ForecastStatusCard
                title="No trading forecast"
                message={activeForecast.availability?.reason || 'This café is closed for the day.'}
              />
            )
          ) : activeForecastHasItems ? (
            <PredictedOutput items={activeForecast.items} coverage={activeForecast.forecastCoverage} />
          ) : (
            <ForecastStatusCard
              title="No item predictions for this day"
              message="Guava has transaction history, but not enough matching day-of-week item history for this selected day yet. Uploading more POS data will improve this."
            />
          )}

          {/* Signals strip */}
          <div className="flex flex-wrap gap-2 mt-4">
            {activeForecast.signals.isPayday && (
              <div className="flex items-center gap-1.5 bg-guava-green/10 border border-guava-green/20 rounded-md px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-guava-green" />
                <span className="text-guava-green text-xs font-medium">Payday</span>
              </div>
            )}
            {activeForecast.signals.isPublicHoliday && (
              <div className="flex items-center gap-1.5 bg-guava-red/10 border border-guava-red/20 rounded-md px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-guava-red" />
                <span className="text-guava-red-text text-xs font-medium">Public Holiday</span>
              </div>
            )}
            {activeForecast.signals.events && activeForecast.signals.events.length > 0 && (
              <div className="flex items-center gap-1.5 bg-[#9B59B6]/10 border border-[#9B59B6]/20 rounded-md px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9B59B6]" />
                <span className="text-[#9B59B6] text-xs font-medium">
                  {activeForecast.signals.events[0].name}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      )}

      {/* Weather and backend-provided forecast factors */}
      {(isLoading || activeForecast) && (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="space-y-4 xl:col-span-2 xl:grid xl:grid-cols-2 xl:gap-5 xl:space-y-0">
          {isLoading ? (
            <>
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </>
          ) : activeForecast ? (
            <>
              <WeatherCard signals={activeForecast.signals} locationLabel={locationLabel} />
              <ImpactFactorsCard forecast={activeForecast} />
            </>
          ) : null}
        </div>
      </div>
      )}
    </AppLayout>
  )
}
