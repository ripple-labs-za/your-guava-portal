import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY_WINDOW, trailingChatWindow } from './chatWindow'

describe('trailingChatWindow', () => {
  const turns = (count: number) => Array.from({ length: count }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `Message ${index}`,
  }))
  it.each([0, 1, 2, 10, 11, 15, 21])('matches the server window for %i turns without mutating the input', (count) => {
    const messages = turns(count)
    const before = structuredClone(messages)
    const expected = messages.slice(-10)
    while (expected.length && expected[0].role !== 'user') expected.shift()
    const window = trailingChatWindow(messages)
    expect(window).toEqual(expected)
    expect(window.length).toBeLessThanOrEqual(CHAT_HISTORY_WINDOW)
    expect(messages).toEqual(before)
  })
  it('returns no messages when the trailing window has no user turn', () => {
    expect(trailingChatWindow([{ role: 'assistant', content: 'Only an answer' }])).toEqual([])
  })
})
