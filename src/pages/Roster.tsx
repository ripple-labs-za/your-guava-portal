import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  AlertTriangle,
  X,
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
import { toLocalDateOnly } from '@/lib/date'
import { requestErrorMessage } from '@/components/staff/staffText'
import type { Shift, StaffMember, ShiftSummary } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(12, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDateISO(date: Date): string {
  return toLocalDateOnly(date)
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

function getStaffName(staffId: Shift['staffId']): string {
  if (typeof staffId === 'object' && staffId !== null) return staffId.name
  return staffId
}

const ROLE_COLORS: Record<string, string> = {
  barista: '#D43D3D',
  kitchen: '#E58A3C',
  front: '#4A9ECC',
  manager: '#9B59B6',
  other: '#888888',
}

// ── Add Shift Form ───────────────────────────────────────────────────────────

interface AddShiftFormProps {
  date: string
  staffList: StaffMember[]
  onSubmit: (data: { staffId: string; date: string; startTime: string; endTime: string; notes: string }) => Promise<void>
  onCancel: () => void
}

function AddShiftForm({ date, staffList, onSubmit, onCancel }: AddShiftFormProps) {
  const [staffId, setStaffId] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('16:00')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!staffId) return
    setFormError(null)
    setSubmitting(true)
    try {
      await onSubmit({ staffId, date, startTime, endTime, notes })
    } catch (error: unknown) {
      // D-009: the server words the refusal (overlap, approved leave, times);
      // show it verbatim and keep what the manager typed.
      setFormError(requestErrorMessage(error, 'Could not add the shift. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#111111] border border-border rounded-lg p-3 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-text text-xs font-medium">Add Shift</p>
        <button
          type="button"
          aria-label="Close the Add Shift form"
          onClick={onCancel}
          className="text-muted hover:text-text"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div>
        <Label htmlFor={`shift-staff-${date}`} className="text-xs text-muted">Staff</Label>
        <select
          id={`shift-staff-${date}`}
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`shift-start-${date}`} className="text-xs text-muted">Start</Label>
          <Input id={`shift-start-${date}`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`shift-end-${date}`} className="text-xs text-muted">End</Label>
          <Input id={`shift-end-${date}`} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor={`shift-notes-${date}`} className="text-xs text-muted">Notes (optional)</Label>
        <Input id={`shift-notes-${date}`} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes..." />
      </div>
      {formError && (
        <p role="alert" className="text-[10px] leading-4 text-red-400">
          {formError}
        </p>
      )}
      <Button type="submit" size="sm" variant="success" className="w-full" disabled={!staffId || submitting}>
        {submitting ? 'Adding...' : 'Add Shift'}
      </Button>
    </form>
  )
}

// ── Shift Card ───────────────────────────────────────────────────────────────

function ShiftCard({ shift }: { shift: Shift }) {
  return (
    <div className="bg-[#111111] border border-border rounded-lg p-2.5 mb-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-text text-xs font-medium truncate">{getStaffName(shift.staffId)}</span>
        <Badge
          variant={shift.type === 'overtime' ? 'warning' : 'secondary'}
          className="text-[9px] px-1.5 py-0"
        >
          {shift.type}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 text-muted">
        <Clock className="w-3 h-3" />
        <span className="text-[10px]">
          {shift.startTime} — {shift.endTime}{shift.endsNextDay ? ' (next day)' : ''}
        </span>
        <span className="text-[10px] text-muted ml-auto">{shift.hoursWorked}h</span>
      </div>
      {shift.notes && (
        <p className="text-[10px] text-muted mt-1 truncate">{shift.notes}</p>
      )}
    </div>
  )
}

// ── Staff Sidebar ────────────────────────────────────────────────────────────

function StaffSidebar({
  staffList,
  summaries,
  loading,
  failure,
  onRetry,
}: {
  staffList: StaffMember[]
  summaries: ShiftSummary[]
  loading: boolean
  failure: string | null
  onRetry: () => void
}) {
  const summaryMap = useMemo(() => {
    const map = new Map<string, ShiftSummary>()
    summaries.forEach((s) => map.set(s.staffId, s))
    return map
  }, [summaries])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Staff</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : failure ? (
          <LoadFailed compact what="staff and hours" reason={failure} reassurance="Shifts are unchanged." onRetry={onRetry} />
        ) : staffList.length > 0 ? (
          <div className="space-y-2">
            {staffList.filter((s) => s.isActive).map((staff) => {
              const summary = summaryMap.get(staff._id)
              const totalHours = summary?.totalHours ?? 0
              // The server owns the BCEA rule (45 h per calendar week); 45 is only the fallback.
              const isOvertime = summary?.overThreshold ?? totalHours > 45
              return (
                <div
                  key={staff._id}
                  className="flex items-center justify-between py-1.5 border-b border-[#1F1F1F] last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text text-xs font-medium truncate">{staff.name}</span>
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1.5 py-0 shrink-0"
                      style={{
                        color: ROLE_COLORS[staff.role] ?? '#888888',
                        backgroundColor: `${ROLE_COLORS[staff.role] ?? '#888888'}18`,
                      }}
                    >
                      {staff.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn('text-xs tabular-nums', isOvertime ? 'text-guava-red-text font-bold' : 'text-muted')}>
                      {totalHours.toFixed(1)}h
                    </span>
                    {isOvertime && (
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                        OT
                      </Badge>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-muted text-xs text-center py-4">No staff found</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Roster() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [shifts, setShifts] = useState<Shift[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [summaries, setSummaries] = useState<ShiftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [addingDay, setAddingDay] = useState<string | null>(null)
  const [shiftsFailure, setShiftsFailure] = useState<string | null>(null)
  const [sidebarFailure, setSidebarFailure] = useState<string | null>(null)

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart])

  const loadData = useCallback(async () => {
    setLoading(true)
    const startDate = formatDateISO(weekStart)
    const endDate = formatDateISO(weekEnd)
    try {
      const [shiftsResult, staffResult, summaryResult] = await Promise.allSettled([
        api.get<{ shifts: Shift[] }>(`/shifts?startDate=${startDate}&endDate=${endDate}`),
        api.get<{ staff: StaffMember[] }>('/staff'),
        api.get<{ summary: ShiftSummary[]; summaries?: ShiftSummary[] }>(
          `/shifts/summary?startDate=${startDate}&endDate=${endDate}`
        ),
      ])
      setShiftsFailure(shiftsResult.status === 'rejected' ? loadFailureReason(shiftsResult.reason) : null)
      setShifts(shiftsResult.status === 'fulfilled' ? shiftsResult.value.data?.shifts ?? [] : [])
      const isRejected = (result: PromiseSettledResult<unknown>): result is PromiseRejectedResult => result.status === 'rejected'
      const sidebarRejection = [staffResult, summaryResult].find(isRejected)
      setSidebarFailure(sidebarRejection ? loadFailureReason(sidebarRejection.reason) : null)
      setStaffList(staffResult.status === 'fulfilled' ? staffResult.value.data?.staff ?? [] : [])
      const summary = summaryResult.status === 'fulfilled' ? summaryResult.value.data : undefined
      setSummaries(summary?.summary ?? summary?.summaries ?? [])
    } finally {
      setLoading(false)
    }
  }, [weekStart, weekEnd])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Group shifts by date
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>()
    shifts.forEach((s) => {
      const key = s.date.split('T')[0]
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    })
    return map
  }, [shifts])

  async function handleAddShift(data: { staffId: string; date: string; startTime: string; endTime: string; notes: string }) {
    await api.post('/shifts', data)
    setAddingDay(null)
    await loadData()
  }

  function goThisWeek() {
    setWeekStart(getWeekStart(new Date()))
  }

  return (
    <AppLayout title="Roster">
      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Button aria-label="Previous week" variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-text text-sm font-medium">
            {formatDateShort(weekStart)} — {formatDateShort(weekEnd)}
          </span>
          <Button aria-label="Next week" variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={goThisWeek}>
          This Week
        </Button>
      </div>

      {!loading && shiftsFailure ? (
        <LoadFailed what="this week's shifts" reason={shiftsFailure} reassurance="No shift has been changed." onRetry={loadData} />
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6">
        {/* Weekly Grid */}
        <div className="grid grid-cols-7 gap-2">
          {DAYS.map((dayLabel, idx) => {
            const dayDate = addDays(weekStart, idx)
            const dateStr = formatDateISO(dayDate)
            const dayShifts = shiftsByDate.get(dateStr) ?? []
            const isToday = formatDateISO(new Date()) === dateStr

            return (
              <div key={dayLabel} className="min-w-0">
                {/* Day Header */}
                <div
                  className={cn(
                    'text-center py-2 rounded-t-lg border-b',
                    isToday
                      ? 'bg-guava-red/10 border-guava-red/30'
                      : 'bg-surface border-border'
                  )}
                >
                  <p className={cn('text-xs font-bold', isToday ? 'text-guava-red-text' : 'text-text')}>
                    {dayLabel}
                  </p>
                  <p className="text-[10px] text-muted">{formatDateShort(dayDate)}</p>
                </div>

                {/* Shifts */}
                <div className="bg-surface border border-t-0 border-border rounded-b-lg p-1.5 min-h-30">
                  {loading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 rounded-lg" />
                      <Skeleton className="h-12 rounded-lg" />
                    </div>
                  ) : (
                    <>
                      {dayShifts.map((shift) => (
                        <ShiftCard key={shift._id} shift={shift} />
                      ))}
                      {dayShifts.length === 0 && (
                        <p className="text-[10px] text-muted text-center py-4">No shifts</p>
                      )}

                      {/* Add Shift */}
                      {addingDay === dateStr ? (
                        <AddShiftForm
                          date={dateStr}
                          staffList={staffList}
                          onSubmit={handleAddShift}
                          onCancel={() => setAddingDay(null)}
                        />
                      ) : (
                        <button
                          aria-label={`Add Shift on ${dayLabel} ${formatDateShort(dayDate)}`}
                          onClick={() => setAddingDay(dateStr)}
                          className="w-full flex items-center justify-center gap-1 text-[10px] text-muted hover:text-guava-green py-1.5 mt-1 rounded border border-dashed border-border hover:border-guava-green/30 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                          Add Shift
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Staff Sidebar */}
        <div>
          <StaffSidebar staffList={staffList} summaries={summaries} loading={loading} failure={sidebarFailure} onRetry={loadData} />
        </div>
      </div>
      )}
    </AppLayout>
  )
}
