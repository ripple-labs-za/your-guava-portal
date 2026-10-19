import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import Roster from './Roster'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    refreshAccessToken: vi.fn().mockRejectedValue(new Error('No refresh session')),
    isSessionRejection: vi.fn(() => true),
    API_CONFIG_ERROR: null,
    API_BASE_URL: 'http://localhost:5000/api',
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

// Helper to get the current Monday as YYYY-MM-DD
function getCurrentMonday() {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  // Normalise to midday before serialising, exactly as getWeekStart does in the
  // component. Without this, toISOString() converts a local early-morning time
  // back a day in any UTC+ timezone, so between 00:00 and 02:00 SAST the mocked
  // shift landed outside the rendered week and the card never appeared. That is
  // what made this test look intermittently flaky.
  d.setHours(12, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

describe('Roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders 7-column weekly grid', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { shifts: [], staff: [], summaries: [] } })
    })

    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('Mon')).toBeInTheDocument()
    })

    expect(screen.getByText('Tue')).toBeInTheDocument()
    expect(screen.getByText('Wed')).toBeInTheDocument()
    expect(screen.getByText('Thu')).toBeInTheDocument()
    expect(screen.getByText('Fri')).toBeInTheDocument()
    expect(screen.getByText('Sat')).toBeInTheDocument()
    expect(screen.getByText('Sun')).toBeInTheDocument()
  })

  it('shows week navigation', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { shifts: [], staff: [], summaries: [] } })
    })

    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('This Week')).toBeInTheDocument()
    })

    const navButtons = screen.getAllByRole('button')
    expect(navButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('shows shift cards with staff name and time', async () => {
    const mondayStr = getCurrentMonday()

    mockGet.mockImplementation((url: string) => {
      if (url.includes('/shifts?')) {
        return Promise.resolve({
          data: {
            shifts: [
              {
                _id: 'shift1',
                staffId: { _id: 'staff1', name: 'Sarah' },
                cafeId: 'cafe1',
                date: mondayStr,
                startTime: '08:00',
                endTime: '16:00',
                hoursWorked: 8,
                type: 'regular',
                status: 'scheduled',
              },
            ],
          },
        })
      }
      if (url.includes('/staff')) {
        return Promise.resolve({
          data: {
            staff: [
              { _id: 'staff1', name: 'Sarah', role: 'barista', hourlyRate: 45, startDate: '2025-01-01', isActive: true },
            ],
          },
        })
      }
      if (url.includes('/shifts/summary')) {
        return Promise.resolve({ data: { summaries: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Roster />)

    await waitFor(() => {
      // Sarah appears in shift card AND in sidebar staff list
      expect(screen.getAllByText('Sarah').length).toBeGreaterThanOrEqual(1)
    })

    expect(screen.getByText(/08:00 — 16:00/)).toBeInTheDocument()
  })

  it('shows overtime warning badge', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/shifts?')) {
        return Promise.resolve({ data: { shifts: [] } })
      }
      if (url.includes('/staff')) {
        return Promise.resolve({
          data: {
            staff: [
              { _id: 'staff1', name: 'Sarah', role: 'barista', hourlyRate: 45, startDate: '2025-01-01', isActive: true },
            ],
          },
        })
      }
      if (url.includes('/shifts/summary')) {
        return Promise.resolve({
          data: {
            summaries: [
              { staffId: 'staff1', staffName: 'Sarah', totalHours: 50, regularHours: 45, overtimeHours: 5, estimatedPay: 2475 },
            ],
          },
        })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('OT')).toBeInTheDocument()
    })
  })
})

