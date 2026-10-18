import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import Analytics from './Analytics'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock recharts
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  const fillFrom = (value: unknown) => {
    if (value && typeof value === 'object' && 'fill' in value) {
      return String((value as { fill?: unknown }).fill ?? '')
    }
    return ''
  }

  return {
    // The real container: how it sizes itself before layout is behaviour under test.
    ResponsiveContainer: actual.ResponsiveContainer,
    AreaChart: ({ children }: { children: React.ReactNode }) => <svg data-testid="area-chart">{children}</svg>,
    Area: () => <div data-testid="area" />,
    BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Bar: ({ activeBar }: { activeBar?: unknown }) => <div data-testid="bar" data-active-fill={fillFrom(activeBar)} />,
    PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
    Pie: ({ children }: { children: React.ReactNode }) => <div data-testid="pie">{children}</div>,
    Cell: () => <div />,
    Tooltip: ({ cursor }: { cursor?: unknown }) => <div data-testid="tooltip" data-cursor-fill={fillFrom(cursor)} />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    CartesianGrid: () => <div />,
  }
})

// Mock the api module. Partial: AuthProvider reads API_CONFIG_ERROR and
// isSessionRejection from it while rendering, and a factory that omits them
// makes vitest throw the moment one is touched.
const mockGet = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    refreshAccessToken: () => Promise.resolve('test-access-token'),
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

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders revenue tab by default', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('Items')).toBeInTheDocument()
    expect(screen.getByText('Heatmap')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('Combos')).toBeInTheDocument()
  })

  it('switches between tabs', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)

    const itemsTab = screen.getByRole('tab', { name: 'Items' })
    await userEvent.click(itemsTab)

    await waitFor(() => {
      expect(itemsTab.className).toContain('text-guava-red')
    })
  })

  it('shows revenue chart with data', async () => {
    // New envelope shape: summary at top-level AND inside meta
    const revenueData = {
      data: [
        { date: '2026-03-01', revenue: 5000, transactions: 50 },
        { date: '2026-03-02', revenue: 6000, transactions: 60 },
      ],
      summary: {
        totalRevenue: 11000,
        avgDailyRevenue: 5500,
        bestDay: { date: '2026-03-02', revenue: 6000 },
        worstDay: { date: '2026-03-01', revenue: 5000 },
        trend: 5.2,
      },
      meta: {
        startDate: '2026-03-01',
        endDate: '2026-03-02',
        period: 'daily',
        summary: {
          totalRevenue: 11000,
          avgDailyRevenue: 5500,
          bestDay: { date: '2026-03-02', revenue: 6000 },
          worstDay: { date: '2026-03-01', revenue: 5000 },
          trend: 5.2,
        },
      },
    }

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: revenueData })
    })

    render(<Analytics />)

    await waitFor(() => {
      expect(screen.getByText('Daily Revenue')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Revenue')).toBeInTheDocument()
    // Verify total revenue is displayed (formatted with locale)
    expect(screen.getByText((text) => text.includes('11') && text.includes('000') && text.startsWith('R'))).toBeInTheDocument()
  })

  it('shows loading state', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)

    // Should show skeleton loading while waiting (skeleton-shimmer)
    const skeletons = document.querySelectorAll('[class*="skeleton-shimmer"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows item performance table', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [
              { name: 'Flat White', totalQty: 200, totalRevenue: 8000, avgPerDay: 10, trend: 5.0 },
              { name: 'Long White', totalQty: 180, totalRevenue: 7200, avgPerDay: 9, trend: -2.0 },
            ],
            meta: {
              startDate: null,
              endDate: null,
              risingItems: [{ name: 'Flat White', trend: 5.0 }],
              decliningItems: [{ name: 'Long White', trend: -2.0 }],
            },
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)

    // Click Items tab
    await userEvent.click(screen.getByRole('tab', { name: 'Items' }))

    await waitFor(() => {
      expect(screen.getByText('Item Performance')).toBeInTheDocument()
    })

    expect(screen.getAllByText('Flat White').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Long White').length).toBeGreaterThan(0)
  })

  it('uses dark-theme hover styling on the item bar chart', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [
              { name: 'Flat White', totalQty: 200, totalRevenue: 8000, avgPerDay: 10, trend: 5.0 },
              { name: 'Long White', totalQty: 180, totalRevenue: 7200, avgPerDay: 9, trend: -2.0 },
            ],
            meta: { startDate: null, endDate: null },
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)

    await userEvent.click(screen.getByRole('tab', { name: 'Items' }))

    await waitFor(() => {
      expect(screen.getByText('Top 10 Items by Quantity')).toBeInTheDocument()
    })

    expect(screen.getByTestId('tooltip')).toHaveAttribute('data-cursor-fill', 'rgba(77, 166, 59, 0.08)')
    expect(screen.getByTestId('bar')).toHaveAttribute('data-active-fill', '#62B84D')
  })

  it('shows combos tab with data', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/combos')) {
        return Promise.resolve({
          data: {
            success: true,
            data: [
              { pair: ['Flat White', 'Brownie'], count: 42 },
              { pair: ['Long White', 'Muffin'], count: 28 },
            ],
            meta: { startDate: null, endDate: null },
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)

    await userEvent.click(screen.getByRole('tab', { name: 'Combos' }))

    await waitFor(() => {
      expect(screen.getByText('Frequently Bought Together')).toBeInTheDocument()
    })

    expect(screen.getByText('Flat White + Brownie')).toBeInTheDocument()
    expect(screen.getByText('Long White + Muffin')).toBeInTheDocument()
  })

  it('maps heatmap weekday indexes to the correct rows', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({
          data: {
            success: true,
            heatmap: [{ dayOfWeek: 1, hour: 8, revenue: 100, transactions: 3 }],
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { data: [], summary: { totalRevenue: 0, avgDailyRevenue: 0, bestDay: null, worstDay: null, trend: 0 } } })
    })

    render(<Analytics />)

    await userEvent.click(screen.getByRole('tab', { name: 'Heatmap' }))

    await waitFor(() => {
      expect(screen.getByText('Average Revenue Heatmap')).toBeInTheDocument()
    })

    expect(screen.getByTitle('Mon 08:00 - R100 avg')).toBeInTheDocument()
    expect(screen.getByTitle('Sun 08:00 - R0 avg')).toBeInTheDocument()
  })

  const zeroGrid = () => {
    const heatmap: Array<Record<string, number>> = [] // typed: tsconfig.app.json type-checks test files too (strict)
    for (let day = 0; day <= 6; day++) {
      for (let hour = 6; hour <= 22; hour++) heatmap.push({ dayOfWeek: day, hour, revenue: 0, transactions: 0, observedDays: 0 })
    }
    return heatmap
  }

  it('says the sales have dates but no times instead of drawing an empty heatmap', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({ data: { success: true, heatmap: zeroGrid(),
          meta: { timeOfDay: { transactionsWithTime: 0, transactionsWithoutTime: 120 } } } })
      }
      return Promise.resolve({ data: {} })
    })
    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))
    expect(await screen.findByText(/dates but no times/i)).toBeInTheDocument()
    expect(screen.queryByText(/no trading activity in this window/i)).not.toBeInTheDocument()
  })

  it('notes how many sales the heatmap leaves out for having no time', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({ data: { success: true,
          heatmap: [{ dayOfWeek: 1, hour: 8, revenue: 100, transactions: 3 }],
          meta: { timeOfDay: { transactionsWithTime: 30, transactionsWithoutTime: 12 } } } })
      }
      return Promise.resolve({ data: {} })
    })
    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))
    expect(await screen.findByText(/12 sales in this window came from exports with dates but no times/i)).toBeInTheDocument()
  })

  it('says "1 sale" when a single sale has no time', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({ data: { success: true,
          heatmap: [{ dayOfWeek: 1, hour: 8, revenue: 100, transactions: 3 }],
          meta: { timeOfDay: { transactionsWithTime: 30, transactionsWithoutTime: 1 } } } })
      }
      return Promise.resolve({ data: {} })
    })
    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))
    expect(await screen.findByText(/^1 sale in this window came from an export with dates but no times, so it is not/i)).toBeInTheDocument()
  })

  it('shows tipping rate as percentage (no double-multiply)', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/customers')) {
        return Promise.resolve({
          data: {
            insights: {
              avgTransactionValue: 85,
              avgItemsPerTransaction: 2.1,
              cashVsCardRatio: { cash: 30, card: 70 },
              tippingRate: 23.5,   // backend already returns percentage form
              avgTip: 4.50,
            },
            meta: { startDate: null, endDate: null },
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)

    await userEvent.click(screen.getByRole('tab', { name: 'Customers' }))

    await waitFor(() => {
      expect(screen.getByText('Tipping Rate')).toBeInTheDocument()
    })

    // Should display "23.5%" not "2350.0%"
    expect(screen.getByText('23.5%')).toBeInTheDocument()
  })

  it('does not invent movers when the backend reports none', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [
              { name: 'Flat White', totalQty: 400, totalRevenue: 8000, avgPerDay: 10, trend: -1.0 },
              { name: 'Long White', totalQty: 380, totalRevenue: 7200, avgPerDay: 9, trend: -2.0 },
            ],
            // Backend sign-filters, so an empty array means nothing is rising.
            meta: { startDate: null, endDate: null, risingItems: [], decliningItems: [] },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))

    await waitFor(() => expect(screen.getByText('Movers')).toBeInTheDocument())
    expect(screen.getByText(/no rising items/i)).toBeInTheDocument()
    expect(screen.queryByText('+-2.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('+-1.0%')).not.toBeInTheDocument()
  })

  it('says how far short the volume is, not just that it is short', async () => {
    // "Not enough volume to rank movers yet" named the problem without the
    // threshold, so nobody could tell whether they were one busy week away or
    // six months. A small cafe reads this and learns nothing.
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [
              { name: 'Flat White', totalQty: 22, totalRevenue: 880, avgPerDay: 0.7, trend: 4 },
              { name: 'Croissant', totalQty: 9, totalRevenue: 270, avgPerDay: 0.3, trend: -2 },
            ],
            meta: { startDate: null, endDate: null, risingItems: [], decliningItems: [], newItems: [],
              moverFloor: { minAvgPerDay: 2, windowDays: 7, minQty: 14, eligibleCount: 0, busiestQty: 9 } },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))

    await waitFor(() => expect(screen.getByText('Movers')).toBeInTheDocument())
    const note = screen.getAllByText(/so ranking movers would be noise/i)[0]
    // The bar, the window it is measured over, and where they actually are.
    expect(note).toHaveTextContent(/14\+ in either of the last two weeks/)
    expect(note).toHaveTextContent(/busiest line sold 9 in a week/)
  })

  it('marks the Movers window as fixed and independent of the range selector', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [{ name: 'Flat White', totalQty: 400, totalRevenue: 8000, avgPerDay: 10, trend: 5 }],
            meta: { risingItems: [{ name: 'Flat White', trend: 5 }], decliningItems: [] },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))

    await waitFor(() => expect(screen.getByText('Movers')).toBeInTheDocument())
    expect(screen.getByText(/ignores the range above/i)).toBeInTheDocument()
    expect(screen.getByText('Fixed 7-day window')).toBeInTheDocument()
  })

  it('names the window the item Trend column actually measures', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [{ name: 'Flat White', totalQty: 400, totalRevenue: 8000, avgPerDay: 10, trend: 5 }],
            meta: {},
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))

    expect(await screen.findByRole('columnheader', { name: /7d vs prior 7d/i })).toBeInTheDocument()
  })

  it('says the heatmap window has no trade rather than drawing an all-zero grid', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        // The backend always emits a full grid, zero-filled.
        const heatmap = []
        for (let day = 0; day <= 6; day++) {
          for (let hour = 6; hour <= 22; hour++) {
            heatmap.push({ dayOfWeek: day, hour, revenue: 0, transactions: 0, observedDays: 0 })
          }
        }
        return Promise.resolve({ data: { success: true, heatmap } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))

    expect(await screen.findByText(/no trading activity in this window/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/Mon 08:00/)).not.toBeInTheDocument()
  })

  it('makes heatmap values reachable by keyboard and screen reader', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({
          data: { success: true, heatmap: [{ dayOfWeek: 1, hour: 8, revenue: 100, transactions: 3 }] },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))

    const cell = await screen.findByRole('button', { name: /monday 08:00/i })
    expect(cell).toHaveAccessibleName(/R100/)
    expect(screen.getByRole('rowheader', { name: 'Mon' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '08:00' })).toBeInTheDocument()
  })

  it('does not report a fabricated payment split when the import has no payment methods', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/customers')) {
        return Promise.resolve({
          data: {
            insights: {
              avgTransactionValue: 85,
              avgItemsPerTransaction: 2.1,
              cashVsCardRatio: null,
              tippingRate: 12,
              avgTip: 4.5,
            },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /customers/i }))

    expect(await screen.findByText(/does not include payment methods/i)).toBeInTheDocument()
    expect(screen.queryByText('Card: 0.0%')).not.toBeInTheDocument()
    expect(screen.queryByText('Cash: 0.0%')).not.toBeInTheDocument()
  })

  it('calls an unmeasured customer period empty instead of reporting authoritative zeros', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/customers')) {
        return Promise.resolve({
          data: {
            insights: {
              avgTransactionValue: 0,
              avgItemsPerTransaction: 0,
              cashVsCardRatio: null,
              tippingRate: 0,
              avgTip: 0,
            },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /customers/i }))

    expect(await screen.findByText(/no customer data for this period/i)).toBeInTheDocument()
    expect(screen.queryByText('Tipping Rate')).not.toBeInTheDocument()
  })

  it('rounds small per-transaction money to cents', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/customers')) {
        return Promise.resolve({
          data: {
            insights: {
              avgTransactionValue: 85.4,
              avgItemsPerTransaction: 2.1,
              cashVsCardRatio: { cash: 30, card: 70 },
              tippingRate: 12,
              avgTip: 4.5,
            },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /customers/i }))

    // en-ZA writes the decimal separator as a comma.
    expect(await screen.findByText('R4,50')).toBeInTheDocument()
  })

  it('keeps the range selector and offers a retry when a tab fails to load', async () => {
    let attempts = 0
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        attempts += 1
        return Promise.reject(new Error('timeout'))
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))

    expect(await screen.findByText(/failed to load heatmap data/i)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /date range/i })).toBeInTheDocument()

    const before = attempts
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(attempts).toBeGreaterThan(before))
  })

  it('exposes tab state through tab semantics rather than colour alone', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)

    const revenue = screen.getByRole('tab', { name: 'Revenue' })
    expect(revenue).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tablist')).toBeInTheDocument()

    revenue.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveAttribute('aria-selected', 'true')
  })

  it('announces which range is applied', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)

    const group = screen.getByRole('group', { name: /date range/i })
    const thirty = within(group).getByRole('button', { name: /last 30 days/i })
    expect(thirty).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: /last 7 days/i })).toHaveAttribute('aria-pressed', 'false')
  })

  it('carries one range across tabs instead of silently resetting it', async () => {
    mockGet.mockImplementation(() => Promise.resolve({ data: {} }))
    render(<Analytics />)

    await userEvent.click(within(screen.getByRole('group', { name: /date range/i })).getByRole('button', { name: /last 7 days/i }))
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))
    await userEvent.click(screen.getByRole('tab', { name: /revenue/i }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('group', { name: /date range/i })).getByRole('button', { name: /last 7 days/i })
      ).toHaveAttribute('aria-pressed', 'true')
    })
  })

  it('anchors the date range to Johannesburg rather than the browser clock', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    render(<Analytics />)

    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    const revenueCall = mockGet.mock.calls.find((call) => String(call[0]).includes('/analytics/revenue'))
    const endDate = String(revenueCall?.[0]).match(/endDate=(\d{4}-\d{2}-\d{2})/)?.[1]
    const johannesburgToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Johannesburg',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    expect(endDate).toBe(johannesburgToday)
  })

  it('gives screen readers the revenue numbers the chart draws', async () => {
    const summary = {
      totalRevenue: 11000,
      avgDailyRevenue: 5500,
      bestDay: { date: '2026-03-02', revenue: 6000 },
      worstDay: { date: '2026-03-01', revenue: 5000 },
      trend: 5.2,
    }
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/revenue')) {
        return Promise.resolve({
          data: {
            data: [
              { date: '2026-03-01', revenue: 5000, transactions: 50 },
              { date: '2026-03-02', revenue: 6000, transactions: 60 },
            ],
            summary,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)

    const table = await screen.findByRole('table', { name: /daily revenue/i })
    expect(
      within(table).getByText((text) => text.replace(/\s/g, '') === 'R6000')
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /daily revenue/i })).toBeInTheDocument()
  })

  it('renders the revenue chart on first paint without a width(-1) size warning', async () => {
    // jsdom has no layout and no ResizeObserver, so Recharts never measures the
    // wrapper: whatever size the container assumes initially is what renders.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const summary = {
      totalRevenue: 11000,
      avgDailyRevenue: 5500,
      bestDay: { date: '2026-03-02', revenue: 6000 },
      worstDay: { date: '2026-03-01', revenue: 5000 },
      trend: 5.2,
    }
    const revenueData = {
      data: [
        { date: '2026-03-01', revenue: 5000, transactions: 50 },
        { date: '2026-03-02', revenue: 6000, transactions: 60 },
      ],
      summary,
      meta: { startDate: '2026-03-01', endDate: '2026-03-02', period: 'daily', summary },
    }
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: revenueData })
    })

    render(<Analytics />)

    expect(await screen.findByTestId('area-chart')).toBeInTheDocument()
    const sizeWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('width(-1)'))
    expect(sizeWarnings).toEqual([])
    warn.mockRestore()
  })
