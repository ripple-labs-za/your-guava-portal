import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import Login from './Login'
import api, { isSessionRejection, refreshAccessToken } from '@/lib/api'
import { clearAccessToken } from '@/lib/accessToken'

// Mock the logo asset
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

// Mock the api module.
//
// AuthContext's cold-load bootstrap now exchanges the refresh cookie *before*
// asking /auth/me, because the access token lives only in module memory and the
// old order spent a guaranteed 401 on every page load. The named export has to
// be part of this mock: without it the bootstrap throws on `refreshAccessToken
// is not a function` and /auth/me is never reached at all.
vi.mock('@/lib/api', () => {
  return {
    refreshAccessToken: vi.fn(),
    // A logged-out visitor arriving at /login is the normal case, and the
    // provider reads this to tell "no session" apart from "server unreachable".
    // Left false, every test below renders the startup notice instead of Login.
    isSessionRejection: vi.fn(() => true),
    API_CONFIG_ERROR: null,
    API_BASE_URL: 'http://localhost:5000/api',
    default: {
      get: vi.fn(),
      post: vi.fn(),
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

const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return { ...actual, useNavigate: () => mockNavigate }
})

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    clearAccessToken()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/login')
    vi.mocked(isSessionRejection).mockReturnValue(true)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("No refresh session"))
    vi.mocked(api.get).mockRejectedValue(new Error('No refresh session'))
  })

  it('discards a remembered return path when a different user signs into an abandoned tab', async () => {
    sessionStorage.setItem('yg.tabUserId', 'previous-user')
    window.history.replaceState({ usr: { from: '/uploads/previous-user-upload' } }, '', '/login')
    vi.mocked(api.post).mockResolvedValueOnce({ data: {
      accessToken: 'new-token', user: { id: 'different-user', name: 'Different Owner', email: 'different@example.com', role: 'owner' },
    } })
    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'different@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/today', { replace: true }))
  })

  it('retains a fresh visitor requested local page when no earlier user used the tab', async () => {
    window.history.replaceState({ usr: { from: '/settings?section=billing' } }, '', '/login')
    vi.mocked(api.post).mockResolvedValueOnce({ data: {
      accessToken: 'fresh-token', user: { id: 'fresh-user', name: 'Fresh Owner', email: 'fresh@example.com', role: 'owner' },
    } })
    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'fresh@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings?section=billing', { replace: true }))
  })

  it('restores an expired session return path when the same user signs in again', async () => {
    sessionStorage.setItem('yg.tabUserId', 'returning-user')
    window.history.replaceState({ usr: { from: '/uploads/old-upload' } }, '', '/login')
    vi.mocked(api.post).mockResolvedValueOnce({ data: {
      accessToken: 'renewed-token', user: { id: 'returning-user', name: 'Returning Owner', email: 'owner@example.com', role: 'owner' },
    } })
    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'owner@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/uploads/old-upload', { replace: true }))
  })

  it('drops an unowned resource return path when an older tab has no identity stamp', async () => {
    window.history.replaceState({ usr: { from: '/uploads/previous-owner-upload' } }, '', '/login')
    vi.mocked(api.post).mockResolvedValueOnce({ data: {
      accessToken: 'new-token', user: { id: 'new-user', name: 'New Owner', email: 'new@example.com', role: 'owner' },
    } })
    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'new@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/today', { replace: true }))
  })

  it('renders login form with email and password fields', async () => {
    render(<Login />)
    await waitFor(() => expect(refreshAccessToken).toHaveBeenCalled())
    expect(screen.getByPlaceholderText(/owner@yourcafe/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument()
  })

  it('exchanges the refresh cookie before asking who the user is', async () => {
    // A live session: the cookie exchange succeeds, so /auth/me runs with a
    // token in hand and the visit costs one request rather than a 401 and a retry.
    vi.mocked(refreshAccessToken).mockResolvedValue(undefined as never)
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'u1', email: 'a@b.c' } })

    render(<Login />)

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'))
    expect(await screen.findByText(/you are signed in as a@b\.c/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/today')
    const refreshOrder = vi.mocked(refreshAccessToken).mock.invocationCallOrder[0]
    const meOrder = vi.mocked(api.get).mock.invocationCallOrder[0]
    expect(refreshOrder).toBeLessThan(meOrder)
  })

  it('displays the Your Guava logo', async () => {
    render(<Login />)
    await waitFor(() => expect(refreshAccessToken).toHaveBeenCalled())
    const logos = screen.getAllByAltText('Your Guava')
    expect(logos.length).toBeGreaterThan(0)
  })

  it('renders welcome text', async () => {
    render(<Login />)
    await waitFor(() => expect(refreshAccessToken).toHaveBeenCalled())
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('Sign in to your portal')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    )
  })

  it('shows error on invalid credentials', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    })

    render(<Login />)

    await userEvent.type(screen.getByPlaceholderText(/owner@yourcafe/i), 'bad@email.com')
    await userEvent.type(screen.getByPlaceholderText(/enter your password/i), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    })
  })

  it('shows generic error when no response message', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'))

    render(<Login />)

    await userEvent.type(screen.getByPlaceholderText(/owner@yourcafe/i), 'bad@email.com')
    await userEvent.type(screen.getByPlaceholderText(/enter your password/i), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument()
    })
  })

  it('submit button shows loading state', async () => {
    // Make login hang
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(() => {}))

    render(<Login />)

    await userEvent.type(screen.getByPlaceholderText(/owner@yourcafe/i), 'test@test.com')
    await userEvent.type(screen.getByPlaceholderText(/enter your password/i), 'password')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(screen.getByText(/signing in/i)).toBeInTheDocument()
    })
  })

  it('offers a verification resend when the API requires email verification', async () => {
    vi.mocked(api.post)
      .mockRejectedValueOnce({
        response: {
          data: {
            code: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Verify your email address before signing in',
          },
        },
      })
      .mockResolvedValueOnce({ data: { success: true } })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'pending@example.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    const resend = await screen.findByRole('button', {
      name: /resend verification email/i,
    })
    await userEvent.click(resend)
    await waitFor(() => {
      expect(api.post).toHaveBeenLastCalledWith('/auth/resend-verification', {
        email: 'pending@example.com',
      })
    })
  })
})

