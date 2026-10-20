import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '@/contexts/AuthContext'
import Factors from './Factors'
import type { ForecastFactorSettings } from '@/types'
import type { ReactNode } from 'react'

vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

const mockGet = vi.fn()
const mockPut = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { baseURL: 'http://localhost:5000/api' },
  },
}))

const settings: ForecastFactorSettings = {
  history: { maxWeeks: 8, recentWeights: [0.35, 0.25, 0.2], twoWeekWeights: [0.6, 0.4] },
  weather: {
    enabled: true,
    hotTemp: 27,
    coldTemp: 18,
    hotColdDrinkPct: 30,
    hotCoffeePct: -10,
    coldCoffeePct: 15,
    coldColdDrinkPct: -20,
    rainPct: -10,
    minimumMultiplier: 0.1,
  },
  loadShedding: { enabled: true, stage1To2Pct: -8, stage3To4Pct: -22, stage5PlusPct: -40 },
  holiday: { enabled: true, publicPct: 15, schoolPct: 8, combinedPct: 20 },
  payday: { enabled: true, pct: 20 },
  events: { enabled: true, lowPct: 10, mediumPct: 20, highPct: 35 },
  stock: { safetyMarginPct: 10, maxBiasPct: 50 },
  learning: { enabled: true },
}

const entitlements = {
  plan: 'growth' as const,
  factors: [
    {
      key: 'weather',
      label: 'Weather',
      section: 'weather' as const,
      requiredPlan: 'starter' as const,
      summary: 'Temperature and rain adjust coffee and cold drink demand.',
      unlocked: true,
    },
    {
      key: 'holiday',
      label: 'Public & school holidays',
      section: 'holiday' as const,
      requiredPlan: 'starter' as const,
      summary: 'Calendar holidays adjust day-level demand.',
      unlocked: true,
    },
    {
      key: 'payday',
      label: 'Payday',
      section: 'payday' as const,
      requiredPlan: 'growth' as const,
      summary: 'Month-end payday windows lift demand.',
      unlocked: true,
    },
    {
      key: 'events',
      label: 'Local events',
      section: 'events' as const,
      requiredPlan: 'growth' as const,
      summary: 'Configured local events apply demand weights.',
      unlocked: true,
    },
    {
      key: 'loadShedding',
      label: 'Load shedding',
      section: 'loadShedding' as const,
      requiredPlan: 'growth' as const,
      summary: 'Power disruption stages reduce expected demand.',
      unlocked: true,
    },
    {
      key: 'stock',
      label: 'Stock buffer',
      section: 'stock' as const,
      requiredPlan: 'growth' as const,
      summary: 'Suggested stock includes a safety margin.',
      unlocked: true,
    },
    {
      key: 'history',
      label: 'History weights',
      section: 'history' as const,
      requiredPlan: 'pro' as const,
      summary: 'Tune how strongly recent trading weeks influence the forecast.',
      unlocked: false,
    },
    {
      key: 'learning',
      label: 'Learning correction',
      section: 'learning' as const,
      requiredPlan: 'pro' as const,
      summary: 'Past forecast errors correct future demand.',
      unlocked: false,
    },
  ],
  unlockedKeys: ['weather', 'holiday', 'payday', 'events', 'loadShedding', 'stock'],
  lockedKeys: ['history', 'learning'],
}

