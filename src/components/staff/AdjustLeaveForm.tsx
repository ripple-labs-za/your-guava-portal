import { useState } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StaffMember, LeaveBalanceData, LeaveCycleType } from '@/types'
import { CYCLE_TYPES, requestErrorMessage } from './staffText'

export interface LeaveAdjustment {
  type: LeaveCycleType
  total: number
  reason: string
}

interface AdjustLeaveFormProps {
  staff: StaffMember
  balance: LeaveBalanceData
  /** Resolves with the server's warning when the new total is below the days already taken. */
  onSave: (staffId: string, data: LeaveAdjustment) => Promise<string | undefined>
  onCancel: () => void
}

// D-014: the owner corrects a cycle's entitlement by hand (pro-rata, a
// negotiated extra day). The reason is required because it is the audit record.
export function AdjustLeaveForm({ staff, balance, onSave, onCancel }: AdjustLeaveFormProps) {
  const [type, setType] = useState<LeaveCycleType>('annual')
  const [total, setTotal] = useState(String(balance.annual.total))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // A total below the days already taken is saved, and the owner is told what
  // the balance now shows rather than finding a negative number later.
  const [warning, setWarning] = useState<string | null>(null)
  const fieldId = (field: string) => `leave-adjust-${staff._id}-${field}`

  function chooseType(next: LeaveCycleType) {
    setType(next)
    setTotal(String(balance[next].total))
  }

  async function handleSave() {
    const parsed = Number(total)
    if (!total.trim() || !Number.isFinite(parsed) || parsed < 0 || parsed > 366 || !Number.isInteger(parsed * 2)) {
      setFormError('Enter a total from 0 to 366 days, in whole or half days.')
      return
    }
    if (!reason.trim()) {
      setFormError('Say why the total is changing. The reason is kept with the change.')
      return
    }
    setFormError(null)
    setWarning(null)
    setSubmitting(true)
    try {
      setWarning((await onSave(staff._id, { type, total: parsed, reason: reason.trim() })) ?? null)
    } catch (error: unknown) {
      setFormError(requestErrorMessage(error, 'Could not adjust the leave balance. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={fieldId('type')} className="text-xs text-muted">Leave type to adjust</Label>
          <select
            id={fieldId('type')}
            value={type}
            onChange={(e) => chooseType(e.target.value as LeaveCycleType)}
            className="flex h-9 w-full rounded-lg border border-[#333333] bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
          >
            {CYCLE_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={fieldId('total')} className="text-xs text-muted">New total for this cycle (days)</Label>
          <Input id={fieldId('total')} type="number" min="0" max="366" step="0.5" value={total} onChange={(e) => setTotal(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor={fieldId('reason')} className="text-xs text-muted">Reason for the change</Label>
        <Input id={fieldId('reason')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </div>
      {formError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-900/20 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{formError}</p>
        </div>
      )}
      {warning && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-guava-yellow/25 bg-guava-yellow/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-guava-yellow" />
          <p className="text-xs text-text">Saved. {warning}</p>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>{warning ? 'Close' : 'Cancel'}</Button>
        <Button variant="success" size="sm" onClick={handleSave} disabled={submitting}>
          {submitting ? 'Saving...' : 'Save adjustment'}
        </Button>
      </div>
    </div>
  )
}
