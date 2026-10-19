import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { Loader2, Download, RefreshCw, Trash2, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ColumnMappingWizard } from '@/components/upload/ColumnMappingWizard'
import { statusLabel, uploadSourceLabel } from '@/components/upload/UploadHistoryCard'
import { deleteUploadConsequence, overlapNotice, readmissionOutcome, skippedRowSentences } from '@/lib/uploadMessages'
import api from '@/lib/api'
import { API_ERROR_COPY, readApiError } from '@/lib/apiErrors'
import { confirmUpload, confirmationKeyFor, severePartialImportDetails } from '@/lib/uploads'
import type {
  Upload, ColumnMapping, ItemsMode, UploadRowError, UploadOverlap, DeleteUploadResponse,
} from '@/types/upload'

interface Row {
  _id: string
  date: string
  total: number
  items: { name: string; quantity: number }[]
  receiptId?: string
}

interface RowsPagination {
  total: number
  page: number
  limit: number
  pages: number
}

const ROWS_LIMIT = 50

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Escape to dismiss, focus moved into the dialog, Tab kept inside it, and focus
 * returned to the trigger on close. The delete dialog guards the one
 * irreversible action on this page and had none of it: focus stayed on the
 * button behind the overlay and the warning text was never read out.
 */
function useDialogKeyboard(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    if (document.activeElement instanceof HTMLElement) restoreRef.current = document.activeElement
    const node = dialogRef.current
    const initial = node?.querySelectorAll<HTMLElement>(FOCUSABLE)
    ;(initial && initial.length > 0 ? initial[0] : node)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = node?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!items || items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
      restoreRef.current = null
    }
  }, [open])

  return dialogRef
}

const DEFAULT_ROWS_PAGINATION: RowsPagination = {
  total: 0,
  page: 1,
  limit: ROWS_LIMIT,
  pages: 1,
}

const extractApiError = (err: unknown, fallback: string) => {
  if (err && typeof err === 'object' && 'response' in err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    if (msg) return msg
  }
  return fallback
}

const normalisePagination = (
  pagination: Partial<RowsPagination> | undefined,
  fallbackPage: number,
  rowCount: number
): RowsPagination => {
  const limit = pagination?.limit || ROWS_LIMIT
  const total = pagination?.total ?? rowCount

  return {
    total,
    page: pagination?.page || fallbackPage,
    limit,
    pages: Math.max(pagination?.pages || Math.ceil(total / limit) || 1, 1),
  }
}

const formatRawPreview = (raw?: UploadRowError['raw']) => {
  const entries = Object.entries(raw || {})
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .slice(0, 4)

  if (entries.length === 0) return 'No raw values captured'

  return entries
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ')
}