it('shows the trend against the windows the server compared, not the client clock', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/analytics/revenue')) {
      return Promise.resolve({
        data: {
          data: [{ date: '2026-08-03', revenue: 5000, transactions: 10 }],
          summary: {
            totalRevenue: 145000,
            avgDailyRevenue: 5000,
            bestDay: { date: '2026-08-03', revenue: 5000 },
            worstDay: { date: '2026-08-03', revenue: 5000 },
            trend: 0,
          },
          meta: {
            effectiveStartDay: '2026-07-06',
            effectiveEndDay: '2026-08-04',
            effectiveDays: 30,
            defaultedStartDate: false,
            effectiveWindow: { startDate: '2026-07-06', endDate: '2026-08-03', days: 29, endReason: 'today_incomplete' },
            comparisonWindow: { startDate: '2026-06-07', endDate: '2026-07-05', days: 29 },
            trendReason: null,
          },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })

  render(<Analytics />)

  expect(await screen.findByText('+0.0%')).toBeInTheDocument()
  expect(screen.getByText('6 Jul – 3 Aug vs 7 Jun – 5 Jul · today left out')).toBeInTheDocument()
})

it('shows no trend, and says why, when the server cannot compare honestly', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/analytics/revenue')) {
      return Promise.resolve({
        data: {
          data: [{ date: '2026-08-03', revenue: 5000, transactions: 10 }],
          summary: { totalRevenue: 50000, avgDailyRevenue: 5000, bestDay: null, worstDay: null, trend: null },
          meta: { trendReason: 'insufficient_history', effectiveWindow: null, comparisonWindow: null },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })

  render(<Analytics />)

  expect(await screen.findByText(/not enough history before this range/i)).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
  expect(screen.queryByText('+0.0%')).not.toBeInTheDocument()
})

