import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@/test/test-utils'
import Connect from './Connect'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock ColumnMappingWizard for wizard-appearance tests
vi.mock('@/components/upload/ColumnMappingWizard', () => ({
  ColumnMappingWizard: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? (
      <div data-testid="column-mapping-wizard">
        Map your CSV columns
        <button onClick={onCancel}>Cancel mapping</button>
      </div>
    ) : null,
}))

// Mock UploadHistoryCard to avoid API calls in tests. `isDuplicateUploadMessage`
// is the shared duplicate-detection helper Connect imports from the same module,
// so it has to keep its real behaviour here.
vi.mock('@/components/upload/UploadHistoryCard', () => ({
  UploadHistoryCard: () => <div data-testid="upload-history-card" />,
  isDuplicateUploadMessage: (message?: string | null) => /already exist/i.test(message || ''),
}))

// Mock the api module. Partial: AuthProvider reads API_CONFIG_ERROR and
// isSessionRejection from it while rendering, and a factory that omits them
// makes vitest throw the moment one is touched.
const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    refreshAccessToken: () => Promise.resolve('test-access-token'),
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

describe('Connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Default mocks
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ data: { id: 'u1', role: 'owner', name: 'Test', email: 't@x.za' } })
      }
      if (url.includes('/cafe/me')) {
        return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      }
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
  })

  it('renders upload dropzone', async () => {
    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })
  })

  it('shows file type validation error for invalid file', async () => {
    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    // Create an invalid file and use fireEvent for the hidden input
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    // Use fireEvent.change instead of userEvent.upload for hidden inputs
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/invalid file type/i)).toBeInTheDocument()
    })
  })

  it('tells a .xls owner to save as CSV UTF-8, not .xlsx', async () => {
    render(<Connect />)
    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const file = new File(['ÐÏà'], 'Melkies Sale DEC 25.xls', { type: 'application/vnd.ms-excel' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/CSV UTF-8/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/\.xlsx, then upload/i)).toBeNull()
  })

  it('accepts uppercase CSV and XLSX extensions', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url.includes('/transactions/upload')) {
        return Promise.resolve({
          data: {
            uploadId: 'mock-id',
            posType: 'wizard',
            columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
            itemsMode: 'packed',
            headers: ['Date', 'Items', 'Total'],
            preview: [],
            needsConfirmation: false,
          },
        })
      }
      if (url.includes('/uploads/mock-id/confirm')) {
        return Promise.resolve({
          data: { stats: { imported: 1, skipped: 0, errors: 0, totalRows: 1 } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const file = new File(['col1,col2\n1,2'], 'SALES.XLSX', { type: '' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        '/transactions/upload',
        expect.any(FormData),
        expect.any(Object)
      )
    })
  })

  it('shows size validation error for files over 10 MB', async () => {
    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [oversized] } })

    await waitFor(() => {
      expect(screen.getByText(/too large/i)).toBeInTheDocument()
    })
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows upload progress during upload', async () => {
    mockPost.mockImplementation(() => new Promise(() => {})) // Hang to stay in uploading state

    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const file = new File(['col1,col2\n1,2'], 'data.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getAllByText(/uploading/i).length).toBeGreaterThan(0)
    })
  })

  it('shows success state with import count after upload', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url.includes('/transactions/upload')) {
        return Promise.resolve({
          data: {
            uploadId: 'mock-id',
            posType: 'wizard',
            columnMapping: { date: 'Date', total: 'Total' },
            itemsMode: 'packed',
            headers: ['Date', 'Total'],
            preview: [],
            needsConfirmation: false,
          },
        })
      }
      if (url.includes('/uploads/mock-id/confirm')) {
        return Promise.resolve({
          data: { stats: { imported: 500, skipped: 10, errors: 0, totalRows: 510 } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const file = new File(['col1,col2\n1,2'], 'data.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Import successful')).toBeInTheDocument()
    })

    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('510')).toBeInTheDocument()
  })

  it('says how many sales were already imported and from which file', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url.includes('/transactions/upload')) {
        return Promise.resolve({
          data: {
            uploadId: 'mock-id',
            posType: 'wizard',
            columnMapping: { date: 'Date', total: 'Total' },
            itemsMode: 'packed',
            headers: ['Date', 'Total'],
            preview: [],
            needsConfirmation: false,
          },
        })
      }
      if (url.includes('/uploads/mock-id/confirm')) {
        return Promise.resolve({
          data: {
            stats: { imported: 14, skipped: 15, errors: 0, totalRows: 29 },
            overlap: { rows: 15, uploads: [{ uploadId: 'a1', fileName: 'receiptless-a.csv', rows: 15 }] },
          },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)
    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })
    const file = new File(['col1,col2\n1,2'], 'receiptless-b.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Import successful')).toBeInTheDocument()
    })
    expect(screen.getByText(/15 sales were already in Your Guava from receiptless-a\.csv/i)).toBeInTheDocument()
  })

  it('opens the mapping wizard when needsConfirmation is true', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/transactions/upload') {
        return Promise.resolve({
          data: {
            uploadId: 'u1',
            posType: 'wizard',
            columnMapping: { date: 'When' },
            itemsMode: 'packed',
            headers: ['When', 'Items', 'Total'],
            preview: [],
            needsConfirmation: true,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    render(<Connect />)

    await waitFor(() => {
      expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
    })

    const file = new File(['When,Items,Total\n2026-01-01,Coffee,50'], 'data.csv', { type: 'text/csv' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByTestId('column-mapping-wizard')).toBeInTheDocument()
    })

    expect(screen.getByText('Map your CSV columns')).toBeInTheDocument()
  })

  it('recovers a completed import after the confirmation response is lost', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/transactions/upload') {
        return Promise.resolve({
          data: {
            uploadId: 'mock-id',
            posType: 'yoco',
            columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
            itemsMode: 'packed',
            headers: ['Date', 'Items', 'Total'],
            preview: [],
            needsConfirmation: false,
          },
        })
      }
      if (url === '/uploads/mock-id/confirm') return Promise.reject(new Error('timeout'))
      return Promise.reject(new Error('Unknown URL'))
    })
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) {
        return Promise.resolve({ data: { id: 'u1', role: 'owner', name: 'Test', email: 't@x.za' } })
      }
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
        })
      }
      if (url === '/uploads/mock-id') {
        return Promise.resolve({
          data: {
            upload: {
              _id: 'mock-id',
              status: 'completed',
              stats: { imported: 12, skipped: 0, errors: 1, totalRows: 13 },
              dateRange: {},
              rowErrors: [{ rowNumber: 4, reason: 'Invalid total' }],
              maintenance: { status: 'queued' },
            },
          },
        })
      }
      if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['Date,Items,Total'], 'data.csv', { type: 'text/csv' })] },
    })

    expect(await screen.findByText(/recovered from server status/i)).toBeInTheDocument()
    expect(screen.getByText(/1 row was not imported/i)).toBeInTheDocument()
    expect(screen.getByText(/Row 4: Invalid total/i)).toBeInTheDocument()
  })
})

