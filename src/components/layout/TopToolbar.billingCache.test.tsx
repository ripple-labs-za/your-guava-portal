import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import api from '@/lib/api'

vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  user: { orgId: 'renewal-cache-org', name: 'Owner', email: 'owner@example.test' },
  isOwner: true, logout: vi.fn(),
}) }))

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it('does not restore cached grace on remount after billing access was renewed while unmounted', async () => {
  vi.stubEnv('MODE', 'development')
  const { TopToolbar } = await import('./TopToolbar')
  const { publishBillingAccess } = await import('@/lib/billingEvents')
  const access = { allowed: false, status: 'grace', readOnly: true, reason: 'billing_period_expired',
    periodEnd: '2026-10-01T12:00:00Z', graceEndsAt: '2026-10-04T12:00:00Z' }
  const data = { credits: { included: 500, bonus: 0, used: 0, available: 0, resetAt: null },
    organization: { plan: 'growth', billingAccess: access }, plan: { id: 'growth', name: 'Growth', includedGuavaCredits: 500 } }
  vi.mocked(api.get).mockResolvedValueOnce({ data })
  const first = render(<MemoryRouter><TopToolbar /></MemoryRouter>)
  await screen.findByRole('button', { name: /read-only until/i })
  first.unmount()
  publishBillingAccess({ allowed: true, status: 'active', reason: null, periodEnd: '2026-11-01T12:00:00Z' })
  vi.mocked(api.get).mockResolvedValueOnce({ data: { ...data, organization: { ...data.organization,
    billingAccess: { allowed: true, status: 'active', readOnly: false } } } })
  render(<MemoryRouter><TopToolbar /></MemoryRouter>)
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: /read-only until/i })).not.toBeInTheDocument()
})
