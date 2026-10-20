import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Coffee, Plus, Save, Search, Tags } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import api from '@/lib/api'
import { publishGuavaCredits, type GuavaCreditSnapshot } from '@/lib/creditEvents'
import { secureRandomId } from '@/lib/idempotency'
import { cn } from '@/lib/utils'
import type { SalesItem, SalesItemCategory } from '@/types'
import { CATEGORIES, ConflictNotice, StatusPill, formatZar, type ItemDraft } from '@/components/menu-items/menuItemDisplay'
import { ReviewItemCard, type ResolveAction } from '@/components/menu-items/ReviewItemCard'
import { buildDraft, draftPayload, draftsEqual, mergeServerDrafts, type DraftMap } from '@/components/menu-items/menuItemDrafts'
import {
  MENU_PAGE_SIZE, REVIEW_PAGE_SIZE, fetchItemsByIds, fetchLinkTargets, fetchMenuPage, fetchReviewPage, fetchReviewPages, fetchHiddenPage,
  type ItemsListMeta, type ItemsPage, type ReconciliationMeta,
} from '@/components/menu-items/menuItemsApi'

type Tab = 'review' | 'menu' | 'hidden'
type Notice = { type: 'success' | 'error'; message: string } | null

const SEARCH_DEBOUNCE_MS = 300
const menuKey = (page: number, q: string) => `${page}|${q}`

// Statuses the server can only have produced before any metering ran, so the
// "no credits were charged" promise is safe to keep for them. A timeout or a
// dropped connection tells us nothing about whether the server finished.
const PRE_CHARGE_REJECTION_STATUSES = [400, 402, 403, 422, 429]

function apiError(err: unknown, fallback: string) {
  if (err && typeof err === 'object' && 'response' in err) {
    const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message
    if (msg) return msg
  }
  return fallback
}

function responseStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { status?: number } }).response?.status
  }
  return undefined
}

