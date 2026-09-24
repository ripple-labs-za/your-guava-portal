import { describe, it, expect, vi, beforeEach } from 'vitest'
import api from '@/lib/api'
import { confirmUpload } from './uploads'

vi.mock('@/lib/api', () => ({ default: { post: vi.fn(), get: vi.fn() } }))
const apiMock = api as unknown as { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }
const rejection = (status: number, data: Record<string, unknown>) => Object.assign(new Error('rejected'), { response: { status, data } })

describe('confirmUpload', () => {
  beforeEach(() => { apiMock.post.mockReset(); apiMock.get.mockReset() })

  it('offers a partial import only for SEVERE_PARTIAL_IMPORT', async () => {
    apiMock.post
      .mockRejectedValueOnce(rejection(422, { code: 'SEVERE_PARTIAL_IMPORT', details: { errors: 12, totalRows: 20 } }))
      .mockResolvedValueOnce({ data: { success: true, uploadId: 'u1', stats: { imported: 8, skipped: 0, errors: 12, totalRows: 20 } } })
    const onPartialImport = vi.fn().mockResolvedValue(true)
    const result = await confirmUpload('u1', { date: 'Date', items: 'Items', total: 'Total' }, 'packed', { onPartialImport })
    expect(onPartialImport).toHaveBeenCalledWith(12, 20)
    expect(apiMock.post).toHaveBeenLastCalledWith('/uploads/u1/confirm', expect.objectContaining({ allowPartialImport: true }), expect.anything())
    expect(result.stats.imported).toBe(8)
  })

  it('does not offer a partial import for a different 422', async () => {
    apiMock.post.mockRejectedValueOnce(rejection(422, { code: 'PARSE_LIMIT_EXCEEDED', message: 'This file took too long to read.' }))
    const onPartialImport = vi.fn()
    await expect(confirmUpload('u2', { date: 'Date', items: 'Items', total: 'Total' }, 'packed', { onPartialImport })).rejects.toBeTruthy()
    expect(onPartialImport).not.toHaveBeenCalled()
  })
})
