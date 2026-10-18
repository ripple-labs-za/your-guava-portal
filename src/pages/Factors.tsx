import { weatherTempLabel } from '@/lib/forecastSignals'
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ClosedDayNotice } from '@/components/forecasts/ClosedDayNotice'
import { Link } from 'react-router'
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle,
  CloudSun,
  Percent,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { ModelLearningPanel } from '@/components/forecasts/ModelLearningPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import api from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { forecastDateKey, parseDateOnly, toLocalDateOnly } from '@/lib/date'
import { isWeatherAvailable, signalFix, weatherUnavailableReason } from '@/lib/forecastSignals'
import type {
  EventSalesEffect,
  Forecast,
  ForecastFactor,
  ForecastFactorEntitlement,
  ForecastFactorEntitlements,
  ForecastFactorSettings,
  LocalEvent,
} from '@/types'

type Notice = { type: 'success' | 'error'; message: string } | null
type FactorTab = 'live' | 'rules' | 'events'

const fmtPct = (value?: number | null) => {
  if (value == null || Number.isNaN(Number(value))) return '-'
  const number = Number(value || 0)
  return `${number > 0 ? '+' : ''}${Number(number.toFixed(1))}%`
}

const fmtZar = (value?: number | null) => {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return `R${Number(value).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
}

/**
 * Formats a calendar date without routing it through UTC.
 *
 * `new Date('2026-06-05T22:00:00Z')` is 6 June in Johannesburg and 5 June in
 * London; `new Date('2026-06-06')` is UTC midnight and renders a day early in
 * any negative-offset zone. Both shapes appear on this page — forecast
 * instants and date-only event strings — and both used to be handed straight
 * to `new Date`. This is the exact off-by-one the codebase already fixed on
 * Dashboard and DayCard, so an owner comparing Live Factors to Planning saw
 * two different days for the same forecast.
 */
const fmtDate = (value: string) =>
  parseDateOnly(value).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Feedback for saving factor rules, adding events and refused plan upgrades.
 *
 * Always mounted, so assistive tech has a live region to observe rather than
 * one that appears already-populated and is never announced. Errors do not
 * self-dismiss: the 402 naming the plan is the only explanation an owner gets
 * for a change that did not stick, and it used to vanish after four seconds.
 */
function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {notice && (
        <div
          role={notice.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm',
            notice.type === 'success'
              ? 'border-guava-green/20 bg-guava-green/10 text-guava-green'
              : 'border-red-900/30 bg-red-900/10 text-red-400'
          )}
        >
          {notice.type === 'success' ? (
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss message"
            className="shrink-0 rounded px-1 text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn(
      'flex items-center justify-between gap-3 rounded-lg border border-border bg-[#111111] px-3 py-2.5',
      disabled && 'opacity-55'
    )}>
      <span className="text-sm font-medium text-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-guava-green"
      />
    </label>
  )
}

/**
 * A percentage field that survives being typed into.
 *
 * `<input type="number">` reports `""` for any partially-typed value — a lone
 * `"-"` included — and `Number("") === 0` is finite, so committing on every
 * keystroke wrote 0 into settings and re-rendered the field as `0`, erasing
 * the minus sign the operator had just typed. Half the factor rules are
 * negative by default (rain -10, hot-day coffee -10, load shedding -8/-22/-40),
 * so an owner literally could not enter one with the keyboard: they ended up
 * saving 0% (rain no longer suppresses anything) or +15 after retyping the
 * digits, and nothing on screen said the forecast had changed shape.
 *
 * Keystrokes live here as text; only a complete number reaches settings, and
 * the field's own min/max are enforced on blur rather than being decorative.
 */
function NumberField({
  id,
  label,
  value,
  onChange,
  min = -90,
  max = 200,
  suffix = '%',
  disabled = false,
}: {
  id: string
  label: string
  value: number
  onChange: (value: string) => void
  min?: number
  max?: number
  suffix?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(() => String(value))

  // Adopt the committed value only when it genuinely differs from what is in
  // the box — a load, a save, or Reset Defaults — so an in-progress "-" is
  // never overwritten by the number it is on its way to replacing.
  useEffect(() => {
    setDraft((current) => (Number(current) === value && current.trim() !== '' ? current : String(value)))
  }, [value])

  const handleBlur = () => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    if (clamped !== parsed) {
      setDraft(String(clamped))
      onChange(String(clamped))
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value)
            onChange(event.target.value)
          }}
          onBlur={handleBlur}
          className="pr-10"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          {suffix}
        </span>
      </div>
    </div>
  )
}

function FactorRuleCard({
  title,
  icon,
  children,
  entitlement,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  entitlement?: ForecastFactorEntitlement
}) {
  const locked = entitlement && !entitlement.unlocked
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            <CardTitle>{title}</CardTitle>
          </div>
          {locked && <Badge variant="secondary">{entitlement.requiredPlan}</Badge>}
        </div>
        {entitlement && (
          <CardDescription>
            {locked ? `Unlock on ${entitlement.requiredPlan}. ` : ''}{entitlement.summary}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className={cn('space-y-3', locked && 'opacity-70')}>{children}</CardContent>
    </Card>
  )
}

function formatPlanName(plan?: string) {
  if (!plan) return 'a higher plan'
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function activeFactorKey(factor: ForecastFactor) {
  return factor.key || factor.label
}

/**
 * How much of an answer the engine has for a day. A closed day's R0 is a real
 * prediction; a day still building history has no prediction at all, so it
 * must never be summed, counted or printed as a rand figure.
 */
type DayAvailability = 'ready' | 'closed' | 'awaiting_history'

function dayAvailability(forecast: Forecast): DayAvailability {
  const status = forecast.availability?.status
  if (status === 'closed') return 'closed'
  if (status === 'insufficient_data') return 'awaiting_history'
  return 'ready'
}

/**
 * Replaces the stat grid for a cafe that cannot be forecast yet. Showing "0
 * active factors" next to "R0" reads as a verdict on the cafe; it is really
 * just the absence of history, which is where a new account always starts.
 */
function FactorsAwaitingHistory({ reason }: { reason: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-10 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2">
          <CalendarClock className="h-6 w-6 text-muted" />
        </div>
        <h2 className="text-base font-semibold text-text">Factors are waiting on trading history</h2>
        <p className="mt-2 max-w-lg text-sm text-muted">
          A factor moves a forecast up or down. Until this cafe has enough matching sales history
          to forecast from, there is nothing for a factor to move — so none is active yet, and the
          model has no measured outcomes to learn from.
        </p>
        {reason && (
          <p className="mt-4 max-w-lg rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            What each day needs: {reason}
          </p>
        )}
        <Button asChild className="mt-5">
          <Link to="/data-health">
            <Upload className="h-4 w-4" />
            Import sales data
          </Link>
        </Button>
        <p className="mt-4 max-w-lg text-xs text-muted">
          The rules below are saved and start applying as soon as the first days can be forecast.
        </p>
      </CardContent>
    </Card>
  )
}

export default function Factors() {
  // Factor rules are model configuration: the server refuses a manager's PUT (BE-02-T05), so the page says so up front.
  const { isOwner } = useAuth()
  const [tab, setTab] = useState<FactorTab>('live')
  const [settings, setSettings] = useState<ForecastFactorSettings | null>(null)
  const [defaults, setDefaults] = useState<ForecastFactorSettings | null>(null)
  const [entitlements, setEntitlements] = useState<ForecastFactorEntitlements | null>(null)
  const [events, setEvents] = useState<LocalEvent[]>([])
  const [eventEffects, setEventEffects] = useState<EventSalesEffect[]>([])
  const [eventEffectSummary, setEventEffectSummary] = useState<{
    eventsAnalyzed: number
    avgRevenueImpactPct: number | null
    aboveExpected: number
    belowExpected: number
    insufficientData: number
  } | null>(null)
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [eventSaving, setEventSaving] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [weekRequestFailed, setWeekRequestFailed] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [supportingDataWarning, setSupportingDataWarning] = useState('')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventImpact, setEventImpact] = useState<'low' | 'medium' | 'high'>('medium')
  const [eventImpactPct, setEventImpactPct] = useState('')
  const [eventNotes, setEventNotes] = useState('')

  // One timer, cleared on the next notice and on unmount. A bare setTimeout per
  // notice meant a save at t=0 cleared a delete's confirmation at t=4s, two
  // seconds after it appeared — and notices are the only feedback channel on
  // this page, so losing one can hide why a save was refused.
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearNoticeTimer = () => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current)
      noticeTimer.current = null
    }
  }

  const showNotice = (type: 'success' | 'error', message: string) => {
    clearNoticeTimer()
    setNotice({ type, message })
    // Errors stay until dismissed. A 402 naming the plan is the only
    // explanation the owner gets, and four seconds is not a reading window.
    if (type === 'success') {
      noticeTimer.current = setTimeout(() => setNotice(null), 10000)
    }
  }

  useEffect(() => clearNoticeTimer, [])

  const load = async () => {
    setLoading(true)
    setSupportingDataWarning('')
    try {
      const [factorRes, eventRes, effectRes, weekRes] = await Promise.all([
        api.get<{
          defaults: ForecastFactorSettings
          settings: ForecastFactorSettings
          entitlements: ForecastFactorEntitlements
        }>('/forecasts/factors'),
        api.get<{ events: LocalEvent[] }>('/events'),
        api.get<{
          effects: EventSalesEffect[]
          summary: {
            eventsAnalyzed: number
            avgRevenueImpactPct: number | null
            aboveExpected: number
            belowExpected: number
            insufficientData: number
          }
        }>('/events/effects').catch(() => null),
        api.get<{ forecasts: Forecast[] }>('/forecasts/week').catch(() => null),
      ])
      setDefaults(factorRes.data.defaults)
      setSettings(factorRes.data.settings)
      setEntitlements(factorRes.data.entitlements)
      setEvents(eventRes.data.events)
      setEventEffects(effectRes?.data.effects || [])
      setEventEffectSummary(effectRes?.data.summary || null)
      setForecasts(weekRes?.data.forecasts || [])
      setWeekRequestFailed(!weekRes)
      const unavailable = [
        !weekRes ? 'live forecast factors' : '',
        !effectRes ? 'historical event effects' : '',
      ].filter(Boolean)
      if (unavailable.length > 0) {
        setSupportingDataWarning(
          `${unavailable.join(' and ')} could not be loaded. Empty values below do not mean that no factors or effects exist.`
        )
      }
    } catch {
      // `settings` stays null, which the Rules tab now renders as an explicit
      // retry state rather than falling through to the Events UI.
      showNotice('error', 'Could not load forecast factors.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Only days the engine actually answered may be counted. A day still
  // building history has no factors to report, so including it would understate
  // nothing but overstate the denominator.
  const forecastDays = useMemo(
    () => forecasts.filter((forecast) => dayAvailability(forecast) !== 'awaiting_history'),
    [forecasts]
  )
  const awaitingDays = useMemo(
    () => forecasts.filter((forecast) => dayAvailability(forecast) === 'awaiting_history'),
    [forecasts]
  )
  const readyDays = useMemo(
    () => forecasts.filter((forecast) => dayAvailability(forecast) === 'ready'),
    [forecasts]
  )
  // Coordinates are a cafe-level setting, so every row in the table repeats the
  // same reason. The fact belongs on each row; the action belongs once.
  const weatherFix = useMemo(() => {
    const blocked = forecasts.find((forecast) => !isWeatherAvailable(forecast.signals.weather))
    return blocked ? signalFix(weatherUnavailableReason(blocked.signals.weather)) : null
  }, [forecasts])

  // A week whose only forecast days are closed ones says nothing about factors.
  const awaitingHistory = readyDays.length === 0 && awaitingDays.length > 0
  const awaitingReason =
    awaitingDays.map((forecast) => forecast.availability?.reason).find(Boolean) || ''

  const activeFactors = useMemo(
    () => forecastDays.flatMap((forecast) => forecast.factors || []).filter((factor) => factor.active),
    [forecastDays]
  )

  const factorCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; effect?: string }>()
    activeFactors.forEach((factor) => {
      const key = activeFactorKey(factor)
      const current = counts.get(key) || { label: factor.label, count: 0, effect: factor.effect }
      counts.set(key, { ...current, count: current.count + 1, effect: factor.effect || current.effect })
    })
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [activeFactors])

  // "Next event" took whatever /events happened to return first and never
  // checked the date, so it could name an event that already happened — the
  // card an owner reads to decide whether a factor is about to fire.
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => a.date.localeCompare(b.date)),
    [events]
  )
  const todayKey = toLocalDateOnly(new Date())
  const upcomingEvents = useMemo(
    () => sortedEvents.filter((event) => event.date.slice(0, 10) >= todayKey),
    [sortedEvents, todayKey]
  )
  const nextEvent = upcomingEvents[0]
  const activeEventDays = forecastDays.filter((forecast) => (forecast.signals.events || []).length > 0).length

  const defaultEventPct = (impact: 'low' | 'medium' | 'high') => {
    if (!settings) return impact === 'high' ? 35 : impact === 'medium' ? 20 : 10
    if (impact === 'high') return settings.events.highPct
    if (impact === 'medium') return settings.events.mediumPct
    return settings.events.lowPct
  }

  const entitlementFor = (keyOrSection: string) =>
    entitlements?.factors.find((factor) => factor.key === keyOrSection || factor.section === keyOrSection)

  const isUnlocked = (keyOrSection: string) => entitlementFor(keyOrSection)?.unlocked ?? true
  const lockedCount = entitlements?.lockedKeys.length ?? 0
  const unlockedCount = entitlements?.unlockedKeys.length ?? 0
  const planLabel = entitlements?.plan ? entitlements.plan[0].toUpperCase() + entitlements.plan.slice(1) : 'Starter'
  const eventsUnlocked = isUnlocked('events')

  const updateNumber = <
    Section extends keyof ForecastFactorSettings,
    Key extends keyof ForecastFactorSettings[Section]
  >(section: Section, key: Key, value: string) => {
    const raw = value.trim()
    // "" is what a number input reports for "-", "-." and every other
    // in-progress value, and Number("") is a perfectly finite 0. Leaving state
    // alone until the text is a real number is what keeps the sign.
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return
    const parsed = Number(raw)
    setSettings((current) => {
      if (!current || !Number.isFinite(parsed)) return current
      return {
        ...current,
        [section]: {
          ...current[section],
          [key]: parsed,
        },
      }
    })
  }

  const updateBoolean = <
    Section extends keyof ForecastFactorSettings,
    Key extends keyof ForecastFactorSettings[Section]
  >(section: Section, key: Key, value: boolean) => {
    setSettings((current) => {
      if (!current) return current
      return {
        ...current,
        [section]: {
          ...current[section],
          [key]: value,
        },
      }
    })
  }

  const resetSettings = () => {
    if (defaults) setSettings(defaults)
  }

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const { data } = await api.put<{
        settings: ForecastFactorSettings
        entitlements: ForecastFactorEntitlements
      }>('/forecasts/factors', { settings })
      setSettings(data.settings)
      setEntitlements(data.entitlements)
      showNotice('success', 'Factors saved. Future forecasts will regenerate.')
      await load()
    } catch (err) {
      // A plan-locked change comes back as 402 with a message naming the plan;
      // surface it instead of a generic failure the operator cannot act on.
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      showNotice('error', message || 'Could not save factors.')
    } finally {
      setSaving(false)
    }
  }

  const addEvent = async (event: FormEvent) => {
    event.preventDefault()
    if (!eventsUnlocked) {
      showNotice('error', 'Local event factors unlock on Growth.')
      return
    }
    if (!eventName || !eventDate) return
    setEventSaving(true)
    try {
      const { data } = await api.post<{ event: LocalEvent }>('/events', {
        name: eventName,
        date: eventDate,
        impact: eventImpact,
        impactPct: eventImpactPct === '' ? undefined : Number(eventImpactPct),
        notes: eventNotes || undefined,
      })
      setEvents((current) => [...current, data.event].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()))
      setEventName('')
      setEventDate('')
      setEventImpact('medium')
      setEventImpactPct('')
      setEventNotes('')
      showNotice('success', 'Event added.')
      await load()
    } catch {
      showNotice('error', 'Could not add event.')
    } finally {
      setEventSaving(false)
    }
  }

  // A local event carries the owner's own knowledge — a market day, a street
  // closure — and is unrecoverable once deleted, so the row's control must not
  // fire twice on a double click.
  const deleteEvent = async (id: string) => {
    if (deletingEventId) return
    setDeletingEventId(id)
    try {
      await api.delete(`/events/${id}`)
      setEvents((current) => current.filter((event) => event._id !== id))
      showNotice('success', 'Event removed.')
      await load()
    } catch {
      showNotice('error', 'Could not remove event.')
    } finally {
      setDeletingEventId(null)
    }
  }

  return (
    <AppLayout title="Factors">
      <div className="space-y-5">
        <NoticeBanner notice={notice} onDismiss={() => { clearNoticeTimer(); setNotice(null) }} />
        {supportingDataWarning && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-200"
            role="status"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{supportingDataWarning}</span>
          </div>
        )}

        {!loading && awaitingHistory ? (
          <FactorsAwaitingHistory reason={awaitingReason} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted">Active this week</p>
                {/* Distinct factors, not factor-days. Weather, payday and
                    holiday active on five days each read "15" against a system
                    that has six factor types in total — and contradicted the
                    "Active factor mix" panel directly beneath it, which lists
                    each factor once with an "N days" badge. */}
                <p className="mt-1 text-2xl font-bold text-text">{factorCounts.length}</p>
                {/* Say what the count is drawn from when part of the week has
                    no forecast, so it does not read as a whole-week figure. */}
                {awaitingDays.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    {forecastDays.length} of {forecasts.length} days forecast
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted">Event days</p>
                <p className="mt-1 text-2xl font-bold text-text">{activeEventDays}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted">Avg event lift</p>
                <p className="mt-1 text-2xl font-bold text-text">{fmtPct(eventEffectSummary?.avgRevenueImpactPct)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-xs uppercase tracking-wide text-muted">Next event</p>
                <p className="mt-1 truncate text-lg font-semibold text-text">{nextEvent ? nextEvent.name : '-'}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {entitlements && (
          <Card>
            <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">{planLabel}</Badge>
                  <p className="text-sm font-semibold text-text">{unlockedCount} factors unlocked</p>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Planning uses only the factors unlocked for this plan. Locked factor settings are visible, but they are not applied to predictions.
                </p>
              </div>
              {lockedCount > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {entitlements.factors.filter((factor) => !factor.unlocked).map((factor) => (
                    <Badge key={factor.key} variant="secondary">
                      {factor.label}: {factor.requiredPlan}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && (
          <ModelLearningPanel
            sources={forecasts}
            entitlements={entitlements}
            settings={settings}
            // An empty `sources` is what a failed /forecasts/week looks like
            // here, and the panel then stated "Waiting for history" as fact —
            // directly under this page's own banner saying the opposite.
            unavailable={weekRequestFailed}
          />
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Forecast Factors</CardTitle>
                <CardDescription>Weather, holidays, payday, load shedding, local events, and stock buffers.</CardDescription>
              </div>
              {/* Selection was conveyed by button colour alone. */}
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Factor views">
                <Button role="tab" aria-selected={tab === 'live'} variant={tab === 'live' ? 'success' : 'outline'} size="sm" onClick={() => setTab('live')}>
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Live Factors
                </Button>
                <Button role="tab" aria-selected={tab === 'rules'} variant={tab === 'rules' ? 'success' : 'outline'} size="sm" onClick={() => setTab('rules')}>
                  <Percent className="h-3.5 w-3.5" />
                  Rules
                </Button>
                <Button role="tab" aria-selected={tab === 'events'} variant={tab === 'events' ? 'success' : 'outline'} size="sm" onClick={() => setTab('events')}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  Events
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-sm text-muted" role="status" aria-live="polite">
                Loading factors...
              </div>
            ) : tab === 'rules' && !settings ? (
              /* The tab body used to be a chained ternary whose final branch
                 was the Events UI, so when /forecasts/factors failed and
                 `settings` was null, clicking Rules rendered "Add Event" under
                 a highlighted Rules tab. The only sign anything had failed was
                 a toast that had already gone. */
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-text">Factor rules could not be loaded</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  Your saved rules are still on the server. Nothing has been changed or reset.
                </p>
                <Button className="mt-4" type="button" variant="outline" size="sm" onClick={load}>
                  Try again
                </Button>
              </div>
            ) : tab === 'live' && awaitingHistory ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-text">No factors are active yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                  Nothing can be applied until the first days can be forecast. Once matching sales
                  history is on record, each day appears here with the factors behind it.
                </p>
              </div>
            ) : tab === 'live' ? (
              <div className="space-y-5">
                {weatherFix && (
                  <p className="text-sm text-muted">
                    Weather is not being applied to these days.{' '}
                    <Link
                      to={weatherFix.to}
                      className="font-medium text-guava-red-text underline-offset-4 hover:underline"
                    >
                      {weatherFix.action}
                    </Link>
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[0.8fr_1.2fr]">
                  <div className="rounded-lg border border-border bg-[#111111] p-4">
                    <p className="text-sm font-semibold text-text">Active factor mix</p>
                    <div className="mt-3 space-y-2">
                      {factorCounts.length === 0 ? (
                        <p className="text-sm text-muted">No active factors in the next 7 days.</p>
                      ) : (
                        factorCounts.map((factor) => (
                          <div key={factor.label} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
                            <div>
                              <p className="text-sm font-medium text-text">{factor.label}</p>
                              <p className="text-xs text-muted">{factor.effect || 'active'}</p>
                            </div>
                            <Badge>{factor.count} days</Badge>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Focusable: nothing inside is, so the columns past the
                      viewport were unreachable without a mouse. */}
                  <div
                    className="overflow-auto rounded-lg border border-border"
                    role="region"
                    aria-label="Live factors by day, scrollable"
                    tabIndex={0}
                  >
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="bg-[#111111] text-left text-xs uppercase tracking-wide text-[#9E9E9E]">
                        <tr>
                          <th className="px-3 py-2">Day</th>
                          <th className="px-3 py-2">Forecast</th>
                          <th className="px-3 py-2">Signals</th>
                          <th className="px-3 py-2">Active factors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecasts.map((forecast) => {
                          const active = (forecast.factors || []).filter((factor) => factor.active)
                          const availability = dayAvailability(forecast)
                          const contradicted =
                            availability === 'closed' && forecast.availability?.contradictsHistory
                          return (
                            <Fragment key={forecast._id}>
                            <tr className="border-t border-border">
                              {/* The cafe-local calendar key, as every other
                                  forecast surface uses. */}
                              <td className="px-3 py-3 text-text">{fmtDate(forecastDateKey(forecast))}</td>
                              {/* R0 is only ever a real answer for a closed day.
                                  A day still building history has no figure. */}
                              <td className="px-3 py-3 text-muted">
                                {availability === 'awaiting_history' ? (
                                  <Badge variant="outline">Building history</Badge>
                                ) : availability === 'closed' ? (
                                  <Badge variant="secondary">Closed</Badge>
                                ) : (
                                  `R${Number(forecast.totalPredictedRevenue || 0).toLocaleString('en-ZA')}`
                                )}
                              </td>
                              <td className="px-3 py-3 text-muted">
                                {isWeatherAvailable(forecast.signals.weather)
                                  ? `${weatherTempLabel(forecast.signals.weather)} - ${forecast.signals.weather.condition}`
                                  : weatherUnavailableReason(forecast.signals.weather)}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {active.length === 0 ? (
                                    <span className="text-xs text-muted">None</span>
                                  ) : (
                                    active.map((factor) => (
                                      <Badge key={`${forecast._id}-${factor.key}`} variant="secondary">
                                        {factor.label} {factor.effect && factor.effect !== 'no effect' ? factor.effect : ''}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </td>
                            </tr>
                            {/* Spans the row rather than squeezing into the
                                Forecast cell, so a long reason cannot widen a
                                column that every other day has to share. */}
                            {contradicted && (
                              <tr className="border-t border-border/40">
                                <td colSpan={4} className="px-3 pb-3">
                                  <ClosedDayNotice availability={forecast.availability} compact />
                                </td>
                              </tr>
                            )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : tab === 'rules' && settings ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <FactorRuleCard title="Weather" icon={<CloudSun className="h-4 w-4 text-[#4A9ECC]" />} entitlement={entitlementFor('weather')}>
                    <ToggleRow label="Weather enabled" checked={settings.weather.enabled} disabled={!isUnlocked('weather')} onChange={(value) => updateBoolean('weather', 'enabled', value)} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <NumberField id="weather-hot" label="Hot day starts at" value={settings.weather.hotTemp} min={-10} max={45} suffix="C" disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'hotTemp', value)} />
                      <NumberField id="weather-cold" label="Cold day below" value={settings.weather.coldTemp} min={-10} max={45} suffix="C" disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'coldTemp', value)} />
                      <NumberField id="weather-rain" label="Rain" value={settings.weather.rainPct} disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'rainPct', value)} />
                      <NumberField id="weather-hot-cold-drinks" label="Hot day cold drinks" value={settings.weather.hotColdDrinkPct} disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'hotColdDrinkPct', value)} />
                      <NumberField id="weather-hot-coffee" label="Hot day coffee" value={settings.weather.hotCoffeePct} disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'hotCoffeePct', value)} />
                      <NumberField id="weather-cold-coffee" label="Cold day coffee" value={settings.weather.coldCoffeePct} disabled={!isUnlocked('weather')} onChange={(value) => updateNumber('weather', 'coldCoffeePct', value)} />
                    </div>
                  </FactorRuleCard>

                  <FactorRuleCard title="Calendar" icon={<CalendarDays className="h-4 w-4 text-guava-yellow" />} entitlement={entitlementFor('holiday')}>
                    <ToggleRow label="Holiday factors enabled" checked={settings.holiday.enabled} disabled={!isUnlocked('holiday')} onChange={(value) => updateBoolean('holiday', 'enabled', value)} />
                    <ToggleRow label="Payday factor enabled (Growth)" checked={settings.payday.enabled} disabled={!isUnlocked('payday')} onChange={(value) => updateBoolean('payday', 'enabled', value)} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <NumberField id="holiday-public" label="Public holiday" value={settings.holiday.publicPct} disabled={!isUnlocked('holiday')} onChange={(value) => updateNumber('holiday', 'publicPct', value)} />
                      <NumberField id="holiday-school" label="School holiday" value={settings.holiday.schoolPct} disabled={!isUnlocked('holiday')} onChange={(value) => updateNumber('holiday', 'schoolPct', value)} />
                      <NumberField id="holiday-combined" label="Public + school holiday" value={settings.holiday.combinedPct} disabled={!isUnlocked('holiday')} onChange={(value) => updateNumber('holiday', 'combinedPct', value)} />
                      <NumberField id="payday" label="Payday (Growth)" value={settings.payday.pct} disabled={!isUnlocked('payday')} onChange={(value) => updateNumber('payday', 'pct', value)} />
                    </div>
                  </FactorRuleCard>

                  <FactorRuleCard title="Load Shedding" icon={<Zap className="h-4 w-4 text-amber-300" />} entitlement={entitlementFor('loadShedding')}>
                    <ToggleRow label="Load shedding enabled" checked={settings.loadShedding.enabled} disabled={!isUnlocked('loadShedding')} onChange={(value) => updateBoolean('loadShedding', 'enabled', value)} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <NumberField id="load-1-2" label="Stage 1-2" value={settings.loadShedding.stage1To2Pct} disabled={!isUnlocked('loadShedding')} onChange={(value) => updateNumber('loadShedding', 'stage1To2Pct', value)} />
                      <NumberField id="load-3-4" label="Stage 3-4" value={settings.loadShedding.stage3To4Pct} disabled={!isUnlocked('loadShedding')} onChange={(value) => updateNumber('loadShedding', 'stage3To4Pct', value)} />
                      <NumberField id="load-5-plus" label="Stage 5+" value={settings.loadShedding.stage5PlusPct} disabled={!isUnlocked('loadShedding')} onChange={(value) => updateNumber('loadShedding', 'stage5PlusPct', value)} />
                    </div>
                  </FactorRuleCard>

                  <FactorRuleCard title="Events" icon={<Percent className="h-4 w-4 text-[#9B59B6]" />} entitlement={entitlementFor('events')}>
                    <ToggleRow label="Event factors enabled" checked={settings.events.enabled} disabled={!isUnlocked('events')} onChange={(value) => updateBoolean('events', 'enabled', value)} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <NumberField id="event-low" label="Low event" value={settings.events.lowPct} disabled={!isUnlocked('events')} onChange={(value) => updateNumber('events', 'lowPct', value)} />
                      <NumberField id="event-medium" label="Medium event" value={settings.events.mediumPct} disabled={!isUnlocked('events')} onChange={(value) => updateNumber('events', 'mediumPct', value)} />
                      <NumberField id="event-high" label="High event" value={settings.events.highPct} disabled={!isUnlocked('events')} onChange={(value) => updateNumber('events', 'highPct', value)} />
                    </div>
                  </FactorRuleCard>

                  <FactorRuleCard title="Stock Buffer" icon={<Percent className="h-4 w-4 text-guava-green" />} entitlement={entitlementFor('stock')}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <NumberField id="stock-safety" label="Safety margin" value={settings.stock.safetyMarginPct} min={0} max={100} disabled={!isUnlocked('stock')} onChange={(value) => updateNumber('stock', 'safetyMarginPct', value)} />
                      <NumberField id="stock-bias" label="Stock bias cap" value={settings.stock.maxBiasPct} min={0} max={100} disabled={!isUnlocked('stock')} onChange={(value) => updateNumber('stock', 'maxBiasPct', value)} />
                    </div>
                  </FactorRuleCard>

                  <FactorRuleCard title="History & Learning" icon={<SlidersHorizontal className="h-4 w-4 text-[#4A9ECC]" />} entitlement={entitlementFor('learning')}>
                    <ToggleRow label="Learning correction enabled" checked={settings.learning.enabled} disabled={!isUnlocked('learning')} onChange={(value) => updateBoolean('learning', 'enabled', value)} />
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <NumberField id="history-weeks" label="History lookback" value={settings.history.maxWeeks} min={1} max={16} suffix="wks" disabled={!isUnlocked('history')} onChange={(value) => updateNumber('history', 'maxWeeks', value)} />
                        {/* The card's lock badge describes the *learning*
                            entitlement; this field is gated by `history`,
                            which can require a different plan. Without this the
                            only numeric field on the card is greyed out with
                            nothing on screen explaining why. */}
                        {!isUnlocked('history') && (
                          <p className="text-xs text-muted">
                            Unlock on {formatPlanName(entitlementFor('history')?.requiredPlan)} to change the
                            history lookback.
                          </p>
                        )}
                      </div>
                    </div>
                  </FactorRuleCard>
                </div>

                <div className="flex justify-end gap-2">
                  {!isOwner && (
                    <p id="factors-owner-only" className="mr-auto self-center text-sm text-muted">
                      Only the account owner can change forecast rules.
                    </p>
                  )}
                  {/* Names its blast radius: it sits beside Save Factors and
                      replaces every tuned rule on the page. */}
                  <Button type="button" variant="outline" onClick={resetSettings} disabled={!isOwner}>
                    Reset all rules to defaults
                  </Button>
                  <Button
                    type="button"
                    onClick={saveSettings}
                    disabled={saving || !isOwner}
                    aria-describedby={isOwner ? undefined : 'factors-owner-only'}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Saving...' : 'Save Factors'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <CalendarPlus className="h-4 w-4 text-[#9B59B6]" />
                      <CardTitle>Add Event</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={addEvent} className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="factor-event-name">Event name</Label>
                          <Input id="factor-event-name" value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="Saturday market" disabled={!eventsUnlocked} required />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="factor-event-date">Date</Label>
                          <Input id="factor-event-date" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} disabled={!eventsUnlocked} required />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Impact</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {([
                            { value: 'low' as const, label: `Low ${fmtPct(defaultEventPct('low'))}` },
                            { value: 'medium' as const, label: `Medium ${fmtPct(defaultEventPct('medium'))}` },
                            { value: 'high' as const, label: `High ${fmtPct(defaultEventPct('high'))}` },
                          ]).map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={!eventsUnlocked}
                              onClick={() => setEventImpact(option.value)}
                              className={cn(
                                'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                                !eventsUnlocked && 'cursor-not-allowed opacity-50',
                                eventImpact === option.value
                                  ? 'border-guava-green/30 bg-guava-green/10 text-guava-green'
                                  : 'border-border bg-[#111111] text-muted hover:border-[#3A3A3A]'
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="factor-event-impact">Custom impact</Label>
                          <Input id="factor-event-impact" type="number" min={-90} max={200} step={1} value={eventImpactPct} onChange={(event) => setEventImpactPct(event.target.value)} placeholder={`${defaultEventPct(eventImpact)}`} disabled={!eventsUnlocked} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="factor-event-notes">Notes</Label>
                          <Input id="factor-event-notes" value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} placeholder="High foot traffic" disabled={!eventsUnlocked} />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={eventSaving || !eventsUnlocked}>
                          <CalendarPlus className="h-3.5 w-3.5" />
                          {eventSaving ? 'Adding...' : 'Add Event'}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Upcoming Events</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sortedEvents.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted">No upcoming events.</p>
                    ) : (
                      <div className="space-y-2">
                        {sortedEvents.map((event) => {
                          const isPast = event.date.slice(0, 10) < todayKey
                          return (
                            <div
                              key={event._id}
                              className={cn(
                                'flex items-center justify-between gap-3 rounded-lg border border-border bg-[#111111] px-3 py-2.5',
                                isPast && 'opacity-60'
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-medium text-text">{event.name}</p>
                                  <Badge variant="secondary">{fmtPct(event.impactPct ?? defaultEventPct(event.impact))}</Badge>
                                  {/* A list headed "Upcoming Events" that
                                      silently contains past dates is worse
                                      than one that says which are past. */}
                                  {isPast && <Badge variant="outline">Past</Badge>}
                                </div>
                                <p className="mt-1 text-xs text-muted">{fmtDate(event.date)}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                // Was an icon-only button with no accessible
                                // name at all: "button", repeated once per
                                // event, for an irreversible delete.
                                aria-label={`Remove event ${event.name}`}
                                disabled={deletingEventId != null}
                                onClick={() => deleteEvent(event._id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="xl:col-span-2">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle>Past Event Results</CardTitle>
                        <CardDescription>Actual sales compared with normal same-weekday trading.</CardDescription>
                      </div>
                      {eventEffectSummary && (
                        <Badge variant="secondary">{eventEffectSummary.eventsAnalyzed} measured</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {eventEffects.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted">
                        Add events and upload sales for those dates to measure their effect.
                      </p>
                    ) : (
                      <div
                        className="overflow-auto rounded-lg border border-border"
                        role="region"
                        aria-label="Past event results, scrollable"
                        tabIndex={0}
                      >
                        <table className="w-full min-w-[920px] text-sm">
                          <thead className="bg-[#111111] text-left text-xs uppercase tracking-wide text-[#9E9E9E]">
                            <tr>
                              <th className="px-3 py-2">Event</th>
                              <th className="px-3 py-2">Actual sales</th>
                              <th className="px-3 py-2">Normal day</th>
                              <th className="px-3 py-2">Sales lift</th>
                              <th className="px-3 py-2">Expected</th>
                              <th className="px-3 py-2">Difference</th>
                              <th className="px-3 py-2">Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {eventEffects.map((effect) => (
                              <tr key={effect.eventId} className="border-t border-border">
                                <td className="px-3 py-3">
                                  <p className="font-medium text-text">{effect.name}</p>
                                  <p className="mt-1 text-xs text-muted">{fmtDate(effect.date)}</p>
                                </td>
                                <td className="px-3 py-3 text-text">
                                  {fmtZar(effect.actualRevenue)}
                                  <p className="mt-1 text-xs text-muted">{effect.actualTransactions} transactions</p>
                                </td>
                                <td className="px-3 py-3 text-muted">
                                  {fmtZar(effect.baselineRevenue)}
                                  <p className="mt-1 text-xs">{effect.baselineDayCount} comparable days</p>
                                </td>
                                <td className="px-3 py-3">
                                  <span className={cn(
                                    'font-semibold',
                                    (effect.revenueImpactPct ?? 0) >= 0 ? 'text-guava-green' : 'text-red-400'
                                  )}>
                                    {fmtPct(effect.revenueImpactPct)}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-muted">{fmtPct(effect.expectedImpactPct)}</td>
                                <td className="px-3 py-3">
                                  <span className={cn(
                                    'font-medium',
                                    (effect.vsExpectedPct ?? 0) >= 0 ? 'text-guava-green' : 'text-amber-300'
                                  )}>
                                    {fmtPct(effect.vsExpectedPct)}
                                  </span>
                                </td>
                                <td className="px-3 py-3">
                                  <Badge variant={effect.confidence === 'high' ? 'success' : 'secondary'}>
                                    {effect.confidence}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
