import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import Forecasts from './Forecasts'
import { mockForecast } from '@/test/mocks/api'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock recharts to avoid jsdom SVG issues
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Partial mock: only the axios instance and the session plumbing are faked.
// AuthProvider reads the module's other named exports during render, and the
// two overrides keep an unauthenticated render from being replaced by the
// provider's "can't reach the server" startup notice.
const mockGet = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    refreshAccessToken: () => Promise.resolve(null),
    isSessionRejection: () => true,
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

const twoForecasts = [
  { ...mockForecast, _id: 'f1', date: '2026-03-28', totalPredictedRevenue: 20100 },
  { ...mockForecast, _id: 'f2', date: '2026-03-29', totalPredictedRevenue: 22000 },
]

// Wording the engine actually emits for a cafe with no matching history.
const AWAITING_REASON = 'At least 3 observed matching trading days are required; 0 available'
const CLOSED_REASON = 'Cafe is closed in its trading hours'

const awaitingDay = (id: string, date: string) => ({
  ...mockForecast,
  _id: id,
  date,
  items: [],
  totalPredictedRevenue: 0,
  availability: { status: 'insufficient_data' as const, reason: AWAITING_REASON },
  trainingData: { transactionCount: 0, weeksWithSales: 0 },
})

const closedDay = (id: string, date: string) => ({
  ...mockForecast,
  _id: id,
  date,
  items: [],
  totalPredictedRevenue: 0,
  availability: { status: 'closed' as const, reason: CLOSED_REASON },
  trainingData: { transactionCount: 0, weeksWithSales: 0 },
})

const readyDay = (id: string, date: string, revenue: number) => ({
  ...mockForecast,
  _id: id,
  date,
  totalPredictedRevenue: revenue,
  availability: { status: 'ready' as const, reason: '' },
  trainingData: { transactionCount: 900, weeksWithSales: 6 },
})

/** Mocks the three Planning requests, with the week payload supplied by the caller. */
const mockWeek = (forecasts: unknown[], meta?: Record<string, unknown>) => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts, meta } })
    if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
    if (url.includes('/forecasts/accuracy')) {
      return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
    }
    return Promise.resolve({ data: {} })
  })
}

