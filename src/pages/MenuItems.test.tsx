import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import MenuItems from './MenuItems'
import type { SalesItem } from '@/types'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'owner' }, isLoading: false, isOwner: true }),
}))

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPut = vi.fn()

// Partial mock: AuthProvider reads API_CONFIG_ERROR and isSessionRejection from
// this module during render, and a factory that omits them makes vitest throw
// the moment one is touched.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    refreshAccessToken: () => Promise.resolve('test-access-token'),
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: (...args: unknown[]) => mockPost(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

function buildItem(overrides: Partial<SalesItem> & { _id: string; name: string }): SalesItem {
  return {
    cafeId: 'cafe1',
    category: 'coffee',
    isActive: true,
    reviewStatus: 'matched',
    ...overrides,
  } as SalesItem
}

const FLAT_WHITE = buildItem({
  _id: 'item1',
  name: 'Flat White (Blend)',
  expectedPrice: 32,
  priceTolerancePct: 10,
  avgPrice: 32,
  aliases: ['FLATWHITE'],
})

const CROISSANT = buildItem({
  _id: 'item2',
  name: 'Almond Croissant',
  category: 'food',
  expectedPrice: 45,
  priceTolerancePct: 10,
  avgPrice: 45,
})

const NEEDS_REVIEW = buildItem({
  _id: 'review1',
  name: 'Cappucino Lrg',
  reviewStatus: 'needs_review',
  avgPrice: 38,
  lastObservedPrice: 38,
  candidates: [{ item: FLAT_WHITE, score: 0.7 }],
} as Partial<SalesItem> & { _id: string; name: string })

type Params = Record<string, string | number | undefined>
const hasPrice = (item: SalesItem) => (item.priceMismatchCount ?? 0) > 0 || Boolean(item.lastPriceMismatchAt)
const pageOf = <T,>(all: T[], params: Params, fallbackLimit = 50) => {
  const page = Number(params.page ?? 1)
  const limit = Number(params.limit ?? fallbackLimit)
  return { rows: all.slice((page - 1) * limit, page * limit), page, limit, pages: Math.max(1, Math.ceil(all.length / limit)) }
}

// Behaves like the paged server (BE-03-T14): tests that pass small lists are unaffected, because page 1 holds everything.
function serveItems(menuFor: (params?: Params) => SalesItem[], review: SalesItem[]) {
  mockGet.mockImplementation((url: string, config?: { params?: Params }) => {
    const params = config?.params ?? {}
    if (url.includes('/items/reconciliation')) {
      const { rows, page, limit, pages } = pageOf(review, params)
      return Promise.resolve({ data: { items: rows, meta: {
        needsReview: review.filter((item) => item.reviewStatus === 'needs_review').length,
        priceMismatches: review.filter(hasPrice).length, total: review.length, returned: rows.length, page, limit, pages } } })
    }
    if (url.includes('/items') && params.ids) {
      const ids = new Set(String(params.ids).split(','))
      const rows = menuFor(params).filter((item) => ids.has(item._id))
      return Promise.resolve({ data: { items: rows, meta: { total: rows.length, page: 1, limit: 200, pages: 1 } } })
    }
    if (url.includes('/items')) {
      const q = String(params.q ?? '').toLowerCase()
      const all = menuFor(params).filter((item) => (!params.reviewStatus || item.reviewStatus === params.reviewStatus)
        && (!q || item.name.toLowerCase().includes(q)))
      const { rows, page, limit, pages } = pageOf(all, params)
      return Promise.resolve({ data: { items: rows, meta: { total: all.length, page, limit, pages, counts: {} } } })
    }
    if (url.includes('/cafe/me')) return Promise.resolve({ data: { cafe: { name: 'Test' } } })
    return Promise.resolve({ data: {} })
  })
}

function mockItems(menu: SalesItem[], review: SalesItem[]) {
  serveItems(() => menu, review)
}

// A different menu on each Menu Prices list call (not the link-target fetch), so a refetch can be made to disagree
// with what the user is currently editing.
function mockItemsSequence(menuByCall: SalesItem[][], review: SalesItem[]) {
  let call = 0
  serveItems((params?: Params) => {
    if (params?.reviewStatus) return menuByCall[Math.min(call, menuByCall.length - 1)]
    const menu = menuByCall[Math.min(call, menuByCall.length - 1)]
    call += 1
    return menu
  }, review)
}

async function openMenuPricesTab() {
  await waitFor(() => expect(screen.getByText('Menu Prices')).toBeInTheDocument())
  await userEvent.click(screen.getByText('Menu Prices'))
}

const priceFor = (name: string | RegExp) =>
  screen.getByRole('spinbutton', { name: new RegExp(`Menu price for ${name}`, 'i') })

describe('MenuItems accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('names every menu-table category select after its own row', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Menu Prices')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Menu Prices'))

    expect(
      screen.getByRole('combobox', { name: /Category for Flat White \(Blend\)/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /Category for Almond Croissant/i })
    ).toBeInTheDocument()
  })

  it('names every menu-table price, threshold and alias input after its own row', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Menu Prices')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Menu Prices'))

    expect(screen.getByRole('spinbutton', { name: /Menu price for Flat White \(Blend\)/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Price alert threshold for Flat White \(Blend\)/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /POS aliases for Flat White \(Blend\)/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Menu price for Almond Croissant/i })).toBeInTheDocument()
  })

  it('names each row Save button after the item it saves', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Menu Prices')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Menu Prices'))

    expect(screen.getByRole('button', { name: /Save Flat White \(Blend\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save Almond Croissant/i })).toBeInTheDocument()
  })

  it('labels the new-item category select and the search box', async () => {
    mockItems([FLAT_WHITE], [])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Menu Prices')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Menu Prices'))

    expect(screen.getByRole('combobox', { name: /^Category$/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Search menu items/i })).toBeInTheDocument()
  })

  it('names the review-card category select, price input and link select after the POS item', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())

    expect(screen.getByRole('combobox', { name: /Category for Cappucino Lrg/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Menu price for Cappucino Lrg/i })).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /Link Cappucino Lrg to an existing menu item/i })
    ).toBeInTheDocument()
  })

  it('leaves no select on the page without an accessible name', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [NEEDS_REVIEW])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Menu Prices'))

    const selects = Array.from(document.querySelectorAll('select'))
    expect(selects.length).toBeGreaterThan(0)
    for (const select of selects) {
      const labelled =
        select.getAttribute('aria-label') ||
        (select.id && document.querySelector(`label[for="${select.id}"]`)?.textContent) ||
        select.closest('label')?.textContent
      expect(labelled?.trim()).toBeTruthy()
    }
  })

  it('gives every repeated review action a row-specific accessible name', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])

    render(<MenuItems />)

    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /Keep Cappucino Lrg as a new menu item/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ignore the POS item Cappucino Lrg/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run AI review for Cappucino Lrg/i })).toBeInTheDocument()
  })
})

