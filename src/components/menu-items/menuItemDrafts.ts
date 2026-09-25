// The Menu Items drafts: what the owner is editing, the server value each draft came from, and the rows whose stored
// value moved under an edit (split out of MenuItems by BE-03-T14).
import type { SalesItem } from '@/types'
import type { ItemDraft } from './menuItemDisplay'

export type DraftMap = Record<string, ItemDraft>
export interface DraftState { drafts: DraftMap; baseline: DraftMap; conflicts: DraftMap }

export function buildDraft(item: SalesItem): ItemDraft {
  return {
    category: item.category,
    expectedPrice: item.expectedPrice == null ? '' : String(item.expectedPrice),
    priceTolerancePct: item.priceTolerancePct == null ? '10' : String(item.priceTolerancePct),
    aliases: (item.aliases ?? []).join(', '),
  }
}

export function draftsEqual(a?: ItemDraft, b?: ItemDraft) {
  if (!a || !b) return false
  return (
    a.category === b.category &&
    a.expectedPrice === b.expectedPrice &&
    a.priceTolerancePct === b.priceTolerancePct &&
    a.aliases === b.aliases
  )
}

export function draftPayload(draft: ItemDraft) {
  return {
    category: draft.category,
    expectedPrice: draft.expectedPrice === '' ? undefined : Number(draft.expectedPrice),
    priceTolerancePct: draft.priceTolerancePct === '' ? undefined : Number(draft.priceTolerancePct),
    aliases: draft.aliases.split(',').map((alias) => alias.trim()).filter(Boolean),
  }
}

// Folds one batch of server rows into the drafts. A page holds only some rows, so rows outside the batch keep their
// draft, baseline and conflict; the batch's own rows are decided afresh.
export function mergeServerDrafts(state: DraftState, serverItems: SalesItem[]): DraftState {
  const serverDrafts: DraftMap = {}
  for (const item of serverItems) serverDrafts[item._id] = buildDraft(item)

  const previousDrafts = state.drafts
  const previousBaseline = state.baseline
  const mergedDrafts: DraftMap = { ...serverDrafts }
  const nextBaseline: DraftMap = { ...previousBaseline }
  const nextConflicts: DraftMap = Object.fromEntries(
    Object.entries(state.conflicts).filter(([id]) => !(id in serverDrafts))
  )

  for (const [id, draft] of Object.entries(previousDrafts)) {
    const rowBaseline = previousBaseline[id]
    const serverDraft = serverDrafts[id]
    const isDirty = Boolean(rowBaseline) && !draftsEqual(draft, rowBaseline)
    if (!isDirty) continue

    // Conflict policy: the user's typing always wins the render, because
    // silently replacing what someone is mid-sentence on is the one
    // outcome with no recovery. Where the stored value also moved we say
    // so on the row and offer to take theirs, so the stale draft is never
    // kept silently either.
    mergedDrafts[id] = draft
    if (serverDraft && !draftsEqual(serverDraft, rowBaseline)) nextConflicts[id] = serverDraft
  }

  for (const [id, serverDraft] of Object.entries(serverDrafts)) {
    const draft = previousDrafts[id]
    const rowBaseline = previousBaseline[id]
    // The baseline stays pinned while a row is dirty, so the conflict on it
    // stays visible across later refetches instead of quietly resolving.
    const isDirty = Boolean(rowBaseline) && Boolean(draft) && !draftsEqual(draft, rowBaseline)
    if (!isDirty) nextBaseline[id] = serverDraft
  }

  return { drafts: mergedDrafts, baseline: nextBaseline, conflicts: nextConflicts }
}