describe('Roster accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { shifts: [], staff: [], summaries: [] } })
    })
  })

  it('names the week navigation arrows after what they do', async () => {
    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('This Week')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /previous week/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next week/i })).toBeInTheDocument()
  })

  it('names the per-day Add Shift buttons after their day', async () => {
    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('Mon')).toBeInTheDocument()
    })

    const addButtons = screen.getAllByRole('button', { name: /^Add Shift on \w{3} \d/i })
    expect(addButtons).toHaveLength(7)
  })

  it('labels every control inside the Add Shift form', async () => {
    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('Mon')).toBeInTheDocument()
    })

    const addButtons = screen.getAllByRole('button', { name: /^Add Shift on/i })
    await userEvent.click(addButtons[0])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Add Shift$/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('combobox', { name: /^Staff$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close the add shift form/i })).toBeInTheDocument()
  })

  it('leaves no button on the page without an accessible name', async () => {
    render(<Roster />)

    await waitFor(() => {
      expect(screen.getByText('This Week')).toBeInTheDocument()
    })

    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') || button.textContent
      expect(name?.trim()).toBeTruthy()
    }
  })

  // Seven fixed columns at every breakpoint leaves each day about 38px wide on a
  // phone, which is narrower than the select and two time inputs the inline add
  // form puts inside it. SC 1.4.10 Reflow.
  // PENDING: the week grid is still fixed at seven columns below xl.
  it.skip('does not lock the week to seven columns at every breakpoint', async () => {
    const { container } = render(<Roster />)

    await waitFor(() => expect(screen.getByText('Mon')).toBeInTheDocument())

    const grid = container.querySelector('[data-testid="roster-week-grid"]')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).toMatch(/(sm|md|lg):grid-cols-/)
  })
})

function mockWeek(shifts: unknown[] = [], staff: unknown[] = []) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/shifts/summary')) return Promise.resolve({ data: { summaries: [] } })
    if (url.includes('/shifts?')) return Promise.resolve({ data: { shifts } })
    if (url.includes('/staff')) return Promise.resolve({ data: { staff } })
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: {} })
  })
}

const SARAH = {
  _id: 'staff1',
  name: 'Sarah',
  role: 'barista',
  hourlyRate: 45,
  startDate: '2025-01-01',
  isActive: true,
}

async function openAddShiftForm() {
  await waitFor(() => expect(screen.getByText('Mon')).toBeInTheDocument())
  await userEvent.click(screen.getAllByRole('button', { name: /^Add Shift on/i })[0])
  await screen.findByRole('button', { name: /^Add Shift$/i })
}

// Shift overlap detection was just added to the backend, so a 409 carrying
// 'This staff member already has a shift from 08:00 to 16:00 on 2026-04-06' is
// now a routine outcome of ordinary rostering. `await api.post('/shifts', data)`
// with no catch turned every one of those into an unhandled rejection: the
// button flickered 'Adding...', the form stayed open, and nothing was said.
// PENDING: these specify Roster behaviour that does not exist yet. They were
// written during an audit pass that was interrupted before the implementation
// landed, and are kept as the specification for that work rather than deleted.
// Roster today has no shift-removal control, does not surface the backend's
// 409 SHIFT_OVERLAP rejection, and renders a load failure as an empty week.
describe.skip('Roster shift creation failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPost.mockResolvedValue({ data: {} })
    mockWeek([], [SARAH])
  })

  it('surfaces an overlap rejection instead of failing silently', async () => {
    mockPost.mockRejectedValue({
      response: {
        data: {
          message: 'This staff member already has a shift from 08:00 to 16:00 on 2026-04-06',
        },
      },
    })

    render(<Roster />)
    await openAddShiftForm()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Staff$/i }), 'staff1')
    await userEvent.click(screen.getByRole('button', { name: /^Add Shift$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a shift/i)
  })

  it('keeps the form open after a rejection so the entry is not retyped', async () => {
    mockPost.mockRejectedValue({ response: { data: { message: 'Nope' } } })

    render(<Roster />)
    await openAddShiftForm()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Staff$/i }), 'staff1')
    await userEvent.click(screen.getByRole('button', { name: /^Add Shift$/i }))

    await screen.findByRole('alert')
    expect(screen.getByRole('combobox', { name: /^Staff$/i })).toHaveValue('staff1')
  })

  // 16:00 to 08:00 yields hoursWorked = -8 and a 400 the form did nothing to
  // prevent and nothing to explain.
  it('blocks an end time at or before the start time before calling the API', async () => {
    render(<Roster />)
    await openAddShiftForm()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Staff$/i }), 'staff1')
    fireEvent.change(screen.getByLabelText(/^Start$/i), { target: { value: '16:00' } })
    fireEvent.change(screen.getByLabelText(/^End$/i), { target: { value: '08:00' } })
    await userEvent.click(screen.getByRole('button', { name: /^Add Shift$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/end time/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows the hours a valid shift will record', async () => {
    render(<Roster />)
    await openAddShiftForm()

    fireEvent.change(screen.getByLabelText(/^Start$/i), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText(/^End$/i), { target: { value: '17:30' } })

    expect(await screen.findByText(/8\.5h/)).toBeInTheDocument()
  })
})