describe('MenuItems unsaved work', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
    mockPost.mockResolvedValue({ data: {} })
  })

  it('keeps edits typed into other rows when one row is saved', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.clear(priceFor('Almond Croissant'))
    await userEvent.type(priceFor('Almond Croissant'), '48')

    await userEvent.click(screen.getByRole('button', { name: /Save Flat White/i }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1))

    // The refetch must not discard the in-progress edit on the sibling row.
    await waitFor(() => expect(priceFor('Almond Croissant')).toHaveValue(48))
  })

  it('never blanks the table into a spinner while refetching after a save', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.click(screen.getByRole('button', { name: /Save Flat White/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Loading menu items...')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Menu price for Almond Croissant/i })).toBeInTheDocument()
  })

  it('warns instead of silently discarding when the server value moved under an edit', async () => {
    const movedCroissant = { ...CROISSANT, expectedPrice: 52 }
    mockItemsSequence([[FLAT_WHITE, CROISSANT], [FLAT_WHITE, movedCroissant]], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.clear(priceFor('Almond Croissant'))
    await userEvent.type(priceFor('Almond Croissant'), '48')
    await userEvent.click(screen.getByRole('button', { name: /Save Flat White/i }))

    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1))
    // The user's number survives...
    await waitFor(() => expect(priceFor('Almond Croissant')).toHaveValue(48))
    // ...and they are told the stored value changed rather than being left to
    // overwrite it blind.
    expect(await screen.findByText(/changed on the server/i)).toBeInTheDocument()
  })

  it('counts unsaved rows and saves them all in one action', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.clear(priceFor('Almond Croissant'))
    await userEvent.type(priceFor('Almond Croissant'), '48')
    await userEvent.clear(priceFor('Flat White'))
    await userEvent.type(priceFor('Flat White'), '35')

    expect(await screen.findByText(/2 unsaved changes/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /save all changes/i }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(2))
    expect(mockPut).toHaveBeenCalledWith('/items/item2', expect.objectContaining({ expectedPrice: 48 }))
    expect(mockPut).toHaveBeenCalledWith('/items/item1', expect.objectContaining({ expectedPrice: 35 }))
  })

  it('discards unsaved edits only when the user asks for it', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.clear(priceFor('Almond Croissant'))
    await userEvent.type(priceFor('Almond Croissant'), '48')
    await screen.findByText(/1 unsaved change/i)

    await userEvent.click(screen.getByRole('button', { name: /discard changes/i }))

    await waitFor(() => expect(priceFor('Almond Croissant')).toHaveValue(45))
    expect(screen.queryByText(/unsaved change/i)).not.toBeInTheDocument()
  })

  it('warns before the tab is closed with unsaved edits', async () => {
    mockItems([FLAT_WHITE, CROISSANT], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.clear(priceFor('Almond Croissant'))
    await userEvent.type(priceFor('Almond Croissant'), '48')
    await screen.findByText(/1 unsaved change/i)

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('MenuItems import fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
    mockPost.mockResolvedValue({ data: {} })
  })

  it('refuses to link when the pre-selected suggestion has been cleared', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])
    render(<MenuItems />)
    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())

    const linkSelect = screen.getByRole('combobox', { name: /Link Cappucino Lrg to an existing menu item/i })
    await userEvent.selectOptions(linkSelect, '')
    await userEvent.click(screen.getByRole('button', { name: /^Link Cappucino Lrg/i }))

    expect(await screen.findByText(/choose a menu item to map to/i)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('still links to the suggested candidate when the user leaves it selected', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])
    render(<MenuItems />)
    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /^Link Cappucino Lrg/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/items/review1/resolve',
      expect.objectContaining({ action: 'map_to', targetItemId: 'item1' })
    ))
  })
})

