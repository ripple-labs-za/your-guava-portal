import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoadFailed, loadFailureReason } from './load-failed'

describe('LoadFailed', () => {
  it('names what failed, why, what did not happen, and offers a retry', async () => {
    const onRetry = vi.fn()
    render(<LoadFailed what="staff" reason="The server answered with an error (500)." reassurance="Nobody has been removed." onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load staff')
    expect(alert).toHaveTextContent('The server answered with an error (500). Nobody has been removed.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('tells an unreachable server apart from an error status', () => {
    expect(loadFailureReason(new Error('Network Error'))).toBe('Your Guava could not be reached.')
    expect(loadFailureReason({ response: { status: 500, data: { message: 'Internal Server Error' } } })).toBe('The server answered with an error (500).')
    expect(loadFailureReason({ response: { status: 403 } })).toBe('The server answered with an error (403).')
    expect(loadFailureReason(undefined)).toBe('Your Guava could not be reached.')
  })
})
