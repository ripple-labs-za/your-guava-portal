import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import Improvements from './Improvements'
import type { Improvement } from '@/types'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()

// Partial mock: only the axios instance and the token exchange are faked. The
// module's other named exports (API_CONFIG_ERROR, isSessionRejection) are read
// by AuthProvider during render, and a factory that omits them makes vitest
// throw the moment one is touched.
//
// AuthProvider exchanges the refresh cookie before it calls /auth/me, so with
// refreshAccessToken missing every render fell into the "no session" branch and
// the owner-only triage controls never mounted — the two failing tests below
// were failing for a missing session, not for a missing accessible name.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    refreshAccessToken: () => Promise.resolve('test-access-token'),
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      patch: (...args: unknown[]) => mockPatch(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

const ownerUser = {
  id: 'user123',
  email: 'owner@test.com',
  name: 'Owner',
  role: 'owner' as const,
  orgId: 'org123',
  cafeIds: ['cafe123'],
  activeCafeId: 'cafe123',
}

const sampleTicket: Improvement = {
  _id: 'imp1',
  ticketNumber: 1,
  type: 'fix',
  title: 'Forecast chart cuts off on mobile',
  area: 'planning',
  priority: 'high',
  description: 'The weekly forecast chart overflows its card on narrow screens.',
  desiredOutcome: 'Chart fits within the card at 320px.',
  status: 'open',
  createdBy: { name: 'Jordan', email: 'jordan@test.com' },
  orgId: 'org123',
  createdAt: '2026-06-20T10:00:00.000Z',
  updatedAt: '2026-06-20T10:00:00.000Z',
}

const emptyCounts = { all: 0, open: 0, planned: 0, in_progress: 0, done: 0, declined: 0 }

// "Signed out" has to look like a 401. AuthProvider distinguishes a rejected
// credential from an unreachable server, and a bare Error is the latter — it
// renders a full-page "Can't reach Your Guava" notice instead of the app.
const noSession = () => Promise.reject({ response: { status: 401 } })

// Builds a mock api.get that serves improvements + benign defaults. When
// `asOwner` is set, /auth/me returns an owner so triage controls render.
function mockApiGet(improvements: Improvement[], asOwner = false) {
  return (url: string) => {
    if (url.includes('/auth/me')) {
      return asOwner ? Promise.resolve({ data: ownerUser }) : noSession()
    }
    if (url.includes('/improvements')) {
      const all = improvements.length
      return Promise.resolve({
        data: { improvements, counts: { ...emptyCounts, all, open: all } },
      })
    }
    if (url.includes('/cafe/me')) {
      return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    }
    return Promise.resolve({ data: {} })
  }
}

describe('Improvements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the list of tickets', async () => {
    mockGet.mockImplementation(mockApiGet([sampleTicket]))

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText('Forecast chart cuts off on mobile')).toBeInTheDocument()
    })

    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('Desired outcome')).toBeInTheDocument()
    expect(screen.getByText('Jordan')).toBeInTheDocument()
  })

  it('shows the empty state and reveals the log form', async () => {
    mockGet.mockImplementation(mockApiGet([]))

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText('No improvements logged yet')).toBeInTheDocument()
    })

    const logButton = screen.getAllByRole('button', { name: /log an improvement/i })[0]
    await userEvent.click(logButton)

    expect(screen.getByLabelText('Title *')).toBeInTheDocument()
    expect(screen.getByText('Area of the app')).toBeInTheDocument()
    expect(screen.getByText('Priority')).toBeInTheDocument()
  })

  it('submits a new ticket and shows a confirmation toast', async () => {
    mockGet.mockImplementation(mockApiGet([]))
    mockPost.mockResolvedValue({ data: { improvement: { ...sampleTicket, ticketNumber: 7 } } })

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText('No improvements logged yet')).toBeInTheDocument()
    })

    await userEvent.click(screen.getAllByRole('button', { name: /log an improvement/i })[0])

    await userEvent.type(screen.getByLabelText('Title *'), 'Add a dark mode toggle')
    await userEvent.type(screen.getByLabelText(/What's the idea/i), 'Let users switch themes.')

    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/improvements',
        expect.objectContaining({
          title: 'Add a dark mode toggle',
          description: 'Let users switch themes.',
          type: 'improvement',
          pageUrl: '/',
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByText(/Logged as #7/i)).toBeInTheDocument()
    })
  })

  it('lets an owner change a ticket status', async () => {
    mockGet.mockImplementation(mockApiGet([sampleTicket], true))
    mockPatch.mockResolvedValue({ data: { improvement: { ...sampleTicket, status: 'in_progress' } } })

    render(<Improvements />)

    const statusSelect = await screen.findByLabelText(/Status for ticket 1/i)
    await userEvent.selectOptions(statusSelect, 'in_progress')

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/improvements/imp1/status', { status: 'in_progress' })
    })

    // The row reflects the new status without reloading the board.
    await waitFor(() => {
      expect(screen.getByLabelText(/Status for ticket 1/i)).toHaveValue('in_progress')
    })
  })

  it('hides triage controls for non-owners', async () => {
    mockGet.mockImplementation(mockApiGet([sampleTicket]))

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText('Forecast chart cuts off on mobile')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/Status for ticket 1/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Delete ticket 1/i)).not.toBeInTheDocument()
  })

  it('lets an owner delete after an inline confirm', async () => {
    mockGet.mockImplementation(mockApiGet([sampleTicket], true))
    mockDelete.mockResolvedValue({ data: { success: true } })

    render(<Improvements />)

    const deleteBtn = await screen.findByLabelText(/Delete ticket 1/i)
    await userEvent.click(deleteBtn)

    // Inline confirm appears; "No" cancels without deleting
    expect(screen.getByText('Delete?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^no$/i }))
    expect(mockDelete).not.toHaveBeenCalled()

    // Re-open and confirm with "Yes"
    await userEvent.click(await screen.findByLabelText(/Delete ticket 1/i))
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/improvements/imp1')
    })
  })

  it('shows an error state with retry when the initial load fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return noSession()
      if (url.includes('/improvements')) return Promise.reject(new Error('boom'))
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load improvements/i)).toBeInTheDocument()
    })
    // It must NOT masquerade as the empty state
    expect(screen.queryByText(/No improvements logged yet/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('loads more when there are more tickets than the first page', async () => {
    const second: Improvement = { ...sampleTicket, _id: 'imp2', ticketNumber: 2, title: 'Second ticket' }
    mockGet.mockImplementation((url: string, config?: { params?: { page?: number } }) => {
      if (url.includes('/auth/me')) return noSession()
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/improvements')) {
        const page = config?.params?.page ?? 1
        const improvements = page === 1 ? [sampleTicket] : [second]
        return Promise.resolve({
          data: {
            improvements,
            counts: { ...emptyCounts, all: 2, open: 2 },
            pagination: { total: 2, page, limit: 1, pages: 2 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Improvements />)

    await waitFor(() => {
      expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => {
      expect(screen.getByText('Second ticket')).toBeInTheDocument()
    })
    // Both tickets now visible (appended)
    expect(screen.getByText('Forecast chart cuts off on mobile')).toBeInTheDocument()
  })

  it('keeps a paged-in backlog after a status change', async () => {
    const second: Improvement = { ...sampleTicket, _id: 'imp2', ticketNumber: 2, title: 'Second ticket' }
    mockGet.mockImplementation((url: string, config?: { params?: { page?: number } }) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: ownerUser })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/improvements')) {
        const page = config?.params?.page ?? 1
        return Promise.resolve({
          data: {
            improvements: page === 1 ? [sampleTicket] : [second],
            counts: { ...emptyCounts, all: 2, open: 2 },
            pagination: { total: 2, page, limit: 1, pages: 2 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    mockPatch.mockResolvedValue({ data: { improvement: { ...sampleTicket, status: 'done' } } })

    render(<Improvements />)

    await userEvent.click(await screen.findByRole('button', { name: /load more/i }))
    await screen.findByText('Second ticket')

    await userEvent.selectOptions(await screen.findByLabelText(/Status for ticket 1/i), 'done')

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled()
    })
    // Triaging one ticket must not throw away the pages already loaded.
    await waitFor(() => {
      expect(screen.getByText('Second ticket')).toBeInTheDocument()
    })
    expect(screen.getByText('Forecast chart cuts off on mobile')).toBeInTheDocument()
  })

  it('keeps a paged-in backlog after a delete', async () => {
    const second: Improvement = { ...sampleTicket, _id: 'imp2', ticketNumber: 2, title: 'Second ticket' }
    mockGet.mockImplementation((url: string, config?: { params?: { page?: number } }) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: ownerUser })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/improvements')) {
        const page = config?.params?.page ?? 1
        return Promise.resolve({
          data: {
            improvements: page === 1 ? [sampleTicket] : [second],
            counts: { ...emptyCounts, all: 2, open: 2 },
            pagination: { total: 2, page, limit: 1, pages: 2 },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    mockDelete.mockResolvedValue({ data: { success: true } })

    render(<Improvements />)

    await userEvent.click(await screen.findByRole('button', { name: /load more/i }))
    await screen.findByText('Second ticket')

    await userEvent.click(await screen.findByLabelText(/Delete ticket 1/i))
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(screen.queryByText('Forecast chart cuts off on mobile')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Second ticket')).toBeInTheDocument()
  })

  it('surfaces the server message when logging a ticket is rejected', async () => {
    mockGet.mockImplementation(mockApiGet([]))
    mockPost.mockRejectedValue({
      response: { status: 429, data: { message: 'Too many submissions. Try again in a minute.' } },
    })

    render(<Improvements />)

    await userEvent.click((await screen.findAllByRole('button', { name: /log an improvement/i }))[0])
    await userEvent.type(screen.getByLabelText('Title *'), 'Rate limited')
    await userEvent.type(screen.getByLabelText(/What's the idea/i), 'Body text.')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    // "Please try again" is wrong advice for a rate limit and useless for a
    // validation failure.
    expect(await screen.findByText(/too many submissions/i)).toBeInTheDocument()
  })

  // UAT-14-S24: the write limiter's own 429 printed "You are doing that too quickly. Please slow down." with no wait.
  it('says how long to wait when the write limiter refuses a ticket', async () => {
    mockGet.mockImplementation(mockApiGet([]))
    mockPost.mockRejectedValue({
      response: {
        status: 429,
        headers: { 'retry-after': '42' },
        data: { success: false, code: 'WRITE_RATE_LIMITED', message: 'You are doing that too quickly. Please slow down.' },
      },
    })

    render(<Improvements />)

    await userEvent.click((await screen.findAllByRole('button', { name: /log an improvement/i }))[0])
    await userEvent.type(screen.getByLabelText('Title *'), 'Rate limited')
    await userEvent.type(screen.getByLabelText(/What's the idea/i), 'Body text.')
    await userEvent.click(screen.getByRole('button', { name: /log it/i }))

    expect(await screen.findByText('Wait for the timer, then try again. Try again in 42 seconds.')).toBeInTheDocument()
    expect(screen.queryByText(/please slow down/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title *')).toHaveValue('Rate limited')
  })

  it('keeps declined and done tickets at full text contrast', async () => {
    const declined: Improvement = { ...sampleTicket, status: 'declined' }
    mockGet.mockImplementation(mockApiGet([declined]))

    render(<Improvements />)

    const description = await screen.findByText(declined.description)
    // Container opacity composites the text against the page and drops
    // `text-muted` to 2.37:1 at 55%. The status badge carries the state instead.
    let node: HTMLElement | null = description
    while (node) {
      expect(node.className).not.toMatch(/\bopacity-\d/)
      node = node.parentElement
    }
  })
})