describe('MenuItems create form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPut.mockResolvedValue({ data: {} })
  })

  it('cannot be submitted twice while the first request is in flight', async () => {
    mockItems([FLAT_WHITE], [])
    let resolveCreate: (value: unknown) => void = () => {}
    mockPost.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))

    render(<MenuItems />)
    await openMenuPricesTab()

    await userEvent.type(screen.getByLabelText(/item name/i), 'Cortado')
    const add = screen.getByRole('button', { name: /^add(ing)?/i })
    await userEvent.click(add)
    await waitFor(() => expect(add).toBeDisabled())
    await userEvent.click(add)

    expect(mockPost).toHaveBeenCalledTimes(1)
    resolveCreate({ data: {} })
  })

  it('is disabled until a name is typed', async () => {
    mockItems([FLAT_WHITE], [])
    render(<MenuItems />)
    await openMenuPricesTab()

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
  })
})

describe('MenuItems AI review honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does not promise an untouched balance when the review never came back', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])
    mockPost.mockRejectedValue(Object.assign(new Error('timeout of 90000ms exceeded'), { code: 'ECONNABORTED' }))

    render(<MenuItems />)
    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Run AI review for Cappucino Lrg/i }))

    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent(/lost contact/i)
    expect(notice).not.toHaveTextContent(/no credits were charged/i)
  })

  it('keeps the "no credits charged" promise for a definite pre-charge rejection', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])
    mockPost.mockRejectedValue({ response: { status: 402, data: {} } })

    render(<MenuItems />)
    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Run AI review for Cappucino Lrg/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no credits were charged/i)
  })

  it('presents the free smart-check fallback as a result, not a failure', async () => {
    mockItems([FLAT_WHITE], [NEEDS_REVIEW])
    mockPost.mockResolvedValue({ data: { items: [NEEDS_REVIEW], meta: { paidAiUsed: false } } })

    render(<MenuItems />)
    await waitFor(() => expect(screen.getByText('Cappucino Lrg')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /Run AI review for Cappucino Lrg/i }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/free smart check/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('MenuItems at scale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('pages a long menu instead of rendering every row at once', async () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      buildItem({ _id: `bulk${index}`, name: `Item ${String(index).padStart(3, '0')}`, expectedPrice: 10 })
    )
    mockItems(many, [])

    render(<MenuItems />)
    await openMenuPricesTab()

    expect(await screen.findByText(/Showing 1-50 of 120 menu items/i)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Menu price for Item 000/i })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /Menu price for Item 050/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next menu page/i }))
    expect(await screen.findByText(/Showing 51-100 of 120 menu items/i)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /Menu price for Item 050/i })).toBeInTheDocument()
    // The page comes from the server, not from slicing a whole menu the page received (BE-03-T14).
    expect(mockGet).toHaveBeenCalledWith('/items', expect.objectContaining({ params: expect.objectContaining({ page: 2, limit: 50 }) }))
  })
})

