import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearImprovementDrafts, readImprovementDraft, removeImprovementDraft, writeImprovementDraft } from './improvementDraft'

const scope = { userId: 'owner', orgId: 'org', cafeId: 'cafe' }
const draft = { type: 'fix' as const, title: 'Keep my title', area: 'planning' as const, priority: 'high' as const,
  description: 'Keep my description.', desiredOutcome: 'Keep my outcome.' }
const key = 'your-guava:improvement-draft:v1:owner:org:cafe'

describe('Improvement draft storage', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('isolates user, organisation and cafe and avoids delimiter collisions', () => {
    writeImprovementDraft(scope, draft)
    for (const other of [{ ...scope, userId: 'other' }, { ...scope, orgId: 'other' }, { ...scope, cafeId: 'other' }]) {
      expect(readImprovementDraft(other)).toBeNull()
    }
    writeImprovementDraft({ userId: 'a:b', orgId: 'c', cafeId: 'd' }, draft)
    expect(readImprovementDraft({ userId: 'a', orgId: 'b:c', cafeId: 'd' })).toBeNull()
    expect(readImprovementDraft(scope)).toEqual(draft)
    removeImprovementDraft(scope)
    expect(readImprovementDraft(scope)).toBeNull()
  })

  it.each(['{broken', 'null', '{}', JSON.stringify({ ...draft, type: 'unknown' }),
    JSON.stringify({ ...draft, area: '__proto__' }), JSON.stringify({ ...draft, priority: 'urgent' }),
    JSON.stringify({ ...draft, title: 123 }), JSON.stringify({ ...draft, description: 'x'.repeat(5001) })])(
    'ignores corrupt or invalid stored drafts: %s', (raw) => {
      sessionStorage.setItem(key, raw)
      expect(readImprovementDraft(scope)).toBeNull()
    })

  it('keeps the form usable if storage is unavailable or full', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('disabled') })
    expect(readImprovementDraft(scope)).toBeNull()
    expect(() => writeImprovementDraft(scope, draft)).not.toThrow()
    expect(() => removeImprovementDraft(scope)).not.toThrow()
    expect(() => clearImprovementDrafts()).not.toThrow()
    expect(readImprovementDraft(null)).toBeNull()
  })

  it('removes every draft in this tab on deliberate sign-out and leaves other storage alone', () => {
    writeImprovementDraft(scope, draft)
    writeImprovementDraft({ ...scope, cafeId: 'cafe-b' }, draft)
    writeImprovementDraft({ ...scope, userId: 'another-user' }, draft)
    sessionStorage.setItem('other-feature', 'keep')
    clearImprovementDrafts()
    expect(readImprovementDraft(scope)).toBeNull()
    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.getItem('other-feature')).toBe('keep')
  })
})
