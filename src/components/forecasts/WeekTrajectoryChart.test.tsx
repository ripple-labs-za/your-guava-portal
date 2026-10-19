import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { WeekTrajectoryChart, buildTrajectorySeries, fmtAxisRevenue } from './WeekTrajectoryChart'
import { mockForecast } from '@/test/mocks/api'

// Keep the chart internals stubbed, but run the real ResponsiveContainer: the
// behaviour under test is how it sizes itself before the DOM has layout.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ReferenceLine: () => null,
    ResponsiveContainer: actual.ResponsiveContainer,
  }
})

const futureSample = [
  { ...mockForecast, _id: 'f1', date: '2026-05-04' },
  { ...mockForecast, _id: 'f2', date: '2026-05-05', totalPredictedRevenue: 18000 },
]

const pastSample = [
  { ...mockForecast, _id: 'p1', date: '2026-04-27', accuracy: 88 },
  { ...mockForecast, _id: 'p2', date: '2026-04-28', accuracy: 75, totalPredictedRevenue: 19000 },
]

describe('WeekTrajectoryChart', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders without crashing and shows title', () => {
    render(<WeekTrajectoryChart futureForecasts={futureSample} pastForecasts={[]} />)
    expect(screen.getByText('Revenue trajectory')).toBeInTheDocument()
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
  })

  it('renders with both past and future forecasts', () => {
    render(<WeekTrajectoryChart futureForecasts={futureSample} pastForecasts={pastSample} />)
    expect(screen.getByText('Revenue trajectory')).toBeInTheDocument()
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
  })

  it('renders on first paint, before the wrapper has been measured, without a width(-1) warning', () => {
    // jsdom has no layout and no ResizeObserver, so Recharts never measures the
    // wrapper: whatever size the container assumes initially is what renders.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<WeekTrajectoryChart futureForecasts={futureSample} pastForecasts={pastSample} />)

    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    const sizeWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('width(-1)'))
    expect(sizeWarnings).toEqual([])
  })

  describe('buildTrajectorySeries', () => {
    it('leaves a hole where the backend generated no forecast', () => {
      // The page warns "only 2 of 7 forecast days are available" and then drew
      // those two as adjacent columns, so the gap was invisible in the chart
      // an owner scans first to decide which day is big.
      const series = buildTrajectorySeries(
        [
          { ...mockForecast, _id: 'f1', date: '2026-05-04', totalPredictedRevenue: 20100 },
          { ...mockForecast, _id: 'f2', date: '2026-05-07', totalPredictedRevenue: 18000 },
        ],
        [],
        '2026-05-04'
      )

      expect(series).toHaveLength(4)
      expect(series.map((d) => d.predicted)).toEqual([20100, null, null, 18000])
    })

    it('takes "today" from the cafe calendar rather than the device clock', () => {
      const series = buildTrajectorySeries(
        [
          { ...mockForecast, _id: 'f1', date: '2026-05-04' },
          { ...mockForecast, _id: 'f2', date: '2026-05-05' },
        ],
        [],
        '2026-05-05'
      )

      expect(series.map((d) => d.isPast)).toEqual([true, false])
    })
  })

  describe('fmtAxisRevenue', () => {
    it('keeps a small cafe legible instead of stacking every tick on R 0k', () => {
      expect(fmtAxisRevenue(600)).toBe('R600')
      // en-ZA groups with a non-breaking space, so normalise before comparing.
      expect(fmtAxisRevenue(2400).replace(/\s/g, ' ')).toBe('R2 400')
      expect(fmtAxisRevenue(2400)).not.toContain('k')
    })

    it('compacts once the numbers are large enough to warrant it', () => {
      expect(fmtAxisRevenue(20000)).toBe('R20k') // one shape with every other amount (FB-015)
    })
  })
  describe('closed days', () => {
    // A closed day forecasts R0, which is true, and the line plunged to the
    // axis and back - the shape of a catastrophic trading day rather than of a
    // shut door. On the seeded cafe that is every Sunday, and it dominated the
    // vertical scale of the whole week.
    const closed = (id: string, date: string, extra = {}) => ({
      ...mockForecast,
      _id: id,
      date,
      totalPredictedRevenue: 0,
      items: [],
      availability: { status: 'closed' as const, reason: 'Cafe is closed in its trading hours', ...extra },
    })

    it('breaks the line rather than drawing a day off as a collapse to zero', () => {
      const series = buildTrajectorySeries(
        [closed('c1', '2026-05-03'), { ...mockForecast, _id: 'f1', date: '2026-05-04' }],
        [],
        '2026-05-03'
      )

      expect(series[0].predicted).toBeNull()
      expect(series[0].closed).toBe(true)
      expect(series[1].predicted).not.toBeNull()
      expect(series[1].closed).toBeFalsy()
    })

    it('distinguishes a closure the sales record contradicts', () => {
      const series = buildTrajectorySeries(
        [closed('c1', '2026-05-03', { contradictsHistory: true })],
        [],
        '2026-05-03'
      )

      expect(series[0].closed).toBe(true)
      expect(series[0].closedContradicted).toBe(true)
    })

    it('keeps what actually happened on a past closed day', () => {
      // The whole point of a contradicted closure is that the cafe traded. The
      // actual line has to keep drawing across it, or the evidence disappears
      // at the exact moment it matters.
      const past = {
        ...closed('p1', '2026-04-27', { contradictsHistory: true }),
        actualRevenue: 8400,
        actualTransactionCount: 96,
        actualsUpdatedAt: '2026-04-28T00:00:00.000Z',
      }
      const series = buildTrajectorySeries([], [past], '2026-05-03')

      expect(series[0].predicted).toBeNull()
      expect(series[0].actual).toBe(8400)
    })

    it('leaves an ordinary day alone', () => {
      const series = buildTrajectorySeries(futureSample, pastSample, '2026-05-03')
      expect(series.every((d) => !d.closed)).toBe(true)
    })
  })
})
