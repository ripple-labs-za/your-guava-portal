import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ModifierBreakdown } from './ModifierBreakdown'
import type { Forecast } from '@/types'

const factor = (key: string, label: string, reason = '', active = false, adjustmentPct = 0) => ({
  key, label, active, adjustmentPct, multiplier: 1 + adjustmentPct / 100, effect: active ? `+${adjustmentPct}%` : 'no effect', reason,
})

const renderBreakdown = (forecast: Parameters<typeof ModifierBreakdown>[0]['forecast']) =>
  render(<MemoryRouter><ModifierBreakdown forecast={forecast} /></MemoryRouter>)

describe('ModifierBreakdown', () => {
  // F-1: a factor that could not be evaluated is never one that "had no effect today".
  it('names a factor whose provider is not connected instead of calling it evaluated', () => {
    renderBreakdown({
      factors: [
        factor('weather', 'Weather', 'Weather service is not configured'),
        factor('loadShedding', 'Load shedding', 'Not connected: the load-shedding provider is not set up'),
        factor('holiday', 'Holiday'),
      ],
    } as Forecast)

    expect(screen.getByText('Not connected: Weather service is not configured. Left out of this forecast.')).toBeInTheDocument()
    expect(screen.getByText('Not connected: the load-shedding provider is not set up. Left out of this forecast.')).toBeInTheDocument()
    expect(screen.getByText(/Holiday was evaluated and had no effect today/)).toBeInTheDocument()
    expect(screen.queryByText(/Weather.*evaluated and had no effect/)).not.toBeInTheDocument()
  })

  it('never counts a weather plan refusal or an empty provider answer as evaluated', () => {
    renderBreakdown({
      factors: [
        factor('weather', 'Weather', 'Weather not available on the weather plan'),
        factor('loadShedding', 'Load shedding', 'Load-shedding data unavailable'),
      ],
    } as Forecast)
    expect(screen.getByText('Not available: Weather not available on the weather plan. Left out of this forecast.')).toBeInTheDocument()
    expect(screen.getByText('Not available: Load-shedding data unavailable. Left out of this forecast.')).toBeInTheDocument()
    expect(screen.queryByText(/evaluated and had no effect/)).not.toBeInTheDocument()
  })

  it('offers the location fix when weather needs the cafe location, and says when weather is not published yet', () => {
    renderBreakdown({ factors: [factor('weather', 'Weather', 'Location needed')] } as Forecast)
    expect(screen.getByText('Location needed. Left out of this forecast.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set cafe location' })).toHaveAttribute('href', '/settings?section=general&edit=cafe')
  })

  it('shows the combined factor limit when stacked factors were held on an item', () => {
    renderBreakdown({
      factors: [factor('payday', 'Payday', 'payday', true, 20), factor('holiday', 'Holiday', 'public holiday', true, 15)],
      items: [{
        itemName: 'Flat White', predictedQty: 32, baseQty: 20,
        factors: [{
          key: 'factorLimit', label: 'Combined factor limit', active: true, adjustmentPct: -17.7, multiplier: 0.823,
          effect: 'held at x1.6', reason: 'Combined factors x1.944 held at x1.6; factors are kept within x0.5 to x1.6',
        }],
      }],
    } as unknown as Forecast)
    expect(screen.getByText('Combined factor limit')).toBeInTheDocument()
    expect(screen.getByText(/Held on 1 item so stacked factors stay within x0.5 to x1.6 \(Flat White: Combined factors x1.944 held at x1.6\)/))
      .toBeInTheDocument()
  })
})
