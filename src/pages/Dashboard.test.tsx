import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import Dashboard from './Dashboard'
import { mockForecast, mockStats } from '@/test/mocks/api'

// Mock the logo asset
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Partial mock: only the axios instance and the session plumbing are faked.
// AuthProvider reads the module's other named exports during render, and a
// factory that omits one makes vitest throw the moment it is touched. The two
// overrides keep an unauthenticated render quiet — without them the provider
// treats the test's rejected /auth/me as an unreachable server and replaces
// the page under test with a startup notice.
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

// A week where Sunday is a scheduled closure: no items, no revenue, a reason.
const CLOSED_REASON = 'Scheduled weekly closure'
const closedWeekForecasts = [
  { ...mockForecast, _id: 'f1', date: '2026-03-28' },
  {
    ...mockForecast,
    _id: 'f2',
    date: '2026-03-29',
    availability: { status: 'closed', reason: CLOSED_REASON },
    items: [],
    totalPredictedRevenue: 0,
  },
  { ...mockForecast, _id: 'f3', date: '2026-03-30', totalPredictedRevenue: 18000 },
]

// The same Sunday, on a cafe whose sales say it trades on Sundays.
const CONTRADICTED_REASON =
  'Cafe is closed in its trading hours, but 538 sales were recorded on this weekday in the last 8 weeks. Check the trading hours in Settings — this day is forecasting zero.'
const contradictedWeekForecasts = closedWeekForecasts.map((forecast) =>
  forecast._id === 'f2'
    ? {
        ...forecast,
        availability: {
          status: 'closed',
          reason: CONTRADICTED_REASON,
          contradictsHistory: true,
        },
      }
    : forecast
)

