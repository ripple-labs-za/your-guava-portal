import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
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
  const input = await screen.findByPlaceholderText(/how can i help|write a message/i)
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
  it('sends only the trailing user-anchored window for a long chat', async () => {
    const saved = chat({ messages: Array.from({ length: 14 }, (_, index) => ({
      id: `long-${index}`, role: index % 2 === 0 ? 'user' : 'assistant', content: `Message ${index}`,
    })) })
    storeActiveChat(saved)
    mockBaseRequests([saved])
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Fine.') + 'event: done\ndata: {"contextStats":null}\n\n'))
    mockPatch.mockResolvedValue({ data: { chat: saved } })
    render(<Insights />)
    await askQuestion('Question 15')
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toHaveLength(9)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Question 15' })
  })

  it('explains a named 413 while keeping the long chat on this device', async () => {
    const saved = chat()
    storeActiveChat(saved)
    mockBaseRequests([saved])
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Fine.') + 'event: done\ndata: {"contextStats":null}\n\n'))
    mockPatch.mockRejectedValue({ response: { status: 413, data: { details: { code: 'PAYLOAD_TOO_LARGE' } } } })
    render(<Insights />)
    await askQuestion('One more')
    expect(await screen.findByText(/too long to save to your account/i)).toBeInTheDocument()
  })
  it('keeps loaded analysis when a no-data refresh returns and announces the outcome once', async () => {
    mockBaseRequests()
    mockGet.mockImplementation((url: string) => url.includes('/forecasts/insights')
      ? Promise.resolve({ data: { insights: ['Keep this analysis'], generatedAt: new Date().toISOString(), cacheStatus: 'fresh' } })
      : Promise.resolve({ data: { chats: [] } }))
    mockPost.mockResolvedValue({ data: { cacheStatus: 'insufficient_data', insufficientData: true, insights: ['No completed sales.'] } })
    render(<Insights />)
    await screen.findByText('Keep this analysis')
    const region = screen.getByRole('status', { name: 'Analysis status' })
    await userEvent.click(screen.getByRole('button', { name: /refresh \(10 credits\)/i }))
    await within(region).findByText(/no credits were used/i)
    expect(screen.getByText('Keep this analysis')).toBeVisible()
    expect(screen.queryByRole('heading', { name: /nothing to analyse/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Analysis status' })).toBe(region)
    expect(screen.getByText('Covers the 14 completed days before today')).toBeVisible()
  })

  it('creates an account chat with only the newest eighty messages from a device transcript', async () => {
    const messages = Array.from({ length: 80 }, (_, index) => ({
      id: `device-${index}`, role: index % 2 === 0 ? 'user' : 'assistant', content: `Message ${index}`,
    }))
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ scopeId: CHAT_SCOPE_ID, activeChatId: null, messages }))
    mockBaseRequests()
    mockPost.mockResolvedValue({ data: { chat: chat({ messages: [] }) } })
    mockPatch.mockResolvedValue({ data: { chat: chat({ messages: [] }) } })
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Fine.') + 'event: done\ndata: {"contextStats":null}\n\n'))
    render(<Insights />)
    await askQuestion('Newest device question')
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/insight-chats', expect.anything()))
    const payload = mockPost.mock.calls.find((call) => call[0] === '/insight-chats')?.[1]
    expect(payload.messages).toHaveLength(80)
    expect(payload.messages[0]).toEqual({ role: 'assistant', content: 'Message 1' })
    expect(payload.messages.at(-1)).toEqual({ role: 'user', content: 'Newest device question' })
  })
  it.each([false, true])('keeps an explicit unknown charge after fallback failure with delivered=%s', async (delivered) => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse((delivered ? deltaEvent('Some answer') : '')
      + 'event: error\ndata: ' + JSON.stringify({ charged: null, retryable: true }) + '\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'unknown-fallback', messages: [] }) } })
      : Promise.reject({ response: { status: 503 } }))
    render(<Insights />)
    await askQuestion('Keep the charge unknown')
    await within(answerBubble()).findByText('Charge not confirmed')
    expect(screen.getByRole('status', { name: 'Chat status' })).not.toHaveTextContent(/it was charged|nothing was charged/i)
  })
  it('announces a refunded timeout using the server message when recovery fails', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: error\ndata: ' + JSON.stringify({
      code: 'AI_PROVIDER_TIMEOUT', retryable: true, charged: false,
      message: 'The AI service took too long to answer. Nothing was charged. Try again.',
    }) + '\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'timeout-refund', messages: [] }) } })
      : Promise.reject({ response: { status: 504, data: { details: { retryable: true } } } }))
    render(<Insights />)
    await askQuestion('Timeout question')
    await within(answerBubble()).findByText(/nothing was charged/i)
    expect(screen.getByRole('status', { name: 'Chat status' })).toHaveTextContent(/nothing was charged/i)
  })
  it('does not use a paid fallback when an unfixable stream failure has an unknown charge', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: error\ndata: ' + JSON.stringify({
      code: 'AI_PROVIDER_AUTH_FAILED', retryable: false, charged: null,
    }) + '\n\n'))
    mockPost.mockResolvedValue({ data: { chat: chat({ _id: 'unknown-auth', messages: [] }) } })
    render(<Insights />)
    await askQuestion('Unknown charge question')
    await within(answerBubble()).findByText('Charge not confirmed')
    expect(chatFallbackCalls()).toHaveLength(0)
    expect(within(answerBubble()).queryByRole('button', { name: /try again|load the full answer/i })).not.toBeInTheDocument()
  })
  it('shows the saved-chat 429 wait instead of silently creating a local chat', async () => {
    mockBaseRequests()
    mockPost.mockRejectedValue({ response: { status: 429, data: { code: 'CHAT_RATE_LIMITED' }, headers: { 'retry-after': '17' } } })
    render(<Insights />)
    await askQuestion('Wait for the saved chat')
    await screen.findByText(/saved chats.*17 seconds/i)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
    expect(localStorage.getItem(CHAT_LIST_STORAGE_KEY) || '').not.toContain('local-')
  })
  it('uses the saved-chat Retry-After in the notice and bubble and unlocks after 17 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    try {
      mockBaseRequests()
      mockPost.mockRejectedValue({ response: { status: 429, data: { code: 'CHAT_RATE_LIMITED' }, headers: { 'retry-after': '17' } } })
      render(<Insights />)
      await askQuestion('Wait for this saved chat')

      await screen.findByText(/saved chats.*17 seconds/i)
      expect(within(answerBubble()).getByText(/wait 17 seconds/i)).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: /rate limited.*17 seconds/i })).toBeDisabled())
      expect(vi.mocked(fetch)).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(16_000) })
      expect(screen.getByRole('button', { name: /rate limited.*1 seconds/i })).toBeDisabled()
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      const input = screen.getByRole('textbox', { name: /ask a question about your cafe data/i })
      await userEvent.type(input, 'Try after the wait')
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps the same idempotency key when a charged fallback returns 401 and the free replay is requested', async () => {
    mockBaseRequests()
    vi.mocked(fetch)
      .mockResolvedValueOnce(droppedStreamResponse(deltaEvent('Delivered text')))
      .mockResolvedValueOnce(streamResponse(deltaEvent('Full answer') + 'event: done\ndata: {}\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'charged-401', messages: [] }) } })
      : Promise.reject({ response: { status: 401 } }))
    render(<Insights />)
    await askQuestion('Keep my paid answer')
    const replay = await within(answerBubble()).findByRole('button', { name: /load the full answer \(no extra charge\)/i })
    const first = (vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key']
    await userEvent.click(replay)
    await waitFor(() => expect(vi.mocked(fetch).mock.calls).toHaveLength(2))
    const second = (vi.mocked(fetch).mock.calls[1][1]?.headers as Record<string, string>)['Idempotency-Key']
    expect(second).toBe(first)
  })

  it('does not re-bill a request the AI service rejected as unfixable', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: error\ndata: ' + JSON.stringify({
      code: 'AI_PROVIDER_AUTH_FAILED', retryable: false, charged: false, credits: 0,
      message: "Guava's AI service is not accepting our credentials, so this will not work until we fix it. No credits were charged, and the problem has been logged.",
    }) + '\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'chat-auth', messages: [] }) } })
      : Promise.resolve({ data: {} }))
    render(<Insights />)
    await askQuestion('Anything today?')
    await screen.findAllByText(/not accepting our credentials/i)
    expect(chatFallbackCalls()).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /try again \(3 credits\)/i })).not.toBeInTheDocument()
  })

  it('renders the interruption marker stored with a saved partial answer', async () => {
    const saved = chat({ messages: [
      { id: 'question', role: 'user', content: 'What should I stock?' },
      { id: 'partial', role: 'assistant', content: 'Stock more milk.\n\nThe AI service stopped this answer part-way.' },
    ] })
    storeActiveChat(saved)
    mockBaseRequests([saved])
    render(<Insights />)
    expect(await screen.findByText('The AI service stopped this answer part-way.')).toBeVisible()
    expect(within(answerBubble()).getByText('Stock more milk.')).toBeVisible()
  })

  it('does not PATCH a stopped partial over the complete answer stored by the server', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockImplementationOnce(openStreamResponse(deltaEvent('Partial answer')) as typeof fetch)
    mockPost.mockResolvedValue({ data: { chat: chat({ _id: 'preserved-chat', messages: [] }) } })
    render(<Insights />)
    await askQuestion('First question')
    await userEvent.click(await screen.findByRole('button', { name: /stop generating/i }))
    await within(answerBubble()).findByText(/it was charged/i)
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Follow-up answer') + 'event: done\ndata: {}\n\n'))
    const followUp = await screen.findByPlaceholderText(/write a message/i)
    await userEvent.type(followUp, 'First question')
    fireEvent.submit(followUp.closest('form')!)
    await screen.findByText('Follow-up answer')
    await screen.findByText('Guava has finished this answer.')
    const keys = vi.mocked(fetch).mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key'])
    expect(keys[1]).not.toBe(keys[0])
    expect(mockPatch.mock.calls.filter(([url, body]) => url === '/insight-chats/preserved-chat' && body.messages)).toHaveLength(0)
  })

  it.each([false, undefined, null])('handles the server charge field %s without inventing a charge', async (charged) => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse('event: error\ndata: ' + JSON.stringify({ charged }) + '\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'charge-field-chat', messages: [] }) } })
      : Promise.reject(new Error('connection failed')))
    render(<Insights />)
    await askQuestion('Check charge status')
    await within(answerBubble()).findByText(charged === false ? /nothing came back from the server/i : /charge not confirmed/i)
    expect(within(answerBubble()).queryByText(/it was charged/i)).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Chat status' })).not.toHaveTextContent(/nothing was charged/i)
  })

  it('announces the server charge amount with the interrupted answer', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Partial') + 'event: error\ndata: ' + JSON.stringify({
      charged: true, credits: 7, message: 'Provider stopped',
    }) + '\n\n'))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'amount-chat', messages: [] }) } })
      : Promise.resolve({ data: {} }))
    render(<Insights />)
    await askQuestion('Amount check')
    await screen.findAllByText(/charged \(7 credits\)/i)
    expect(screen.getByRole('status', { name: 'Chat status' }).textContent).toMatch(/charged \(7 credits\)/i)
  })

  it('names a lost location instead of blaming credit permission', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(403, {
      success: false,
      message: 'Cafe access is no longer available',
      details: { code: 'CAFE_ACCESS_REVOKED' },
    }))
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: 'chat-cafe-403', messages: [] }) } })
        : Promise.resolve({ data: {} })
    )

    render(<Insights />)
    await askQuestion('How is this location doing?')

    await screen.findAllByText(/no longer have access to this location/i)
    expect(screen.queryByText(/cannot spend guava credits/i)).not.toBeInTheDocument()
    expect(chatFallbackCalls()).toHaveLength(0)
  })

  it('says a malformed question was refused before anything was charged', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(400, {
      success: false,
      message: 'A chat request needs at least one question, and must end on it',
      details: { code: 'AI_CHAT_INVALID_INPUT' },
    }))
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: 'chat-400', messages: [] }) } })
        : Promise.resolve({ data: {} })
    )

    render(<Insights />)
    await askQuestion('Anything')

    await screen.findAllByText(/this question could not be sent/i)
    expect(within(answerBubble()).getByText(/nothing was charged/i)).toBeInTheDocument()
    expect(chatFallbackCalls()).toHaveLength(0)
  })

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
      expect(within(answerBubble()).getByText(/no answer text had arrived/i)).toBeInTheDocument()
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

    await screen.findAllByText(/answer interrupted/i)
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

  it('shows the next answer context counts before the first question', async () => {
    mockBaseRequests()
    const base = mockGet.getMockImplementation()
    mockGet.mockImplementation((url: string, ...args: unknown[]) => url === '/forecasts/insights/context'
      ? Promise.resolve({ data: { contextStats: { transactionCount: 5936, locations: 2, forecasts: 7, contextWindow: 'Last 90 days' } } })
      : base?.(url, ...args))
    render(<Insights />)
    expect(await screen.findByText(/5\s936/)).toBeInTheDocument()
    expect(screen.getByText('Locations').parentElement).toHaveTextContent('2')
    expect(screen.getByText('Forecasts').parentElement).toHaveTextContent('7')
  })

  it('labels unavailable context counts instead of implying that no data exists', async () => {
    mockBaseRequests()
    const base = mockGet.getMockImplementation()
    mockGet.mockImplementation((url: string, ...args: unknown[]) => url === '/forecasts/insights/context'
      ? Promise.reject(new Error('Network Error')) : base?.(url, ...args))
    render(<Insights />)
    expect(await screen.findByTitle(/counts unavailable/i)).toBeInTheDocument()
  })

  it('releases the composer after a completed stream and accepts the next question', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(streamResponse(
      deltaEvent('A completed answer.') + 'event: done\ndata: ' + JSON.stringify({ contextStats }) + '\n\n'
    ))
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? Promise.resolve({ data: { chat: chat({ _id: 'chat-completed', messages: [] }) } })
      : Promise.resolve({ data: {} }))
    render(<Insights />)
    await askQuestion('First question')
    expect(await screen.findByText('A completed answer.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument())
    const composer = screen.getByPlaceholderText(/write a message|how can i help/i)
    expect(composer).toBeEnabled()
    fireEvent.change(composer, { target: { value: 'Second question' } })
    fireEvent.submit(composer.closest('form')!)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
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
    expect(screen.getByRole('status', { name: 'Chat status' })).toBeInTheDocument()
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
  it('shows the no-data answer from a refresh as a notice, not as a fresh insight', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: { success: true, insights: [], generatedAt: null, requiresRefresh: true, cacheStatus: 'empty' },
        })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })
    const sentence = 'There are no approved sales in the 14 completed days before today, so there is nothing to analyse yet. Upload or sync your sales and refresh again — no Guava Credits were used.'
    mockPost.mockResolvedValue({
      data: {
        success: true, insights: [sentence], generatedAt: new Date().toISOString(),
        requiresRefresh: true, cacheStatus: 'insufficient_data', insufficientData: true,
      },
    })

    render(<Insights />)
    await userEvent.click(await screen.findByRole('button', { name: /generate \(10 credits\)/i }))

    expect(await screen.findByRole('heading', { name: /nothing to analyse yet/i })).toBeInTheDocument()
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText(/^Updated\b/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /upload sales data/i })).toBeInTheDocument()
  })

  it('keeps a replayed pre-import analysis marked as out of date', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/forecasts/insights')) {
        return Promise.resolve({
          data: { success: true, insights: ['Older analysis'], generatedAt: '2026-09-28T06:00:00.000Z', requiresRefresh: true, cacheStatus: 'stale' },
        })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })
    mockPost.mockResolvedValue({
      data: {
        success: true, insights: ['Before the import.'], generatedAt: '2026-09-28T07:00:00.000Z',
        requiresRefresh: true, cacheStatus: 'stale', meta: { replayed: true, coalesced: false },
      },
    })

    render(<Insights />)
    await userEvent.click(await screen.findByRole('button', { name: /refresh \(10 credits\)/i }))

    expect(await screen.findByText('Before the import.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Analysis status' })).toHaveTextContent(/predates your last import/i)
  })