const stageOnly = (needsConfirmation: boolean) => (url: string) => {
  if (url === '/transactions/upload') {
    return Promise.resolve({
      data: {
        uploadId: 'u1',
        posType: 'wizard',
        columnMapping: { date: 'When', items: 'Items', total: 'Total' },
        itemsMode: 'packed',
        headers: ['When', 'Items', 'Total'],
        preview: [],
        needsConfirmation,
      },
    })
  }
  return Promise.resolve({ data: {} })
}

function dropFiles(files: File[]) {
  const zone = screen.getByRole('button', { name: /choose a sales csv or xlsx file/i })
  fireEvent.drop(zone, { dataTransfer: { files } })
}

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

describe('Connect first-run guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: { id: 'u1', role: 'owner' } })
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
  })

  it('states the size limit, row cap and required columns before a file is chosen', async () => {
    render(<Connect />)

    await screen.findByText(/drop your sales csv/i)
    expect(screen.getByText(/up to 10 MB/i)).toBeInTheDocument()
    expect(screen.getByText(/up to 10\s?000 rows/i)).toBeInTheDocument()
    expect(screen.getByText(/needs a date column/i)).toBeInTheDocument()
  })

  it('tells an owner what to do about an oversized export', async () => {
    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)

    pickFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'year.xlsx', { type: '' }))

    expect(await screen.findByText(/split the file by month/i)).toBeInTheDocument()
  })

  it('tells an owner how to convert a legacy .xls export', async () => {
    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)

    pickFile(new File(['x'], 'sales.xls', { type: 'application/vnd.ms-excel' }))

    expect(await screen.findByText(/Save As/i)).toBeInTheDocument()
  })

  it('turns the server row-cap rejection into an instruction', async () => {
    mockPost.mockRejectedValue({ response: { status: 400, data: { message: 'File exceeds the 10000 row limit' } } })

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'year.csv', { type: 'text/csv' }))

    expect(await screen.findByText(/shorter date ranges/i)).toBeInTheDocument()
  })

  it('says which dropped file it took and what to do with the rest', async () => {
    mockPost.mockImplementation(() => new Promise(() => {}))

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)

    dropFiles([
      new File(['a'], 'june.csv', { type: 'text/csv' }),
      new File(['b'], 'july.csv', { type: 'text/csv' }),
      new File(['c'], 'august.csv', { type: 'text/csv' }),
    ])

    expect(await screen.findByText(/Only june\.csv is being imported/i)).toBeInTheDocument()
    expect(screen.getByText(/drop the other 2 files/i)).toBeInTheDocument()
  })

  it('gives each coverage square a name and states the gap count in words', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: { id: 'u1', role: 'owner' } })
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: {
            data: {
              latestDataDate: '2026-09-02',
              earliestDataDate: '2026-04-01',
              daysSinceLatest: 1,
              totalTransactions: 7743,
              coverage30d: [],
            },
          },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)

    expect(
      await screen.findByText(/30 of the last 30 completed days have no data/i)
    ).toBeInTheDocument()
    // Today is in progress, not missing: it is drawn but never counted as a gap,
    // so a cafe with no sales yet this morning is not told it has left a hole.
    expect(screen.getByText(/today is still in progress/i)).toBeInTheDocument()
    const days = screen.getAllByRole('listitem')
    expect(days).toHaveLength(31)
    expect(days[0]).toHaveAccessibleName(/0 transactions/)
    expect(days[30]).toHaveAccessibleName(/^Today: 0 transactions so far$/)
  })
})

