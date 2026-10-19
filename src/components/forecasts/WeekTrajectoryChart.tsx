import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts'
import type { Forecast } from '@/types'
import { addLocalDays, forecastDateKey, parseDateOnly, toLocalDateOnly } from '@/lib/date'
import { formatZAR, formatZARCompact } from '@/lib/money'

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CHART_HEIGHT = 280
// Recharts only measures its wrapper after mount. Until then it renders
// nothing and, with no size to go on, warns about a -1 width. Start from a
// plausible size so first paint is a chart; the measured size follows at once.
const CHART_INITIAL_WIDTH = 600

function shortDayLabel(dateStr: string): string {
  const d = parseDateOnly(dateStr)
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-ZA', { month: 'short' })}`
}

/**
 * A small cafe turning R600-R900 a day got an axis whose every tick read
 * "R 0k" or "R 1k". Only compact below-the-thousand once there is a thousand
 * worth of range to compact (from R10 000; the shared money format, FB-015).
 */
export function fmtAxisRevenue(value: number): string {
  return formatZARCompact(value)
}

/** Belt on the date walk below, so a bad payload cannot spin the loop. */
const MAX_CHART_DAYS = 60

/**
 * Every calendar day between the first and last point, so a day the backend
 * failed to generate reads as a gap.
 *
 * The series used to be built from the union of the dates actually returned.
 * With 2 generated days out of 7 the page warned "only 2 of 7 forecast days
 * are available" and then drew those two as adjacent, evenly-spaced columns
 * directly above the day cards — an unbroken week with the hole invisible.
 */
function calendarSpan(dateKeys: string[]): string[] {
  const sorted = [...dateKeys].sort()
  if (sorted.length === 0) return []
  const last = parseDateOnly(sorted[sorted.length - 1])
  const days: string[] = []
  let cursor = parseDateOnly(sorted[0])
  while (cursor.getTime() <= last.getTime() && days.length < MAX_CHART_DAYS) {
    days.push(toLocalDateOnly(cursor))
    cursor = addLocalDays(cursor, 1)
  }
  return days
}

