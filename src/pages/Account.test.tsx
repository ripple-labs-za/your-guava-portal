import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { AuthContext } from '@/contexts/AuthContext'
import userEvent from '@testing-library/user-event'
import Account from './Account'
import type { ReactNode } from 'react'
import type { User } from '@/types'

vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      patch: (...args: unknown[]) => mockPatch(...args),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

function accountPayload(role: 'owner' | 'manager' = 'owner') {
  return {
    user: {
      id: 'user123',
      email: 'test@yourguava.com',
      name: 'Test Owner',
      role,
      orgId: 'org123',
      cafeIds: ['cafe123'],
      activeCafeId: 'cafe123',
    },
    organization: {
      _id: 'org123',
      name: 'Test Org',
      ownerId: 'user123',
      plan: 'growth',
      billingStatus: 'active',
      billingCycle: 'monthly',
      billingEmail: 'billing@yourguava.com',
      paymentMethod: { brand: 'visa', last4: '4242', expiresAt: '12/30' },
    },
    usage: {
      seats: { used: 3, included: 6, remaining: 3 },
      locations: { used: 2, included: 3, remaining: 1 },
      aiCredits: { included: 600, bonus: 250, used: 100, available: 750, resetAt: null },
      guavaCredits: { included: 1800, bonus: 250, used: 100, available: 1950, resetAt: '2026-06-01T00:00:00.000Z' },
      creditLedger: {
        byFeature: [
          { featureKey: 'ask_guava_chat', label: 'Ask Guava answer', credits: 12, count: 4 },
        ],
        recent: [
          {
            id: 'usage1',
            featureKey: 'ask_guava_chat',
            label: 'Ask Guava answer',
            credits: 3,
            status: 'committed',
            provider: 'anthropic',
            createdAt: '2026-05-20T00:00:00.000Z',
          },
        ],
      },
    },
    plans: [
      {
        id: 'starter',
        name: 'Starter',
        priceMonthly: 399,
        priceAnnual: 3990,
        includedSeats: 2,
        includedAiCredits: 150,
        includedGuavaCredits: 400,
        includedLocations: 2,
        overagePerSeat: 120,
        aiCreditPackPrice: 99,
        features: ['CSV imports'],
      },
      {
        id: 'growth',
        name: 'Growth',
        priceMonthly: 899,
        priceAnnual: 8990,
        includedSeats: 6,
        includedAiCredits: 600,
        includedGuavaCredits: 1800,
        includedLocations: 3,
        overagePerSeat: 100,
        aiCreditPackPrice: 89,
        features: ['Multi-location forecasting'],
      },
    ],
  }
}

function renderWithAuth(
  ui: ReactNode,
  {
    logout = vi.fn().mockResolvedValue(undefined),
    role = 'owner',
    updateCurrentUser = vi.fn((_user: User) => undefined),
  }: {
    logout?: () => Promise<void>
    role?: 'owner' | 'manager'
    updateCurrentUser?: (user: User) => void
  } = {}
) {
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
          logout,
          register: vi.fn(),
          switchCafe: vi.fn(),
          updateCurrentUser,
        }}
      >
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

