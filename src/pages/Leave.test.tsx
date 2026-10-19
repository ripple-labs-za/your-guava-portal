import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { AuthContext } from '@/contexts/AuthContext'
import userEvent from '@testing-library/user-event'
import Leave from './Leave'
import type { ReactNode } from 'react'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPut = vi.fn()
const mockPost = vi.fn()
vi.mock('@/lib/api', () => {
  return {
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

function renderWithAuth(ui: ReactNode) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: 'Test Owner',
    role: 'owner' as const,
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
          isOwner: true,
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

describe('Leave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders leave request list', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({ data: { calendar: [] } })
      }
      if (url.includes('/leave/balances')) {
        return Promise.resolve({ data: { balances: [] } })
      }
      if (url.includes('/leave')) {
        return Promise.resolve({
          data: {
            requests: [
              {
                _id: 'lr1',
                staffId: { _id: 'staff1', name: 'Sarah' },
                cafeId: 'cafe1',
                type: 'annual',
                startDate: '2026-04-01',
                endDate: '2026-04-05',
                days: 5,
                status: 'pending',
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
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Sarah')).toBeInTheDocument()
    })

    // "5" appears in the days column and possibly in the calendar
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('shows filter tabs (All, Pending, Approved, Rejected)', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { requests: [], staff: [], calendar: [] } })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument()
    })

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })

  it('shows approve/reject buttons for pending requests', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({ data: { calendar: [] } })
      }
      if (url.includes('/leave')) {
        return Promise.resolve({
          data: {
            requests: [
              {
                _id: 'lr1',
                staffId: { _id: 'staff1', name: 'Sarah' },
                cafeId: 'cafe1',
                type: 'annual',
                startDate: '2026-04-01',
                endDate: '2026-04-05',
                days: 5,
                status: 'pending',
              },
            ],
          },
        })
      }
      if (url.includes('/staff')) {
        return Promise.resolve({ data: { staff: [] } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Sarah')).toBeInTheDocument()
    })

    // Approve and reject action buttons
    const approveButtons = document.querySelectorAll('button[class*="text-guava-green"]')
    const rejectButtons = document.querySelectorAll('button[class*="text-guava-red"]')
    expect(approveButtons.length).toBeGreaterThanOrEqual(1)
    expect(rejectButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('renders submit leave form', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { requests: [], staff: [], calendar: [] } })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Request Leave')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Request Leave'))

    await waitFor(() => {
      expect(screen.getByText('Submit Leave Request')).toBeInTheDocument()
    })
  })
})

describe('Leave accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  function mockPending() {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({ data: { calendar: [] } })
      }
      if (url.includes('/leave')) {
        return Promise.resolve({
          data: {
            requests: [
              {
                _id: 'lr1',
                staffId: { _id: 'staff1', name: 'Sarah' },
                cafeId: 'cafe1',
                type: 'annual',
                startDate: '2026-04-01',
                endDate: '2026-04-05',
                days: 5,
                status: 'pending',
              },
              {
                _id: 'lr2',
                staffId: { _id: 'staff2', name: 'Thabo' },
                cafeId: 'cafe1',
                type: 'sick',
                startDate: '2026-05-11',
                endDate: '2026-05-12',
                days: 2,
                status: 'pending',
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
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: {} })
    })
  }

  it('names the calendar month arrows after what they do', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { requests: [], staff: [], calendar: [] } })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Leave Calendar')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /previous month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next month/i })).toBeInTheDocument()
  })

  it('names each approve and reject button after the request it acts on', async () => {
    mockPending()

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Sarah')).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /Approve leave for Sarah, 0?1 Apr to 0?5 Apr/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Reject leave for Sarah, 0?1 Apr to 0?5 Apr/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Approve leave for Thabo, 11 May to 12 May/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Reject leave for Thabo, 11 May to 12 May/i })
    ).toBeInTheDocument()
  })

  it('approving uses the row-specific button and calls the right request', async () => {
    mockPending()
    mockPut.mockResolvedValue({ data: {} })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Thabo')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Thabo/i }))
    await userEvent.click(
      await screen.findByRole('button', { name: /^Approve 2 days$/i })
    )

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/leave/lr2/approve')
    })
  })

  it('labels every control in the submit leave form', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      return Promise.resolve({ data: { requests: [], staff: [], calendar: [] } })
    })

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Request Leave')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Request Leave'))

    await waitFor(() => {
      expect(screen.getByText('Submit Leave Request')).toBeInTheDocument()
    })

    expect(screen.getByRole('combobox', { name: /staff/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /leave type/i })).toBeInTheDocument()
  })

  it('leaves no button on the page without an accessible name', async () => {
    mockPending()

    renderWithAuth(<Leave />)

    await waitFor(() => {
      expect(screen.getByText('Sarah')).toBeInTheDocument()
    })

    for (const button of screen.getAllByRole('button')) {
      const name = button.getAttribute('aria-label') || button.textContent
      expect(name?.trim()).toBeTruthy()
    }
  })
})

