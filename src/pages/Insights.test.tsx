import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { AuthContext } from '@/contexts/AuthContext'
import Insights from './Insights'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    authenticatedFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    // Mirrors the real helper: only a refused credential ends the session.
    isSessionRejection: (error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      return status === 401 || status === 403
    },
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      patch: (...args: unknown[]) => mockPatch(...args),
      put: vi.fn(),
      delete: (...args: unknown[]) => mockDelete(...args),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

const CHAT_SCOPE_ID = 'u1:org1:c1'
const CHAT_STORAGE_KEY = `your-guava:insights-chat:v2:${CHAT_SCOPE_ID}`
const CHAT_LIST_STORAGE_KEY = `your-guava:insights-chat-list:v2:${CHAT_SCOPE_ID}`
const testUser = {
  id: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'owner' as const,
  orgId: 'org1',
  cafeIds: ['c1'],
  activeCafeId: 'c1',
}

function render(ui: React.ReactElement, strict = false) {
  return rtlRender(
    <BrowserRouter>
      <AuthContext.Provider value={{
        user: testUser,
        isLoading: false,
        isOwner: true,
        login: vi.fn(),
        logout: vi.fn(),
        register: vi.fn(),
        switchCafe: vi.fn(),
      }}>
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>,
    { reactStrictMode: strict }
  )
}

const contextStats = {
  transactionCount: 12,
  locations: 1,
  topItems: 4,
  forecasts: 3,
}

function chat(overrides: Partial<{
  _id: string
  title: string
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
  archived: boolean
}> = {}) {
  return {
    _id: overrides._id || 'chat-1',
    title: overrides.title || 'Saved chat',
    messages: overrides.messages || [
      { id: 'user-1', role: 'user' as const, content: 'Saved question' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Saved answer' },
    ],
    contextStats,
    archived: overrides.archived ?? false,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  }
}

function storeActiveChat(savedChat: ReturnType<typeof chat>) {
  localStorage.setItem(
    CHAT_STORAGE_KEY,
    JSON.stringify({
      scopeId: CHAT_SCOPE_ID,
      activeChatId: savedChat._id,
      messages: savedChat.messages,
      contextStats: savedChat.contextStats,
    })
  )
  localStorage.setItem(CHAT_LIST_STORAGE_KEY, JSON.stringify({ scopeId: CHAT_SCOPE_ID, chats: [savedChat] }))
}

function mockBaseRequests(chats: Array<ReturnType<typeof chat>> = []) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/cafe/me')) {
      return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    }
    if (url.includes('/cafe/list')) {
      return Promise.resolve({ data: { success: true, cafes: [] } })
    }
    if (url.includes('/insight-chats')) {
      return Promise.resolve({ data: { chats } })
    }
    if (url.includes('/forecasts/insights')) {
      return Promise.reject(new Error('No key'))
    }
    return Promise.resolve({ data: {} })
  })
}

function streamResponse(body: string): Response {
  let delivered = false
  const value = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => {
          if (delivered) return Promise.resolve({ done: true, value: undefined })
          delivered = true
          return Promise.resolve({ done: false, value })
        },
      }),
    },
  } as unknown as Response
}

// The blocking statuses the backend distinguishes: 402 out of credits,
// 403 CREDIT_SPEND_FORBIDDEN, 429 AI_RATE_LIMITED.
function refusedResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Response {
  return {
    ok: false,
    status,
    body: null,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response
}

// Delivers one chunk, then the socket dies mid-answer.
function droppedStreamResponse(chunk: string): Response {
  let delivered = false
  const value = new TextEncoder().encode(chunk)
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => {
          if (delivered) return Promise.reject(new TypeError('network error'))
          delivered = true
          return Promise.resolve({ done: false, value })
        },
      }),
    },
  } as unknown as Response
}

