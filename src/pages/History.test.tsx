import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import History from './History'

const mockGet = vi.fn()

// Partial: History reads the named `isSessionRejection` export when a backfill
// fails, and a factory that omits it makes vitest throw at that moment.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    default: {
      get: (...args: unknown[]) => mockGet(...args),
    },
  }
})

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

const historyPayload = {
  success: true,
  history: [
    {
      forecastId: 'forecast-1',
      date: '2026-05-18T00:00:00.000Z',
      predictedRevenue: 1000,
      actualRevenue: 1200,
      variance: 200,
      variancePct: 20,
      revenueAccuracy: 83.3,
      itemAccuracy: 76,
      transactionCount: 42,
      weather: {
        temp: 16,
        condition: 'Patchy rain nearby',
        humidity: 82,
        isRain: true,
        precipMm: 3.5,
        chanceOfRain: 70,
      },
      signals: {
        isPublicHoliday: false,
        isSchoolHoliday: true,
        isPayday: false,
        loadSheddingStage: 0,
        events: [{ name: 'Local Market', impact: 'medium', impactPct: 22 }],
      },
      activeFactors: [
        { key: 'events', label: 'Events', active: true, effect: '+22%' },
        { key: 'learning', label: 'Learning correction', active: true, effect: '+8%', adjustmentPct: 8 },
      ],
      factorSummary: [
        { key: 'events', label: 'Events', effect: '+22%', adjustmentPct: 22 },
        { key: 'learning', label: 'Learning correction', effect: '+8%', adjustmentPct: 8 },
      ],
      calibration: {
        lookbackDays: 60,
        sampleSize: 8,
        overallMultiplier: 1.08,
        factorMultipliers: [
          { key: 'weather', label: 'Weather', multiplier: 0.96, sampleSize: 4, averageRatio: 0.96 },
        ],
        itemMultipliers: [
          { itemName: 'Flat White', multiplier: 1.12, sampleSize: 5, averageRatio: 1.12 },
        ],
        generatedAt: '2026-05-18T00:00:00.000Z',
      },
      trainingData: { transactionCount: 12, weeksWithSales: 4 },
    },
  ],
  meta: {
    days: 90,
    startDate: '2026-02-18',
    endDate: '2026-05-18',
    totalTradingDays: 1,
    totalRows: 1,
    generated: 1,
    pendingDays: 0,
    isPartial: false,
    backfill: {
      status: 'complete',
      pendingDays: 0,
      batchSize: 14,
    },
    overallRevenueAccuracy: 83.3,
    avgDailyRevenueAccuracy: 83.3,
    avgRevenueAccuracy: 83.3,
    liveAccuracy: {
      rowCount: 1,
      overallRevenueAccuracy: 83.3,
      avgDailyRevenueAccuracy: 83.3,
      totalPredictedRevenue: 1000,
      totalActualRevenue: 1200,
      variance: 200,
      variancePct: 20,
    },
    backtestAccuracy: {
      rowCount: 0,
      overallRevenueAccuracy: null,
      avgDailyRevenueAccuracy: null,
      totalPredictedRevenue: 0,
      totalActualRevenue: 0,
      variance: 0,
      variancePct: null,
    },
    combinedAccuracy: {
      rowCount: 1,
      overallRevenueAccuracy: 83.3,
      avgDailyRevenueAccuracy: 83.3,
      totalPredictedRevenue: 1000,
      totalActualRevenue: 1200,
      variance: 200,
      variancePct: 20,
    },
    totalPredictedRevenue: 1000,
    totalActualRevenue: 1200,
    variance: 200,
    variancePct: 20,
  },
  pagination: {
    total: 1,
    page: 1,
    limit: 30,
    pages: 1,
  },
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <History />
    </MemoryRouter>
  )
}