function mockClosedWeek(forecasts: unknown[] = closedWeekForecasts) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts } })
    if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.reject(new Error('Unknown URL'))
  })
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders loading skeleton initially', () => {
    // Hang forever to keep loading state
    mockGet.mockImplementation(() => new Promise(() => {}))

    render(<Dashboard />)
    // Skeleton elements use animate-[skeleton-shimmer...] class
    const skeletons = document.querySelectorAll('[class*="skeleton-shimmer"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows KPI cards with forecast data after load', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: mockForecast } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: [mockForecast] } })
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      // Sidebar calls
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Revenue')).toBeInTheDocument()
    })

    // formatZAR: R20,100 -- use a flexible matcher
    expect(screen.getByText((text) => text.includes('20') && text.includes('100') && text.startsWith('R'))).toBeInTheDocument()
    // Should show top item
    expect(screen.getByText('Top Item')).toBeInTheDocument()
    expect(screen.getByText(/factor detail is unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText('Time-of-Day Breakdown')).not.toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalledWith('/forecasts/tomorrow')
  })

  it('shows empty state when no data uploaded', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('No data yet')).toBeInTheDocument()
    })

    expect(screen.getByText(/upload your transaction data/i)).toBeInTheDocument()
  })

  it('renders day selector with correct days', async () => {
    const weekForecasts = [
      { ...mockForecast, _id: 'f1', date: '2026-03-28' },
      { ...mockForecast, _id: 'f2', date: '2026-03-29' },
      { ...mockForecast, _id: 'f3', date: '2026-03-30' },
    ]

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: mockForecast } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: weekForecasts } })
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Revenue')).toBeInTheDocument()
    })

    // Check that at least 3 day selector buttons appear
    const dayButtons = document.querySelectorAll('button')
    expect(dayButtons.length).toBeGreaterThan(2)
  })

  it('uses the selected week forecast instead of briefly swapping from the today fallback', async () => {
    const todayFallbackForecast = {
      ...mockForecast,
      _id: 'today-fallback',
      date: '2026-03-28',
      signals: {
        ...mockForecast.signals,
        weather: { temp: 31, condition: 'Rain', humidity: 80 },
      },
    }
    const selectedWeekForecast = {
      ...mockForecast,
      _id: 'today',
      date: '2026-03-28',
      signals: {
        ...mockForecast.signals,
        weather: { temp: 18, condition: 'Cloudy', humidity: 55 },
      },
    }

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: todayFallbackForecast } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: [selectedWeekForecast] } })
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Cloudy')).toBeInTheDocument()
    })

    expect(screen.queryByText('Rain')).not.toBeInTheDocument()
  })

  it('uses the today forecast as fallback when week forecasts fail', async () => {
    const todayForecast = {
      ...mockForecast,
      _id: 'today-only',
      signals: {
        ...mockForecast.signals,
        weather: { temp: 21, condition: 'Partly cloudy', humidity: 58 },
      },
    }

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: todayForecast } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.reject(new Error('week failed'))
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test', location: { city: 'Cape Town' } } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Partly cloudy')).toBeInTheDocument()
    })

    expect(screen.queryByText('Forecast unavailable')).not.toBeInTheDocument()
  })

  it('shows a forecast unavailable state when sales exist but forecast calls fail', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today') || url.includes('/forecasts/week')) {
        return Promise.reject(new Error('forecast failed'))
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Forecast unavailable')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    // FB-020 (UAT-05 review, UX-6): the owner was told to "check the backend logs".
    expect(screen.queryByText(/backend logs/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Your sales data is safe/)).toBeInTheDocument()
  })

  it('shows a clear no-predictions state when a forecast has no items', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: { ...mockForecast, items: [] } } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: [] } })
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('No item predictions for this day')).toBeInTheDocument()
    })

    expect(screen.queryByText('Time-of-Day Breakdown')).not.toBeInTheDocument()
  })

  it('shows weather card with temperature', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) {
        return Promise.resolve({ data: { forecast: mockForecast } })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: [mockForecast] } })
      }
      if (url.includes('/transactions/stats')) {
        return Promise.resolve({ data: { stats: mockStats } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test', location: { address: '123 Test St', city: 'Cape Town' } } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    await waitFor(() => {
      // Weather card should show temp -- multiple elements may contain "24"
      const tempElements = screen.getAllByText((text) => text.includes('24') && text.includes('°'))
      expect(tempElements.length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Sunny')).toBeInTheDocument()
    expect(screen.getByText('60% humidity')).toBeInTheDocument()
    expect(screen.getByText('123 Test St, Cape Town')).toBeInTheDocument()
  })

  it('shows honest unavailable states instead of fabricated weather or stage zero', async () => {
    const unavailableForecast = {
      ...mockForecast,
      signals: {
        ...mockForecast.signals,
        weather: {
          available: false,
          condition: 'Unavailable',
          unavailableReason: 'Cafe coordinates are not configured',
        },
        loadSheddingStage: null,
        loadSheddingAvailable: false,
        loadSheddingUnavailableReason: 'Provider unavailable',
      },
    }
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) return Promise.resolve({ data: { forecast: unavailableForecast } })
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: [unavailableForecast] } })
      if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    expect(await screen.findByText('Weather unavailable')).toBeInTheDocument()
    expect(screen.getByText('Cafe coordinates are not configured')).toBeInTheDocument()
    expect(screen.getByText('Load shedding unavailable')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('undefined°')
    expect(document.body.textContent).not.toContain('undefined%')
  })

  it('does not misreport an API failure as an empty account', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) return Promise.reject(new Error('forecast service offline'))
      if (url.includes('/forecasts/today')) return Promise.reject(new Error('forecast service offline'))
      if (url.includes('/transactions/stats')) return Promise.reject(new Error('stats service offline'))
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    expect(await screen.findByText('Dashboard data unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders a closed day as closed instead of blaming missing item history', async () => {
    mockClosedWeek()

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Revenue')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /29 Mar/ }))

    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('No trading forecast')).toBeInTheDocument()
    expect(screen.getByText(CLOSED_REASON)).toBeInTheDocument()
    expect(screen.queryByText('No item predictions for this day')).not.toBeInTheDocument()
    expect(screen.queryByText(/uploading more pos data/i)).not.toBeInTheDocument()
  })

  it('averages forecast revenue over trading days, not over closed days', async () => {
    mockClosedWeek()

    render(<Dashboard />)

    // (20 100 + 18 000) over the two trading days is R19 050; spreading it over
    // all three calendar days would read R12 700.
    expect(await screen.findByText(/Avg: R19\s?050\/day/)).toBeInTheDocument()
    expect(screen.queryByText(/Avg: R12\s?700\/day/)).not.toBeInTheDocument()
  })

  /** Mocks the four Today requests with a single week forecast. */
  function mockWeek(forecast: Record<string, unknown>) {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) return Promise.resolve({ data: { forecast } })
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: [forecast] } })
      if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })
  }

  it('rounds the unrounded item total for display', async () => {
    mockWeek({
      ...mockForecast,
      _id: 'f-unrounded',
      forecastCoverage: { itemCount: 41, storedItemCount: 25, totalPredictedQty: 812.4, includesAllRevenue: true },
    })
    render(<Dashboard />)
    expect(await screen.findByText('812')).toBeInTheDocument()
    expect(screen.queryByText('812.4')).not.toBeInTheDocument()
  })

  it('counts every forecast line in Total Items, not only the 25 the API stores', async () => {
    // Revenue is accumulated over all 41 lines; summing the stored 25 put a
    // short Total Items directly beside a complete Forecast Revenue.
    mockWeek({
      ...mockForecast,
      _id: 'f-coverage',
      forecastCoverage: {
        itemCount: 41,
        storedItemCount: 25,
        totalPredictedQty: 812,
        includesAllRevenue: true,
      },
    })

    render(<Dashboard />)

    expect(await screen.findByText('812')).toBeInTheDocument()
    expect(screen.getByText('across 41 forecast lines')).toBeInTheDocument()
    expect(screen.getByText(/Showing the 25 largest of 41 forecast lines/i)).toBeInTheDocument()
    // 30 + 31 + 3 is what summing the stored array gives.
    expect(screen.queryByText('64')).not.toBeInTheDocument()
  })

  it('marks a low-confidence line instead of printing it at the same weight as a proven one', async () => {
    mockWeek({
      ...mockForecast,
      _id: 'f-confidence',
      items: [
        { itemName: 'Flat White (Blend)', predictedQty: 30, baseQty: 30, confidence: 'high' },
        { itemName: 'Long White (Blend)', predictedQty: 20, baseQty: 20, confidence: 'low' },
      ],
    })

    render(<Dashboard />)

    await waitFor(() => expect(screen.getByText('Forecast Revenue')).toBeInTheDocument())
    expect(screen.getByText('low confidence')).toBeInTheDocument()
  })

  it('says once, at the top, when a whole week of history caps every line to low', async () => {
    mockWeek({
      ...mockForecast,
      _id: 'f-all-low',
      items: [
        { itemName: 'Flat White (Blend)', predictedQty: 30, baseQty: 30, confidence: 'low' },
        { itemName: 'Long White (Blend)', predictedQty: 20, baseQty: 20, confidence: 'low' },
      ],
    })

    render(<Dashboard />)

    expect(await screen.findByText(/Every line below is low confidence/i)).toBeInTheDocument()
    // One statement, not one annotation per card.
    expect(screen.queryByText('low confidence')).not.toBeInTheDocument()
  })

  it('grades the accuracy badge instead of dressing a bad score as a good one', async () => {
    mockWeek({ ...mockForecast, _id: 'f-weak-accuracy', accuracy: 41 })

    render(<Dashboard />)

    const badge = await screen.findByText('41% accuracy')
    expect(badge.className).not.toContain('guava-green')
  })

  it('does not emit a stray zero beside the revenue target', async () => {
    mockWeek({ ...mockForecast, _id: 'f-zero-accuracy', accuracy: 0 })

    render(<Dashboard />)

    expect(await screen.findByText('0% accuracy')).toBeInTheDocument()
  })

  it('tells assistive tech which day is selected', async () => {
    mockClosedWeek()

    render(<Dashboard />)

    await waitFor(() => expect(screen.getByText('Forecast Revenue')).toBeInTheDocument())

    const group = screen.getByRole('group', { name: /forecast day/i })
    const days = within(group).getAllByRole('button')
    expect(days[0]).toHaveAttribute('aria-pressed', 'true')
    expect(days[1]).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(days[1])
    expect(days[0]).toHaveAttribute('aria-pressed', 'false')
    expect(days[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('states what the forecast is built from when no factor moved it', async () => {
    // Six grey gauges and three upsell badges is the entire answer an entry
    // plan used to get on the screen it orders from.
    mockWeek({
      ...mockForecast,
      _id: 'f-basis',
      factors: [{ key: 'weather', label: 'Weather', active: false, effect: 'no effect' }],
      trainingData: { transactionCount: 778, weeksWithSales: 8, lastTransactionDate: '2026-03-20' },
    })

    render(<Dashboard />)

    expect(await screen.findByText(/Nothing adjusted this forecast today/i)).toBeInTheDocument()
    expect(screen.getByText(/weighted average of your last 8 matching/i)).toBeInTheDocument()
  })

  it('does not print R0 as the headline forecast for a day it cannot answer', async () => {
    // Planning refuses to sum or print a day still building history; Today is
    // the screen people actually order from, so it must not print one either.
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: [
              {
                ...mockForecast,
                _id: 'f-awaiting',
                date: '2026-03-28',
                items: [],
                totalPredictedRevenue: 0,
                availability: {
                  status: 'insufficient_data',
                  reason: 'At least 2 observed matching trading days are required; 1 available',
                },
              },
              { ...mockForecast, _id: 'f-ready', date: '2026-03-30', totalPredictedRevenue: 18000 },
            ],
          },
        })
      }
      if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    expect(await screen.findByText('Not enough history for this day yet')).toBeInTheDocument()
    expect(screen.queryByText('R0')).not.toBeInTheDocument()
    // The engine's own words, not a hardcoded "three comparable weeks".
    expect(screen.getByText(/At least 2 observed matching trading days are required/)).toBeInTheDocument()
    expect(screen.queryByText(/three comparable weeks/i)).not.toBeInTheDocument()
  })

  it('keeps a day with no forecast out of the weekly average', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({
          data: {
            forecasts: [
              { ...mockForecast, _id: 'f-ready', date: '2026-03-30', totalPredictedRevenue: 18000 },
              {
                ...mockForecast,
                _id: 'f-awaiting',
                date: '2026-03-31',
                items: [],
                totalPredictedRevenue: 0,
                availability: { status: 'insufficient_data', reason: 'not enough history' },
              },
            ],
          },
        })
      }
      if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Dashboard />)

    // R18 000 over the one day that has a forecast, not R9 000 over two.
    expect(await screen.findByText(/Avg: R18\s?000\/day/)).toBeInTheDocument()
    expect(screen.queryByText(/Avg: R9\s?000\/day/)).not.toBeInTheDocument()
  })

  it('shows a locked factor reason without needing a mouse hover', async () => {
    mockWeek({
      ...mockForecast,
      _id: 'f-locked',
      factors: [{ key: 'payday', label: 'Payday', active: false, effect: 'no effect' }],
      factorEntitlements: {
        plan: 'starter',
        factors: [
          { key: 'payday', label: 'Payday', section: 'payday', requiredPlan: 'growth', summary: '', unlocked: false },
        ],
        unlockedKeys: [],
        lockedKeys: ['payday'],
      },
    })

    render(<Dashboard />)

    expect(await screen.findByText('Unlock on Growth')).toBeInTheDocument()
  })
  it('warns on Today when a closed day contradicts the cafe’s own sales', async () => {
    // Today is the screen the day is run from. A zero here that eight weeks of
    // Sundays contradict is a setting nobody has checked, and it scored 0%
    // against real sales every one of those weeks.
    mockClosedWeek(contradictedWeekForecasts)

    render(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Revenue')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /29 Mar/ }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/538 sales/)
    expect(within(alert).getByRole('link', { name: /open trading hours/i })).toHaveAttribute(
      'href',
      '/settings?section=general'
    )
    // The muted "day off" card is the wrong register for a broken setting.
    expect(screen.queryByText('No trading forecast')).toBeNull()
  })
  it('offers the fix when weather is off because the cafe has no coordinates', async () => {
    // "Cafe coordinates are not configured" is a dead end: it names a setting
    // without saying it is a setting, let alone where. The owner can fix this
    // one themselves in under a minute.
    mockClosedWeek([
      {
        ...mockForecast,
        _id: 'f1',
        date: '2026-03-28',
        signals: {
          ...mockForecast.signals,
          weather: {
            available: false,
            condition: '',
            unavailableReason: 'Cafe coordinates are not configured',
          },
        },
      },
    ])

    render(<Dashboard />)

    expect(await screen.findByText('Weather unavailable')).toBeInTheDocument()
    expect(screen.getByText('Cafe coordinates are not configured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /set cafe location/i })).toHaveAttribute(
      'href',
      // Opens the editor, not the read-only summary: the fields this link
      // promises are behind the Edit button.
      '/settings?section=general&edit=cafe'
    )
  })

  it('does not offer a fix the owner cannot carry out', async () => {
    // A missing WEATHER_API_KEY is ours, not theirs. Sending them to Settings
    // to look for a control that is not there is worse than saying nothing.
    mockClosedWeek([
      {
        ...mockForecast,
        _id: 'f1',
        date: '2026-03-28',
        signals: {
          ...mockForecast.signals,
          weather: {
            available: false,
            condition: '',
            unavailableReason: 'Weather service is not configured',
          },
        },
      },
    ])

    render(<Dashboard />)

    expect(await screen.findByText('Weather service is not configured')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /set cafe location/i })).toBeNull()
  })
  // The engine grades every line. Only `low` is printed, on purpose — three
  // grades on twenty tiles flattens the signal again. But a grade that is
  // never printed is also never announced, so a screen reader hears "33 Flat
  // White" for a line with three months behind it and for one with a
  // fortnight, exactly the gap the visible note was added to close.
  const gradedWeek = (confidence: 'high' | 'medium' | 'low') => [
    {
      ...mockForecast,
      _id: 'f1',
      date: '2026-03-28',
      items: [
        { itemName: 'Flat White (Blend)', predictedQty: 30, confidence },
        { itemName: 'Long White (Blend)', predictedQty: 31, confidence: 'high' },
      ],
    },
  ]

  it('announces the confidence grade it does not print', async () => {
    mockClosedWeek(gradedWeek('high'))

    render(<Dashboard />)

    await waitFor(() => expect(screen.getByText('Forecast Revenue')).toBeInTheDocument())

    // Two graded lines, both high: announced twice, printed never.
    expect(screen.getAllByText('high confidence')).toHaveLength(2)
    expect(screen.queryByText('low confidence')).toBeNull()
  })

  it('does not announce a low line twice', async () => {
    mockClosedWeek(gradedWeek('low'))

    render(<Dashboard />)

    await waitFor(() => expect(screen.getByText('Forecast Revenue')).toBeInTheDocument())

    // One low line keeps its printed note; the sr-only copy would be a
    // duplicate reading of the same words. (When EVERY line is low the banner
    // says it once and the tiles say nothing — covered by its own test.)
    expect(screen.getAllByText('low confidence')).toHaveLength(1)
    expect(screen.getAllByText('high confidence')).toHaveLength(1)
  })
  describe('first-run setup checklist', () => {
    beforeEach(() => localStorage.clear())

    const noCoords = {
      ...mockForecast.signals,
      weather: {
        available: false,
        condition: '',
        unavailableReason: 'Cafe coordinates are not configured',
      },
    }

    it('lists the settings that are holding the forecasts back', async () => {
      // Both of these are already stated where they bite. What was missing is
      // one place, on the screen a new owner opens, saying the work is
      // outstanding at all.
      mockClosedWeek([
        { ...mockForecast, _id: 'f1', date: '2026-03-28', signals: noCoords },
        {
          ...mockForecast,
          _id: 'f2',
          date: '2026-03-29',
          signals: noCoords,
          items: [],
          totalPredictedRevenue: 0,
          availability: { status: 'closed', reason: CONTRADICTED_REASON, contradictsHistory: true },
        },
      ])

      render(<Dashboard />)

      await waitFor(() => expect(screen.getByText('Finish setting up')).toBeInTheDocument())
      expect(screen.getByText(/2 settings are holding your forecasts back/i)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /set your cafe's location/i })).toBeInTheDocument()
      // Named, not "a day": the owner has to know which switch to look at.
      expect(screen.getByRole('link', { name: /sunday is set to closed/i })).toBeInTheDocument()
    })

    it('says nothing when there is nothing outstanding', async () => {
      mockClosedWeek([{ ...mockForecast, _id: 'f1', date: '2026-03-28' }])

      render(<Dashboard />)

      await waitFor(() => expect(screen.getByText('Forecast Revenue')).toBeInTheDocument())
      expect(screen.queryByText('Finish setting up')).toBeNull()
    })
  })

  it('shows the daytime high on Today instead of the overnight mean', async () => {
    const forecast = { ...mockForecast, signals: { ...mockForecast.signals,
      weather: { available: true, temp: 20, maxTemp: 29, condition: 'Sunny', humidity: 50 },
    } }
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/today')) return Promise.resolve({ data: { forecast } })
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: [forecast] } })
      if (url.includes('/transactions/stats')) return Promise.resolve({ data: { stats: mockStats } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })
    render(<Dashboard />)
    expect(await screen.findByText('High 29°C')).toBeInTheDocument()
  })

})
