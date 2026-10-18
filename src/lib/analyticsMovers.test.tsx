import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MOVERS_CAPTION, moverThresholdNote, ItemTrend, closedCellLabels } from './analyticsMovers'

describe('weekly mover presentation', () => {
  it('states a weekly floor once and tolerates an older floor without busiestQty', () => {
    expect(moverThresholdNote({ minQty: 14, eligibleCount: 0 })).toContain('14+ in either of the last two weeks')
    expect(moverThresholdNote({ minQty: 14, eligibleCount: 0 })).not.toMatch(/undefined|a day/)
    expect(MOVERS_CAPTION).toContain('These lists rank only lines selling 14+')
    expect(MOVERS_CAPTION).toContain('Low-volume percentages may still appear in the table')
  })
  it.each([null, undefined])('renders an accessible dash for a missing trend %s', (trend) => {
    render(<ItemTrend trend={trend} isNew={false} />)
    expect(screen.getByText('No sales in the earlier week')).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })
  it('labels qualifying new lines with the exact week', () => {
    render(<ItemTrend trend={null} isNew />)
    expect(screen.getByText('New')).toHaveAttribute('title', 'New in the last 7 days')
  })
  it('states that closed-hour revenue was recorded while closed', () => {
    const label = closedCellLabels({ day: 0, hour: 8, revenue: 40, transactions: 1, closed: true })
    expect(label.title).toContain('Closed: outside your trading hours')
    expect(label.label).toContain('sales recorded while closed')
    expect(closedCellLabels({ day: 1, hour: 8, revenue: 0, transactions: 0, closed: false }).label).not.toContain('closed')
  })
})
