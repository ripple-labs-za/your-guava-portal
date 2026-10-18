import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '@/contexts/AuthContext'
import Staff from './Staff'
import { mockStaffMember } from '@/test/mocks/api'
import type { ReactNode } from 'react'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    refreshAccessToken: vi.fn().mockRejectedValue(new Error('No refresh session')),
    isSessionRejection: vi.fn(() => true),
    API_CONFIG_ERROR: null,
    API_BASE_URL: 'http://localhost:5000/api',
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

function renderAs(role: 'owner' | 'manager', ui: ReactNode) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: role === 'owner' ? 'Test Owner' : 'Test Manager',
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
          logout: vi.fn(),
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

function mockStaffList(staff: unknown[] = [mockStaffMember], balances: unknown[] = []) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/leave/balances')) return Promise.resolve({ data: { balances } })
    if (url.includes('/staff')) return Promise.resolve({ data: { staff } })
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: {} })
  })
}

// Both the page header and the empty state offer an "Add Staff" button, so the
// form's own submit has to be picked out by type rather than by name.
function submitAddStaff() {
  const submit = screen
    .getAllByRole('button', { name: /^add staff$/i })
    .find((button) => (button as HTMLButtonElement).type === 'submit')
  if (!submit) throw new Error('Add Staff submit button not found')
  return submit
}

const BALANCE = {
  staffId: 'staff123',
  annual: { total: 15, used: 5 },
  sick: { total: 10, used: 2 },
  family: { total: 3, used: 0 },
}

describe('Staff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
    mockPost.mockResolvedValue({ data: {} })
  })

  it('renders staff list', async () => {
    mockStaffList([mockStaffMember], [BALANCE])

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getByText('barista')).toBeInTheDocument()
  })

  it('shows add staff form', async () => {
    mockStaffList([])

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])

    await waitFor(() => expect(screen.getByText('Add Staff Member')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('email@example.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('082 123 4567')).toBeInTheDocument()
  })

  it('renders leave balance progress bars', async () => {
    mockStaffList([mockStaffMember], [BALANCE])

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getByText('Annual')).toBeInTheDocument()
    expect(screen.getByText('Sick')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
    expect(screen.getByText('10/15 days')).toBeInTheDocument()
    expect(screen.getByText('8/10 days')).toBeInTheDocument()
    expect(screen.getByText('3/3 days')).toBeInTheDocument()
  })

  // The old version wrapped its only assertion in `if (editButton)`, so once the
  // class-based selector stopped matching the test passed having asserted
  // nothing. Selecting by accessible name makes that impossible.
  it('shows edit mode on click', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit sarah/i }))

    expect(await screen.findByDisplayValue('Sarah')).toBeInTheDocument()
  })
})

describe('Staff accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  it('names the per-card icon buttons after the person they act on', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /edit sarah/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deactivate sarah/i })).toBeInTheDocument()
  })

  it('labels every control in the add staff form', async () => {
    mockStaffList([])

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])
    await screen.findByText('Add Staff Member')

    expect(screen.getByLabelText(/name \*/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^phone$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/hourly rate/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /^role$/i })).toBeInTheDocument()
  })

  it('labels every control in the edit form', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit sarah/i }))
    await screen.findByDisplayValue('Sarah')

    expect(screen.getByLabelText(/edit name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/edit email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/edit phone/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/edit hourly rate/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/edit start date/i)).toBeInTheDocument()
  })

  it('leaves no button on the page without an accessible name', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') || button.textContent
      expect(name?.trim()).toBeTruthy()
    }
  })
})

// POST/PUT/DELETE /staff are all ownerOnly in staff.routes. Showing a manager
// the controls anyway means they fill in a whole new-hire form and watch it fail
// silently, with no staff member created and no explanation.
describe('Staff role gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('hides every owner-only control from a manager', async () => {
    mockStaffList()

    renderAs('manager', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit sarah/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /deactivate sarah/i })).not.toBeInTheDocument()
  })

  it('does not push a manager at an add-staff call to action on the empty state', async () => {
    mockStaffList([])

    renderAs('manager', <Staff />)

    await waitFor(() => expect(screen.getByText(/no staff/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument()
  })

  // staffDto strips hourlyRate for anyone who is not an owner, but the type
  // declares it required, so the card rendered the literal string 'Rundefined/hr'
  // -- a plainly broken pay field on every card a manager sees.
  it('omits the pay row rather than rendering an undefined rate', async () => {
    const { hourlyRate: _omitted, ...withoutRate } = mockStaffMember
    mockStaffList([withoutRate])

    renderAs('manager', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.queryByText(/Rundefined/)).not.toBeInTheDocument()
    expect(screen.queryByText(/R\s*\/hr/)).not.toBeInTheDocument()
  })

  it('still shows the rate to an owner', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getByText('R45/hr')).toBeInTheDocument()
  })
})

