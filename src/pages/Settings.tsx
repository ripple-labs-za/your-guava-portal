import { useState, useEffect, useCallback, useMemo, useRef, type ComponentType, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  AlertCircle,
  ArrowRight,
  Cable,
  CheckCircle,
  CircleUserRound,
  Clock,
  CreditCard,
  Pencil,
  Save,
  SlidersHorizontal,
  Store,
  Users,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { tradingHourHints, weekdaysWithSales } from '@/lib/tradingHoursHints'
import { timezoneEditabilityHint, timezoneSaveFailure } from '@/lib/timezones'
import { CafeTimezoneField } from '@/components/settings/CafeTimezoneField'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import type { Cafe, HeatmapCell, TradingHoursEntry } from '@/types'
import { AccountSettingsContent } from './Account'

type SaveState = 'idle' | 'saving' | 'success' | 'error'

// Mirrors the Cafe model (required, minlength 2, maxlength 120).
const CAFE_NAME_MIN = 2
const CAFE_NAME_MAX = 120

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** Eight weeks: the same span the forecast engine reasons over by default. */
const SALES_HINT_DAYS = 56
const SALES_HINT_WINDOW = 'the last 8 weeks'

/**
 * Overnight trading (17:00–01:00) has no representation in the model: the
 * backend's normalizeTradingHours throws 400 on closeTime <= openTime too. Say
 * so, rather than letting the owner think they mistyped and keep fighting the
 * form. Until it is modelled, the honest answer is that it is unsupported.
 */
const OVERNIGHT_UNSUPPORTED_HINT =
  'Closing time must be after opening time — overnight trading is not supported yet.'

const invalidTradingDays = (entries: TradingHoursEntry[]) =>
  new Set(entries.filter((entry) => entry.isOpen && entry.closeTime <= entry.openTime).map((entry) => entry.dayOfWeek))

const defaultTradingHours = (): TradingHoursEntry[] => [
  { dayOfWeek: 0, isOpen: false, openTime: '08:00', closeTime: '14:00' },
  { dayOfWeek: 1, isOpen: true, openTime: '07:00', closeTime: '17:00' },
  { dayOfWeek: 2, isOpen: true, openTime: '07:00', closeTime: '17:00' },
  { dayOfWeek: 3, isOpen: true, openTime: '07:00', closeTime: '17:00' },
  { dayOfWeek: 4, isOpen: true, openTime: '07:00', closeTime: '17:00' },
  { dayOfWeek: 5, isOpen: true, openTime: '07:00', closeTime: '17:00' },
  { dayOfWeek: 6, isOpen: true, openTime: '08:00', closeTime: '15:00' },
]

const ensureWeek = (input?: TradingHoursEntry[]): TradingHoursEntry[] => {
  const fallback = defaultTradingHours()
  if (!Array.isArray(input)) return fallback
  return fallback.map((dayDefault) => {
    const provided = input.find((entry) => entry?.dayOfWeek === dayDefault.dayOfWeek)
    return provided
      ? {
          dayOfWeek: dayDefault.dayOfWeek,
          isOpen: provided.isOpen !== false,
          openTime: provided.openTime || dayDefault.openTime,
          closeTime: provided.closeTime || dayDefault.closeTime,
        }
      : dayDefault
  })
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted text-[11px] uppercase tracking-wider font-medium">{label}</p>
      <p className="text-text text-sm font-medium">{value || '—'}</p>
    </div>
  )
}

const formatTimeRange = (entry: TradingHoursEntry) => {
  if (!entry.isOpen) return 'Closed'
  return `${entry.openTime} – ${entry.closeTime}`
}

function StatusBanner({ state, error }: { state: SaveState; error?: string }) {
  if (state === 'success') {
    return (
      <div className="flex items-center gap-2 bg-guava-green/10 border border-guava-green/20 rounded-lg px-3.5 py-2.5 text-sm text-guava-green" role="status">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span>Changes saved successfully.</span>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 bg-red-900/10 border border-red-900/30 rounded-lg px-3.5 py-2.5 text-sm text-red-400" role="alert">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{error ?? 'Failed to save. Please try again.'}</span>
      </div>
    )
  }

  return null
}

interface LoadedSnapshot {
  cafeName: string
  cafeAddress: string
  cafeAddressLine2: string
  cafeSuburb: string
  cafeCity: string
  cafePostalCode: string
  cafeProvince: string
  cafeCountry: string
  cafeLatitude: string
  cafeLongitude: string
  cafeTimezone: string
  timezoneEditable: boolean
  tradingHours: TradingHoursEntry[]
  tradingHoursSaved: boolean
}