describe('Connect upload outcomes are announced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: { id: 'u1', role: 'owner' } })
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
  })

  it('announces a failure as an alert', async () => {
    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)

    pickFile(new File(['x'], 'notes.pdf', { type: 'application/pdf' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/upload failed/i)
    expect(alert).toHaveTextContent(/invalid file type/i)
  })

  it('announces success and offers the forecast as the next step', async () => {
    mockPost.mockImplementation((url: string) => {
      if (url === '/transactions/upload') return stageOnly(false)(url)
      if (url === '/uploads/u1/confirm') {
        return Promise.resolve({ data: { stats: { imported: 500, skipped: 0, errors: 0, totalRows: 500 } } })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/import successful/i)
    expect(screen.getByRole('link', { name: /see today's forecast/i })).toHaveAttribute('href', '/today')
  })

  it('describes the import progress as a dialog with a progress bar', async () => {
    mockPost.mockImplementation(() => new Promise(() => {}))

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

    const dialog = await screen.findByRole('dialog', { name: /uploading file/i })
    expect(dialog).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: /import progress/i })
    expect(bar).toHaveAttribute('aria-valuenow', '20')
  })

  it('lets an owner abandon an upload that is still in flight', async () => {
    mockPost.mockImplementation(() => new Promise(() => {}))

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

    await screen.findByRole('dialog', { name: /uploading file/i })
    fireEvent.click(screen.getByRole('button', { name: /cancel upload/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/drop your sales csv/i)).toBeInTheDocument()
  })
})

describe('Connect mapping wizard lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/auth/me')) return Promise.resolve({ data: { id: 'u1', role: 'owner' } })
      if (url.includes('/transactions/status')) {
        return Promise.resolve({
          data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
    mockPost.mockImplementation(stageOnly(true))
  })

  it('takes the drop zone away while the wizard is open', async () => {
    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

    await screen.findByTestId('column-mapping-wizard')
    expect(screen.queryByRole('button', { name: /choose a sales csv or xlsx file/i })).not.toBeInTheDocument()
  })

  it('warns that cancelling throws the staged file away', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<Connect />)
    await screen.findByText(/drop your sales csv/i)
    pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

    await screen.findByTestId('column-mapping-wizard')
    fireEvent.click(screen.getByRole('button', { name: /cancel mapping/i }))

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/discard this file/i))
    expect(screen.getByTestId('column-mapping-wizard')).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /cancel mapping/i }))
    await waitFor(() => expect(screen.queryByTestId('column-mapping-wizard')).not.toBeInTheDocument())

    confirmSpy.mockRestore()
  })
})

describe('Connect slow-import recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does not call a still-running import a failure', async () => {
    vi.useFakeTimers()
    try {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/auth/me')) return Promise.resolve({ data: { id: 'u1', role: 'owner' } })
        if (url.includes('/transactions/status')) {
          return Promise.resolve({
            data: { data: { latestDataDate: null, earliestDataDate: null, daysSinceLatest: null, totalTransactions: 0, coverage30d: [] } },
          })
        }
        if (url === '/uploads/u1') {
          return Promise.resolve({ data: { upload: { _id: 'u1', status: 'parsing', stats: {}, dateRange: {} } } })
        }
        return Promise.reject(new Error('Unknown URL'))
      })
      mockPost.mockImplementation((url: string) => {
        if (url === '/transactions/upload') return stageOnly(false)(url)
        if (url === '/uploads/u1/confirm') {
          return Promise.reject({ response: { status: 504 }, message: 'timeout' })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      render(<Connect />)
      await vi.advanceTimersByTimeAsync(0)
      pickFile(new File(['a,b'], 'data.csv', { type: 'text/csv' }))

      // The whole backoff window, plus slack. Advanced in slices so timers
      // scheduled by an awaited step are picked up by the next slice.
      for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(5_000)

      expect(screen.getByText(/still importing/i)).toBeInTheDocument()
      expect(screen.getByText(/Do not upload it again/i)).toBeInTheDocument()
      expect(screen.queryByText(/upload failed/i)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
