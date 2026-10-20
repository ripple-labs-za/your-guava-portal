import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, AuthContext } from './AuthContext'
import { useContext } from 'react'
import { clearAccessToken, getAccessToken, setAccessToken } from '@/lib/accessToken'
import { CafeContextChangedError, clearTabCafeId, getTabCafeId, setTabCafeId } from '@/lib/cafeContext'

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockRefresh = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    refreshAccessToken: (...args: unknown[]) => mockRefresh(...args),
    API_CONFIG_ERROR: null,
    // Mirrors the real implementation: only a refused credential ends a session.
    isSessionRejection: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      return status === 401 || status === 403
    },
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
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

// Test consumer component
function TestConsumer() {
  const ctx = useContext(AuthContext)
  if (!ctx) return <div>No context</div>

  return (
    <div>
      <div data-testid="user">{ctx.user ? ctx.user.name : 'null'}</div>
      <div data-testid="loading">{ctx.isLoading ? 'true' : 'false'}</div>
      <div data-testid="bootstrapError">{ctx.bootstrapError ?? 'none'}</div>
      <div data-testid="isOwner">{ctx.isOwner ? 'true' : 'false'}</div>
      <div data-testid="signedOut">{ctx.signedOut ? 'true' : 'false'}</div>
      <button onClick={() => ctx.login('test@test.com', 'pass')}>Login</button>
      <button onClick={() => ctx.logout()}>Logout</button>
      <button onClick={() => ctx.switchCafe('cafe456')}>Switch Cafe</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    clearTabCafeId()
    clearAccessToken()
    // What "no session" actually looks like on the wire: the server refuses the
    // refresh cookie with a 401. It is deliberately not a bare Error — the app
    // now distinguishes a refused credential from a failed connection, and only
    // the former means signed out.
    const noSession = { response: { status: 401 } }
    mockGet.mockRejectedValue(noSession)
    mockRefresh.mockRejectedValue(noSession)
  })

  describe('cold-load bootstrap', () => {
    // The access token lives only in module memory, so a hard reload starts with
    // none. Calling /auth/me first meant every cold load spent a round trip on a
    // guaranteed 401 before the interceptor could refresh -- and logged a red
    // error in the console every time. Refreshing first is the same number of
    // requests when there IS a session and one fewer when the page is reloaded.
    it('exchanges the refresh cookie before asking who the user is', async () => {
      const order: string[] = []
      mockRefresh.mockImplementation(async () => { order.push('refresh'); return 'new-token' })
      mockGet.mockImplementation(async (url: string) => {
        order.push(`get ${url}`)
        return { data: { id: 'u1', name: 'Thandi', email: 't@x.co', role: 'owner' } }
      })

      render(<AuthProvider><TestConsumer /></AuthProvider>)

      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
      expect(order).toEqual(['refresh', 'get /auth/me'])
      expect(screen.getByTestId('user')).toHaveTextContent('Thandi')
    })

    it('does not call /auth/me at all when there is no session to restore', async () => {
      mockRefresh.mockRejectedValue({ response: { status: 401 } })

      render(<AuthProvider><TestConsumer /></AuthProvider>)

      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
      expect(mockGet).not.toHaveBeenCalled()
      expect(screen.getByTestId('user')).toHaveTextContent('null')
    })

    it('reports an unreachable API rather than treating it as a signed-out session', async () => {
      // A dropped connection is not a signed-out session. Sending the owner to
      // /login made them retype a password that was never wrong, and spend
      // attempts against the login rate limit doing it. The flag is published
      // here; ProtectedRoute turns it into the connectivity screen, because only
      // it knows whether the page being asked for actually needs a session.
      mockRefresh.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))

      render(<AuthProvider><TestConsumer /></AuthProvider>)

      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
      expect(screen.getByTestId('bootstrapError')).toHaveTextContent('unreachable')
      expect(screen.getByTestId('user')).toHaveTextContent('null')
    })

    it('treats a rejected credential as signed out, not as an outage', async () => {
      mockRefresh.mockRejectedValue({ response: { status: 401 } })

      render(<AuthProvider><TestConsumer /></AuthProvider>)

      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
      expect(screen.getByTestId('bootstrapError')).toHaveTextContent('none')
      expect(screen.getByTestId('user')).toHaveTextContent('null')
    })

    it('skips the refresh when an access token is already in memory', async () => {
      setAccessToken('still-valid')
      mockGet.mockResolvedValue({ data: { id: 'u1', name: 'Thandi', email: 't@x.co', role: 'owner' } })

      render(<AuthProvider><TestConsumer /></AuthProvider>)

      await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
      expect(mockRefresh).not.toHaveBeenCalled()
      expect(mockGet).toHaveBeenCalledWith('/auth/me')
    })
  })

  it('provides user as null initially when no token', async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    expect(screen.getByTestId('user')).toHaveTextContent('null')
  })

  it('sets user after login', async () => {
    const mockUser = {
      id: 'u1',
      email: 'test@test.com',
      name: 'Test User',
      role: 'owner',
      orgId: 'org1',
      cafeIds: ['c1'],
      activeCafeId: 'c1',
    }

    mockPost.mockResolvedValueOnce({
      data: { accessToken: 'token123', user: mockUser },
    })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    await userEvent.click(screen.getByText('Login'))

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('Test User')
    })

    expect(getAccessToken()).toBe('token123')
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('clears user after logout', async () => {
    const mockUser = {
      id: 'u1',
      email: 'test@test.com',
      name: 'Test User',
      role: 'owner',
      orgId: 'org1',
      cafeIds: ['c1'],
      activeCafeId: 'c1',
    }

    mockPost
      .mockResolvedValueOnce({ data: { accessToken: 'token123', user: mockUser } }) // login
      .mockResolvedValueOnce({}) // logout

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    // Login first
    await userEvent.click(screen.getByText('Login'))

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('Test User')
    })

    // Now logout
    await userEvent.click(screen.getByText('Logout'))

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('null')
    })

    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  // UAT-14-S20: Sign Out left the page's path as the next sign-in's destination, so whoever signed in next landed on it.
  it('remembers a deliberate sign-out until the next sign-in', async () => {
    const mockUser = { id: 'u1', email: 'test@test.com', name: 'Test User', role: 'owner', orgId: 'org1', cafeIds: ['c1'], activeCafeId: 'c1' }
    mockPost
      .mockResolvedValueOnce({ data: { accessToken: 'token123', user: mockUser } }) // login
      .mockResolvedValueOnce({}) // logout
      .mockResolvedValueOnce({ data: { accessToken: 'token456', user: mockUser } }) // login again

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('signedOut')).toHaveTextContent('false')

    await userEvent.click(screen.getByText('Login'))
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Test User'))
    await userEvent.click(screen.getByText('Logout'))
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('null'))
    expect(screen.getByTestId('signedOut')).toHaveTextContent('true')

    await userEvent.click(screen.getByText('Login'))
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Test User'))
    expect(screen.getByTestId('signedOut')).toHaveTextContent('false')
  })

  it('isOwner returns true for owner role', async () => {
    const mockUser = {
      id: 'u1',
      email: 'test@test.com',
      name: 'Owner User',
      role: 'owner',
      orgId: 'org1',
      cafeIds: ['c1'],
      activeCafeId: 'c1',
    }

    mockPost.mockResolvedValueOnce({
      data: { accessToken: 'token123', user: mockUser },
    })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    await userEvent.click(screen.getByText('Login'))

    await waitFor(() => {
      expect(screen.getByTestId('isOwner')).toHaveTextContent('true')
    })
  })

  it('isOwner returns false for manager role', async () => {
    const mockUser = {
      id: 'u1',
      email: 'test@test.com',
      name: 'Manager User',
      role: 'manager',
      orgId: 'org1',
      cafeIds: ['c1'],
      activeCafeId: 'c1',
    }

    mockPost.mockResolvedValueOnce({
      data: { accessToken: 'token123', user: mockUser },
    })

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    await userEvent.click(screen.getByText('Login'))

    await waitFor(() => {
      expect(screen.getByTestId('isOwner')).toHaveTextContent('false')
    })
  })

  it('adopts the cafe the server granted when a cold load finds this tab cafe revoked', async () => {
    setTabCafeId('cafeRevoked')
    mockRefresh.mockImplementation(async () => {
      setAccessToken('granted-token')
      setTabCafeId('cafeGranted')
      throw new CafeContextChangedError('cafeGranted')
    })
    mockGet.mockResolvedValue({
      data: { id: 'u1', name: 'Thandi', email: 't@x.co', role: 'owner', activeCafeId: 'cafeGranted' },
    })

    render(<AuthProvider><TestConsumer /></AuthProvider>)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('Thandi')
    expect(screen.getByTestId('bootstrapError')).toHaveTextContent('none')
    expect(getTabCafeId()).toBe('cafeGranted')
  })

  it('records the signed-in cafe for this tab and forgets it on logout', async () => {
    mockPost
      .mockResolvedValueOnce({
        data: { accessToken: 'token123', user: { id: 'u1', name: 'Test User', role: 'owner', activeCafeId: 'c1', cafeIds: ['c1'] } },
      })
      .mockResolvedValueOnce({ data: { success: true } })

    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    await userEvent.click(screen.getByText('Login'))
    await waitFor(() => expect(getTabCafeId()).toBe('c1'))

    await userEvent.click(screen.getByText('Logout'))
    await waitFor(() => expect(getTabCafeId()).toBeNull())
  })

  it('switchCafe calls API and reloads', async () => {
    const mockUser = {
      id: 'u1',
      email: 'test@test.com',
      name: 'Test User',
      role: 'owner',
      orgId: 'org1',
      cafeIds: ['c1', 'c2'],
      activeCafeId: 'c1',
    }

    // Mock window.location.reload
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    })

    mockPost
      .mockResolvedValueOnce({ data: { accessToken: 'token123', user: mockUser } }) // login
      .mockResolvedValueOnce({ data: { accessToken: 'newtoken', activeCafeId: 'c2' } }) // switchCafe

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false')
    })

    // Login first
    await userEvent.click(screen.getByText('Login'))

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('Test User')
    })

    // Switch cafe
    await userEvent.click(screen.getByText('Switch Cafe'))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/switch-cafe', { cafeId: 'cafe456' })
    })
    await waitFor(() => expect(getTabCafeId()).toBe('c2'))

    expect(getAccessToken()).toBe('newtoken')
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(reloadMock).toHaveBeenCalled()
  })
})
