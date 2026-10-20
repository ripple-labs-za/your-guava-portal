import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import Integrations from './Integrations'

// Mock assets required by Sidebar
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  // AuthContext reads these at module scope, so a partial mock throws before the
  // page ever renders.
  API_CONFIG_ERROR: null,
  isSessionRejection: (error: unknown) =>
    [401, 403].includes((error as { response?: { status?: number } })?.response?.status as number),
  refreshAccessToken: vi.fn(),
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { baseURL: 'http://localhost:5000/api' },
  },
}))

const disconnectedData = {
  data: {
    xero: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
    quickbooks: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
    sage: { connected: false, connectedAt: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
  },
}

function mockBaseRequests() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/integrations')) {
      return Promise.resolve({ data: disconnectedData })
    }
    if (url.includes('/cafe/me')) {
      return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
    }
    return Promise.reject(new Error(`Unexpected GET: ${url}`))
  })
}

describe('Integrations page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('explains an unreachable integration status instead of showing a raw network error', async () => {
    mockBaseRequests()
    const base = mockGet.getMockImplementation()!
    mockGet.mockImplementation((url: string) => url === '/integrations'
      ? Promise.reject(new Error('Network Error')) : base(url))
    render(<Integrations />)
    expect(await screen.findByText('Could not load integration status.')).toBeInTheDocument()
    expect(screen.queryByText('Network Error')).not.toBeInTheDocument()
  })

  it('renders all three providers as coming soon for MVP', async () => {
    mockBaseRequests()

    render(<Integrations />)

    await waitFor(() => {
      expect(screen.getByText('Xero')).toBeInTheDocument()
    })

    expect(screen.getByText('QuickBooks')).toBeInTheDocument()
    expect(screen.getByText('Sage Accounting')).toBeInTheDocument()
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThanOrEqual(3)

    const buttons = screen.getAllByRole('button', { name: /coming soon/i })
    expect(buttons).toHaveLength(3)
    buttons.forEach((button) => expect(button).toBeDisabled())
    expect(screen.queryByRole('button', { name: /connect xero/i })).not.toBeInTheDocument()
  })

  it('does not request auth URLs while integrations are paused for MVP', async () => {
    mockBaseRequests()

    render(<Integrations />)

    await screen.findByText('Xero')

    expect(mockGet).not.toHaveBeenCalledWith('/integrations/xero/auth')
    expect(mockGet).not.toHaveBeenCalledWith('/integrations/quickbooks/auth')
    expect(mockGet).not.toHaveBeenCalledWith('/integrations/sage/auth')
  })
})