it('states the window the server queried, in cafe-local days, on whichever tab is open', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/analytics/revenue')) {
      return Promise.resolve({
        data: {
          data: [],
          summary: { totalRevenue: 0, avgDailyRevenue: 0, bestDay: null, worstDay: null, trend: null },
          meta: { effectiveStartDay: '2026-07-06', effectiveEndDay: '2026-08-04', effectiveDays: 30, trendReason: 'no_data_in_window' },
        },
      })
    }
    if (url.includes('/analytics/items')) {
      return Promise.resolve({
        data: {
          items: [],
          meta: { effectiveStartDay: '2026-07-29', effectiveEndDay: '2026-08-04', effectiveDays: 7, risingItems: [], decliningItems: [] },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })

  render(<Analytics />)
  expect(await screen.findByText('Showing 6 Jul – 4 Aug · 30 days')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Revenue' }))
  await userEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
  expect(screen.getByText('Showing 6 Jul – 4 Aug · 30 days')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('tab', { name: 'Items' }))
  expect(await screen.findByText('Showing 29 Jul – 4 Aug · 7 days')).toBeInTheDocument()
})

it('keeps a legacy server trend when window metadata is absent', async () => {
  mockGet.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/analytics/revenue') ? {
    data: [],
    summary: { totalRevenue: 0, avgDailyRevenue: 0, bestDay: null, worstDay: null, trend: 5.2 },
  } : {} }))
  render(<Analytics />)
  expect(await screen.findByText('+5.2%')).toBeInTheDocument()
  expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument()
  expect(screen.queryByText(/ vs /)).not.toBeInTheDocument()
})