describe('MenuItems counts and paging', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mockPut.mockResolvedValue({ data: {} }) })
  const unmatched = Array.from({ length: 300 }, (_, i) => buildItem({ _id: `u${i}`, name: `POS ${String(i).padStart(3, '0')}`, reviewStatus: 'needs_review' }))
  const mismatched = Array.from({ length: 12 }, (_, i) => buildItem({ _id: `m${i}`, name: `Priced ${i}`, priceMismatchCount: 1 }))
  const headerValue = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('p:last-child')!.textContent

  it('shows the full counts from meta, not the length of a page', async () => {
    mockItems([...unmatched, ...mismatched], [...unmatched, ...mismatched])
    render(<MenuItems />)
    await waitFor(() => expect(headerValue(/^Need a match$/i)).toBe('300'))
    // Case-sensitive: the card title "Menu Items" also matches /^Menu items$/i.
    expect(headerValue(/^Menu items$/)).toBe('312')
    expect(headerValue(/^Price differences$/i)).toBe('12')
  })

  it('loads the next page of items that need a match', async () => {
    mockItems(unmatched, unmatched)
    render(<MenuItems />)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Keep POS \d+ as a new menu item$/i })).toHaveLength(50))
    await userEvent.click(screen.getByRole('button', { name: /show 50 more/i }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Keep POS \d+ as a new menu item$/i })).toHaveLength(100))
    expect(mockGet).toHaveBeenCalledWith('/items/reconciliation', expect.objectContaining({ params: expect.objectContaining({ page: 2 }) }))
    expect(screen.getByText(/showing 100 of 300 items that need attention/i)).toBeInTheDocument()
  })

  it('searches the menu on the server', async () => {
    mockItems(unmatched, [])
    render(<MenuItems />)
    await openMenuPricesTab()
    await userEvent.type(screen.getByRole('textbox', { name: /search menu items/i }), 'POS 29')
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/items', expect.objectContaining({
      params: expect.objectContaining({ q: 'POS 29', page: 1 }) })))
    // 'pos 290'...'pos 299' contain 'pos 29'; 'pos 029' does not.
    expect(await screen.findByText(/Showing 1-10 of 10 menu items/i)).toBeInTheDocument()
  })

  it('offers every matched item as a link target, even past the first page', async () => {
    const matched = Array.from({ length: 230 }, (_, i) => buildItem({ _id: `t${i}`, name: `Target ${String(i).padStart(3, '0')}` }))
    mockItems(matched, [NEEDS_REVIEW])
    render(<MenuItems />)
    const select = await screen.findByRole('combobox', { name: /Link Cappucino Lrg to an existing menu item/i })
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(231)) // 230 targets + the placeholder
  })

  it('saves an edit made on another page', async () => {
    const many = Array.from({ length: 120 }, (_, i) => buildItem({ _id: `bulk${i}`, name: `Item ${String(i).padStart(3, '0')}`, expectedPrice: 10 }))
    mockItems(many, [])
    render(<MenuItems />)
    await openMenuPricesTab()
    await userEvent.clear(priceFor('Item 000'))
    await userEvent.type(priceFor('Item 000'), '12')
    await userEvent.click(screen.getByRole('button', { name: /next menu page/i }))
    await screen.findByText(/Showing 51-100 of 120 menu items/i)
    await userEvent.click(screen.getByRole('button', { name: /save all changes/i }))
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/items/bulk0', expect.objectContaining({ expectedPrice: 12 })))
  })

  // Review of BE-03-T14: a save refreshed only page 1 of the queue, so "Show 50 more" progress was lost on every action.
  it('keeps every loaded page of the queue after an action', async () => {
    mockPost.mockResolvedValue({ data: {} })
    mockItems([], unmatched)
    render(<MenuItems />)
    await userEvent.click(await screen.findByRole('button', { name: /show 50 more/i }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Keep POS \d+ as a new menu item$/i })).toHaveLength(100))
    await userEvent.click(screen.getByRole('button', { name: /^Keep POS 075 as a new menu item$/i }))
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/items/reconciliation', expect.objectContaining({ params: expect.objectContaining({ page: 2 }) })))
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getAllByRole('button', { name: /^Keep POS \d+ as a new menu item$/i })).toHaveLength(100)
    // Role queries over 100 cards are slow in jsdom: 5.5 to 6.4 s on a shared host against vitest's 5 s default (codex-b90-b, 18 Oct).
  }, 20_000)

  // Review of BE-03-T14: a refresh re-read only the visible page, so a stored value that moved under an edit made on
  // another page was never flagged, and Save all overwrote it.
  it('flags a stored value that moved under an edit made on another page', async () => {
    let menu = Array.from({ length: 120 }, (_, i) => buildItem({ _id: `bulk${i}`, name: `Item ${String(i).padStart(3, '0')}`, expectedPrice: 10 }))
    serveItems(() => menu, [])
    render(<MenuItems />)
    await openMenuPricesTab()
    await userEvent.clear(priceFor('Item 000'))
    await userEvent.type(priceFor('Item 000'), '12')
    await userEvent.click(screen.getByRole('button', { name: /next menu page/i }))
    await screen.findByText(/Showing 51-100 of 120 menu items/i)
    menu = menu.map((item) => (item._id === 'bulk0' ? { ...item, expectedPrice: 15 } : item)) // someone else saved 15
    await userEvent.click(screen.getByRole('button', { name: /^Save Item 050$/i }))
    expect(await screen.findByText(/1 of them changed elsewhere since you started/i)).toBeInTheDocument()
  })
})


