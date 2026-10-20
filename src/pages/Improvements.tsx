import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router'
import {
  Lightbulb,
  Wrench,
  Plus,
  CheckCircle,
  AlertCircle,
  Trash2,
  MessageSquarePlus,
  User as UserIcon,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { API_ERROR_COPY, describeApiError, readApiError, waitSeconds } from '@/lib/apiErrors'
import type {
  Improvement,
  ImprovementType,
  ImprovementArea,
  ImprovementPriority,
  ImprovementStatus,
  ImprovementStatusCounts,
} from '@/types'

// ── Config (kept in sync with the backend Improvement model enums) ─────────────

const PAGE_SIZE = 50

// Single source of truth for areas. Declared as an exhaustive Record so adding a
// new ImprovementArea without a label is a compile error. Options derive from it.
const AREA_LABELS: Record<ImprovementArea, string> = {
  dashboard: 'Today / Dashboard',
  planning: 'Planning / Forecasts',
  analytics: 'Performance',
  history: 'History',
  ask_guava: 'Ask Guava',
  data_uploads: 'Data & Uploads',
  menu_items: 'Menu Items',
  integrations: 'Integrations',
  team: 'Team',
  settings: 'Settings',
  billing: 'Billing',
  other: 'Other / General',
}
const AREA_OPTIONS = (Object.keys(AREA_LABELS) as ImprovementArea[]).map((value) => ({
  value,
  label: AREA_LABELS[value],
}))

const PRIORITY_OPTIONS: ImprovementPriority[] = ['low', 'medium', 'high']
// Clear low→high ramp: muted → amber → red (no collision with the status badges).
const PRIORITY_BADGE: Record<ImprovementPriority, 'secondary' | 'warning' | 'destructive'> = {
  low: 'secondary',
  medium: 'warning',
  high: 'destructive',
}

const STATUS_OPTIONS: ImprovementStatus[] = ['open', 'planned', 'in_progress', 'done', 'declined']
const STATUS_LABELS: Record<ImprovementStatus, string> = {
  open: 'Open',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
}
const STATUS_BADGE: Record<ImprovementStatus, 'warning' | 'outline' | 'default' | 'success' | 'secondary'> = {
  open: 'warning',
  planned: 'outline',
  in_progress: 'default',
  done: 'success',
  declined: 'secondary',
}

const FILTERS: { value: 'all' | ImprovementStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'declined', label: 'Declined' },
]

const TEXTAREA_CLASS =
  'flex w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text placeholder:text-muted scheme-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red resize-y'
const SELECT_CLASS =
  'flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text scheme-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Type chip ──────────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: ImprovementType }) {
  const isFix = type === 'fix'
  const Icon = isFix ? Wrench : Lightbulb
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        isFix ? 'bg-guava-red/15 text-guava-red-text' : 'bg-guava-green/15 text-guava-green'
      )}
    >
      <Icon className="h-3 w-3" />
      {isFix ? 'Fix' : 'Improvement'}
    </span>
  )
}

// ── Log form ─────────────────────────────────────────────────────────────────

interface LogFormValues {
  type: ImprovementType
  title: string
  area: ImprovementArea
  priority: ImprovementPriority
  description: string
  desiredOutcome: string
}

interface LogFormProps {
  onSubmit: (values: LogFormValues) => Promise<void>
  onCancel: () => void
}

