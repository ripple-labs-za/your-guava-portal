import { describe, it, expect } from 'vitest'
import { mappingAssistNotice, savedMappingNotice, skippedRowSentences } from './uploadMessages'

describe('skippedRowSentences', () => {
  it('words a reason the page has no copy for, so a later reason is never silent', () => {
    expect(skippedRowSentences({ receipt_conflict: 3 })).toEqual(['3 rows were skipped (receipt conflict).'])
  })

  it('explains duplicates the overlap sentence does not cover, and only those', () => {
    const sentences = skippedRowSentences({ duplicate: 5 }, { rows: 3, uploads: [{ uploadId: 'a', fileName: 'a.csv', rows: 3 }] })
    expect(sentences).toEqual([
      '3 sales were already in Your Guava from a.csv, so they were skipped rather than counted twice.',
      '2 rows were already imported earlier, so they were not counted twice.',
    ])
  })

  it('says nothing when nothing was skipped', () => {
    expect(skippedRowSentences({})).toEqual([])
    expect(skippedRowSentences(undefined, { rows: 0, uploads: [] })).toEqual([])
    expect(skippedRowSentences({ duplicate: 0, refund_netted: 0 })).toEqual([])
  })
})

describe('savedMappingNotice', () => {
  it('names the columns the saved mapping expected and this file lacks', () => {
    expect(savedMappingNotice({ status: 'did_not_fit', reason: 'missing_columns', missingColumns: ['Status', 'Tip'] })).toBe(
      "Your saved column mapping doesn't fit this file: it has no Status, Tip columns. Check each field before importing; " +
      'the columns you confirm become the saved mapping.'
    )
  })

  it('says the header row changed when every saved column is still there', () => {
    expect(savedMappingNotice({ status: 'did_not_fit', reason: 'headers_changed', missingColumns: [] })).toMatch(
      /columns differ from the file your saved mapping came from/i
    )
  })

  it('says the saved mapping never covered the required fields when nothing is missing', () => {
    expect(savedMappingNotice({ status: 'did_not_fit', reason: 'incomplete', missingColumns: [] })).toMatch(
      /does not say which columns hold every required field/i
    )
  })

  it('says nothing when the saved mapping applied or there is none', () => {
    expect(savedMappingNotice({ status: 'applied', missingColumns: [] })).toBeNull()
    expect(savedMappingNotice({ status: 'none', missingColumns: [] })).toBeNull()
    expect(savedMappingNotice(undefined)).toBeNull()
  })
})

describe('mappingAssistNotice', () => {
  it('reports the credits an AI mapping used', () => {
    expect(mappingAssistNotice({ mappingAssistedByAi: true, mappingCreditsUsed: 10 }))
      .toMatch(/used 10 Guava Credits/)
  })

  it('tells the owner why AI did not map the file and that nothing was charged', () => {
    expect(mappingAssistNotice({ mappingAssistedByAi: false, mappingAiUnavailableReason: 'insufficient_credits' }))
      .toMatch(/needs 10 Guava Credits.*Nothing was charged/)
    expect(mappingAssistNotice({ mappingAssistedByAi: false, mappingAiUnavailableReason: 'rate_limited' }))
      .toMatch(/paused for a minute.*Nothing was charged/)
    expect(mappingAssistNotice({ mappingAssistedByAi: false, mappingAiUnavailableReason: 'sensitive_headers' }))
      .toMatch(/customer data/)
  })

  it('says nothing when there is nothing to say', () => {
    expect(mappingAssistNotice({ mappingAssistedByAi: false, mappingAiUnavailableReason: null })).toBeNull()
  })
})