describe('History page', () => {
  it('shows item accuracy beside the daily and period figures', async () => {
    mockGet.mockResolvedValue({ data: {
      ...historyPayload,
      meta: { ...historyPayload.meta,
        liveAccuracy: { ...historyPayload.meta.liveAccuracy, avgItemAccuracy: 61.6 },
      },
    } })
    renderHistory()
    expect(await screen.findByText(/Per item: 61.6%/)).toBeVisible()
    expect(screen.getByText('Per item: 76.0%')).toBeVisible()
  })

  it('explains excluded rows visibly and distinguishes all-excluded backtests from no backtests', async () => {
    mockGet.mockResolvedValue({ data: {
      ...historyPayload,
      history: [{ ...historyPayload.history[0], origin: 'backfill', countsTowardAccuracy: false }],
      meta: { ...historyPayload.meta,
        backtestAccuracy: { ...historyPayload.meta.backtestAccuracy, rowCount: 0, excludedRowCount: 1 },
      },
    } })
    renderHistory()
    expect(await screen.findByText('Not counted')).toBeVisible()
    expect(screen.getByText('This day was still building history, so it is not in the accuracy figures.')).toBeVisible()
    expect(screen.getByText(/No counted retrospective backtests in this period/)).toBeVisible()
    expect(screen.queryByText(/^No retrospective backtests in this period/)).not.toBeInTheDocument()
  })

  it('lets keyboard users focus the horizontally scrolling daily history', async () => {
    renderHistory()
    const region = await screen.findByRole('region', { name: 'Daily prediction history' })
    expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    expect(region).toHaveFocus()
  })

  it('marks a building-history day as not counted and says how many were left out', async () => {
    mockGet.mockResolvedValue({
      data: {
        ...historyPayload,
        history: [{ ...historyPayload.history[0], countsTowardAccuracy: false, availabilityStatus: 'insufficient_data' }],
        meta: {
          ...historyPayload.meta,
          liveAccuracy: { ...historyPayload.meta.liveAccuracy, rowCount: 0, excludedRowCount: 1 },
          backtestAccuracy: { ...historyPayload.meta.backtestAccuracy, rowCount: 2, note: 'Backtests are scored with observed weather.' },
        },
      },
    })
    renderHistory()
    expect(await screen.findByText('Not counted')).toBeInTheDocument()
    expect(screen.getByText(/1 building-history day not counted/)).toBeInTheDocument()
    expect(screen.getByText('Backtests are scored with observed weather.')).toBeInTheDocument()
  })

  beforeEach(() => {
    mockGet.mockReset()
    mockGet.mockResolvedValue({ data: historyPayload })
  })

  it('loads historical prediction rows with weather and factors', async () => {
    renderHistory()

    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument()
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/forecasts/history', {
        params: { days: 90, page: 1, limit: 30 },
      })
    )

    expect(screen.getByText(/Patchy rain nearby/)).toBeInTheDocument()
    expect(screen.getByText(/Local Market/)).toBeInTheDocument()
    expect(screen.getByText('Live forecast accuracy')).toBeInTheDocument()
    expect(screen.getByText('Backtest accuracy')).toBeInTheDocument()
    // The headline is the typical day, with the flattering period-total figure
    // demoted to the detail line.
    expect(screen.getByText(/Typical day across 1 live day/)).toBeInTheDocument()
    expect(screen.getByText(/on period totals/)).toBeInTheDocument()
    expect(screen.getByText(/No retrospective backtests/i)).toBeInTheDocument()
    expect(screen.queryByText('Overall accuracy')).not.toBeInTheDocument()
    expect(screen.getByText('Model Learning')).toBeInTheDocument()
    expect(screen.getByText('Flat White')).toBeInTheDocument()
    expect(screen.getAllByText('83.3%').length).toBeGreaterThan(0)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('reloads when the user selects a different period', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByText(/Patchy rain nearby/)
    await user.click(screen.getByRole('button', { name: '365d' }))

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/forecasts/history', {
        params: { days: 365, page: 1, limit: 30 },
      })
    )
  })

  it('pages through historical rows', async () => {
    const user = userEvent.setup()
    mockGet.mockImplementation((_url: string, config?: { params?: { page?: number } }) => {
      const page = config?.params?.page || 1
      return Promise.resolve({
        data: {
          ...historyPayload,
          history: [
            {
              ...historyPayload.history[0],
              forecastId: page === 1 ? 'forecast-1' : 'forecast-2',
              date: page === 1 ? '2026-05-18T00:00:00.000Z' : '2026-05-17T00:00:00.000Z',
              transactionCount: page === 1 ? 42 : 31,
            },
          ],
          pagination: { total: 61, page, limit: 30, pages: 3 },
          meta: { ...historyPayload.meta, totalRows: 61, totalTradingDays: 61 },
        },
      })
    })

    renderHistory()

    expect(await screen.findByText(/Showing 1-30 of 61 completed trading days/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /next history page/i })[0])

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/forecasts/history', {
        params: { days: 90, page: 2, limit: 30 },
      })
    )
    expect(await screen.findByText(/Showing 31-60 of 61 completed trading days/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no completed trading days', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        history: [],
        meta: {
          ...historyPayload.meta,
          totalTradingDays: 0,
          totalRows: 0,
          pendingDays: 0,
          isPartial: false,
          overallRevenueAccuracy: null,
          avgDailyRevenueAccuracy: null,
          avgRevenueAccuracy: null,
          totalPredictedRevenue: 0,
          totalActualRevenue: 0,
          variance: 0,
          variancePct: null,
        },
        pagination: { total: 0, page: 1, limit: 30, pages: 1 },
      },
    })

    renderHistory()

    expect(await screen.findByText('No completed trading days found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Data Health' })).toHaveAttribute('href', '/data-health')
  })

  it('shows a preparing state instead of blocking when backfill is pending', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce({
      data: {
        success: true,
        history: [],
        meta: {
          ...historyPayload.meta,
          totalTradingDays: 12,
          totalRows: 0,
          pendingDays: 12,
          isPartial: true,
          backfill: { status: 'started', pendingDays: 12, batchSize: 14 },
          overallRevenueAccuracy: null,
          avgDailyRevenueAccuracy: null,
          avgRevenueAccuracy: null,
          totalPredictedRevenue: 0,
          totalActualRevenue: 0,
          variance: 0,
          variancePct: null,
        },
        pagination: { total: 0, page: 1, limit: 30, pages: 1 },
      },
    })

    renderHistory()

    expect(await screen.findByText(/Check the model against your last 12 trading days/i)).toBeInTheDocument()
    expect(screen.getByText(/Showing 0 of 12 completed trading days/)).toBeInTheDocument()
    // The cost and the wait are stated before the click, like every other
    // compute action in the portal.
    expect(screen.getByText(/Free — building history uses no Guava Credits/i)).toBeInTheDocument()
    expect(screen.getByText(/up to a minute/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /build next 14/i }))
    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/forecasts/history', {
        params: {
          days: 90,
          page: 1,
          limit: 30,
          backfill: 'sync',
          backfillLimit: 14,
        },
        // A sequential run of 14 forecast generations cannot finish inside the
        // shared client's 20s default.
        timeout: 180_000,
      })
    )
  })

  it('reports how many retrospective days were actually built', async () => {
    const user = userEvent.setup()
    const pending = {
      ...historyPayload,
      history: [],
      meta: { ...historyPayload.meta, totalRows: 0, totalTradingDays: 12, pendingDays: 12, generated: 0 },
      pagination: { total: 0, page: 1, limit: 30, pages: 1 },
    }
    mockGet.mockResolvedValueOnce({ data: pending })
    mockGet.mockResolvedValueOnce({
      data: { ...pending, meta: { ...pending.meta, totalRows: 12, pendingDays: 0, generated: 12 } },
    })

    renderHistory()

    await screen.findByRole('button', { name: /build next 14/i })
    await user.click(screen.getByRole('button', { name: /build next 14/i }))

    expect(await screen.findByText(/Built 12 retrospective days/i)).toBeInTheDocument()
  })

  it('keeps the history on screen when a backfill batch fails', async () => {
    const user = userEvent.setup()
    const withPending = {
      ...historyPayload,
      meta: { ...historyPayload.meta, totalTradingDays: 30, pendingDays: 16 },
    }
    mockGet.mockResolvedValueOnce({ data: withPending })
    mockGet.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
    mockGet.mockResolvedValue({ data: withPending })

    renderHistory()

    await screen.findByText(/Patchy rain nearby/)
    await user.click(screen.getByRole('button', { name: /build next 14/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Days built before that point were kept/i)
    // The table, the accuracy panels and the learning panel all survive.
    expect(screen.getByText(/Patchy rain nearby/)).toBeInTheDocument()
    expect(screen.getByText('Live forecast accuracy')).toBeInTheDocument()
    expect(screen.getByText('Model Learning')).toBeInTheDocument()
    expect(screen.queryByText(/Existing history is unchanged/i)).not.toBeInTheDocument()
  })

  it('re-reads history after a failed backfill so the page shows what landed', async () => {
    const user = userEvent.setup()
    const withPending = {
      ...historyPayload,
      meta: { ...historyPayload.meta, totalTradingDays: 30, pendingDays: 16 },
    }
    mockGet.mockResolvedValueOnce({ data: withPending })
    mockGet.mockRejectedValueOnce(new Error('network'))
    mockGet.mockResolvedValue({ data: withPending })

    renderHistory()

    await screen.findByText(/Patchy rain nearby/)
    await user.click(screen.getByRole('button', { name: /build next 14/i }))

    await waitFor(() =>
      expect(mockGet).toHaveBeenLastCalledWith('/forecasts/history', {
        params: { days: 90, page: 1, limit: 30 },
      })
    )
  })
  const pendingWithCost = {
    ...historyPayload,
    meta: {
      ...historyPayload.meta,
      totalTradingDays: 30,
      pendingDays: 16,
      backfill: { status: 'pending', pendingDays: 16, batchSize: 14, creditsPerDay: 1 },
    },
  }

  it('states the credit cost of a batch from the server', async () => {
    mockGet.mockResolvedValue({ data: pendingWithCost })
    renderHistory()
    expect(await screen.findByText(/uses up to 14 Guava Credits/i)).toBeInTheDocument()
    expect(screen.queryByText(/Free — building history/i)).not.toBeInTheDocument()
  })

  it('reloads days kept before a batch ran out of credits and explains the refusal', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce({ data: { ...pendingWithCost, history: [], meta: { ...pendingWithCost.meta, totalRows: 0 } } })
    mockGet.mockRejectedValueOnce({ response: { status: 402, data: { message: 'Guava credit limit reached for this billing period' } } })
    mockGet.mockResolvedValue({ data: { ...pendingWithCost, meta: { ...pendingWithCost.meta, pendingDays: 15 } } })
    renderHistory()

    await user.click(await screen.findByRole('button', { name: /build next 14/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Not enough Guava Credits/i)
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3))
    expect(mockGet).toHaveBeenLastCalledWith('/forecasts/history', {
      params: { days: 90, page: 1, limit: 30 },
    })
    expect(await screen.findByText(/Patchy rain nearby/)).toBeInTheDocument()
  })

  it('asks the owner to wait when batches come too fast', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce({ data: pendingWithCost })
    mockGet.mockRejectedValueOnce({ response: { status: 429, data: { code: 'FORECAST_RATE_LIMITED', message: 'Forecasts are being rebuilt too often.' } } })
    renderHistory()

    await user.click(await screen.findByRole('button', { name: /build next 14/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a few minutes/i)
  })

})