export default function UploadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [upload, setUpload] = useState<Upload | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string>('')
  const [rows, setRows] = useState<Row[]>([])
  const [rowsPagination, setRowsPagination] = useState<RowsPagination>(DEFAULT_ROWS_PAGINATION)
  const [tab, setTab] = useState<'rows' | 'file'>('rows')
  const [loading, setLoading] = useState(true)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReloadToken, setDetailReloadToken] = useState(0)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Uploads sharing this one's days, named in the delete dialog; and what the delete re-imported (BE-03-T02).
  const [overlaps, setOverlaps] = useState<UploadOverlap[]>([])
  const [overlapsMore, setOverlapsMore] = useState(0)
  const [deleteOutcome, setDeleteOutcome] = useState<string | null>(null)
  const [remapOutcome, setRemapOutcome] = useState<string | null>(null)
  // Each dialog opening numbers its overlaps request; a late answer to an earlier opening is ignored.
  const overlapsRequestRef = useRef(0)
  const [remapping, setRemapping] = useState(false)
  const [showRemapConfirm, setShowRemapConfirm] = useState(false)
  const [remapError, setRemapError] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [alreadyImported, setAlreadyImported] = useState(false)

  const deleteDialogRef = useDialogKeyboard(showDeleteConfirm, () => {
    if (!deleting) setShowDeleteConfirm(false)
  })
  const remapDialogRef = useDialogKeyboard(showRemapConfirm, () => setShowRemapConfirm(false))

  const saveRemapping = async (
    mapping: ColumnMapping,
    itemsMode: ItemsMode,
    allowPartialImport = false
  ): Promise<Partial<DeleteUploadResponse> | undefined> => {
    try {
      const response = await api.patch<Partial<DeleteUploadResponse>>(`/uploads/${id}/mapping`, {
        columnMapping: mapping,
        itemsMode,
        allowPartialImport,
      }, {
        // One key per re-import intent, held across the partial-import retry below,
        // so the second call is recognised as the same request rather than a new one.
        headers: { 'Idempotency-Key': confirmationKeyFor(`remap:${id}`) },
      })
      return response.data
    } catch (err: unknown) {
      const details = severePartialImportDetails(err)
      if (details && !allowPartialImport) {
        const proceed = window.confirm(
          `${details.errors ?? 'Many'} of ${details.totalRows ?? 'the'} rows could not be imported. ` +
          'Import only the valid rows anyway? You can review the rejected-row report afterward.'
        )
        if (proceed) {
          return saveRemapping(mapping, itemsMode, true)
        }
      }
      throw err
    }
  }

  const setRowsFromResponse = (
    data: { transactions: Row[]; pagination?: Partial<RowsPagination> },
    page: number
  ) => {
    setRows(data.transactions)
    setRowsPagination(normalisePagination(data.pagination, page, data.transactions.length))
  }

  const loadRowsPage = async (page: number) => {
    if (!id) return

    setRowsLoading(true)
    setRowsError(null)
    try {
      const rowsRes = await api.get<{ transactions: Row[]; pagination?: RowsPagination }>(`/uploads/${id}/rows`, {
        params: { page, limit: ROWS_LIMIT },
      })
      setRowsFromResponse(rowsRes.data, page)
    } catch (err: unknown) {
      setRowsError(extractApiError(err, 'Transactions could not be loaded.'))
    } finally {
      setRowsLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const controller = new AbortController()

    const loadUpload = async () => {
      setLoading(true)
      setRowsLoading(true)
      setDetailError(null)
      setRowsError(null)

      const [detailResult, rowsResult] = await Promise.allSettled([
          api.get<{ upload: Upload; downloadUrl: string }>(`/uploads/${id}`, { signal: controller.signal }),
          api.get<{ transactions: Row[]; pagination?: RowsPagination }>(`/uploads/${id}/rows`, {
            params: { page: 1, limit: ROWS_LIMIT },
            signal: controller.signal,
          }),
        ])

      if (cancelled) return
      if (detailResult.status === 'fulfilled') {
        setUpload(detailResult.value.data.upload)
        setDownloadUrl(detailResult.value.data.downloadUrl)
      } else {
        setUpload(null)
        setDownloadUrl('')
        setDetailError(extractApiError(detailResult.reason, 'Upload details could not be loaded.'))
      }
      if (rowsResult.status === 'fulfilled') {
        setRowsFromResponse(rowsResult.value.data, 1)
      } else {
        setRowsError(extractApiError(rowsResult.reason, 'Transactions could not be loaded.'))
      }
      setLoading(false)
      setRowsLoading(false)
    }

    loadUpload()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, detailReloadToken])

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await api.delete(`/uploads/${id}`)
      const outcome = readmissionOutcome(response?.data as Partial<DeleteUploadResponse> | undefined)
      if (outcome) {
        // Say what came back from the overlapping uploads before leaving the page.
        setDeleteOutcome(outcome)
        setDeleting(false)
        return
      }
      navigate('/data-health')
    } catch (err: unknown) {
      setDeleteError(extractApiError(err, 'Delete failed.'))
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <AppLayout title="Upload">
        <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
      </AppLayout>
    )
  }

  if (!upload) {
    return (
      <AppLayout title="Upload">
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/data-health')}>
            <ArrowLeft className="w-4 h-4" /> Back to Data Health
          </Button>
          <div className="rounded-lg border border-red-900/30 bg-red-900/10 p-4 text-sm text-red-300" role="alert">
            <p>{detailError || 'Upload details could not be loaded.'}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setDetailReloadToken((current) => current + 1)}
            >
              Try again
            </Button>
          </div>
        </div>
      </AppLayout>
    )
  }

  const rowStart = rowsPagination.total === 0 ? 0 : (rowsPagination.page - 1) * rowsPagination.limit + 1
  const rowEnd = Math.min(rowsPagination.page * rowsPagination.limit, rowsPagination.total)
  const showPagination = rowsPagination.total > rowsPagination.limit
  const rowsSummary = rowsLoading
    ? 'Loading transactions...'
    : rowsPagination.total === 0
      ? 'No imported transactions found for this upload.'
      : `Showing ${rowStart.toLocaleString('en-ZA')}-${rowEnd.toLocaleString('en-ZA')} of ${rowsPagination.total.toLocaleString('en-ZA')} imported transactions`
  const rowErrors = upload.rowErrors || []
  const rowErrorTotal = Math.max(upload.stats.errors || 0, rowErrors.length)
  const hiddenRowErrorCount = Math.max(rowErrorTotal - rowErrors.length, 0)

  return (
    <AppLayout title={upload.fileName}>
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/data-health')}>
          <ArrowLeft className="w-4 h-4" /> Back to Data Health
        </Button>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>{upload.fileName}</CardTitle>
              <p className="text-sm text-muted mt-1">
                Uploaded {new Date(upload.createdAt).toLocaleString('en-ZA')} • {uploadSourceLabel(upload)}
              </p>
            </div>
            <Badge variant={upload.status === 'completed' ? 'success' : 'secondary'}>
              {statusLabel[upload.status] || upload.status}
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Imported" value={upload.stats.imported} />
              <Stat label="Skipped" value={upload.stats.skipped} />
              <Stat label="Errors" value={upload.stats.errors} />
              <Stat label="Total rows" value={upload.stats.totalRows} />
            </div>
            {/* errorMessage was fetched and discarded, so a failed import showed the
                word 'Failed' and nothing an owner could act on. */}
            {upload.errorMessage && (
              <p role="alert" className="mt-3 rounded-lg border border-guava-red/40 bg-guava-red-surface p-3 text-sm text-guava-red-text">
                {upload.errorMessage}
              </p>
            )}
            {skippedRowSentences(upload.stats.skippedByReason, upload.overlap).map((sentence) => (
              <p key={sentence} className="mt-3 text-sm text-muted">{sentence}</p>
            ))}
            {upload.dateRange?.firstDate && (
              <p className="text-sm text-muted mt-3">
                Date range: {new Date(upload.dateRange.firstDate).toLocaleDateString('en-ZA')}
                {' → '}
                {new Date(upload.dateRange.lastDate!).toLocaleDateString('en-ZA')}
              </p>
            )}
            {downloadUrl && (
              <div className="mt-3">
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl} target="_blank" rel="noreferrer">
                    <Download className="w-4 h-4" /> Download original file
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {rowErrors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Rows needing attention</CardTitle>
              <p className="text-sm text-muted mt-1">
                Showing {rowErrors.length.toLocaleString('en-ZA')} of {rowErrorTotal.toLocaleString('en-ZA')} import errors
                {hiddenRowErrorCount > 0 && `; ${hiddenRowErrorCount.toLocaleString('en-ZA')} more were counted.`}
              </p>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[#9E9E9E] text-xs">
                    <th className="py-2">Row</th>
                    <th>Reason</th>
                    <th>Raw values</th>
                  </tr>
                </thead>
                <tbody>
                  {rowErrors.map((rowError, index) => (
                    <tr key={`${rowError.rowNumber || 'row'}-${index}`} className="border-t border-border">
                      <td className="py-2 font-medium text-text">{rowError.rowNumber || '-'}</td>
                      <td className="pr-4">{rowError.reason}</td>
                      <td className="max-w-[36rem] break-words text-xs text-muted">
                        {formatRawPreview(rowError.raw)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2">
          <Button variant={tab === 'rows' ? 'success' : 'outline'} size="sm" onClick={() => setTab('rows')}>
            Transactions
          </Button>
          <Button variant={tab === 'file' ? 'success' : 'outline'} size="sm" onClick={() => setTab('file')}>
            Original file
          </Button>
        </div>

        {tab === 'rows' && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Transactions</CardTitle>
                <p className="text-sm text-muted mt-1">{rowsSummary}</p>
              </div>
              {rowsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            </CardHeader>
            <CardContent className="space-y-4 overflow-auto">
              {rowsError ? (
                <div className="rounded-lg border border-red-900/30 bg-red-900/10 p-3 text-sm text-red-300">
                  <p>{rowsError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => loadRowsPage(rowsPagination.page)}
                    disabled={rowsLoading}
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[#9E9E9E] text-xs">
                      <th className="py-2">Date</th>
                      <th>Receipt</th>
                      <th>Items</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r._id} className="border-t border-border">
                        <td className="py-2">{new Date(r.date).toLocaleString('en-ZA')}</td>
                        <td>{r.receiptId || '—'}</td>
                        <td>{(r.items ?? []).map((i) => `${i.quantity} × ${i.name}`).join(', ')}</td>
                        <td className="text-right">R{r.total?.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {showPagination && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted">
                  <span>
                    Page {rowsPagination.page.toLocaleString('en-ZA')} of {rowsPagination.pages.toLocaleString('en-ZA')}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Previous page"
                      onClick={() => loadRowsPage(rowsPagination.page - 1)}
                      disabled={rowsLoading || rowsPagination.page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Next page"
                      onClick={() => loadRowsPage(rowsPagination.page + 1)}
                      disabled={rowsLoading || rowsPagination.page >= rowsPagination.pages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === 'file' && (
          <Card>
            <CardContent className="space-y-3">
              {/* An empty href resolves to the current URL, so this button used
                  to open a second copy of this page in a new tab and call it a
                  download. */}
              {downloadUrl ? (
                <>
                  <p className="text-sm text-muted">
                    Download the original file you uploaded. The link is signed and expires about 15
                    minutes after the page loads — refresh it if the download fails.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="success">
                      <a href={downloadUrl} target="_blank" rel="noreferrer">
                        <Download className="w-4 h-4" /> Download {upload.fileName}
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDetailReloadToken((current) => current + 1)}
                    >
                      <RefreshCw className="w-4 h-4" /> Refresh download link
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    The original file is not available to download. It may have been removed from
                    storage, or the signed link could not be created.
                  </p>
                  <Button variant="outline" onClick={() => setDetailReloadToken((current) => current + 1)}>
                    <RefreshCw className="w-4 h-4" /> Try again
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <div className="pt-4 border-t border-border">
          {/* Re-mapping is only possible once a first mapping has been
              committed. Offering it for a pending_mapping upload produced a
              guaranteed "Cannot remap while pending_mapping" from the API. */}
          {alreadyImported && (
            <div role="alert" className="mb-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
              <p className="font-medium text-text">{API_ERROR_COPY.MAPPING_ALREADY_COMMITTED.title}</p>
              <p className="mt-1 text-muted">{API_ERROR_COPY.MAPPING_ALREADY_COMMITTED.body}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => { setAlreadyImported(false); setDetailReloadToken((current) => current + 1) }}
              >
                Reload this upload
              </Button>
            </div>
          )}
          {upload.status === 'pending_mapping' ? (
            <>
              <p className="mb-3 text-sm text-muted">
                This upload was staged but its columns were never confirmed, so nothing was
                imported. The file is still here — finish the mapping to import it.
              </p>
              {completeError && (
                <p role="alert" className="mb-3 text-sm text-guava-red-text">{completeError}</p>
              )}
              <Button
                size="sm"
                className="mr-2"
                onClick={() => { setCompleteError(null); setCompleting(true) }}
              >
                Complete mapping
              </Button>
            </>
          ) : user?.role === 'owner' ? (
            <Button variant="outline" size="sm" className="mr-2" onClick={() => { setRemapError(null); setShowRemapConfirm(true) }}>
              Re-map columns
            </Button>
          ) : (
            <p className="mb-3 text-sm text-muted">
              Only the account owner can re-map an imported upload, because it replaces every row it imported.
            </p>
          )}
          {user?.role === 'owner' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-guava-red-text"
              onClick={() => {
                setDeleteError(null)
                setDeleteOutcome(null)
                setShowDeleteConfirm(true)
                setOverlaps([])
                setOverlapsMore(0)
                const request = ++overlapsRequestRef.current
                // A failure leaves the list empty: the dialog still works, it just cannot name the overlaps.
                api.get<{ overlaps?: UploadOverlap[]; more?: number }>(`/uploads/${id}/overlaps`)
                  .then((response) => {
                    if (request !== overlapsRequestRef.current) return
                    setOverlaps(response?.data?.overlaps ?? [])
                    setOverlapsMore(response?.data?.more ?? 0)
                  })
                  .catch(() => {})
              }}
              disabled={deleting}
            >
              <Trash2 className="w-4 h-4" /> Delete this upload
            </Button>
          )}
          {deleteError && <p className="text-red-400 text-xs mt-2">{deleteError}</p>}
          {remapError && <p className="text-red-400 text-xs mt-2">{remapError}</p>}
          {remapOutcome && <p role="status" className="text-sm text-muted mt-2">{remapOutcome}</p>}
        </div>
      </div>

      {showRemapConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div
            ref={remapDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remap-upload-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
          >
            <h2 id="remap-upload-title" className="text-lg font-semibold text-text">
              Re-import this file with different columns?
            </h2>
            <p className="mt-2 text-sm text-muted">
              Re-importing deletes the {upload.stats.imported.toLocaleString('en-ZA')} transaction
              {upload.stats.imported === 1 ? '' : 's'} currently linked to {upload.fileName} and reads
              the file again using the columns you choose. Forecasts for those days are refreshed.
              This cannot be undone.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRemapConfirm(false)}>Cancel</Button>
              <Button onClick={() => { setShowRemapConfirm(false); setRemapping(true) }}>Choose columns</Button>
            </div>
          </div>
        </div>
      )}

      {/* Resuming a staged upload. The backend already holds the file, its headers
          and its sample rows, and POST /uploads/:id/confirm is the same call Data
          Health makes - the only thing that was missing was a way back to it once
          the wizard had been closed. The uploadId lived in Connect's React state,
          so a reload stranded the upload permanently. */}
      {completing && upload && (
        <ColumnMappingWizard
          open
          headers={upload.headers ?? []}
          preview={upload.sampleRows || []}
          initialMapping={upload.columnMapping ?? {}}
          initialItemsMode={upload.itemsMode}
          title="Finish importing this file"
          description="Match your columns and import. Required fields are marked with *."
          confirmLabel="Import with these columns"
          onCancel={() => { setCompleteError(null); setCompleting(false) }}
          onConfirm={async (mapping: ColumnMapping, itemsMode: ItemsMode) => {
            try {
              setCompleteError(null)
              await confirmUpload(upload._id, mapping, itemsMode, {
                onPartialImport: (failed, total) =>
                  window.confirm(
                    `${failed ?? 'Many'} of ${total ?? 'the'} rows could not be imported. ` +
                    'Import only the valid rows anyway? You can review the rejected-row report afterward.'
                  ),
              })
              setCompleting(false)
              setDetailReloadToken((current) => current + 1)
            } catch (err: unknown) {
              // Someone finished this import first with other columns (BE-13-T02): offer the upload as it now is.
              if (readApiError(err).code === 'MAPPING_ALREADY_COMMITTED') {
                setCompleting(false)
                setAlreadyImported(true)
                return
              }
              setCompleteError(extractApiError(err, 'Import failed. Check the column choices and try again.'))
              setCompleting(false)
            }
          }}
        />
      )}

      {remapping && upload && (
        <ColumnMappingWizard
          open
          // The old fallback offered the columns the user had already mapped,
          // which can never contain the one they got wrong -- and an empty
          // `headers` array from Mongoose is truthy, so it never even ran.
          headers={upload.headers ?? []}
          preview={upload.sampleRows || []}
          initialMapping={upload.columnMapping ?? {}}
          initialItemsMode={upload.itemsMode}
          title="Change how this file's columns are read"
          description={`Re-importing replaces the ${upload.stats.imported.toLocaleString('en-ZA')} transaction${upload.stats.imported === 1 ? '' : 's'} currently linked to this upload. Required fields are marked with *.${upload.posType === 'wizard' ? ' The columns you choose also become the saved mapping for your next uploads.' : ''}`}
          confirmLabel="Re-import with these columns"
          onCancel={() => {
            setRemapError(null)
            setRemapping(false)
          }}
          onConfirm={async (mapping: ColumnMapping, itemsMode: ItemsMode) => {
            try {
              setRemapError(null)
              const remapped = readmissionOutcome(await saveRemapping(mapping, itemsMode))
              setRemapOutcome(remapped ? remapped.replace(/^Upload deleted\. /, '') : null)
              setRemapping(false)
              // A hard reload threw away every bit of context about what had
              // just changed. Re-fetching shows the new stats in place.
              setDetailReloadToken((current) => current + 1)
            } catch (err: unknown) {
              setRemapError(extractApiError(err, 'Re-map failed. Check the column choices and try again.'))
              setRemapping(false)
            }
          }}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-upload-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg border border-red-900/40 bg-red-900/20 p-2 text-guava-red-text">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="delete-upload-title" className="text-lg font-semibold text-text">
                  Delete upload?
                </h2>
                {deleteOutcome ? (
                  <p role="status" className="mt-1 text-sm text-text">{deleteOutcome}</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-muted">
                      {deleteUploadConsequence(upload.fileName, upload.stats.imported)}
                    </p>
                    {overlapNotice(overlaps, overlapsMore) && (
                      <p className="mt-2 text-sm text-muted">{overlapNotice(overlaps, overlapsMore)}</p>
                    )}
                  </>
                )}
                {deleteError && (
                  <p className="mt-3 rounded-lg border border-red-900/30 bg-red-900/10 px-3 py-2 text-sm text-red-400">
                    {deleteError}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {deleteOutcome ? (
                <Button onClick={() => navigate('/data-health')}>Back to Data Health</Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleting}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleDelete} disabled={deleting}>
                    {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Delete upload
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#111111] border border-border rounded-lg p-3 text-center">
      <p className="text-text text-xl font-bold">{value}</p>
      <p className="text-muted text-xs">{label}</p>
    </div>
  )
}
