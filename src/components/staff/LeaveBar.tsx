import { cn } from '@/lib/utils'
import { formatDate } from './staffText'

export function LeaveBar({
  label,
  used,
  total,
  color,
  cycleEnd,
}: {
  label: string
  used: number
  total: number
  color: string
  cycleEnd?: string
}) {
  // Not clamped: over-taken leave is a payroll liability, and clamping rendered
  // it identically to a staff member who had used exactly their allowance.
  const remaining = total - used
  const pct = total > 0 ? (Math.max(0, remaining) / total) * 100 : 0
  const overdrawn = remaining < 0

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted">
          {label}
          {cycleEnd && <span className="ml-1.5 text-[10px] text-muted">cycle ends {formatDate(cycleEnd)}</span>}
        </span>
        <span
          className={cn(
            'text-[10px] tabular-nums',
            overdrawn ? 'text-guava-red-text font-bold' : 'text-text'
          )}
        >
          {remaining}/{total} days
        </span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}
