import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Route, Routes } from 'react-router'
import IntegrationCallback from './IntegrationCallback'

const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: { post: (...args: unknown[]) => mockPost(...args) },
}))

describe('IntegrationCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockReturnValue(new Promise(() => {}))
  })

  it('captures the provider response and scrubs code/state from browser history before exchange', async () => {
    window.history.replaceState(
      null,
      '',
      '/integrations/quickbooks/callback?code=secret-code&state=opaque-state&realmId=realm-1'
    )

    render(
      <BrowserRouter>
        <Routes>
          <Route path="/integrations/:provider/callback" element={<IntegrationCallback />} />
        </Routes>
      </BrowserRouter>
    )

    expect(window.location.search).toBe('')
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/integrations/quickbooks/callback', {
        code: 'secret-code',
        state: 'opaque-state',
        realmId: 'realm-1',
      })
    })
    expect(window.location.href).not.toContain('secret-code')
    expect(window.location.href).not.toContain('opaque-state')
  })

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'uat12co'])(
    'renders the literal unknown provider %s safely during exchange and preserves the server refusal', async (provider) => {
      let refuse!: (reason: unknown) => void
      mockPost.mockReturnValue(new Promise((_resolve, reject) => { refuse = reject }))
      window.history.replaceState(null, '', `/integrations/${provider}/callback?code=x&state=y`)
      render(<BrowserRouter><Routes>
        <Route path="/integrations/:provider/callback" element={<IntegrationCallback />} />
      </Routes></BrowserRouter>)
      expect(screen.getByText(`Connecting to ${provider}…`)).toBeInTheDocument()
      await waitFor(() => expect(mockPost).toHaveBeenCalledWith(`/integrations/${provider}/callback`, { code: 'x', state: 'y' }))
      refuse({ response: { status: 400, data: { message: 'Unknown provider' } } })
      expect(await screen.findByText('Unknown provider')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Back to Integrations' })).toHaveAttribute('href', '/integrations')
      expect(window.location.search).toBe('')
    }
  )

  it.each([['xero', 'Xero'], ['quickbooks', 'QuickBooks'], ['sage', 'Sage Accounting']])(
    'keeps the friendly display name for the real provider %s', (provider, display) => {
      window.history.replaceState(null, '', `/integrations/${provider}/callback?code=x&state=y`)
      render(<BrowserRouter><Routes>
        <Route path="/integrations/:provider/callback" element={<IntegrationCallback />} />
      </Routes></BrowserRouter>)
      expect(screen.getByText(`Connecting to ${display}…`)).toBeInTheDocument()
    }
  )

  it('shows the server reason when the provider account is refused, and offers the way back', async () => {
    const reason =
      'Your Xero login authorised 2 organisations. Connect again and choose only the organisation this cafe uses.'
    mockPost.mockRejectedValue({
      response: { status: 409, data: { code: 'INTEGRATION_ACCOUNT_CHOICE_REQUIRED', message: reason } },
    })
    window.history.replaceState(null, '', '/integrations/xero/callback?code=c&state=s')

    render(
      <BrowserRouter>
        <Routes>
          <Route path="/integrations/:provider/callback" element={<IntegrationCallback />} />
        </Routes>
      </BrowserRouter>
    )

    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to integrations/i })).toHaveAttribute('href', '/integrations')
  })

  it('exposes a heading for the callback refusal so it can be found by heading navigation', async () => {
    window.history.replaceState(null, '', '/integrations/xero/callback')
    render(<BrowserRouter><Routes>
      <Route path="/integrations/:provider/callback" element={<IntegrationCallback />} />
    </Routes></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Connection failed', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Integrations' })).toHaveAttribute('href', '/integrations')
    expect(mockPost).not.toHaveBeenCalled()
  })
})
