import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearInsightChatStorage,
  getInsightChatStorageKeys,
  readScopedStorage,
  writeScopedStorage,
} from './chatStorage'

describe('insight chat storage', () => {
  beforeEach(() => localStorage.clear())

  it('uses a different namespace for each user, organisation, and cafe', () => {
    const first = getInsightChatStorageKeys({ userId: 'u1', orgId: 'o1', cafeId: 'c1' })
    const second = getInsightChatStorageKeys({ userId: 'u1', orgId: 'o1', cafeId: 'c2' })

    expect(first.current).not.toBe(second.current)
    expect(first.list).not.toBe(second.list)
  })

  it('rejects a payload whose embedded scope does not match', () => {
    const keys = getInsightChatStorageKeys({ userId: 'u1', orgId: 'o1', cafeId: 'c1' })
    localStorage.setItem(keys.current, JSON.stringify({ scopeId: 'another-scope', messages: ['secret'] }))

    expect(readScopedStorage(keys.current, keys.scopeId)).toBeNull()
  })

  it('clears current and legacy chat data without removing unrelated storage', () => {
    const keys = getInsightChatStorageKeys({ userId: 'u1', orgId: 'o1', cafeId: 'c1' })
    writeScopedStorage(keys.current, { scopeId: keys.scopeId, messages: [] })
    localStorage.setItem('your-guava:insights-chat:v1', '{}')
    localStorage.setItem('unrelated', 'keep')

    clearInsightChatStorage()

    expect(localStorage.getItem(keys.current)).toBeNull()
    expect(localStorage.getItem('your-guava:insights-chat:v1')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })
})
