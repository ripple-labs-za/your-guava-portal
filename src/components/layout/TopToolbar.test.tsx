import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import { TopToolbar } from './TopToolbar'
import { AuthContext } from '@/contexts/AuthContext'
import api from '@/lib/api'
import { GUAVA_CREDITS_UPDATED_EVENT } from '@/lib/creditEvents'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn() },
}))

const apiMock = api as unknown as { get: ReturnType<typeof vi.fn> }

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function renderToolbar({ available = 1234, logout = vi.fn().mockResolvedValue(undefined), organization = { plan: 'starter', billingStatus: 'trialing', billingCycle: 'monthly' } } = {}) {
  apiMock.get.mockResolvedValue({
    data: {
      credits: { included: 500, bonus: 1000, used: 266, available, resetAt: '2026-06-01T00:00:00.000Z' },
      organization,
      plan: { id: 'starter', name: 'Starter', includedGuavaCredits: 500 },
    },
  })

  render(
    <MemoryRouter initialEntries={['/today']}>
      <AuthContext.Provider
        value={{
          user: {
            id: 'u1',
            email: 'shaun@example.com',
            name: 'Shaun Schoeman',
            role: 'owner',
            orgId: 'org1',
            cafeIds: ['cafe1'],
            activeCafeId: 'cafe1',
          },
          isLoading: false,
          isOwner: true,
          login: vi.fn(),
          logout,
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        <TopToolbar />
        <LocationProbe />
      </AuthContext.Provider>
    </MemoryRouter>
  )

  return { logout }
}

describe('TopToolbar', () => {
  const GRACE = {
    plan: 'growth',
    billingStatus: 'past_due',
    billingCycle: 'monthly',
    billingAccess: {
      allowed: false,
      status: 'grace',
      readOnly: true,
      reason: 'billing_period_expired',
      periodEnd: '2026-10-01T12:00:00.000Z',
      graceEndsAt: '2026-10-04T12:00:00.000Z',
    },
  }

  it('shows the read-only grace state and links it to billing', async () => {
    renderToolbar({ available: 0, organization: GRACE })

    const control = await screen.findByRole('button', { name: /read-only until 0?4 Oct 2026/i })
    fireEvent.click(control)

    expect(screen.getByTestId('location')).toHaveTextContent('/settings?section=billing')
  })

  it('shows read-only mode as soon as a request is refused during grace', async () => {
    renderToolbar()
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/account/credits'))

    act(() => {
      window.dispatchEvent(new CustomEvent('guava:billing-read-only', {
        detail: { periodEnd: '2026-10-01T12:00:00.000Z', graceEndsAt: '2026-10-04T12:00:00.000Z' },
      }))
    })

    expect(await screen.findByRole('button', { name: /read-only until 0?4 Oct 2026/i })).toBeInTheDocument()
  })

  it('removes the grace control when a confirmed account response restores access', async () => {
    renderToolbar({ available: 0, organization: GRACE })
    await screen.findByRole('button', { name: /read-only until/i })
    act(() => window.dispatchEvent(new CustomEvent('guava:billing-read-only', {
      detail: { periodEnd: '2026-11-01T12:00:00.000Z', graceEndsAt: null },
    })))
    expect(screen.queryByRole('button', { name: /read-only until/i })).not.toBeInTheDocument()
  })

  beforeEach(() => {
    apiMock.get.mockReset()
  })

  it('shows the Guava Credits balance and links it to billing settings', async () => {
    renderToolbar()

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/account/credits'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /guava credits balance/i })).toHaveTextContent(/1\s?234/)
    })

    fireEvent.click(screen.getByRole('button', { name: /guava credits balance/i }))

    expect(screen.getByTestId('location')).toHaveTextContent('/settings?section=billing')
  })

  it('surfaces low-credit notifications', async () => {
    renderToolbar({ available: 42 })

    await screen.findByText('42')
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))

    expect(screen.getByText(/credits running low/i)).toBeInTheDocument()
    expect(screen.getByText(/42 Guava Credits available/i)).toBeInTheDocument()
  })

  it('keeps a post-spend credit event newer than an in-flight balance read', async () => {
    renderToolbar({ available: 1234 })

    act(() => {
      window.dispatchEvent(new CustomEvent(GUAVA_CREDITS_UPDATED_EVENT, {
        detail: { available: 1200, used: 300 },
      }))
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /guava credits balance/i }))
        .toHaveTextContent(/1\s?200/)
    })
  })

  it('opens the user menu and signs out', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    renderToolbar({ logout })

    expect(screen.queryByRole('button', { name: /open settings/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }))
    expect(screen.getByText('shaun@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Account')).not.toBeInTheDocument()
    expect(screen.queryByText('Billing and usage')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Guava Credits')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(logout).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'))
  })
})