it('keeps the refund explanation visible when a range has refunds and no sales', async () => {
  mockGet.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/analytics/customers') ? {
    insights: {
      transactions: 0, avgTransactionValue: 0, avgItemsPerTransaction: 0, cashVsCardRatio: null,
      tippingRate: 0, avgTip: 0, refunds: { count: 1, value: 50 },
    },
  } : {} }))
  render(<Analytics />)
  await userEvent.click(screen.getByRole('tab', { name: 'Customers' }))
  expect(await screen.findByText(/1 refund .*not counted as a sale/)).toBeInTheDocument()
  expect(screen.queryByText('No customer data for this period')).not.toBeInTheDocument()
  expect(screen.getByText('No sales in this range, so there is nothing to split')).toBeInTheDocument()
  expect(screen.getAllByText('—')).toHaveLength(4)
  expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
})

it('keeps a persistent status container and clears a stale window when the next tab has no metadata', async () => {
  mockGet.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/analytics/revenue') ? {
    data: [], summary: { totalRevenue: 0, avgDailyRevenue: 0, bestDay: null, worstDay: null, trend: null },
    meta: { effectiveStartDay: '2026-07-06', effectiveEndDay: '2026-08-04', effectiveDays: 30 },
  } : { items: [] } }))
  render(<Analytics />)
  const status = screen.getByRole('status')
  expect(await screen.findByText('Showing 6 Jul – 4 Aug · 30 days')).toBeInTheDocument()
  expect(screen.getByLabelText('Trend unavailable')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Items' }))
  await screen.findAllByText('No item data available')
  expect(screen.getByRole('status')).toBe(status)
  expect(status).toBeEmptyDOMElement()
})