describe('Staff deactivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  // GET /staff filters to isActive: true, so a deactivated person vanishes on
  // the next load -- out of the roster dropdown, the leave form and the sidebar
  // -- and there is no reactivate control anywhere in the portal.
  it('does not deactivate on the first click', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /deactivate sarah/i }))

    expect(mockPut).not.toHaveBeenCalled()
  })

  it('says who disappears and from where before deactivating', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /deactivate sarah/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sarah')
    expect(dialog).toHaveTextContent(/roster/i)
    expect(dialog).toHaveTextContent(/leave/i)
  })

  it('deactivates once confirmed', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /deactivate sarah/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Deactivate$/ }))

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/staff/staff123', { isActive: false })
    )
  })

  it('keeps the staff member when the confirmation is dismissed', async () => {
    mockStaffList()

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /deactivate sarah/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPut).not.toHaveBeenCalled()
  })
})

describe('Staff failure feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // A 500, a 403 or a dropped connection all used to render as a confident
  // "No staff yet -- add your first staff member", telling a cafe with twelve
  // staff that their people do not exist.
  it('distinguishes a failed load from an empty roster', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Network Error'))
    })

    renderAs('owner', <Staff />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
    expect(screen.queryByText('No staff yet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows the server message when adding a staff member is refused', async () => {
    mockStaffList([])
    mockPost.mockRejectedValue({
      response: { data: { message: 'Only the account owner can add staff.' } },
    })

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])
    await screen.findByText('Add Staff Member')

    await userEvent.type(screen.getByLabelText(/name \*/i), 'Thabo')
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '60')
    await userEvent.click(submitAddStaff())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the account owner can add staff.'
    )
  })

  it('shows the server message when a deactivation is refused', async () => {
    mockStaffList()
    mockPut.mockRejectedValue({
      response: { data: { message: 'Staff member not found' } },
    })

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /deactivate sarah/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Deactivate$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Staff member not found')
  })
})

describe('Staff record editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
    mockPost.mockResolvedValue({ data: {} })
  })

  async function openEditForm() {
    mockStaffList()
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit sarah/i }))
    await screen.findByDisplayValue('Sarah')
  }

  // `email: email || undefined` never reaches the server -- JSON.stringify drops
  // undefined -- and the backend's merge preserves the old value, so a cleared
  // field silently came back after reload.
  it('actually clears an email the owner deleted', async () => {
    await openEditForm()

    await userEvent.clear(screen.getByLabelText(/edit email/i))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ email: '' })
  })

  it('actually clears a phone number the owner deleted', async () => {
    await openEditForm()

    await userEvent.clear(screen.getByLabelText(/edit phone/i))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ phone: '' })
  })

  // `Number('') || 0` is 0 and the backend accepts it, so blanking the rate
  // silently zeroed the one number on this screen with money attached.
  it('refuses to save a blank hourly rate rather than zeroing it', async () => {
    await openEditForm()

    await userEvent.clear(screen.getByLabelText(/edit hourly rate/i))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/hourly rate/i)
    expect(mockPut).not.toHaveBeenCalled()
  })

  // Start date drives tenure and leave accrual, the add form pre-fills today,
  // and there was no way to correct it afterwards.
  it('lets the owner correct a start date captured retrospectively', async () => {
    await openEditForm()

    const startDate = screen.getByLabelText(/edit start date/i)
    expect(startDate).toHaveValue('2025-06-01')
    await userEvent.clear(startDate)
    await userEvent.type(startDate, '2024-02-15')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalled())
    expect(mockPut.mock.calls[0][1]).toMatchObject({ startDate: '2024-02-15' })
  })

  it('refuses to create a new hire at R0 an hour by omission', async () => {
    mockStaffList([])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])
    await screen.findByText('Add Staff Member')

    await userEvent.type(screen.getByLabelText(/name \*/i), 'Thabo')
    await userEvent.click(submitAddStaff())

    expect(await screen.findByRole('alert')).toHaveTextContent(/hourly rate/i)
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('Staff leave balances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // Over-taken leave is a payroll liability. Clamping it to zero made it
  // indistinguishable from a staff member who has used exactly their allowance.
  it('shows an overdrawn balance rather than clamping it to zero', async () => {
    mockStaffList(
      [mockStaffMember],
      [{ staffId: 'staff123', annual: { total: 15, used: 18 }, sick: { total: 10, used: 2 }, family: { total: 3, used: 0 } }]
    )

    renderAs('owner', <Staff />)

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getByText('-3/15 days')).toBeInTheDocument()
  })
})

const CYCLE_BALANCE = {
  staffId: 'staff123',
  annual: { total: 15, used: 5, remaining: 10, cycleStart: '2026-06-01', cycleEnd: '2027-05-31' },
  sick: { total: 30, used: 2, remaining: 28, cycleStart: '2025-06-01', cycleEnd: '2028-05-31' },
  family: { total: 3, used: 0, remaining: 3, cycleStart: '2026-06-01', cycleEnd: '2027-05-31' },
}

