import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import ForgotPassword from './ForgotPassword'

vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

function renderPage() {
  return render(
    <StrictMode>
      <BrowserRouter>
        <ForgotPassword />
      </BrowserRouter>
    </StrictMode>
  )
}

async function submit(email = 'owner@example.com') {
  await userEvent.type(await screen.findByLabelText(/email address/i), email)
  await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/forgot-password')
    mockPost.mockResolvedValue({ data: { success: true } })
  })

  it('submits without revealing whether the account exists', async () => {
    renderPage()
    await submit()

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'owner@example.com',
      })
    })
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument()
  })

  it('does not claim a reset link was sent to an address it cannot vouch for', async () => {
    renderPage()
    await submit('owner@example.com')

    const panel = await screen.findByRole('status')
    expect(panel).toHaveTextContent(/if an account uses owner@example\.com, a reset link is on its way/i)
    expect(panel).not.toHaveTextContent(/check your inbox for a password reset link/i)
  })

  // The link is single-use and lives exactly one hour, and requesting another
  // one revokes every prior token. None of that was stated anywhere, so a user
  // whose email was slow had no way to judge whether to wait or ask again.
  it('states the expiry window and where else to look', async () => {
    renderPage()
    await submit()

    const panel = await screen.findByRole('status')
    expect(panel).toHaveTextContent(/1 hour|one hour/i)
    expect(panel).toHaveTextContent(/spam/i)
    expect(panel).toHaveTextContent(/up to 3 links an hour/i)
  })

  it('offers an escalation when the email never arrives', async () => {
    renderPage()
    await submit()

    await screen.findByRole('status')
    expect(screen.getByRole('link', { name: /support@yourguava/i })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:')
    )
    // UAT-01-S07 axe link-in-text-block (1.12:1 against the sentence): underlined at rest, not only on hover.
    expect(screen.getByRole('link', { name: /support@yourguava/i }).className).toMatch(/(^|\s)underline(\s|$)/)
  })

  it('shows the server message rather than a generic retry prompt', async () => {
    mockPost.mockRejectedValue({
      response: { status: 429, data: { message: 'Too many attempts, please try again later' } },
    })
    renderPage()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts, please try again later'
    )
  })

  // "Please try again" is the one thing that cannot work against a 15-minute
  // window shared with login, and it invites a retry loop that keeps failing.
  it('tells a throttled user to wait instead of to retry', async () => {
    mockPost.mockRejectedValue({ response: { status: 429, data: {} } })
    renderPage()
    await submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/15 minutes/i)
    expect(alert).not.toHaveTextContent(/try again\.?$/i)
  })

  it('says the request was not sent when the server could not be reached', async () => {
    mockPost.mockRejectedValue({ code: 'ERR_NETWORK', message: 'Network Error' })
    renderPage()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not (be sent|reach)/i)
  })

  it('names the email field for password managers', async () => {
    renderPage()

    const email = await screen.findByLabelText(/email address/i)
    expect(email).toHaveAttribute('name', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
  })
})
