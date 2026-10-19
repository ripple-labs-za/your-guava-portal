import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CalendarOff,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadFailed, loadFailureReason } from '@/components/ui/load-failed'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { getLocalMonthBounds, parseDateOnly, toLocalDateOnly } from '@/lib/date'
import type { LeaveRequest, StaffMember, LeaveCalendarDay } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
}

const LEAVE_TYPE_COLORS: Record<string, string> = {
  annual: '#4DA63B',
  sick: '#4A9ECC',
  family: '#FFD166',
  unpaid: '#888888',
}

const LEAVE_TYPES = ['annual', 'sick', 'family', 'unpaid'] as const

// How many names fit in a calendar cell before the rest have to be summarised.
const CALENDAR_CELL_ENTRIES = 2

function getStaffName(staffId: LeaveRequest['staffId']): string {
  if (typeof staffId === 'object' && staffId !== null) return staffId.name
  return staffId
}

function formatDate(dateStr: string) {
  return parseDateOnly(dateStr).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

// The approve/reject controls are icon-only and repeat once per row, so the
// accessible name has to carry the row context a sighted user reads across the
// table. "Approve" on its own tells a screen-reader user nothing about which
// request they are about to action.
function leaveActionLabel(action: 'Approve' | 'Reject' | 'Cancel approved', req: LeaveRequest): string {
  return `${action} leave for ${getStaffName(req.staffId)}, ${formatDate(req.startDate)} to ${formatDate(req.endDate)}`
}

function pluraliseDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

function workPattern(staff?: StaffMember): number[] {
  return staff?.workDays?.length ? staff.workDays : DEFAULT_WORK_DAYS
}

function describePattern(days: number[]): string {
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => DAY_LABELS[d]).join(', ')
}

// The backend charges the person's working days (Staff.workDays) and leaves out
// South African public holidays. The preview knows the pattern but not the
// holidays, so it is an upper bound and says so.
function countWorkingDays(startDate: string, endDate: string, workDays: number[]): number {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  let count = 0
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (workDays.includes(cursor.getDay())) count += 1
  }
  return count
}

function requestErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

// ── Confirmation ─────────────────────────────────────────────────────────────

interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  dismissLabel?: string
  destructive: boolean
  onConfirm: () => Promise<void>
}

/**
 * Approving leave spends the balance straight away, and the owner can cancel an
 * approved request afterwards, which returns the days. A 28px icon button 4px
 * from its opposite is still not a proportionate control for spending someone's
 * leave, so the action is spelled out — who, what and how much — before it is
 * taken.
 */
