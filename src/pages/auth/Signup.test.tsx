import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import Signup from './Signup'
import api from '@/lib/api'

// Mock the logo asset
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

// Mock the api module. The named exports are what AuthProvider's cold-load
// bootstrap uses: it exchanges the refresh cookie before asking /auth/me, and
// reads isSessionRejection to tell "logged out" from "server unreachable".
vi.mock('@/lib/api', () => {
  return {
    refreshAccessToken: vi.fn().mockRejectedValue(new Error('No refresh session')),
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

const mockRegister = vi.fn()
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    register: mockRegister,
    user: null,
    isLoading: false,
  }),
}))

const completeSignupForm = async (email = 'jane@cafe.co.za') => {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Jane Smith')
  await userEvent.type(screen.getByLabelText(/email address/i), email)
  await userEvent.type(screen.getByLabelText(/^password$/i), 'supersecret123')
  await userEvent.type(screen.getByLabelText(/confirm password/i), 'supersecret123')
  await userEvent.type(screen.getByLabelText(/cafe name/i), 'The Daily Grind')
}

describe('Signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('submits the form and calls register with correct arguments', async () => {
    mockRegister.mockResolvedValueOnce({
      email: 'jane@cafe.co.za',
      message: 'Check your email.',
    })

    render(<Signup />)

    await completeSignupForm()
    // Leave organization name empty — should pass undefined

    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(
        'jane@cafe.co.za',
        'supersecret123',
        'Jane Smith',
        'The Daily Grind',
        undefined
      )
    })

    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument()
    expect(screen.getByText('jane@cafe.co.za')).toBeInTheDocument()
  }, 10000)

  it('does not submit when password confirmation differs', async () => {
    render(<Signup />)
    await userEvent.type(screen.getByLabelText(/full name/i), 'Jane Smith')
    await userEvent.type(screen.getByLabelText(/email address/i), 'jane@cafe.co.za')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'supersecret123')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different123')
    await userEvent.type(screen.getByLabelText(/cafe name/i), 'The Daily Grind')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it.each([
    [
      'VERIFICATION_EMAIL_FAILED',
      'Your registration is saved, but the verification email could not be sent.',
    ],
  ])('offers verification resend when registration returns %s', async (code, message) => {
    mockRegister.mockRejectedValueOnce({
      response: {
        data: {
          code,
          message,
        },
      },
    })
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true } })

    render(<Signup />)
    await completeSignupForm('Pending@Cafe.co.za')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByText('pending@cafe.co.za')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', {
      name: /resend verification email/i,
    }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/resend-verification', {
        email: 'pending@cafe.co.za',
      })
    })
  })

  it('announces a submission failure to assistive technology', async () => {
    mockRegister.mockRejectedValueOnce({
      response: { data: { message: 'That email is already registered.' } },
    })

    render(<Signup />)
    await completeSignupForm()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email is already registered.')
  })

  it('uses the pending email from a nested registration response when supplied', async () => {
    mockRegister.mockRejectedValueOnce({
      response: {
        data: {
          data: {
            code: 'VERIFICATION_EMAIL_FAILED',
            email: 'canonical@example.com',
            message: 'Registration is pending.',
          },
        },
      },
    })

    render(<Signup />)
    await completeSignupForm('typed@example.com')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText('canonical@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: /resend verification email/i,
    })).toBeInTheDocument()
  })
})