describe('MenuItems first import and hidden decisions (BE-13-T06)', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
const firstImport = (n: number) => Array.from({ length: n }, (_, i) => buildItem({ _id: `new${i}`, name: `New line ${i + 1}`, reviewStatus: 'needs_review' }))

function serveMenu({ matched = 0, review = [] as SalesItem[], hidden = [] as SalesItem[] } = {}) {
  mockGet.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url.includes('/items/reconciliation')) {
      return Promise.resolve({ data: { items: review, meta: { needsReview: review.length, priceMismatches: 0, returned: review.length, limit: 50, total: review.length, page: 1, pages: 1 } } })
    }
    if (url.includes('/items')) {
      const inactive = config?.params?.active === false || config?.params?.active === 'false' || url.includes('active=false')
      const items = inactive ? hidden : []
      const counts = { matched, needs_review: review.length, ignored: hidden.filter((i) => i.reviewStatus === 'ignored').length, merged: hidden.filter((i) => i.reviewStatus === 'merged').length }
      return Promise.resolve({ data: { items, meta: { total: items.length, page: 1, limit: 50, pages: 1, counts, needsReview: review.length, priceMismatches: 0 } } })
    }
    return Promise.resolve({ data: {} })
  })
}

it('offers one decision when a first import has no menu yet', async () => {
  serveMenu({ review: firstImport(13) })
  render(<MenuItems />)
  expect(await screen.findByText(/you have 13 new items from your first import/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Keep all 13 as new items' })).toBeInTheDocument()
  // Nothing to match against, so the per-item smart checks and AI reviews are collapsed.
  expect(screen.queryByText(/smart checks are free/i)).not.toBeInTheDocument()
})

it('lets the first import ignore a POS fee without keeping every new item', async () => {
  const fee = buildItem({ _id: 'fee', name: 'Delivery Fee', reviewStatus: 'needs_review' })
  serveMenu({ review: [fee, ...firstImport(2)] })
  mockPost.mockImplementation((url: string) => {
    if (url === '/items/fee/resolve') serveMenu({ review: firstImport(2), hidden: [{ ...fee, reviewStatus: 'ignored', isActive: false }] })
    return Promise.resolve({ data: { success: true } })
  })
  render(<MenuItems />)
  await userEvent.click(await screen.findByRole('button', { name: 'Ignore the POS item Delivery Fee' }))
  expect(mockPost).toHaveBeenCalledWith('/items/fee/resolve', expect.objectContaining({ action: 'ignore' }))
  expect(mockPost.mock.calls.some(([url]) => url === '/items/confirm-all-new')).toBe(false)
  expect(await screen.findByRole('button', { name: 'Keep all 2 as new items' })).toBeInTheDocument()
})

it('keeps all of them with one request and clears the queue', async () => {
  serveMenu({ review: firstImport(13) })
  mockPost.mockImplementation((url: string) => {
    if (url === '/items/confirm-all-new') {
      serveMenu({ matched: 13 })
      return Promise.resolve({ data: { success: true, confirmed: 13, meta: { needsReview: 0, counts: { matched: 13, needs_review: 0, ignored: 0, merged: 0 } } } })
    }
    return Promise.resolve({ data: {} })
  })
  render(<MenuItems />)
  await userEvent.click(await screen.findByRole('button', { name: 'Keep all 13 as new items' }))
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/items/confirm-all-new', { expectedCount: 13 }))
  expect(mockPost).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.queryByText(/new items from your first import/i)).not.toBeInTheDocument())
  expect(screen.getByText('Need a match').nextElementSibling).toHaveTextContent('0')
})

