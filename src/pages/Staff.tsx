import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  UserPlus,
  Edit3,
  UserX,
  Phone,
  Mail,
  Calendar,
  DollarSign,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadFailed, loadFailureReason } from '@/components/ui/load-failed'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { toLocalDateOnly } from '@/lib/date'
import type { StaffMember, LeaveBalanceData } from '@/types'
import { AdjustLeaveForm, type LeaveAdjustment } from '@/components/staff/AdjustLeaveForm'
import { LeaveBar } from '@/components/staff/LeaveBar'
import { formatDate, requestErrorMessage } from '@/components/staff/staffText'
import { DEFAULT_WORK_DAYS, NO_WORK_DAYS_MESSAGE, WorkDaysField } from '@/components/staff/WorkDaysField'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  barista: '#D43D3D',
  kitchen: '#E58A3C',
  front: '#4A9ECC',
  manager: '#9B59B6',
  other: '#888888',
}

const ROLE_OPTIONS = ['barista', 'kitchen', 'front', 'manager', 'other'] as const

// The backend's staffDto deletes hourlyRate for anyone who is not an owner, but
// the shared StaffMember type declares it required — so TypeScript never flagged
// the `R{staff.hourlyRate}/hr` that rendered as 'Rundefined/hr' on every card a
// manager saw. Guard at the value, since the type cannot be trusted here.
// (The type itself should become `hourlyRate?: number`; src/types is owned elsewhere.)
function payRate(staff: StaffMember): number | null {
  return typeof staff.hourlyRate === 'number' && Number.isFinite(staff.hourlyRate)
    ? staff.hourlyRate
    : null
}

