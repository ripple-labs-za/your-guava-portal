// The Menu Items page's server reads (BE-03-T14).
import api from '@/lib/api'
import type { SalesItem } from '@/types'

export const MENU_PAGE_SIZE = 50
export const REVIEW_PAGE_SIZE = 50
const LINK_TARGET_PAGE_SIZE = 200
const MAX_LINK_TARGET_PAGES = 10 // 2,000 matched items; beyond that the select is not usable anyway

// The server pages both lists and counts the whole menu (BE-03-T14): the header used to count the arrays it received,
// so 300 unmatched items read "Need a match 50", and the Fix Imports list could never reach item 51.
export interface ItemsListMeta {
  total: number; page: number; limit: number; pages: number; needsReview?: number; priceMismatches?: number
  counts?: { matched: number; needs_review: number; ignored: number; merged: number }
}
export interface ReconciliationMeta { needsReview: number; priceMismatches: number; total?: number; page?: number; pages?: number }
export type ItemsPage = { items: SalesItem[]; meta: ItemsListMeta }
export type ReviewPage = { items: SalesItem[]; meta: ReconciliationMeta }

export const fetchMenuPage = (page: number, q: string) => api.get<ItemsPage>('/items', {
  params: { active: 'true', page, limit: MENU_PAGE_SIZE, ...(q ? { q } : {}) },
})
export const fetchReviewPage = (page: number) => api.get<ReviewPage>('/items/reconciliation', {
  params: { page, limit: REVIEW_PAGE_SIZE },
})
export const fetchHiddenPage = (page: number) => api.get<ItemsPage>('/items', {
  params: { active: 'false', page, limit: MENU_PAGE_SIZE },
})
// Every matched item is a link target, not just the first page of the menu.
export const fetchLinkTargets = async (): Promise<SalesItem[]> => {
  const all: SalesItem[] = []
  for (let page = 1; page <= MAX_LINK_TARGET_PAGES; page += 1) {
    const { data } = await api.get<ItemsPage>('/items', {
      // counts=false: the whole-cafe counts are a pass over every item, and the header reads them from elsewhere.
      params: { active: 'true', reviewStatus: 'matched', page, limit: LINK_TARGET_PAGE_SIZE, counts: 'false' },
    })
    all.push(...data.items)
    if (page >= (data.meta?.pages ?? 1)) break
  }
  return all
}

// Pages 1..count of the queue together, so an action taken on a loaded-more card does not shrink the list back to one page.
export const fetchReviewPages = async (count: number) => {
  const pages = await Promise.all(Array.from({ length: count }, (_, index) => fetchReviewPage(index + 1)))
  const seen = new Set<string>()
  const items = pages.flatMap(({ data }) => data.items).filter((item) => !seen.has(item._id) && Boolean(seen.add(item._id)))
  return { items, meta: pages[pages.length - 1].data.meta }
}

// Named rows, at most one page of ids per request: edits made on pages the owner has left are re-read on a refresh.
export const fetchItemsByIds = async (ids: string[]): Promise<SalesItem[]> => {
  const all: SalesItem[] = []
  for (let start = 0; start < ids.length; start += LINK_TARGET_PAGE_SIZE) {
    const { data } = await api.get<ItemsPage>('/items', {
      params: { ids: ids.slice(start, start + LINK_TARGET_PAGE_SIZE).join(','), limit: LINK_TARGET_PAGE_SIZE, counts: 'false' },
    })
    all.push(...data.items)
  }
  return all
}