const ZA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
] as const

type SettingsSectionId = 'general' | 'account' | 'billing' | 'prediction' | 'integrations' | 'team'

interface SettingsSection {
  id: SettingsSectionId
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Cafe details and trading hours',
    icon: Store,
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Profile and organisation',
    icon: CircleUserRound,
  },
  {
    id: 'billing',
    label: 'Billing & usage',
    description: 'Plan, payment, and credits',
    icon: CreditCard,
  },
  {
    id: 'prediction',
    label: 'Prediction',
    description: 'Forecast factors workspace',
    icon: SlidersHorizontal,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connected systems',
    icon: Cable,
  },
  {
    id: 'team',
    label: 'Team',
    description: 'Users and access',
    icon: Users,
    ownerOnly: true,
  },
]

const isSettingsSectionId = (value: string | null): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === value)

export default function Settings() {
  const { isOwner } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null)
  const [cafeName, setCafeName] = useState('')
  const [cafeAddress, setCafeAddress] = useState('')
  const [cafeAddressLine2, setCafeAddressLine2] = useState('')
  const [cafeSuburb, setCafeSuburb] = useState('')
  const [cafeCity, setCafeCity] = useState('')
  const [cafePostalCode, setCafePostalCode] = useState('')
  const [cafeProvince, setCafeProvince] = useState('')
  const [cafeCountry, setCafeCountry] = useState('')
  const [cafeLatitude, setCafeLatitude] = useState('')
  const [cafeLongitude, setCafeLongitude] = useState('')
  const [cafeTimezone, setCafeTimezone] = useState('')
  // These three sections used to be signposts with no information on them.
  // A summary of the current state makes each one worth opening.
  const [sectionSummary, setSectionSummary] = useState<{
    seatsUsed?: number
    seatsIncluded?: number
    locationsUsed?: number
    locationsIncluded?: number
    plan?: string
    factorsUnlocked?: number
    factorsTotal?: number
  }>({})
  const summarySequenceRef = useRef(0)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cafeState, setCafeState] = useState<SaveState>('idle')
  const [cafeError, setCafeError] = useState<string | undefined>()
  const [cafeNameInvalid, setCafeNameInvalid] = useState(false)
  const [isEditingCafe, setIsEditingCafe] = useState(false)
  // Weekday transaction counts from the cafe's own sales, so the hours on this
  // screen can be checked against them. Best-effort: a cafe with no history
  // yet, or a failed request, must not be told its hours are wrong.
  const [salesByDay, setSalesByDay] = useState<Map<number, number>>(new Map())
  const [tradingHours, setTradingHours] = useState<TradingHoursEntry[]>([])
  const [hoursState, setHoursState] = useState<SaveState>('idle')
  const [hoursError, setHoursError] = useState<string | undefined>()
  const [isEditingHours, setIsEditingHours] = useState(false)
  const requestedSection = searchParams.get('section')
  // Today and Factors send owners here with "Set cafe location". The latitude
  // and longitude they were promised live behind the Edit button, so landing
  // on the read-only summary reads as the wrong page. Open the editor for
  // them; the instruction is spent once carried out, so the parameter is
  // dropped from the URL and a reload does not reopen it.
  const openCafeEditor = searchParams.get('edit') === 'cafe'
  const requestedSectionId = isSettingsSectionId(requestedSection) ? requestedSection : 'general'
  const visibleSections = SETTINGS_SECTIONS.filter((section) => !section.ownerOnly || isOwner)
  const activeSection = visibleSections.some((section) => section.id === requestedSectionId)
    ? requestedSectionId
    : 'general'

  const selectSection = (sectionId: SettingsSectionId) => {
    if (sectionId === 'general') {
      setSearchParams({})
      return
    }
    setSearchParams({ section: sectionId })
  }

  const applySnapshot = (snapshot: LoadedSnapshot) => {
    setCafeName(snapshot.cafeName)
    setCafeAddress(snapshot.cafeAddress)
    setCafeAddressLine2(snapshot.cafeAddressLine2)
    setCafeSuburb(snapshot.cafeSuburb)
    setCafeCity(snapshot.cafeCity)
    setCafePostalCode(snapshot.cafePostalCode)
    setCafeProvince(snapshot.cafeProvince)
    setCafeCountry(snapshot.cafeCountry)
    setCafeLatitude(snapshot.cafeLatitude)
    setCafeLongitude(snapshot.cafeLongitude)
    setCafeTimezone(snapshot.cafeTimezone)
    setTradingHours(snapshot.tradingHours)
  }

  useEffect(() => {
    const controller = new AbortController()
    // An explicit window, because the hint quotes the number and an
    // unqualified count is uncheckable: with no dates the endpoint returns the
    // cafe's whole history, so a Sunday given up a year ago would be argued
    // with forever. Eight weeks is what the forecast engine reasons over, so
    // the two messages describe the same span rather than quoting different
    // numbers for the same fact.
    api
      .get<{ heatmap?: HeatmapCell[]; data?: HeatmapCell[] }>(
        `/analytics/heatmap?days=${SALES_HINT_DAYS}`,
        { signal: controller.signal }
      )
      .then(({ data }) => setSalesByDay(weekdaysWithSales(data.heatmap || data.data || [])))
      .catch(() => setSalesByDay(new Map()))
    return () => controller.abort()
  }, [])

  const loadCafe = useCallback(async (signal?: AbortSignal) => {
    setLoadState('loading')
    setLoaded(null)
    setIsEditingCafe(false)
    setIsEditingHours(false)
    try {
      const { data } = await api.get<{ success: boolean; cafe: Cafe }>('/cafe/me', { signal })
      // Best-effort: the page still works fully if either call fails.
      const summarySequence = (summarySequenceRef.current += 1)
      void (async () => {
        const [accountRes, factorRes] = await Promise.allSettled([
          api.get('/account', { signal }),
          api.get('/forecasts/factors', { signal }),
        ])
        // Promise.allSettled turns an abort into a rejection, so an aborted pair
        // produced an empty object that overwrote a good summary. Only the most
        // recent load may write, and a partial result merges rather than clears.
        if (signal?.aborted || summarySequence !== summarySequenceRef.current) return
        const next: typeof sectionSummary = {}
        if (accountRes.status === 'fulfilled') {
          const usage = accountRes.value.data?.account?.usage
          next.seatsUsed = usage?.seats?.used
          next.seatsIncluded = usage?.seats?.included
          next.locationsUsed = usage?.locations?.used
          next.locationsIncluded = usage?.locations?.included
          next.plan = accountRes.value.data?.account?.organization?.plan
        }
        if (factorRes.status === 'fulfilled') {
          const ent = factorRes.value.data?.entitlements
          next.factorsUnlocked = ent?.unlockedKeys?.length
          next.factorsTotal = (ent?.unlockedKeys?.length ?? 0) + (ent?.lockedKeys?.length ?? 0)
        }
        setSectionSummary((prev) => ({ ...prev, ...next }))
      })()
      if (!data?.cafe) throw new Error('Cafe response was empty')
        const cafe = data.cafe
        const snapshot: LoadedSnapshot = {
          cafeName: cafe.name || '',
          cafeAddress: cafe.location?.address || '',
          cafeAddressLine2: cafe.location?.addressLine2 || '',
          cafeSuburb: cafe.location?.suburb || '',
          cafeCity: cafe.location?.city || '',
          cafePostalCode: cafe.location?.postalCode || '',
          cafeProvince: cafe.location?.province || '',
          cafeCountry: cafe.location?.country || '',
          cafeLatitude: cafe.location?.lat == null ? '' : String(cafe.location.lat),
          cafeLongitude: cafe.location?.lng == null ? '' : String(cafe.location.lng),
          cafeTimezone: cafe.timezone || '',
          timezoneEditable: cafe.timezoneEditable === true,
          tradingHours: ensureWeek(cafe.tradingHours),
          tradingHoursSaved: cafe.tradingHoursSaved !== false,
        }
        setLoaded(snapshot)
        applySnapshot(snapshot)
      setLoadState('ready')
    } catch {
      if (signal?.aborted) return
      setCafeName('')
      setCafeAddress('')
      setCafeAddressLine2('')
      setCafeSuburb('')
      setCafeCity('')
      setCafePostalCode('')
      setCafeProvince('')
      setCafeCountry('')
      setCafeLatitude('')
      setCafeLongitude('')
      setCafeTimezone('')
      setTradingHours([])
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadCafe(controller.signal)
    return () => controller.abort()
  }, [loadCafe])

  const buildLocationPayload = () => ({
    address: cafeAddress,
    addressLine2: cafeAddressLine2,
    suburb: cafeSuburb,
    city: cafeCity,
    postalCode: cafePostalCode,
    province: cafeProvince,
    country: cafeCountry,
    lat: cafeLatitude.trim() === '' ? '' : Number(cafeLatitude),
    lng: cafeLongitude.trim() === '' ? '' : Number(cafeLongitude),
  })

  const handleCafeSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!loaded) return
    // The form is noValidate, which makes the `required` attribute on the name
    // input inert, and this handler used to check only the coordinates. An empty
    // or one-character name therefore reached PUT /cafe/me and came back as raw
    // Mongoose text ("Path `name` is required.") in the red banner.
    // Reported at the field rather than in the banner at the foot of the form,
    // so the owner can see which of a dozen inputs is at fault.
    const trimmedName = cafeName.trim()
    if (trimmedName.length < CAFE_NAME_MIN || trimmedName.length > CAFE_NAME_MAX) {
      setCafeNameInvalid(true)
      setCafeError(undefined)
      setCafeState('idle')
      return
    }
    setCafeNameInvalid(false)
    const latitude = cafeLatitude.trim()
    const longitude = cafeLongitude.trim()
    if (Boolean(latitude) !== Boolean(longitude)) {
      setCafeError('Latitude and longitude must both be provided, or both left blank.')
      setCafeState('error')
      return
    }
    if (latitude && longitude) {
      const parsedLatitude = Number(latitude)
      const parsedLongitude = Number(longitude)
      if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
        setCafeError('Latitude must be a number between -90 and 90.')
        setCafeState('error')
        return
      }
      if (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
        setCafeError('Longitude must be a number between -180 and 180.')
        setCafeState('error')
        return
      }
    }
    setCafeState('saving')
    setCafeError(undefined)
    try {
      await api.put('/cafe/me', {
        name: cafeName,
        location: buildLocationPayload(),
        ...(loaded.timezoneEditable && cafeTimezone && cafeTimezone !== loaded.cafeTimezone ? { timezone: cafeTimezone } : {}),
      })
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              cafeName,
              cafeAddress,
              cafeAddressLine2,
              cafeSuburb,
              cafeCity,
              cafePostalCode,
              cafeProvince,
              cafeCountry,
              cafeLatitude,
              cafeLongitude,
              cafeTimezone,
            }
          : prev
      )
      setCafeState('success')
      setIsEditingCafe(false)
      setTimeout(() => setCafeState('idle'), 3000)
    } catch (err: unknown) {
      const failure = timezoneSaveFailure(err)
      if (failure.locked) {
        setCafeTimezone(loaded.cafeTimezone)
        setLoaded((prev) => prev ? { ...prev, timezoneEditable: false } : prev)
      }
      setCafeError(failure.message || undefined)
      setCafeState('error')
    }
  }

  const handleCafeCancel = () => {
    if (!loaded) return
    const snapshot = loaded
    setCafeName(snapshot.cafeName)
    setCafeAddress(snapshot.cafeAddress)
    setCafeAddressLine2(snapshot.cafeAddressLine2)
    setCafeSuburb(snapshot.cafeSuburb)
    setCafeCity(snapshot.cafeCity)
    setCafePostalCode(snapshot.cafePostalCode)
    setCafeProvince(snapshot.cafeProvince)
    setCafeCountry(snapshot.cafeCountry)
    setCafeLatitude(snapshot.cafeLatitude)
    setCafeLongitude(snapshot.cafeLongitude)
    setCafeTimezone(snapshot.cafeTimezone)
    setCafeError(undefined)
    setCafeState('idle')
    setIsEditingCafe(false)
  }

  const updateDay = (dayOfWeek: number, patch: Partial<TradingHoursEntry>) => {
    setTradingHours((current) =>
      current.map((entry) => (entry.dayOfWeek === dayOfWeek ? { ...entry, ...patch } : entry))
    )
  }

  const handleHoursSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!loaded) return
    setHoursState('saving')
    setHoursError(undefined)
    const invalidDay = tradingHours.find(
      (entry) => entry.isOpen && entry.closeTime <= entry.openTime
    )
    if (invalidDay) {
      // The row itself already says what is wrong; the banner says that a save
      // was refused and points at the row, rather than repeating the sentence.
      setHoursError(`${DAY_LABELS[invalidDay.dayOfWeek]} has invalid hours. Fix the highlighted row before saving.`)
      setHoursState('error')
      return
    }
    try {
      await api.put('/cafe/me', { tradingHours })
      setLoaded((prev) => (prev ? { ...prev, tradingHours, tradingHoursSaved: true } : prev))
      setHoursState('success')
      setIsEditingHours(false)
      setTimeout(() => setHoursState('idle'), 3000)
    } catch (err: unknown) {
      const resp = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
        : undefined
      setHoursError(resp || undefined)
      setHoursState('error')
    }
  }

  const handleHoursCancel = () => {
    if (!loaded) return
    const snapshot = loaded
    setTradingHours(snapshot.tradingHours.map((entry) => ({ ...entry })))
    setHoursError(undefined)
    setHoursState('idle')
    setIsEditingHours(false)
  }

  useEffect(() => {
    // Waits for the snapshot: loadCafe closes both editors when it resolves,
    // so opening one before that would be undone.
    if (!openCafeEditor || !loaded) return
    if (isOwner) setIsEditingCafe(true)
    const next = new URLSearchParams(searchParams)
    next.delete('edit')
    setSearchParams(next, { replace: true })
  }, [openCafeEditor, loaded, isOwner, searchParams, setSearchParams])

  const invalidDays = invalidTradingDays(tradingHours)
  // States the contradiction; never resolves it. The owner may have closed a
  // day deliberately and the history may be stale, so this is a note beside
  // the control rather than an automatic change to their settings.
  const hintByDay = useMemo(() => {
    const map = new Map<number, number>()
    for (const hint of tradingHourHints(tradingHours, salesByDay)) {
      map.set(hint.dayOfWeek, hint.salesCount)
    }
    return map
  }, [tradingHours, salesByDay])

  const isCafeDirty =
    isEditingCafe &&
    Boolean(
      loaded &&
        (cafeTimezone !== loaded.cafeTimezone ||
          cafeName !== loaded.cafeName ||
          cafeAddress !== loaded.cafeAddress ||
          cafeAddressLine2 !== loaded.cafeAddressLine2 ||
          cafeSuburb !== loaded.cafeSuburb ||
          cafeCity !== loaded.cafeCity ||
          cafePostalCode !== loaded.cafePostalCode ||
          cafeProvince !== loaded.cafeProvince ||
          cafeCountry !== loaded.cafeCountry ||
          cafeLatitude !== loaded.cafeLatitude ||
          cafeLongitude !== loaded.cafeLongitude)
    )

  const isHoursDirty =
    isEditingHours &&
    Boolean(
      loaded &&
        tradingHours.some((entry, index) => {
          const original = loaded.tradingHours[index]
          return (
            !original ||
            entry.isOpen !== original.isOpen ||
            entry.openTime !== original.openTime ||
            entry.closeTime !== original.closeTime
          )
        })
    )

  // switchCafe in AuthContext calls window.location.reload(), and the cafe
  // switcher sits in the sidebar right next to whatever is being edited. Only a
  // beforeunload handler stands between seven rows of deliberate input and one
  // stray click.
  useEffect(() => {
    if (!isCafeDirty && !isHoursDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isCafeDirty, isHoursDirty])

  return (
    <AppLayout title="Settings">
      <div className="space-y-6 xl:space-y-0 xl:pl-[244px]">
        <aside className="h-fit rounded-lg border border-border bg-surface p-2 xl:fixed xl:left-[calc(15rem+2rem)] xl:top-20 xl:z-20 xl:w-[220px] xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <nav className="space-y-1" aria-label="Settings sections">
            {visibleSections.map((section) => {
              const Icon = section.icon
              const active = activeSection === section.id

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSection(section.id)}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'flex w-full items-start gap-3 rounded-lg border-l-2 border-guava-red bg-guava-red/10 px-3 py-2.5 text-left text-guava-red-text'
                      : 'flex w-full items-start gap-3 rounded-lg border-l-2 border-transparent px-3 py-2.5 text-left text-muted transition-colors hover:bg-white/5 hover:text-text'
                  }
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{section.label}</span>
                    <span className={active ? 'block text-xs text-guava-red-muted' : 'block text-xs text-muted'}>
                      {section.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {activeSection === 'general' && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        {loadState === 'loading' && (
          <div className="xl:col-span-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted" role="status">
            Loading the active cafe settings...
          </div>
        )}
        {loadState === 'error' && (
          <div className="xl:col-span-2 flex flex-col gap-3 rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div>
              <p className="text-sm font-medium text-red-300">Cafe settings are unavailable</p>
              <p className="mt-1 text-xs text-muted">Nothing can be edited until the saved settings load successfully.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => loadCafe()}>
              Try again
            </Button>
          </div>
        )}
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-guava-red-text" />
                  <CardTitle>Trading Hours</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  Tell Guava when the cafe is open. Closed hours are excluded from analytics so revenue averages and forecast accuracy aren't dragged down by hours you weren't trading.
                </CardDescription>
              </div>
              {isOwner && !isEditingHours && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingHours(true)}
                  disabled={!loaded}
                  aria-label="Edit trading hours"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingHours ? (
              <form onSubmit={handleHoursSave} className="space-y-4">
                <div className="rounded-lg border border-border bg-[#111111] divide-y divide-border">
                  <div className="hidden sm:grid sm:grid-cols-[140px_120px_1fr_1fr] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted font-medium">
                    <span>Day</span>
                    <span>Status</span>
                    <span>Opens</span>
                    <span>Closes</span>
                  </div>
                  {tradingHours.map((entry) => {
                    const dayLabel = DAY_LABELS[entry.dayOfWeek]
                    const dayInvalid = invalidDays.has(entry.dayOfWeek)
                    const hintId = `hours-error-${entry.dayOfWeek}`
                    return (
                      <div
                        key={entry.dayOfWeek}
                        className="grid grid-cols-2 sm:grid-cols-[140px_120px_1fr_1fr] gap-3 px-4 py-3 items-center"
                      >
                        <span className="text-sm font-medium text-text">{dayLabel}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={entry.isOpen}
                          aria-label={`${dayLabel} ${entry.isOpen ? 'open' : 'closed'}`}
                          onClick={() => updateDay(entry.dayOfWeek, { isOpen: !entry.isOpen })}
                          className={
                            entry.isOpen
                              ? 'h-8 px-3 rounded-full text-xs font-medium bg-guava-green/15 text-guava-green border border-guava-green/30 hover:bg-guava-green/25 transition-colors w-fit'
                              : 'h-8 px-3 rounded-full text-xs font-medium bg-[#1a1a1a] text-muted border border-border hover:bg-white/5 transition-colors w-fit'
                          }
                        >
                          {entry.isOpen ? 'Open' : 'Closed'}
                        </button>
                        <Input
                          type="time"
                          aria-label={`${dayLabel} opening time`}
                          value={entry.openTime}
                          onChange={(e) => updateDay(entry.dayOfWeek, { openTime: e.target.value })}
                          disabled={!entry.isOpen}
                          className={!entry.isOpen ? 'opacity-50' : ''}
                        />
                        <Input
                          type="time"
                          aria-label={`${dayLabel} closing time`}
                          value={entry.closeTime}
                          onChange={(e) => updateDay(entry.dayOfWeek, { closeTime: e.target.value })}
                          disabled={!entry.isOpen}
                          aria-invalid={dayInvalid || undefined}
                          aria-describedby={dayInvalid ? hintId : undefined}
                          className={!entry.isOpen ? 'opacity-50' : ''}
                        />
                        {/* The cafe's own sales disagreeing with this switch,
                            said where the switch is. */}
                        {hintByDay.has(entry.dayOfWeek) && (
                          <p className="col-span-2 sm:col-span-4 text-xs text-guava-yellow">
                            Your sales show trading on this day
                            {' '}({hintByDay.get(entry.dayOfWeek)!.toLocaleString('en-ZA')} sales in
                            {' '}{SALES_HINT_WINDOW}).{' '}
                            {loaded?.tradingHoursSaved !== false
                              ? 'While it is marked closed, this day forecasts zero.'
                              : 'Your hours are not saved yet, so Planning treats this day as open. Save your trading hours to confirm.'}
                          </p>
                        )}
                        {/* Explained at the row, as it is typed — not saved up
                            for a banner at the bottom after Save is pressed. */}
                        {dayInvalid && (
                          <p id={hintId} className="col-span-2 sm:col-span-4 text-xs text-red-400">
                            {dayLabel}: {OVERNIGHT_UNSUPPORTED_HINT}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <StatusBanner state={hoursState} error={hoursError} />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleHoursCancel}
                    disabled={hoursState === 'saving'}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={hoursState === 'saving'}>
                    <Save className="w-3.5 h-3.5" />
                    {hoursState === 'saving' ? 'Saving...' : 'Save Trading Hours'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-[#111111] divide-y divide-border">
                  {/* Without this the card rendered an empty bordered rectangle
                      on a load failure, which reads as "no hours configured". */}
                  {tradingHours.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-muted">
                      Trading hours could not be loaded.
                    </p>
                  )}
                  {loaded?.tradingHoursSaved === false && (
                    <p className="px-4 py-3 text-xs text-muted">These are suggested hours, not saved yet. Until you save them, Planning treats any day with sales as open.</p>
                  )}
                  {tradingHours.map((entry) => {
                    const dayLabel = DAY_LABELS[entry.dayOfWeek]
                    return (
                      <div
                        key={entry.dayOfWeek}
                        className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 items-center"
                      >
                        <span className="text-sm font-medium text-text">{dayLabel}</span>
                        <span
                          className={
                            entry.isOpen
                              ? 'text-sm font-medium text-text tabular-nums'
                              : 'text-xs font-medium text-muted uppercase tracking-wide'
                          }
                        >
                          {formatTimeRange(entry)}
                        </span>
                        {hintByDay.has(entry.dayOfWeek) && (
                          <p className="col-span-full text-xs text-guava-yellow">
                            Your sales show trading on this day
                            {' '}({hintByDay.get(entry.dayOfWeek)!.toLocaleString('en-ZA')} sales in
                            {' '}{SALES_HINT_WINDOW}).{' '}
                            {loaded?.tradingHoursSaved !== false
                              ? 'While it is marked closed, this day forecasts zero.'
                              : 'Your hours are not saved yet, so Planning treats this day as open. Save your trading hours to confirm.'}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <StatusBanner state={hoursState} error={hoursError} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-guava-red-text" />
                  <CardTitle>Cafe Details</CardTitle>
                </div>
                <CardDescription className="mt-1">
                  Update the active cafe's name and location for weather, local context, and forecasting.
                </CardDescription>
              </div>
              {isOwner && !isEditingCafe && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditingCafe(true)}
                  disabled={!loaded}
                  aria-label="Edit cafe details"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isEditingCafe ? (
              <form onSubmit={handleCafeSave} className="space-y-5 pb-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="cafe-name">Cafe Name</Label>
                  <Input
                    id="cafe-name"
                    value={cafeName}
                    onChange={(e) => {
                      setCafeName(e.target.value)
                      if (cafeNameInvalid) setCafeNameInvalid(false)
                    }}
                    placeholder="The Good Bean"
                    aria-invalid={cafeNameInvalid || undefined}
                    aria-describedby={cafeNameInvalid ? 'cafe-name-error' : undefined}
                  />
                  {cafeNameInvalid && (
                    <p id="cafe-name-error" role="alert" className="text-xs text-red-400">
                      Cafe name must be between {CAFE_NAME_MIN} and {CAFE_NAME_MAX} characters.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted font-medium">Address</p>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cafe-address">Street Address</Label>
                      <Input id="cafe-address" value={cafeAddress} onChange={(e) => setCafeAddress(e.target.value)} placeholder="123 Long Street" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cafe-address-line2">
                        Apartment, suite, floor <span className="text-muted font-normal">(optional)</span>
                      </Label>
                      <Input id="cafe-address-line2" value={cafeAddressLine2} onChange={(e) => setCafeAddressLine2(e.target.value)} placeholder="Shop 4, Ground Floor" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="cafe-city">City</Label>
                        <Input id="cafe-city" value={cafeCity} onChange={(e) => setCafeCity(e.target.value)} placeholder="Cape Town" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cafe-province">Province</Label>
                        <select
                          id="cafe-province"
                          value={cafeProvince}
                          onChange={(e) => setCafeProvince(e.target.value)}
                          className="flex h-9 w-full rounded-lg border border-border bg-[#111111] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F0F0F]"
                        >
                          <option value="">Select a province</option>
                          {ZA_PROVINCES.map((province) => (
                            <option key={province} value={province}>{province}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cafe-suburb">Suburb</Label>
                        <Input id="cafe-suburb" value={cafeSuburb} onChange={(e) => setCafeSuburb(e.target.value)} placeholder="Sea Point" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cafe-postal-code">Postal Code</Label>
                        <Input id="cafe-postal-code" value={cafePostalCode} onChange={(e) => setCafePostalCode(e.target.value)} placeholder="8005" inputMode="numeric" />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="cafe-country">Country</Label>
                        <Input id="cafe-country" value={cafeCountry} onChange={(e) => setCafeCountry(e.target.value)} placeholder="South Africa" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted font-medium">Forecast coordinates</p>
                    {/* These are not a precision refinement: forecast.service
                        gates the entire weather factor on both being finite, so
                        calling them "optional" told owners the product's headline
                        capability was already on when it was off. */}
                    <p className="mt-1 text-xs text-muted">
                      Weather is off until both are set — without coordinates, forecasts fall back to a plain
                      same-weekday average and the Weather panels stay empty. Enter both values or leave both blank.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="cafe-latitude">Latitude</Label>
                      <Input
                        id="cafe-latitude"
                        type="number"
                        inputMode="decimal"
                        min="-90"
                        max="90"
                        step="any"
                        value={cafeLatitude}
                        onChange={(e) => setCafeLatitude(e.target.value)}
                        placeholder="-33.9249"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cafe-longitude">Longitude</Label>
                      <Input
                        id="cafe-longitude"
                        type="number"
                        inputMode="decimal"
                        min="-180"
                        max="180"
                        step="any"
                        value={cafeLongitude}
                        onChange={(e) => setCafeLongitude(e.target.value)}
                        placeholder="18.4241"
                      />
                    </div>
                  </div>
                </div>

                <CafeTimezoneField value={cafeTimezone} editable={loaded?.timezoneEditable === true} onChange={setCafeTimezone} />

                <StatusBanner state={cafeState} error={cafeError} />
                <Separator />
                <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleCafeCancel}
                    disabled={cafeState === 'saving'}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={cafeState === 'saving'}>
                    <Save className="w-3.5 h-3.5" />
                    {cafeState === 'saving' ? 'Saving...' : 'Save Cafe Details'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-5">
                <ReadOnlyField label="Cafe Name" value={cafeName} />

                <div className="space-y-1.5">
                  <p className="text-muted text-[11px] uppercase tracking-wider font-medium">Address</p>
                  <div className="text-text text-sm font-medium leading-relaxed space-y-0.5">
                    {cafeAddress ? <p>{cafeAddress}</p> : <p className="text-muted">—</p>}
                    {cafeAddressLine2 && <p>{cafeAddressLine2}</p>}
                    {(cafeSuburb || cafeCity || cafePostalCode) && (
                      <p>
                        {[cafeSuburb, cafeCity, cafePostalCode].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {(cafeProvince || cafeCountry) && (
                      <p className="text-muted">
                        {[cafeProvince, cafeCountry].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                  <ReadOnlyField label="Latitude" value={cafeLatitude} />
                  <ReadOnlyField label="Longitude" value={cafeLongitude} />
                  <ReadOnlyField label="Timezone" value={cafeTimezone} />
                </div>
                <p className="text-xs text-muted">{timezoneEditabilityHint(loaded?.timezoneEditable === true)}</p>

                <StatusBanner state={cafeState} error={cafeError} />
              </div>
            )}
          </CardContent>
        </Card>
            </div>
          )}

          {activeSection === 'account' && <AccountSettingsContent section="account" />}
          {activeSection === 'billing' && <AccountSettingsContent section="billing" />}

          {activeSection === 'prediction' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-guava-green" />
              <CardTitle>Forecast Factors</CardTitle>
            </div>
            <CardDescription>
              Events, factor weighting, plan unlocks, and model impact now live in one dedicated workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-[#111111] p-4">
              {sectionSummary.factorsTotal ? (
                <p className="mb-3 text-sm text-text">
                  <span className="font-semibold">{sectionSummary.factorsUnlocked}</span> of{' '}
                  <span className="font-semibold">{sectionSummary.factorsTotal}</span> forecast factors are
                  unlocked on your {sectionSummary.plan ?? 'current'} plan.
                </p>
              ) : null}
              <p className="text-sm font-medium text-text">Configure the prediction algorithm in Planning.</p>
              <p className="mt-1 text-sm text-muted">
                This keeps weather, holidays, events, payday rules, and learning correction together instead of splitting them across Settings.
              </p>
            </div>
            <div className="flex justify-end">
              <Button asChild>
                <Link to="/planning/factors">
                  Open Forecast Factors
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
          )}

          {activeSection === 'integrations' && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Cable className="w-4 h-4 text-guava-green" />
                  <CardTitle>Integrations</CardTitle>
                </div>
                <CardDescription>
                  POS, accounting, and operations connections are grouped here as they become available.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border bg-[#111111] p-4">
                  <p className="mb-3 text-sm text-text">
                    <span className="font-semibold">No connections active.</span> Xero, QuickBooks and Sage
                    are planned after the MVP — sales data imports through Data Health meanwhile.
                  </p>
                  <p className="text-sm font-medium text-text">Connection workspace</p>
                  <p className="mt-1 text-sm text-muted">
                    Integrations remain a dedicated page for connection status and provider setup.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button asChild>
                    <Link to="/integrations">
                      Open Integrations
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeSection === 'team' && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-guava-green" />
                  <CardTitle>Team</CardTitle>
                </div>
                <CardDescription>
                  Manage users, owner access, and cafe membership from the team workspace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border bg-[#111111] p-4">
                  {sectionSummary.seatsIncluded ? (
                    <p className="mb-3 text-sm text-text">
                      <span className="font-semibold">{sectionSummary.seatsUsed}</span> of{' '}
                      <span className="font-semibold">{sectionSummary.seatsIncluded}</span> seats used
                      {sectionSummary.locationsIncluded ? (
                        <> · <span className="font-semibold">{sectionSummary.locationsUsed}</span> of{' '}
                          <span className="font-semibold">{sectionSummary.locationsIncluded}</span> locations</>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="text-sm font-medium text-text">Access management</p>
                  <p className="mt-1 text-sm text-muted">
                    User invitations and roles stay together with the rest of account setup.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button asChild>
                    <Link to="/team">
                      Open Team
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
