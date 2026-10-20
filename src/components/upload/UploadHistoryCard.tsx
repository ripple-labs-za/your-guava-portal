import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { History, FileText, ExternalLink, Loader2, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { deleteUploadConsequence } from '@/lib/uploadMessages'
import type { Upload, UploadListItem, UploadStatus } from '@/types/upload'

const PAGE_SIZE = 20

interface UploadsPagination {
  total: number
  page: number
  limit: number
  pages: number
}

const statusColor: Record<string, 'success' | 'secondary' | 'destructive'> = {
  completed: 'success',
  pending_mapping: 'secondary',
  parsing: 'secondary',
  failed: 'destructive',
  deleted: 'secondary',
}

// The raw enum leaked straight into the table, so an owner saw "pending_mapping"
// where they needed a sentence. Every status maps to copy; there is no
// fallthrough that can print an internal name again.
// Shared with UploadDetail so an owner never sees a raw enum on either surface.
export const statusLabel: Record<UploadStatus, string> = {
  completed: 'Imported',
  pending_mapping: 'Needs mapping',
  parsing: 'Importing…',
  failed: 'Failed',
  deleted: 'Removed',
}

/**
 * Whether a rejected upload was in fact a benign re-upload of rows already
 * stored. The API sends no machine-readable code on this path — the duplicate
 * guard in uploads.controller.js throws a 409 whose only distinguishing feature
 * is its prose, and 409 alone is shared with four unrelated conflicts — so this
 * has to match on the message. Both surfaces that care (this card's badge and
 * the Data Health upload panel) call this one function, so when the API grows a
 * code there is a single place to change.
 */
export function isDuplicateUploadMessage(message?: string | null): boolean {
  return /already exist/i.test(message || '')
}

// Two cases deserve softer treatment than the raw status:
//   - completed with nothing imported is not a success worth a green tick
//   - the API rejects a re-upload of an already-imported file as `failed`, but
//     re-uploading last week's export is routine housekeeping, not an error
const statusBadge = (status: UploadStatus, imported: number, errorMessage?: string) => {
  if (isDuplicateUploadMessage(errorMessage) || (status === 'completed' && !imported)) {
    return { tone: 'secondary' as const, label: 'no new rows' };
  }
  return { tone: statusColor[status] || ('secondary' as const), label: statusLabel[status] || 'Unknown' };
};

const MAPPING_SOURCE_LABEL: Record<NonNullable<Upload['mappingSource']>, string> = {
  yoco: 'POS preset',
  saved: 'Saved mapping',
  ai: 'AI mapping',
  manual: 'Manual mapping',
  none: 'Not mapped',
}

/**
 * How the columns were matched, in the owner's terms.
 *
 * This column used to read 'Mapped' for everything that was not a Yoco export -
 * a saved mapping, an AI guess, a mapping the owner typed by hand, and an
 * upload that was never mapped at all all looked identical. Uploads staged
 * before mappingSource was recorded fall back to the old two-way split.
 */
export const uploadSourceLabel = (upload: Pick<Upload, 'mappingSource' | 'posType'>) =>
  upload.mappingSource
    ? MAPPING_SOURCE_LABEL[upload.mappingSource]
    : upload.posType === 'yoco'
      ? 'POS preset'
      : 'Mapped'

// Every row's link reads "View", so on a long history a screen-reader user hears
// "View" 20-odd times with nothing to tell the rows apart. Keep "View" as the
// first word (SC 2.5.3 Label in Name) and append the file and upload date.
const viewLinkLabel = (upload: Pick<Upload, 'fileName' | 'createdAt'>) =>
  `View import of ${upload.fileName}, uploaded ${new Date(upload.createdAt).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'long',
  })}`

interface UploadHistoryCardProps {
  refreshKey?: number
  /**
   * Whether the viewer may remove an upload. Passed in rather than read from
   * auth context: this card is rendered standalone in its own tests, and
   * reaching for a provider here made seven of them fail for a reason that had
   * nothing to do with what they were asserting. DELETE /uploads/:id is
   * ownerOnly, so the control is absent for anyone else rather than present
   * and then refused.
   */
  canRemove?: boolean
}

export function UploadHistoryCard({ refreshKey = 0, canRemove = false }: UploadHistoryCardProps) {
  const [uploads, setUploads] = useState<UploadListItem[]>([])
  const [pagination, setPagination] = useState<UploadsPagination | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  // Only an upload that imported nothing is offered here. A completed import is
  // deleted from its detail page, where the row count and date range are in view -
  // the consequence is bigger and the owner should see what they are removing.
  const [pendingDelete, setPendingDelete] = useState<UploadListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.delete(`/uploads/${pendingDelete._id}`)
      setPendingDelete(null)
      setRetryKey((key) => key + 1)
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined
      setDeleteError(message || 'Could not remove this upload. Try again.')
    } finally {
      setDeleting(false)
    }
  }

  // A fresh import belongs at the top of the newest page.
  useEffect(() => { setPage(1) }, [refreshKey])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    api.get<{ success: boolean; uploads: UploadListItem[]; pagination?: UploadsPagination }>('/uploads', {
      signal: controller.signal,
      params: { page, limit: PAGE_SIZE },
    })
      .then(({ data }) => {
        if (!active) return
        setUploads(data.uploads)
        setPagination(data.pagination || null)
      })
      .catch(() => { if (active && !controller.signal.aborted) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [refreshKey, retryKey, page])

  const total = pagination?.total ?? uploads.length
  const limit = pagination?.limit ?? PAGE_SIZE
  const currentPage = pagination?.page ?? page
  const pages = Math.max(pagination?.pages ?? 1, 1)
  const rowStart = total === 0 ? 0 : (currentPage - 1) * limit + 1
  const rowEnd = Math.min(currentPage * limit, total)

  return (
    <>
      <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-guava-red-text" />
          <CardTitle>Upload history</CardTitle>
        </div>
        <CardDescription>
          Every CSV/XLSX you've imported, newest first. Click an entry to view the imported rows or
          download the original file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-red-900/30 bg-red-900/10 p-3" role="alert">
            <p className="text-sm text-red-300">Upload history could not be loaded.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setRetryKey((key) => key + 1)}>
              Try again
            </Button>
          </div>
        )}
        {!loading && !error && uploads.length === 0 && (
          <p className="text-sm text-muted">No uploads yet. Drop a CSV in the card above to get started.</p>
        )}
        {!loading && !error && uploads.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              Showing {rowStart.toLocaleString('en-ZA')}-{rowEnd.toLocaleString('en-ZA')} of {total.toLocaleString('en-ZA')} imports
            </p>
            <div className="max-h-96 overflow-auto" role="region" aria-label="Upload history" tabIndex={0}>
              <table className="w-full min-w-[960px] text-sm [&_th]:whitespace-nowrap [&_th]:pr-4 [&_td]:pr-4">
                <caption className="sr-only">Files imported into Your Guava, newest first</caption>
                <thead>
                  <tr className="text-left text-[#9E9E9E] text-xs">
                    <th className="py-2">File</th>
                    <th>Mapping</th>
                    <th>Rows imported</th>
                    <th>Date range</th>
                    <th>Status</th>
                    <th>Uploaded</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((u) => (
                    <tr key={u._id} className="border-t border-border">
                      <td className="py-2 flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-[#9E9E9E]" />{u.fileName}</td>
                      <td>{uploadSourceLabel(u)}</td>
                      <td>{u.stats.imported}</td>
                      <td className="text-muted">
                        {u.dateRange?.firstDate ? new Date(u.dateRange.firstDate).toLocaleDateString('en-ZA') : '—'}
                        {' → '}
                        {u.dateRange?.lastDate ? new Date(u.dateRange.lastDate).toLocaleDateString('en-ZA') : '—'}
                      </td>
                      <td>
                        {(() => {
                          const badge = statusBadge(u.status, u.stats.imported, u.errorMessage)
                          // The reason was fetched and thrown away, so a failed import
                          // read as the word 'Failed' and nothing else. A duplicate
                          // already reads as 'no new rows', which says it better than
                          // the raw server string would.
                          const reason =
                            u.errorMessage && !isDuplicateUploadMessage(u.errorMessage)
                              ? u.errorMessage
                              : null
                          return (
                            <>
                              <Badge variant={badge.tone}>{badge.label}</Badge>
                              {reason && (
                                <span
                                  className="mt-1 block max-w-60 truncate text-xs text-guava-red-text"
                                  title={reason}
                                >
                                  {reason}
                                </span>
                              )}
                            </>
                          )
                        })()}
                      </td>
                      <td className="text-muted">{new Date(u.createdAt).toLocaleString('en-ZA')}</td>
                      <td>
                        <Link
                          to={`/uploads/${u._id}`}
                          aria-label={viewLinkLabel(u)}
                          className="text-guava-red-text hover:underline inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 -mx-2"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </Link>
                        {canRemove && u.stats.imported === 0 && u.status !== 'deleted' && (
                          <button
                            type="button"
                            onClick={() => { setDeleteError(null); setPendingDelete(u) }}
                            aria-label={`Remove ${u.fileName} from history`}
                            className="ml-3 inline-flex min-h-6 items-center gap-1 rounded px-2 py-1 text-muted hover:text-guava-red-text"
                          >
                            <Trash2 className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted">
                <span>Page {currentPage.toLocaleString('en-ZA')} of {pages.toLocaleString('en-ZA')}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Previous page of uploads"
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    disabled={loading || currentPage <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Next page of uploads"
                    onClick={() => setPage(Math.min(pages, currentPage + 1))}
                    disabled={loading || currentPage >= pages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-upload-title"
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg border border-red-900/40 bg-red-900/20 p-2 text-guava-red-text">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="remove-upload-title" className="text-lg font-semibold text-text">
                  Remove this upload?
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {deleteUploadConsequence(pendingDelete.fileName, pendingDelete.stats.imported)}
                </p>
                {deleteError && (
                  <p role="alert" className="mt-3 rounded-lg border border-red-900/30 bg-red-900/10 px-3 py-2 text-sm text-guava-red-text">
                    {deleteError}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button onClick={confirmDelete} disabled={deleting}>
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Remove upload
              </Button>
            </div>
          </div>
        </div>
      )}
      </>
  )
}