// A blank or unparseable rate used to collapse to 0 via `Number(x) || 0`, which
// the backend accepts — silently creating a hire at R0/hr, or zeroing an
// existing rate on save.
function parseRate(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const RATE_REQUIRED_MESSAGE =
  'Enter an hourly rate. Leaving it blank would save this staff member at R0 an hour.'


// ── Confirmation ─────────────────────────────────────────────────────────────

interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

/**
 * GET /staff filters to isActive: true, so deactivating removes the person from
 * this page, the roster dropdown, the roster sidebar and the leave form on the
 * very next load — and no reactivate control exists anywhere in the portal.
 * A 28px unlabelled icon beside the edit pencil is not a proportionate control
 * for that.
 */
function ConfirmDialog({ request, onCancel }: { request: ConfirmRequest; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

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
        aria-labelledby="staff-confirm-title"
        aria-describedby="staff-confirm-body"
        className="w-full max-w-md rounded-2xl border border-border bg-[#141414] p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-guava-yellow/25 bg-guava-yellow/10">
            <AlertTriangle className="h-4.5 w-4.5 text-guava-yellow" />
          </div>
          <div className="min-w-0">
            <h2 id="staff-confirm-title" className="text-text text-base font-semibold">
              {request.title}
            </h2>
            <p id="staff-confirm-body" className="mt-2 text-sm leading-6 text-muted">
              {request.body}
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? 'Working...' : request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Add Staff Form ───────────────────────────────────────────────────────────

interface AddStaffFormProps {
  onSubmit: (data: Omit<StaffMember, '_id' | 'isActive'>) => Promise<void>
  onCancel: () => void
}

function AddStaffForm({ onSubmit, onCancel }: AddStaffFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<StaffMember['role']>('barista')
  const [hourlyRate, setHourlyRate] = useState('')
  const [startDate, setStartDate] = useState(toLocalDateOnly(new Date()))
  const [workDays, setWorkDays] = useState<number[]>(DEFAULT_WORK_DAYS)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name) return
    const rate = parseRate(hourlyRate)
    if (rate === null) {
      setFormError(RATE_REQUIRED_MESSAGE)
      return
    }
    if (workDays.length === 0) {
      setFormError(NO_WORK_DAYS_MESSAGE)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        name,
        email: email.trim(),
        phone: phone.trim(),
        role,
        hourlyRate: rate,
        startDate,
        workDays,
      })
    } catch (error: unknown) {
      setFormError(requestErrorMessage(error, 'Could not add the staff member. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Add Staff Member</CardTitle>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="staff-name" className="text-xs text-muted">Name *</Label>
            <Input id="staff-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label htmlFor="staff-email" className="text-xs text-muted">Email</Label>
            <Input id="staff-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <div>
            <Label htmlFor="staff-phone" className="text-xs text-muted">Phone</Label>
            <Input id="staff-phone" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" />
          </div>
          <div>
            <Label htmlFor="staff-role" className="text-xs text-muted">Role</Label>
            <select
              id="staff-role"
              value={role}
              onChange={(e) => setRole(e.target.value as StaffMember['role'])}
              className="flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="staff-rate" className="text-xs text-muted">Hourly Rate (R) *</Label>
            <Input
              id="staff-rate"
              type="number"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="55"
              min="0"
              step="0.5"
              aria-required="true"
            />
          </div>
          <div>
            <Label htmlFor="staff-start-date" className="text-xs text-muted">Start Date</Label>
            <Input id="staff-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <WorkDaysField idPrefix="staff-add" value={workDays} onChange={setWorkDays} />
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
            <Button type="submit" variant="success" disabled={!name || submitting}>
              <UserPlus className="w-4 h-4" />
              {submitting ? 'Adding...' : 'Add Staff'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Inline Edit Form ─────────────────────────────────────────────────────────

interface EditStaffFormProps {
  staff: StaffMember
  onSave: (id: string, data: Partial<StaffMember>) => Promise<void>
  onCancel: () => void
}

function EditStaffForm({ staff, onSave, onCancel }: EditStaffFormProps) {
  const [name, setName] = useState(staff.name)
  const [email, setEmail] = useState(staff.email ?? '')
  const [phone, setPhone] = useState(staff.phone ?? '')
  const [role, setRole] = useState<StaffMember['role']>(staff.role)
  // payRate(), not String(staff.hourlyRate): the backend withholds the rate from
  // managers, which seeded this input with the literal text 'undefined'.
  const [hourlyRate, setHourlyRate] = useState(() => {
    const rate = payRate(staff)
    return rate === null ? '' : String(rate)
  })
  const [startDate, setStartDate] = useState(staff.startDate?.slice(0, 10) ?? '')
  const [workDays, setWorkDays] = useState<number[]>(staff.workDays?.length ? staff.workDays : DEFAULT_WORK_DAYS)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const fieldId = (field: string) => `staff-${staff._id}-${field}`

  async function handleSave() {
    const rate = parseRate(hourlyRate)
    if (rate === null) {
      setFormError(RATE_REQUIRED_MESSAGE)
      return
    }
    if (workDays.length === 0) {
      setFormError(NO_WORK_DAYS_MESSAGE)
      return
    }
    setFormError(null)
    setSubmitting(true)
    try {
      // Explicit empty strings, not undefined: JSON.stringify drops undefined
      // entirely, so the key never reached the server and the backend's
      // `...(email !== undefined && { email })` merge kept the old value. An
      // owner could never remove a departed staff member's personal number.
      await onSave(staff._id, {
        name,
        email: email.trim(),
        phone: phone.trim(),
        role,
        hourlyRate: rate,
        ...(startDate ? { startDate } : {}),
        workDays,
      })
    } catch (error: unknown) {
      setFormError(requestErrorMessage(error, 'Could not save the changes. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={fieldId('name')} className="text-xs text-muted">Edit name</Label>
          <Input id={fieldId('name')} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={fieldId('email')} className="text-xs text-muted">Edit email</Label>
          <Input id={fieldId('email')} type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={fieldId('phone')} className="text-xs text-muted">Edit phone</Label>
          <Input id={fieldId('phone')} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={fieldId('role')} className="text-xs text-muted">Edit role</Label>
          <select
            id={fieldId('role')}
            value={role}
            onChange={(e) => setRole(e.target.value as StaffMember['role'])}
            className="flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={fieldId('rate')} className="text-xs text-muted">Edit hourly rate (R)</Label>
          <Input
            id={fieldId('rate')}
            type="number"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            min="0"
            step="0.5"
            aria-required="true"
          />
        </div>
        <div>
          {/* Start date drives tenure and leave accrual, the add form pre-fills
              today, and PUT /staff/:id has always accepted it — there was simply
              no way to correct a retrospective capture. */}
          <Label htmlFor={fieldId('start-date')} className="text-xs text-muted">Edit start date</Label>
          <Input
            id={fieldId('start-date')}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <WorkDaysField idPrefix={`staff-${staff._id}`} value={workDays} onChange={setWorkDays} />
      </div>
      {formError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-900/20 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{formError}</p>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="success" size="sm" onClick={handleSave} disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ── Staff Card ───────────────────────────────────────────────────────────────

function StaffCard({
  staff,
  balance,
  canManage,
  onEdit,
  onDeactivate,
  onAdjustLeave,
}: {
  staff: StaffMember
  balance?: LeaveBalanceData
  canManage: boolean
  onEdit: (id: string, data: Partial<StaffMember>) => Promise<void>
  onDeactivate: (staff: StaffMember) => void
  onAdjustLeave: (staffId: string, data: LeaveAdjustment) => Promise<string | undefined>
}) {
  const [editing, setEditing] = useState(false)
  const [adjusting, setAdjusting] = useState(false)

  async function handleSave(id: string, data: Partial<StaffMember>) {
    await onEdit(id, data)
    setEditing(false)
  }

  const roleColor = ROLE_COLORS[staff.role] ?? '#888888'
  const rate = payRate(staff)

  return (
    <Card className={cn(!staff.isActive && 'opacity-50')}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-text text-sm font-semibold">{staff.name}</h3>
              <Badge
                variant="secondary"
                className="text-[10px]"
                style={{ color: roleColor, backgroundColor: `${roleColor}18` }}
              >
                {staff.role}
              </Badge>
              {!staff.isActive && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
            </div>
          </div>
          {/* POST/PUT/DELETE /staff are all ownerOnly. Showing a manager these
              controls meant every click produced a 403 that was thrown away. */}
          <div className="flex items-center gap-1 shrink-0">
            {canManage && staff.isActive && (
              <>
                <Button
                  aria-label={`Edit ${staff.name}`}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditing(!editing)}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  aria-label={`Deactivate ${staff.name}`}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-guava-red-text hover:text-guava-red-text"
                  onClick={() => onDeactivate(staff)}
                >
                  <UserX className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
          {staff.phone && (
            <div className="flex items-center gap-1.5 text-muted">
              <Phone className="w-3 h-3" />
              <span>{staff.phone}</span>
            </div>
          )}
          {staff.email && (
            <div className="flex items-center gap-1.5 text-muted">
              <Mail className="w-3 h-3" />
              <span className="truncate">{staff.email}</span>
            </div>
          )}
          {rate !== null && (
            <div className="flex items-center gap-1.5 text-muted">
              <DollarSign className="w-3 h-3" />
              <span>R{rate}/hr</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted">
            <Calendar className="w-3 h-3" />
            <span>{formatDate(staff.startDate)}</span>
          </div>
        </div>

        {/* Leave Balances */}
        {balance && (
          <>
            <Separator className="mb-3" />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted uppercase tracking-wider font-medium">Leave Balances</p>
                {canManage && (
                  <Button
                    aria-label={`Adjust leave for ${staff.name}`}
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setAdjusting(!adjusting)}
                  >
                    Adjust
                  </Button>
                )}
              </div>
              <LeaveBar label="Annual" used={balance.annual.used} total={balance.annual.total} color="#4DA63B" cycleEnd={balance.annual.cycleEnd} />
              <LeaveBar label="Sick" used={balance.sick.used} total={balance.sick.total} color="#4A9ECC" cycleEnd={balance.sick.cycleEnd} />
              <LeaveBar label="Family" used={balance.family.used} total={balance.family.total} color="#FFD166" cycleEnd={balance.family.cycleEnd} />
            </div>
            {adjusting && (
              <AdjustLeaveForm
                staff={staff}
                balance={balance}
                onSave={async (id, data) => {
                  const warning = await onAdjustLeave(id, data)
                  if (!warning) setAdjusting(false) // a warning keeps the form open to be read
                  return warning
                }}
                onCancel={() => setAdjusting(false)}
              />
            )}
          </>
        )}

        {/* Edit Form */}
        {editing && (
          <EditStaffForm staff={staff} onSave={handleSave} onCancel={() => setEditing(false)} />
        )}
      </CardContent>
    </Card>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Staff() {
  const { isOwner } = useAuth()
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [balances, setBalances] = useState<LeaveBalanceData[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  // A 500, a 403 or a dropped connection all used to render as the onboarding
  // empty state, telling an owner with twelve staff that they have none.
  const [staffFailure, setStaffFailure] = useState<string | null>(null)
  const [balancesFailure, setBalancesFailure] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)

  // `quiet` refreshes in place: the skeleton would unmount the cards, and with
  // them an open form that still has something to say (the adjust warning).
  const loadData = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const [staffResult, balancesResult] = await Promise.allSettled([
        api.get<{ staff: StaffMember[] }>('/staff'),
        api.get<{ balances: LeaveBalanceData[] }>('/leave/balances'),
      ])
      setStaffFailure(staffResult.status === 'rejected' ? loadFailureReason(staffResult.reason) : null)
      setStaffList(staffResult.status === 'fulfilled' ? staffResult.value.data?.staff ?? [] : [])
      setBalancesFailure(balancesResult.status === 'rejected' ? loadFailureReason(balancesResult.reason) : null)
      setBalances(balancesResult.status === 'fulfilled' ? balancesResult.value.data?.balances ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const balanceMap = new Map<string, LeaveBalanceData>()
  balances.forEach((balance) => {
    const staffId = typeof balance.staffId === 'string' ? balance.staffId : balance.staffId._id
    balanceMap.set(staffId, balance)
  })

  // handleAdd and handleEdit deliberately let their rejection through: the form
  // that made the call owns the inline message, and catching here would hide it.
  async function handleAdd(data: Omit<StaffMember, '_id' | 'isActive'>) {
    await api.post('/staff', data)
    setShowAddForm(false)
    await loadData()
  }

  async function handleEdit(id: string, data: Partial<StaffMember>) {
    await api.put(`/staff/${id}`, data)
    await loadData()
  }

  async function handleAdjustLeave(staffId: string, data: LeaveAdjustment) {
    const res = await api.put<{ warning?: string }>(`/leave/balances/${staffId}`, data)
    await loadData({ quiet: true })
    return res?.data?.warning
  }

  function askToDeactivate(staff: StaffMember) {
    setActionError(null)
    setConfirmRequest({
      title: `Deactivate ${staff.name}?`,
      body: `${staff.name} will be removed from this page, from the roster and its staff list, and from the leave request form. Their scheduled shifts that have not started yet are cancelled and their pending leave requests are withdrawn. Past shifts and approved leave are kept, but the portal has no way to bring them back — that needs a support request.`,
      confirmLabel: 'Deactivate',
      onConfirm: async () => {
        try {
          await api.put(`/staff/${staff._id}`, { isActive: false })
          setConfirmRequest(null)
          await loadData()
        } catch (error: unknown) {
          setConfirmRequest(null)
          setActionError(requestErrorMessage(error, `Could not deactivate ${staff.name}.`))
        }
      },
    })
  }

  return (
    <AppLayout title="Staff">
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

      {isOwner && !showAddForm && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" variant="success" onClick={() => setShowAddForm(true)}>
            <UserPlus className="w-4 h-4" />
            Add Staff
          </Button>
        </div>
      )}

      {/* Add Staff Form */}
      {isOwner && showAddForm && (
        <AddStaffForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />
      )}

      {!loading && !staffFailure && balancesFailure && (
        <div className="mb-4 rounded-lg border border-red-900/40 bg-red-900/20 px-3.5">
          <LoadFailed compact what="leave balances" reason={balancesFailure} reassurance="Staff are shown without their leave days until they load." onRetry={() => loadData()} />
        </div>
      )}

      {/* Staff Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-5 pb-5">
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-3 w-24 mb-2" />
                <Skeleton className="h-3 w-28 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : staffFailure ? (
        <LoadFailed what="staff" reason={staffFailure} reassurance="Nobody has been removed; this page just could not fetch your team." onRetry={() => loadData()} />
      ) : staffList.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {staffList.map((staff) => (
            <StaffCard
              key={staff._id}
              staff={staff}
              balance={balanceMap.get(staff._id)}
              canManage={isOwner}
              onEdit={handleEdit}
              onDeactivate={askToDeactivate}
              onAdjustLeave={handleAdjustLeave}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-75 text-center">
          <div className="w-14 h-14 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
            <UserPlus className="w-7 h-7 text-muted" />
          </div>
          <h2 className="text-text text-lg font-semibold mb-2">No staff yet</h2>
          {isOwner ? (
            <>
              <p className="text-muted text-sm mb-6 max-w-xs">Add your first staff member to get started with scheduling.</p>
              <Button variant="success" onClick={() => setShowAddForm(true)}>
                <UserPlus className="w-4 h-4" />
                Add Staff
              </Button>
            </>
          ) : (
            <p className="text-muted text-sm max-w-xs">
              Nobody has been added to this cafe yet. Ask the account owner to add your team.
            </p>
          )}
        </div>
      )}
    </AppLayout>
  )
}
