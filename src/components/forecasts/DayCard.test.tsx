import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { DayCard } from './DayCard'
import { mockForecast } from '@/test/mocks/api'
import type { Forecast } from '@/types'

const CONTRADICTED_REASON =
  'Cafe is closed in its trading hours, but 538 sales were recorded on this weekday in the last 8 weeks. Check the trading hours in Settings — this day is forecasting zero.'

describe('DayCard', () => {
  it('renders day revenue and calls onClick', () => {
    const handleClick = vi.fn()
    // Use a fixed future date so the label is a weekday name, not "Today"
    const forecast = { ...mockForecast, _id: 'f1', date: '2026-03-30', totalPredictedRevenue: 20100 }

    render(<DayCard forecast={forecast} weekAvg={20000} mode="plan" onClick={handleClick} />)

    // Revenue is displayed
    expect(screen.getByText((t) => t.includes('20') && t.includes('100'))).toBeInTheDocument()

    // Clicking the card fires the callback
    const card = screen.getByText((t) => t.includes('20') && t.includes('100')).closest('[class*="rounded"]')
    fireEvent.click(card!)
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it('shows weather chip', () => {
    render(
      <DayCard
        forecast={{ ...mockForecast, _id: 'f1', date: '2026-04-01' }}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )
    // Weather is always shown; mockForecast has temp 24, condition Sunny
    expect(screen.getByText(/24°C/)).toBeInTheDocument()
  })

  it('uses the explicit cafe-local dateKey instead of the UTC instant prefix', () => {
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-date-contract',
          date: '2026-03-29T22:00:00.000Z',
          dateKey: '2026-03-30',
        }}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.getByText(/30 Mar/i)).toBeInTheDocument()
    expect(screen.queryByText(/29 Mar/i)).not.toBeInTheDocument()
  })

  it('review mode shows actual qty and delta when actuals are present', () => {
    const forecastWithActuals = {
      ...mockForecast,
      _id: 'f-past',
      date: '2026-03-20',
      accuracy: 90,
      actualRevenue: 18000,
      actualTransactionCount: 12,
      actualsUpdatedAt: '2026-03-21T00:00:00.000Z',
      items: [
        { itemName: 'Flat White (Blend)', predictedQty: 30, actualQty: 24 },
        { itemName: 'Long White (Blend)', predictedQty: 31, actualQty: 36 },
        { itemName: 'Brownie', predictedQty: 3, actualQty: 3 },
      ],
    }

    render(
      <DayCard
        forecast={forecastWithActuals}
        weekAvg={20000}
        mode="review"
        onClick={() => {}}
      />
    )

    // Accuracy badge should appear
    expect(screen.getByText(/Accuracy: 90%/)).toBeInTheDocument()

    // Should show actual values
    expect(screen.getByText(/actual: 24/)).toBeInTheDocument()
    expect(screen.getByText(/actual: 36/)).toBeInTheDocument()

    // Should show predicted labels
    expect(screen.getAllByText(/pred: \d+/).length).toBeGreaterThan(0)

    // Should show a delta (negative for Flat White: 24 vs 30 → -20%)
    expect(screen.getByText(/-20%/)).toBeInTheDocument()
  })

  it('review mode does not treat default zero quantities as matched actuals', () => {
    const forecastWithoutActuals = {
      ...mockForecast,
      _id: 'f-no-actuals',
      date: '2026-03-20',
      items: [
        { itemName: 'Flat White (Blend)', predictedQty: 30, actualQty: 0 },
        { itemName: 'Long White (Blend)', predictedQty: 31, actualQty: 0 },
      ],
    }

    render(
      <DayCard
        forecast={forecastWithoutActuals}
        weekAvg={20000}
        mode="review"
        onClick={() => {}}
      />
    )

    expect(screen.getByText(/Awaiting sales data/i)).toBeInTheDocument()
    expect(screen.queryByText(/actual: 0/)).not.toBeInTheDocument()
  })

  it('renders a closed day as a valid planning state with its reason', () => {
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-closed',
          date: '2026-04-05',
          availability: {
            status: 'closed',
            reason: 'Scheduled weekly closure',
          },
          totalPredictedRevenue: 0,
          items: [],
        }}
        weekAvg={0}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('No trading forecast')).toBeInTheDocument()
    expect(screen.getByText('Scheduled weekly closure')).toBeInTheDocument()
    expect(screen.queryByText(/Awaiting sales data/i)).not.toBeInTheDocument()
  })

  it('plans on volume, not confidence: a busy line with little history stays in the plan', () => {
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-low-evidence',
          date: '2026-04-06',
          items: [
            { itemName: 'Flat White (Blend)', predictedQty: 20, baseQty: 20, confidence: 'low' },
            { itemName: 'Brownie', predictedQty: 1, baseQty: 1.2, confidence: 'low' },
          ],
        }}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.getByText('Flat White (Blend)')).toBeInTheDocument()
    expect(screen.queryByText('Brownie')).not.toBeInTheDocument()
  })

  it('explains a card whose every line sells under two a day instead of leaving a blank', () => {
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-all-occasional',
          date: '2026-04-07',
          items: [
            { itemName: 'Brownie', predictedQty: 1, baseQty: 1.2 },
            { itemName: 'Lemon Cake', predictedQty: 1, baseQty: 1.4 },
          ],
        }}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.getByText(/every line here sells under 2 a day/i)).toBeInTheDocument()
  })

  it('leaves the numbers an owner orders against in the accessibility tree', () => {
    // The card used to be the button. role="button" is Children Presentational,
    // so every figure inside it was stripped and a screen-reader user heard
    // only "Open forecast details for Tuesday, button".
    const handleClick = vi.fn()
    render(
      <DayCard
        forecast={{ ...mockForecast, _id: 'f-a11y', date: '2026-04-08', totalPredictedRevenue: 20100 }}
        weekAvg={20000}
        mode="plan"
        onClick={handleClick}
      />
    )

    const button = screen.getByRole('button', { name: /open forecast details/i })
    expect(button.tagName).toBe('BUTTON')
    // No ancestor claims the button role, so the card's content is readable.
    expect(document.querySelectorAll('[role="button"]')).toHaveLength(0)
    expect(screen.getByText('Flat White (Blend)')).toBeInTheDocument()

    fireEvent.click(button)
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it('offers the same keyboard route into a closed day', () => {
    const handleClick = vi.fn()
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-closed-a11y',
          date: '2026-04-09',
          availability: { status: 'closed', reason: 'Scheduled weekly closure' },
          items: [],
          totalPredictedRevenue: 0,
        }}
        weekAvg={0}
        mode="plan"
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /open forecast details/i }))
    expect(handleClick).toHaveBeenCalledOnce()
    expect(screen.getByText('Scheduled weekly closure')).toBeInTheDocument()
  })

  it('draws bars even when a non-occasional line is forecast to zero', () => {
    // A stage-6 day with rain can round a real seller to 0. Dividing by that
    // produced width: NaN%, which the browser drops, so every bar vanished.
    render(
      <DayCard
        forecast={{
          ...mockForecast,
          _id: 'f-zero-max',
          date: '2026-04-10',
          items: [
            { itemName: 'Flat White (Blend)', predictedQty: 0, baseQty: 30 },
            { itemName: 'Long White (Blend)', predictedQty: 0, baseQty: 28 },
          ],
        }}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    const bars = document.querySelectorAll('[style*="width"]')
    expect(bars.length).toBeGreaterThan(0)
    bars.forEach((bar) => {
      expect((bar as HTMLElement).style.width).not.toContain('NaN')
    })
  })
  // A weekday wrongly marked closed forecasts zero and scores 0% against real
  // sales. The engine flags it; nothing used to render the flag, so the
  // setting stayed wrong and the accuracy stayed low.
  const closedDay = (availability: Forecast['availability']) => ({
    ...mockForecast,
    _id: 'f-closed',
    date: '2026-03-29',
    items: [],
    totalPredictedRevenue: 0,
    availability,
  })

  it('warns when a closed day contradicts recorded sales, and links to trading hours', () => {
    render(
      <DayCard
        forecast={closedDay({
          status: 'closed',
          reason: CONTRADICTED_REASON,
          contradictsHistory: true,
        })}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/538 sales/)
    expect(screen.getByRole('link', { name: /open trading hours/i })).toHaveAttribute(
      'href',
      '/settings?section=general'
    )
  })

  it('leaves a genuine day off alone', () => {
    render(
      <DayCard
        forecast={closedDay({ status: 'closed', reason: 'Cafe is closed in its trading hours' })}
        weekAvg={20000}
        mode="plan"
        onClick={() => {}}
      />
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link', { name: /trading hours/i })).toBeNull()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('No trading forecast')).toBeInTheDocument()
  })

  it('opening trading hours does not also open the day drawer', () => {
    const handleClick = vi.fn()
    render(
      <DayCard
        forecast={closedDay({
          status: 'closed',
          reason: CONTRADICTED_REASON,
          contradictsHistory: true,
        })}
        weekAvg={20000}
        mode="plan"
        onClick={handleClick}
      />
    )

    fireEvent.click(screen.getByRole('link', { name: /open trading hours/i }))

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('names the unsaved-hours assumption on an inferred day card', () => {
    render(<DayCard forecast={{ ...mockForecast,
      availability: { status: 'ready', scheduleSource: 'inferred_from_sales' },
    }} weekAvg={20000} mode="plan" onClick={() => {}} />)
    expect(screen.getByText('Assumed open: hours not saved')).toBeInTheDocument()
  })

  it('does not call an explicitly saved day assumed open', () => {
    render(<DayCard forecast={{ ...mockForecast,
      availability: { status: 'ready', scheduleSource: 'saved' },
    }} weekAvg={20000} mode="plan" onClick={() => {}} />)
    expect(screen.queryByText('Assumed open: hours not saved')).not.toBeInTheDocument()
  })

  it.each(['plan', 'review'] as const)('shows the daytime high on the %s card', (mode) => {
    render(<DayCard forecast={{ ...mockForecast,
      signals: { ...mockForecast.signals, weather: { temp: 20, maxTemp: 29, condition: 'Sunny', humidity: 50 } },
    }} weekAvg={20000} mode={mode} onClick={() => {}} />)
    expect(screen.getByText(/High 29°C/)).toBeInTheDocument()
    expect(screen.queryByText(/20°C/)).not.toBeInTheDocument()
  })

})