export interface ChartDatum {
  date: string
  /**
   * null where the backend produced no forecast for that calendar day, and
   * where the cafe is closed: a shut door is not a prediction of zero takings,
   * and drawn as one it has the shape of a catastrophic trading day. On the
   * seeded cafe that is every Sunday, dominating the vertical scale of the
   * whole week.
   */
  predicted: number | null
  actual?: number
  isPast: boolean
  /** The cafe is not trading. The line breaks and the column is labelled. */
  closed?: boolean
  /** A closure the sales record contradicts — worth naming differently. */
  closedContradicted?: boolean
}

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border rounded-lg p-3 text-xs">
      <p className="text-muted mb-2 font-medium">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted">{p.name}:</span>
          <span className="text-text font-semibold">{formatZAR(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function hasMatchedActuals(forecast: Forecast): boolean {
  return Boolean(
    forecast.actualsUpdatedAt ||
    (forecast.actualTransactionCount != null && forecast.actualTransactionCount > 0) ||
    (forecast.accuracy != null && forecast.items.some((item) => item.actualQty != null))
  )
}

interface Props {
  futureForecasts: Forecast[]
  pastForecasts: Forecast[]
  /**
   * The cafe's own calendar date for today, from the week payload rather than
   * the device clock. The forecast calendar is the cafe's timezone; a laptop
   * left on UTC, or an owner checking in from abroad, put the "Today" marker on
   * the wrong column or off the chart entirely.
   */
  todayDateKey?: string
}

export function buildTrajectorySeries(
  futureForecasts: Forecast[],
  pastForecasts: Forecast[],
  todayKey: string
): ChartDatum[] {
  // Build map from past forecasts: date string to predicted and matched actual revenue.
  const pastMap = new Map<string, { predicted: number; actual?: number; forecast: Forecast }>()
  pastForecasts.forEach((f) => {
    const actualRevenue =
      hasMatchedActuals(f) && f.actualRevenue != null ? f.actualRevenue : undefined
    pastMap.set(forecastDateKey(f).slice(0, 10), {
      predicted: f.totalPredictedRevenue,
      actual: actualRevenue,
      forecast: f,
    })
  })

  const allDates = new Set<string>()
  pastForecasts.forEach((f) => allDates.add(forecastDateKey(f).slice(0, 10)))
  futureForecasts.forEach((f) => allDates.add(forecastDateKey(f).slice(0, 10)))

  const todayStart = parseDateOnly(todayKey).getTime()

  return calendarSpan(Array.from(allDates)).map((dateStr) => {
    const past = pastMap.get(dateStr)
    const future = futureForecasts.find((f) => forecastDateKey(f).slice(0, 10) === dateStr)
    const availability = (past?.forecast ?? future)?.availability
    const closed = availability?.status === 'closed'
    // A past closure keeps its actual: a contradicted one exists precisely
    // because the cafe traded, and the grey line is the evidence.
    const predicted = closed ? null : past?.predicted ?? future?.totalPredictedRevenue ?? null

    return {
      date: shortDayLabel(dateStr),
      predicted,
      actual: past?.actual,
      isPast: parseDateOnly(dateStr).getTime() < todayStart,
      ...(closed
        ? { closed: true, closedContradicted: Boolean(availability?.contradictsHistory) }
        : {}),
    }
  })
}

export function WeekTrajectoryChart({ futureForecasts, pastForecasts, todayDateKey }: Props) {
  const todayKey = todayDateKey ? todayDateKey.slice(0, 10) : toLocalDateOnly(new Date())
  const data = buildTrajectorySeries(futureForecasts, pastForecasts, todayKey)

  const todayStr = shortDayLabel(todayKey)
  const hasActual = data.some((d) => d.actual !== undefined)
  const LABEL_HANGS_LEFT_FROM = 2 / 3
  const closedDays = data
    .map((d, index) => ({ ...d, tailEnd: index >= data.length * LABEL_HANGS_LEFT_FROM }))
    .filter((d) => d.closed)

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-text text-sm font-semibold mb-4">Revenue trajectory</p>
      <ResponsiveContainer
        width="100%"
        height={CHART_HEIGHT}
        initialDimension={{ width: CHART_INITIAL_WIDTH, height: CHART_HEIGHT }}
      >
        <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#888888', fontSize: 11 }}
            axisLine={{ stroke: '#2A2A2A' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtAxisRevenue}
            tick={{ fill: '#888888', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Recharts colours the legend label with the series colour, which put
              brand red on the dark ground at 3.76:1. The line and dots stay
              brand red (graphics, judged at 3:1); only the label text shifts. */}
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            formatter={(value: string) => <span style={{ color: '#C9C1BB' }}>{value}</span>}
          />
          {/* A break in the line is only legible if it is named. Without this
              a closed Sunday and a Sunday the backend failed to generate are
              the same hole. Drawn before the Today marker so that marker wins
              the overlap on a day that is both. */}
          {closedDays.map((day) => (
            <ReferenceLine
              key={day.date}
              x={day.date}
              stroke={day.closedContradicted ? '#FFD166' : '#555555'}
              strokeDasharray="2 4"
              label={{
                value: day.closedContradicted ? 'Closed · sales recorded' : 'Closed',
                // Hangs left of the marker once the marker is in the last
                // third, or the longer label runs off the plot area and the
                // owner reads "Closed · sales rec". Next Sunday is always in
                // that third on a chart that spans last week and this one.
                position: day.tailEnd ? 'insideTopRight' : 'insideTopLeft',
                fill: day.closedContradicted ? '#FFD166' : '#888888',
                fontSize: 10,
              }}
            />
          ))}
          <ReferenceLine
            x={todayStr}
            stroke="#4DA63B"
            strokeDasharray="3 3"
            label={{ value: 'Today', position: 'top', fill: '#4DA63B', fontSize: 11 }}
          />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="predicted"
            name="Predicted"
            stroke="#D43D3D"
            strokeWidth={2}
            dot={{ r: 3, fill: '#D43D3D', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            /* No connectNulls: a day the backend could not generate has to read
               as a hole, not as a straight line drawn over the top of it. */
            connectNulls={false}
          />
          {hasActual && (
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="#888888"
              strokeWidth={2}
              /* Dashed stroke and hollow dots, so predicted and actual stay
                 distinguishable in greyscale and to a deuteranopic reader —
                 the legend was the only mapping and it was colour alone. */
              strokeDasharray="6 4"
              dot={{ r: 4, fill: 'none', stroke: '#888888', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
