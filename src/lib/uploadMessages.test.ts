import { describe, it, expect } from 'vitest'
import { savedMappingNotice } from './uploadMessages'

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
