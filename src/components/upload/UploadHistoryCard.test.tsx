import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { UploadHistoryCard, isDuplicateUploadMessage } from './UploadHistoryCard'
import type { Upload, UploadListItem } from '@/types/upload'

const mockGet = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    defaults: { baseURL: 'http://localhost:5000/api' },
  },
}))

function buildUpload(overrides: Partial<Upload> & { _id: string; fileName: string }): Upload {
  return {
    cafeId: 'cafe1',
    posType: 'yoco',
    status: 'completed',
    stats: { imported: 120, skipped: 0, errors: 0, total: 120 },
    dateRange: { firstDate: '2026-08-01', lastDate: '2026-08-28' },
    createdAt: '2026-09-03T08:30:00.000Z',
    ...overrides,
  } as Upload
}

const UPLOADS = [
  buildUpload({ _id: 'up1', fileName: 'demo-cafe-12w.csv' }),
  buildUpload({ _id: 'up2', fileName: 'august-sales.xlsx', posType: 'wizard' }),
]

function renderCard() {
  return render(
    <BrowserRouter>
      <UploadHistoryCard />
    </BrowserRouter>
  )
}

describe('UploadHistoryCard accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ data: { success: true, uploads: UPLOADS } })
  })

  it('makes the mobile history table a named keyboard scroll region', async () => {
    renderCard()
    const table = await screen.findByRole('table', { name: 'Files imported into Your Guava, newest first' })
    const region = screen.getByRole('region', { name: 'Upload history' })
    expect(region).toContainElement(table)
    expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    expect(region).toHaveFocus()
  })

  it('names each View link after the upload it opens', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByText('demo-cafe-12w.csv')).toBeInTheDocument()
    })

    const first = screen.getByRole('link', { name: /View import of demo-cafe-12w\.csv/i })
    const second = screen.getByRole('link', { name: /View import of august-sales\.xlsx/i })

    expect(first).toHaveAttribute('href', '/uploads/up1')
    expect(second).toHaveAttribute('href', '/uploads/up2')
  })

  it('keeps "View" as the visible text so the accessible name still contains it', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByText('demo-cafe-12w.csv')).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /View import of demo-cafe-12w\.csv/i })
    expect(link.textContent).toMatch(/View/)
  })

  it('gives every View link a touch target of at least 24px', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByText('demo-cafe-12w.csv')).toBeInTheDocument()
    })

    // jsdom does not lay out, so assert the utilities that produce the size.
    // 24px min-height plus vertical/horizontal padding clears WCAG 2.2 SC 2.5.8.
    for (const link of screen.getAllByRole('link', { name: /^View import of/i })) {
      expect(link.className).toMatch(/\bmin-h-6\b/)
      expect(link.className).toMatch(/\bpx-2\b/)
      expect(link.className).toMatch(/\bpy-1\b/)
    }
  })

  it('leaves no link on the card without a distinguishing accessible name', async () => {
    renderCard()

    await waitFor(() => {
      expect(screen.getByText('demo-cafe-12w.csv')).toBeInTheDocument()
    })

    const names = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') || link.textContent?.trim())

    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })
})

describe('UploadHistoryCard status copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never prints an internal status enum to the owner', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        uploads: [
          buildUpload({ _id: 'a', fileName: 'a.csv', status: 'pending_mapping', stats: { imported: 0, skipped: 0, errors: 0, totalRows: 0 } }),
          buildUpload({ _id: 'b', fileName: 'b.csv', status: 'parsing', stats: { imported: 0, skipped: 0, errors: 0, totalRows: 0 } }),
          buildUpload({ _id: 'c', fileName: 'c.csv', status: 'failed', stats: { imported: 0, skipped: 0, errors: 3, totalRows: 3 } }),
          buildUpload({ _id: 'd', fileName: 'd.csv', status: 'completed' }),
        ],
      },
    })

    renderCard()

    await waitFor(() => expect(screen.getByText('a.csv')).toBeInTheDocument())
    expect(screen.getByText('Needs mapping')).toBeInTheDocument()
    expect(screen.getByText('Importing…')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Imported')).toBeInTheDocument()
    expect(screen.queryByText('pending_mapping')).not.toBeInTheDocument()
    expect(screen.queryByText('parsing')).not.toBeInTheDocument()
  })

  it('treats a re-upload of already-stored rows as a no-op, not a failure', async () => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        uploads: [
          buildUpload({
            _id: 'dup',
            fileName: 'again.csv',
            status: 'failed',
            stats: { imported: 0, skipped: 40, errors: 0, totalRows: 40 },
            errorMessage: 'No new transactions were imported; every valid row already exists',
          }),
        ],
      },
    })

    renderCard()

    await waitFor(() => expect(screen.getByText('again.csv')).toBeInTheDocument())
    expect(screen.getByText('no new rows')).toBeInTheDocument()
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })
})

describe('UploadHistoryCard pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the true total and reaches older imports', async () => {
    mockGet.mockImplementation((_url: string, config?: { params?: { page?: number } }) => {
      const page = config?.params?.page || 1
      return Promise.resolve({
        data: {
          success: true,
          uploads: [buildUpload({ _id: `p${page}`, fileName: `page-${page}.csv` })],
          pagination: { total: 120, page, limit: 20, pages: 6 },
        },
      })
    })

    renderCard()

    await waitFor(() => expect(screen.getByText('page-1.csv')).toBeInTheDocument())
    expect(screen.getByText(/Showing 1-20 of 120 imports/i)).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 6/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page of uploads/i }))

    await waitFor(() => expect(screen.getByText('page-2.csv')).toBeInTheDocument())
    expect(mockGet).toHaveBeenLastCalledWith('/uploads', expect.objectContaining({
      params: { page: 2, limit: 20 },
    }))
  })
})

describe('isDuplicateUploadMessage', () => {
  it('recognises the API duplicate-upload wording used on both surfaces', () => {
    expect(isDuplicateUploadMessage('No new transactions were imported; every valid row already exists')).toBe(true)
    expect(isDuplicateUploadMessage('Every valid row already exists in another upload')).toBe(true)
    expect(isDuplicateUploadMessage('File exceeds the 10000 row limit')).toBe(false)
    expect(isDuplicateUploadMessage(undefined)).toBe(false)
  })
})

describe('UploadHistoryCard list contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('draws every column from the summary the list endpoint returns', async () => {
    // GET /uploads no longer carries sampleRows, headers, rowErrors,
    // columnMapping or r2Key; the table must not need them.
    const summary: UploadListItem = {
      _id: 'up9',
      cafeId: 'cafe1',
      uploadedBy: { _id: 'u1', name: 'Owner', email: 'owner@example.com' },
      fileName: 'summary-only.csv',
      fileSize: 1200,
      posType: 'wizard',
      mappingSource: 'manual',
      itemsMode: 'packed',
      status: 'completed',
      stats: { imported: 42, skipped: 0, errors: 0, totalRows: 42 },
      dateRange: { firstDate: '2026-08-01', lastDate: '2026-08-07' },
      createdAt: '2026-09-03T08:30:00.000Z',
    }
    mockGet.mockResolvedValue({ data: { success: true, uploads: [summary] } })
    renderCard()
    await waitFor(() => expect(screen.getByText('summary-only.csv')).toBeInTheDocument())
    expect(screen.getByText('Manual mapping')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View import of summary-only\.csv/i })).toHaveAttribute('href', '/uploads/up9')
  })
})