it('asks again when more lines arrived since the owner looked', async () => {
  serveMenu({ review: firstImport(13) })
  mockPost.mockImplementation((url: string) => {
    if (url === '/items/confirm-all-new') {
      serveMenu({ review: firstImport(14) })
      return Promise.reject({ response: { status: 409, data: { success: false, code: 'ITEM_COUNT_CHANGED', message: '14 items are waiting now, not 13. Review the list again.', details: { code: 'ITEM_COUNT_CHANGED', expected: 13, actual: 14 } } } })
    }
    return Promise.resolve({ data: {} })
  })
  render(<MenuItems />)
  await userEvent.click(await screen.findByRole('button', { name: 'Keep all 13 as new items' }))
  expect(await screen.findByText(/14 items are waiting now/i)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Keep all 14 as new items' })).toBeInTheDocument()
})

it('does not offer keep-all once a menu exists', async () => {
  serveMenu({ matched: 5, review: firstImport(3) })
  render(<MenuItems />)
  await screen.findAllByText(/new line 1/i)
  expect(screen.queryByRole('button', { name: /keep all/i })).not.toBeInTheDocument()
})

it('never labels a merged item as ready', async () => {
  serveMenu({ matched: 1, hidden: [buildItem({ _id: 'm1', name: 'Capuccino', reviewStatus: 'merged', isActive: false, mergedInto: { _id: 't1', name: 'Cappuccino' } } as Partial<SalesItem> & { _id: string; name: string })] })
  render(<MenuItems />)
  await userEvent.click(await screen.findByRole('button', { name: /hidden/i }))
  expect(await screen.findByText('Merged into Cappuccino')).toBeInTheDocument()
  expect(screen.queryByText('Ready')).not.toBeInTheDocument()
})

it('lists ignored and merged items with their state', async () => {
  serveMenu({
    matched: 1,
    hidden: [
      buildItem({ _id: 'i1', name: 'Delivery Fee', reviewStatus: 'ignored', isActive: false }),
      buildItem({ _id: 'm1', name: 'Capuccino', reviewStatus: 'merged', isActive: false, mergedInto: { _id: 't1', name: 'Cappuccino' } } as Partial<SalesItem> & { _id: string; name: string }),
    ],
  })
  render(<MenuItems />)
  await userEvent.click(await screen.findByRole('button', { name: 'Hidden (2)' }))
  expect(await screen.findByText('Delivery Fee')).toBeInTheDocument()
  expect(screen.getByText('Ignored')).toBeInTheDocument()
  expect(screen.getByText('Merged into Cappuccino')).toBeInTheDocument()
})
})