describe('Forecasts', () => {
  it('warns about stale data from the latest sale, even when the weekday window is empty', async () => {
    const staleDay = (id: string, date: string) => ({
      ...readyDay(id, date, 12000),
      trainingData: { transactionCount: 0, weeksWithSales: 0, staleDays: 45, latestSaleDate: '2026-02-01T08:00:00.000Z' },
    })
    mockWeek([staleDay('s1', '2026-03-28'), staleDay('s2', '2026-03-29')])
    render(<Forecasts />)
    expect(await screen.findByText('Forecast data is getting stale')).toBeInTheDocument()
    expect(screen.getByText(/ending as early as .*2026/)).toBeInTheDocument()
  })
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the analytics view with key header stats', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: twoForecasts } })
      }
      if (url.includes('/forecasts/recent')) {
        return Promise.resolve({ data: { forecasts: [] } })
      }
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: 85, forecasts: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { data: [] } })
    })

    render(<Forecasts />)

    await waitFor(() => {
      expect(screen.getByText('Weekly predicted revenue')).toBeInTheDocument()
    })

    // Should show 30-day accuracy section
    expect(screen.getByText('30-day accuracy')).toBeInTheDocument()
    // Peak day section
    expect(screen.getByText('Peak day')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Forecasts />)
    const skeletons = document.querySelectorAll('[class*="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows summary header text', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Forecasts />)
    expect(screen.getByText(/7-day rolling sales forecast/i)).toBeInTheDocument()
  })

  it('shows empty state when no forecasts returned', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: [] } })
      }
      if (url.includes('/forecasts/recent')) {
        return Promise.resolve({ data: { forecasts: [] } })
      }
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { data: [] } })
    })

    render(<Forecasts />)

    await waitFor(() => {
      expect(screen.getByText(/Not enough trading history yet/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /import sales data/i })).toHaveAttribute('href', '/data-health')
  })

  it('shows an error instead of an empty-data prompt when the week request fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) return Promise.reject(new Error('service unavailable'))
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
    expect(screen.queryByText(/Not enough trading history yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('warns when the API returns only part of the seven-day plan', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: twoForecasts,
            meta: {
              expectedDays: 7,
              generatedDays: 2,
              failedDays: [{ dateKey: '2026-03-30', message: 'weather timeout' }],
              isPartial: true,
              insufficientData: false,
              insufficientDays: [],
            },
          },
        })
      }
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/2 of 7 forecast days/i)
  })

  it('shows a generation failure instead of an insufficient-data prompt when every day fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: [],
            meta: {
              expectedDays: 7,
              generatedDays: 0,
              failedDays: [{ dateKey: '2026-03-30', message: 'provider timeout' }],
              isPartial: true,
              insufficientData: false,
              insufficientDays: [],
            },
          },
        })
      }
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no forecast days could be generated/i)
    expect(screen.queryByText(/Not enough trading history yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('does not render zero-value plan cards when every day has insufficient history', async () => {
    mockWeek(
      twoForecasts.map((forecast) => ({
        ...forecast,
        availability: { status: 'insufficient_data', reason: AWAITING_REASON },
        items: [],
        totalPredictedRevenue: 0,
      })),
      {
        expectedDays: 7,
        generatedDays: 2,
        failedDays: [],
        isPartial: true,
        insufficientData: true,
        insufficientDays: ['2026-03-28', '2026-03-29'],
      }
    )

    render(<Forecasts />)

    expect(await screen.findByText(/not enough trading history yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Weekly predicted revenue')).not.toBeInTheDocument()
  })

  // The measured first-run shape: a brand-new cafe defaults to closed on Sunday
  // and open the other six days, so the week comes back as six insufficient_data
  // days plus one closed day. The closed day used to be enough to pass the
  // "some day is usable" gate, which rendered a R0 weekly total and a flat
  // trajectory chart over a cafe that has never traded.
  it('explains the missing history and offers the import step when no day has a forecast', async () => {
    mockWeek(
      [
        closedDay('c1', '2026-03-29'),
        ...Array.from({ length: 6 }, (_, index) => awaitingDay(`a${index}`, `2026-03-${30 + index}`)),
      ],
      {
        expectedDays: 7,
        generatedDays: 7,
        failedDays: [],
        isPartial: false,
        insufficientData: true,
        insufficientDays: ['2026-03-30'],
      }
    )

    render(<Forecasts />)

    expect(await screen.findByText(/not enough trading history yet/i)).toBeInTheDocument()
    // The backend rule, verbatim, so the copy cannot drift from it.
    expect(screen.getByText(new RegExp(AWAITING_REASON, 'i'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import sales data/i })).toHaveAttribute('href', '/data-health')

    // No confident-looking zero, and no chart drawn over nothing.
    expect(screen.queryByText('Weekly predicted revenue')).not.toBeInTheDocument()
    expect(screen.queryByText('Peak day')).not.toBeInTheDocument()
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.queryByText(/^R\s?0$/)).not.toBeInTheDocument()
  })

  it('keeps ready days, marks the pending ones, and totals only days with a forecast', async () => {
    mockWeek(
      [
        readyDay('r1', '2026-03-28', 20100),
        readyDay('r2', '2026-03-29', 22000),
        awaitingDay('a1', '2026-03-30'),
        awaitingDay('a2', '2026-03-31'),
      ],
      {
        expectedDays: 7,
        generatedDays: 4,
        failedDays: [],
        isPartial: true,
        insufficientData: true,
        insufficientDays: ['2026-03-30', '2026-03-31'],
      }
    )

    render(<Forecasts />)

    // Ready days survive untouched.
    expect(await screen.findByText('Weekly predicted revenue')).toBeInTheDocument()
    expect(screen.getByText('R 42 100')).toBeInTheDocument()
    // Peak day is the best of the days that actually have a forecast.
    expect(screen.getByText('Peak day')).toBeInTheDocument()
    expect(screen.getAllByText(/22.000/).length).toBeGreaterThan(0)

    // Pending days are marked individually rather than dropped or zeroed.
    expect(screen.getAllByText('Building history')).toHaveLength(2)
    expect(screen.getAllByText(AWAITING_REASON).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^R\s?0$/)).not.toBeInTheDocument()

    // And the page says what the total covers.
    expect(screen.getByText(/cover the 2 days with a forecast/i)).toBeInTheDocument()
    expect(screen.getByText(/2 days are still building history/i)).toBeInTheDocument()
  })

  it('leaves a fully ready week without pending markers or history notices', async () => {
    mockWeek([readyDay('r1', '2026-03-28', 20100), readyDay('r2', '2026-03-29', 22000)])

    render(<Forecasts />)

    expect(await screen.findByText('Weekly predicted revenue')).toBeInTheDocument()
    expect(screen.getByText('R 42 100')).toBeInTheDocument()
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    expect(screen.queryByText('Building history')).not.toBeInTheDocument()
    expect(screen.queryByText(/still building history/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not enough trading history yet/i)).not.toBeInTheDocument()
  })

  it('renders a fully closed week instead of replacing it with insufficient-data guidance', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: twoForecasts.map((forecast) => ({
              ...forecast,
              availability: {
                status: 'closed' as const,
                reason: 'Cafe is closed in its trading hours',
              },
              items: [],
              totalPredictedRevenue: 0,
            })),
            meta: {
              expectedDays: 7,
              generatedDays: 2,
              failedDays: [],
              isPartial: false,
              insufficientData: false,
              insufficientDays: [],
            },
          },
        })
      }
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect((await screen.findAllByText('Closed')).length).toBe(2)
    expect(screen.getAllByText('Cafe is closed in its trading hours')).toHaveLength(2)
    expect(screen.getByText('Weekly predicted revenue')).toBeInTheDocument()
    expect(screen.queryByText(/Not enough trading history yet/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /open forecast details/i })[0])
    const drawer = screen.getByRole('dialog', { name: /closed day/i })
    expect(within(drawer).getByText('No trading forecast')).toBeInTheDocument()
    expect(within(drawer).getByText('Cafe is closed in its trading hours')).toBeInTheDocument()
    expect(within(drawer).queryByText('Predicted revenue')).not.toBeInTheDocument()
  })

  it('qualifies the 30-day accuracy with the number of days behind it', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: twoForecasts } })
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({
          data: {
            avgAccuracy: 88,
            avgItemAccuracy: 61.6,
            itemAccuracyDays: 7,
            excludedInsufficientDays: 3,
            forecasts: [{ date: '2026-03-20', accuracy: 88, totalPredictedRevenue: 100 }],
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    // One matched day is not a track record, and this is the number an owner
    // uses to decide whether to trust the product at all.
    expect(await screen.findByText('88%')).toBeInTheDocument()
    expect(screen.getByText(/From 1 matched day — too few for a verdict yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Strong')).not.toBeInTheDocument()
    expect(screen.getByText('Per-item figure from 7 days.')).toBeVisible()
    expect(screen.getByText('3 building-history days not counted.')).toBeVisible()
  })

  it('opens the day drawer from a real button and returns focus to it on close', async () => {
    mockWeek([readyDay('r1', '2026-03-28', 20100)])

    render(<Forecasts />)

    const trigger = (await screen.findAllByRole('button', { name: /open forecast details/i }))[0]
    trigger.focus()
    fireEvent.click(trigger)

    const drawer = await screen.findByRole('dialog')
    expect(drawer).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })
  it('groups the weekdays that are the same distance away', async () => {
    // Most weeks every day is the same distance, and seven identical sentences
    // is noise rather than detail.
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: { forecasts: [awaitingDay('a1', '2026-03-30'), awaitingDay('a2', '2026-03-31')] },
        })
      }
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect(await screen.findByText('Monday, Tuesday')).toBeInTheDocument()
    // One sentence, not two.
    expect(screen.getAllByText(new RegExp(AWAITING_REASON.slice(0, 40)))).toHaveLength(1)
  })

  it('states each weekday’s own distance, not one day’s count for all seven', async () => {
    // Planning builds a Tuesday from Tuesdays, so each weekday is a different
    // distance from being forecastable. Showing the first day's reason against
    // all of them understates some and overstates others.
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: [
              {
                ...awaitingDay('a1', '2026-03-30'),
                availability: {
                  status: 'insufficient_data' as const,
                  reason: 'At least 3 observed matching trading days are required; 2 available',
                },
              },
              {
                ...awaitingDay('a2', '2026-03-31'),
                availability: {
                  status: 'insufficient_data' as const,
                  reason: 'At least 3 observed matching trading days are required; 0 available',
                },
              },
            ],
          },
        })
      }
      if (url.includes('/forecasts/recent')) return Promise.resolve({ data: { forecasts: [] } })
      if (url.includes('/forecasts/accuracy')) {
        return Promise.resolve({ data: { avgAccuracy: null, forecasts: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Forecasts />)

    expect(await screen.findByText(/What each day is still waiting for/i)).toBeInTheDocument()
    expect(screen.getByText('Monday')).toBeInTheDocument()
    expect(screen.getByText('Tuesday')).toBeInTheDocument()
    expect(screen.getByText(/2 available/)).toBeInTheDocument()
    expect(screen.getByText(/0 available/)).toBeInTheDocument()
  })
})
