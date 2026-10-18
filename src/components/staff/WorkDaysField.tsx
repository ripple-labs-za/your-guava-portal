export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]
const WEEK_ORDER = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
] as const
export const NO_WORK_DAYS_MESSAGE = 'Tick at least one working day. Leave is counted on the days this person works.'

// Leave is charged on these days only, so a weekend worker's Saturday is a
// real leave day and a weekday worker's is not (BE-08-T03).
export function WorkDaysField({ idPrefix, value, onChange }: { idPrefix: string; value: number[]; onChange: (next: number[]) => void }) {
  function toggle(day: number) {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b))
  }
  return (
    <fieldset className="col-span-full">
      <legend className="text-xs text-muted mb-1">Working days</legend>
      <div className="flex flex-wrap gap-3">
        {WEEK_ORDER.map((day) => (
          <label key={day.value} htmlFor={`${idPrefix}-day-${day.value}`} className="flex items-center gap-1.5 text-xs text-text">
            <input
              id={`${idPrefix}-day-${day.value}`}
              type="checkbox"
              checked={value.includes(day.value)}
              onChange={() => toggle(day.value)}
              className="h-3.5 w-3.5 accent-guava-green"
            />
            {day.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
