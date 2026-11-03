import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { CafeSetupPrompt } from './CafeSetupPrompt'

it('keeps the location and hours next steps until each is configured', () => {
  const view = render(<MemoryRouter><CafeSetupPrompt locationSet={false} hoursSet={false} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Set cafe location' })).toHaveAttribute('href', '/settings?section=general')
  expect(screen.getByRole('link', { name: 'Set trading hours' })).toHaveAttribute('href', '/settings?section=general')
  view.rerender(<MemoryRouter><CafeSetupPrompt locationSet={true} hoursSet={false} /></MemoryRouter>)
  expect(screen.queryByRole('link', { name: 'Set cafe location' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Set trading hours' })).toBeInTheDocument()
  view.rerender(<MemoryRouter><CafeSetupPrompt locationSet={true} hoursSet={true} /></MemoryRouter>)
  expect(screen.queryByRole('region', { name: 'Cafe setup' })).not.toBeInTheDocument()
})
