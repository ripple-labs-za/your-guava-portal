import { formatDayKey, trendCaptionFrom, queriedWindowFrom, type RangeMeta, type QueriedWindow, type TrendMeta } from '@/lib/analyticsWindow'
import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  CalendarDays,
  CreditCard,
  Banknote,
  Percent,
  Wallet,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import type {
  RevenueAnalytics,
  RevenueData,
  ItemPerformance,
  HeatmapCell,
  HeatmapMeta,
  CustomerInsights,
} from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

// Whole rands are right for totals and wrong for the per-transaction and
// per-hour averages this also formats: an average tip of R4.50 printed as "R5",
// and R0.40 as "R0", which reads as "nobody tips".
function formatZAR(amount: number, decimals = 0) {
  return `R${amount.toLocaleString('en-ZA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

function formatTrend(trend: number) {
  return `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`
}

function formatCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function numberValue(value: unknown) {
  return typeof value === 'number' ? value : Number(value || 0)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// The backend buckets transactions by cafe-local day. Reading the browser's
// local calendar instead meant a device on UTC computed yesterday's Johannesburg
// date for the first two hours of every trading day, so today's takings silently
// dropped out of every tab — and a phone and a laptop disagreed.
const JOHANNESBURG_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatDateParam(date: Date) {
  return JOHANNESBURG_DATE.format(date)
}

type TabId = 'revenue' | 'items' | 'heatmap' | 'customers' | 'combos'

const TABS: { id: TabId; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'items', label: 'Items' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'customers', label: 'Customers' },
  { id: 'combos', label: 'Combos' },
]

const CHART_TOOLTIP_STYLE = {
  background: '#1A1A1A',
  border: '1px solid #2A2A2A',
  borderRadius: 8,
  color: '#F0F0F0',
}

const BAR_HOVER_CURSOR = { fill: 'rgba(77, 166, 59, 0.08)' }
const BAR_ACTIVE_STYLE = { fill: '#62B84D' }
// Recharts only measures its wrapper after mount. Until then it renders
// nothing and warns "width(-1) and height(-1)". Start each chart from a
// plausible size so first paint is a chart; the measured size follows at once.
const CHART_INITIAL_WIDTH = 600
const CHART_HEIGHT = 300
const DONUT_SIZE = 200

type PeriodId = '7d' | '30d' | '90d'

interface RevenueResponse {
  data: RevenueData[]
  summary: {
    openDays?: number
    totalRevenue: number
    avgDailyRevenue: number
    bestDay: RevenueAnalytics['bestDay'] | null
    worstDay: RevenueAnalytics['worstDay'] | null
    trend: number | null
  }
  meta?: TrendMeta & { summary?: RevenueResponse['summary'] }
}

interface MoverItem {
  name: string
  trend: number
}

interface NewItem { name: string; currentQty: number }
interface MoverFloor { minAvgPerDay: number; windowDays: number; minQty: number; eligibleCount: number; busiestQty: number }

interface ComboItem {
  pair: [string, string]
  count: number
}

function daysForPeriod(period: PeriodId): number {
  return period === '7d' ? 7 : period === '30d' ? 30 : 90
}

function getDateRange(period: PeriodId) {
  // Anchor on the Johannesburg calendar day, then step back whole days from
  // that anchor so both ends of the window agree with the server's bucketing.
  const endDate = formatDateParam(new Date())
  const anchor = new Date(`${endDate}T00:00:00Z`)
  const start = new Date(anchor)
  start.setUTCDate(anchor.getUTCDate() - (daysForPeriod(period) - 1))
  return { startDate: start.toISOString().slice(0, 10), endDate }
}

const DAY_LABELS_BY_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_BY_INDEX = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ROWS = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
]
const ALL_HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 06:00 - 22:00

// Only show hours the cafe actually trades. Rendering a fixed 06:00-22:00 grid
// left a third of the heatmap as permanently empty columns, which made the
// busy hours look narrower than they are.
function tradingHoursFrom(cells: HeatmapCell[]): number[] {
  const active = cells.filter((cell) => (cell.revenue ?? 0) > 0 || (cell.transactions ?? 0) > 0)
  if (active.length === 0) return ALL_HOURS
  const min = Math.min(...active.map((cell) => cell.hour))
  const max = Math.max(...active.map((cell) => cell.hour))
  return ALL_HOURS.filter((hour) => hour >= min && hour <= max)
}

// ── Period Selector ───────────────────────────────────────────────────────────

// Colour was the only thing saying which range was applied, so every number on
// the page was unattributed for a screen-reader user.
function PeriodSelector({ period, onChange }: { period: PeriodId; onChange: (p: PeriodId) => void }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Date range">
      {(['7d', '30d', '90d'] as PeriodId[]).map((p) => (
        <Button
          key={p}
          variant={period === p ? 'default' : 'outline'}
          size="sm"
          aria-pressed={period === p}
          aria-label={`Last ${daysForPeriod(p)} days`}
          onClick={() => onChange(p)}
        >
          {p}
        </Button>
      ))}
    </div>
  )
}

// Every tab used to dead-end on its own error: no retry, and the range selector
// unmounted with it, so the one thing that might have helped — asking for a
// smaller window — was gone too.
function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center" role="alert">
      <p className="text-muted text-sm">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

// ── Revenue Tab ──────────────────────────────────────────────────────────────

function RevenueTab({ period, onWindow }: { period: PeriodId; onWindow: (window: QueriedWindow | null) => void }) {
  const [trendCaption, setTrendCaption] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [data, setData] = useState<RevenueAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { startDate, endDate } = getDateRange(period)
    api
      .get<RevenueResponse>(`/analytics/revenue?period=daily&startDate=${startDate}&endDate=${endDate}`, { signal: controller.signal })
      .then(({ data: res }) => {
        if (controller.signal.aborted) return
        onWindow(queriedWindowFrom(res.meta))
        setTrendCaption(trendCaptionFrom(res.meta))
        const summary = res.summary ?? res.meta?.summary
        setData({
          totalRevenue: summary?.totalRevenue ?? 0,
          avgDailyRevenue: summary?.avgDailyRevenue ?? 0,
          openDays: summary?.openDays,
          bestDay: summary?.bestDay ?? { date: '', revenue: 0 },
          worstDay: summary?.worstDay ?? { date: '', revenue: 0 },
          trend: summary?.trend ?? null,
          data: res.data || [],
        })
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load revenue data') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, reloadKey, onWindow])

  if (error) return <TabError message={error} onRetry={() => setReloadKey((key) => key + 1)} />

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-5">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-7 w-28" />
              </CardContent>
            </Card>
          ))
        ) : data ? (
          <>
            <KpiCard label="Total Revenue" value={formatZAR(data.totalRevenue)} icon={DollarSign} accent="#4DA63B" />
            <KpiCard label="Avg Daily" value={formatZAR(data.avgDailyRevenue)} icon={CalendarDays} accent="#4A9ECC"
              sub={data.openDays ? `across ${data.openDays} open ${data.openDays === 1 ? 'day' : 'days'}` : undefined} />
            <KpiCard
              label="Best Day"
              value={formatZAR(data.bestDay.revenue)}
              sub={data.bestDay.date ? formatDate(data.bestDay.date) : 'No data yet'}
              icon={TrendingUp}
              accent="#FFD166"
            />
            <KpiCard
              label="Trend"
              value={data.trend === null ? <span aria-label="Trend unavailable">—</span> : formatTrend(data.trend)}
              sub={trendCaption || undefined}
              icon={data.trend === null ? Minus : data.trend < 0 ? TrendingDown : TrendingUp}
              accent={data.trend === null ? '#888888' : data.trend >= 0 ? '#4DA63B' : '#D43D3D'}
            />
          </>
        ) : null}
      </div>

      {/* Area Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Daily Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-75 rounded-lg" />
          ) : data && data.data.length > 0 ? (
            <div
              style={{ width: '100%', height: CHART_HEIGHT }}
              role="img"
              aria-label={`Daily revenue chart, ${data.data.length} ${
                data.data.length === 1 ? 'day' : 'days'
              }, ${formatZAR(data.totalRevenue)} in total. The same figures follow in a table.`}
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
                initialDimension={{ width: CHART_INITIAL_WIDTH, height: CHART_HEIGHT }}
              >
                <AreaChart data={data.data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4DA63B" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#4DA63B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#888888', fontSize: 11 }}
                    tickFormatter={(v: string) => formatDate(v)}
                    stroke="#2A2A2A"
                  />
                  <YAxis
                    tick={{ fill: '#888888', fontSize: 11 }}
                    tickFormatter={(v: number) => `R${(v / 1000).toFixed(0)}k`}
                    stroke="#2A2A2A"
                  />
                  <Tooltip
                    contentStyle={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0' }}
                    labelFormatter={(v: unknown) => formatDate(String(v || ''))}
                    formatter={(value: unknown) => [formatZAR(numberValue(value)), 'Revenue']}
                  />
                  <Area
                    // Recharts reveals series with an animated clip rect. On this
                    // page the clip stayed at width 0, leaving a fully-drawn path
                    // invisible behind it, so the chart read as "no data".
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="revenue"
                    stroke="#4DA63B"
                    strokeWidth={2}
                    // One or two days of data draws a line with nothing to join,
                    // so the only day the cafe has is invisible without a dot.
                    dot={data.data.length < 3}
                    fill="url(#revenueGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-muted text-sm text-center py-16">No revenue data for this period</p>
          )}
          {!loading && data && data.data.length > 0 && (
            <ChartDataTable
              caption="Daily revenue"
              columns={['Date', 'Revenue']}
              rows={data.data.map((point) => [formatDate(point.date), formatZAR(point.revenue)])}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// A chart conveys nothing to a screen reader, and neither the Revenue nor the
// Customers tab rendered its series as text anywhere. This is the same pattern
// the Items tab gets for free from its real table.
function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string
  columns: string[]
  rows: string[][]
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Items Tab ────────────────────────────────────────────────────────────────

function ItemsTab({ period, onWindow }: { period: PeriodId; onWindow: (window: QueriedWindow | null) => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [items, setItems] = useState<ItemPerformance[]>([])
  const [risingItems, setRisingItems] = useState<MoverItem[]>([])
  const [decliningItems, setDecliningItems] = useState<MoverItem[]>([])
  const [newItems, setNewItems] = useState<NewItem[]>([])
  const [moverFloor, setMoverFloor] = useState<MoverFloor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { startDate, endDate } = getDateRange(period)
    api
      .get<{ items: ItemPerformance[]; meta?: RangeMeta & { risingItems?: MoverItem[]; decliningItems?: MoverItem[]; newItems?: NewItem[]; moverFloor?: MoverFloor } }>(
        `/analytics/items?startDate=${startDate}&endDate=${endDate}`,
        { signal: controller.signal }
      )
      .then(({ data }) => {
        if (controller.signal.aborted) return
        onWindow(queriedWindowFrom(data.meta))
        setItems(data.items || [])
        setRisingItems(data.meta?.risingItems || [])
        setDecliningItems(data.meta?.decliningItems || [])
        setNewItems(data.meta?.newItems || [])
        setMoverFloor(data.meta?.moverFloor ?? null)
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load item data') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, reloadKey, onWindow])

  const sorted = useMemo(() => [...items].sort((a, b) => b.totalQty - a.totalQty), [items])
  const top10 = sorted.slice(0, 10)

  const rising = risingItems.slice(0, 5)
  const declining = decliningItems.slice(0, 5)
  const hasMovers = items.length > 0 || rising.length > 0 || declining.length > 0 || newItems.length > 0
  const noneEligible = moverFloor ? moverFloor.eligibleCount === 0 : false
  const moversThresholdNote = moverFloor
    ? `No line sold ${moverFloor.minQty}+ in either of the last two weeks (${moverFloor.minAvgPerDay} a day), so ranking movers ` +
      `would be noise. Your busiest line sold ${moverFloor.busiestQty.toLocaleString('en-ZA')} in a week.`
    : ''

  const risingNames = new Set(rising.map((i) => i.name))
  const decliningNames = new Set(declining.map((i) => i.name))

  if (error) return <TabError message={error} onRetry={() => setReloadKey((key) => key + 1)} />

  return (
    <div className="space-y-6">
      {/* Movers Card */}
      {!loading && hasMovers && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">Movers</CardTitle>
              <Badge variant="secondary" className="text-[10px]">Fixed 7-day window</Badge>
            </div>
            <p className="text-muted text-xs mt-0.5">
              Last 7 days against the 7 before. This panel ignores the range above — changing
              it will not change these percentages. Only lines selling 2+ a day in at least one
              of the two weeks are ranked, so a jump from 1 to 8 doesn&rsquo;t show as &ldquo;+700%&rdquo;,
              and a line with no sales in the earlier week is listed as new rather than &ldquo;+100%&rdquo;.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-guava-green text-xs font-semibold uppercase tracking-wider mb-2">Rising</p>
                {rising.length === 0 ? (
                  <p className="text-muted text-xs">
                    {noneEligible ? moversThresholdNote : 'No rising items'}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {rising.map((item) => (
                      <li key={item.name} className="flex items-center justify-between text-xs">
                        <span className="text-text truncate mr-2">{item.name}</span>
                        <span className="text-guava-green font-medium tabular-nums shrink-0">
                          {formatTrend(item.trend)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-guava-red-text text-xs font-semibold uppercase tracking-wider mb-2">Declining</p>
                {declining.length === 0 ? (
                  <p className="text-muted text-xs">
                    {noneEligible ? moversThresholdNote : 'No declining items'}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {declining.map((item) => (
                      <li key={item.name} className="flex items-center justify-between text-xs">
                        <span className="text-text truncate mr-2">{item.name}</span>
                        <span className="text-guava-red-text font-medium tabular-nums shrink-0">
                          {formatTrend(item.trend)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {newItems.length > 0 && (
              <div className="mt-4">
                <p className="text-text text-xs font-semibold uppercase tracking-wider mb-2">New this period</p>
                <ul className="space-y-1.5">
                  {newItems.map((item) => (
                    <li key={item.name} className="flex items-center justify-between text-xs">
                      <span className="text-text truncate mr-2">{item.name}</span>
                      <span className="text-muted tabular-nums shrink-0">{item.currentQty.toLocaleString('en-ZA')} sold · new</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </CardContent>
        </Card>
      )}

      {/* Bar Chart: top 10 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top 10 Items by Quantity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-75 rounded-lg" />
          ) : top10.length > 0 ? (
            <div style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer
                width="100%"
                height="100%"
                initialDimension={{ width: CHART_INITIAL_WIDTH, height: CHART_HEIGHT }}
              >
                <BarChart data={top10} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#888888', fontSize: 10 }}
                    stroke="#2A2A2A"
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fill: '#888888', fontSize: 11 }} stroke="#2A2A2A" />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={BAR_HOVER_CURSOR}
                    formatter={(value: unknown) => [formatCount(numberValue(value)), 'Qty Sold']}
                  />
                  <Bar isAnimationActive={false} dataKey="totalQty" fill="#4DA63B" radius={[4, 4, 0, 0]} activeBar={BAR_ACTIVE_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-muted text-sm text-center py-16">No item data available</p>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Item Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : sorted.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted font-medium">Item</th>
                    <th className="text-right py-2 px-4 text-muted font-medium">Sold</th>
                    <th className="text-right py-2 px-4 text-muted font-medium">Revenue</th>
                    <th className="text-right py-2 px-4 text-muted font-medium">Avg/Day</th>
                    {/* Sold, Revenue and Avg/Day follow the range above; the
                        trend does not. Two windows in one row, one heading. */}
                    <th className="text-right py-2 pl-4 text-muted font-medium">Trend (7d vs prior 7d)</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => {
                    const isRising = risingNames.has(item.name)
                    const isDeclining = decliningNames.has(item.name)
                    return (
                      <tr
                        key={item.name}
                        className={cn(
                          'border-b border-[#1F1F1F] last:border-0',
                          isRising && 'bg-guava-green/5',
                          isDeclining && 'bg-guava-red/5'
                        )}
                      >
                        <td className="py-2.5 pr-4 text-text">{item.name}</td>
                        <td className="py-2.5 px-4 text-right text-text tabular-nums">{item.totalQty}</td>
                        <td className="py-2.5 px-4 text-right text-text tabular-nums">{formatZAR(item.totalRevenue)}</td>
                        <td className="py-2.5 px-4 text-right text-muted tabular-nums">{item.avgPerDay.toFixed(1)}</td>
                        <td className="py-2.5 pl-4 text-right">
                          {item.isNew ? (
                            <Badge variant="secondary" className="text-[10px]">New</Badge>
                          ) : item.trend === null ? (
                            <span className="text-muted" aria-label="No sales in the earlier week">—</span>
                          ) : (
                            <Badge variant={item.trend >= 0 ? 'success' : 'destructive'} className="text-[10px]">
                              {item.trend >= 0 ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                              {formatTrend(item.trend)}
                            </Badge>
                          )}
                        </td>

                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted text-sm text-center py-16">No item data available</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Heatmap Tab ──────────────────────────────────────────────────────────────

function HeatmapTab({ period, onWindow }: { period: PeriodId; onWindow: (window: QueriedWindow | null) => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [cells, setCells] = useState<HeatmapCell[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null)
  // Sales from exports with dates but no times: the server leaves them out of every cell and says how many.
  const [withoutTime, setWithoutTime] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { startDate, endDate } = getDateRange(period)
    api
      .get<{ heatmap: HeatmapCell[]; data?: HeatmapCell[]; meta?: RangeMeta & HeatmapMeta }>(`/analytics/heatmap?startDate=${startDate}&endDate=${endDate}`, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return
        onWindow(queriedWindowFrom(data.meta))
        setCells(data.heatmap || data.data || [])
        setWithoutTime(data.meta?.timeOfDay?.transactionsWithoutTime ?? 0)
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load heatmap data') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, reloadKey, onWindow])

  const HOURS = useMemo(() => tradingHoursFrom(cells), [cells])
  // The backend always emits a complete 7x17 grid with an explicit zero for
  // every missing slot, so cells.length was never 0 and the empty branch was
  // dead code. A cafe with no imports was shown 119 confident dark squares and
  // tooltips reporting "R0 avg" — a measurement claim about a window nobody
  // measured.
  const hasActivity = useMemo(
    () => cells.some((cell) => (cell.revenue ?? 0) > 0 || (cell.transactions ?? 0) > 0),
    [cells]
  )

  const cellMap = useMemo(() => {
    const map = new Map<string, HeatmapCell>()
    cells.forEach((c) => map.set(`${c.dayOfWeek}-${c.hour}`, c))
    return map
  }, [cells])

  const maxRevenue = useMemo(() => Math.max(...cells.map((c) => c.revenue), 1), [cells])

  function getCellColor(revenue: number) {
    const intensity = revenue / maxRevenue
    if (intensity < 0.1) return '#1A1A1A'
    if (intensity < 0.25) return '#1E2A1E'
    if (intensity < 0.5) return '#2A4A2A'
    if (intensity < 0.75) return '#3A6A3A'
    return '#4DA63B'
  }

  if (error) return <TabError message={error} onRetry={() => setReloadKey((key) => key + 1)} />

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Average Revenue Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-75 rounded-lg" />
          ) : hasActivity ? (
            <div className="relative">
              {/* Tooltip. pointer-events-none so it cannot steal the hover from
                  the cell underneath it and flicker. */}
              {hoveredCell && (
                <div className="pointer-events-none absolute top-0 right-0 bg-[#111111] border border-border rounded-lg px-3 py-2 z-10 text-xs">
                  <p className="text-text font-medium">
                    {DAY_LABELS_BY_INDEX[hoveredCell.dayOfWeek]} {String(hoveredCell.hour).padStart(2, '0')}:00
                  </p>
                  <p className="text-muted">{formatZAR(hoveredCell.revenue, 2)} avg</p>
                  <p className="text-muted">{formatCount(hoveredCell.transactions)} avg transactions</p>
                  {hoveredCell.isOpen === false && <p className="text-muted">Closed (trading hours)</p>}
                  {(hoveredCell.observedDays ?? 0) > 0 && (
                    <p className="text-muted">{hoveredCell.observedDays} observed days</p>
                  )}
                </div>
              )}
              <div className="overflow-x-auto">
                {/* A real table with real headers, and a focusable cell carrying
                    the figure in its accessible name. As a grid of empty divs
                    the whole tab was unreachable by keyboard and carried no
                    text at all, so its numbers did not exist for a screen
                    reader. */}
                <table className="min-w-150 w-full border-separate border-spacing-0.5">
                  <caption className="sr-only">
                    Average revenue by day of week and hour
                  </caption>
                  <thead>
                    <tr>
                      <th className="w-10" />
                      {HOURS.map((h) => (
                        <th key={h} scope="col" className="text-center text-[10px] font-normal text-muted">
                          {String(h).padStart(2, '0')}:00
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAY_ROWS.map((row) => (
                      <tr key={row.value}>
                        <th scope="row" className="w-10 text-left text-[11px] font-normal text-muted">
                          {row.label}
                        </th>
                        {HOURS.map((hour) => {
                          const cell = cellMap.get(`${row.value}-${hour}`)
                          const revenue = cell?.revenue ?? 0
                          const transactions = cell?.transactions ?? 0
                          const hourLabel = `${String(hour).padStart(2, '0')}:00`
                          const isClosed = cell?.isOpen === false
                          const title = isClosed
                            ? `${row.label} ${hourLabel} - Closed${revenue > 0 ? ` - ${formatZAR(revenue)} avg` : ''}`
                            : `${row.label} ${hourLabel} - ${formatZAR(revenue)} avg`
                          return (
                            <td key={hour} className="p-0">
                              <button
                                type="button"
                                className={cn('block aspect-square w-full rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-green', isClosed && 'opacity-40')}
                                style={{ backgroundColor: getCellColor(revenue) }}
                                title={title}
                                data-closed={isClosed ? 'true' : undefined}
                                aria-label={`${DAY_NAMES_BY_INDEX[row.value]} ${hourLabel}${isClosed ? ', closed' : ''}, ${formatZAR(revenue, 2)} average revenue, ${formatCount(transactions)} average transactions`}
                                onMouseEnter={() =>
                                  setHoveredCell(cell ?? { dayOfWeek: row.value, hour, revenue: 0, transactions: 0 })
                                }
                                onMouseLeave={() => setHoveredCell(null)}
                                onFocus={() =>
                                  setHoveredCell(cell ?? { dayOfWeek: row.value, hour, revenue: 0, transactions: 0 })
                                }
                                onBlur={() => setHoveredCell(null)}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Legend */}
              <div className="flex items-center justify-end gap-1 mt-3">
                <span className="text-[10px] text-muted mr-1">Less</span>
                {['#1A1A1A', '#1E2A1E', '#2A4A2A', '#3A6A3A', '#4DA63B'].map((color) => (
                  <div key={color} className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                ))}
                <span className="text-[10px] text-muted ml-1">More</span>
                <div className="w-3 h-3 rounded-sm opacity-40 ml-3" style={{ backgroundColor: '#4DA63B' }} />
                <span className="text-[10px] text-muted ml-1">Closed</span>
              </div>
              {withoutTime > 0 && (
                <p className="mt-3 text-xs text-muted">
                  {withoutTime === 1
                    ? '1 sale in this window came from an export with dates but no times, so it is not in this heatmap.'
                    : `${withoutTime.toLocaleString('en-ZA')} sales in this window came from exports with dates but no times, so they are not in this heatmap.`}
                </p>
              )}
            </div>
          ) : withoutTime > 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-text text-sm font-medium">No time of day in these sales</p>
              <p className="text-muted text-sm mt-1 max-w-sm">
                The sales in this window came from exports with dates but no times, so there is no hour-of-day pattern to
                show. Map a Time column the next time you upload.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/data-health">Upload sales data</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-text text-sm font-medium">No trading activity in this window</p>
              <p className="text-muted text-sm mt-1 max-w-sm">
                Nothing has been imported for the selected range, so there is nothing to chart —
                this is not a measured result of zero.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link to="/data-health">Upload sales data</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Customers Tab ────────────────────────────────────────────────────────────

const DONUT_COLORS = ['#4DA63B', '#D43D3D', '#4A9ECC']

function CustomersTab({ period, onWindow }: { period: PeriodId; onWindow: (window: QueriedWindow | null) => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [data, setData] = useState<CustomerInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { startDate, endDate } = getDateRange(period)
    api
      .get<{ insights: CustomerInsights; data?: CustomerInsights; meta?: RangeMeta }>(`/analytics/customers?startDate=${startDate}&endDate=${endDate}`, { signal: controller.signal })
      .then(({ data: res }) => {
        if (controller.signal.aborted) return
        onWindow(queriedWindowFrom(res.meta))
        setData(res.insights ?? res.data ?? null)
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load customer insights') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, reloadKey, onWindow])

  if (error) return <TabError message={error} onRetry={() => setReloadKey((key) => key + 1)} />

  // The backend answers an unmeasured range with a full object of zeros, so
  // "R0 average transaction, 0% tipping" read as a measurement of a period that
  // was never measured.
  const hasCustomerData = Boolean(
    data &&
      (data.avgTransactionValue > 0 ||
        data.avgItemsPerTransaction > 0 ||
        data.tippingRate > 0 ||
        data.avgTip > 0 ||
        data.cashVsCardRatio ||
        (data.refunds?.count ?? 0) > 0)
  )
  const paymentSplit = data?.cashVsCardRatio ?? null
  const refunds = data?.refunds
  const coverage = data?.paymentMethodCoverage
  const donutData = paymentSplit
    ? [
        { name: 'Card', value: paymentSplit.card },
        { name: 'Cash', value: paymentSplit.cash },
        ...((paymentSplit.other ?? 0) > 0 ? [{ name: 'Other', value: paymentSplit.other }] : []),
      ]
    : []

  if (!loading && !hasCustomerData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-text text-sm font-medium">No customer data for this period</p>
        <p className="text-muted text-sm mt-1 max-w-sm">
          Nothing has been imported for the selected range, so there is nothing to average.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/data-health">Upload sales data</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-5">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-7 w-28" />
              </CardContent>
            </Card>
          ))
        ) : data ? (
          <>
            <KpiCard
              label="Avg Transaction"
              value={formatZAR(data.avgTransactionValue, 2)}
              sub={refunds && refunds.count > 0
                ? `${refunds.count} ${refunds.count === 1 ? 'refund' : 'refunds'} (${formatZAR(refunds.value, 2)}) not counted as ${refunds.count === 1 ? 'a sale' : 'sales'}`
                : undefined}
              icon={DollarSign}
              accent="#4DA63B"
            />
            <KpiCard
              label="Avg Items/Transaction"
              value={data.avgItemsPerTransaction.toFixed(1)}
              icon={BarChart3}
              accent="#4A9ECC"
            />
            <KpiCard
              label="Tipping Rate"
              value={`${data.tippingRate.toFixed(1)}%`}
              icon={Percent}
              accent="#FFD166"
            />
            <KpiCard
              label="Avg Tip"
              value={formatZAR(data.avgTip, 2)}
              icon={Banknote}
              accent="#4DA63B"
            />
          </>
        ) : null}
      </div>

      {/* Cash vs Card Donut */}
      {!loading && data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payment Method Split</CardTitle>
          </CardHeader>
          <CardContent>
            {/* cashVsCardRatio is null whenever the import carried no payment
                type. Defaulting it to zero drew an empty donut beside a
                confident "Card: 0.0% / Cash: 0.0%" — a split the product had
                never counted, next to the fee decision it would inform. */}
            {!paymentSplit ? (
              <p className="text-muted text-sm text-center py-10">
                Your import does not include payment methods, so cash and card cannot be split.
              </p>
            ) : (
              <div className="flex items-center justify-center gap-8">
                <div
                  style={{ height: DONUT_SIZE, width: DONUT_SIZE }}
                  role="img"
                  aria-label={`Payment method split: card ${paymentSplit.card.toFixed(1)} percent, cash ${paymentSplit.cash.toFixed(1)} percent, other ${(paymentSplit.other ?? 0).toFixed(1)} percent`}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: DONUT_SIZE, height: DONUT_SIZE }}
                  >
                    <PieChart>
                      <Pie
                        isAnimationActive={false}
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {donutData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={DONUT_COLORS[index]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#1A1A1A', border: '1px solid #2A2A2A', borderRadius: 8, color: '#F0F0F0' }}
                        formatter={(value: unknown) => [`${numberValue(value).toFixed(1)}%`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-guava-green" />
                    <span className="text-text text-sm">Card: {paymentSplit.card.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-guava-red-text" />
                    <span className="text-text text-sm">Cash: {paymentSplit.cash.toFixed(1)}%</span>
                  </div>
                  {(paymentSplit.other ?? 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-[#4A9ECC]" />
                      <span className="text-text text-sm">Other: {(paymentSplit.other ?? 0).toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {coverage && coverage.unknown > 0 && (
              <p className="text-muted text-xs mt-3">
                {coverage.unknown} {coverage.unknown === 1 ? 'sale has' : 'sales have'} no payment method and{' '}
                {coverage.unknown === 1 ? 'is' : 'are'} left out of this split.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Combos Tab ───────────────────────────────────────────────────────────────

function CombosTab({ period, onWindow }: { period: PeriodId; onWindow: (window: QueriedWindow | null) => void }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [combos, setCombos] = useState<ComboItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const { startDate, endDate } = getDateRange(period)
    api
      .get<{ data: ComboItem[]; meta?: RangeMeta }>(`/analytics/combos?startDate=${startDate}&endDate=${endDate}`, { signal: controller.signal })
      .then(({ data: res }) => {
        if (controller.signal.aborted) return
        onWindow(queriedWindowFrom(res.meta))
        setCombos(res.data || [])
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load combo data') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [period, reloadKey, onWindow])

  if (error) return <TabError message={error} onRetry={() => setReloadKey((key) => key + 1)} />

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Frequently Bought Together</CardTitle>
          <p className="text-muted text-xs mt-1">
            Use these to design bundle deals or stock paired items together.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : combos.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted font-medium">Pair</th>
                    <th className="text-right py-2 pl-4 text-muted font-medium">Times sold together</th>
                  </tr>
                </thead>
                <tbody>
                  {combos.map((combo, idx) => (
                    <tr key={idx} className="border-b border-[#1F1F1F] last:border-0">
                      <td className="py-2.5 pr-4 text-text">
                        {combo.pair[0]} + {combo.pair[1]}
                      </td>
                      <td className="py-2.5 pl-4 text-right text-text tabular-nums font-medium">
                        {combo.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted text-sm text-center py-16">
              Need more transactions with 2+ items to surface combos.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Shared KPI Card ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  accent: string
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
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${accent}18` }}
          >
            <Icon className="w-4 h-4" style={{ color: accent }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<TabId>('revenue')
  const [queried, setQueried] = useState<QueriedWindow | null>(null)
  const selectTab = (id: TabId) => {
    if (id === activeTab) return
    setQueried(null)
    setActiveTab(id)
  }
  const changePeriod = (value: PeriodId) => {
    if (value === period) return
    setQueried(null)
    setPeriod(value)
  }
  // One range for the page. Per-tab state reset the selector on every switch,
  // so a user comparing one window across tabs ended up reading 7-day revenue
  // against 90-day items without being told the window had changed.
  const [period, setPeriod] = useState<PeriodId>('30d')
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>())

  const focusTab = (id: TabId) => {
    selectTab(id)
    tabRefs.current.get(id)?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = TABS.findIndex((tab) => tab.id === activeTab)
    focusTab(TABS[(index + step + TABS.length) % TABS.length].id)
  }

  return (
    <AppLayout title="Performance">
      {/* Bare buttons announced as five unrelated controls with no selected
          state, so a screen-reader user could not tell which view they were
          looking at. */}
      <div
        role="tablist"
        aria-label="Performance views"
        className="flex items-center gap-1 mb-6 border-b border-border pb-px overflow-x-auto"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`analytics-tab-${tab.id}`}
            ref={(node) => {
              if (node) tabRefs.current.set(tab.id, node)
              else tabRefs.current.delete(tab.id)
            }}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            aria-controls={`analytics-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={handleTabKeyDown}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors relative',
              activeTab === tab.id
                ? 'text-guava-red-text'
                : 'text-muted hover:text-text'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-guava-red rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <PeriodSelector period={period} onChange={changePeriod} />
        <p role="status" className="text-muted text-xs">
          {queried && (<>
            Showing {formatDayKey(queried.startDay)} – {formatDayKey(queried.endDay)} · {queried.days}{' '}
            {queried.days === 1 ? 'day' : 'days'}
            {queried.defaulted ? ' (defaulted)' : ''}
          </>)}
        </p>
      </div>

      {/* Tab Content */}
      <div
        role="tabpanel"
        id={`analytics-panel-${activeTab}`}
        aria-labelledby={`analytics-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'revenue' && <RevenueTab period={period} onWindow={setQueried} />}
        {activeTab === 'items' && <ItemsTab period={period} onWindow={setQueried} />}
        {activeTab === 'heatmap' && <HeatmapTab period={period} onWindow={setQueried} />}
        {activeTab === 'customers' && <CustomersTab period={period} onWindow={setQueried} />}
        {activeTab === 'combos' && <CombosTab period={period} onWindow={setQueried} />}
      </div>
    </AppLayout>
  )
}
