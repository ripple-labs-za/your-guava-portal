import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import UploadDetail from './UploadDetail'
import api from '@/lib/api'

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}))
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
const authState = vi.hoisted(() => ({
  user: { role: 'owner' as 'owner' | 'manager' },
  isLoading: false,
  isOwner: true,
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }))

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
}

function mockUploadDetail() {
  apiMock.get.mockImplementation((url: string) => {
    if (url.endsWith('/rows')) {
      return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
    }
    return Promise.resolve({
      data: {
        upload: {
          _id: 'u1',
          fileName: 'export.csv',
          status: 'completed',
          stats: { imported: 4, skipped: 0, errors: 0, totalRows: 4 },
          posType: 'yoco',
          createdAt: new Date().toISOString(),
          uploadedBy: { name: 'Shaun', email: 's@x.za' },
          dateRange: { firstDate: '2026-04-01', lastDate: '2026-04-02' },
          headers: ['Date', 'Items', 'Total'],
          sampleRows: [{ Date: '2026-04-01', Items: 'Flat White', Total: '42' }],
          columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
          itemsMode: 'packed',
        },
        downloadUrl: 'https://test.r2.local/foo',
      },
    })
  })
}

function renderUploadDetail() {
  return render(
    <MemoryRouter initialEntries={["/uploads/u1"]}>
      <Routes>
        <Route path="/uploads/:id" element={<UploadDetail />} />
        <Route path="/data-health" element={<div>Data Health page</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('UploadDetail', () => {
  beforeEach(() => {
    apiMock.get.mockReset()
    apiMock.delete.mockReset()
    apiMock.patch.mockReset()
    authState.user.role = 'owner'
    authState.isOwner = true
  })

  it('renders upload metadata and a download link', async () => {
    mockUploadDetail()
    renderUploadDetail()
    await waitFor(() => expect(screen.getByText('export.csv')).toBeInTheDocument())
    expect(screen.getByText(/POS preset/i)).toBeInTheDocument()
    expect(screen.getAllByText(/imported/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', 'https://test.r2.local/foo')
  })

  it('keeps upload metadata visible when the transaction preview fails', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.reject(new Error('rows unavailable'))
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'export.csv',
            status: 'completed',
            stats: { imported: 4, skipped: 0, errors: 0, totalRows: 4 },
            posType: 'yoco',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
          },
          downloadUrl: '',
        },
      })
    })

    renderUploadDetail()

    expect(await screen.findByText('export.csv')).toBeInTheDocument()
    expect(screen.getByText('Transactions could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows a retryable error instead of a false not-found state', async () => {
    apiMock.get.mockRejectedValue(new Error('offline'))

    renderUploadDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload details could not be loaded.')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText('Not found.')).not.toBeInTheDocument()
  })

  it('shows captured row-level import errors', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'partial-errors.csv',
            status: 'completed',
            stats: { imported: 1, skipped: 0, errors: 1, totalRows: 2 },
            posType: 'wizard',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            dateRange: { firstDate: '2026-04-01', lastDate: '2026-04-01' },
            rowErrors: [
              {
                rowNumber: 3,
                reason: 'Could not parse date or time',
                raw: { Receipt: 'R501', Date: 'not-a-date', Items: '1 x Muffin' },
              },
            ],
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })

    renderUploadDetail()

    await waitFor(() => expect(screen.getByText('Rows needing attention')).toBeInTheDocument())
    expect(screen.getByText('Could not parse date or time')).toBeInTheDocument()
    expect(screen.getByText(/Receipt: R501/i)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('does not offer re-mapping to a manager and says why', async () => {
    authState.user.role = 'manager'
    authState.isOwner = false
    mockUploadDetail()
    renderUploadDetail()

    await waitFor(() => expect(screen.getByText('export.csv')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /re-map columns/i })).not.toBeInTheDocument()
    expect(screen.getByText(/only the account owner can re-map/i)).toBeInTheDocument()
  })

  it('uses an app confirmation dialog when deleting an upload', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true)
    apiMock.delete.mockResolvedValue({ data: { success: true } })
    mockUploadDetail()

    renderUploadDetail()

    await waitFor(() => expect(screen.getByText('export.csv')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /delete this upload/i }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /delete upload/i })).toBeInTheDocument()
    // The consequence is stated in the owner's terms and matches what the backend
    // actually does: this upload imported rows, so they and their forecasts go.
    expect(screen.getByText(/transactions imported from export\.csv/i)).toBeInTheDocument()
    expect(screen.getByText(/refreshes the forecasts built on them/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^delete upload$/i }))

    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith('/uploads/u1'))
    await waitFor(() => expect(screen.getByText('Data Health page')).toBeInTheDocument())

    confirmSpy.mockRestore()
  })

  it('pages through imported transactions', async () => {
    apiMock.get.mockImplementation((url: string, config?: { params?: { page?: number; limit?: number } }) => {
      if (url.endsWith('/rows')) {
        const page = config?.params?.page || 1
        const transaction = page === 1
          ? {
              _id: 'r1',
              date: '2026-05-24T08:00:00.000Z',
              receiptId: '001',
              total: 42,
              items: [{ name: 'Flat White', quantity: 1 }],
            }
          : {
              _id: 'r2',
              date: '2026-05-23T09:00:00.000Z',
              receiptId: '051',
              total: 55,
              items: [{ name: 'Long White', quantity: 1 }],
            }

        return Promise.resolve({
          data: {
            transactions: [transaction],
            pagination: { total: 101, page, limit: 50, pages: 3 },
          },
        })
      }

      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'export.csv',
            status: 'completed',
            stats: { imported: 101, skipped: 0, errors: 0, totalRows: 101 },
            posType: 'yoco',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            dateRange: { firstDate: '2026-04-01', lastDate: '2026-04-02' },
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })

    renderUploadDetail()

    await waitFor(() => expect(screen.getByText(/Flat White/)).toBeInTheDocument())
    expect(screen.getByText(/Showing 1-50 of 101/i)).toBeInTheDocument()
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))

    await waitFor(() => expect(screen.getByText(/Long White/)).toBeInTheDocument())
    expect(screen.getByText(/Showing 51-100 of 101/i)).toBeInTheDocument()
    expect(apiMock.get).toHaveBeenCalledWith('/uploads/u1/rows', { params: { page: 2, limit: 50 } })
  })

  it('asks before a severe partial remap and retries with explicit partial-import approval', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    apiMock.patch
      .mockRejectedValueOnce({
        response: {
          status: 422,
          data: {
            code: 'SEVERE_PARTIAL_IMPORT',
            details: { errors: 7, totalRows: 10 },
          },
        },
      })
      .mockImplementationOnce(() => new Promise(() => {}))
    mockUploadDetail()
    renderUploadDetail()

    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /re-map columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /re-import with these columns/i }))

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/7 of 10 rows could not be imported/i)
    ))
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2))
    expect(apiMock.patch).toHaveBeenNthCalledWith(1, '/uploads/u1/mapping', {
      columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
      itemsMode: 'packed',
      allowPartialImport: false,
    }, expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
    }))
    expect(apiMock.patch).toHaveBeenNthCalledWith(2, '/uploads/u1/mapping', {
      columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
      itemsMode: 'packed',
      allowPartialImport: true,
    }, expect.anything())

    // The retry is the same re-import intent, so it must carry the same key -
    // a fresh one would make the backend treat it as a second request.
    const firstKey = apiMock.patch.mock.calls[0][2].headers['Idempotency-Key']
    const retryKey = apiMock.patch.mock.calls[1][2].headers['Idempotency-Key']
    expect(retryKey).toBe(firstKey)

    confirmSpy.mockRestore()
  })

  it('keeps the existing import unchanged when a severe partial remap is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    apiMock.patch.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          message: 'Fix the mapping or explicitly allow a partial import.',
          details: { errors: 7, totalRows: 10 },
        },
      },
    })
    mockUploadDetail()
    renderUploadDetail()

    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /re-map columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /re-import with these columns/i }))

    expect(await screen.findByText(/fix the mapping or explicitly allow a partial import/i)).toBeInTheDocument()
    expect(apiMock.patch).toHaveBeenCalledTimes(1)

    confirmSpy.mockRestore()
  })

  it('explains a missing original file instead of linking back to this page', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'export.csv',
            status: 'completed',
            stats: { imported: 4, skipped: 0, errors: 0, totalRows: 4 },
            posType: 'yoco',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
            itemsMode: 'packed',
          },
          downloadUrl: '',
        },
      })
    })

    renderUploadDetail()

    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /original file/i }))

    expect(screen.getByText(/not available to download/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /download export\.csv/i })).not.toBeInTheDocument()
  })

  it('does not offer re-mapping for an upload that never finished its first mapping', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'abandoned.csv',
            status: 'pending_mapping',
            stats: { imported: 0, skipped: 0, errors: 0, totalRows: 0 },
            posType: 'wizard',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            columnMapping: {},
            itemsMode: 'packed',
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })

    renderUploadDetail()

    await screen.findByText('abandoned.csv')
    // Re-map is still refused - the API answers 409 for pending_mapping - but the
    // branch is no longer a dead end: the file, its headers and its sample rows are
    // all still on the server, so the upload can be finished here.
    expect(screen.queryByRole('button', { name: /re-map columns/i })).not.toBeInTheDocument()
    expect(screen.getByText(/columns were never confirmed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /complete mapping/i })).toBeInTheDocument()
  })

  it('opens the mapping wizard when a stranded upload is completed', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'abandoned.csv',
            status: 'pending_mapping',
            stats: { imported: 0, skipped: 0, errors: 0, totalRows: 0 },
            posType: 'wizard',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            columnMapping: {},
            itemsMode: 'packed',
            headers: ['Sale Date', 'Description', 'Amount'],
            sampleRows: [{ 'Sale Date': '2026/04/01', Description: '1 x Flat White', Amount: '38.00' }],
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })

    renderUploadDetail()

    await screen.findByText('abandoned.csv')
    fireEvent.click(screen.getByRole('button', { name: /complete mapping/i }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(/finish importing this file/i)
  })

  it('states what a re-map destroys before opening the mapping form', async () => {
    mockUploadDetail()
    renderUploadDetail()

    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /re-map columns/i }))

    const dialog = screen.getByRole('dialog', { name: /re-import this file with different columns/i })
    expect(dialog).toHaveTextContent(/deletes the 4 transactions/i)
    expect(screen.queryByRole('button', { name: /re-import with these columns/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /choose columns/i }))
    expect(screen.getByText(/replaces the 4 transactions/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn't auto-detect/i)).not.toBeInTheDocument()
  })

  it('cannot re-submit the same wrong mapping when the file headers were never stored', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'legacy.csv',
            status: 'completed',
            stats: { imported: 9, skipped: 0, errors: 0, totalRows: 9 },
            posType: 'wizard',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            // Mongoose materialises an unset `headers` array as [], which is
            // truthy — the old `||` fallback therefore never ran.
            headers: [],
            columnMapping: { date: 'Date', items: 'Items', total: 'Tip' },
            itemsMode: 'packed',
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })

    renderUploadDetail()

    await screen.findByText('legacy.csv')
    fireEvent.click(screen.getByRole('button', { name: /re-map columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose columns/i }))

    expect(screen.getByText(/no longer stored/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-import with these columns/i })).toBeDisabled()
  })

  it('refreshes the upload in place after a successful re-map', async () => {
    let detailCalls = 0
    apiMock.get.mockImplementation((url: string) => {
      if (url.endsWith('/rows')) {
        return Promise.resolve({ data: { transactions: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } })
      }
      detailCalls += 1
      return Promise.resolve({
        data: {
          upload: {
            _id: 'u1',
            fileName: 'export.csv',
            status: 'completed',
            stats: detailCalls === 1
              ? { imported: 4, skipped: 0, errors: 0, totalRows: 4 }
              : { imported: 41, skipped: 0, errors: 0, totalRows: 41 },
            posType: 'yoco',
            createdAt: new Date().toISOString(),
            uploadedBy: { name: 'Shaun', email: 's@x.za' },
            headers: ['Date', 'Items', 'Total'],
            columnMapping: { date: 'Date', items: 'Items', total: 'Total' },
            itemsMode: 'packed',
          },
          downloadUrl: 'https://test.r2.local/foo',
        },
      })
    })
    apiMock.patch.mockResolvedValue({ data: { success: true } })

    renderUploadDetail()

    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /re-map columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /choose columns/i }))
    fireEvent.click(screen.getByRole('button', { name: /re-import with these columns/i }))

    await waitFor(() => expect(screen.getAllByText('41').length).toBeGreaterThan(0))
    expect(detailCalls).toBe(2)
  })

  it('closes the delete dialog on Escape and gives focus back to the trigger', async () => {
    mockUploadDetail()
    renderUploadDetail()

    await screen.findByText('export.csv')
    const trigger = screen.getByRole('button', { name: /delete this upload/i })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: /delete upload/i })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(trigger)
  })

  it('says which upload already held the rows this file skipped', async () => {
    mockUploadDetail()
    const detailGet = apiMock.get.getMockImplementation() as (url: string, config?: unknown) => Promise<unknown>
    apiMock.get.mockImplementation(async (url: string, config?: unknown) => {
      const res = (await detailGet(url, config)) as { data: { upload?: Record<string, unknown> } }
      if (!res.data.upload) return res
      return {
        data: {
          ...res.data,
          upload: {
            ...res.data.upload,
            stats: { imported: 14, skipped: 15, errors: 0, totalRows: 29 },
            overlap: { rows: 15, uploads: [{ uploadId: 'a1', fileName: 'receiptless-a.csv', rows: 15 }] },
          },
        },
      }
    })

    renderUploadDetail()
    await screen.findByText('export.csv')
    expect(screen.getByText(/15 sales were already in Your Guava from receiptless-a\.csv/i)).toBeInTheDocument()
  })

  it('names the uploads that share days before deleting, and says what was re-imported', async () => {
    mockUploadDetail()
    const detailGet = apiMock.get.getMockImplementation() as (url: string, config?: unknown) => Promise<unknown>
    apiMock.get.mockImplementation((url: string, config?: unknown) => {
      if (url === '/uploads/u1/overlaps') {
        return Promise.resolve({
          data: {
            success: true,
            overlaps: [{ uploadId: 'u2', fileName: 'overlap-b.csv', firstDateKey: '2026-01-15', lastDateKey: '2026-02-15' }],
            more: 0,
          },
        })
      }
      return detailGet(url, config)
    })
    apiMock.delete.mockResolvedValue({
      data: {
        success: true,
        readmitted: { rows: 34, uploads: [{ uploadId: 'u2', fileName: 'overlap-b.csv', rows: 34 }] },
        readmissionQueued: [],
      },
    })

    renderUploadDetail()
    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /delete this upload/i }))

    const dialog = screen.getByRole('dialog', { name: /delete upload/i })
    expect(await within(dialog).findByText(/overlap-b\.csv/)).toBeInTheDocument()
    expect(within(dialog).getByText(/re-imported from it/i)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /^delete upload$/i }))

    expect(await screen.findByText(/34 sales were re-imported from overlap-b\.csv/i)).toBeInTheDocument()
    expect(screen.queryByText('Data Health page')).not.toBeInTheDocument()
    // The page header already has a "Back to Data Health" button; the one under test is the dialog's.
    fireEvent.click(within(dialog).getByRole('button', { name: /back to data health/i }))
    expect(await screen.findByText('Data Health page')).toBeInTheDocument()
  })

  it('shows only the overlaps of the latest dialog opening when an earlier request answers late', async () => {
    mockUploadDetail()
    const detailGet = apiMock.get.getMockImplementation() as (url: string, config?: unknown) => Promise<unknown>
    let answerFirst: (value: unknown) => void = () => {}
    let overlapCalls = 0
    apiMock.get.mockImplementation((url: string, config?: unknown) => {
      if (url === '/uploads/u1/overlaps') {
        overlapCalls += 1
        if (overlapCalls === 1) return new Promise((resolve) => { answerFirst = resolve })
        return Promise.resolve({ data: { success: true, overlaps: [{ uploadId: 'u2', fileName: 'overlap-b.csv' }], more: 0 } })
      }
      return detailGet(url, config)
    })

    renderUploadDetail()
    await screen.findByText('export.csv')
    fireEvent.click(screen.getByRole('button', { name: /delete this upload/i }))
    fireEvent.click(within(screen.getByRole('dialog', { name: /delete upload/i })).getByRole('button', { name: /^cancel$/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete this upload/i }))
    const dialog = screen.getByRole('dialog', { name: /delete upload/i })
    expect(await within(dialog).findByText(/overlap-b\.csv/)).toBeInTheDocument()

    answerFirst({ data: { success: true, overlaps: [{ uploadId: 'u9', fileName: 'stale-first-open.csv' }], more: 0 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(within(dialog).queryByText(/stale-first-open\.csv/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/overlap-b\.csv/)).toBeInTheDocument()
  })
})