// Delivers one chunk, then hangs until the caller's AbortController fires.
function openStreamResponse(chunk: string) {
  return (_url: string, init: RequestInit = {}) => {
    let delivered = false
    const value = new TextEncoder().encode(chunk)
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (!delivered) {
              delivered = true
              return Promise.resolve({ done: false, value })
            }
            return new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                const abortError = new Error('The operation was aborted.')
                abortError.name = 'AbortError'
                reject(abortError)
              })
            })
          },
        }),
      },
    } as unknown as Response)
  }
}

function deltaEvent(text: string) {
  return `event: delta\ndata: ${JSON.stringify({ text })}\n\n`
}

async function askQuestion(question: string) {
  const input = await screen.findByPlaceholderText(/how can i help/i)
  await userEvent.type(input, question)
  fireEvent.submit(input.closest('form')!)
}

function chatFallbackCalls() {
  return mockPost.mock.calls.filter((call) => call[0] === '/forecasts/insights/chat')
}

// The failure headline is also announced in the sr-only status region, so
// assertions about what is drawn in the transcript are scoped to the bubble.
function answerBubble() {
  const rows = document.querySelectorAll('[data-message-role="assistant"]')
  return rows[rows.length - 1] as HTMLElement
}

describe('Insights', () => {
  it('says a stopped answer that had started was charged and can be seen again for free', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockImplementation(openStreamResponse(deltaEvent('Half of an answer')) as typeof fetch)
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: 'chat-charged-stop', messages: [] }) } })
        : Promise.resolve({ data: {} })
    )

    render(<Insights />, true)
    await askQuestion('Give me a long answer')
    await userEvent.click(await screen.findByRole('button', { name: /stop/i }))

    await waitFor(() =>
      expect(within(answerBubble()).getByText(/it was charged \(3 credits\)/i)).toBeInTheDocument()
    )
    expect(chatFallbackCalls()).toHaveLength(0)
    // Typing the question again would send a different conversation (it now contains the stopped turn), so the
    // server's request fingerprint would not match the key. The button resends the identical turn with the same key.
    const firstKey = ((vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']
    await userEvent.click(within(answerBubble()).getByRole('button', { name: /load the full answer \(no extra charge\)/i }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1))
    const secondKey = ((vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']
    expect(secondKey).toBe(firstKey)
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body)).messages).toEqual([
      { role: 'user', content: 'Give me a long answer' },
    ])
  })

  it('says nothing was charged when an answer is stopped before it starts', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockImplementation(openStreamResponse(': keep-alive\n\n') as typeof fetch)
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: 'chat-free-stop', messages: [] }) } })
        : Promise.resolve({ data: {} })
    )

    render(<Insights />)
    await askQuestion('Stop me early')
    await userEvent.click(await screen.findByRole('button', { name: /stop/i }))

    await waitFor(() =>
      expect(within(answerBubble()).getByText(/stopped before the answer started\. nothing was charged/i)).toBeInTheDocument()
    )
  })

  it('reports a charged provider interruption without a paid fallback and asks with a new key next time', async () => {
    mockBaseRequests()
    const body = deltaEvent('Partial answer') + 'event: error\ndata: ' + JSON.stringify({
      code: 'AI_STREAM_INTERRUPTED',
      charged: true,
      credits: 3,
      message: 'The AI service stopped this answer part-way. It had started, so it was charged.',
    }) + '\n\n'
    vi.mocked(fetch).mockResolvedValue(streamResponse(body))
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: 'chat-interrupted', messages: [] }) } })
        : Promise.resolve({ data: {} })
    )

    render(<Insights />)
    await askQuestion('Interrupt me')

    await screen.findAllByText(/stopped this answer part-way/i)
    expect(chatFallbackCalls()).toHaveLength(0)
    const firstKey = ((vi.mocked(fetch).mock.calls[0][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']
    await userEvent.click(await screen.findByRole('button', { name: /ask again \(3 credits\)/i }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1))
    const secondKey = ((vi.mocked(fetch).mock.calls[1][1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']
    expect(secondKey).not.toBe(firstKey)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, body: null }))
  })

  it('renders insight cards from the API', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: {
            insights: [
              'Flat White sales spike 34% on payday Fridays.',
              'Croissant sales dropped 18% over the last 3 Sundays.',
              'Morning rush generates 36% of your daily revenue.',
              'Cold Brew sales are trending up 22% month-on-month.',
            ],
            generatedAt: new Date().toISOString(),
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)

    await waitFor(() => {
      expect(screen.getByText(/flat white sales spike/i)).toBeInTheDocument()
    })

    expect(screen.getByText(/croissant sales dropped/i)).toBeInTheDocument()
    expect(screen.getByText(/morning rush generates/i)).toBeInTheDocument()
    expect(screen.getByText(/cold brew sales are trending/i)).toBeInTheDocument()
  })

  it('shows an honest error state instead of fabricated insights when the API fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('No key'))
    })

    render(<Insights />)

    await waitFor(() => {
      expect(screen.getByText(/insights are unavailable right now/i)).toBeInTheDocument()
    })

    expect(screen.queryByText(/flat white sales spike/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows loading skeleton', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))

    render(<Insights />)

    const skeletons = document.querySelectorAll('[class*="skeleton-shimmer"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows the metered refresh cost', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.reject(new Error('No key'))
    })

    render(<Insights />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh \(10 credits\)/i })).toBeInTheDocument()
    })
  })

  it('uses the read-only endpoint on load without spending credits', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: {
            success: true,
            insights: [],
            generatedAt: null,
            requiresRefresh: true,
            cacheStatus: 'empty',
          },
        })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)

    expect(await screen.findByText('No generated insights yet')).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/forecasts/insights')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('refreshes through the metered POST and reuses its idempotency key on retry', async () => {
    const generatedAt = '2026-07-30T08:00:00.000Z'
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: {
            success: true,
            insights: ['Saved analysis'],
            generatedAt,
            requiresRefresh: true,
            cacheStatus: 'stale',
          },
        })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })
    mockPost
      .mockRejectedValueOnce(new Error('network interrupted'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          insights: ['Refreshed analysis'],
          generatedAt,
          requiresRefresh: false,
          guavaCredits: { available: 90 },
          aiCredits: { available: 90 },
          meta: { replayed: true, coalesced: false },
        },
      })

    render(<Insights />)

    await userEvent.click(await screen.findByRole('button', { name: /refresh \(10 credits\)/i }))
    expect(await screen.findByText(/could not refresh insights/i)).toBeInTheDocument()

    const firstConfig = mockPost.mock.calls[0][2] as { headers: { 'Idempotency-Key': string } }
    const firstKey = firstConfig.headers['Idempotency-Key']
    expect(firstKey).toBeTruthy()
    expect(firstKey.length).toBeLessThanOrEqual(160)

    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }))

    expect(await screen.findByText('Refreshed analysis')).toBeInTheDocument()
    expect(mockPost).toHaveBeenCalledTimes(2)
    expect(mockPost.mock.calls[0][0]).toBe('/forecasts/insights/refresh')
    expect(mockPost.mock.calls[0][1]).toEqual({})
    expect(mockPost.mock.calls[1][2].headers['Idempotency-Key']).toBe(firstKey)
  })

  it('restores saved chat messages', async () => {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        scopeId: CHAT_SCOPE_ID,
        messages: [
          { id: 'user-saved', role: 'user', content: 'Saved question' },
          { id: 'assistant-saved', role: 'assistant', content: '# Saved answer\n\n**Bold result**' },
        ],
      })
    )
    mockGet.mockRejectedValue(new Error('No key'))

    render(<Insights />)

    await waitFor(() => {
      expect(screen.getByText('Saved question')).toBeInTheDocument()
    })

    expect(screen.getByText('Saved answer')).toBeInTheDocument()
    expect(screen.getByText('Bold result')).toBeInTheDocument()
  })

  it('opens a restored chat at the latest message', async () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })

    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        scopeId: CHAT_SCOPE_ID,
        activeChatId: 'saved-chat',
        messages: [
          { id: 'user-saved-1', role: 'user', content: 'First saved question' },
          { id: 'assistant-saved-1', role: 'assistant', content: 'First saved answer' },
          { id: 'user-saved-2', role: 'user', content: 'Latest saved question' },
          { id: 'assistant-saved-2', role: 'assistant', content: 'Latest saved answer' },
        ],
        contextStats,
      })
    )
    mockBaseRequests()

    render(<Insights />)

    expect(await screen.findByText('Latest saved answer')).toBeInTheDocument()
    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
    })
  })

  it('sends the first prompt in a fresh chat and renders the assistant response', async () => {
    mockBaseRequests()
    mockPost.mockImplementation((url: string, payload: { title?: string; messages?: unknown[] }) => {
      if (url === '/insight-chats') {
        return Promise.resolve({
          data: {
            chat: chat({
              _id: 'chat-first',
              title: payload.title || 'First chat',
              messages: payload.messages as ReturnType<typeof chat>['messages'],
            }),
          },
        })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.resolve({
          data: {
            answer: 'You sold the most flat whites this week.',
            contextStats,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    mockPatch.mockImplementation((url: string, payload: { title?: string; messages?: unknown[] }) =>
      Promise.resolve({
        data: {
          chat: chat({
            _id: url.split('/').pop() || 'chat-first',
            title: payload.title || 'First chat',
            messages: payload.messages as ReturnType<typeof chat>['messages'],
          }),
        },
      })
    )

    render(<Insights />)

    const input = await screen.findByPlaceholderText(/how can i help/i)
    await userEvent.type(input, 'What are my best sellers?')
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/forecasts/insights/chat',
        {
          chatId: 'chat-first',
          messages: [{ role: 'user', content: 'What are my best sellers?' }],
        },
        {
          headers: { 'Idempotency-Key': expect.stringMatching(/^ask-guava-/) },
          timeout: 90_000,
        }
      )
    })
    const userPrompt = screen
      .getAllByText('What are my best sellers?')
      .find((element) => element.closest('[data-message-role="user"]'))
    expect(userPrompt?.closest('[data-message-role="user"]')).toBeInTheDocument()

    const assistantReply = await screen.findByText(/flat whites/i)
    expect(assistantReply.closest('[data-message-role="assistant"]')).toBeInTheDocument()
  })

  it('recovers a partial stream with the same idempotency key and full answer', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse(
      'event: delta\ndata: ' + JSON.stringify({ text: 'Partial answer' }) + '\n\n'
    ))
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-partial', messages: [] }) } })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.resolve({
          data: {
            answer: 'Complete recovered answer',
            contextStats,
            guavaCredits: { available: 97 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    render(<Insights />)
    const input = await screen.findByPlaceholderText(/how can i help/i)
    await userEvent.type(input, 'Interrupt this answer')
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText(/complete recovered answer/i)).toBeInTheDocument()

    const streamInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const streamHeaders = streamInit.headers as Record<string, string>
    expect(mockPost).toHaveBeenCalledWith(
      '/forecasts/insights/chat',
      {
        chatId: 'chat-partial',
        messages: [{ role: 'user', content: 'Interrupt this answer' }],
      },
      { headers: { 'Idempotency-Key': streamHeaders['Idempotency-Key'] }, timeout: 90_000 }
    )
    expect(screen.queryByText(/stream stopped before it finished/i)).not.toBeInTheDocument()
  })

  it('recovers partial output followed by an SSE error event', async () => {
    mockBaseRequests()
    const body = 'event: delta\ndata: ' + JSON.stringify({ text: 'Partial error answer' })
      + '\n\nevent: error\ndata: ' + JSON.stringify({ message: 'Provider failed' }) + '\n\n'
    vi.mocked(fetch).mockResolvedValue(streamResponse(body))
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-error', messages: [] }) } })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.resolve({
          data: {
            answer: 'Full answer after provider retry',
            contextStats,
            guavaCredits: { available: 94 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    render(<Insights />)
    const input = await screen.findByPlaceholderText(/how can i help/i)
    await userEvent.type(input, 'Fail this stream')
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText(/full answer after provider retry/i)).toBeInTheDocument()
    expect(screen.queryByText(/partial error answer/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/stream stopped before it finished/i)).not.toBeInTheDocument()
  })

  it('starts a blank thread when New is clicked instead of reselecting the previous chat', async () => {
    const savedChat = chat({
      _id: 'local-old',
      title: 'Old thread',
      messages: [
        { id: 'user-old', role: 'user', content: 'Message from the previous thread' },
        { id: 'assistant-old', role: 'assistant', content: 'Previous answer' },
      ],
    })
    storeActiveChat(savedChat)
    mockBaseRequests([savedChat])

    render(<Insights />)

    expect(await screen.findByText('Message from the previous thread')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }))

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/write a message/i)).not.toBeInTheDocument()
    })
    expect(screen.getByText('Ask your business data')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/how can i help/i)).toBeInTheDocument()
  })

  it('deletes chats through an in-app dialog and clears the active conversation', async () => {
    const savedChat = chat({
      _id: 'chat-delete',
      title: 'what are my best sellers??',
      messages: [
        { id: 'user-delete', role: 'user', content: 'Delete this active conversation' },
        { id: 'assistant-delete', role: 'assistant', content: 'It is safe to remove.' },
      ],
    })
    storeActiveChat(savedChat)
    mockBaseRequests([savedChat])
    mockDelete.mockResolvedValue({ data: { success: true } })
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true)

    render(<Insights />)

    expect(await screen.findByText('Delete this active conversation')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /delete chat/i }))

    const dialog = screen.getByRole('dialog', { name: /delete chat/i })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(within(dialog).getByText(/this cannot be undone/i)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/insight-chats/chat-delete')
      expect(screen.queryByText('Delete this active conversation')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/deleted "what are my best sellers\?\?"/i)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('sends an out-of-credits refusal to Buy Credits instead of asking for a retry', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(
      refusedResponse(402, {
        success: false,
        message: 'Guava credit limit reached for this billing period',
        details: { available: 1, required: 3 },
      })
    )
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-402', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('What should I prep tomorrow?')

    await screen.findAllByText(/you are out of guava credits/i)
    expect(within(answerBubble()).getByText(/you are out of guava credits/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /buy guava credits/i })).toHaveAttribute(
      'href',
      '/settings?section=billing'
    )
    expect(screen.queryByText(/try again in a moment/i)).not.toBeInTheDocument()
    // A refusal cannot succeed on retry, so it must not spend a second reservation.
    expect(chatFallbackCalls()).toHaveLength(0)
  })

  it('names the missing permission when the owner has not enabled credit spending', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(
      refusedResponse(403, {
        success: false,
        code: 'CREDIT_SPEND_FORBIDDEN',
        message: 'The account owner has not enabled Guava Credit spending for this member',
      })
    )
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-403', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Which items are slowing down?')

    await screen.findAllByText(/cannot spend guava credits/i)
    const notice = within(answerBubble())
    expect(notice.getByText(/cannot spend guava credits/i)).toBeInTheDocument()
    expect(notice.getByText(/account owner has not enabled credit spending/i)).toBeInTheDocument()
    expect(chatFallbackCalls()).toHaveLength(0)
  })

  it('holds the composer closed for the rate-limit window instead of inviting a retry', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(
      refusedResponse(
        429,
        { success: false, code: 'AI_RATE_LIMITED', message: 'Too many AI requests.' },
        { 'retry-after': '45' }
      )
    )
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-429', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Busiest hours please')

    await screen.findAllByText(/too many ai requests/i)
    expect(within(answerBubble()).getByText(/wait 45 seconds/i)).toBeInTheDocument()
    // Firing the fallback would burn another rate-limit token and guarantee failure.
    expect(chatFallbackCalls()).toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rate limited/i })).toBeDisabled()
    })
  })

  it('keeps the partial answer when the connection drops mid-stream', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(droppedStreamResponse(deltaEvent('Your Friday mornings are the busiest window')))
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-drop', messages: [] }) } })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.reject(new TypeError('Network Error'))
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('When am I busiest?')

    await screen.findAllByText(/could not reach the ai analyst/i)
    // The paid partial must survive the failure notice, not be replaced by it.
    await waitFor(() =>
      expect(within(answerBubble()).getByText(/your friday mornings are the busiest window/i)).toBeInTheDocument()
    )
  })

  it('offers a Stop control that keeps the partial answer and skips the paid fallback', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockImplementation(openStreamResponse(deltaEvent('Half of an answer')) as typeof fetch)
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-stop', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Give me a long answer')

    const stop = await screen.findByRole('button', { name: /stop/i })
    await userEvent.click(stop)

    await waitFor(() => expect(within(answerBubble()).getByText(/^stopped\./i)).toBeInTheDocument())
    await waitFor(() =>
      expect(within(answerBubble()).getByText(/half of an answer/i)).toBeInTheDocument()
    )
    expect(chatFallbackCalls()).toHaveLength(0)
  })

  it('does not issue a paid fallback after the user has navigated away', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockImplementation(openStreamResponse(deltaEvent('Answer in progress')) as typeof fetch)
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-unmount', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    const view = render(<Insights />)
    await askQuestion('Start an answer I will abandon')
    await screen.findByText(/answer in progress/i)

    view.unmount()
    await waitFor(() => {
      expect(chatFallbackCalls()).toHaveLength(0)
    })
  })

  it('gives the fallback the same 90s budget as the stream so a slow model is not billed for nothing', async () => {
    mockBaseRequests()
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-timeout', messages: [] }) } })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.resolve({ data: { answer: 'Recovered', contextStats } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Slow question')

    await waitFor(() => expect(chatFallbackCalls()).toHaveLength(1))
    expect(chatFallbackCalls()[0][2]).toEqual(
      expect.objectContaining({ timeout: 90_000 })
    )
  })

  it('reuses the idempotency key when the user retries the same question', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(droppedStreamResponse(deltaEvent('Partial')))
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-key', messages: [] }) } })
      }
      if (url === '/forecasts/insights/chat') {
        return Promise.reject(new TypeError('Network Error'))
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Repeatable question')

    const retry = await screen.findByRole('button', { name: /load the full answer \(no extra charge\)/i })
    const firstKey = (vi.mocked(fetch).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>
    await userEvent.click(retry)

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1))
    const secondKey = (vi.mocked(fetch).mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>
    expect(secondKey['Idempotency-Key']).toBe(firstKey['Idempotency-Key'])
  })

  it('says the answer was empty instead of sitting on Thinking forever', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(
      streamResponse('event: done\ndata: ' + JSON.stringify({ contextStats }) + '\n\n')
    )
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-empty', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('Ask for nothing')

    expect(await screen.findByText(/could not generate an answer/i)).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument()
  })

  it('renders hostile item names from the model as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>Latte'
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        deltaEvent(`Your top seller is ${hostile}.`) +
          'event: done\ndata: ' + JSON.stringify({ contextStats }) + '\n\n'
      )
    )
    mockPost.mockImplementation((url: string) => {
      if (url === '/insight-chats') {
        return Promise.resolve({ data: { chat: chat({ _id: 'chat-xss', messages: [] }) } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)
    await askQuestion('What is my top seller?')

    const answer = await screen.findByText(new RegExp(hostile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(answer).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('keeps blank cells in a markdown table so values stay under their heading', async () => {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        scopeId: CHAT_SCOPE_ID,
        messages: [
          { id: 'user-table', role: 'user', content: 'Compare last week' },
          {
            id: 'assistant-table',
            role: 'assistant',
            content: '| Item | Qty | Revenue |\n| --- | --- | --- |\n| Croissant |  | R412 |',
          },
        ],
      })
    )
    mockBaseRequests()

    render(<Insights />)

    const revenueCell = await screen.findByText('R412')
    const row = revenueCell.parentElement!
    // Three headings, so the body row must still lay out in three columns.
    expect(row.style.gridTemplateColumns).toContain('repeat(3')
    expect(row.children).toHaveLength(3)
  })

  it('does not label insights with a category invented from their position', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: {
            insights: ['First insight', 'Second insight', 'Third insight', 'Fourth insight'],
            generatedAt: new Date().toISOString(),
          },
        })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })

    render(<Insights />)

    expect(await screen.findByText('Second insight')).toBeInTheDocument()
    expect(screen.queryByText('Watch')).not.toBeInTheDocument()
    expect(screen.queryByText('Tip')).not.toBeInTheDocument()
    expect(screen.queryByText('Highlight')).not.toBeInTheDocument()
  })

  it('gives the composer a real label and drops the inert Add context control', async () => {
    mockBaseRequests()

    render(<Insights />)

    expect(await screen.findByRole('textbox', { name: /ask a question about your cafe data/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add context/i })).not.toBeInTheDocument()
  })

  it('exposes the transcript as a keyboard-reachable log with a status announcer', async () => {
    const savedChat = chat({ _id: 'chat-log' })
    storeActiveChat(savedChat)
    mockBaseRequests([savedChat])

    render(<Insights />)

    const log = await screen.findByRole('log', { name: /conversation/i })
    expect(log).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('names the chat in every row action so destructive buttons are distinguishable', async () => {
    const savedChat = chat({ _id: 'chat-labels', title: 'Weekend prep' })
    mockBaseRequests([savedChat])

    render(<Insights />)

    expect(await screen.findByRole('button', { name: /delete chat "weekend prep"/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rename chat "weekend prep"/i })).toBeInTheDocument()
  })

  it('reads older timestamps in days rather than hundreds of hours', async () => {
    const savedChat = chat({ _id: 'chat-old', title: 'Old thread' })
    savedChat.updatedAt = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()
    mockBaseRequests([savedChat])

    render(<Insights />)

    expect(await screen.findByText('Old thread')).toBeInTheDocument()
    expect(screen.queryByText(/\d{3,} hours ago/)).not.toBeInTheDocument()
  })

  it('keeps the server chat when a save fails instead of forking a local copy', async () => {
    const savedChat = chat({ _id: 'chat-fork', title: 'Server thread' })
    mockBaseRequests([savedChat])
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        deltaEvent('Fresh answer') + 'event: done\ndata: ' + JSON.stringify({ contextStats }) + '\n\n'
      )
    )
    mockPost.mockResolvedValue({ data: {} })
    mockPatch.mockRejectedValue(new Error('PATCH failed'))

    render(<Insights />)
    expect(await screen.findByText('Server thread')).toBeInTheDocument()

    const composer = await screen.findByPlaceholderText(/write a message/i)
    await userEvent.type(composer, 'Another question')
    fireEvent.submit(composer.closest('form')!)

    expect(await screen.findByText(/fresh answer/i)).toBeInTheDocument()
    await waitFor(() => expect(mockPatch).toHaveBeenCalled())
    // One conversation, not a server row plus a divergent local clone.
    expect(screen.getAllByText('Server thread')).toHaveLength(1)
  })

  it('renames chats through the in-app dialog', async () => {
    const savedChat = chat({ _id: 'chat-rename', title: 'Untitled history' })
    mockBaseRequests([savedChat])
    mockPatch.mockResolvedValue({
      data: {
        chat: {
          ...savedChat,
          title: 'Best sellers review',
          updatedAt: '2026-05-02T10:00:00.000Z',
        },
      },
    })

    render(<Insights />)

    expect(await screen.findByText('Untitled history')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /rename chat/i }))

    const dialog = screen.getByRole('dialog', { name: /rename chat/i })
    const input = within(dialog).getByRole('textbox')
    await userEvent.clear(input)
    await userEvent.type(input, 'Best sellers review')
    await userEvent.click(within(dialog).getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/insight-chats/chat-rename', { title: 'Best sellers review' })
      expect(screen.getByText('Best sellers review')).toBeInTheDocument()
    })
  })
})