function LogForm({ onSubmit, onCancel }: LogFormProps) {
  const [type, setType] = useState<ImprovementType>('improvement')
  const [title, setTitle] = useState('')
  const [area, setArea] = useState<ImprovementArea>('other')
  const [priority, setPriority] = useState<ImprovementPriority>('medium')
  const [description, setDescription] = useState('')
  const [desiredOutcome, setDesiredOutcome] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ type, title: title.trim(), area, priority, description: description.trim(), desiredOutcome: desiredOutcome.trim() })
    } catch (err: unknown) {
      // POST /improvements sits behind a write rate limiter and has server-side
      // field validation. "Please try again" is wrong advice for the first and
      // useless for the second.
      // The limiter's own 429 carries a code and a Retry-After: say how long to wait, as Data Health does (UAT-14-S24).
      const info = readApiError(err)
      const wait = waitSeconds(info)
      if (wait && info.code && API_ERROR_COPY[info.code]) {
        setError(`${describeApiError(info).body} Try again in ${wait} seconds.`)
        return
      }
      const serverMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(serverMessage || 'Could not save. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-6 border-guava-red/20">
      <CardContent className="pt-5 pb-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type toggle */}
          <div role="group" aria-labelledby="imp-type-label">
            <Label id="imp-type-label" className="text-xs text-muted">
              What are you logging?
            </Label>
            <div className="mt-1.5 inline-flex rounded-lg border border-border bg-[#111111] p-0.5">
              {(['improvement', 'fix'] as ImprovementType[]).map((value) => {
                const active = type === value
                const Icon = value === 'fix' ? Wrench : Lightbulb
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setType(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {value === 'fix' ? 'Something to fix' : 'An improvement'}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="imp-title" className="text-xs text-muted">
              Title *
            </Label>
            <Input
              id="imp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'fix' ? 'e.g. Forecast chart cuts off on mobile' : 'e.g. Add a weekly email summary'}
              maxLength={140}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="imp-area" className="text-xs text-muted">
                Area of the app
              </Label>
              <select
                id="imp-area"
                value={area}
                onChange={(e) => setArea(e.target.value as ImprovementArea)}
                className={SELECT_CLASS}
              >
                {AREA_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="imp-priority" className="text-xs text-muted">
                Priority
              </Label>
              <select
                id="imp-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as ImprovementPriority)}
                className={SELECT_CLASS}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="imp-desc" className="text-xs text-muted">
              {type === 'fix' ? "What's wrong? *" : "What's the idea? *"}
            </Label>
            <textarea
              id="imp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                type === 'fix'
                  ? 'Describe the problem and, if you can, the steps to see it happen.'
                  : 'Describe the improvement and why it would help.'
              }
              rows={3}
              maxLength={4000}
              className={TEXTAREA_CLASS}
            />
          </div>

          <div>
            <Label htmlFor="imp-outcome" className="text-xs text-muted">
              What would "done" look like? <span className="text-muted">(optional)</span>
            </Label>
            <textarea
              id="imp-outcome"
              value={desiredOutcome}
              onChange={(e) => setDesiredOutcome(e.target.value)}
              placeholder="The outcome you'd expect once this is fixed or built."
              rows={2}
              maxLength={2000}
              className={TEXTAREA_CLASS}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="success" size="sm" disabled={!canSubmit}>
              <Plus className="h-4 w-4" />
              {submitting ? 'Logging...' : 'Log it'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Ticket card ────────────────────────────────────────────────────────────────

interface TicketCardProps {
  ticket: Improvement
  canManage: boolean
  onStatusChange: (id: string, status: ImprovementStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function TicketCard({ ticket, canManage, onStatusChange, onDelete }: TicketCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const reporter = ticket.createdBy?.name || ticket.createdBy?.email || 'A team member'

  async function handleStatus(status: ImprovementStatus) {
    setBusy(true)
    try {
      await onStatusChange(ticket._id, status)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await onDelete(ticket._id)
    } finally {
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  return (
    // Container opacity composites the card's own text against the page:
    // `text-muted` measured 3.08:1 at 70% and 2.37:1 at 55%, well under AA, on
    // content the user is still expected to read. The status badge and a dashed
    // border carry the state instead, at full text contrast.
    <Card className={cn(ticket.status === 'declined' && 'border-dashed')}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted">#{ticket.ticketNumber}</span>
              <TypeChip type={ticket.type} />
              <Badge variant={STATUS_BADGE[ticket.status]} className="text-[10px]">
                {STATUS_LABELS[ticket.status]}
              </Badge>
            </div>
            <h3 className="text-sm font-semibold text-text">{ticket.title}</h3>
          </div>
          <Badge variant={PRIORITY_BADGE[ticket.priority]} className="shrink-0 text-[10px] capitalize">
            {ticket.priority}
          </Badge>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{ticket.description}</p>

        {ticket.desiredOutcome && (
          <div className="mt-3 rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted">Desired outcome</p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{ticket.desiredOutcome}</p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{AREA_LABELS[ticket.area]}</span>
          <span className="inline-flex items-center gap-1">
            <UserIcon className="h-3 w-3" />
            {reporter}
          </span>
          <span>{formatDate(ticket.createdAt)}</span>
        </div>

        {canManage && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Label htmlFor={`status-${ticket._id}`} className="text-[10px] text-muted">
                Status
              </Label>
              <select
                id={`status-${ticket._id}`}
                value={ticket.status}
                disabled={busy}
                onChange={(e) => handleStatus(e.target.value as ImprovementStatus)}
                className="h-7 rounded-md border border-[#333333] bg-[#111111] px-2 text-xs text-text scheme-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red disabled:opacity-50"
                aria-label={`Status for ticket ${ticket.ticketNumber}`}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            {confirmingDelete ? (
              <div className="flex items-center gap-1.5" role="group" aria-label={`Confirm deleting ticket ${ticket.ticketNumber}`}>
                <span className="text-[11px] text-muted">Delete?</span>
                <Button variant="destructive" size="sm" className="h-7" onClick={handleDelete} disabled={busy}>
                  Yes
                </Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => setConfirmingDelete(false)} disabled={busy} autoFocus>
                  No
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted hover:text-red-400"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete ticket ${ticket.ticketNumber}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_COUNTS: ImprovementStatusCounts = {
  all: 0,
  open: 0,
  planned: 0,
  in_progress: 0,
  done: 0,
  declined: 0,
}

type ToastState = { type: 'success' | 'error'; message: string } | null

interface ListResponse {
  improvements: Improvement[]
  counts: ImprovementStatusCounts
  pagination?: { total: number; page: number; limit: number; pages: number }
}

export default function Improvements() {
  const { isOwner } = useAuth()
  const location = useLocation()
  const [tickets, setTickets] = useState<Improvement[]>([])
  const [counts, setCounts] = useState<ImprovementStatusCounts>(EMPTY_COUNTS)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState<'all' | ImprovementStatus>('all')
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    setToast({ type, message })
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  // Fetch a page of tickets. `append` adds to the list (Load more); `silent`
  // refreshes in place without flashing skeletons (status change / delete).
  const load = useCallback(
    async (
      status: 'all' | ImprovementStatus,
      pageNum = 1,
      { append = false, silent = false }: { append?: boolean; silent?: boolean } = {}
    ): Promise<boolean> => {
      if (append) setLoadingMore(true)
      else if (!silent) setLoading(true)
      try {
        const params: Record<string, string | number> = { page: pageNum, limit: PAGE_SIZE }
        if (status !== 'all') params.status = status
        const { data } = await api.get<ListResponse>('/improvements', { params })
        const next = data.improvements ?? []
        setTickets((prev) => (append ? [...prev, ...next] : next))
        if (data.counts) setCounts({ ...EMPTY_COUNTS, ...data.counts })
        setTotal(data.pagination?.total ?? next.length)
        setPage(pageNum)
        setLoadError(false)
        return true
      } catch {
        setLoadError(true)
        showToast('error', 'Could not load improvements. Please try again.')
        return false
      } finally {
        setLoadingMore(false)
        setLoading(false)
      }
    },
    [showToast]
  )

  useEffect(() => {
    load(filter, 1)
  }, [filter, load])

  async function handleLog(values: LogFormValues) {
    const { data } = await api.post<{ improvement: Improvement }>('/improvements', {
      ...values,
      desiredOutcome: values.desiredOutcome || undefined,
      pageUrl: `${location.pathname}${location.search}`,
    })
    setShowForm(false)
    showToast('success', `Logged as #${data.improvement.ticketNumber} — thank you!`)
    // Surface the new ticket: jump to 'all' (effect reloads) or refetch in place.
    if (filter === 'all') await load('all', 1, { silent: true })
    else setFilter('all')
  }

  // Both of these used to finish with `load(filter, 1)`, which replaces the
  // whole list and resets `page` to 1. An owner who had clicked "Load more"
  // three times to reach 200 tickets lost the lot on every single status
  // change, so triaging a backlog meant re-paging after each click. Patching
  // the affected row in place keeps the accumulated list intact.
  const adjustCounts = (from: ImprovementStatus, to: ImprovementStatus | null) =>
    setCounts((prev) => {
      const next = { ...prev, [from]: Math.max(0, (prev[from] ?? 0) - 1) }
      if (to) next[to] = (prev[to] ?? 0) + 1
      else next.all = Math.max(0, prev.all - 1)
      return next
    })

  async function handleStatusChange(id: string, status: ImprovementStatus) {
    const current = tickets.find((ticket) => ticket._id === id)
    if (!current || current.status === status) return
    try {
      await api.patch(`/improvements/${id}/status`, { status })
      const leavesFilter = filter !== 'all' && status !== filter
      setTickets((prev) =>
        leavesFilter
          ? prev.filter((ticket) => ticket._id !== id)
          : prev.map((ticket) => (ticket._id === id ? { ...ticket, status } : ticket))
      )
      adjustCounts(current.status, status)
      if (leavesFilter) setTotal((prev) => Math.max(0, prev - 1))
    } catch {
      showToast('error', 'Could not update the ticket. Please try again.')
    }
  }

  async function handleDelete(id: string) {
    const removed = tickets.find((ticket) => ticket._id === id)
    try {
      await api.delete(`/improvements/${id}`)
      setTickets((prev) => prev.filter((ticket) => ticket._id !== id))
      setTotal((prev) => Math.max(0, prev - 1))
      if (removed) adjustCounts(removed.status, null)
    } catch {
      showToast('error', 'Could not delete the ticket. Please try again.')
    }
  }

  const showSkeleton = loading && tickets.length === 0
  const showLoadError = loadError && tickets.length === 0 && !loading
  const hasMore = tickets.length < total

  return (
    <AppLayout title="Improvements">
      <div className="mx-auto w-full max-w-4xl">
        {/* Screen-reader announced live region (always mounted) */}
        <div aria-live="polite" aria-atomic="true">
          {toast && (
            <div
              role={toast.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'mb-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm',
                toast.type === 'success'
                  ? 'border-guava-green/20 bg-guava-green/10 text-guava-green'
                  : 'border-red-900/30 bg-red-900/10 text-red-400'
              )}
            >
              {toast.type === 'success' ? (
                <CheckCircle className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              {toast.message}
            </div>
          )}
        </div>

        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-sm text-muted">
            Spotted something we could fix or improve? Log it here so the team can pick it up. Be specific —
            the clearer the ticket, the faster it gets actioned.
          </p>
          {!showForm && (
            <Button size="sm" variant="success" onClick={() => setShowForm(true)}>
              <MessageSquarePlus className="h-4 w-4" />
              Log an improvement
            </Button>
          )}
        </div>

        {showForm && <LogForm onSubmit={handleLog} onCancel={() => setShowForm(false)} />}

        {/* Status filters */}
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.value
            const count = counts[f.value] ?? 0
            return (
              <button
                key={f.value}
                aria-pressed={active}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                  active
                    ? 'border-guava-red/30 bg-guava-red/10 font-semibold text-guava-red-text'
                    : 'border-border font-medium text-muted hover:border-[#3A3A3A] hover:text-text'
                )}
              >
                {f.label}
                <span className={cn('tabular-nums', active ? 'text-guava-red-text' : 'text-muted')}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* List */}
        <div aria-busy={loading}>
          {showSkeleton ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-4 pb-4">
                    <Skeleton className="mb-2 h-3 w-24" />
                    <Skeleton className="mb-2 h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : showLoadError ? (
            <div className="flex flex-col items-center justify-center min-h-75 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-red-900/30 bg-red-900/10">
                <AlertCircle className="h-7 w-7 text-red-400" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-text">Couldn't load improvements</h2>
              <p className="mb-6 max-w-xs text-sm text-muted">Something went wrong fetching the board.</p>
              <Button variant="secondary" onClick={() => load(filter, 1)}>
                Try again
              </Button>
            </div>
          ) : tickets.length > 0 ? (
            <>
              <div className="space-y-3">
                {tickets.map((ticket) => (
                  <TicketCard
                    key={ticket._id}
                    ticket={ticket}
                    canManage={isOwner}
                    onStatusChange={handleStatusChange}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <span className="text-xs text-muted">
                    Showing {tickets.length} of {total}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => load(filter, page + 1, { append: true })}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-75 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-surface">
                <Lightbulb className="h-7 w-7 text-muted" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-text">
                {filter === 'all' ? 'No improvements logged yet' : `Nothing ${STATUS_LABELS[filter].toLowerCase()}`}
              </h2>
              <p className="mb-6 max-w-xs text-sm text-muted">
                {filter === 'all'
                  ? 'Be the first to log something we can fix or improve.'
                  : 'Try a different filter, or log a new improvement.'}
              </p>
              {!showForm && (
                <Button variant="success" onClick={() => setShowForm(true)}>
                  <MessageSquarePlus className="h-4 w-4" />
                  Log an improvement
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
