import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const axiosMock = vi.hoisted(() => {
  const requestUse = vi.fn()
  const responseUse = vi.fn()
  const instance = vi.fn((config) => Promise.resolve({ data: { retried: true }, config }))
  Object.assign(instance, {
    defaults: { baseURL: 'http://localhost:5000/api' },
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
  })

  return {
    create: vi.fn(() => instance),
    post: vi.fn(),
    requestUse,
    responseUse,
    instance,
  }
})

vi.mock('axios', () => ({
  default: {
    create: axiosMock.create,
    post: axiosMock.post,
  },
}))

const loadApi = async () => {
  vi.resetModules()
  const mod = await import('./api')
  const tokenStore = await import('./accessToken')
  const cafeContext = await import('./cafeContext')
  const requestHandler = axiosMock.requestUse.mock.calls[axiosMock.requestUse.mock.calls.length - 1]?.[0]
  const responseRejected = axiosMock.responseUse.mock.calls[axiosMock.responseUse.mock.calls.length - 1]?.[1]
  if (!requestHandler || !responseRejected) {
    throw new Error('API interceptors were not registered')
  }
  return {
    api: mod.default,
    authenticatedFetch: mod.authenticatedFetch,
    requestHandler,
    responseRejected,
    ...tokenStore,
    ...cafeContext,
  }
}