describe('Account', () => {
  function serveOrganization(organization: Record<string, unknown>) {
    const payload = accountPayload()
    mockGet.mockImplementation((url: string) =>
      url.includes('/account')
        ? Promise.resolve({ data: { success: true, account: { ...payload, organization: { ...payload.organization, ...organization } } } })
        : Promise.resolve({ data: {} }))
  }

  it('explains the read-only grace period and offers to renew the current plan', async () => {
    serveOrganization({
      billingStatus: 'past_due',
      currentPeriodEnd: '2026-10-01T12:00:00.000Z',
      billingAccess: {
        allowed: false, status: 'grace', readOnly: true, reason: 'billing_period_expired',
        periodEnd: '2026-10-01T12:00:00.000Z', graceEndsAt: '2026-10-04T12:00:00.000Z',
      },
    })
    renderWithAuth(<Account />)

    const banner = await screen.findByText(/your plan ended on 0?1 Oct 2026/i)
    expect(banner).toHaveTextContent(/read-only until 0?4 Oct 2026/i)
    expect(screen.getByRole('button', { name: /renew growth/i })).toBeEnabled()
  })

  it('lets a trialling owner choose the plan the trial runs on', async () => {
    serveOrganization({ plan: 'starter', billingStatus: 'trialing', trialEndsAt: '2026-10-05T12:00:00.000Z' })
    renderWithAuth(<Account />)

    expect(await screen.findByRole('button', { name: /choose starter/i })).toBeEnabled()
    expect(screen.getByText(/trial ends 0?5 Oct 2026/i)).toBeInTheDocument()
  })

  it('says until when the plan is paid', async () => {
    // Far enough ahead that the 7-day renew window never opens while this suite exists.
    serveOrganization({ billingStatus: 'active', currentPeriodEnd: '2030-11-01T12:00:00.000Z' })
    renderWithAuth(<Account />)

    expect(await screen.findByText(/paid until 0?1 Nov 2030/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /active plan/i })).toBeDisabled()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.pushState({}, '', '/account')
    mockPost.mockResolvedValue({ data: { success: true } })
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/account')) {
        return Promise.resolve({ data: { success: true, account: accountPayload() } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      return Promise.resolve({ data: {} })
    })
  })

  it('renders account details separately from billing and usage', async () => {
    renderWithAuth(<Account />)

    await waitFor(() => {
      expect(screen.getByText('Account Details')).toBeInTheDocument()
      expect(screen.getByText('Billing and Usage')).toBeInTheDocument()
    })

    expect(screen.getByText('growth plan')).toBeInTheDocument()
    expect(screen.getByText('1950')).toBeInTheDocument()
    expect(screen.getAllByText('Ask Guava answer').length).toBeGreaterThan(0)
    expect(screen.getByText('Plans and card checkout')).toBeInTheDocument()
  })

  it('defaults the account details section to view mode', async () => {
    renderWithAuth(<Account />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    })

    expect(screen.getByText('Test Org')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Test Owner')).not.toBeInTheDocument()
    expect(screen.queryByText('Save Account')).not.toBeInTheDocument()
  })

  it('enters edit mode and cancels back without saving', async () => {
    renderWithAuth(<Account />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    const nameInput = await screen.findByDisplayValue('Test Owner')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Discarded Name')

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Discarded Name')).not.toBeInTheDocument()
    })
    expect(mockPatch).not.toHaveBeenCalled()
    expect(screen.queryByText('Save Account')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  }, 10000)

  it('saves profile and organisation details', async () => {
    const updatedAccount = accountPayload()
    updatedAccount.user.name = 'Updated Owner'
    const updateCurrentUser = vi.fn((_user: User) => undefined)
    mockPatch.mockResolvedValueOnce({ data: { success: true, account: updatedAccount } })

    renderWithAuth(<Account />, { updateCurrentUser })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    const nameInput = await screen.findByDisplayValue('Test Owner')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Updated Owner')
    await userEvent.click(screen.getByText('Save Account'))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/account/profile', expect.objectContaining({
        name: 'Updated Owner',
      }))
      expect(updateCurrentUser).toHaveBeenCalledWith(updatedAccount.user)
    })
  })

  it('submits only the editable name field for managers', async () => {
    const managerAccount = accountPayload('manager')
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/account')) return Promise.resolve({ data: { success: true, account: managerAccount } })
      return Promise.resolve({ data: {} })
    })
    mockPatch.mockResolvedValueOnce({ data: { success: true, account: managerAccount } })

    renderWithAuth(<Account />, { role: 'manager' })
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }))

    expect(screen.queryByLabelText(/organisation name/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/billing email/i)).not.toBeInTheDocument()
    const nameInput = screen.getByLabelText(/full name/i)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Manager Name')
    await userEvent.click(screen.getByText('Save Account'))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/account/profile', { name: 'Manager Name' })
    })
  })

  it('verifies a payment reference before showing confirmation', async () => {
    window.history.pushState({}, '', '/account?payment=paid&reference=pay-123')
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/account/payments/pay-123')) {
        return Promise.resolve({ data: { success: true, payment: { reference: 'pay-123', status: 'paid' } } })
      }
      if (url.includes('/account')) {
        return Promise.resolve({ data: { success: true, account: accountPayload() } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Account />)

    expect(await screen.findByText(/card payment confirmed/i)).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/account/payments/pay-123')
  })

  // ── Checkout-return statuses ────────────────────────────────────────────────
  // PaymentSession.status is an enum of five values. Reporting anything other
  // than 'failed'/'cancelled' as a failure invites a second card charge.

  function mockPaymentStatus(status: string, reference = 'pay-1') {
    window.history.pushState({}, '', `/account?payment=${status}&reference=${reference}`)
    mockGet.mockImplementation((url: string) => {
      if (url.includes(`/account/payments/${reference}`)) {
        return Promise.resolve({ data: { success: true, payment: { reference, status } } })
      }
      if (url.includes('/account')) {
        return Promise.resolve({ data: { success: true, account: accountPayload() } })
      }
      return Promise.resolve({ data: {} })
    })
  }

  it('does not report a settling (processing) card payment as a failure', async () => {
    mockPaymentStatus('processing')

    renderWithAuth(<Account />)

    const notice = await screen.findByText(/finalising your billing/i)
    expect(notice).toBeInTheDocument()
    // Not an error, and never the "no billing changes were made" claim.
    expect(screen.queryByText(/was not completed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no billing changes were made/i)).not.toBeInTheDocument()
    expect(notice.closest('[role="alert"]')).toBeNull()
  })

  it('tells the owner a held payment needs a manual check, without inviting a second payment', async () => {
    mockPaymentStatus('needs_attention')
    renderWithAuth(<Account />)

    const notice = await screen.findByText(/needs a manual check/i)
    expect(notice).toHaveTextContent(/do not pay again/i)
    expect(notice).toHaveTextContent(/reference: pay-1/i)
    expect(window.location.search).toContain('reference=pay-1')
    expect(notice.closest('[role="alert"]')).toBeNull()
    expect(screen.queryByText(/no billing changes were made/i)).not.toBeInTheDocument()
  })

  it('reports a reversed payment as refunded or reversed', async () => {
    mockPaymentStatus('reversed')
    renderWithAuth(<Account />)

    expect(await screen.findByText(/refunded or reversed/i)).toBeInTheDocument()
  })

  it('keeps the reference in the URL while a payment is still settling', async () => {
    mockPaymentStatus('processing', 'pay-settling')

    renderWithAuth(<Account />)
    await screen.findByText(/finalising your billing/i)

    // Stripping the reference here leaves the owner with no way to re-check.
    expect(window.location.search).toContain('reference=pay-settling')
  })

  it('reports a pending payment as awaiting confirmation, not as a failure', async () => {
    mockPaymentStatus('pending')

    renderWithAuth(<Account />)

    expect(await screen.findByText(/has not been confirmed/i)).toBeInTheDocument()
    expect(screen.queryByText(/no billing changes were made/i)).not.toBeInTheDocument()
  })

  it('reports a failed payment as failed and clears the payment params', async () => {
    mockPaymentStatus('failed')

    renderWithAuth(<Account />)

    expect(await screen.findByText(/card payment failed/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.search).not.toContain('reference=')
    })
  })

  it('reports a cancelled payment as cancelled', async () => {
    mockPaymentStatus('cancelled')

    renderWithAuth(<Account />)

    expect(await screen.findByText(/card payment was cancelled/i)).toBeInTheDocument()
  })

  it('is honest about a status it does not recognise instead of claiming failure', async () => {
    mockPaymentStatus('some_future_status')

    renderWithAuth(<Account />)

    expect(await screen.findByText(/still confirming this payment/i)).toBeInTheDocument()
    expect(screen.queryByText(/no billing changes were made/i)).not.toBeInTheDocument()
  })

  it('clears the billing-required alert once a payment is confirmed', async () => {
    window.history.pushState({}, '', '/account?billing=required&payment=paid&reference=pay-9')
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/account/payments/pay-9')) {
        return Promise.resolve({ data: { success: true, payment: { reference: 'pay-9', status: 'paid' } } })
      }
      if (url.includes('/account')) {
        return Promise.resolve({ data: { success: true, account: accountPayload() } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Account />)

    await screen.findByText(/card payment confirmed/i)
    // The page must not simultaneously report success and "billing period has ended".
    await waitFor(() => {
      expect(screen.queryByText(/your billing period has ended/i)).not.toBeInTheDocument()
    })
  })

  // ── 202 PAYMENT_SESSION_INITIALIZING ────────────────────────────────────────

  it('does not treat a 202 "still initializing" checkout as an activated plan', async () => {
    mockPost.mockResolvedValueOnce({
      status: 202,
      data: {
        success: true,
        code: 'PAYMENT_SESSION_INITIALIZING',
        // The 202 body carries the *unchanged* account; it is not proof of success.
        account: accountPayload(),
        checkout: { provider: 'onegate', reference: 'ref-1', status: 'initializing' },
      },
    })

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))

    expect(await screen.findByText(/still being prepared/i)).toBeInTheDocument()
    expect(screen.queryByText(/plan activated/i)).not.toBeInTheDocument()
  })

  it('does not claim credits were added on a 202 credit purchase', async () => {
    mockPost.mockResolvedValueOnce({
      status: 202,
      data: {
        success: true,
        code: 'PAYMENT_SESSION_INITIALIZING',
        account: accountPayload(),
        purchase: { provider: 'onegate', credits: 500, reference: 'ref-2', status: 'initializing' },
      },
    })

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /500 credits/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay|confirm purchase/i }))

    expect(await screen.findByText(/still being prepared/i)).toBeInTheDocument()
    expect(screen.queryByText(/added 500/i)).not.toBeInTheDocument()
  })

  // ── Billing cycle ───────────────────────────────────────────────────────────

  it('offers a cycle switch on the current plan instead of disabling it', async () => {
    renderWithAuth(<Account />)
    // Account is on growth/monthly.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /active plan/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /^annual$/i }))

    const switchButton = await screen.findByRole('button', { name: /switch to annual/i })
    expect(switchButton).toBeEnabled()
  })

  // ── Confirmation before money moves ─────────────────────────────────────────

  it('states the charge before a plan change', async () => {
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))

    expect(mockPost).not.toHaveBeenCalledWith('/account/checkout', expect.anything(), expect.anything())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText(/R399/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/nothing renews automatically/i)).toBeInTheDocument()
  })

  it('posts the plan checkout only after explicit confirmation', async () => {
    mockPost.mockResolvedValueOnce({
      status: 200,
      data: { success: true, account: accountPayload(), checkout: { provider: 'mock', status: 'paid' } },
    })

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/account/checkout',
        { plan: 'starter', billingCycle: 'monthly' },
        expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) })
      )
    })
  })

  it('cancelling the plan confirmation charges nothing', async () => {
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(mockPost).not.toHaveBeenCalledWith('/account/checkout', expect.anything(), expect.anything())
  })

  it('names the credit pack charge before buying', async () => {
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /500 credits/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/500/)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith('/account/ai-credits', expect.anything(), expect.anything())
  })

  it('reuses the credit-checkout idempotency key after a network failure', async () => {
    mockPost
      .mockRejectedValueOnce(new Error('connection dropped'))
      .mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          account: accountPayload(),
          purchase: { provider: 'mock', credits: 500, status: 'paid' },
        },
      })

    renderWithAuth(<Account />)
    const button = await screen.findByRole('button', { name: /500 credits/i })
    await userEvent.click(button)
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay|confirm purchase/i }))
    expect(await screen.findByText(/could not start card checkout/i)).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /500 credits/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay|confirm purchase/i }))
    await waitFor(() => {
      const calls = mockPost.mock.calls.filter(([url]) => url === '/account/ai-credits')
      expect(calls).toHaveLength(2)
      const firstKey = calls[0][2]?.headers?.['Idempotency-Key']
      const secondKey = calls[1][2]?.headers?.['Idempotency-Key']
      expect(firstKey).toMatch(/^credits:/)
      expect(secondKey).toBe(firstKey)
    })
  })

  it('disables every plan card while a checkout is in flight', async () => {
    let releaseCheckout: ((value: unknown) => void) | undefined
    mockPost.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseCheckout = resolve
      })
    )

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))

    // A second, different plan must not be able to mint a second PaymentSession.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /move to starter/i })).toBeDisabled()
    })

    releaseCheckout?.({ status: 200, data: { success: true, checkout: { provider: 'mock', status: 'paid' } } })
  })

  // ── Reporting and forms ─────────────────────────────────────────────────────

  it('announces password validation errors to assistive technology', async () => {
    renderWithAuth(<Account />)

    await screen.findByText('Password')
    await userEvent.type(screen.getByLabelText(/^Current Password$/i), 'password123')
    await userEvent.type(screen.getByLabelText(/^New Password$/i), 'short')
    await userEvent.type(screen.getByLabelText(/^Confirm Password$/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/at least 8 characters/i)
    expect(screen.getByLabelText(/^New Password$/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('surfaces the server message when a profile save is rejected', async () => {
    mockPatch.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'Billing email must be a valid address.' } },
    })

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }))
    await userEvent.click(screen.getByText('Save Account'))

    expect(await screen.findByText(/billing email must be a valid address/i)).toBeInTheDocument()
  })

  it('does not invent a credit allowance denominator', async () => {
    const noAllowance = accountPayload()
    noAllowance.usage.guavaCredits = {
      included: 0,
      bonus: 0,
      used: 0,
      available: 0,
      resetAt: '2026-06-01T00:00:00.000Z',
    }
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/account')) return Promise.resolve({ data: { success: true, account: noAllowance } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Account />)

    expect(await screen.findByText(/no credit allowance on this plan/i)).toBeInTheDocument()
    expect(screen.queryByText('0 / 1')).not.toBeInTheDocument()
  })

  it('changes password and signs the user out', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    mockPost.mockResolvedValueOnce({ data: { success: true } })

    renderWithAuth(<Account />, { logout })

    await waitFor(() => {
      expect(screen.getByText('Password')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText(/^Current Password$/i), 'password123')
    await userEvent.type(screen.getByLabelText(/^New Password$/i), 'newpassword456')
    await userEvent.type(screen.getByLabelText(/^Confirm Password$/i), 'newpassword456')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'password123',
        newPassword: 'newpassword456',
      })
      expect(logout).toHaveBeenCalled()
    })
    expect(screen.getByText(/please sign in again/i)).toBeInTheDocument()
  })

  it('does not submit password changes when confirmation does not match', async () => {
    renderWithAuth(<Account />)

    await waitFor(() => {
      expect(screen.getByText('Password')).toBeInTheDocument()
    })

    await userEvent.type(screen.getByLabelText(/^Current Password$/i), 'password123')
    await userEvent.type(screen.getByLabelText(/^New Password$/i), 'newpassword456')
    await userEvent.type(screen.getByLabelText(/^Confirm Password$/i), 'different456')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(screen.getByText(/confirmation do not match/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith('/auth/change-password', expect.anything())
  })

  it('sends the owner to Team when a downgrade is blocked by seats or locations', async () => {
    mockPost.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          success: false,
          code: 'PLAN_LIMIT_EXCEEDED',
          message: 'Reduce usage before switching to the starter plan: 3 locations (limit 2)',
          capacity: {},
        },
      },
    })

    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))

    const alert = (await screen.findAllByRole('alert')).find((element) => /limit 2/.test(element.textContent ?? ''))
    expect(alert).toBeDefined()
    expect(within(alert as HTMLElement).getByRole('link', { name: /open team/i })).toHaveAttribute('href', '/team')
  })
  // ── D-019 plan changes ───────────────────────────────────────────────────────
  const PERIOD_END = '2026-11-01T12:00:00.000Z'
  function planChangesPayload() {
    const payload = accountPayload()
    return {
      ...payload,
      organization: { ...payload.organization, currentPeriodEnd: PERIOD_END, pendingPlanChange: null },
      plans: [
        ...payload.plans,
        {
          id: 'pro', name: 'Pro', priceMonthly: 1799, priceAnnual: 17990, includedSeats: 15, includedAiCredits: 2000,
          includedGuavaCredits: 6000, includedLocations: 10, overagePerSeat: 80, aiCreditPackPrice: 69, features: ['Priority support'],
        },
      ],
      planChanges: [
        { plan: 'starter', billingCycle: 'monthly', type: 'downgrade', effectiveAt: PERIOD_END, periodEnd: '2026-12-01T12:00:00.000Z', creditDays: 0, blocked: null },
        { plan: 'pro', billingCycle: 'monthly', type: 'upgrade', effectiveAt: '2026-10-12T12:00:00.000Z', periodEnd: '2026-11-21T12:00:00.000Z', creditDays: 9, blocked: null },
        { plan: 'growth', billingCycle: 'annual', type: 'cycle_switch', effectiveAt: PERIOD_END, periodEnd: '2027-11-01T12:00:00.000Z', creditDays: 0, blocked: null },
      ],
    }
  }
  function serveAccount(account: unknown) {
    mockGet.mockImplementation((url: string) =>
      url.includes('/account')
        ? Promise.resolve({ data: { success: true, account } })
        : Promise.resolve({ data: {} }))
  }

  it('says when a downgrade takes effect instead of claiming the current period is lost', async () => {
    serveAccount(planChangesPayload())
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/takes effect on 0?1 Nov 2026/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/not refunded or credited|already paid for is lost/i)).not.toBeInTheDocument()
  })

  it('states the days credited when upgrading', async () => {
    serveAccount(planChangesPayload())
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to pro/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/starts today.*9 extra days.*21 Nov 2026/i)).toBeInTheDocument()
  })

  it('shows a scheduled plan change and holds the plan cards until it starts', async () => {
    const payload = planChangesPayload()
    serveAccount({
      ...payload,
      organization: {
        ...payload.organization,
        pendingPlanChange: { plan: 'starter', billingCycle: 'monthly', effectiveAt: PERIOD_END, periodEnd: '2026-12-01T12:00:00.000Z' },
      },
      planChanges: payload.planChanges.map((change) => ({ ...change, blocked: 'PLAN_CHANGE_ALREADY_SCHEDULED' })),
    })
    renderWithAuth(<Account />)

    expect(await screen.findByText(/starter \(monthly\) takes effect on 0?1 Nov 2026/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /move to starter/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /move to pro/i })).toBeDisabled()
  })

  it('announces a scheduled change, not an activation, after a mock downgrade', async () => {
    serveAccount(planChangesPayload())
    mockPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        account: planChangesPayload(),
        checkout: {
          provider: 'mock',
          status: 'paid',
          planChange: { plan: 'starter', billingCycle: 'monthly', type: 'downgrade', effectiveAt: PERIOD_END, periodEnd: '2026-12-01T12:00:00.000Z', creditDays: 0 },
        },
      },
    })
    renderWithAuth(<Account />)
    await userEvent.click(await screen.findByRole('button', { name: /move to starter/i }))
    await userEvent.click(await screen.findByRole('button', { name: /confirm and pay/i }))

    expect(await screen.findByText(/starter \(monthly\) is paid for and takes effect on 0?1 Nov 2026/i)).toBeInTheDocument()
    expect(screen.queryByText(/starter plan activated/i)).not.toBeInTheDocument()
  })

})