it('clears the previous window when a new range fetch fails', async () => {
  let calls = 0
  mockGet.mockImplementation((url: string) => {
    if (!url.includes('/analytics/revenue')) return Promise.resolve({ data: {} })
    calls += 1
    if (calls > 1) return Promise.reject(new Error('offline'))
    return Promise.resolve({ data: {
      data: [], summary: { totalRevenue: 0, avgDailyRevenue: 0, bestDay: null, worstDay: null, trend: null },
      meta: { effectiveStartDay: '2026-07-06', effectiveEndDay: '2026-08-04', effectiveDays: 30 },
    } })
  })
  render(<Analytics />)
  await screen.findByText('Showing 6 Jul – 4 Aug · 30 days')
  await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }))
  await screen.findByText('Failed to load revenue data')
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

it('splits payments into card, cash and other, and says what was left out', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/analytics/customers')) {
      return Promise.resolve({
        data: {
          insights: {
            transactions: 8,
            avgTransactionValue: 62.5,
            avgItemsPerTransaction: 1.4,
            cashVsCardRatio: { cash: 28.6, card: 42.9, other: 28.6 },
            paymentMethodCoverage: { known: 7, unknown: 1 },
            refunds: { count: 1, value: 50 },
            tippingRate: 25,
            avgTip: 15,
          },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })

  render(<Analytics />)
  await userEvent.click(screen.getByRole('tab', { name: /customers/i }))

  expect(await screen.findByText('Other: 28.6%')).toBeInTheDocument()
  expect(screen.getByText('Card: 42.9%')).toBeInTheDocument()
  expect(screen.getByText('Cash: 28.6%')).toBeInTheDocument()
  expect(screen.getByText(/1 sale has no payment method/i)).toBeInTheDocument()
  expect(screen.getByText(/1 refund \(R50,00\) not counted as a sale/i)).toBeInTheDocument()
})

