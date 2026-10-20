import type { ImprovementArea, ImprovementPriority, ImprovementType } from '@/types'

export interface ImprovementDraft {
  type: ImprovementType
  title: string
  area: ImprovementArea
  priority: ImprovementPriority
  description: string
  desiredOutcome: string
}

export interface ImprovementDraftScope { userId: string; orgId: string; cafeId: string }
const PREFIX = 'your-guava:improvement-draft:v1:'
const AREAS = new Set(['dashboard', 'planning', 'analytics', 'history', 'ask_guava', 'data_uploads', 'menu_items', 'integrations', 'team', 'settings', 'billing', 'other'])
const keyFor = (scope: ImprovementDraftScope) => PREFIX + [scope.userId, scope.orgId, scope.cafeId].map(encodeURIComponent).join(':')

// A tab survives the hard navigation to sign-in, without sharing a draft with
// another tab that deliberately signs out or switches cafes.
export function readImprovementDraft(scope: ImprovementDraftScope | null): ImprovementDraft | null {
  if (!scope) return null
  try {
    const draft = JSON.parse(sessionStorage.getItem(keyFor(scope)) || 'null')
    if (!draft || !['improvement', 'fix'].includes(draft.type) || !AREAS.has(draft.area)
      || !['low', 'medium', 'high'].includes(draft.priority)) return null
    for (const [field, limit] of [['title', 140], ['description', 5000], ['desiredOutcome', 2000]] as const) {
      if (typeof draft[field] !== 'string' || draft[field].length > limit) return null
    }
    return { type: draft.type, title: draft.title, area: draft.area, priority: draft.priority,
      description: draft.description, desiredOutcome: draft.desiredOutcome }
  } catch {
    return null
  }
}

export function writeImprovementDraft(scope: ImprovementDraftScope | null, draft: ImprovementDraft): void {
  if (!scope) return
  if (![draft.title, draft.description, draft.desiredOutcome].some((value) => value.trim().length > 0)) {
    removeImprovementDraft(scope)
    return
  }
  try { sessionStorage.setItem(keyFor(scope), JSON.stringify(draft)) } catch { /* The form still works without storage. */ }
}

export function removeImprovementDraft(scope: ImprovementDraftScope | null): void {
  if (!scope) return
  try { sessionStorage.removeItem(keyFor(scope)) } catch { /* Storage can be disabled. */ }
}

export function clearImprovementDrafts(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch { /* Deliberate sign-out must still complete when storage is disabled. */ }
}

export function retainImprovementDraftsForUser(userId: string): void {
  const ownPrefix = `${PREFIX}${encodeURIComponent(userId)}:`
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(PREFIX) && !key.startsWith(ownPrefix)) sessionStorage.removeItem(key)
    }
  } catch { /* Sign-in still works when storage is unavailable. */ }
}