it('does not attempt a paid fallback after the stream refuses an oversized question', async () => {
  mockBaseRequests()
  vi.mocked(fetch).mockResolvedValue(refusedResponse(413, {
    details: { code: 'PAYLOAD_TOO_LARGE' },
  }))
  mockPost.mockResolvedValue({ data: { chat: chat({ messages: [] }) } })
  render(<Insights />)
  await askQuestion('Question too large for this server')
  expect(await within(answerBubble()).findByText(/shorten it and try again.*nothing was charged/i)).toBeInTheDocument()
  expect(chatFallbackCalls()).toHaveLength(0)
  expect(within(answerBubble()).queryByRole('button', { name: /try again|ask again/i })).not.toBeInTheDocument()
})

it('shows a saved-chat 413 instead of silently creating a local conversation', async () => {
  mockBaseRequests()
  mockPost.mockRejectedValue({ response: { status: 413 } })
  render(<Insights />)
  await askQuestion('Keep this question')
  expect(await screen.findByText(/too long to save to your account/i)).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  expect(chatFallbackCalls()).toHaveLength(0)
})

it('saves only the newest eighty messages after continuing a long transcript', async () => {
  const saved = chat({ messages: Array.from({ length: 80 }, (_, index) => ({
    id: `long-save-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}`,
  })) })
  storeActiveChat(saved)
  mockBaseRequests([saved])
  vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Fine.') + 'event: done\ndata: {"contextStats":null}\n\n'))
  mockPatch.mockResolvedValue({ data: { chat: saved } })
  render(<Insights />)
  await askQuestion('Newest question')
  await waitFor(() => expect(mockPatch).toHaveBeenCalled())
  const payload = mockPatch.mock.calls[mockPatch.mock.calls.length - 1]?.[1]
  expect(payload.messages).toHaveLength(80)
  expect(payload.messages[0]).toEqual({ role: 'user', content: 'Message 2' })
  expect(payload.messages.at(-2)).toEqual({ role: 'user', content: 'Newest question' })
  expect(payload.messages.at(-1)).toEqual({ role: 'assistant', content: 'Fine.' })
})

