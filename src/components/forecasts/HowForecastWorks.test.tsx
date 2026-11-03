import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HowForecastWorks } from './HowForecastWorks'

describe('HowForecastWorks', () => {
  it('opens on demand and states the engine as it is, without claiming AI', async () => {
    const { container } = render(<HowForecastWorks />)
    const summary = screen.getByText('How this forecast works')
    expect(container.querySelector('details')).not.toHaveAttribute('open')

    await userEvent.click(summary)

    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByText(/same weekday over the last 8 weeks/)).toBeVisible()
    expect(screen.getByText(/35%, 25% and 20%/)).toBeVisible()
    expect(screen.getByText(/held between 0\.5 and 1\.6 times/)).toBeVisible()
    expect(screen.getByText(/never changes a forecast by more than 15% either way\. This runs on\s+every plan/)).toBeVisible()
    expect(screen.getByText(/On Pro, corrections for each factor \(after 12 matched days\) and each item \(after 20\)/)).toBeVisible()
    expect(screen.getByText(/weather that actually happened is stored/)).toBeVisible()
    expect(screen.getByText('Not connected')).toBeVisible()
    expect(screen.getByText('Location needed')).toBeVisible()
    expect(container.textContent).not.toMatch(/\bAI\b|machine learning|artificial intelligence/i)
  })
})
