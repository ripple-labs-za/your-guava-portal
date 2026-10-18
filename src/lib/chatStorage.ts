export interface InsightChatStorageScope {
  userId: string
  orgId: string
  cafeId: string
}

/** Mirrors the backend's trailing message count and oldest-user anchor. */
export const CHAT_HISTORY_WINDOW = 10
export function trailingChatWindow<T extends { role: 'user' | 'assistant' }>(messages: T[], size = CHAT_HISTORY_WINDOW): T[] {
  const window = messages.slice(-size)
  const firstUser = window.findIndex((message) => message.role === 'user')
  return firstUser === -1 ? [] : window.slice(firstUser)
}

const CURRENT_PREFIX = 'your-guava:insights-chat:v2:'
const LIST_PREFIX = 'your-guava:insights-chat-list:v2:'
const LEGACY_KEYS = new Set([
  'your-guava:insights-chat:v1',
  'your-guava:insights-chat-list:v1',
])

export function insightChatScopeId(scope: InsightChatStorageScope): string {
  return [scope.userId, scope.orgId, scope.cafeId].map(encodeURIComponent).join(':')
}

export function getInsightChatStorageKeys(scope: InsightChatStorageScope) {
  const id = insightChatScopeId(scope)
  return {
    scopeId: id,
    current: `${CURRENT_PREFIX}${id}`,
    list: `${LIST_PREFIX}${id}`,
  }
}

export function clearInsightChatStorage(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (
        key &&
        (LEGACY_KEYS.has(key) || key.startsWith(CURRENT_PREFIX) || key.startsWith(LIST_PREFIX))
      ) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function readScopedStorage<T>(key: string, expectedScopeId: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.scopeId !== expectedScopeId) return null
    return parsed as T
  } catch {
    return null
  }
}

export function writeScopedStorage(key: string, payload: object): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(payload))
    return true
  } catch {
    // Storage may be disabled or full. Chat remains available for this session.
    return false
  }
}
