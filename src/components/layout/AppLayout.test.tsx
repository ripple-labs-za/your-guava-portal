import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AuthContext } from '@/contexts/AuthContext'
import { AppLayout, MAIN_CONTENT_ID, RouteFocusContext } from './AppLayout'

vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
  },
}))

const authValue = {
  user: {
    id: 'user123',
    email: 'owner@yourguava.com',
    name: 'Test Owner',
    role: 'owner' as const,
    orgId: 'org123',
    cafeIds: ['cafe123'],
    activeCafeId: 'cafe123',
  },
  isLoading: false,
  isOwner: true,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  switchCafe: vi.fn(),
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

interface RenderOptions {
  title?: ReactNode
  children?: ReactNode
  shouldFocusMain?: boolean
  announcePage?: (title: string) => void
}

function renderLayout({
  title = 'Today',
  children = <p>Body copy</p>,
  shouldFocusMain = false,
  announcePage = vi.fn(),
}: RenderOptions = {}) {
  const result = render(
    <MemoryRouter initialEntries={['/today']}>
      <AuthContext.Provider value={authValue}>
        <RouteFocusContext.Provider value={{ shouldFocusMain, announcePage }}>
          <AppLayout title={title}>{children}</AppLayout>
        </RouteFocusContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )

  return { ...result, announcePage }
}

describe('AppLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the visible page title as the only level-one heading', () => {
    renderLayout({ title: 'Data Health' })

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Data Health')
  })

  it('keeps the title a single h1 when a page passes rich title content', () => {
    renderLayout({
      title: (
        <>
          <span>Ask Guava</span>
          <span aria-hidden="true">*</span>
        </>
      ),
    })

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Ask Guava')
  })

  it('announces the full Data Health title and retains skip focus with enlarged title content', async () => {
    const user = userEvent.setup()
    const announcePage = vi.fn()
    renderLayout({ title: <span>Data Health</span>, shouldFocusMain: true, announcePage })
    expect(screen.getByRole('heading', { level: 1, name: 'Data Health' })).toBeVisible()
    expect(announcePage).toHaveBeenCalledWith('Data Health')
    await user.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(screen.getByRole('main', { name: 'Data Health' })).toHaveFocus()
  })

  it('puts a skip link first in the tab order, aimed at the main region', () => {
    const { container } = renderLayout()

    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    expect(focusable[0]).toHaveTextContent('Skip to content')
    expect(focusable[0]).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
  })

  it('hides the skip link until it is focused', () => {
    renderLayout()

    const skipLink = screen.getByRole('link', { name: /skip to content/i })
    expect(skipLink.className).toContain('sr-only')
    expect(skipLink.className).toContain('focus:not-sr-only')
  })

  it('moves focus into the main region when the skip link is used', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('link', { name: /skip to content/i }))

    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('gives the main region the skip target id and makes it a focus target', () => {
    renderLayout({ title: 'Planning' })

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID)
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(main).toHaveAccessibleName('Planning')
  })

  it('exposes exactly one main and one banner landmark, with a named navigation', () => {
    renderLayout()

    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })

  it('leaves focus alone on the first paint', () => {
    renderLayout({ shouldFocusMain: false })

    expect(document.body).toHaveFocus()
  })

  it('moves focus to the main region and announces the page after a route change', () => {
    const announcePage = vi.fn()
    renderLayout({ title: 'Performance', shouldFocusMain: true, announcePage })

    expect(screen.getByRole('main')).toHaveFocus()
    expect(announcePage).toHaveBeenCalledWith('Performance')
  })

  it('returns focus to the menu button when the drawer is closed', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()

    const menuButton = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(menuButton)
    await user.click(screen.getByRole('button', { name: 'Close navigation' }))

    expect(menuButton).toHaveFocus()
  })

  it('moves focus into the drawer when the menu button opens it', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus()
  })

  it('keeps twenty forward Tab presses inside an open phone navigation drawer', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout({ children: <button>Background action</button> })
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('navigation', { name: 'Main' })
    const escaped: number[] = []
    for (let index = 0; index < 20; index += 1) {
      await user.tab()
      if (!drawer.contains(document.activeElement)) escaped.push(index + 1)
    }
    expect(escaped).toEqual([])
  })

  it('wraps Shift-Tab from Close to the last navigation control', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus()
  })

  it('closes phone navigation on Escape and returns focus to its opener', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()
    const opener = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(opener).toHaveFocus()
    expect(document.getElementById('app-sidebar')).toHaveAttribute('inert')
  })

  it('tells assistive tech whether the drawer is open', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    renderLayout()

    const menuButton = screen.getByRole('button', { name: 'Open navigation' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')

    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  })
})
