import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from './App'

const mockAuth: { user: null; isLoading: boolean; bootstrapError: null; signedOut: boolean } = {
  user: null,
  isLoading: false,
  bootstrapError: null,
  signedOut: false,
}

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }))

function LoginProbe() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p data-testid="from">{from ?? 'none'}</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/settings" element={<ProtectedRoute><p>Settings</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  it('sends a signed-out visitor to sign in with the page they asked for', () => {
    mockAuth.signedOut = false
    renderAt('/settings?section=billing')
    expect(screen.getByTestId('from')).toHaveTextContent('/settings?section=billing')
  })

  // UAT-14-S20: after Sign Out the next sign-in, perhaps someone else's, landed on the page the last person left.
  it('carries no return page after a deliberate sign-out', () => {
    mockAuth.signedOut = true
    renderAt('/settings?section=billing')
    expect(screen.getByTestId('from')).toHaveTextContent('none')
  })
})
