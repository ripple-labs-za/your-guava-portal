import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { StrictMode } from 'react'
import AcceptInvite from './AcceptInvite'

const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}))

const token = 'a'.repeat(43)

function renderPage() {
  return render(
    <StrictMode>
      <BrowserRouter>
        <AcceptInvite />
      </BrowserRouter>
    </StrictMode>
  )
}

describe('AcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', `/accept-invite#token=${token}`)
    mockPost.mockImplementation((url: string) => {
      if (url === '/team/invitations/preview') {
        return Promise.resolve({
          data: {
            invitation: {
              email: 'manager@example.com',
              name: 'New Manager',
              organizationName: 'Guava Coffee',
              cafeNames: ['Central Cafe'],
              expiresAt: '2026-08-01T12:00:00.000Z',
            },
          },
        })
      }
      if (url === '/team/invitations/accept') return Promise.resolve({ data: { success: true } })
      return Promise.reject(new Error(`Unexpected POST ${url}`))
    })
  })

  it('scrubs the fragment, previews the invite, and submits the chosen password', async () => {
    renderPage()

    expect(window.location.hash).toBe('')
    expect(await screen.findByText('Welcome, New Manager')).toBeInTheDocument()
    expect(screen.getByText(/Guava Coffee/)).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledWith(
      '/team/invitations/preview',
      { token },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    fireEvent.change(screen.getByLabelText('Choose a password'), {
      target: { value: 'secure-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'secure-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/invitations/accept', {
        token,
        password: 'secure-password-123',
      })
    })
    expect(await screen.findByText('Your account is ready')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('does not call the API when the fragment does not contain a valid token', async () => {
    window.history.replaceState(null, '', '/accept-invite#token=short')
    renderPage()

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('blocks mismatched passwords before acceptance', async () => {
    renderPage()
    await screen.findByText('Welcome, New Manager')

    fireEvent.change(screen.getByLabelText('Choose a password'), {
      target: { value: 'secure-password-123' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText(/confirmation do not match/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalledWith('/team/invitations/accept', expect.anything())
  })

  // UAT-09-S02: the browser's minimum-length check stops the submit before the page's own message, so the rule
  // was never stated. It is stated up front, tied to the field, as signup does.
  it('states the password rule before the first submit', async () => {
    renderPage()
    await screen.findByText('Welcome, New Manager')

    const field = screen.getByLabelText('Choose a password')
    const help = document.getElementById(field.getAttribute('aria-describedby') || '')
    expect(help).not.toBeNull()
    expect(help).toHaveTextContent('At least 8 characters, up to 72 bytes (about 72 characters).')
  })
})

describe('AcceptInvite link recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ data: {} })
  })

  // Reloading is what a user does when a page looks stuck. The fragment is
  // already gone by then, and declaring the invitation expired pushes them to
  // ask for a replacement — which revokes the invitation that still worked.
  it('says the page consumed the link, not that the invitation expired', async () => {
    window.history.replaceState(null, '', '/accept-invite')
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/open the invitation link .*again|reopen the link/i)
    expect(alert).not.toHaveTextContent(/expired/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('still blames the invitation when the server rejects the token', async () => {
    window.history.replaceState(null, '', `/accept-invite#token=${token}`)
    mockPost.mockRejectedValue({ response: { status: 404, data: {} } })
    renderPage()

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })

  it('keeps a malformed token separate from a missing one', async () => {
    window.history.replaceState(null, '', '/accept-invite#token=short')
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/invalid or has expired/i)
    expect(mockPost).not.toHaveBeenCalled()
  })
})
