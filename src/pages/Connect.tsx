import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react'
import { Upload, CheckCircle, AlertCircle, Clock, TrendingUp, LoaderCircle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { ColumnMappingWizard } from '@/components/upload/ColumnMappingWizard'
import { UploadHistoryCard, isDuplicateUploadMessage } from '@/components/upload/UploadHistoryCard'
import { SavedMappingCard } from '@/components/upload/SavedMappingCard'
import type {
  ColumnMapping,
  ItemsMode,
  StageUploadResponse,

  UploadRowError,
} from '@/types/upload'

import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import api, { isSessionRejection } from '@/lib/api'
import { XLS_GUIDANCE, INVALID_TYPE, overlapSkipMessage, savedMappingNotice, mappingAssistNotice } from '@/lib/uploadMessages'
import { confirmUpload as confirmUploadRequest, type ConfirmUploadResponse } from '@/lib/uploads'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { addLocalDays, parseDateOnly, toLocalDateOnly } from '@/lib/date'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_UPLOAD_ROWS = 10_000

function extractErrorMsg(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    if (msg) return msg
  }
  return fallback
}

// The server's row-cap message is a fact with no instruction attached. A cafe
// doing 50 sales a day crosses 10 000 rows in about seven months, and the
// duplicate skip already makes month-by-month uploads safe -- so say that.
function friendlyUploadError(message: string): string {
  if (/row limit/i.test(message)) {
    return `${message}. Export in shorter date ranges — about six months at a time — and upload them one after another. Rows you have already imported are skipped automatically.`
  }
  return message
}

function serverReference(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('response' in err)) return null
  const response = (err as { response?: { status?: number; data?: { requestId?: unknown } } }).response
  const requestId = response?.data?.requestId
  return typeof response?.status === 'number' && response.status >= 500 && typeof requestId === 'string' && requestId
    ? requestId
    : null
}

function uploadFailureMessage(err: unknown): string {
  const serverMessage = extractErrorMsg(err, '')
  if (serverMessage) {
    const reference = serverReference(err)
    const friendly = friendlyUploadError(serverMessage)
    return reference ? `${friendly} Reference: ${reference}` : friendly
  }
  if (isSessionRejection(err)) return 'Your sign-in has expired. Sign in again, then upload the file.'
  return 'We could not reach Your Guava to finish this upload. Your existing data is unchanged — check your connection and try again.'
}

interface ImportResult {
  imported: number
  skipped: number
  errors: number
  total: number
  firstDate: string
  lastDate: string
  rowErrors: UploadRowError[]
  maintenanceStatus?: 'not_started' | 'queued' | 'running' | 'completed' | 'partial_failure'
  overlap?: ConfirmUploadResponse['overlap']
  replayed?: boolean
}


interface DataStatus {
  latestDataDate: string | null
  earliestDataDate: string | null
  daysSinceLatest: number | null
  totalTransactions: number
  coverage30d: { date: string; count: number }[]
}

type UploadPhase = 'uploading' | 'importing' | 'validating' | 'forecasting'

const uploadPhaseText: Record<UploadPhase, { title: string; detail: string; progress: number }> = {
  uploading: {
    title: 'Uploading file',
    detail: 'Sending your spreadsheet to Your Guava.',
    progress: 20,
  },
  importing: {
    title: 'Importing transactions',
    detail: 'Reading rows, skipping declined payments, and checking for duplicates.',
    progress: 55,
  },
  validating: {
    title: 'Validating menu items',
    detail: 'Matching POS item names and prices to your Menu Items.',
    progress: 75,
  },
  forecasting: {
    title: 'Refreshing forecasts',
    detail: 'Updating actuals and regenerating the next 7 days.',
    progress: 92,
  },
}