it('says the daily average is per open day', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/analytics/revenue')) {
      return Promise.resolve({
        data: {
          data: [{ date: '2026-03-02', revenue: 160, transactions: 2 }],
          summary: {
            totalRevenue: 450,
            avgDailyRevenue: 64.29,
            openDays: 7,
            bestDay: { date: '2026-03-02', revenue: 160 },
            worstDay: { date: '2026-03-04', revenue: 0 },
            trend: null,
          },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })

  render(<Analytics />)

  expect(await screen.findByText('across 7 open days')).toBeInTheDocument()
})

  it('does not invent optional analytics facts for an older customer response', async () => {
    mockGet.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/analytics/customers') ? {
      insights: { avgTransactionValue: 50, avgItemsPerTransaction: 1, tippingRate: 0, avgTip: 0,
        cashVsCardRatio: { card: 75, cash: 25 } },
    } : {} }))
    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: 'Customers' }))
    expect(await screen.findByText('Card: 75.0%')).toBeInTheDocument()
    expect(screen.queryByText(/^Other:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/open days|refund/i)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /payment method split/i })).not.toHaveAccessibleName(/other/i)
  })

  it('lists new items as new and shows the movers the server ranked', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/items')) {
        return Promise.resolve({
          data: {
            items: [
              { name: 'Latte', totalQty: 92, totalRevenue: 2760, avgPerDay: 6.6, trend: 30, isNew: false },
              { name: 'Iced Matcha', totalQty: 20, totalRevenue: 900, avgPerDay: 1.4, trend: null, isNew: true },
            ],
            meta: {
              risingItems: [{ name: 'Oat Latte', trend: 45 }],
              decliningItems: [],
              newItems: [{ name: 'Iced Matcha', currentQty: 20 }],
              moverFloor: { minAvgPerDay: 2, windowDays: 7, minQty: 14, eligibleCount: 2, busiestQty: 52 },
            },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /items/i }))

    // Oat Latte is not among the top items by revenue; the old client filter dropped it.
    expect(await screen.findByText('Oat Latte')).toBeInTheDocument()
    expect(screen.getByText('+45.0%')).toBeInTheDocument()
    expect(screen.getByText('New this period')).toBeInTheDocument()
    expect(screen.getByText('20 sold · new')).toBeInTheDocument()
    expect(screen.queryByText('+100.0%')).not.toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('New')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Avg per open day' })).toBeInTheDocument()
  })

  it('dims hours the cafe is closed and says so', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/analytics/heatmap')) {
        return Promise.resolve({
          data: {
            success: true,
            heatmap: [
              { dayOfWeek: 1, hour: 8, revenue: 100, transactions: 3, isOpen: true },
              { dayOfWeek: 0, hour: 8, revenue: 0, transactions: 0, isOpen: false },
              { dayOfWeek: 0, hour: 10, revenue: 40, transactions: 1, isOpen: false },
            ],
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Analytics />)
    await userEvent.click(screen.getByRole('tab', { name: /heatmap/i }))

    const closed = await screen.findByRole('button', { name: /sunday 08:00, closed/i })
    expect(closed).toHaveAttribute('title', 'Sun 08:00 - Closed')
    expect(closed).toHaveAttribute('data-closed', 'true')
    expect(screen.getByRole('button', { name: /sunday 10:00, closed/i })).toHaveAttribute('title', 'Sun 10:00 - Closed - R40 avg')
    const open = screen.getByRole('button', { name: /monday 08:00/i })
    expect(open).not.toHaveAttribute('data-closed')
    expect(open.getAttribute('aria-label')).not.toMatch(/closed/i)
  })

})