// Adding a shift takes four clicks and no confirmation; removing one was
// impossible, even though DELETE /shifts/:id has always existed. A mistyped
// shift permanently corrupted the week's hours -- and, because those totals
// drive the >45h overtime badge, could raise a false BCEA warning that could
// never be cleared.
// PENDING: these specify Roster behaviour that does not exist yet. They were
// written during an audit pass that was interrupted before the implementation
// landed, and are kept as the specification for that work rather than deleted.
// Roster today has no shift-removal control, does not surface the backend's
// 409 SHIFT_OVERLAP rejection, and renders a load failure as an empty week.
describe.skip('Roster shift removal', () => {
  const shift = {
    _id: 'shift1',
    staffId: { _id: 'staff1', name: 'Sarah' },
    cafeId: 'cafe1',
    date: getCurrentMonday(),
    startTime: '08:00',
    endTime: '16:00',
    hoursWorked: 8,
    type: 'regular',
    status: 'scheduled',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockDelete.mockResolvedValue({ data: {} })
    mockWeek([shift], [SARAH])
  })

  it('offers a way to remove a shift', async () => {
    render(<Roster />)

    await waitFor(() => expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0))
    expect(
      screen.getByRole('button', { name: /Remove Sarah's 08:00 to 16:00 shift/i })
    ).toBeInTheDocument()
  })

  it('does not delete on the first click', async () => {
    render(<Roster />)

    await waitFor(() => expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: /Remove Sarah's/i }))

    expect(mockDelete).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Sarah')
  })

  it('deletes the shift once confirmed', async () => {
    render(<Roster />)

    await waitFor(() => expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: /Remove Sarah's/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Remove shift$/i }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/shifts/shift1'))
  })

  it('keeps the shift when the confirmation is dismissed', async () => {
    render(<Roster />)

    await waitFor(() => expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: /Remove Sarah's/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('reports a failed deletion rather than leaving the roster unchanged in silence', async () => {
    mockDelete.mockRejectedValue({ response: { data: { message: 'Shift not found' } } })

    render(<Roster />)

    await waitFor(() => expect(screen.getAllByText('Sarah').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('button', { name: /Remove Sarah's/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Remove shift$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Shift not found')
  })
})

// PENDING: these specify Roster behaviour that does not exist yet. They were
// written during an audit pass that was interrupted before the implementation
// landed, and are kept as the specification for that work rather than deleted.
// Roster today has no shift-removal control, does not surface the backend's
// 409 SHIFT_OVERLAP rejection, and renders a load failure as an empty week.
// Active since BE-13-T07, which implements it (WS-11-T03).
describe('Roster load failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // Seven columns of "No shifts" for a fully rostered week is the product
  // telling a manager, in its own voice, that nobody is working.
  it('says the week could not be loaded instead of showing it as empty', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Network Error'))
    })

    render(<Roster />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load this week's shifts/i)
    expect(screen.queryByText('No shifts')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})


it('limits shift notes to 500 characters', async () => {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: { shifts: [], staff: [], summaries: [] } })
  })
  render(<Roster />)
  await userEvent.click(await screen.findByRole('button', { name: /^Add Shift on Mon/i }))
  expect(screen.getByLabelText(/notes/i)).toHaveAttribute('maxlength', '500')
})