function mockSinglePendingRequest(overrides: Record<string, unknown> = {}) {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/leave/calendar')) return Promise.resolve({ data: { calendar: [] } })
    if (url.includes('/leave')) {
      return Promise.resolve({
        data: {
          requests: [
            {
              _id: 'lr1',
              staffId: { _id: 'staff1', name: 'Sarah' },
              cafeId: 'cafe1',
              type: 'annual',
              startDate: '2026-04-01',
              endDate: '2026-04-05',
              days: 5,
              status: 'pending',
              ...overrides,
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
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: {} })
  })
}

// Approval spends the balance straight away (used days are derived from approved
// requests in the cycle), so a misclick on a 28px icon button sitting 4px from
// its opposite still costs someone their leave until it is noticed. Approval is
// reversible now - the owner can cancel an approved request and the days return
// (BE-08-T02) - but the confirmation still stands between a stray click and that.
describe('Leave approval confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  async function openApprovalConfirmation() {
    mockSinglePendingRequest()
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Sarah/i }))
    return screen.findByRole('dialog')
  }

  it('does not approve on the first click', async () => {
    mockSinglePendingRequest()
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Sarah/i }))

    expect(mockPut).not.toHaveBeenCalled()
  })

  it('names the person, the leave type and the exact day count', async () => {
    const dialog = await openApprovalConfirmation()

    expect(dialog).toHaveTextContent('Sarah')
    expect(dialog).toHaveTextContent(/annual/i)
    expect(dialog).toHaveTextContent(/5 days/i)
  })

  // Guard (BE-08-T04 fix-back): the server refuses approval over rostered shifts
  // with LEAVE_HAS_SHIFTS; the page shows its sentence, which says what to do.
  it('shows why approval was refused when the person has shifts on those days', async () => {
    const message =
      'Sarah has shifts on 2026-04-02 and 2026-04-03 during this leave. Move or cancel those shifts first, then approve the leave.'
    mockPut.mockRejectedValue({ response: { status: 409, data: { code: 'LEAVE_HAS_SHIFTS', message } } })
    await openApprovalConfirmation()
    await userEvent.click(screen.getByRole('button', { name: /^Approve \d+ days?$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('says the balance is spent and that approved leave can be cancelled later', async () => {
    const dialog = await openApprovalConfirmation()

    expect(dialog).toHaveTextContent(/balance/i)
    expect(dialog).toHaveTextContent(/cancel the approved leave later/i)
    expect(dialog).not.toHaveTextContent(/cannot be undone/i)
  })

  it('approves only after the confirmation is accepted', async () => {
    await openApprovalConfirmation()

    await userEvent.click(screen.getByRole('button', { name: /^Approve 5 days$/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/leave/lr1/approve'))
  })

  it('leaves the balance alone when the confirmation is dismissed', async () => {
    await openApprovalConfirmation()

    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('closes on Escape without approving', async () => {
    await openApprovalConfirmation()

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPut).not.toHaveBeenCalled()
  })

  // Landing focus on the destructive button is how a stray Enter approves leave.
  it('opens with focus on the safe choice', async () => {
    await openApprovalConfirmation()

    expect(screen.getByRole('button', { name: /^Cancel$/ })).toHaveFocus()
  })

  it('confirms rejection too, and says a new request would be needed', async () => {
    mockSinglePendingRequest()
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Reject leave for Sarah/i }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sarah')
    expect(dialog).toHaveTextContent(/new request/i)
    expect(mockPut).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /^Reject request$/i }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/leave/lr1/reject'))
  })

  it('describes a single-day request without pluralising', async () => {
    mockSinglePendingRequest({ days: 1, endDate: '2026-04-01' })
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Sarah/i }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(/\b1 day\b/)
  })

  // Unpaid leave does not touch a balance, so the warning must not claim it does.
  it('does not claim a balance is spent for unpaid leave', async () => {
    mockSinglePendingRequest({ type: 'unpaid' })
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Sarah/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/cancel it later/i)
    expect(dialog).not.toHaveTextContent(/leave balance/i)
  })
})

describe('Leave failure feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
    mockPost.mockResolvedValue({ data: {} })
  })

  it('shows the server reason when an approval is refused', async () => {
    mockSinglePendingRequest()
    mockPut.mockRejectedValue({
      response: { data: { message: 'Insufficient annual leave balance to approve' } },
    })

    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Approve leave for Sarah/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^Approve 5 days$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Insufficient annual leave balance to approve'
    )
  })

  it('shows the server reason when a leave request is refused', async () => {
    mockSinglePendingRequest()
    mockPost.mockRejectedValue({
      response: {
        data: { message: 'Insufficient annual leave balance. 3 day(s) remaining, 5 requested.' },
      },
    })

    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Request Leave'))
    await screen.findByText('Submit Leave Request')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /staff/i }), 'staff1')
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-04-01' } })
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-04-07' } })
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/3 day\(s\) remaining/)
  })

  // A dropped connection used to render as a confident "No leave requests",
  // telling the owner in the product's own voice that their data does not exist.
  it('tells the owner the list failed to load instead of showing it as empty', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) return Promise.resolve({ data: { calendar: [] } })
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Network Error'))
    })

    renderWithAuth(<Leave />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
    expect(screen.queryByText('No leave requests')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('constrains the end date to the chosen start date', async () => {
    mockSinglePendingRequest()

    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Request Leave'))
    await screen.findByText('Submit Leave Request')

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-04-10' } })
    expect(screen.getByLabelText(/end date/i)).toHaveAttribute('min', '2026-04-10')
  })

  // Date ordering is prevented at source by `min`, which the browser enforces.
  // A weekend-only period is the slip `min` cannot express: it is a valid range
  // that the backend still rejects with 'Leave period must include at least one
  // weekday' -- a 400 the form used to discard, leaving Submit doing nothing.
  it('explains a weekend-only period instead of submitting it', async () => {
    mockSinglePendingRequest()

    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Request Leave'))
    await screen.findByText('Submit Leave Request')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /staff/i }), 'staff1')
    // 2026-04-11 is a Saturday, 2026-04-12 the Sunday after it.
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-04-11' } })
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-04-12' } })
    await userEvent.click(screen.getByRole('button', { name: /submit request/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/none of Sarah's working days/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  // The backend charges weekdays only, so a Friday-to-Monday request an owner
  // reads as four days is billed as two. Showing the count the server will use
  // is the only way to judge a request against a balance before submitting.
  it('previews the weekday count the backend will actually charge', async () => {
    mockSinglePendingRequest()

    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Request Leave'))
    await screen.findByText('Submit Leave Request')

    // 2026-04-10 is a Friday, 2026-04-13 the following Monday.
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-04-10' } })
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-04-13' } })

    expect(await screen.findByText(/2 working days/i)).toBeInTheDocument()
  })
})

describe('Leave calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // The whole reason to look at a leave calendar is to spot the day too many
  // people are off. A fixed-height cell with overflow-hidden clipped exactly
  // that day to three names and gave no hint the rest existed.
  it('does not silently clip a heavily-booked day', async () => {
    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-15`
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({
          data: {
            calendar: [
              {
                date: dateStr,
                staff: [
                  { name: 'Sarah', type: 'annual' },
                  { name: 'Thabo', type: 'annual' },
                  { name: 'Ayanda', type: 'sick' },
                  { name: 'Nomsa', type: 'family' },
                  { name: 'Pieter', type: 'annual' },
                ],
              },
            ],
          },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: { requests: [], staff: [] } })
    })

    renderWithAuth(<Leave />)

    const overflow = await screen.findByText('+3 more')
    expect(overflow).toBeInTheDocument()
    // The clipped names still have to be reachable, not merely counted.
    expect(overflow).toHaveAttribute('title', expect.stringContaining('Nomsa'))
    expect(overflow.getAttribute('title')).toContain('Pieter')
  })
})

function mockSingleApprovedRequest() {
  mockGet.mockImplementation((url: string) => {
    if (url.includes('/leave/calendar')) return Promise.resolve({ data: { calendar: [] } })
    if (url.includes('/leave')) {
      return Promise.resolve({
        data: {
          requests: [
            {
              _id: 'lr9',
              staffId: { _id: 'staff1', name: 'Sarah' },
              cafeId: 'cafe1',
              type: 'annual',
              startDate: '2026-02-02',
              endDate: '2026-02-06',
              days: 5,
              status: 'approved',
            },
          ],
        },
      })
    }
    if (url.includes('/staff')) {
      return Promise.resolve({
        data: { staff: [{ _id: 'staff1', name: 'Sarah', role: 'barista', hourlyRate: 45, startDate: '2025-01-06', isActive: true }] },
      })
    }
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: {} })
  })
}

describe('Leave cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  async function openCancelConfirmation() {
    mockSingleApprovedRequest()
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Cancel approved leave for Sarah/i }))
    return screen.findByRole('dialog')
  }

  it('offers the owner a cancel control named after the approved request', async () => {
    mockSingleApprovedRequest()
    renderWithAuth(<Leave />)
    expect(await screen.findByRole('button', { name: /Cancel approved leave for Sarah/i })).toBeInTheDocument()
  })

  it('says the days go back to the balance before cancelling', async () => {
    const dialog = await openCancelConfirmation()
    expect(dialog).toHaveTextContent(/5 days go back to their annual leave balance/i)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('cancels only after the confirmation is accepted', async () => {
    await openCancelConfirmation()
    await userEvent.click(screen.getByRole('button', { name: /^Cancel the leave$/i }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/leave/lr9/cancel', {}))
  })

  it('keeps the leave when the owner chooses to keep it', async () => {
    await openCancelConfirmation()
    await userEvent.click(screen.getByRole('button', { name: /^Keep it$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('offers a Cancelled filter', async () => {
    mockSingleApprovedRequest()
    renderWithAuth(<Leave />)
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
  })
})

describe('Leave on the working pattern', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPost.mockResolvedValue({ data: {} })
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({ data: { calendar: [{ date: '2026-10-03', staff: [{ name: 'Thabo', type: 'annual' }] }] } })
      }
      if (url.includes('/leave')) return Promise.resolve({ data: { requests: [] } })
      if (url.includes('/staff')) {
        return Promise.resolve({
          data: {
            staff: [
              { _id: 'staff2', name: 'Thabo', role: 'barista', hourlyRate: 45, startDate: '2025-01-01', isActive: true, workDays: [5, 6, 0] },
            ],
          },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: {} })
    })
  })

  it("counts a weekend worker's Saturday and Sunday and submits them", async () => {
    renderWithAuth(<Leave />)
    await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Request Leave'))
    await screen.findByText('Submit Leave Request')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /staff/i }), 'staff2')
    // 2026-10-03 is a Saturday, 2026-10-04 the Sunday after it.
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-10-03' } })
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: '2026-10-04' } })
    expect(await screen.findByText(/2 working days/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /submit request/i }))
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/leave',
        expect.objectContaining({ staffId: 'staff2', startDate: '2026-10-03', endDate: '2026-10-04' })
      )
    )
  })

  // Guard, not a red test: the grid already renders any date the API returns.
  // The defect was the backend dropping weekends; this keeps the grid honest.
  it('shows leave that falls on a Saturday of the month on screen', async () => {
    const today = new Date()
    const first = new Date(today.getFullYear(), today.getMonth(), 1, 12)
    const saturday = new Date(today.getFullYear(), today.getMonth(), 1 + ((6 - first.getDay() + 7) % 7), 12)
    const pad = (n: number) => String(n).padStart(2, '0')
    const key = `${saturday.getFullYear()}-${pad(saturday.getMonth() + 1)}-${pad(saturday.getDate())}`
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/leave/calendar')) {
        return Promise.resolve({ data: { calendar: [{ date: key, staff: [{ name: 'Thabo', type: 'annual' }] }] } })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.resolve({ data: { requests: [], staff: [] } })
    })

    renderWithAuth(<Leave />)

    expect(await screen.findByText('Thabo')).toBeInTheDocument()
  })
})


it('limits the leave reason to 500 characters', async () => {
  mockSinglePendingRequest()
  renderWithAuth(<Leave />)
  await waitFor(() => expect(screen.getByText('Request Leave')).toBeInTheDocument())
  await userEvent.click(screen.getByText('Request Leave'))
  expect(await screen.findByLabelText(/reason/i)).toHaveAttribute('maxlength', '500')
})