function ConfirmDialog({ request, onCancel }: { request: ConfirmRequest; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus the safe choice, never the destructive one: landing focus on Approve
  // is how a stray Enter spends someone's leave.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onCancel])

  async function confirm() {
    setBusy(true)
    try {
      await request.onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        aria-describedby="leave-confirm-body"
        className="w-full max-w-md rounded-2xl border border-border bg-[#141414] p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-guava-yellow/25 bg-guava-yellow/10">
            <AlertTriangle className="h-4.5 w-4.5 text-guava-yellow" />
          </div>
          <div className="min-w-0">
            <h2 id="leave-confirm-title" className="text-text text-base font-semibold">
              {request.title}
            </h2>
            <p id="leave-confirm-body" className="mt-2 text-sm leading-6 text-muted">
              {request.body}
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>
            {request.dismissLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={request.destructive ? 'destructive' : 'success'}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? 'Working...' : request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Submit Leave Form ────────────────────────────────────────────────────────

interface SubmitLeaveFormProps {
  staffList: StaffMember[]
  onSubmit: (data: { staffId: string; type: string; startDate: string; endDate: string; reason: string }) => Promise<void>
  onCancel: () => void
}

function SubmitLeaveForm({ staffList, onSubmit, onCancel }: SubmitLeaveFormProps) {
  const [staffId, setStaffId] = useState('')
  const [type, setType] = useState<string>('annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const selected = staffList.find((s) => s._id === staffId)
  const pattern = workPattern(selected)
  const personName = selected?.name ?? 'this person'
  const workingDays = startDate && endDate ? countWorkingDays(startDate, endDate, pattern) : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!staffId || !startDate || !endDate) return
    // Reversing the two dates is an ordinary date-picker slip. The backend
    // rejects it with a 400 the form used to discard, so pressing Submit simply
    // did nothing.
    if (endDate < startDate) {
      setFormError('The end date is before the start date. Pick an end date on or after the start date.')
      return
    }
    if (workingDays === 0) {
      setFormError(`That period has none of ${personName}'s working days (${describePattern(pattern)}). Pick dates ${personName} normally works.`)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await onSubmit({ staffId, type, startDate, endDate, reason })
    } catch (error: unknown) {
      setFormError(requestErrorMessage(error, 'Could not submit the leave request. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Submit Leave Request</CardTitle>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="leave-staff" className="text-xs text-muted">Staff *</Label>
            <select
              id="leave-staff"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
            >
              <option value="">Select staff</option>
              {staffList.filter((s) => s.isActive).map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="leave-type" className="text-xs text-muted">Leave Type</Label>
            <select
              id="leave-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="leave-start-date" className="text-xs text-muted">Start Date *</Label>
            <Input id="leave-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="leave-end-date" className="text-xs text-muted">End Date *</Label>
            <Input
              id="leave-end-date"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="leave-reason" className="text-xs text-muted">Reason (optional)</Label>
            <Input id="leave-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for leave..." />
          </div>
          {/* The day count was previously only revealed after the request was
              created, so an owner could not tell whether it would fit inside the
              remaining balance until it was too late to change it. */}
          {workingDays !== null && workingDays > 0 && (
            <div className="sm:col-span-2 lg:col-span-3 -mt-1">
              <p className="text-xs text-muted">
                This request counts as{' '}
                <span className="text-text font-medium">{workingDays} working {workingDays === 1 ? 'day' : 'days'}</span> for {personName}.
                Public holidays are not charged, so the recorded count can be lower.
              </p>
            </div>
          )}
          {formError && (
            <div
              role="alert"
              className="sm:col-span-2 lg:col-span-3 flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-900/20 px-3 py-2"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              <p className="text-xs text-red-400">{formError}</p>
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <Button type="submit" variant="success" disabled={!staffId || !startDate || !endDate || submitting}>
              <Plus className="w-4 h-4" />
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Calendar View ────────────────────────────────────────────────────────────

function LeaveCalendar() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date())
  const [calendarDays, setCalendarDays] = useState<LeaveCalendarDay[]>([])
  const [calendarFailure, setCalendarFailure] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [loading, setLoading] = useState(true)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  // Without a per-run controller, clicking the month chevrons faster than the
  // API answers commits whichever response resolves last -- so the grid can show
  // one month's header over a different month's entries, with nothing to say so.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const { startDate, endDate } = getLocalMonthBounds(new Date(year, month, 1, 12))
    api
      .get<{ calendar: LeaveCalendarDay[] }>(
        `/leave/calendar?startDate=${startDate}&endDate=${endDate}`,
        { signal: controller.signal }
      )
      .then(({ data }) => {
        if (!controller.signal.aborted) {
          setCalendarDays(data.calendar || [])
          setCalendarFailure(null)
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCalendarDays([])
          setCalendarFailure(loadFailureReason(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [year, month, reloadToken])

  const calendarMap = useMemo(() => {
    const map = new Map<string, LeaveCalendarDay>()
    calendarDays.forEach((d) => map.set(d.date, d))
    return map
  }, [calendarDays])

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1 // Mon=0
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7

  function prevMonth() {
    setCurrentMonth(new Date(year, month - 1, 1))
  }
  function nextMonth() {
    setCurrentMonth(new Date(year, month + 1, 1))
  }

  const monthLabel = currentMonth.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Leave Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button aria-label="Previous month" variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-text text-xs font-medium min-w-30 text-center">{monthLabel}</span>
            <Button aria-label="Next month" variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-75 rounded-lg" />
        ) : calendarFailure ? (
          <LoadFailed compact what="the leave calendar" reason={calendarFailure} reassurance="Booked leave is unchanged." onRetry={() => setReloadToken((token) => token + 1)} />
        ) : (
          <>
            {/* Header */}
            <div className="grid grid-cols-7 mb-1">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="text-center text-[10px] text-muted py-1">
                  {d}
                </div>
              ))}
            </div>
            {/* Days */}
            <div className="grid grid-cols-7">
              {Array.from({ length: totalCells }).map((_, idx) => {
                const dayNum = idx - startOffset + 1
                const isValid = dayNum >= 1 && dayNum <= daysInMonth
                if (!isValid) {
                  return <div key={idx} className="h-16 border border-surface" />
                }
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
                const calDay = calendarMap.get(dateStr)
                const isToday = dateStr === toLocalDateOnly(new Date())

                return (
                  <div
                    key={idx}
                    className={cn(
                      'h-16 border border-[#1F1F1F] p-1 overflow-hidden',
                      isToday && 'bg-guava-red/5 border-guava-red/20'
                    )}
                  >
                    <p className={cn('text-[10px] mb-0.5', isToday ? 'text-guava-red-text font-bold' : 'text-muted')}>
                      {dayNum}
                    </p>
                    {/* The cell is a fixed height with overflow-hidden, so the
                        busiest day -- the one worth noticing -- used to look the
                        calmest. Show what fits and account for the rest. */}
                    {calDay?.staff.slice(0, CALENDAR_CELL_ENTRIES).map((s, i) => (
                      <div
                        key={i}
                        className="text-[8px] rounded px-0.5 py-px mb-px truncate"
                        style={{
                          backgroundColor: `${LEAVE_TYPE_COLORS[s.type] ?? '#888888'}20`,
                          color: LEAVE_TYPE_COLORS[s.type] ?? '#888888',
                        }}
                      >
                        {s.name}
                      </div>
                    ))}
                    {calDay && calDay.staff.length > CALENDAR_CELL_ENTRIES && (
                      <p
                        className="text-[8px] font-medium text-guava-yellow px-0.5"
                        title={calDay.staff
                          .slice(CALENDAR_CELL_ENTRIES)
                          .map((s) => `${s.name} (${s.type})`)
                          .join(', ')}
                      >
                        +{calDay.staff.length - CALENDAR_CELL_ENTRIES} more
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-3">
              {LEAVE_TYPES.map((t) => (
                <div key={t} className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: LEAVE_TYPE_COLORS[t] }} />
                  <span className="text-[10px] text-muted capitalize">{t}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Leave() {
  const { isOwner } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [filter, setFilter] = useState<FilterTab>('all')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  // A rejected request used to be indistinguishable from a genuinely empty one:
  // the page told the owner "No leave requests" when the server was unreachable.
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [staffFailure, setStaffFailure] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const statusParam = filter === 'all' ? '' : `?status=${filter}`
      const [leaveResult, staffResult] = await Promise.allSettled([
        api.get<{ requests: LeaveRequest[] }>(`/leave${statusParam}`),
        api.get<{ staff: StaffMember[] }>('/staff'),
      ])
      setListFailure(leaveResult.status === 'rejected' ? loadFailureReason(leaveResult.reason) : null)
      setRequests(leaveResult.status === 'fulfilled' ? leaveResult.value.data?.requests ?? [] : [])
      setStaffFailure(staffResult.status === 'rejected' ? loadFailureReason(staffResult.reason) : null)
      setStaffList(staffResult.status === 'fulfilled' ? staffResult.value.data?.staff ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function handleSubmit(data: { staffId: string; type: string; startDate: string; endDate: string; reason: string }) {
    // Deliberately unguarded: SubmitLeaveForm owns the inline error for its own
    // submission, and swallowing the rejection here would hide it.
    await api.post('/leave', data)
    setShowForm(false)
    await loadData()
  }

  function askToApprove(req: LeaveRequest) {
    const staffName = getStaffName(req.staffId)
    const spendsBalance = req.type !== 'unpaid'
    setActionError(null)
    setConfirmRequest({
      title: `Approve ${pluraliseDays(req.days)} of ${req.type} leave for ${staffName}?`,
      body: spendsBalance
        ? `${staffName} will be booked off from ${formatDate(req.startDate)} to ${formatDate(req.endDate)}, and ${pluraliseDays(req.days)} will be taken off their ${req.type} leave balance for this leave cycle straight away. If this was a mistake, you can cancel the approved leave later and the days go back.`
        : `${staffName} will be booked off from ${formatDate(req.startDate)} to ${formatDate(req.endDate)}. Unpaid leave is not deducted from an entitlement, and you can cancel it later if plans change.`,
      confirmLabel: `Approve ${pluraliseDays(req.days)}`,
      destructive: false,
      onConfirm: () => runAction(() => api.put(`/leave/${req._id}/approve`), 'Could not approve the request.'),
    })
  }

  function askToReject(req: LeaveRequest) {
    const staffName = getStaffName(req.staffId)
    setActionError(null)
    setConfirmRequest({
      title: `Reject ${staffName}'s ${req.type} leave request?`,
      body: `${staffName} will not be booked off for ${formatDate(req.startDate)} to ${formatDate(req.endDate)}. This cannot be undone — ${staffName} would have to submit a new request.`,
      confirmLabel: 'Reject request',
      destructive: true,
      onConfirm: () => runAction(() => api.put(`/leave/${req._id}/reject`), 'Could not reject the request.'),
    })
  }

  function askToCancel(req: LeaveRequest) {
    const staffName = getStaffName(req.staffId)
    const returnsDays = req.type !== 'unpaid'
    setActionError(null)
    setConfirmRequest({
      title: `Cancel ${staffName}'s approved ${req.type} leave?`,
      body: returnsDays
        ? `${staffName} will no longer be booked off from ${formatDate(req.startDate)} to ${formatDate(req.endDate)}, and ${pluraliseDays(req.days)} go back to their ${req.type} leave balance.`
        : `${staffName} will no longer be booked off from ${formatDate(req.startDate)} to ${formatDate(req.endDate)}.`,
      confirmLabel: 'Cancel the leave',
      dismissLabel: 'Keep it',
      destructive: true,
      onConfirm: () => runAction(() => api.put(`/leave/${req._id}/cancel`, {}), 'Could not cancel the leave.'),
    })
  }

  // Every one of these rejections used to become an unhandled promise rejection:
  // the row stayed 'pending', loadData never ran, and the owner had no way to
  // tell whether the decision had landed.
  async function runAction(call: () => Promise<unknown>, fallback: string) {
    try {
      await call()
      setConfirmRequest(null)
      await loadData()
    } catch (error: unknown) {
      setConfirmRequest(null)
      setActionError(requestErrorMessage(error, fallback))
    }
  }

  const FILTER_TABS: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'cancelled', label: 'Cancelled' },
  ]

  return (
    <AppLayout title="Leave">
      {confirmRequest && (
        <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
      )}

      {actionError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-900/40 bg-red-900/20 px-3.5 py-3"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{actionError}</p>
        </div>
      )}

      {!showForm && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" variant="success" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" />
            Request Leave
          </Button>
        </div>
      )}

      {/* Submit Leave Form */}
      {showForm && (staffFailure ? (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <LoadFailed compact what="staff" reason={staffFailure} reassurance="A leave request needs the staff list, so none can be made until it loads." onRetry={loadData} />
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <SubmitLeaveForm staffList={staffList} onSubmit={handleSubmit} onCancel={() => setShowForm(false)} />
      ))}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
        {/* Leave Requests */}
        <div>
          {/* Filter Tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-border pb-px overflow-x-auto">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium transition-colors relative',
                  filter === tab.id
                    ? 'text-guava-red-text'
                    : 'text-muted hover:text-text'
                )}
              >
                {tab.label}
                {filter === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-guava-red rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Requests Table */}
          <Card>
            <CardContent className="pt-5">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : listFailure ? (
                <LoadFailed what="leave requests" reason={listFailure} reassurance="Your requests are safe; this page just could not fetch them." onRetry={loadData} />
              ) : requests.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 text-muted font-medium">Staff</th>
                        <th className="text-left py-2 px-4 text-muted font-medium">Type</th>
                        <th className="text-left py-2 px-4 text-muted font-medium">Dates</th>
                        <th className="text-right py-2 px-4 text-muted font-medium">Days</th>
                        <th className="text-center py-2 px-4 text-muted font-medium">Status</th>
                        {isOwner && <th className="text-right py-2 pl-4 text-muted font-medium">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((req) => (
                        <tr key={req._id} className="border-b border-[#1F1F1F] last:border-0">
                          <td className="py-2.5 pr-4 text-text">{getStaffName(req.staffId)}</td>
                          <td className="py-2.5 px-4">
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
                              style={{
                                color: LEAVE_TYPE_COLORS[req.type] ?? '#888888',
                                backgroundColor: `${LEAVE_TYPE_COLORS[req.type] ?? '#888888'}18`,
                              }}
                            >
                              {req.type}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-4 text-muted text-xs">
                            {formatDate(req.startDate)} — {formatDate(req.endDate)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-text tabular-nums">{req.days}</td>
                          <td className="py-2.5 px-4 text-center">
                            <Badge variant={STATUS_VARIANT[req.status] ?? 'secondary'} className="text-[10px]">
                              {req.status}
                            </Badge>
                          </td>
                          {isOwner && (
                            <td className="py-2.5 pl-4 text-right">
                              {req.status === 'pending' && (
                                <div className="flex items-center gap-1 justify-end">
                                  <Button
                                    aria-label={leaveActionLabel('Approve', req)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-guava-green hover:text-guava-green hover:bg-guava-green/10"
                                    onClick={() => askToApprove(req)}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    aria-label={leaveActionLabel('Reject', req)}
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-guava-red-text hover:text-guava-red-text hover:bg-guava-red/10"
                                    onClick={() => askToReject(req)}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                              {req.status === 'approved' && (
                                <Button
                                  aria-label={leaveActionLabel('Cancel approved', req)}
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-muted hover:text-text"
                                  onClick={() => askToCancel(req)}
                                >
                                  Cancel
                                </Button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CalendarOff className="w-8 h-8 text-muted mb-3" />
                  <p className="text-muted text-sm">No leave requests</p>
                  <p className="text-muted text-xs mt-1">
                    {filter !== 'all' ? 'Try changing the filter' : 'Submit a leave request to get started'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Calendar */}
        <div>
          <LeaveCalendar />
        </div>
      </div>
    </AppLayout>
  )
}
