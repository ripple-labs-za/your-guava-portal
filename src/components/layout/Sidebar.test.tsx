import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthContext } from '@/contexts/AuthContext'
import { Sidebar } from './Sidebar'
import api from '@/lib/api'
import type { ComponentProps, ReactNode } from 'react'

vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
  },
}))

function renderSidebar(path: string, props: ComponentProps<typeof Sidebar> = {}, userOptions: { cafeIds?: string[]; activeCafeId?: string } = {}) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: 'Test Owner',
    role: 'owner' as const,
    orgId: 'org123',
    cafeIds: ['cafe123'],
    activeCafeId: 'cafe123',
    ...userOptions,
  }

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          user,
          isLoading: false,
          isOwner: true,
          login: vi.fn(),
          logout: vi.fn(),
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        {children}
      </AuthContext.Provider>
    </MemoryRouter>
  )

  return render(<Sidebar {...props} />, { wrapper })
}

// jsdom has no matchMedia; pretend the viewport is, or is not, at the xl breakpoint.
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function expectActive(label: string) {
  expect(screen.getByRole('link', { name: label }).className).toContain('bg-guava-red/10')
}

function expectInactive(label: string) {
  expect(screen.getByRole('link', { name: label }).className).not.toContain('bg-guava-red/10')
}

describe('Sidebar', () => {
  it('does not reload cafes for a profile-only user object change but follows cafe context changes', async () => {
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: { cafe: { name: 'One Cafe' }, cafes: [] } }))
    const user = { id: 'u1', email: 'owner@example.com', name: 'Owner', role: 'owner' as const,
      orgId: 'org1', cafeIds: ['c1'], activeCafeId: 'c1' }
    const shell = (current: typeof user) => <MemoryRouter><AuthContext.Provider value={{ user: current,
      isLoading: false, isOwner: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), switchCafe: vi.fn(),
    }}><Sidebar /></AuthContext.Provider></MemoryRouter>
    const view = render(shell(user))
    await screen.findByText('One Cafe')
    const initialCalls = vi.mocked(api.get).mock.calls.length
    view.rerender(shell({ ...user, name: 'Updated name' }))
    await waitFor(() => expect(screen.getByText('One Cafe')).toBeInTheDocument())
    expect(api.get).toHaveBeenCalledTimes(initialCalls)
    view.rerender(shell({ ...user, activeCafeId: 'c2', cafeIds: ['c1', 'c2'] }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/cafe/list'))
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/cafe/me')).toHaveLength(2)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}))
  })

  it.each([true, false])('Escape closes only the cafe list and returns focus to its opener (desktop=%s)', async (desktop) => {
    stubMatchMedia(desktop)
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/cafe/me'
      ? { cafe: { name: 'Active Cafe' } }
      : { cafes: [{ _id: 'cafe123', name: 'Active Cafe' }, { _id: 'cafe456', name: 'Other Cafe' }] } }))
    renderSidebar('/planning', { isOpen: true, onClose }, { cafeIds: ['cafe123', 'cafe456'] })
    const opener = screen.getByRole('button', { name: 'Switch active cafe' })
    await user.click(opener)
    const other = await screen.findByRole('button', { name: 'Other Cafe' })
    other.focus()
    await user.keyboard('{Escape}')
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(opener).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Other Cafe' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(opener).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    if (!desktop) {
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    }
  })

  it.each([['cafe123'], ['cafe123', 'cafe456']])('names the active cafe from allowed metadata when billing blocks its detail (%j)', async (...cafeIds) => {
    vi.mocked(api.get).mockImplementation((url) => url === '/cafe/me'
      ? Promise.reject({ response: { status: 402, data: { code: 'BILLING_REQUIRED' } } })
      : Promise.resolve({ data: { cafes: [{ _id: 'cafe456', name: 'Other Cafe' }, { _id: 'cafe123', name: 'Active Cafe' }] } }))
    renderSidebar('/team', {}, { cafeIds })
    expect((await screen.findAllByText('Active Cafe')).length).toBeGreaterThan(0)
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/cafe/list')
  })

  it('does not guess the active cafe from another metadata row', async () => {
    vi.mocked(api.get).mockImplementation((url) => url === '/cafe/me'
      ? Promise.reject({ response: { status: 402 } })
      : Promise.resolve({ data: { cafes: [{ _id: 'cafe456', name: 'Other Cafe' }] } }))
    renderSidebar('/team')
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/cafe/list'))
    expect(screen.queryByText('Other Cafe')).not.toBeInTheDocument()
  })

  it.each([401, 403, 500])('does not use the billing metadata fallback for another detail refusal (%s)', async (status) => {
    vi.mocked(api.get).mockRejectedValue({ response: { status } })
    renderSidebar('/team')
    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledWith('/cafe/me'))
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith('/cafe/list')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not highlight Planning when Forecast Factors is selected', () => {
    renderSidebar('/planning/factors')

    expectActive('Factors')
    expectInactive('Planning')
  })

  it.each([
    ['/dashboard', 'Today'], ['/forecasts', 'Planning'], ['/factors', 'Factors'],
    ['/analytics', 'Performance'], ['/insights', 'Ask Guava'], ['/connect', 'Data Health'],
    ['/menu-items', 'Menu Items'], ['/settings', 'Settings'],
  ])('marks exactly the canonical sidebar link current at %s', (path, label) => {
    renderSidebar(path)
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current).toEqual([screen.getByRole('link', { name: label })])
  })

  it('does not highlight Data Health when Menu Items is selected', () => {
    renderSidebar('/data-health/menu-items')

    expectActive('Menu Items')
    expectInactive('Data Health')
  })

  it('highlights only History on the history page', () => {
    renderSidebar('/history')

    expectActive('History')
    expectInactive('Performance')
    expectInactive('Ask Guava')
  })

  it('uses one Settings entry for setup and keeps old account route active', () => {
    renderSidebar('/account')

    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument()
    expectActive('Settings')
  })

  it('highlights Improvements on the improvements page', () => {
    renderSidebar('/improvements')

    expectActive('Improvements')
    expectInactive('Settings')
  })

  it('hides unfinished workforce navigation when the feature flag is off', () => {
    renderSidebar('/today')

    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Roster' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Leave' })).not.toBeInTheDocument()
  })

  it('keeps the closed drawer out of the tab order and accessibility tree below xl', () => {
    stubMatchMedia(false)

    const { container } = renderSidebar('/today', { isOpen: false })

    const drawer = container.querySelector('nav')
    expect(drawer).toHaveAttribute('inert')
    expect(drawer).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes the drawer again once it is opened below xl', () => {
    stubMatchMedia(false)

    const { container } = renderSidebar('/today', { isOpen: true })

    const drawer = container.querySelector('nav')
    expect(drawer).not.toHaveAttribute('inert')
    expect(drawer).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument()
  })

  it('is a single navigation landmark with an accessible name', () => {
    renderSidebar('/today')

    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('moves focus into the drawer when it opens below xl', () => {
    stubMatchMedia(false)

    renderSidebar('/today', { isOpen: true })

    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  })

  it('does not grab focus for the always-visible sidebar at xl and above', () => {
    stubMatchMedia(true)

    renderSidebar('/today', { isOpen: true })

    expect(document.body).toHaveFocus()
  })

  it('never hides the always-visible sidebar at xl and above', () => {
    stubMatchMedia(true)

    const { container } = renderSidebar('/today', { isOpen: false })

    expect(container.querySelector('nav')).not.toHaveAttribute('inert')
    expect(container.querySelector('nav')).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument()
  })
})
