import { Label } from '@/components/ui/label'
import {
  canListTimezones,
  timezoneEditabilityHint,
  timezoneOptions,
} from '@/lib/timezones'

export function CafeTimezoneField({
  value,
  editable,
  onChange,
}: {
  value: string
  editable: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {editable ? (
        <>
          <Label htmlFor="cafe-timezone">Timezone</Label>
          <select
            id="cafe-timezone"
            aria-describedby="cafe-timezone-hint"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="flex h-9 w-full rounded-lg border border-border bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0F0F]"
          >
            {timezoneOptions(value).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p id="cafe-timezone-hint" className="text-xs text-muted">
            Sets where the cafe's day starts and ends for Performance, forecasts
            and imports. {timezoneEditabilityHint(true)}
            {!canListTimezones() &&
              ' Your browser cannot list all timezones. Use a newer browser to choose another timezone.'}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-text">Timezone</p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[#0a0a0a] px-3 py-2 text-sm">
            <span className="text-text font-medium tabular-nums">
              {value || '—'}
            </span>
            <span className="text-muted text-xs text-right">
              {timezoneEditabilityHint(false)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
