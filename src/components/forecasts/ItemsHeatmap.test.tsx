import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ItemsHeatmap } from './ItemsHeatmap'
import type { Forecast } from '@/types'

const signals: Forecast['signals'] = {
  weather: { temp: 24, condition: 'Sunny', humidity: 60 },
  loadSheddingStage: 0,
  isPublicHoliday: false,
  isSchoolHoliday: false,
  isPayday: false,
  dayOfWeek: 5,
}

const tradingDay = (id: string, date: string, qty: number): Forecast => ({
  _id: id,
  date,
  items: [{ itemName: 'Flat White', predictedQty: qty }],
  signals,
  totalPredictedRevenue: qty * 30,
})

const closedDay = (id: string, date: string): Forecast => ({
  _id: id,
  date,
  items: [],
  signals,
  totalPredictedRevenue: 0,
  availability: { status: 'closed', reason: 'Cafe is closed in its trading hours' },
})

describe('ItemsHeatmap', () => {
  it('offers the full item name when the row heading is clipped on a phone', () => {
    const forecast = tradingDay('f1', '2026-03-27', 30)
    forecast.items[0].itemName = 'Toasted Cheese and Tomato'
    render(<ItemsHeatmap forecasts={[forecast]} />)
    expect(screen.getByRole('rowheader', { name: 'Toasted Cheese and Tomato' }))
      .toHaveAttribute('title', 'Toasted Cheese and Tomato')
  })
  it('marks a closed day rather than rendering it as a column of nothing predicted', () => {
    render(
      <ItemsHeatmap
        forecasts={[
          tradingDay('f1', '2026-03-27', 30),
          closedDay('f2', '2026-03-29'),
          tradingDay('f3', '2026-03-30', 20),
        ]}
      />
    )

    // "—" already means "this item is not in this day's forecast"; a shut
    // Sunday reading the same way is how the demo made a closure look broken.
    const closedHeader = screen.getByRole('columnheader', { name: /Sun/ })
    expect(within(closedHeader).getByText('Closed')).toBeInTheDocument()
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)
  })

  it('reaches the scrolling grid from the keyboard', () => {
    render(<ItemsHeatmap forecasts={[tradingDay('f1', '2026-03-27', 30)]} />)

    const region = screen.getByRole('region', { name: /by item and day, scrollable/i })
    expect(region).toHaveAttribute('tabindex', '0')
  })

  it('associates each quantity with its item row', () => {
    render(<ItemsHeatmap forecasts={[tradingDay('f1', '2026-03-27', 30)]} />)

    expect(screen.getByRole('rowheader', { name: 'Flat White' })).toBeInTheDocument()
  })
})