export default function MenuItems() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('review')
  const [items, setItems] = useState<SalesItem[]>([])
  const [reviewItems, setReviewItems] = useState<SalesItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [keepingAll, setKeepingAll] = useState(false)
  const [hiddenItems, setHiddenItems] = useState<SalesItem[]>([])
  const [hiddenMeta, setHiddenMeta] = useState<ItemsListMeta | null>(null)
  const [hiddenPage, setHiddenPage] = useState(1)
  const [hiddenLoading, setHiddenLoading] = useState(false)
  const [hiddenError, setHiddenError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [aiReviewId, setAiReviewId] = useState<string | null>(null)
  const aiReviewKeysRef = useRef(new Map<string, string>())
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('') // the debounced `query` the server searches
  const [menuPage, setMenuPage] = useState(1)
  const [menuMeta, setMenuMeta] = useState<ItemsListMeta | null>(null)
  const [menuCount, setMenuCount] = useState<number | null>(null) // the whole menu, whatever is searched
  const [reviewMeta, setReviewMeta] = useState<ReconciliationMeta | null>(null)
  const [reviewPage, setReviewPage] = useState(1)
  const [loadingMoreReview, setLoadingMoreReview] = useState(false)
  const [linkTargets, setLinkTargets] = useState<SalesItem[]>([])
  const [mapTargets, setMapTargets] = useState<Record<string, string>>({})
  // Every Menu Prices row seen on any page, so Save all reaches an edit made on another page.
  const knownItemsRef = useRef(new Map<string, SalesItem>())
  const menuRequestRef = useRef(0)
  const refreshRef = useRef(0)
  const lastMenuKeyRef = useRef<string | null>(null)

  // `drafts` is what the user sees and edits. `baseline` is the server value
  // each draft was derived from, and it is what makes a row's dirtiness
  // knowable: a row is unsaved exactly when its draft differs from its
  // baseline. Refs mirror both so a refetch can merge synchronously without
  // reading stale closure state.
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [baseline, setBaseline] = useState<DraftMap>({})
  // Rows the user is still editing whose stored value moved underneath them.
  const [conflicts, setConflicts] = useState<DraftMap>({})
  const draftsRef = useRef<DraftMap>({})
  const baselineRef = useRef<DraftMap>({})
  const conflictsRef = useRef<DraftMap>({})

  const [newItem, setNewItem] = useState({ name: '', category: 'coffee' as SalesItemCategory, expectedPrice: '', priceTolerancePct: '10' })
  const canSpendCredits = user?.role === 'owner' || Boolean(user?.permissions?.canSpendCredits)

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message })
    setTimeout(() => setNotice(null), 3500)
  }

  const applyDrafts = (next: DraftMap) => {
    draftsRef.current = next
    setDrafts(next)
  }
  const applyBaseline = (next: DraftMap) => {
    baselineRef.current = next
    setBaseline(next)
  }
  const applyConflicts = (next: DraftMap) => {
    conflictsRef.current = next
    setConflicts(next)
  }

  const draftFor = (item: SalesItem): ItemDraft => drafts[item._id] ?? buildDraft(item)
  const unsavedIds = () => Object.keys(draftsRef.current)
    .filter((id) => baselineRef.current[id] && !draftsEqual(draftsRef.current[id], baselineRef.current[id]))

  const editDraft = (item: SalesItem, patch: Partial<ItemDraft>) => {
    const current = draftsRef.current[item._id] ?? buildDraft(item)
    applyDrafts({ ...draftsRef.current, [item._id]: { ...current, ...patch } })
  }

  // Marks one row as agreeing with the server again, so the next refetch is
  // free to take the server's value for it.
  const settleRow = (id: string, settled: ItemDraft) => {
    applyBaseline({ ...baselineRef.current, [id]: settled })
    if (id in conflictsRef.current) {
      const next = { ...conflictsRef.current }
      delete next[id]
      applyConflicts(next)
    }
  }

  const mergeServerItems = (serverItems: SalesItem[]) => {
    const next = mergeServerDrafts(
      { drafts: draftsRef.current, baseline: baselineRef.current, conflicts: conflictsRef.current }, serverItems
    )
    applyDrafts(next.drafts)
    applyBaseline(next.baseline)
    applyConflicts(next.conflicts)
  }

  const showMenuPage = (data: ItemsPage, q: string) => {
    data.items.forEach((item) => knownItemsRef.current.set(item._id, item))
    setItems(data.items)
    setMenuMeta(data.meta)
    if (!q) setMenuCount(data.meta?.total ?? data.items.length)
  }

  const refresh = async ({ background = false }: { background?: boolean } = {}) => {
    // A post-mutation refetch must not blank the table into a spinner: the
    // remount scrolled the list back to the top and hid the fact that other
    // rows had reverted.
    if (!background) setLoading(true)
    setLoadError(false)
    // A newer refresh supersedes this one entirely; a newer page or search request supersedes only its menu rows.
    const refreshId = ++refreshRef.current
    const menuRequest = ++menuRequestRef.current
    lastMenuKeyRef.current = menuKey(menuPage, searchTerm)
    const reviewPages = Math.max(1, reviewPage)
    try {
      const [menuRes, review, targets] = await Promise.all([
        fetchMenuPage(menuPage, searchTerm),
        fetchReviewPages(reviewPages),
        fetchLinkTargets(),
      ])
      if (refreshId !== refreshRef.current) return
      const menuCurrent = menuRequest === menuRequestRef.current
      if (menuCurrent) showMenuPage(menuRes.data, searchTerm)
      setReviewItems(review.items)
      setReviewMeta(review.meta)
      setReviewPage(reviewPages)
      setLinkTargets(targets)
      // Seed from both lists. Building only from the active-menu list dropped
      // every Fix-Imports draft, because a needs-review item is not in it.
      const batch = [...review.items, ...(menuCurrent ? menuRes.data.items : [])]
      // An edit made on a page the owner has since left is re-read too, so a stored value that moved under it is still
      // flagged before Save all writes over it.
      const inBatch = new Set(batch.map((item) => item._id))
      const offscreen = await fetchItemsByIds(unsavedIds().filter((id) => !inBatch.has(id)))
      if (refreshId !== refreshRef.current) return
      offscreen.forEach((item) => { if (knownItemsRef.current.has(item._id)) knownItemsRef.current.set(item._id, item) })
      mergeServerItems([...batch, ...offscreen])
    } catch (err) {
      setLoadError(true)
      showNotice('error', apiError(err, 'Could not load menu items.'))
    } finally {
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (tab !== 'hidden') return
    let current = true
    setHiddenLoading(true)
    setHiddenError(null)
    fetchHiddenPage(hiddenPage).then(({ data }) => {
      if (!current) return
      setHiddenItems(data.items)
      setHiddenMeta(data.meta)
    }).catch((err) => {
      if (current) setHiddenError(apiError(err, 'Could not load hidden items.'))
    }).finally(() => { if (current) setHiddenLoading(false) })
    return () => { current = false }
  }, [tab, hiddenPage])

  // The search box asks the server once the owner stops typing, from the first page.
  useEffect(() => {
    const next = query.trim()
    if (next === searchTerm) return
    const timer = setTimeout(() => { setSearchTerm(next); setMenuPage(1) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, searchTerm])

  // A page or search change loads just that page of the menu; a slower earlier answer never replaces a newer one. The
  // page refresh() just fetched is not fetched again (on mount, and under StrictMode's second effect run).
  useEffect(() => {
    const key = menuKey(menuPage, searchTerm)
    if (key === lastMenuKeyRef.current) return
    lastMenuKeyRef.current = key
    const request = ++menuRequestRef.current
    fetchMenuPage(menuPage, searchTerm)
      .then(({ data }) => {
        if (request !== menuRequestRef.current) return
        showMenuPage(data, searchTerm)
        mergeServerItems(data.items)
      })
      .catch((err) => showNotice('error', apiError(err, 'Could not load this page of menu items.')))
  }, [menuPage, searchTerm])

  const loadMoreReview = async () => {
    setLoadingMoreReview(true)
    try {
      const { data } = await fetchReviewPage(reviewPage + 1)
      setReviewItems((current) => {
        const seen = new Set(current.map((item) => item._id))
        return [...current, ...data.items.filter((item) => !seen.has(item._id))]
      })
      mergeServerItems(data.items)
      setReviewPage(reviewPage + 1)
      setReviewMeta(data.meta)
    } catch (err) {
      showNotice('error', apiError(err, 'Could not load more items.'))
    } finally {
      setLoadingMoreReview(false)
    }
  }

  const matchedItems = useMemo(
    () => linkTargets.filter((item) => item.reviewStatus === 'matched' && item.isActive !== false),
    [linkTargets]
  )
  // Rendered once and reused by every review card. Building the list inside the
  // card map produced (review items x menu items) option nodes, which is 30k
  // nodes on a 300-item menu and re-created on every keystroke.
  const targetOptions = useMemo(
    () => matchedItems.map((target) => (
      <option key={target._id} value={target._id}>{target.name}</option>
    )),
    [matchedItems]
  )

  // `items` is already one page from the server; the numbers below describe where it sits.
  const menuTotal = menuMeta?.total ?? items.length
  const menuPages = menuMeta?.pages ?? 1
  const currentMenuPage = Math.min(menuPage, menuPages)
  const menuRowStart = menuTotal === 0 ? 0 : (currentMenuPage - 1) * MENU_PAGE_SIZE + 1
  const menuRowEnd = Math.min(currentMenuPage * MENU_PAGE_SIZE, menuTotal)
  const reviewTotal = reviewMeta?.total ?? reviewItems.length
  const counts = menuMeta?.counts
  const needsReviewTotal = reviewMeta?.needsReview ?? 0
  const isFirstImport = !loadError && Boolean(counts) && counts?.matched === 0 && needsReviewTotal > 0
  const hiddenCount = (counts?.ignored ?? 0) + (counts?.merged ?? 0)
  const keepAllNew = async () => {
    setKeepingAll(true)
    try {
      await api.post('/items/confirm-all-new', { expectedCount: needsReviewTotal })
      showNotice('success', `${needsReviewTotal} items kept as new menu items.`)
    } catch (err) {
      showNotice('error', apiError(err, 'Could not keep the items. Nothing was changed. Try again.'))
    } finally {
      setKeepingAll(false)
      await refresh({ background: true })
    }
  }

  const dirtyIds = useMemo(
    () => Object.keys(drafts).filter((id) => baseline[id] && !draftsEqual(drafts[id], baseline[id])),
    [drafts, baseline]
  )
  const conflictCount = dirtyIds.filter((id) => conflicts[id]).length

  useEffect(() => {
    if (dirtyIds.length === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyIds.length])

  const createItem = async (event: FormEvent) => {
    event.preventDefault()
    if (creating) return
    if (!newItem.name.trim()) {
      showNotice('error', 'Give the menu item a name before adding it.')
      return
    }
    setCreating(true)
    try {
      await api.post('/items', {
        name: newItem.name.trim(),
        category: newItem.category,
        expectedPrice: newItem.expectedPrice === '' ? undefined : Number(newItem.expectedPrice),
        priceTolerancePct: newItem.priceTolerancePct === '' ? undefined : Number(newItem.priceTolerancePct),
      })
      setNewItem({ name: '', category: 'coffee', expectedPrice: '', priceTolerancePct: '10' })
      showNotice('success', 'Menu item added.')
      refresh({ background: true })
    } catch (err) {
      showNotice('error', apiError(err, 'Could not add menu item.'))
    } finally {
      setCreating(false)
    }
  }

  const putItem = async (item: SalesItem, draft: ItemDraft) => {
    await api.put(`/items/${item._id}`, {
      ...draftPayload(draft),
      reviewStatus: item.reviewStatus === 'needs_review' ? 'matched' : item.reviewStatus,
    })
    settleRow(item._id, draft)
  }

  const saveItem = async (item: SalesItem) => {
    const draft = drafts[item._id]
    if (!draft) return
    setSavingId(item._id)
    try {
      await putItem(item, draft)
      showNotice('success', 'Menu item saved.')
      refresh({ background: true })
    } catch (err) {
      showNotice('error', apiError(err, 'Could not save menu item.'))
    } finally {
      setSavingId(null)
    }
  }

  const saveAllDrafts = async () => {
    const pending = dirtyIds
      .map((id) => ({ item: knownItemsRef.current.get(id), draft: drafts[id] }))
      .filter((entry): entry is { item: SalesItem; draft: ItemDraft } => Boolean(entry.item && entry.draft))
    if (pending.length === 0) return

    setSavingAll(true)
    let saved = 0
    let failed = 0
    for (const { item, draft } of pending) {
      try {
        await putItem(item, draft)
        saved += 1
      } catch {
        failed += 1
      }
    }
    setSavingAll(false)
    showNotice(
      failed === 0 ? 'success' : 'error',
      failed === 0
        ? `Saved ${saved} menu item${saved === 1 ? '' : 's'}.`
        : `Saved ${saved} of ${pending.length}. ${failed} could not be saved and ${failed === 1 ? 'is' : 'are'} still unsaved.`
    )
    refresh({ background: true })
  }

  const discardAllDrafts = () => {
    const next = { ...draftsRef.current }
    const nextBaseline = { ...baselineRef.current }
    for (const id of dirtyIds) {
      // Discarding takes the newest stored value, which for a conflicted row is
      // the one written while the user was typing.
      const stored = conflicts[id] ?? baselineRef.current[id]
      if (!stored) continue
      next[id] = stored
      nextBaseline[id] = stored
    }
    applyDrafts(next)
    applyBaseline(nextBaseline)
    setConflicts({})
  }

  const takeServerValue = (id: string) => {
    const serverDraft = conflicts[id]
    if (!serverDraft) return
    applyDrafts({ ...draftsRef.current, [id]: serverDraft })
    settleRow(id, serverDraft)
  }

  const resolveItem = async (item: SalesItem, action: ResolveAction, priceOverride?: number) => {
    // An explicit blank choice means "none of these", so it must reach the
    // guard below. `||` folded it back into the AI's first candidate and linked
    // the POS item to the very suggestion the user had just rejected.
    const explicitTarget = mapTargets[item._id]
    const targetItemId = explicitTarget !== undefined ? explicitTarget : item.candidates?.[0]?.item?._id
    if (action === 'map_to' && !targetItemId) {
      showNotice('error', 'Choose a menu item to map to.')
      return
    }
    setSavingId(item._id)
    try {
      const draft = drafts[item._id]
      const expectedPriceValue = priceOverride == null
        ? draft?.expectedPrice ?? (item.expectedPrice == null ? '' : String(item.expectedPrice))
        : String(priceOverride)
      await api.post(`/items/${item._id}/resolve`, {
        action,
        targetItemId: action === 'map_to' ? targetItemId : undefined,
        category: draft?.category ?? item.category,
        expectedPrice: expectedPriceValue === '' ? undefined : Number(expectedPriceValue),
        aliases: draft?.aliases ? draft.aliases.split(',').map((alias) => alias.trim()).filter(Boolean) : item.aliases,
      })
      if (draft) settleRow(item._id, draft)
      showNotice('success', action === 'map_to' ? 'Item linked.' : action === 'ignore' ? 'Item ignored.' : 'Menu item updated.')
      refresh({ background: true })
    } catch (err) {
      showNotice('error', apiError(err, 'Could not update menu item.'))
    } finally {
      setSavingId(null)
    }
  }

  const approveSuggestion = async (item: SalesItem) => {
    const suggestion = item.aiSuggestion
    if (!suggestion) return
    if (suggestion.action === 'map_to' && !suggestion.targetItemId) {
      showNotice('error', 'This recommendation needs a menu item target before it can be approved.')
      return
    }
    setSavingId(item._id)
    try {
      await api.post(`/items/${item._id}/resolve`, {
        action: suggestion.action,
        targetItemId: suggestion.action === 'map_to' ? suggestion.targetItemId : undefined,
        category: suggestion.category ?? item.category,
        expectedPrice: suggestion.expectedPrice,
        aliases: suggestion.aliases,
        notes: suggestion.reason,
      })
      showNotice('success', 'Recommendation approved.')
      refresh({ background: true })
    } catch (err) {
      showNotice('error', apiError(err, 'Could not approve this recommendation.'))
    } finally {
      setSavingId(null)
    }
  }

  const runAiReview = async (item: SalesItem) => {
    if (!canSpendCredits) {
      showNotice('error', 'Your role does not have permission to spend Guava credits.')
      return
    }

    setAiReviewId(item._id)
    const idempotencyKey =
      aiReviewKeysRef.current.get(item._id) || `menu-review:${secureRandomId()}`
    aiReviewKeysRef.current.set(item._id, idempotencyKey)
    try {
      const { data } = await api.post<{
        items: SalesItem[]
        guavaCredits?: GuavaCreditSnapshot
        meta?: { paidAiUsed?: boolean; creditsCharged?: number }
      }>(
        '/items/reconciliation/suggestions',
        { itemIds: [item._id] },
        {
          headers: { 'Idempotency-Key': idempotencyKey },
          timeout: 90_000,
        }
      )
      const reviewed = data.items?.[0]
      if (reviewed) {
        setReviewItems((current) =>
          current.map((candidate) => candidate._id === reviewed._id ? reviewed : candidate)
        )
      }
      aiReviewKeysRef.current.delete(item._id)
      publishGuavaCredits(data.guavaCredits)
      if (data.meta?.paidAiUsed) {
        showNotice(
          'success',
          `AI review complete. ${data.meta.creditsCharged ?? 1} Guava credit used.`
        )
      } else {
        // A free smart check is a correct, zero-cost outcome. Showing it as a
        // red error taught owners to distrust a result that was fine.
        showNotice('success', 'AI review was unavailable. A free smart check is shown and no credits were charged.')
      }
    } catch (err) {
      // Only a definite pre-charge rejection lets us promise the balance is
      // untouched. A timeout aborts the client, not the server, so the credit
      // may well have been spent on work we never saw.
      const status = responseStatus(err)
      const chargeIsKnown = status != null && PRE_CHARGE_REJECTION_STATUSES.includes(status)
      showNotice('error', apiError(
        err,
        chargeIsKnown
          ? 'Could not run the AI review. No credits were charged.'
          : 'We lost contact before this AI review was confirmed. Check your Guava credit balance before retrying.'
      ))
    } finally {
      setAiReviewId(null)
    }
  }

  const headerValue = (value: number | null | undefined) => (loadError || value == null ? '—' : value.toLocaleString('en-ZA'))

  return (
    <AppLayout title="Menu Items">
      <div className="space-y-5">
        {notice && (
          <div role={notice.type === 'success' ? 'status' : 'alert'} className={cn(
            'flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm',
            notice.type === 'success'
              ? 'border-guava-green/20 bg-guava-green/10 text-guava-green'
              : 'border-red-900/30 bg-red-900/10 text-red-400'
          )}>
            {notice.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {notice.message}
          </div>
        )}

        {loadError && (
          <div className="flex flex-col gap-3 rounded-lg border border-red-900/30 bg-red-900/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <p className="text-sm text-red-300">Menu items could not be loaded. Counts below are unavailable.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refresh()}>Try again</Button>
          </div>
        )}

        {dirtyIds.length > 0 && (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-amber-200">
              {dirtyIds.length} unsaved change{dirtyIds.length === 1 ? '' : 's'} on this page.
              {conflictCount > 0 && ` ${conflictCount} of them changed elsewhere since you started.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={discardAllDrafts} disabled={savingAll}>
                Discard changes
              </Button>
              <Button type="button" size="sm" onClick={saveAllDrafts} disabled={savingAll}>
                <Save className="w-3.5 h-3.5" />
                {savingAll ? 'Saving…' : `Save all changes (${dirtyIds.length})`}
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted text-xs uppercase tracking-wide">Menu items</p>
                  <p className="text-text text-2xl font-bold">{headerValue(menuCount)}</p>
                </div>
                <Tags className="w-5 h-5 text-guava-green" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted text-xs uppercase tracking-wide">Need a match</p>
                  <p className="text-text text-2xl font-bold">{headerValue(reviewMeta?.needsReview)}</p>
                </div>
                <Coffee className="w-5 h-5 text-guava-red-text" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted text-xs uppercase tracking-wide">Price differences</p>
                  <p className="text-text text-2xl font-bold">{headerValue(reviewMeta?.priceMismatches)}</p>
                </div>
                <AlertCircle className="w-5 h-5 text-amber-300" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>Menu Items</CardTitle>
                <CardDescription>POS names, menu prices, and aliases.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant={tab === 'review' ? 'success' : 'outline'} size="sm" onClick={() => setTab('review')}>
                  <Coffee className="w-3.5 h-3.5" />
                  Fix Imports
                </Button>
                <Button variant={tab === 'menu' ? 'success' : 'outline'} size="sm" onClick={() => setTab('menu')}>
                  <Tags className="w-3.5 h-3.5" />
                  Menu Prices
                </Button>
                <Button variant={tab === 'hidden' ? 'success' : 'outline'} size="sm" onClick={() => setTab('hidden')}>
                  Hidden ({hiddenCount})
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted py-8">Loading menu items...</div>
            ) : tab === 'review' ? (
              <div className="space-y-3">
                {isFirstImport && (
                  <div role="region" aria-label="First import" className="rounded-lg border border-guava-green/30 bg-guava-green/10 px-4 py-3">
                    <p className="text-sm font-medium text-text">You have {needsReviewTotal} new items from your first import. There is no menu to match them to yet, so keep them all as new menu items?</p>
                    <p className="mt-1 text-xs text-text/80">You can still rename, merge or ignore any of them afterwards.</p>
                    <Button className="mt-3" size="sm" onClick={keepAllNew} disabled={keepingAll || needsReviewTotal > 2000}>
                      {keepingAll ? `Keeping ${needsReviewTotal} items…` : `Keep all ${needsReviewTotal} as new items`}
                    </Button>
                    {needsReviewTotal > 2000 && <p className="mt-2 text-sm text-text/80">Too many items to keep in one step. Keep them from the list below instead.</p>}
                  </div>
                )}
                {reviewItems.length === 0 ? (
                  <div className="rounded-lg border border-border bg-[#111111] px-4 py-8 text-center text-sm text-muted">
                    No menu item issues to review.
                  </div>
                ) : (
                  reviewItems.map((item) => isFirstImport && needsReviewTotal <= 2000 ? (
                    <div key={item._id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                      <span className="font-medium text-text">{item.name}</span>
                      <span className="text-muted">Sold {item.totalSold ?? 0} · POS average {formatZar(item.avgPrice)}</span>
                      <Button variant="outline" size="sm" aria-label={`Keep ${item.name} as a new menu item`}
                        onClick={() => resolveItem(item, 'confirm')} disabled={savingId === item._id}>
                        Keep as new
                      </Button>
                      <Button variant="outline" size="sm" aria-label={`Ignore the POS item ${item.name}`}
                        onClick={() => resolveItem(item, 'ignore')} disabled={savingId === item._id}>
                        Ignore
                      </Button>
                    </div>
                  ) : (
                    <ReviewItemCard
                      key={item._id}
                      item={item}
                      draft={draftFor(item)}
                      conflict={conflicts[item._id]}
                      saving={savingId === item._id}
                      aiReviewing={aiReviewId === item._id}
                      canSpendCredits={canSpendCredits}
                      mapTarget={mapTargets[item._id] ?? item.candidates?.[0]?.item?._id ?? ''}
                      targetOptions={targetOptions}
                      onEdit={(patch) => editDraft(item, patch)}
                      onResolve={(action, priceOverride) => resolveItem(item, action, priceOverride)}
                      onTakeServer={() => takeServerValue(item._id)}
                      onAiReview={() => runAiReview(item)}
                      onApprove={() => approveSuggestion(item)}
                      onMapTarget={(id) => setMapTargets((current) => ({ ...current, [item._id]: id }))}
                    />
                  ))
                )}
                {reviewItems.length < reviewTotal && (
                  <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row sm:justify-between">
                    <p className="text-xs text-muted">
                      Showing {reviewItems.length.toLocaleString('en-ZA')} of {reviewTotal.toLocaleString('en-ZA')} items that need attention
                    </p>
                    <Button variant="outline" size="sm" onClick={loadMoreReview} disabled={loadingMoreReview}>
                      {loadingMoreReview ? 'Loading…' : `Show ${Math.min(REVIEW_PAGE_SIZE, reviewTotal - reviewItems.length)} more`}
                    </Button>
                  </div>
                )}
              </div>
            ) : tab === 'hidden' ? (
              <div className="space-y-3">
                {hiddenLoading ? <p className="text-sm text-muted">Loading hidden items...</p>
                  : hiddenError ? <p role="alert" className="text-sm text-guava-red-text">{hiddenError}</p>
                    : hiddenItems.length === 0 ? <p className="text-sm text-muted">No hidden items.</p>
                      : hiddenItems.map((item) => (
                        <div key={item._id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                          <span className="font-medium text-text">{item.name}</span>
                          <StatusPill item={item} />
                          <span className="text-muted">Sold {item.totalSold ?? 0}</span>
                        </div>
                      ))}
                {(hiddenMeta?.pages ?? 1) > 1 && <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" disabled={hiddenLoading || hiddenPage <= 1} onClick={() => setHiddenPage((page) => page - 1)}>Previous hidden page</Button>
                  <span className="text-xs text-muted">Page {hiddenPage} of {hiddenMeta?.pages}</span>
                  <Button variant="outline" size="sm" disabled={hiddenLoading || hiddenPage >= (hiddenMeta?.pages ?? 1)} onClick={() => setHiddenPage((page) => page + 1)}>Next hidden page</Button>
                </div>}
              </div>
            ) : (
              <div className="space-y-4">
                <form onSubmit={createItem} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-[#111111] p-4 md:grid-cols-[1fr_170px_150px_130px_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-item-name">Item name</Label>
                    <Input id="new-item-name" value={newItem.name} onChange={(event) => setNewItem((current) => ({ ...current, name: event.target.value }))} placeholder="Flat White" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-item-category">Category</Label>
                    <select id="new-item-category" className="h-10 w-full rounded-lg border border-border bg-surface px-2 text-sm text-text" value={newItem.category} onChange={(event) => setNewItem((current) => ({ ...current, category: event.target.value as SalesItemCategory }))}>
                      {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-item-price">Menu price</Label>
                    <Input id="new-item-price" type="number" min={0} step="0.01" value={newItem.expectedPrice} onChange={(event) => setNewItem((current) => ({ ...current, expectedPrice: event.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-item-threshold">Alert +/- %</Label>
                    <Input id="new-item-threshold" type="number" min={0} step="1" value={newItem.priceTolerancePct} onChange={(event) => setNewItem((current) => ({ ...current, priceTolerancePct: event.target.value }))} placeholder="10" />
                  </div>
                  <Button type="submit" disabled={creating || !newItem.name.trim()}>
                    <Plus className="w-3.5 h-3.5" />
                    {creating ? 'Adding…' : 'Add'}
                  </Button>
                </form>

                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-muted" />
                  <Input
                    aria-label="Search menu items"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search menu items"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    Showing {menuRowStart.toLocaleString('en-ZA')}-{menuRowEnd.toLocaleString('en-ZA')} of {menuTotal.toLocaleString('en-ZA')} menu items
                  </p>
                  {menuPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Previous menu page"
                        onClick={() => setMenuPage(Math.max(1, currentMenuPage - 1))}
                        disabled={currentMenuPage <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Next menu page"
                        onClick={() => setMenuPage(Math.min(menuPages, currentMenuPage + 1))}
                        disabled={currentMenuPage >= menuPages}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[980px] text-sm">
                    <caption className="sr-only">Menu items with their category, menu price, price alert threshold and POS aliases</caption>
                    <thead className="bg-[#111111] text-left text-xs uppercase tracking-wide text-[#9E9E9E]">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Menu price</th>
                        <th className="px-3 py-2">POS average</th>
                        <th className="px-3 py-2">Alert +/- %</th>
                        <th className="px-3 py-2">POS aliases</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const draft = draftFor(item)
                        const conflict = conflicts[item._id]
                        return (
                          <tr key={item._id} className="border-t border-border">
                            <td className="px-3 py-3">
                              <div className="font-medium text-text">{item.name}</div>
                              <div className="mt-1"><StatusPill item={item} /></div>
                            </td>
                            <td className="px-3 py-3">
                              <select aria-label={`Category for ${item.name}`} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text" value={draft.category} onChange={(event) => editDraft(item, { category: event.target.value as SalesItemCategory })}>
                                {CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <Input aria-label={`Menu price for ${item.name}`} className="w-28" type="number" min={0} step="0.01" value={draft.expectedPrice} onChange={(event) => editDraft(item, { expectedPrice: event.target.value })} />
                              {conflict && (
                                <ConflictNotice itemName={item.name} onTakeServer={() => takeServerValue(item._id)} />
                              )}
                            </td>
                            <td className="px-3 py-3 text-muted">{formatZar(item.avgPrice)}</td>
                            <td className="px-3 py-3">
                              <Input aria-label={`Price alert threshold for ${item.name}`} className="w-24" type="number" min={0} step="1" value={draft.priceTolerancePct} onChange={(event) => editDraft(item, { priceTolerancePct: event.target.value })} />
                            </td>
                            <td className="px-3 py-3">
                              <Input aria-label={`POS aliases for ${item.name}`} value={draft.aliases} onChange={(event) => editDraft(item, { aliases: event.target.value })} placeholder="POS name, another POS name" />
                            </td>
                            <td className="px-3 py-3 text-right">
                              <Button aria-label={`Save ${item.name}`} size="sm" variant="outline" onClick={() => saveItem(item)} disabled={savingId === item._id || savingAll}>
                                <Save className="w-3.5 h-3.5" />
                                Save
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
