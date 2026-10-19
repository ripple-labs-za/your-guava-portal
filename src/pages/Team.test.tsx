import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router'
import { AuthContext } from '@/contexts/AuthContext'
import Team from './Team'
import type { ReactNode } from 'react'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
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

function renderWithAuth(
  ui: ReactNode,
  {
    role = 'owner',
    logout = vi.fn().mockResolvedValue(undefined),
  }: { role?: 'owner' | 'manager'; logout?: () => Promise<void> } = {}
) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: 'Test User',
    role,
    orgId: 'org123',
    cafeIds: ['cafe123'],
    activeCafeId: 'cafe123',
  }

  return render(
    <BrowserRouter>
      <AuthContext.Provider
        value={{
          user,
          isLoading: false,
          isOwner: role === 'owner',
          login: vi.fn(),
          logout,
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

describe('Team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPost.mockResolvedValue({ data: { success: true, emailSent: true } })
    mockDelete.mockResolvedValue({ data: { success: true } })
    // Default: sidebar API calls
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [] } })
      }
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: [] } })
      }
      return Promise.resolve({ data: {} })
    })
  })

  it('renders access denied for non-owner', async () => {
    renderWithAuth(<Team />, { role: 'manager' })

    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
    })
    expect(screen.getByText(/only account owners/i)).toBeInTheDocument()
  })

  it('renders team member list', async () => {
    const mockMembers = [
      {
        _id: 'u1',
        name: 'Alice Owner',
        email: 'alice@test.com',
        role: 'owner',
        cafeIds: [{ _id: 'c1', name: 'Test Cafe' }],
        createdAt: '2025-01-01',
      },
      {
        _id: 'u2',
        name: 'Bob Manager',
        email: 'bob@test.com',
        role: 'manager',
        cafeIds: [{ _id: 'c1', name: 'Test Cafe' }],
        createdAt: '2025-02-01',
      },
    ]

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: mockMembers } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Test Cafe' }] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getByText('Alice Owner')).toBeInTheDocument()
      expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    })
  })

  it('shows invite form with name and email fields and no password input', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: [] } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getByText('Team members')).toBeInTheDocument()
    })

    expect(screen.queryByPlaceholderText('Team member name')).not.toBeInTheDocument()

    const addButtons = screen.getAllByRole('button', { name: /^add member$/i })
    await userEvent.click(addButtons[0])

    expect(screen.getByRole('dialog', { name: /add team member/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Team member name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('member@example.com')).toBeInTheDocument()
    // Passwords are chosen only on the invitation acceptance page.
    expect(screen.queryByPlaceholderText('Temporary password')).not.toBeInTheDocument()
    expect(screen.getByText(/single-use link/i)).toBeInTheDocument()
  }, 10000)

  it('shows cafe checkboxes in invite form', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: [] } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({
          data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }, { _id: 'c2', name: 'Sea Point Brew' }] },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getAllByText('Blouberg Coffee').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Sea Point Brew').length).toBeGreaterThanOrEqual(1)
    })

    const addButtons = screen.getAllByRole('button', { name: /^add member$/i })
    await userEvent.click(addButtons[0])

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(3)
    expect(screen.getByText(/allow guava credit spending/i)).toBeInTheDocument()
  })

  it('submits a pending invitation without displaying secrets', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        success: true,
        emailSent: true,
        invitation: { email: 'new@example.com' },
      },
    })
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: [], seats: { plan: 'starter', used: 1, included: 2, remaining: 1 } } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getAllByText('Blouberg Coffee').length).toBeGreaterThanOrEqual(1)
    })

    await userEvent.click(screen.getAllByRole('button', { name: /^add member$/i })[0])
    await userEvent.type(screen.getByPlaceholderText('Team member name'), 'New Manager')
    await userEvent.type(screen.getByPlaceholderText('member@example.com'), 'new@example.com')
    const submitButtons = screen.getAllByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButtons[submitButtons.length - 1])

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/invite', {
        name: 'New Manager',
        email: 'new@example.com',
        cafeIds: ['c1'],
        canSpendCredits: false,
      })
    })
    expect(screen.getByText(/account is created after they accept/i)).toBeInTheDocument()
  })

  it('says no email was sent when the server is in development mode', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        success: true,
        emailSent: false,
        deliveryMode: 'console',
        invitation: { email: 'new@example.com' },
      },
    })
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: [], seats: { plan: 'starter', used: 1, included: 2, remaining: 1 } } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getAllByText('Blouberg Coffee').length).toBeGreaterThanOrEqual(1)
    })

    await userEvent.click(screen.getAllByRole('button', { name: /^add member$/i })[0])
    await userEvent.type(screen.getByPlaceholderText('Team member name'), 'New Manager')
    await userEvent.type(screen.getByPlaceholderText('member@example.com'), 'new@example.com')
    const submitButtons = screen.getAllByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButtons[submitButtons.length - 1])

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/invite', {
        name: 'New Manager',
        email: 'new@example.com',
        cafeIds: ['c1'],
        canSpendCredits: false,
      })
    })
    expect(await screen.findByText(/development mode: no email was sent/i)).toBeInTheDocument()
  })

  it('renders pending invitations and supports resend and revoke', async () => {
    const user = userEvent.setup()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({
          data: {
            success: true,
            members: [],
            invitations: [{
              _id: 'invite1',
              name: 'Pending Manager',
              email: 'pending@example.com',
              cafeIds: [{ _id: 'c1', name: 'Blouberg Coffee' }],
              expiresAt: '2026-08-01T12:00:00.000Z',
              createdAt: '2026-07-30T12:00:00.000Z',
              status: 'pending',
            }],
            seats: { plan: 'starter', used: 2, active: 1, pending: 1, included: 2, remaining: 0 },
          },
        })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Blouberg Coffee' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    expect(await screen.findByText('Pending Manager')).toBeInTheDocument()
    expect(screen.getByText(/pending invitations reserve seats/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /resend/i }))
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/invitations/invite1/resend')
    })

    await user.click(screen.getByRole('button', { name: /revoke/i }))
    const revokeDialog = screen.getByRole('dialog', { name: /revoke invitation/i })
    expect(mockDelete).not.toHaveBeenCalled()
    await user.click(within(revokeDialog).getByRole('button', { name: /^revoke invitation$/i }))
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/team/invitations/invite1')
    })
  })

  it('shows remove button for managers, not for owner', async () => {
    const mockMembers = [
      {
        _id: 'u1',
        name: 'Alice Owner',
        email: 'alice@test.com',
        role: 'owner',
        cafeIds: [],
        createdAt: '2025-01-01',
      },
      {
        _id: 'u2',
        name: 'Bob Manager',
        email: 'bob@test.com',
        role: 'manager',
        cafeIds: [],
        createdAt: '2025-02-01',
      },
    ]

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: mockMembers } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getByText('Alice Owner')).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /remove alice owner/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove bob manager/i })).toBeInTheDocument()
  })

  it('uses an app confirmation dialog when removing a manager', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const mockMembers = [
      {
        _id: 'u1',
        name: 'Alice Owner',
        email: 'alice@test.com',
        role: 'owner',
        cafeIds: [],
        createdAt: '2025-01-01',
      },
      {
        _id: 'u2',
        name: 'Bob Manager',
        email: 'bob@test.com',
        role: 'manager',
        cafeIds: [{ _id: 'c1', name: 'Test Cafe' }],
        createdAt: '2025-02-01',
      },
    ]

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({ data: { success: true, members: mockMembers } })
      }
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Test Cafe' }] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    await waitFor(() => {
      expect(screen.getByText('Bob Manager')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /remove bob manager/i }))

    const dialog = screen.getByRole('dialog', { name: /remove team member/i })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText(/bob manager/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/lose access to assigned cafe data/i)).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /remove member/i }))

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/team/u2')
    })
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // ── Load failure ────────────────────────────────────────────────────────────

  it('does not claim the organisation is empty when the fetch failed', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/team') || url.includes('/cafe/list')) return Promise.reject(new Error('network down'))
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    expect(await screen.findByText(/team data could not be loaded/i)).toBeInTheDocument()
    // An owner with three managers must never be told they have none.
    expect(screen.queryByText(/no team members yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no locations yet/i)).not.toBeInTheDocument()
  })

  it('offers a persistent retry after a failed load', async () => {
    let shouldFail = true
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/cafe/list')) {
        return shouldFail
          ? Promise.reject(new Error('network down'))
          : Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/team')) {
        return shouldFail
          ? Promise.reject(new Error('network down'))
          : Promise.resolve({
              data: {
                success: true,
                members: [
                  { _id: 'u1', name: 'Alice Owner', email: 'a@test.com', role: 'owner', cafeIds: [], createdAt: '2025-01-01' },
                ],
              },
            })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    const retry = await screen.findByRole('button', { name: /try again/i })
    shouldFail = false
    await userEvent.click(retry)

    expect(await screen.findByText('Alice Owner')).toBeInTheDocument()
  })

  // ── Location allowance ──────────────────────────────────────────────────────

  function mockWithAccount(locations: { used: number; included: number }, cafes: { _id: string; name: string; archivedAt?: string }[]) {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test Cafe' } } })
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { success: true, cafes } })
      if (url.includes('/account')) {
        return Promise.resolve({
          data: {
            success: true,
            account: {
              organization: { plan: 'starter' },
              usage: { locations, seats: { used: 1, included: 2 } },
            },
          },
        })
      }
      if (url.includes('/team')) {
        return Promise.resolve({
          data: { success: true, members: [], seats: { plan: 'starter', used: 1, included: 2, remaining: 1 } },
        })
      }
      return Promise.resolve({ data: {} })
    })
  }

  it('shows the location allowance the way it shows seats', async () => {
    mockWithAccount({ used: 1, included: 3 }, [{ _id: 'c1', name: 'Blouberg Coffee' }])

    renderWithAuth(<Team />)

    // Not a bare count: the tile has to say what is left, like the Seats tile.
    expect(await screen.findByText('1/3')).toBeInTheDocument()
    expect(screen.getByText(/2 available on starter/i)).toBeInTheDocument()
  })

  it('disables Add location when the plan allowance is exhausted', async () => {
    mockWithAccount({ used: 2, included: 2 }, [
      { _id: 'c1', name: 'Blouberg Coffee' },
      { _id: 'c2', name: 'Sea Point Brew' },
    ])

    renderWithAuth(<Team />)

    // Both entry points: the toolbar button and the "+" on the Locations card.
    await waitFor(() => {
      const addButtons = screen.getAllByRole('button', { name: /^add location$/i })
      expect(addButtons.length).toBeGreaterThan(0)
      addButtons.forEach((button) => expect(button).toBeDisabled())
    })
    // UAT-09-S01: both say why, not only the toolbar button.
    screen.getAllByRole('button', { name: /^add location$/i }).forEach((button) =>
      expect(button).toHaveAttribute('title', expect.stringMatching(/^Location limit reached on the /)))
    expect(screen.getByText(/starter plan is full/i)).toBeInTheDocument()
  })

  it('says a new location is metered and can be archived later', async () => {
    mockWithAccount({ used: 1, included: 2 }, [{ _id: 'c1', name: 'Blouberg Coffee' }])

    renderWithAuth(<Team />)
    await userEvent.click((await screen.findAllByRole('button', { name: /^add location$/i }))[0])

    const dialog = await screen.findByRole('dialog', { name: /add location/i })
    expect(within(dialog).getByText(/1 of your 2/i)).toBeInTheDocument()
    // There is no cafe-delete route anywhere in the backend.
    expect(within(dialog).getByText(/archive a location later/i)).toBeInTheDocument()
  })

  // ── Dialog behaviour ────────────────────────────────────────────────────────

  it('archives a location after a confirmation that says what is kept', async () => {
    mockWithAccount({ used: 2, included: 2 }, [
      { _id: 'c1', name: 'Blouberg Coffee' },
      { _id: 'c2', name: 'Sea Point Brew' },
    ])
    mockPost.mockResolvedValueOnce({
      data: { success: true, cafe: { _id: 'c2', name: 'Sea Point Brew', archivedAt: '2026-09-23T10:00:00Z' }, locations: { used: 1, included: 2 } },
    })

    renderWithAuth(<Team />)
    await userEvent.click(await screen.findByRole('button', { name: /archive sea point brew/i }))
    const dialog = await screen.findByRole('dialog', { name: /archive location/i })
    expect(within(dialog).getByText(/sales history and forecasts are kept/i)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /^archive location$/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/team/cafes/c2/archive'))
  })

  it('does not offer to archive the only active location', async () => {
    mockWithAccount({ used: 1, included: 2 }, [{ _id: 'c1', name: 'Blouberg Coffee' }])
    renderWithAuth(<Team />)
    expect(await screen.findByRole('button', { name: /archive blouberg coffee/i })).toBeDisabled()
  })

  it('lists archived locations separately with a restore action', async () => {
    mockWithAccount({ used: 1, included: 2 }, [
      { _id: 'c1', name: 'Blouberg Coffee' },
      { _id: 'c9', name: 'Old Branch', archivedAt: '2026-09-01T00:00:00Z' },
    ])
    mockPost.mockResolvedValueOnce({ data: { success: true, cafe: { _id: 'c9', name: 'Old Branch', archivedAt: null } } })

    renderWithAuth(<Team />)
    await userEvent.click(await screen.findByRole('button', { name: /restore old branch/i }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/team/cafes/c9/restore'))
    expect(screen.queryByRole('button', { name: /archive old branch/i })).not.toBeInTheDocument()
  })

  it('traps focus in a destructive dialog and restores it on Escape', async () => {
    const user = userEvent.setup()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({
          data: {
            success: true,
            members: [
              { _id: 'u2', name: 'Bob Manager', email: 'bob@test.com', role: 'manager', cafeIds: [], createdAt: '2025-02-01' },
            ],
          },
        })
      }
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { success: true, cafes: [] } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    const trigger = await screen.findByRole('button', { name: /remove bob manager/i })
    trigger.focus()
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: /remove team member/i })
    // Focus must be inside the dialog, not left on the obscured trigger.
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    // Escape is the reflexive way out of a confirmation opened by mistake.
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /remove team member/i })).not.toBeInTheDocument()
    })
    expect(document.activeElement).toBe(trigger)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  // UAT-09-S01: a form dialog opened on its Close button and, on closing, left focus on the page body: a field that
  // autofocuses mounts before the dialog records what had focus, so it recorded that field instead of the trigger.
  it('opens a form dialog on its first field and returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) return Promise.resolve({ data: { success: true, members: [] } })
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)
    const trigger = (await screen.findAllByRole('button', { name: /^add member$/i }))[0]
    trigger.focus()
    await user.click(trigger)

    await screen.findByRole('dialog', { name: /add team member/i })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Team member name')))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /add team member/i })).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('groups the cafe checkboxes under their visible heading', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) return Promise.resolve({ data: { success: true, members: [] } })
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)
    await userEvent.click((await screen.findAllByRole('button', { name: /^add member$/i }))[0])

    // Otherwise a screen reader reads bare cafe names with no hint that these
    // are the access-control decision the dialog exists to make.
    expect(screen.getByRole('group', { name: /assigned cafes/i })).toBeInTheDocument()
  })

  it('confirms before discarding a part-filled invite', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) return Promise.resolve({ data: { success: true, members: [] } })
      if (url.includes('/cafe/list')) {
        return Promise.resolve({ data: { success: true, cafes: [{ _id: 'c1', name: 'Blouberg Coffee' }] } })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)
    await userEvent.click((await screen.findAllByRole('button', { name: /^add member$/i }))[0])
    await userEvent.type(screen.getByPlaceholderText('Team member name'), 'Half typed')
    await userEvent.click(screen.getByRole('button', { name: /close add team member/i }))

    expect(confirmSpy).toHaveBeenCalled()
    // Declined: the work must still be there.
    expect(screen.getByDisplayValue('Half typed')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  // ── Ownership transfer ──────────────────────────────────────────────────────

  it('does not report a committed ownership transfer as failed when sign-out fails', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('revocation endpoint down'))
    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    })

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({
          data: {
            success: true,
            members: [
              { _id: 'u2', name: 'Bob Manager', email: 'bob@test.com', role: 'manager', cafeIds: [], createdAt: '2025-02-01' },
            ],
          },
        })
      }
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { success: true, cafes: [] } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })
    mockPost.mockResolvedValue({ data: { success: true } })

    renderWithAuth(<Team />, { logout })

    await userEvent.click(await screen.findByRole('button', { name: /transfer ownership to bob manager/i }))
    await userEvent.type(screen.getByLabelText(/confirm your current password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /^transfer ownership$/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/team/transfer-ownership', {
        userId: 'u2',
        currentPassword: 'password123',
      })
    })
    // Ownership has already moved. Telling the former owner it failed invites a
    // retry with a password that no longer belongs to an owner.
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/login')
    })
    expect(screen.queryByText(/failed to transfer ownership/i)).not.toBeInTheDocument()

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  // ── Invitations ─────────────────────────────────────────────────────────────

  it('shows when a pending invitation expires', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/team')) {
        return Promise.resolve({
          data: {
            success: true,
            members: [],
            invitations: [{
              _id: 'invite1',
              name: 'Pending Manager',
              email: 'pending@example.com',
              cafeIds: [],
              expiresAt: '2026-08-01T12:00:00.000Z',
              createdAt: '2026-07-30T12:00:00.000Z',
              status: 'pending',
            }],
            seats: { plan: 'starter', used: 2, active: 1, pending: 1, included: 2, remaining: 0 },
          },
        })
      }
      if (url.includes('/cafe/list')) return Promise.resolve({ data: { success: true, cafes: [] } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Team />)

    // With the last seat blocked, "expires when?" is the whole wait-or-revoke decision.
    expect(await screen.findByText(/expires 0?1 aug/i)).toBeInTheDocument()
  })
})