describe('api interceptors', () => {
  const originalLocation = window.location
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })
  afterEach(() => {
    Object.defineProperty(window, 'location', { writable: true, value: originalLocation })
  })

  const stubReload = () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { writable: true, value: { ...originalLocation, reload } })
    return reload
  }

  it('does not bounce a lapsed owner off Team, where they reduce usage to fit a smaller plan', async () => {
    const { responseRejected } = await loadApi()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, pathname: '/team', href: 'http://localhost/team' },
    })
    const error = { config: { url: '/cafe/me', headers: {} }, response: { status: 402, data: { code: 'BILLING_REQUIRED' } } }

    await expect(responseRejected(error)).rejects.toBe(error)
    expect(window.location.href).toBe('http://localhost/team')
  })

  it('sends a lapsed organisation to billing when the 402 carries BILLING_REQUIRED only in details', async () => {
    // BE-13-T02: the metering path puts the code in details; the redirect must not depend on where it sits.
    const { responseRejected } = await loadApi()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, pathname: '/performance', href: 'http://localhost/performance' },
    })
    const error = {
      config: { url: '/analytics/revenue', headers: {} },
      response: { status: 402, data: { success: false, message: 'An active trial or paid billing period is required', details: { code: 'BILLING_REQUIRED', reason: 'trial_expired' } } },
    }

    await expect(responseRejected(error)).rejects.toBe(error)
    expect(window.location.href).toBe('/settings?section=billing&billing=required')
  })

  it('asks the refresh endpoint for the cafe this tab is showing', async () => {
    const { responseRejected, setTabCafeId } = await loadApi()
    setTabCafeId('cafeA')
    axiosMock.post.mockResolvedValueOnce({ data: { accessToken: 'new-token', cafeId: 'cafeA' } })
    const original: { url: string; headers: Record<string, string> } = { url: '/uploads', headers: {} }

    await expect(responseRejected({ config: original, response: { status: 401 } })).resolves.toEqual(
      expect.objectContaining({ data: { retried: true } })
    )
    expect(axiosMock.post).toHaveBeenCalledWith(
      'http://localhost:5000/api/auth/refresh',
      { cafeId: 'cafeA' },
      { withCredentials: true, timeout: 20_000 }
    )
    expect(axiosMock.instance).toHaveBeenCalledWith(original)
  })

  it('reloads instead of replaying when the server grants a different cafe', async () => {
    const { responseRejected, setTabCafeId, getTabCafeId, CafeContextChangedError } = await loadApi()
    const reload = stubReload()
    setTabCafeId('cafeA')
    axiosMock.post.mockResolvedValueOnce({ data: { accessToken: 'new-token', cafeId: 'cafeB' } })

    await expect(
      responseRejected({ config: { url: '/uploads', headers: {} }, response: { status: 401 } })
    ).rejects.toBeInstanceOf(CafeContextChangedError)
    expect(axiosMock.instance).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(getTabCafeId()).toBe('cafeB')
  })

  it('sends the tab cafe with every request', async () => {
    const { requestHandler, setTabCafeId } = await loadApi()
    setTabCafeId('cafeA')
    const config = requestHandler({ headers: {} })
    expect(config.headers['X-Cafe-Id']).toBe('cafeA')
  })

  it('reloads on a cafe-context mismatch without refreshing or retrying', async () => {
    const { responseRejected } = await loadApi()
    const reload = stubReload()
    const error = { config: { url: '/events', headers: {} }, response: { status: 409, data: { code: 'CAFE_CONTEXT_MISMATCH' } } }

    await expect(responseRejected(error)).rejects.toBe(error)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(axiosMock.instance).not.toHaveBeenCalled()
  })

  it('configures axios with the API base URL and credentials', async () => {
    await loadApi()

    expect(axiosMock.create).toHaveBeenCalledWith({
      baseURL: 'http://localhost:5000/api',
      withCredentials: true,
      timeout: 20_000,
    })
  })

  it('attaches the in-memory access token to outgoing requests', async () => {
    const { requestHandler, setAccessToken } = await loadApi()
    setAccessToken('access-token')

    const config = requestHandler({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer access-token')
  })

  it('removes a legacy persisted access token during migration', async () => {
    localStorage.setItem('accessToken', 'legacy-token')
    await loadApi()
    expect(localStorage.getItem('accessToken')).toBeNull()
  })

  it('does not refresh when login credentials are rejected', async () => {
    const { responseRejected, getAccessToken } = await loadApi()
    const error = {
      config: { url: '/auth/login', headers: {} },
      response: { status: 401, data: { message: 'Invalid credentials' } },
    }

    await expect(responseRejected(error)).rejects.toBe(error)

    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(axiosMock.instance).not.toHaveBeenCalled()
    expect(getAccessToken()).toBeNull()
  })

  // UAT-01-S03: a wrong password on the verify page (401 VERIFICATION_PASSWORD_MISMATCH) went through the
  // refresh path, which failed with no session and sent the page to /login, losing the form and its message.
  // No public auth or invitation call carries a session, so its 401 is an answer for the page, not an expiry.
  it.each([
    '/auth/verify-email',
    '/auth/resend-verification',
    '/auth/forgot-password',
    '/auth/reset-password',
    'http://localhost:5000/api/team/invitations/accept',
    '/team/invitations/preview',
  ])('hands a 401 from the public call %s to the page without refreshing or redirecting', async (url) => {
    const { responseRejected } = await loadApi()
    Object.defineProperty(window, 'location', { writable: true, value: { ...window.location, href: 'http://localhost/verify-email' } })
    const error = {
      config: { url, headers: {} },
      response: { status: 401, data: { code: 'VERIFICATION_PASSWORD_MISMATCH', attemptsRemaining: 4 } },
    }

    await expect(responseRejected(error)).rejects.toBe(error)

    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(axiosMock.instance).not.toHaveBeenCalled()
    expect(window.location.href).toBe('http://localhost/verify-email')
  })

  // The exclusions are exact paths: a protected call beside them (an owner's invitation resend) still refreshes on a real expiry.
  it.each(['/team/invitations/inv1/resend', '/auth/me'])('still refreshes a protected call %s whose session expired', async (url) => {
    const { responseRejected } = await loadApi()
    axiosMock.post.mockResolvedValueOnce({ data: { accessToken: 'fresh-token' } })
    const error = { config: { url, headers: {} }, response: { status: 401, data: { message: 'Token expired' } } }

    await expect(responseRejected(error)).resolves.toEqual(expect.objectContaining({ data: { retried: true } }))

    expect(axiosMock.post).toHaveBeenCalledWith('http://localhost:5000/api/auth/refresh', expect.anything(), expect.anything())
  })

  it('does not refresh when change-password rejects the current password', async () => {
    const { responseRejected, setAccessToken, getAccessToken } = await loadApi()
    setAccessToken('old-token')
    const error = {
      config: { url: 'http://localhost:5000/api/auth/change-password', headers: {} },
      response: { status: 401, data: { message: 'Current password is incorrect' } },
    }

    await expect(responseRejected(error)).rejects.toBe(error)

    expect(axiosMock.post).not.toHaveBeenCalled()
    expect(axiosMock.instance).not.toHaveBeenCalled()
    expect(getAccessToken()).toBe('old-token')
  })

  it('refreshes and retries ordinary API requests after a 401', async () => {
    const { responseRejected, getAccessToken } = await loadApi()
    axiosMock.post.mockResolvedValueOnce({ data: { accessToken: 'new-token' } })
    const original: { url: string; headers: Record<string, string> } = { url: '/account', headers: {} }

    await expect(responseRejected({ config: original, response: { status: 401 } })).resolves.toEqual(
      expect.objectContaining({ data: { retried: true } })
    )

    expect(axiosMock.post).toHaveBeenCalledWith(
      'http://localhost:5000/api/auth/refresh',
      {},
      { withCredentials: true, timeout: 20_000 }
    )
    expect(getAccessToken()).toBe('new-token')
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(original.headers.Authorization).toBe('Bearer new-token')
    expect(axiosMock.instance).toHaveBeenCalledWith(original)
  })

  it('refreshes and retries an authenticated streaming fetch exactly once', async () => {
    const { authenticatedFetch, setAccessToken, getAccessToken } = await loadApi()
    setAccessToken('old-token')
    axiosMock.post.mockResolvedValueOnce({ data: { accessToken: 'stream-token' } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    await expect(authenticatedFetch('/forecasts/insights/chat/stream', { method: 'POST' }))
      .resolves.toEqual({ status: 200 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retriedInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(retriedInit.headers).get('Authorization')).toBe('Bearer stream-token')
    expect(getAccessToken()).toBe('stream-token')
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(axiosMock.post).toHaveBeenCalledWith(
      'http://localhost:5000/api/auth/refresh',
      {},
      { withCredentials: true, timeout: 20_000 }
    )
  })

  it('shares one refresh rotation between Axios and streaming requests', async () => {
    const {
      authenticatedFetch,
      responseRejected,
      setAccessToken,
      getAccessToken,
    } = await loadApi()
    setAccessToken('old-token')
    let finishRefresh!: (value: { data: { accessToken: string } }) => void
    axiosMock.post.mockImplementationOnce(() => new Promise((resolve) => {
      finishRefresh = resolve
    }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401 })
      .mockResolvedValueOnce({ status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const streamRetry = authenticatedFetch('/forecasts/insights/chat/stream', { method: 'POST' })
    const axiosRetry = responseRejected({
      config: { url: '/account', headers: {} },
      response: { status: 401 },
    })

    await vi.waitFor(() => expect(axiosMock.post).toHaveBeenCalledTimes(1))
    finishRefresh({ data: { accessToken: 'shared-token' } })
    await expect(Promise.all([streamRetry, axiosRetry])).resolves.toHaveLength(2)

    expect(axiosMock.post).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(axiosMock.instance).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe('shared-token')
  })

  it('times out while waiting for streaming response headers', async () => {
    const { authenticatedFetch } = await loadApi()
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      ))

      const assertion = expect(authenticatedFetch('/forecasts/insights/chat/stream'))
        .rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(20_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the header timeout after a stream connects but preserves caller cancellation', async () => {
    const { authenticatedFetch } = await loadApi()
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn().mockResolvedValue({ status: 200 })
      vi.stubGlobal('fetch', fetchMock)
      const caller = new AbortController()

      await authenticatedFetch('/forecasts/insights/chat/stream', { signal: caller.signal })
      const requestSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal

      await vi.advanceTimersByTimeAsync(20_001)
      expect(requestSignal.aborted).toBe(false)

      caller.abort()
      expect(requestSignal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('lapsed billing', () => {
  it('announces read-only mode for the metering error details shape without redirecting', async () => {
    const { responseRejected } = await loadApi()
    stubLocation('/today')
    const heard = vi.fn()
    window.addEventListener('guava:billing-read-only', heard)
    const error = {
      config: { url: '/insights', headers: {} },
      response: { status: 402, data: { details: {
        code: 'BILLING_REQUIRED', billingStatus: 'grace', readOnly: true,
        periodEnd: '2026-10-01T12:00:00.000Z', graceEndsAt: '2026-10-04T12:00:00.000Z',
      } } },
    }
    try {
      await expect(responseRejected(error)).rejects.toBe(error)
      expect(window.location.href).toBe('http://localhost/today')
      expect(heard).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('guava:billing-read-only', heard) }
  })
  const originalLocation = window.location
  const stubLocation = (pathname: string) => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname, href: `http://localhost${pathname}` },
    })
  }
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('stays on the page and announces read-only mode on a grace-period 402', async () => {
    const { responseRejected } = await loadApi()
    stubLocation('/today')
    const heard = vi.fn()
    window.addEventListener('guava:billing-read-only', heard)
    const error = {
      config: { url: '/cafe/me', headers: {} },
      response: {
        status: 402,
        data: {
          code: 'BILLING_REQUIRED',
          billing: { status: 'grace', readOnly: true, periodEnd: '2026-10-01T12:00:00.000Z', graceEndsAt: '2026-10-04T12:00:00.000Z' },
        },
      },
    }

    await expect(responseRejected(error)).rejects.toBe(error)

    expect(window.location.href).toBe('http://localhost/today')
    expect(heard).toHaveBeenCalledTimes(1)
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({
      periodEnd: '2026-10-01T12:00:00.000Z',
      graceEndsAt: '2026-10-04T12:00:00.000Z',
    })
    window.removeEventListener('guava:billing-read-only', heard)
  })

  it('still sends a fully lapsed organisation to billing', async () => {
    const { responseRejected } = await loadApi()
    stubLocation('/today')
    const error = {
      config: { url: '/cafe/me', headers: {} },
      response: { status: 402, data: { code: 'BILLING_REQUIRED', billing: { status: 'past_due', readOnly: false } } },
    }

    await expect(responseRejected(error)).rejects.toBe(error)

    expect(window.location.href).toBe('/settings?section=billing&billing=required')
  })
})
