/** Mirrors MAX_CHAT_HISTORY_MESSAGES and the per-message model input limit. */
export const CHAT_HISTORY_WINDOW = 10
export const CHAT_MESSAGE_MAX_CHARS = 4000

/** Keep only the trailing messages the server reads, starting on a user turn. */
export function trailingChatWindow<T extends { role: 'user' | 'assistant' }>(messages: T[], size = CHAT_HISTORY_WINDOW): T[] {
  const window = messages.slice(-size)
  const firstUser = window.findIndex((message) => message.role === 'user')
  return firstUser === -1 ? [] : window.slice(firstUser)
}
