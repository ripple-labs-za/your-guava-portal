import api from '@/lib/api'
import type {
  ColumnMapping,
  ItemsMode,
  Upload as UploadRecord,
  UploadOverlapStats,
  UploadRowError,
} from '@/types/upload'

export interface ConfirmUploadResponse {
  success: true
  uploadId: string
  stats: { imported: number; skipped: number; errors: number; totalRows: number }
  dateRange?: {
    firstDate?: string
    lastDate?: string
    firstDateKey?: string
    lastDateKey?: string
  }
  rowErrors?: UploadRowError[]
  maintenance?: UploadRecord['maintenance']
  overlap?: UploadOverlapStats
  replayed?: boolean
}

// The confirm POST has already run for two minutes by the time recovery starts,
// so an import slow enough to reach here will not finish in five more seconds.
// Back off up to about a minute before giving up, and never call it a failure.
const RECOVERY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]

/**
 * One idempotency key per upload, for the life of the tab.
 *
 * Module-level rather than a component ref on purpose: a confirm can now be
 * started on Data Health and retried from the upload's detail page after the
 * first screen has unmounted. A per-component ref would mint a second key for
 * the same intent, and the backend would treat the retry as a new import
 * instead of a replay of the one that may already be running.
 */
const confirmationKeys = new Map<string, string>()

export const confirmationKeyFor = (uploadId: string): string => {
  const existing = confirmationKeys.get(uploadId)
  if (existing) return existing
  const generated = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  confirmationKeys.set(uploadId, generated)
  return generated
}

const responseOf = (error: unknown) =>
  error && typeof error === 'object' && 'response' in error
    ? (error as {
        response?: {
          status?: number
          data?: { code?: string; details?: { errors?: number; totalRows?: number } }
        }
      }).response
    : undefined

/**
 * The rejected-row counts of a severe partial import, or null for any other failure. Keyed on the server's code:
 * a 422 alone also means PARSE_LIMIT_EXCEEDED (a file too slow to read), which asked the owner to "import only the
 * valid rows" of a file nothing could be imported from (BE-03-T12). The one decision point for Data Health and the
 * upload page.
 */
export const severePartialImportDetails = (error: unknown): { errors?: number; totalRows?: number } | null => {
  const response = responseOf(error)
  if (response?.status !== 422 || response.data?.code !== 'SEVERE_PARTIAL_IMPORT') return null
  return response.data.details ?? {}
}

/**
 * A confirm that timed out may still have committed. Poll the upload's own
 * status rather than reporting a failure the server does not agree with —
 * telling an owner the import failed is what made them upload the same file
 * again into a running one.
 */
const recoverCompletedConfirmation = async (
  uploadId: string,
  originalError: unknown
): Promise<ConfirmUploadResponse> => {
  const status = responseOf(originalError)?.status
  if (status != null && ![408, 504].includes(status)) throw originalError

  let lastKnownStatus: UploadRecord['status'] | undefined
  for (let attempt = 0; attempt < RECOVERY_BACKOFF_MS.length; attempt++) {
    try {
      const { data } = await api.get<{ upload: UploadRecord }>(`/uploads/${uploadId}`, {
        timeout: 10_000,
      })
      lastKnownStatus = data.upload.status
      if (lastKnownStatus === 'completed') {
        return {
          success: true,
          uploadId,
          stats: data.upload.stats,
          dateRange: data.upload.dateRange,
          rowErrors: data.upload.rowErrors,
          maintenance: data.upload.maintenance,
          overlap: data.upload.overlap,
          replayed: true,
        }
      }
      if (lastKnownStatus !== 'parsing') break
    } catch {
      // A transient status-read failure should not hide a commit that may
      // already have succeeded. Retry within this bounded window.
    }
    if (attempt < RECOVERY_BACKOFF_MS.length - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, RECOVERY_BACKOFF_MS[attempt]))
    }
  }

  // Still parsing after the whole window is not a failure, and calling it one
  // is what made owners re-upload the same file into a running import.
  if (lastKnownStatus === 'parsing') {
    throw Object.assign(new Error('Import is still running'), { uploadStillRunning: true })
  }
  throw originalError
}

export interface ConfirmUploadOptions {
  allowPartialImport?: boolean
  /**
   * Asked when the server refuses a file whose rejected-row count crosses the
   * severe-partial threshold (422). Return true to re-send with
   * allowPartialImport. Each caller supplies its own presentation — Data Health
   * uses a native confirm, the detail page uses its dialog — so this module
   * never reaches for `window`.
   */
  onPartialImport?: (failed?: number, total?: number) => boolean | Promise<boolean>
}

/**
 * Commit a staged upload with a column mapping.
 *
 * Shared by Data Health (immediately after staging) and by the upload detail
 * page (resuming an upload whose wizard was abandoned). Both need the same
 * idempotency key, the same 422 partial-import negotiation and the same
 * timeout recovery, and duplicating that is how the two screens drift apart.
 */
export async function confirmUpload(
  uploadId: string,
  columnMapping: ColumnMapping,
  itemsMode: ItemsMode,
  options: ConfirmUploadOptions = {}
): Promise<ConfirmUploadResponse> {
  const { allowPartialImport = false, onPartialImport } = options
  try {
    const { data } = await api.post<ConfirmUploadResponse>(
      `/uploads/${uploadId}/confirm`,
      { columnMapping, itemsMode, allowPartialImport },
      {
        timeout: 120_000,
        headers: { 'Idempotency-Key': confirmationKeyFor(uploadId) },
      }
    )
    return data
  } catch (error) {
    const severe = severePartialImportDetails(error)
    if (severe && !allowPartialImport && onPartialImport) {
      const proceed = await onPartialImport(severe.errors, severe.totalRows)
      if (proceed) {
        return confirmUpload(uploadId, columnMapping, itemsMode, {
          ...options,
          allowPartialImport: true,
        })
      }
      throw error
    }
    return recoverCompletedConfirmation(uploadId, error)
  }
}