describe('Staff leave cycles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  it('says which cycle each balance belongs to', async () => {
    mockStaffList([mockStaffMember], [CYCLE_BALANCE])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.getAllByText(/cycle ends/i)).toHaveLength(3)
    expect(screen.getByText('10/15 days')).toBeInTheDocument()
  })

  it('lets the owner set a cycle total with a reason', async () => {
    mockStaffList([mockStaffMember], [CYCLE_BALANCE])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /adjust leave for sarah/i }))
    await userEvent.selectOptions(screen.getByLabelText(/leave type to adjust/i), 'annual')
    await userEvent.clear(screen.getByLabelText(/new total for this cycle/i))
    await userEvent.type(screen.getByLabelText(/new total for this cycle/i), '12')
    await userEvent.type(screen.getByLabelText(/reason for the change/i), 'Joined mid-year')
    await userEvent.click(screen.getByRole('button', { name: /^save adjustment$/i }))

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/leave/balances/staff123', { type: 'annual', total: 12, reason: 'Joined mid-year' })
    )
  })

  it('refuses an adjustment without a reason', async () => {
    mockStaffList([mockStaffMember], [CYCLE_BALANCE])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /adjust leave for sarah/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save adjustment$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/say why/i)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('hides the adjust control from a manager', async () => {
    mockStaffList([mockStaffMember], [CYCLE_BALANCE])
    renderAs('manager', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /adjust leave/i })).not.toBeInTheDocument()
  })

  async function adjustAnnualTo(total: string) {
    mockStaffList([mockStaffMember], [CYCLE_BALANCE])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /adjust leave for sarah/i }))
    await userEvent.clear(screen.getByLabelText(/new total for this cycle/i))
    await userEvent.type(screen.getByLabelText(/new total for this cycle/i), total)
    await userEvent.type(screen.getByLabelText(/reason for the change/i), 'Correction')
    await userEvent.click(screen.getByRole('button', { name: /^save adjustment$/i }))
  }

  // BE-08-T02 fix-back: a total below the days already taken is allowed, but the
  // owner is told what the balance will now show.
  it('keeps the form open and shows the warning when the new total is below the days taken', async () => {
    const warning =
      '5 days already taken in this cycle exceed the new total of 3, so the balance shows -2 until leave is cancelled or the total is raised.'
    mockPut.mockResolvedValue({ data: { warning } })
    await adjustAnnualTo('3')

    expect(await screen.findByRole('status')).toHaveTextContent(warning)
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByLabelText(/reason for the change/i)).not.toBeInTheDocument()
  })

  it('closes the form after an adjustment that needs no warning', async () => {
    await adjustAnnualTo('12')
    await waitFor(() => expect(screen.queryByLabelText(/reason for the change/i)).not.toBeInTheDocument())
  })

  // Guard: the edit form already shows the server's sentence; this keeps the
  // start-date lock (409 STAFF_START_DATE_LOCKED) readable to the owner.
  it("shows the server's reason when a start date is locked", async () => {
    const message =
      "Sarah's start date stays 2025-06-01: approved leave is already recorded against the leave cycles that run from it."
    mockPut.mockRejectedValue({ response: { status: 409, data: { code: 'STAFF_START_DATE_LOCKED', message } } })
    mockStaffList()
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit sarah/i }))
    await userEvent.clear(screen.getByLabelText(/edit start date/i))
    await userEvent.type(screen.getByLabelText(/edit start date/i), '2025-07-01')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })
})

describe('Staff working days', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPost.mockResolvedValue({ data: {} })
    mockPut.mockResolvedValue({ data: {} })
  })

  it('sends the working days the owner ticks when adding staff', async () => {
    mockStaffList([])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])

    await userEvent.type(screen.getByLabelText(/^name/i), 'Thandi')
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '60')
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }))
    }
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sat' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sun' }))
    await userEvent.click(submitAddStaff())

    await waitFor(() => expect(mockPost).toHaveBeenCalled())
    expect(mockPost.mock.calls[0][1]).toMatchObject({ workDays: [0, 5, 6] })
  })

  it('refuses a staff member with no working days', async () => {
    mockStaffList([])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('No staff yet')).toBeInTheDocument())
    await userEvent.click(screen.getAllByRole('button', { name: /add staff/i })[0])

    await userEvent.type(screen.getByLabelText(/^name/i), 'Thandi')
    await userEvent.type(screen.getByLabelText(/hourly rate/i), '60')
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      await userEvent.click(screen.getByRole('checkbox', { name: day }))
    }
    await userEvent.click(submitAddStaff())

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one working day/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows the saved pattern in the edit form', async () => {
    mockStaffList([{ ...mockStaffMember, workDays: [5, 6, 0] }])
    renderAs('owner', <Staff />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /edit sarah/i }))

    expect(screen.getByRole('checkbox', { name: 'Sat' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked()
  })
})
