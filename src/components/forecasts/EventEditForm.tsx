import { useId, useState, type FormEvent } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { eventDayKey } from '@/lib/date'
import type { LocalEvent } from '@/types'

const IMPACTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const

interface Props {
  event: LocalEvent
  onSaved: (event: LocalEvent) => void
  onCancel: () => void
  onError: (message: string) => void
}

/**
 * Edits one local event in place (ISSUES #96) through the existing PUT /events/:id: its name, date, recurrence and,
 * for a demand event, its impact. A closure keeps its closure type and has no demand impact to set, so its impact is
 * not offered here. The server re-plans the affected days.
 */
export function EventEditForm({ event, onSaved, onCancel, onError }: Props) {
  const ids = useId()
  const isDemandEvent = !event.type || event.type === 'event'
  const [name, setName] = useState(event.name)
  const [date, setDate] = useState(eventDayKey(event))
  const [impact, setImpact] = useState<LocalEvent['impact']>(event.impact || 'medium')
  const [impactPct, setImpactPct] = useState(event.impactPct == null ? '' : String(event.impactPct))
  const [recurring, setRecurring] = useState(Boolean(event.recurring))
  const [saving, setSaving] = useState(false)

  const save = async (submit: FormEvent) => {
    submit.preventDefault()
    if (saving || !name.trim() || !date) return
    setSaving(true)
    try {
      const { data } = await api.put<{ event: LocalEvent }>(`/events/${event._id}`, {
        name: name.trim(),
        date,
        recurring,
        // An empty custom weight clears it, so the event falls back to its preset impact.
        ...(isDemandEvent ? { impact, impactPct: impactPct === '' ? '' : Number(impactPct) } : {}),
      })
      onSaved(data.event)
    } catch {
      onError(`Could not update ${event.name}.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} aria-label={`Edit event ${event.name}`} className="space-y-3 rounded-lg border border-border bg-[#111111] px-3 py-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-name`}>Event name</Label>
          <Input id={`${ids}-name`} value={name} onChange={(change) => setName(change.target.value)} required maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-date`}>Date</Label>
          <Input id={`${ids}-date`} type="date" value={date} onChange={(change) => setDate(change.target.value)} required />
        </div>
        {isDemandEvent && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-impact`}>Expected impact</Label>
              <select
                id={`${ids}-impact`}
                value={impact}
                onChange={(change) => setImpact(change.target.value as LocalEvent['impact'])}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text"
              >
                {IMPACTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-pct`}>Custom weight (%)</Label>
              <Input
                id={`${ids}-pct`} type="number" min={-90} max={200} step={1} value={impactPct}
                onChange={(change) => setImpactPct(change.target.value)} placeholder="Use the preset"
              />
            </div>
          </>
        )}
      </div>
      <label htmlFor={`${ids}-recurring`} className="flex items-center gap-2 text-sm text-text">
        <input
          id={`${ids}-recurring`} type="checkbox" checked={recurring} onChange={(change) => setRecurring(change.target.checked)}
          className="h-4 w-4 accent-guava-green"
        />
        Repeats every year on this date
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving || !name.trim() || !date}>{saving ? 'Saving…' : 'Save event'}</Button>
      </div>
    </form>
  )
}