function renderWithAuth(ui: ReactNode, { role = 'owner' }: { role?: 'owner' | 'manager' } = {}) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: 'Test Owner',
    role,
    orgId: 'org123',
    cafeIds: ['cafe123'],
    activeCafeId: 'cafe123',
  }

  return render(
    <BrowserRouter>
      <AuthContext.Provider
        value={{
          user,
          isLoading: false,
          isOwner: role === 'owner',
          login: vi.fn(),
          logout: vi.fn(),
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

// Wording the engine emits for a day it has no matching history for.
const AWAITING_REASON = 'At least 3 observed matching trading days are required; 0 available'

const readyForecast = {
  _id: 'forecast1',
  date: '2026-06-06',
  totalPredictedRevenue: 12000,
  items: [],
  signals: {
    weather: { temp: 29, condition: 'Sunny', humidity: 55 },
    loadSheddingStage: 0,
    isPublicHoliday: false,
    isSchoolHoliday: false,
    isPayday: false,
    dayOfWeek: 6,
    events: [{ name: 'Saturday Market', impact: 'high' }],
  },
  factors: [
    { key: 'weather', label: 'Weather', active: true, effect: '+30%', adjustmentPct: 30 },
    { key: 'events', label: 'Events', active: true, effect: '+35%', adjustmentPct: 35 },
  ],
  calibration: {
    lookbackDays: 60,
    sampleSize: 7,
    overallMultiplier: 1.08,
    factorMultipliers: [
      { key: 'weather', label: 'Weather', multiplier: 0.96, sampleSize: 4, averageRatio: 0.96 },
    ],
    itemMultipliers: [
      { itemName: 'Flat White', multiplier: 1.12, sampleSize: 5, averageRatio: 1.12 },
    ],
    generatedAt: '2026-06-06T00:00:00.000Z',
  },
}

const awaitingForecast = (id: string, date: string) => ({
  _id: id,
  date,
  totalPredictedRevenue: 0,
  items: [],
  availability: { status: 'insufficient_data' as const, reason: AWAITING_REASON },
  trainingData: { transactionCount: 0, weeksWithSales: 0 },
  signals: {
    weather: { available: false, condition: '', unavailableReason: 'Cafe coordinates are not configured' },
    loadSheddingStage: 0,
    isPublicHoliday: false,
    isSchoolHoliday: false,
    isPayday: false,
    dayOfWeek: 1,
    events: [],
  },
  factors: [],
})

const closedForecast = (id: string, date: string) => ({
  ...awaitingForecast(id, date),
  availability: { status: 'closed' as const, reason: 'Cafe is closed in its trading hours' },
})

// The same closure, on a weekday the cafe demonstrably trades.
const CONTRADICTED_REASON =
  'Cafe is closed in its trading hours, but 538 sales were recorded on this weekday in the last 8 weeks. Check the trading hours in Settings — this day is forecasting zero.'
const contradictedForecast = (id: string, date: string) => ({
  ...closedForecast(id, date),
  availability: {
    status: 'closed' as const,
    reason: CONTRADICTED_REASON,
    contradictsHistory: true,
  },
})

// Set by a test before render to drive the /forecasts/week response.
let weekForecasts: unknown[] = []

describe('Factors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    weekForecasts = [readyForecast]
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { cafes: [] } })
      }
      if (url.includes('/forecasts/factors')) {
        return Promise.resolve({ data: { defaults: settings, settings, entitlements } })
      }
      if (url.includes('/events')) {
        if (url.includes('/events/effects')) {
          return Promise.resolve({
            data: {
              effects: [
                {
                  eventId: 'event1',
                  name: 'Saturday Market',
                  date: '2026-06-06',
                  impact: 'high',
                  expectedImpactPct: 35,
                  actualRevenue: 15000,
                  actualTransactions: 120,
                  baselineRevenue: 10000,
                  baselineTransactions: 90,
                  baselineDayCount: 6,
                  revenueImpactPct: 50,
                  transactionImpactPct: 33.3,
                  vsExpectedPct: 15,
                  confidence: 'medium',
                },
              ],
              summary: {
                eventsAnalyzed: 1,
                avgRevenueImpactPct: 50,
                aboveExpected: 1,
                belowExpected: 0,
                insufficientData: 0,
              },
            },
          })
        }
        return Promise.resolve({
          data: {
            // Deliberately still ahead of any plausible run date: "Next event"
            // is about what is coming, and a fixture that quietly ages into
            // the past would stop testing that.
            events: [
              { _id: 'event1', name: 'Saturday Market', date: '2099-06-06', impact: 'high', recurring: false },
            ],
          },
        })
      }
      if (url.includes('/forecasts/week')) {
        return Promise.resolve({ data: { forecasts: weekForecasts } })
      }
      return Promise.resolve({ data: {} })
    })
    mockPut.mockResolvedValue({ data: { settings, entitlements } })
  })

  it('does not present failed live-factor requests as verified empty data', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { cafes: [] } })
      if (url.includes('/forecasts/factors')) {
        return Promise.resolve({ data: { defaults: settings, settings, entitlements } })
      }
      if (url.includes('/events/effects')) return Promise.reject(new Error('effects unavailable'))
      if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
      if (url.includes('/forecasts/week')) return Promise.reject(new Error('forecasts unavailable'))
      return Promise.reject(new Error(`Unexpected URL: ${url}`))
    })

    renderWithAuth(<Factors />)

    expect(await screen.findByText(/empty values below do not mean/i)).toBeInTheDocument()
    expect(screen.getByText(/live forecast factors and historical event effects/i)).toBeInTheDocument()
  })

  // UAT-14-S22: with the API down the page read "Active this week 0 / Event days 0" and offered only Dismiss.
  it('shows no counts and offers Try again when the factors could not be loaded', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { cafes: [] } })
      return Promise.reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
    })

    renderWithAuth(<Factors />)

    expect(await screen.findByText('Forecast factors could not be loaded. The figures below are unavailable.')).toBeInTheDocument()
    const valueUnder = (label: string) => screen.getByText(label).nextElementSibling?.textContent
    expect(valueUnder('Active this week')).toBe('—')
    expect(valueUnder('Event days')).toBe('—')

    const factorCalls = () => mockGet.mock.calls.filter(([url]) => String(url).includes('/forecasts/factors')).length
    const before = factorCalls()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(factorCalls()).toBe(before + 1))
  })

  it('shows the live factor workspace', async () => {
    renderWithAuth(<Factors />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Factors')).toBeInTheDocument()
    })

    expect(screen.getByText('Saturday Market')).toBeInTheDocument()
    expect(screen.getAllByText('Weather').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Events').length).toBeGreaterThan(0)
    expect(screen.getByText('+50%')).toBeInTheDocument()
    expect(screen.getByText('Model Learning')).toBeInTheDocument()
    expect(screen.getByText('Pro plan required')).toBeInTheDocument()
    expect(screen.getByText('Flat White')).toBeInTheDocument()
  })

  // A brand-new cafe defaults to closed on Sunday, so its week is six
  // insufficient_data days plus one closed day. That used to render a grid of
  // zeros and a table of R0 rows, which reads as "your cafe will take nothing".
  it('explains that factors are waiting on trading history when no day has a forecast', async () => {
    weekForecasts = [
      closedForecast('c1', '2026-06-07'),
      ...Array.from({ length: 6 }, (_, index) => awaitingForecast(`a${index}`, `2026-06-0${index + 1}`)),
    ]

    renderWithAuth(<Factors />)

    expect(await screen.findByText(/waiting on trading history/i)).toBeInTheDocument()
    // The backend rule verbatim, so the copy cannot drift from it.
    expect(screen.getByText(new RegExp(AWAITING_REASON, 'i'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import sales data/i })).toHaveAttribute('href', '/data-health')

    // No zero-value stat grid and no R0 forecast rows.
    expect(screen.queryByText('Active this week')).not.toBeInTheDocument()
    expect(screen.queryByText('Avg event lift')).not.toBeInTheDocument()
    expect(screen.queryByText('R0')).not.toBeInTheDocument()

    // Plan entitlements stay visible: they are still true and still useful.
    expect(screen.getByText('6 factors unlocked')).toBeInTheDocument()
    expect(screen.getByText('Growth')).toBeInTheDocument()
    expect(screen.getByText('History weights: pro')).toBeInTheDocument()
  })

  it('marks pending days in the live factor table rather than showing them as R0', async () => {
    weekForecasts = [readyForecast, awaitingForecast('a1', '2026-06-08')]

    renderWithAuth(<Factors />)

    await waitFor(() => {
      expect(screen.getByText('Forecast Factors')).toBeInTheDocument()
    })

    // The ready day keeps its figure; the pending day is marked, not zeroed.
    expect(screen.getByText('R12 000')).toBeInTheDocument()
    expect(screen.getByText('Building history')).toBeInTheDocument()
    expect(screen.queryByText('R0')).not.toBeInTheDocument()

    // Counts are stated over the days that actually have a forecast.
    expect(screen.getByText('Active this week')).toBeInTheDocument()
    expect(screen.getByText(/1 of 2 days forecast/i)).toBeInTheDocument()
  })

  it('lets a manager read the rules but not change them', async () => {
    renderWithAuth(<Factors />, { role: 'manager' })

    await userEvent.click(await screen.findByText('Rules'))
    expect(screen.getByRole('button', { name: /save factors/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reset all rules to defaults/i })).toBeDisabled()
    expect(screen.getByText(/only the account owner can change forecast rules/i)).toBeInTheDocument()
    expect(mockPut).not.toHaveBeenCalled()
  })

  // FB-018 (UAT-05 review, S08 / F-9): Save was disabled for a manager but every rule field stayed
  // editable, so a manager could change values the server then refused with 403.
  it('does not let a manager edit rule fields the server will refuse to save', async () => {
    renderWithAuth(<Factors />, { role: 'manager' })

    await userEvent.click(await screen.findByText('Rules'))
    expect(screen.getByLabelText('Safety margin')).toBeDisabled()
    expect(screen.getByLabelText('Rain')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Weather enabled' })).toBeDisabled()
  })

  it('leaves the rule fields an owner may change editable', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    expect(screen.getByLabelText('Safety margin')).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Weather enabled' })).toBeEnabled()
  })

  // FB-013 (UAT-05-S07): the lock line printed the raw plan id ("Unlock on growth.")
  // where the lookback line on the same tab already said "Unlock on Pro".
  it('names the plan that unlocks a locked rule card the way the product names it', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    expect(screen.getByText(/^Unlock on Pro\. /)).toBeInTheDocument()
    expect(screen.queryByText(/Unlock on pro\./)).not.toBeInTheDocument()
    expect(screen.getAllByText('Pro', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.queryByText('pro', { exact: true })).not.toBeInTheDocument()
  })

  // FB-014 (UAT-05-S07, S08, S11): a locked card dimmed its whole content, so the
  // line explaining the lock fell to 3.12:1. Only the disabled controls dim.
  it('keeps the explanation of a locked field at full strength', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    const help = screen.getByText(/Unlock on Pro to change the\s+history lookback\./)
    expect(help.closest('[class*="opacity-"]')).toBeNull()
    const suffix = screen.getByText('wks')
    expect(suffix.closest('[class*="opacity-"]')).toBeNull()
    expect(screen.getByLabelText('History lookback')).toBeDisabled()
  })

  it('saves factor rules', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    await userEvent.click(screen.getByText('Save Factors'))

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/forecasts/factors', { settings })
    })
  })

  it('shows the server reason when a save is refused for the plan', async () => {
    // The API answers a plan-locked change with 402 PLAN_UPGRADE_REQUIRED and a
    // message naming the plan; a generic "Could not save" hides the one thing
    // the operator needs to know.
    mockPut.mockRejectedValueOnce({
      response: {
        status: 402,
        data: {
          success: false,
          code: 'PLAN_UPGRADE_REQUIRED',
          message: 'History weights settings are available on the Pro plan. Upgrade your plan to change them.',
        },
      },
    })
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    await userEvent.click(screen.getByText('Save Factors'))

    expect(await screen.findByText(/available on the Pro plan/)).toBeInTheDocument()
    expect(screen.queryByText('Could not save factors.')).not.toBeInTheDocument()
  })

  // Half the factor rules are negative by default (rain -10, hot-day coffee
  // -10, load shedding -8/-22/-40). An <input type="number"> reports "" for a
  // partially-typed "-", and Number("") is a finite 0, so committing on every
  // keystroke wrote 0 into settings and re-rendered the field as "0" — the
  // owner could not type a negative percentage at all, and a cleared field
  // silently shipped 0% to the forecast engine.
  it('does not commit a half-typed value over a negative factor percentage', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    const rain = screen.getByLabelText('Rain') as HTMLInputElement
    expect(rain.value).toBe('-10')

    // What the browser hands React the instant the operator types "-".
    fireEvent.change(rain, { target: { value: '' } })
    await userEvent.click(screen.getByText('Save Factors'))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    const saved = mockPut.mock.calls[0][1] as { settings: ForecastFactorSettings }
    expect(saved.settings.weather.rainPct).toBe(-10)
  })

  it('saves the negative percentage the operator actually typed', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    const rain = screen.getByLabelText('Rain') as HTMLInputElement

    fireEvent.change(rain, { target: { value: '' } })
    fireEvent.change(rain, { target: { value: '-15' } })
    expect(rain.value).toBe('-15')

    await userEvent.click(screen.getByText('Save Factors'))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    const saved = mockPut.mock.calls[0][1] as { settings: ForecastFactorSettings }
    expect(saved.settings.weather.rainPct).toBe(-15)
  })

  it('enforces the field min and max it advertises, on blur', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    const rain = screen.getByLabelText('Rain') as HTMLInputElement

    fireEvent.change(rain, { target: { value: '900' } })
    fireEvent.blur(rain)
    expect(rain.value).toBe('200')

    await userEvent.click(screen.getByText('Save Factors'))
    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    const saved = mockPut.mock.calls[0][1] as { settings: ForecastFactorSettings }
    expect(saved.settings.weather.rainPct).toBe(200)
  })

  it('announces save failures and keeps them on screen', async () => {
    mockPut.mockRejectedValueOnce({
      response: { status: 402, data: { message: 'Payday settings are available on the Growth plan.' } },
    })
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))
    await userEvent.click(screen.getByText('Save Factors'))

    // role=alert inside an always-mounted live region: the banner used to be a
    // plain div that appeared and vanished after four seconds, so the only
    // explanation for a refused change was never announced at all.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/available on the Growth plan/i)
    expect(screen.getByRole('button', { name: /dismiss message/i })).toBeInTheDocument()
  })

  it('offers a retry on the Rules tab instead of quietly showing the Events form', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/forecasts/factors')) return Promise.reject(new Error('factors unavailable'))
      if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: [] } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Rules'))

    expect(screen.getByText('Factor rules could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('Add Event')).not.toBeInTheDocument()
  })

  it('counts distinct factors, not factor-days, in the headline', async () => {
    // Weather and Events, each active on two days, is two active factors — not
    // four. The "Active factor mix" panel directly beneath already said two.
    weekForecasts = [readyForecast, { ...readyForecast, _id: 'forecast2', date: '2026-06-07' }]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Active this week')).toBeInTheDocument())
    const card = screen.getByText('Active this week').parentElement as HTMLElement
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).queryByText('4')).not.toBeInTheDocument()
  })

  it('does not offer an event that already happened as the next one', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/forecasts/factors')) {
        return Promise.resolve({ data: { defaults: settings, settings, entitlements } })
      }
      if (url.includes('/events/effects')) return Promise.resolve({ data: { effects: [], summary: null } })
      if (url.includes('/events')) {
        return Promise.resolve({
          data: {
            events: [
              { _id: 'past', name: 'Last Winter Market', date: '2020-06-06', impact: 'high', recurring: false },
            ],
          },
        })
      }
      if (url.includes('/forecasts/week')) return Promise.resolve({ data: { forecasts: weekForecasts } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Next event')).toBeInTheDocument())
    const card = screen.getByText('Next event').parentElement as HTMLElement
    expect(within(card).getByText('-')).toBeInTheDocument()
    expect(within(card).queryByText('Last Winter Market')).not.toBeInTheDocument()

    // It is still listed, marked for what it is.
    await userEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect(screen.getByText('Past')).toBeInTheDocument()
  })

  it('names the delete control on each event row', async () => {
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Events'))

    expect(
      screen.getByRole('button', { name: 'Remove event Saturday Market' })
    ).toBeInTheDocument()
  })

  // FB-021 (UAT-05 review, S11): the tabs followed none of the tabs keyboard pattern.
  it('moves between the Factor tabs with the arrow keys and keeps one tab in the Tab order', async () => {
    renderWithAuth(<Factors />)

    const live = await screen.findByRole('tab', { name: /live factors/i })
    const rules = screen.getByRole('tab', { name: 'Rules' })
    const events = screen.getByRole('tab', { name: 'Events' })
    expect(live).toHaveAttribute('tabindex', '0')
    expect(rules).toHaveAttribute('tabindex', '-1')

    live.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(rules).toHaveFocus()
    expect(rules).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{End}')
    expect(events).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(live).toHaveFocus() // wraps
    await userEvent.keyboard('{ArrowLeft}')
    expect(events).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(live).toHaveFocus()
    expect(live).toHaveAttribute('aria-selected', 'true')
  })

  // FB-019 (UAT-05 review, UX-5 / F-5): one click deleted the event, with no confirm and no undo.
  it('asks before removing an event, naming it, and does nothing until confirmed', async () => {
    mockDelete.mockResolvedValue({ data: { success: true } })
    renderWithAuth(<Factors />)

    await userEvent.click(await screen.findByText('Events'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove event Saturday Market' }))

    expect(mockDelete).not.toHaveBeenCalled()
    expect(screen.getByText(/Remove Saturday Market\?/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep Saturday Market' }))
    expect(mockDelete).not.toHaveBeenCalled()
    expect(screen.queryByText(/Remove Saturday Market\?/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove event Saturday Market' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm removing Saturday Market' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/events/event1'))
  })

  it('does not state a learning verdict when the forecast request failed', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/forecasts/factors')) {
        return Promise.resolve({ data: { defaults: settings, settings, entitlements } })
      }
      if (url.includes('/events/effects')) return Promise.resolve({ data: { effects: [], summary: null } })
      if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
      if (url.includes('/forecasts/week')) return Promise.reject(new Error('forecasts unavailable'))
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Factors />)

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Waiting for history')).not.toBeInTheDocument()
    expect(screen.queryByText(/at least 3 matched item outcomes/i)).not.toBeInTheDocument()
  })

  it('labels a forecast row with the cafe calendar day, not the stored instant', async () => {
    // 6 June in Johannesburg is stored at 2026-06-05T22:00Z; reading the raw
    // instant rendered "Fri, 5 Jun" for any browser at or west of UTC, so
    // Live Factors and Planning disagreed about the same forecast.
    weekForecasts = [{ ...readyForecast, date: '2026-06-05T22:00:00.000Z', dateKey: '2026-06-06' }]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Forecast Factors')).toBeInTheDocument())
    expect(screen.getByText(/6 Jun/)).toBeInTheDocument()
    expect(screen.queryByText(/5 Jun/)).not.toBeInTheDocument()
  })
  it('flags a per-day row whose closure the sales record contradicts', async () => {
    // Factors is the screen that explains why a number is what it is, so a day
    // forecasting R0 because of a setting nobody has checked belongs here too
    // - not only on the day card.
    weekForecasts = [readyForecast, contradictedForecast('c1', '2026-06-07')]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Forecast Factors')).toBeInTheDocument())

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/538 sales/)
    expect(within(alert).getByRole('link', { name: /open trading hours/i })).toHaveAttribute(
      'href',
      '/settings?section=general'
    )
  })

  it('leaves a genuine closure unflagged', async () => {
    weekForecasts = [readyForecast, closedForecast('c2', '2026-06-07')]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Forecast Factors')).toBeInTheDocument())

    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open trading hours/i })).toBeNull()
  })
  it('offers the coordinates fix once, not once per day', async () => {
    // The Signals column repeats "Cafe coordinates are not configured" on
    // every row, because coordinates are a cafe-level setting. Seven identical
    // links would be noise; the fact belongs per row, the action does not.
    const noCoords = {
      ...readyForecast.signals,
      weather: {
        available: false,
        condition: '',
        unavailableReason: 'Cafe coordinates are not configured',
      },
    }
    weekForecasts = [
      { ...readyForecast, signals: noCoords },
      { ...readyForecast, _id: 'forecast2', date: '2026-06-07', signals: noCoords },
    ]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Forecast Factors')).toBeInTheDocument())

    expect(screen.getAllByText('Cafe coordinates are not configured')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /set cafe location/i })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /set cafe location/i })).toHaveAttribute(
      'href',
      // Opens the editor, not the read-only summary: the fields this link
      // promises are behind the Edit button.
      '/settings?section=general&edit=cafe'
    )
  })

  it('says nothing about location when the weather signal is working', async () => {
    weekForecasts = [
      {
        ...readyForecast,
        signals: {
          ...readyForecast.signals,
          weather: { available: true, temp: 21, condition: 'Sunny' },
        },
      },
    ]

    renderWithAuth(<Factors />)

    await waitFor(() => expect(screen.getByText('Forecast Factors')).toBeInTheDocument())

    expect(screen.queryByRole('link', { name: /set cafe location/i })).toBeNull()
  })

  it('shows the daytime high in the Factors weather cell', async () => {
    weekForecasts = [{ ...readyForecast, signals: { ...readyForecast.signals,
      weather: { available: true, temp: 20, maxTemp: 29, condition: 'Sunny', humidity: 50 },
    } }]
    renderWithAuth(<Factors />)
    expect(await screen.findByText(/High 29°C/)).toBeInTheDocument()
  })

  it('keeps annual events upcoming and labels their next date without a Past badge', async () => {
    const defaultGet = mockGet.getMockImplementation()!
    mockGet.mockImplementation((url: string) => url === '/events' ? Promise.resolve({ data: { events: [
      { _id: 'annual', name: 'Annual fair', date: '2024-12-24', dateKey: '2024-12-24', nextDateKey: '2099-12-24', impact: 'high', recurring: true },
    ] } }) : defaultGet(url))
    renderWithAuth(<Factors />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }))
    expect(screen.getByText('Repeats yearly')).toBeInTheDocument()
    expect(screen.queryByText('Past')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove event Annual fair' })).toBeEnabled()
    const tile = screen.getByText('Next event').parentElement as HTMLElement
    expect(within(tile).getByText('Annual fair')).toBeInTheDocument()
    expect(screen.getAllByText(/24 Dec/).length).toBeGreaterThan(0)
  })

  it('distinguishes missing uploads from missing comparable days and counts only measured events', async () => {
    const defaultGet = mockGet.getMockImplementation()!
    mockGet.mockImplementation((url: string) => url === '/events/effects' ? Promise.resolve({ data: {
      effects: [0, 1].map((actualTransactions) => ({ eventId: String(actualTransactions), name: `Unscored ${actualTransactions}`,
        date: '2026-04-22', impact: 'high', expectedImpactPct: 35, actualRevenue: actualTransactions * 100,
        actualTransactions, baselineRevenue: 0, baselineTransactions: 0, baselineDayCount: 0,
        revenueImpactPct: null, transactionImpactPct: null, vsExpectedPct: null, confidence: 'none' })),
      summary: { eventsAnalyzed: 2, avgRevenueImpactPct: null, aboveExpected: 0, belowExpected: 0, insufficientData: 2 },
    } }) : defaultGet(url))
    renderWithAuth(<Factors />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }))
    expect(screen.getAllByText('No sales uploaded')).toHaveLength(1)
    expect(screen.getByText('No comparable days')).toBeInTheDocument()
    expect(screen.getByText('0 measured')).toBeInTheDocument()
  })

  it('sends an event that repeats every year as recurring', async () => {
    mockPost.mockResolvedValue({ data: { event: { _id: 'e2', name: 'Heritage market', date: '2099-09-24', impact: 'medium', recurring: true } } })
    renderWithAuth(<Factors />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }))

    await userEvent.type(screen.getByLabelText('Event name'), 'Heritage market')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2099-09-24' } })
    await userEvent.click(screen.getByRole('checkbox', { name: /repeats every year on this date/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Add Event' }))

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/events', expect.objectContaining({ name: 'Heritage market', recurring: true }))
    )
  })

  it('says an event uplift was not applied, instead of printing an expectation the forecast never had', async () => {
    const defaultGet = mockGet.getMockImplementation()!
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/events/effects')) {
        return Promise.resolve({
          data: {
            effects: [{
              eventId: 'event1', name: 'Saturday Market', date: '2026-06-06', dateKey: '2026-06-06', impact: 'high',
              expectedImpactPct: 0, expectedApplied: false, expectedNote: 'Local events are not applied to forecasts on the Starter plan.',
              actualRevenue: 15000, actualTransactions: 120, baselineRevenue: 10000, baselineTransactions: 90, baselineDayCount: 6,
              revenueImpactPct: 50, transactionImpactPct: 33.3, vsExpectedPct: 50, confidence: 'medium',
            }],
            summary: { eventsAnalyzed: 1, avgRevenueImpactPct: 50, aboveExpected: 1, belowExpected: 0, insufficientData: 0 },
          },
        })
      }
      return defaultGet(url)
    })
    renderWithAuth(<Factors />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }))

    expect(await screen.findByText('Local events are not applied to forecasts on the Starter plan.')).toBeInTheDocument()
  })

  it('reads an event’s calendar day from dateKey', async () => {
    const defaultGet = mockGet.getMockImplementation()!
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/events') && !url.includes('/events/effects')) {
        // An instant stored before dateKey existed would slice to the previous day; dateKey is the day the owner chose.
        return Promise.resolve({ data: { events: [
          { _id: 'e3', name: 'Night market', date: '2099-07-17T22:00:00.000Z', dateKey: '2099-07-18', impact: 'high', recurring: false },
        ] } })
      }
      return defaultGet(url)
    })
    renderWithAuth(<Factors />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Events' }))

    // The row (and the "Next event" tile) must show the 18th, never the 17th that slicing the instant would give.
    expect((await screen.findAllByText(/\b18 Jul/)).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/\b17 Jul/)).toHaveLength(0)
  })

})