function ProcessingOverlay({
  phase,
  progress,
  onCancel,
}: {
  phase: UploadPhase
  progress: number
  onCancel?: () => void
}) {
  const current = uploadPhaseText[phase]
  const pct = Math.max(current.progress, progress)
  const steps: UploadPhase[] = ['uploading', 'importing', 'validating', 'forecasting']
  const activeIndex = steps.indexOf(phase)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-progress-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-guava-red/10">
            <LoaderCircle className="h-5 w-5 animate-spin text-guava-red-text" />
          </div>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p id="import-progress-title" className="font-semibold text-text">{current.title}</p>
            <p className="mt-1 text-sm text-muted">{current.detail}</p>
          </div>
          <span className="text-xs font-semibold text-muted">{pct}%</span>
        </div>

        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-5 h-2 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full rounded-full bg-guava-red transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-5 space-y-2">
          {steps.map((step, index) => {
            const done = index < activeIndex
            const active = index === activeIndex
            return (
              <div key={step} className="flex items-center gap-2 text-sm">
                {done ? (
                  <CheckCircle className="h-4 w-4 text-guava-green" />
                ) : active ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-guava-red-text" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border" />
                )}
                <span className={cn(done || active ? 'text-text' : 'text-muted')}>
                  {uploadPhaseText[step].title}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-5 text-xs text-muted">
          Large spreadsheets can take a little while. Keep this tab open until the import finishes.
        </p>

        {onCancel ? (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel upload
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            Your rows are being written now, so this step cannot be cancelled. If the tab closes the
            import carries on and the result appears in Upload History.
          </p>
        )}
      </div>
    </div>
  )
}

// Build an array of 30 dates: [today-29, ..., today] as YYYY-MM-DD strings
/**
 * The last 30 *completed* trading days, ending yesterday.
 *
 * Today used to be in this window, so a cafe that had not yet made a sale was
 * told "1 of the last 30 days have no data" at nine in the morning - a gap it
 * could do nothing about and had not actually left. Today is rendered
 * separately, labelled, and never counted as missing.
 */
function buildLast30Days(): string[] {
  const days: string[] = []
  for (let i = 30; i >= 1; i--) {
    days.push(toLocalDateOnly(addLocalDays(new Date(), -i)))
  }
  return days
}

// `new Date('2026-05-04')` is parsed as UTC midnight, so west of UTC every
// date-only key rendered as the day before. parseDateOnly pins it to local noon.
function formatDate(iso: string): string {
  return parseDateOnly(iso).toLocaleDateString('en-ZA')
}

function monthsSpan(earliest: string, latest: string): string {
  const e = parseDateOnly(earliest)
  const l = parseDateOnly(latest)
  const months = (l.getFullYear() - e.getFullYear()) * 12 + (l.getMonth() - e.getMonth())
  if (months <= 0) return '< 1 month'
  if (months === 1) return '1 month'
  return `${months} months`
}

function DataStatusCard({
  status,
  loading,
  error,
  uploadDisabled,
  onRetry,
  onUploadClick,
}: {
  status: DataStatus | null
  loading: boolean
  error: boolean
  uploadDisabled: boolean
  onRetry: () => void
  onUploadClick: () => void
}) {
  const days30 = buildLast30Days()
  const today = toLocalDateOnly(new Date())
  const coverageMap = new Map<string, number>()
  status?.coverage30d.forEach((c) => coverageMap.set(c.date, c.count))
  const emptyDayCount = days30.filter((day) => !(coverageMap.get(day) ?? 0)).length
  const todayCount = coverageMap.get(today) ?? 0

  const daysSince = status?.daysSinceLatest ?? null
  let pillColor = 'bg-red-500/20 text-red-400 border-red-500/30'
  let statusLabel = 'No data uploaded yet'
  let statusSubtitle = 'Upload your first sales CSV or XLSX to get started.'
  let statusAction: string | null = null

  if (!loading && status && status.latestDataDate) {
    if (daysSince !== null && daysSince < 2) {
      // Opaque ground, not a /20 alpha fill: composited over the card this measured
      // 4.2:1 (#4da63b on #243621) at 12px, under the 4.5 AA needs. The palette
      // already carries the fixed token for exactly this.
      pillColor = 'bg-guava-green-surface text-guava-green border-guava-green/30'
      statusLabel = 'Data is up to date'
    } else if (daysSince !== null && daysSince <= 7) {
      pillColor = 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      statusLabel = `Data is ${daysSince} day${daysSince === 1 ? '' : 's'} behind`
    } else {
      pillColor = 'bg-red-500/20 text-red-400 border-red-500/30'
      statusLabel = daysSince !== null ? `Data is ${daysSince} days behind` : 'Data status unknown'
    }

    const txLabel = status.totalTransactions.toLocaleString() + ' transactions'
    const span = status.earliestDataDate
      ? monthsSpan(status.earliestDataDate, status.latestDataDate)
      : ''
    statusSubtitle = `Latest: ${formatDate(status.latestDataDate)} · ${txLabel}${span ? ` across ${span}` : ''}`

    // "Data is 4 days behind" states a fact the owner already knows and gives them
    // nothing to do with it. Name the window they need to export, starting the day
    // after the last sale we hold, so the next file picks up exactly where this one
    // stopped and nothing is either missed or re-imported.
    if (daysSince !== null && daysSince >= 2) {
      const from = formatDate(toLocalDateOnly(addLocalDays(parseDateOnly(status.latestDataDate), 1)))
      statusAction = `Export ${from} onwards from your till and upload it here.`
    }
  }

  const isActionNeeded = !status?.latestDataDate || (daysSince !== null && daysSince >= 2)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-guava-red-text" />
          <CardTitle>Data Status</CardTitle>
        </div>
        <CardDescription>How fresh is your uploaded transaction data?</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted text-sm py-2">
            <div className="w-4 h-4 border-2 border-[#555555]/30 border-t-[#555555] rounded-full animate-spin" />
            Checking data status…
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 py-2" role="alert">
            <div>
              <p className="text-sm font-medium text-red-300">Data status is unavailable</p>
              <p className="mt-1 text-xs text-muted">Guava could not verify freshness. Your uploaded data has not been removed.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>Try again</Button>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            {/* Left: status */}
            <div className="flex-1 min-w-0">
              <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium mb-2', pillColor)}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {statusLabel}
              </div>
              <p className="text-[#9E9E9E] text-sm truncate">{statusSubtitle}</p>
              {statusAction && (
                <p className="text-text text-sm mt-1">{statusAction}</p>
              )}
            </div>

            {/* Middle: 30-day coverage strip */}
            <div className="shrink-0">
              <p className="text-muted text-xs mb-1.5">Last 30 days</p>
              <div className="flex gap-0.5" role="list" aria-label="Data coverage for the last 30 completed days, plus today">
                {days30.map((day) => {
                  const count = coverageMap.get(day)
                  const hasData = count !== undefined && count > 0
                  const dayLabel = `${formatDate(day)}: ${count ?? 0} transactions`
                  return (
                    <div
                      key={day}
                      role="listitem"
                      aria-label={dayLabel}
                      title={dayLabel}
                      className={cn(
                        'w-3 h-6 rounded-sm cursor-default',
                        hasData ? 'bg-guava-red' : 'bg-border'
                      )}
                    />
                  )
                })}
                {/* Today, set apart. It is in progress, not missing: a cafe that
                    has not sold anything yet this morning has left no gap. */}
                <div
                  role="listitem"
                  aria-label={`Today: ${todayCount} transactions so far`}
                  title={`Today: ${todayCount} transactions so far`}
                  className={cn(
                    'w-3 h-6 rounded-sm cursor-default ml-1 border border-dashed border-border',
                    todayCount > 0 ? 'bg-guava-red' : 'bg-transparent'
                  )}
                />
              </div>
              {/* The strip carries has-data/no-data in colour alone, which is
                  neither readable by a screen reader nor safe for a colour
                  vision deficiency. This is the text equivalent. */}
              <p className="text-muted text-xs mt-1.5">
                {emptyDayCount === 0
                  ? 'All 30 completed days have data. Today is still in progress.'
                  : `${emptyDayCount} of the last 30 completed days have no data. Today is still in progress.`}
              </p>
            </div>

            {/* Right: action */}
            <div className="shrink-0">
              {isActionNeeded ? (
                <Button
                  size="sm"
                  className="bg-guava-green-strong hover:bg-[#35722A] text-white rounded-lg"
                  onClick={onUploadClick}
                  disabled={uploadDisabled}
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload latest data
                </Button>
              ) : (
                <div className="flex items-center gap-1.5 text-guava-green text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Up to date
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Connect() {
  const { isOwner } = useAuth()
  // ── Data status state ────────────────────────────────────────────
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [dataStatusLoading, setDataStatusLoading] = useState(true)
  const [dataStatusError, setDataStatusError] = useState(false)

  // ── CSV Upload state ─────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error' | 'duplicate' | 'still_running'>('idle')
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('uploading')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  // Menu items an import created that do not match anything yet. The import is
  // what caused that work, so this is where the owner should hear about it - not
  // by noticing a separate nav entry later.
  const [itemsNeedingMatch, setItemsNeedingMatch] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [extraFilesNotice, setExtraFilesNotice] = useState<string | null>(null)
  const [lastUpload, setLastUpload] = useState<string | null>(null)
  const [stageResponse, setStageResponse] = useState<StageUploadResponse | null>(null)
  const [stageErrorMsg, setStageErrorMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)
  const phaseTimerRef = useRef<number | null>(null)

  const wizardOpen = Boolean(stageResponse)

  const clearPhaseTimer = () => {
    if (phaseTimerRef.current != null) {
      window.clearTimeout(phaseTimerRef.current)
      phaseTimerRef.current = null
    }
  }

  useEffect(() => () => {
    clearPhaseTimer()
    uploadAbortRef.current?.abort()
  }, [])

  const confirmUpload = (
    uploadId: string,
    columnMapping: ColumnMapping,
    itemsMode: ItemsMode
  ): Promise<ConfirmUploadResponse> =>
    confirmUploadRequest(uploadId, columnMapping, itemsMode, {
      onPartialImport: (failed, total) =>
        window.confirm(
          `${failed ?? 'Many'} of ${total ?? 'the'} rows could not be imported. ` +
          'Import only the valid rows anyway? You can review the rejected-row report afterward.'
        ),
    })

  const finishConfirmation = (confirmed: ConfirmUploadResponse) => {
    // Best-effort: a failure here must not spoil a successful import, so the
    // count simply stays at zero and the line is not shown.
    // Only the count is read; the list is paged since BE-03-T14, so ask for the smallest page. needsReview counts
    // active items, the same number Menu Items shows (counts.needs_review includes deactivated ones).
    api.get<{ meta?: { needsReview?: number } }>('/items', { params: { limit: 1 } })
      .then(({ data }) => setItemsNeedingMatch(data.meta?.needsReview ?? 0))
      .catch(() => setItemsNeedingMatch(0))
    setResult({
      imported: confirmed.stats.imported,
      skipped: confirmed.stats.skipped,
      errors: confirmed.stats.errors,
      total: confirmed.stats.totalRows,
      firstDate: confirmed.dateRange?.firstDateKey ?? confirmed.dateRange?.firstDate ?? '',
      lastDate: confirmed.dateRange?.lastDateKey ?? confirmed.dateRange?.lastDate ?? '',
      rowErrors: confirmed.rowErrors || [],
      maintenanceStatus: confirmed.maintenance?.status,
      overlap: confirmed.overlap,
      replayed: confirmed.replayed,
    })
    setUploadState('success')
    setHistoryRefreshKey((key) => key + 1)
    setLastUpload(new Date().toISOString())
  }

  const handleUploadFailure = (err: unknown) => {
    clearPhaseTimer()
    if (cancelledRef.current) {
      cancelledRef.current = false
      return
    }
    if ((err as { uploadStillRunning?: boolean })?.uploadStillRunning) {
      setUploadState('still_running')
      setHistoryRefreshKey((key) => key + 1)
      return
    }
    const msg = uploadFailureMessage(err)
    setErrorMsg(msg)
    // Re-importing a file you already uploaded is normal housekeeping, not a
    // failure. The rows were skipped because they are already safely stored.
    setUploadState(isDuplicateUploadMessage(msg) ? 'duplicate' : 'error')
  }

  // ── Fetch data status ────────────────────────────────────────────
  const fetchDataStatus = async (signal?: AbortSignal) => {
    try {
      setDataStatusLoading(true)
      setDataStatusError(false)
      const { data } = await api.get<{ success: boolean; data: DataStatus }>('/transactions/status', { signal })
      setDataStatus(data.data)
    } catch {
      if (!signal?.aborted) {
        setDataStatus(null)
        setDataStatusError(true)
      }
    } finally {
      if (!signal?.aborted) setDataStatusLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchDataStatus(controller.signal)
    return () => controller.abort()
  }, [historyRefreshKey])

  // ── CSV Upload handlers ──────────────────────────────────────────
  const handleFile = async (file: File) => {
    const validTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    const lowerName = file.name.toLowerCase()
    const validExt = lowerName.endsWith('.csv') || lowerName.endsWith('.xlsx')

    if (!validTypes.includes(file.type) && !validExt) {
      setErrorMsg(
        lowerName.endsWith('.xls') ? XLS_GUIDANCE : INVALID_TYPE
      )
      setUploadState('error')
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMsg(
        'File is too large. Please upload a file under 10 MB. Export a shorter date range, or split the file by month — rows you have already imported are skipped automatically, so uploading month by month is safe.'
      )
      setUploadState('error')
      return
    }

    const controller = new AbortController()
    uploadAbortRef.current = controller
    cancelledRef.current = false

    setUploadState('uploading')
    setUploadPhase('uploading')
    setProgress(0)
    setErrorMsg(null)
    setResult(null)
    setStageErrorMsg(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const { data } = await api.post<StageUploadResponse>('/transactions/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
        signal: controller.signal,
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.min(35, Math.round((e.loaded / e.total) * 35)))
        },
      })
      if (data.needsConfirmation) {
        setStageResponse(data)
        setStageErrorMsg(null)
        setUploadState('idle')
      } else {
        // Auto-confirm any POS file with a complete preset or saved mapping.
        setUploadPhase('importing')
        setProgress(55)
        clearPhaseTimer()
        phaseTimerRef.current = window.setTimeout(() => {
          setUploadPhase('validating')
          setProgress(75)
        }, 600)
        const confirmed = await confirmUpload(
          data.uploadId,
          data.columnMapping,
          data.itemsMode
        )
        clearPhaseTimer()
        setUploadPhase('forecasting')
        setProgress(95)
        finishConfirmation(confirmed)
      }
    } catch (err: unknown) {
      handleUploadFailure(err)
    } finally {
      uploadAbortRef.current = null
    }
  }

  const cancelUpload = () => {
    cancelledRef.current = true
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    clearPhaseTimer()
    reset()
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length === 0) return
    const [first, ...rest] = files
    // Dropping a folder of monthly exports is the natural first-run gesture, and
    // the extra files used to be discarded in silence.
    setExtraFilesNotice(
      rest.length > 0
        ? `Only ${first.name} is being imported. Your Guava imports one file at a time — drop the other ${rest.length} file${rest.length === 1 ? '' : 's'} one after another.`
        : null
    )
    handleFile(first)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    setExtraFilesNotice(null)
    if (file) handleFile(file)
    e.target.value = ''
  }

  const reset = () => {
    setUploadState('idle')
    setResult(null)
    setErrorMsg(null)
    setStageErrorMsg(null)
    setExtraFilesNotice(null)
    setProgress(0)
    setUploadPhase('uploading')
  }

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  // Detect whether any of the uploaded date range is in the past
  const actualsWereFilled = result?.firstDate
    ? parseDateOnly(result.firstDate) < parseDateOnly(toLocalDateOnly(new Date()))
    : false

  // An import that ends before today has nothing to say about today, so send the
  // owner to the week plan instead.
  const importIsHistorical = result?.lastDate
    ? parseDateOnly(result.lastDate) < parseDateOnly(toLocalDateOnly(new Date()))
    : false
  const forwardTarget = importIsHistorical
    ? { to: '/planning', label: 'See your forecast plan' }
    : { to: '/today', label: "See today's forecast" }

  const importedDaysCount =
    result?.firstDate && result?.lastDate
      ? Math.max(
          1,
          Math.round(
            (parseDateOnly(result.lastDate).getTime() - parseDateOnly(result.firstDate).getTime()) /
              86400000
          ) + 1
        )
      : null

  return (
    <AppLayout title="Data Health">
      <div className="space-y-6">
        {/* Hidden file input (shared between Data Status card CTA and Upload card) */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={onFileChange}
        />

        {/* ── Data Status Card ──────────────────────────────────────────── */}
        <DataStatusCard
          status={dataStatus}
          loading={dataStatusLoading}
          error={dataStatusError}
          uploadDisabled={wizardOpen}
          onRetry={() => fetchDataStatus()}
          onUploadClick={openFilePicker}
        />

        {/* ── Upload Card ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-guava-red-text" />
              <CardTitle>Upload Sales Data</CardTitle>
            </div>
            <CardDescription>
              Upload a POS CSV or XLSX export. Unknown formats can use AI-assisted mapping when permitted;
              a new AI mapping uses 10 Guava Credits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {extraFilesNotice && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="status">
                {extraFilesNotice}
              </div>
            )}

            {/* Drop zone. Hidden while the mapping wizard is open so a second
                file cannot be staged underneath the modal, which left the
                wizard showing the new file's headers over the old file's
                mapping. */}
            {uploadState === 'idle' && !wizardOpen && (
              <div
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={openFilePicker}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openFilePicker()
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Choose a sales CSV or XLSX file to upload"
                aria-describedby="upload-constraints"
                className={cn(
                  'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
                  isDragging
                    ? 'border-guava-red bg-guava-red/5'
                    : 'border-border hover:border-[#3A3A3A] hover:bg-white/[0.02]'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-[#111111] border border-border flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-6 h-6 text-muted" />
                </div>
                <p className="text-text font-medium mb-1">
                  Drop your sales CSV or XLSX here
                </p>
                <p className="text-muted text-sm">
                  or{' '}
                  <span className="text-guava-red-text hover:underline">click to browse</span>
                </p>
                {/* Every limit stated before the choice. These used to appear
                    only as a rejection after the file had been picked. */}
                <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                  <Badge variant="secondary">.csv</Badge>
                  <Badge variant="secondary">.xlsx</Badge>
                  <Badge variant="secondary">up to 10 MB</Badge>
                  <Badge variant="secondary">up to {MAX_UPLOAD_ROWS.toLocaleString('en-ZA')} rows</Badge>
                </div>
                <p id="upload-constraints" className="text-muted text-xs mt-3 max-w-md mx-auto">
                  Your export needs a date column, an items or description column, and a total column.
                  Longer histories can be uploaded month by month — rows you have already imported are
                  skipped automatically.
                </p>
              </div>
            )}

            {/* Success */}
            {uploadState === 'success' && result && (
              <div className="bg-guava-green/5 border border-guava-green/20 rounded-xl p-6" role="status">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-guava-green shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-text font-medium mb-1">
                      {result.errors > 0 ? 'Import completed with rejected rows' : 'Import successful'}
                    </p>
                    <p className="text-muted text-sm mb-4">
                      Your committed transaction data is safe. Forecast maintenance continues in the background when needed.
                    </p>
                    {result.replayed && (
                      <p className="mb-4 rounded-lg border border-guava-green/20 bg-guava-green/5 px-3 py-2 text-xs text-guava-green">
                        The original response was interrupted, so this completed import was recovered from server status.
                      </p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                      <div className="bg-[#111111] border border-border rounded-lg p-3 text-center">
                        <p className="text-guava-green text-xl font-bold">{result.imported.toLocaleString()}</p>
                        <p className="text-muted text-xs">imported</p>
                      </div>
                      <div className="bg-[#111111] border border-border rounded-lg p-3 text-center">
                        <p className="text-muted text-xl font-bold">{result.skipped.toLocaleString()}</p>
                        <p className="text-muted text-xs">skipped</p>
                      </div>
                      <div className="bg-[#111111] border border-border rounded-lg p-3 text-center">
                        <p className={cn('text-xl font-bold', result.errors > 0 ? 'text-amber-300' : 'text-muted')}>
                          {result.errors.toLocaleString()}
                        </p>
                        <p className="text-muted text-xs">rejected</p>
                      </div>
                      <div className="bg-[#111111] border border-border rounded-lg p-3 text-center">
                        <p className="text-text text-xl font-bold">{result.total.toLocaleString()}</p>
                        <p className="text-muted text-xs">total rows</p>
                      </div>
                    </div>
                    {result.firstDate && result.lastDate && (
                      <p className="text-muted text-xs mb-4">
                        Date range: {parseDateOnly(result.firstDate).toLocaleDateString('en-ZA')} → {parseDateOnly(result.lastDate).toLocaleDateString('en-ZA')}
                      </p>
                    )}
                    {result.errors > 0 && (
                      <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                        <p className="text-sm font-medium text-amber-200">
                          {result.errors.toLocaleString()} row{result.errors === 1 ? '' : 's'} {result.errors === 1 ? 'was' : 'were'} not imported
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Everything else is in. Fix the rows below in your export and upload just those
                          — rows already imported are skipped, so nothing is duplicated.
                        </p>
                        {result.rowErrors.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-amber-100">
                            {result.rowErrors.slice(0, 5).map((rowError, index) => (
                              <li key={`${rowError.rowNumber ?? 'row'}-${index}`}>
                                {rowError.rowNumber ? `Row ${rowError.rowNumber}: ` : ''}{rowError.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs text-muted">
                          Upload History has the full rejected-row report, up to the first 50.
                        </p>
                      </div>
                    )}

                    {/* What this did */}
                    <div className="bg-[#111111] border border-border rounded-lg p-3 mb-4">
                      <p className="text-muted text-xs font-medium mb-2 uppercase tracking-wide">What this did</p>
                      <ul className="space-y-1.5">
                        <li className="flex items-start gap-2 text-muted text-sm">
                          <span className="text-guava-green mt-0.5">•</span>
                          <span>
                            Imported {result.imported.toLocaleString()} transactions
                            {importedDaysCount ? ` covering ${importedDaysCount} day${importedDaysCount === 1 ? '' : 's'}` : ''}
                          </span>
                        </li>
                        {overlapSkipMessage(result.overlap) && (
                          <li className="flex items-start gap-2 text-muted text-sm">
                            <span className="text-guava-green mt-0.5">•</span>
                            <span>{overlapSkipMessage(result.overlap)}</span>
                          </li>
                        )}
                        {actualsWereFilled && (
                          <li className="flex items-start gap-2 text-muted text-sm">
                            <span className="text-guava-red-text mt-0.5">•</span>
                            <span>
                              Filled actuals for past days — see{' '}
                              <Link to="/planning" className="text-guava-red-text hover:underline">
                                Planning - Last week's results
                              </Link>
                            </span>
                          </li>
                        )}
                        <li className="flex items-start gap-2 text-muted text-sm">
                          <span className="text-guava-green mt-0.5">•</span>
                          <span>
                            {result.maintenanceStatus === 'completed'
                              ? 'Refreshed forecast inputs and the next planning week'
                              : 'Queued a durable forecast and actuals refresh'}
                          </span>
                        </li>
                        {itemsNeedingMatch > 0 && (
                          <li className="flex items-start gap-2 text-muted text-sm">
                            <span className="text-guava-yellow mt-0.5">•</span>
                            <span>
                              {itemsNeedingMatch.toLocaleString('en-ZA')} menu item
                              {itemsNeedingMatch === 1 ? '' : 's'} still need matching to your
                              menu —{' '}
                              <Link
                                to="/data-health/menu-items"
                                className="text-guava-red-text hover:underline"
                              >
                                review them
                              </Link>
                            </span>
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
                {/* The owner came for a number. Offering only "upload another
                    file" here is the drop-off point of the whole onboarding. */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button asChild variant="success" size="sm">
                    <Link to={forwardTarget.to}>
                      {forwardTarget.label}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Upload another file
                  </Button>
                </div>
              </div>
            )}

            {/* Already imported - a no-op, not a failure */}
            {uploadState === 'duplicate' && (
              <div className="bg-surface border border-border rounded-xl p-6" role="status">
                <div className="flex items-start gap-3 mb-4">
                  <CheckCircle className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                  <div>
                    <p className="text-text font-medium mb-1">Already up to date</p>
                    <p className="text-muted text-sm">
                      Every row in this file was imported previously, so nothing changed.
                      Your existing data is untouched.
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={reset}>
                  Upload a different file
                </Button>
              </div>
            )}

            {/* Slow but alive - never reported as a failure */}
            {uploadState === 'still_running' && (
              <div className="bg-surface border border-border rounded-xl p-6" role="status">
                <div className="flex items-start gap-3 mb-4">
                  <Clock className="w-5 h-5 text-muted shrink-0 mt-0.5" />
                  <div>
                    <p className="text-text font-medium mb-1">Still importing</p>
                    <p className="text-muted text-sm">
                      This file is taking longer than usual and the import is still running on our
                      side. Do not upload it again — it will finish on its own and appear in Upload
                      History below with its final result.
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => { reset(); setHistoryRefreshKey((key) => key + 1) }}>
                  Refresh upload history
                </Button>
              </div>
            )}

            {/* Error */}
            {uploadState === 'error' && (
              <div className="bg-red-900/10 border border-red-900/30 rounded-xl p-6" role="alert">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-text font-medium mb-1">Upload failed</p>
                    <p className="text-red-400 text-sm">{errorMsg}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={reset}>
                  Try again
                </Button>
              </div>
            )}

            {/* Last upload timestamp */}
            {lastUpload && uploadState !== 'uploading' && (
              <div className="flex items-center gap-1.5 text-muted text-xs">
                <Clock className="w-3 h-3" />
                <span>Last upload: {new Date(lastUpload).toLocaleString('en-ZA')}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <UploadHistoryCard refreshKey={historyRefreshKey} canRemove={isOwner} />
        <SavedMappingCard refreshKey={historyRefreshKey} canClear={isOwner} />
      </div>

      {stageResponse && (
        <ColumnMappingWizard
          // Identity per staged upload. Without it a second staged file
          // rendered the new headers over the first file's retained mapping.
          key={stageResponse.uploadId}
          open
          headers={stageResponse.headers}
          preview={stageResponse.preview}
          initialMapping={stageResponse.columnMapping}
          initialItemsMode={stageResponse.itemsMode}
          errorMessage={stageErrorMsg}
          assistiveNotice={
            [savedMappingNotice(stageResponse.savedMapping), mappingAssistNotice(stageResponse)].filter(Boolean).join(' ') || null
          }
          onCancel={() => {
            const proceed = window.confirm(
              'Discard this file? It will not be imported, and the copy we staged is thrown away. You can upload the same file again at any time.'
            )
            if (!proceed) return
            setStageResponse(null)
            setStageErrorMsg(null)
            setHistoryRefreshKey((key) => key + 1)
          }}
          onConfirm={async (mapping: ColumnMapping, itemsMode: ItemsMode) => {
            try {
              setUploadState('uploading')
              setUploadPhase('importing')
              setProgress(55)
              setStageErrorMsg(null)
              clearPhaseTimer()
              phaseTimerRef.current = window.setTimeout(() => {
                setUploadPhase('validating')
                setProgress(75)
              }, 600)
              const confirmed = await confirmUpload(
                stageResponse.uploadId,
                mapping,
                itemsMode
              )
              clearPhaseTimer()
              setUploadPhase('forecasting')
              setProgress(95)
              finishConfirmation(confirmed)
              setStageResponse(null)
              setStageErrorMsg(null)
            } catch (err: unknown) {
              clearPhaseTimer()
              if ((err as { uploadStillRunning?: boolean })?.uploadStillRunning) {
                setStageResponse(null)
                setUploadState('still_running')
                setHistoryRefreshKey((key) => key + 1)
                return
              }
              const msg = uploadFailureMessage(err)
              setErrorMsg(msg)
              setStageErrorMsg(msg)
              setUploadState('error')
            }
          }}
        />
      )}
      {uploadState === 'uploading' && (
        <ProcessingOverlay
          phase={uploadPhase}
          progress={progress}
          // Cancelling is only honest before the commit POST is in flight;
          // after that the server may already be writing rows.
          onCancel={uploadPhase === 'uploading' ? cancelUpload : undefined}
        />
      )}
    </AppLayout>
  )
}