describe('Roster shift rules (BE-08-T04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('marks a shift that ends the next day', async () => {
    const monday = getCurrentMonday()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/shifts?')) {
        return Promise.resolve({
          data: {
            shifts: [
              {
                _id: 'sh1',
                staffId: { _id: 'staff1', name: 'Sarah' },
                cafeId: 'cafe1',
                date: `${monday}T00:00:00.000Z`,
                startTime: '22:00',
                endTime: '02:00',
                hoursWorked: 4,
                endsNextDay: true,
                type: 'regular',
                status: 'scheduled',
              },
            ],
          },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: { staff: [], summaries: [] } })
    })

    render(<Roster />)

    expect(await screen.findByText(/22:00 — 02:00 \(next day\)/)).toBeInTheDocument()
  })

  it('says why a shift on approved leave was refused, and keeps the form open', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/staff')) {
        return Promise.resolve({
          data: { staff: [{ _id: 'staff1', name: 'Sarah', role: 'barista', hourlyRate: 45, startDate: '2025-01-01', isActive: true }] },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: { shifts: [], summaries: [] } })
    })
    mockPost.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: 'SHIFT_ON_LEAVE',
          message: 'This staff member is on approved annual leave from 2026-10-05 to 2026-10-09. Cancel that leave first, or roster someone else.',
        },
      },
    })

    render(<Roster />)
    await userEvent.click(await screen.findByRole('button', { name: /^Add Shift on Mon/i }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Staff$/i }), 'staff1')
    await userEvent.click(screen.getByRole('button', { name: /^Add Shift$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/approved annual leave/i)
    expect(screen.getByRole('combobox', { name: /^Staff$/i })).toHaveValue('staff1')
  })

  it('trusts the summary about the 45-hour weekly limit', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/shifts?')) return Promise.resolve({ data: { shifts: [] } })
      if (url.includes('/staff')) {
        return Promise.resolve({
          data: { staff: [{ _id: 'staff1', name: 'Sarah', role: 'barista', hourlyRate: 45, startDate: '2025-01-01', isActive: true }] },
        })
      }
      if (url.includes('/shifts/summary')) {
        return Promise.resolve({
          data: { summaries: [{ staffId: 'staff1', staffName: 'Sarah', totalHours: 44, regularHours: 43, overtimeHours: 1, estimatedPay: 0, overThreshold: true }] },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })

    render(<Roster />)

    expect(await screen.findByText('OT')).toBeInTheDocument()
  })
})

describe('Roster failure states (BE-13-T07)', () => {
  const serverError = { response: { status: 500, data: { success: false, message: 'Internal Server Error' } } }
  const mondayShift = () => ({
    _id: 'shift1', staffId: { _id: 'staff1', name: 'Sarah' }, cafeId: 'cafe1', date: getCurrentMonday(),
    startTime: '08:00', endTime: '16:00', hoursWorked: 8, type: 'regular', status: 'scheduled',
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('answers a 500 on the week with Could not load and a retry that recovers', async () => {
    let failing = true
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/shifts/summary')) return Promise.resolve({ data: { summaries: [] } })
      if (url.includes('/shifts?')) return failing ? Promise.reject(serverError) : Promise.resolve({ data: { shifts: [mondayShift()] } })
      if (url.includes('/staff')) return Promise.resolve({ data: { staff: [SARAH] } })
      return Promise.resolve({ data: {} })
    })
    render(<Roster />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not load this week's shifts/i)
    expect(alert).toHaveTextContent('(500)')
    expect(screen.queryByText('No shifts')).not.toBeInTheDocument()

    failing = false
    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('08:00 — 16:00')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the week but says staff and hours failed, instead of No staff found', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/shifts/summary')) return Promise.resolve({ data: { summaries: [] } })
      if (url.includes('/shifts?')) return Promise.resolve({ data: { shifts: [mondayShift()] } })
      if (url.includes('/staff')) return Promise.reject(serverError)
      return Promise.resolve({ data: {} })
    })
    render(<Roster />)

    expect(await screen.findByText('08:00 — 16:00')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff and hours/i)
    expect(screen.queryByText('No staff found')).not.toBeInTheDocument()
  })

  it('never shows zero hours when the summary failed', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      if (url.includes('/shifts/summary')) return Promise.reject(serverError)
      if (url.includes('/shifts?')) return Promise.resolve({ data: { shifts: [mondayShift()] } })
      if (url.includes('/staff')) return Promise.resolve({ data: { staff: [SARAH] } })
      return Promise.resolve({ data: {} })
    })
    render(<Roster />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load staff and hours/i)
    expect(screen.queryByText('0.0h')).not.toBeInTheDocument()
  })
})
