import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DayDetailDrawer } from './DayDetailDrawer'
import type { Forecast } from '@/types'

const baseSignals: Forecast['signals'] = {
  weather: { temp: 24, condition: 'Sunny', humidity: 60 },
  loadSheddingStage: 0,
  isPublicHoliday: false,
  isSchoolHoliday: false,
  isPayday: false,
  dayOfWeek: 4,
}

// Far enough ahead that the drawer is unambiguously in plan mode whenever the
// suite runs.
const FUTURE_DATE = '2099-06-04'
const PAST_DATE = '2020-06-04'

function makeForecast(overrides: Partial<Forecast> = {}): Forecast {
  return {
    _id: 'f1',
    date: FUTURE_DATE,
    items: [
      { itemName: 'Flat White', predictedQty: 22, baseQty: 21.7, suggestedStock: 25, confidence: 'high' },
      { itemName: 'Brownie', predictedQty: 1, baseQty: 1.2, suggestedStock: 2, confidence: 'low' },
    ],
    signals: baseSignals,
    totalPredictedRevenue: 6100,
    ...overrides,
  }
}

describe('DayDetailDrawer', () => {
  it('answers "why this prediction" with what the number is built from', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          trainingData: {
            transactionCount: 778,
            weeksWithSales: 8,
            lastTransactionDate: '2026-08-27',
          },
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('Built from')).toBeInTheDocument()
    expect(screen.getByText(/weighted average of your last 8 matching Thursdays/i)).toBeInTheDocument()
    expect(screen.getByText(/778 sales on record/i)).toBeInTheDocument()
    expect(screen.getByText(/27 Aug 2026/i)).toBeInTheDocument()
  })

  it('separates a plan-locked factor from one that simply had no effect', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          factors: [
            { key: 'weather', label: 'Weather', active: false, effect: 'no effect' },
            { key: 'payday', label: 'Payday', active: false, effect: 'no effect' },
            { key: 'events', label: 'Events', active: false, effect: 'no effect' },
          ],
          factorEntitlements: {
            plan: 'starter',
            factors: [
              { key: 'weather', label: 'Weather', section: 'weather', requiredPlan: 'starter', summary: '', unlocked: true },
              { key: 'payday', label: 'Payday', section: 'payday', requiredPlan: 'growth', summary: '', unlocked: false },
              { key: 'events', label: 'Events', section: 'events', requiredPlan: 'growth', summary: '', unlocked: false },
            ],
            unlockedKeys: ['weather'],
            lockedKeys: ['payday', 'events'],
          },
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    // The locked pair is named as locked, not reported as "no effect".
    expect(screen.getByText(/Payday and Events unlock on Growth/i)).toBeInTheDocument()
    expect(screen.getByText(/never evaluated for this day/i)).toBeInTheDocument()
    // Only the factor that actually ran is described as having had no effect.
    expect(screen.getByText(/Nothing else applied: Weather was evaluated/i)).toBeInTheDocument()
    // And the old wall of identical "no effect" rows is gone.
    expect(screen.queryAllByText('no effect')).toHaveLength(0)
  })

  it('names a factor the owner switched off rather than calling it inert', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          factors: [{ key: 'weather', label: 'Weather', active: false, effect: 'no effect' }],
          factorSettings: {
            history: { maxWeeks: 8, recentWeights: [], twoWeekWeights: [] },
            weather: {
              enabled: false, hotTemp: 27, coldTemp: 18, hotColdDrinkPct: 30, hotCoffeePct: -10,
              coldCoffeePct: 15, coldColdDrinkPct: -20, rainPct: -10, minimumMultiplier: 0.1,
            },
            loadShedding: { enabled: true, stage1To2Pct: -8, stage3To4Pct: -22, stage5PlusPct: -40 },
            holiday: { enabled: true, publicPct: 15, schoolPct: 8, combinedPct: 20 },
            payday: { enabled: true, pct: 20 },
            events: { enabled: true, lowPct: 10, mediumPct: 20, highPct: 35 },
            stock: { safetyMarginPct: 10, maxBiasPct: 50 },
            learning: { enabled: true },
          },
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    expect(screen.getByText(/Switched off in factor rules: Weather/i)).toBeInTheDocument()
  })

  it('keeps sub-2-a-day lines out of the stock table an owner orders from', () => {
    render(<DayDetailDrawer forecast={makeForecast()} weekAvg={6000} onClose={() => {}} />)

    const table = screen.getByRole('table', { name: /suggested stock/i })
    expect(within(table).getByRole('rowheader', { name: 'Flat White' })).toBeInTheDocument()
    expect(within(table).queryByRole('rowheader', { name: 'Brownie' })).not.toBeInTheDocument()

    // It is still listed, just without a stock instruction beside it.
    expect(screen.getByText('Occasional sellers')).toBeInTheDocument()
    expect(screen.getByText('Brownie')).toBeInTheDocument()
  })

  it('renders per-item confidence, which the API sends and the portal used to drop', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          items: [
            { itemName: 'Flat White', predictedQty: 22, baseQty: 21.7, suggestedStock: 25, confidence: 'high' },
            { itemName: 'Long White', predictedQty: 20, baseQty: 20, suggestedStock: 23, confidence: 'low' },
          ],
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    const table = screen.getByRole('table', { name: /suggested stock/i })
    expect(within(table).getByRole('columnheader', { name: 'Confidence' })).toBeInTheDocument()
    expect(within(table).getByText('High')).toBeInTheDocument()
    expect(within(table).getByText('Low')).toBeInTheDocument()
  })

  it('says when the item list is capped below the number of forecast lines', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          forecastCoverage: {
            itemCount: 41,
            storedItemCount: 25,
            totalPredictedQty: 310,
            includesAllRevenue: true,
          },
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    expect(screen.getByText(/Showing the 25 largest of 41 forecast lines/i)).toBeInTheDocument()
  })

  it('surfaces a line predicted at zero that actually sold, instead of scoring it a perfect day', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          date: PAST_DATE,
          accuracy: 70,
          actualRevenue: 7000,
          actualTransactionCount: 90,
          actualsUpdatedAt: '2020-06-05T00:00:00.000Z',
          items: [
            { itemName: 'Flat White', predictedQty: 22, actualQty: 23 },
            { itemName: 'Croissant', predictedQty: 0, actualQty: 40 },
          ],
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('What we missed')).toBeInTheDocument()
    expect(screen.getByText(/40 units the forecast did not see at all/i)).toBeInTheDocument()
    // The delta column states it in units rather than printing "---".
    expect(screen.getByText('+40 units')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to whatever opened it', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    opener.textContent = 'Open'
    document.body.appendChild(opener)
    opener.focus()

    const { unmount } = render(
      <DayDetailDrawer forecast={makeForecast()} weekAvg={6000} onClose={onClose} />
    )

    expect(document.activeElement).toBe(screen.getByRole('dialog'))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('survives a re-render of the page behind it without losing the focus anchor', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()

    // A fresh onClose closure on every parent render is exactly what Planning
    // used to pass; it must not tear the focus effect down and reset focus.
    const { rerender, unmount } = render(
      <DayDetailDrawer forecast={makeForecast()} weekAvg={6000} onClose={() => {}} />
    )

    const closeButton = screen.getByRole('button', { name: /close forecast details/i })
    closeButton.focus()
    rerender(<DayDetailDrawer forecast={makeForecast()} weekAvg={6001} onClose={() => {}} />)

    expect(document.activeElement).toBe(closeButton)

    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('still routes Escape through the latest onClose after a re-render', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <DayDetailDrawer forecast={makeForecast()} weekAvg={6000} onClose={first} />
    )

    rerender(<DayDetailDrawer forecast={makeForecast()} weekAvg={6000} onClose={second} />)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('gives the review breakdown real column headers', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          date: PAST_DATE,
          accuracy: 90,
          actualTransactionCount: 40,
          actualsUpdatedAt: '2020-06-05T00:00:00.000Z',
          items: [{ itemName: 'Flat White', predictedQty: 22, actualQty: 23 }],
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Predicted' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Actual' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Flat White' })).toBeInTheDocument()
  })

  it('keeps a closed day free of a prediction it never made', () => {
    render(
      <DayDetailDrawer
        forecast={makeForecast({
          availability: { status: 'closed', reason: 'Cafe is closed in its trading hours' },
          items: [],
          totalPredictedRevenue: 0,
        })}
        weekAvg={6000}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('No trading forecast')).toBeInTheDocument()
    expect(screen.queryByText('Predicted revenue')).not.toBeInTheDocument()
    expect(screen.queryByText('Why this prediction?')).not.toBeInTheDocument()
  })

  it('explains an active partial closure alongside neutral weather in the real drawer', () => {
    render(<DayDetailDrawer forecast={makeForecast({ factors: [
      { key: 'weather', label: 'Weather', active: false, effect: 'no effect' },
      { key: 'tradingHours', label: 'Trading hours', active: true, adjustmentPct: -50, multiplier: 0.5, effect: '-50%', reason: 'Reduced trading hours, weighted by your hourly sales' },
    ] })} weekAvg={6000} onClose={() => {}} />)
    expect(screen.getByText('Trading hours')).toBeInTheDocument()
    expect(screen.getByText(/weighted by your hourly sales/)).toBeInTheDocument()
    expect(screen.getByText(/-50%/)).toBeInTheDocument()
    expect(screen.queryByText(/No factor moved this number/)).not.toBeInTheDocument()
  })

  it('names the unsaved-hours assumption in the drawer', () => {
    render(<DayDetailDrawer forecast={makeForecast({
      availability: { status: 'ready', scheduleSource: 'inferred_from_sales' },
    })} weekAvg={6000} onClose={() => {}} />)
    expect(screen.getByText('Assumed open: hours not saved')).toBeInTheDocument()
  })

  it('does not describe saved hours as an assumption', () => {
    render(<DayDetailDrawer forecast={makeForecast({
      availability: { status: 'ready', scheduleSource: 'saved' },
    })} weekAvg={6000} onClose={() => {}} />)
    expect(screen.queryByText('Assumed open: hours not saved')).not.toBeInTheDocument()
  })

})
