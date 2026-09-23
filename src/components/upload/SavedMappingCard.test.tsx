import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SavedMappingCard } from './SavedMappingCard'

const mockGet = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    post: vi.fn(),
    put: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { baseURL: 'http://localhost:5000/api' },
  },
}))

const SAVED = {
  mapping: { date: 'Sale Date', items: 'Description', total: 'Total', status: 'Status' },
  itemsMode: 'packed',
  sourceHeaders: ['Txn', 'Sale Date', 'Description', 'Total', 'Status'],
  savedAt: '2026-09-14T08:00:00.000Z',
  sourceUploadId: 'u1',
  sourceFileName: 'week-1.csv',
}

describe('SavedMappingCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ data: { success: true, savedColumnMapping: SAVED } })
  })

  it('shows which column feeds each field and which file the mapping came from', async () => {
    render(<SavedMappingCard canClear />)
    expect(await screen.findByText('Sale Date')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText(/saved from week-1\.csv/i)).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('/cafe/me/column-mapping', expect.anything())
  })

  it('lets the owner forget it, after which the wizard asks again', async () => {
    mockDelete.mockResolvedValue({ data: { success: true, savedColumnMapping: null } })
    render(<SavedMappingCard canClear />)
    fireEvent.click(await screen.findByRole('button', { name: /forget this mapping/i }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/cafe/me/column-mapping'))
    expect(await screen.findByText(/saved mapping forgotten/i)).toBeInTheDocument()
    expect(screen.queryByText('Sale Date')).not.toBeInTheDocument()
  })

  it('does not offer a manager the button', async () => {
    render(<SavedMappingCard canClear={false} />)
    await screen.findByText('Sale Date')
    expect(screen.queryByRole('button', { name: /forget this mapping/i })).not.toBeInTheDocument()
  })

  it('says what happens when there is no saved mapping', async () => {
    mockGet.mockResolvedValue({ data: { success: true, savedColumnMapping: null } })
    render(<SavedMappingCard canClear />)
    expect(await screen.findByText(/no saved mapping/i)).toBeInTheDocument()
  })
})