it('caps the composer at the four thousand characters the model reads', async () => {
  mockBaseRequests()
  render(<Insights />)
  const composer = await screen.findByRole('textbox', { name: 'Ask a question about your cafe data' })
  expect(composer).toHaveAttribute('maxlength', '4000')
})

  function acceptNewChats(id: string) {
    mockPost.mockImplementation((url: string) =>
      url === '/insight-chats'
        ? Promise.resolve({ data: { chat: chat({ _id: id, messages: [] }) } })
        : Promise.resolve({ data: {} })
    )
  }

  // fireEvent, not userEvent: userEvent waits on real timers, which a fake-timer test never advances.
  async function askQuestionNow(question: string) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const input = screen.getByPlaceholderText(/how can i help/i)
    fireEvent.change(input, { target: { value: question } })
    fireEvent.submit(input.closest('form')!)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  it('sends a lapsed organisation to billing, not to buy credits', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(402, {
      success: false, code: 'BILLING_REQUIRED', message: 'Your plan has ended. Guava is read-only until 4 Oct 2026: renew in Billing to make changes.',
      billing: { status: 'grace', readOnly: true },
    }))
    acceptNewChats('chat-lapsed')
    render(<Insights />)
    await askQuestion('What sold best?')
    await screen.findAllByText(/your billing period has ended/i)
    expect(within(answerBubble()).getByRole('link', { name: /open billing/i })).toHaveAttribute('href', '/settings?section=billing')
    expect(within(answerBubble()).queryByText(/out of guava credits/i)).not.toBeInTheDocument()
    expect(chatFallbackCalls()).toHaveLength(0)
  })

  it('names a revoked location instead of the credit permission', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(403, {
      success: false, message: 'Cafe access is no longer available', details: { code: 'CAFE_ACCESS_REVOKED' },
    }))
    acceptNewChats('chat-revoked')
    render(<Insights />)
    await askQuestion('How was last week?')
    await screen.findAllByText(/no longer have access to this location/i)
    expect(within(answerBubble()).queryByText(/cannot spend guava credits/i)).not.toBeInTheDocument()
  })

  it('does not count down for a rolling daily AI limit', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(429, {
      success: false, code: 'AI_USER_DAILY_BUDGET_REACHED', message: 'Your daily AI credit safety limit has been reached',
      details: { code: 'AI_USER_DAILY_BUDGET_REACHED', limit: 500, used: 498, required: 3 },
    }))
    acceptNewChats('chat-daily')
    render(<Insights />)
    await askQuestion('And the week before?')
    await screen.findAllByText(/today's ai safety limit/i)
    expect(within(answerBubble()).queryByText(/wait \d+ seconds/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rate limited/i })).not.toBeInTheDocument()
  })

  it('waits only seconds when another answer is still running', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(
      429,
      { success: false, code: 'AI_USER_CONCURRENCY_LIMIT', message: 'You already have the maximum number of AI requests in progress' },
      { 'retry-after': '5' }
    ))
    acceptNewChats('chat-busy')
    render(<Insights />)
    await askQuestion('Quick one')
    await screen.findAllByText(/another answer is still being written/i)
    expect(within(answerBubble()).getByText(/wait 5 seconds/i)).toBeInTheDocument()
  })

  it('says the AI service is down and nothing was charged, without a paid fallback', async () => {
    mockBaseRequests()
    vi.mocked(fetch).mockResolvedValue(refusedResponse(503, {
      success: false, code: 'AI_PROVIDER_BUSY',
      message: 'The AI service is temporarily unavailable. No credits were charged — please try again shortly.',
      details: { code: 'AI_PROVIDER_BUSY', retryable: true },
    }))
    acceptNewChats('chat-down')
    render(<Insights />)
    await askQuestion('Anything?')
    await screen.findAllByText(/the ai service is unavailable right now/i)
    expect(within(answerBubble()).getByText(/nothing was charged/i)).toBeInTheDocument()
    expect(chatFallbackCalls()).toHaveLength(0)
    expect(within(answerBubble()).getByRole('button', { name: /try again \(3 credits\)/i })).toBeInTheDocument()
  })

  it('stops before chat creation finishes without starting a paid request', async () => {
    mockBaseRequests()
    let finishChat!: (value: unknown) => void
    mockPost.mockImplementation((url: string) => url === '/insight-chats'
      ? new Promise((resolve) => { finishChat = resolve }) : Promise.resolve({ data: {} }))
    vi.mocked(fetch).mockResolvedValue(streamResponse(deltaEvent('Too late') + 'event: done\ndata: {}\n\n'))
    render(<Insights />)
    await askQuestion('Stop before saving this chat')
    await userEvent.click(await screen.findByRole('button', { name: /stop generating/i }))
    await act(async () => { finishChat({ data: { chat: chat({ _id: 'chat-early-stop', messages: [] }) } }) })
    await waitFor(() => expect(within(answerBubble()).getByText(/nothing was charged/i)).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
    expect(chatFallbackCalls()).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: /ask a question/i })).toBeEnabled()
  })

  it('shows that it is still working instead of an endless Thinking', async () => {
    vi.useFakeTimers()
    try {
      mockBaseRequests()
      vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => {}))
      acceptNewChats('chat-slow')
      render(<Insights />)
      await askQuestionNow('Take your time')
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect(within(answerBubble()).getByText(/still working/i)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up on a stream that stops sending, says it was charged, and does not buy a second answer', async () => {
    vi.useFakeTimers()
    try {
      mockBaseRequests()
      vi.mocked(fetch).mockImplementation(openStreamResponse(deltaEvent('The first half of the answer')) as typeof fetch)
      acceptNewChats('chat-stalled')
      render(<Insights />)
      await askQuestionNow('Long answer please')
      await act(async () => { await vi.advanceTimersByTimeAsync(46_000) })
      expect(within(answerBubble()).getByText(/stopped arriving/i)).toBeInTheDocument()
      expect(within(answerBubble()).getByText(/it was charged \(3 credits\)/i)).toBeInTheDocument()
      expect(within(answerBubble()).getByText(/the first half of the answer/i)).toBeInTheDocument()
      expect(chatFallbackCalls()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not offer a paid refresh when there is not enough data yet', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/forecasts/insights') {
        return Promise.resolve({ data: { success: true, insights: [], generatedAt: null, requiresRefresh: false, cacheStatus: 'insufficient_data', insufficientData: true } })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })
    render(<Insights />)
    expect(await screen.findByRole('heading', { name: /nothing to analyse yet/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /generate \(10 credits\)/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh \(10 credits\)/i })).toBeDisabled()
  })

  it('names why a paid insight refresh was refused', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/forecasts/insights') {
        return Promise.resolve({ data: { success: true, insights: ['Saved analysis'], generatedAt: '2026-07-30T08:00:00.000Z', requiresRefresh: true, cacheStatus: 'stale' } })
      }
      if (url.includes('/insight-chats')) return Promise.resolve({ data: { chats: [] } })
      return Promise.resolve({ data: {} })
    })
    mockPost.mockRejectedValueOnce({
      response: { status: 402, data: { success: false, code: 'INSUFFICIENT_CREDITS', message: 'Guava credit limit reached for this billing period', details: { available: 4, required: 10 } } },
    })
    render(<Insights />)
    await userEvent.click(await screen.findByRole('button', { name: /refresh \(10 credits\)/i }))
    expect(await screen.findByText(/you are out of guava credits/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /buy guava credits/i })).toHaveAttribute('href', '/settings?section=billing')
  })

})