describe('Signup password rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // A placeholder disappears the moment the field is typed into, which is
  // exactly when the rule is needed. Both bounds have to be readable while the
  // user is choosing a password, not revealed by a failed round trip.
  it('states both password bounds before anything is submitted', () => {
    render(<Signup />)

    const help = screen.getByText(/at least 8 characters/i)
    expect(help).toBeInTheDocument()
    expect(help).toHaveTextContent(/72/)
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      'aria-describedby',
      'signup-password-help'
    )
  })

  it('refuses a password over the bcrypt byte ceiling without a round trip', async () => {
    render(<Signup />)

    await userEvent.type(screen.getByLabelText(/full name/i), 'Jane Smith')
    await userEvent.type(screen.getByLabelText(/email address/i), 'jane@cafe.co.za')
    const long = 'a'.repeat(80)
    await userEvent.type(screen.getByLabelText(/^password$/i), long)
    await userEvent.type(screen.getByLabelText(/confirm password/i), long)
    await userEvent.type(screen.getByLabelText(/cafe name/i), 'The Daily Grind')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/72/)
    expect(mockRegister).not.toHaveBeenCalled()
  }, 20000)
})

describe('Signup credential autofill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('names every field so password managers can build a credential record', () => {
    render(<Signup />)

    const expected: [RegExp, string, string][] = [
      [/full name/i, 'name', 'name'],
      [/email address/i, 'email', 'email'],
      [/^password$/i, 'password', 'new-password'],
      [/confirm password/i, 'confirm-password', 'new-password'],
      [/cafe name/i, 'cafeName', 'organization'],
    ]

    for (const [label, name, autocomplete] of expected) {
      const field = screen.getByLabelText(label)
      expect(field).toHaveAttribute('name', name)
      expect(field).toHaveAttribute('autocomplete', autocomplete)
    }
  })
})

describe('Signup pending screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  async function reachPendingScreen() {
    mockRegister.mockResolvedValueOnce({
      email: 'jane@cafe.co.za',
      message: 'Check your email.',
    })
    render(<Signup />)
    await completeSignupForm()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await screen.findByText(/check your inbox/i)
  }

  // This screen is the entire gap between "I signed up" and "I can use the
  // product", and it is where the journey most often stalls.
  it('tells the owner how long the link lasts and where else to look', async () => {
    await reachPendingScreen()

    expect(screen.getByText(/24 hours/i)).toBeInTheDocument()
    expect(screen.getByText(/spam/i)).toBeInTheDocument()
  })

  it('offers a way out when the email never arrives at all', async () => {
    await reachPendingScreen()

    expect(screen.getByRole('link', { name: /support@yourguava/i })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:')
    )
    // UAT-01-S08/S09 axe link-in-text-block: green on muted grey is 1.12:1 against the sentence, so colour alone does
    // not mark it as a link; it is underlined at rest.
    expect(screen.getByRole('link', { name: /support@yourguava/i }).className).toMatch(/(^|\s)underline(\s|$)/)
  })

  // resendVerification answers the same 200 whether a link went out or the mail
  // provider refused the send and the token was rolled back, so a flat "a fresh
  // link has been sent" is an assertion the server never actually made.
  it('says no email was sent when the server is in development mode', async () => {
    mockRegister.mockResolvedValueOnce({ email: 'jane@cafe.co.za', message: 'Check your inbox.', deliveryMode: 'console' })
    render(<Signup />)
    await completeSignupForm()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/development mode: no email was sent/i)).toBeInTheDocument()
  })

  it('does not mention development mode for a real delivery', async () => {
    await reachPendingScreen()
    expect(screen.queryByText(/development mode/i)).not.toBeInTheDocument()
  })

  it('says how many verification emails an hour it will send', async () => {
    await reachPendingScreen()
    expect(screen.getByText(/up to 3 emails an hour/i)).toBeInTheDocument()
  })

  it('shows one check-your-inbox state and says the link will ask for this password', async () => {
    await reachPendingScreen()
    expect(screen.getAllByRole('heading', { name: /check your inbox/i })).toHaveLength(1)
    expect(screen.getByText(/enter the password you just chose/i)).toBeInTheDocument()
  })

  it('does not promise delivery it cannot confirm', async () => {
    await reachPendingScreen()
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true } })

    await userEvent.click(
      screen.getByRole('button', { name: /resend verification email/i })
    )

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/if .*(still|pending)/i)
    expect(status).not.toHaveTextContent(/^A fresh link has been sent\.$/)
  })
})