describe('Login error announcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(isSessionRejection).mockReturnValue(true)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("No refresh session"))
    vi.mocked(api.get).mockRejectedValue(new Error('No refresh session'))
  })

  it('announces a failed sign-in to assistive technology', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'bad@email.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid credentials')
  })

  it('points the credential fields at the error message', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      response: { data: { message: 'Invalid credentials' } },
    })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'bad@email.com')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrongpass')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await screen.findByRole('alert')
    const email = screen.getByLabelText(/email address/i)
    const password = screen.getByLabelText(/^password$/i)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAttribute('aria-describedby', 'login-error')
    expect(password).toHaveAttribute('aria-describedby', 'login-error')
    expect(document.getElementById('login-error')).toBeInTheDocument()
  })
})

describe('Login credential autofill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(isSessionRejection).mockReturnValue(true)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("No refresh session"))
    vi.mocked(api.get).mockRejectedValue(new Error('No refresh session'))
  })

  it('gives both credential fields the attributes password managers key on', async () => {
    render(<Login />)
    const email = await screen.findByLabelText(/email address/i)
    const password = screen.getByLabelText(/^password$/i)

    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(email).toHaveAttribute('name', 'email')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(password).toHaveAttribute('name', 'password')
  })
})

describe('Login verification recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(isSessionRejection).mockReturnValue(true)
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("No refresh session"))
    vi.mocked(api.get).mockRejectedValue(new Error('No refresh session'))
  })

  // The backend answers a never-verified signup with a plain 401 'Invalid
  // credentials' -- there is no User document to attach a code to -- so the
  // resend path has to be reachable without the server asking for it.
  it('offers a resend to anyone who never received their verification email', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true } })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'owner@newcafe.co.za')
    await userEvent.click(
      await screen.findByRole('button', { name: /send it again/i })
    )

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/resend-verification', {
        email: 'owner@newcafe.co.za',
      })
    })
  })

  it('asks for the address instead of sending an empty resend', async () => {
    render(<Login />)
    await userEvent.click(
      await screen.findByRole('button', { name: /send it again/i })
    )

    expect(await screen.findByText(/enter your email address above/i)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('confirms a resend in the status channel, not the error banner', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'owner@newcafe.co.za')
    await userEvent.click(
      await screen.findByRole('button', { name: /send it again/i })
    )

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/verification link has been sent/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lets the owner ask for another link when the first never arrives', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } })

    render(<Login />)
    await userEvent.type(screen.getByLabelText(/email address/i), 'owner@newcafe.co.za')
    const resend = await screen.findByRole('button', { name: /send it again/i })
    await userEvent.click(resend)
    await screen.findByRole('status')

    // The button must come back: a second silent failure is exactly the case
    // this control exists for, and a reload is not an acceptable remedy.
    await waitFor(() => expect(resend).toBeEnabled())
    await userEvent.click(resend)
    await waitFor(() => expect(vi.mocked(api.post).mock.calls.length).toBe(2))
  })
})
