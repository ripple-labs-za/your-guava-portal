import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router'
import { Menu } from 'lucide-react'
import { Sidebar, SIDEBAR_ID } from './Sidebar'
import { TopToolbar } from './TopToolbar'

/** Skip-link target and the id every page's main region carries. */
export const MAIN_CONTENT_ID = 'main-content'
/** The single `<h1>` per screen, also the accessible name of `<main>`. */
export const PAGE_TITLE_ID = 'app-page-title'

export interface RouteFocusContextValue {
  /**
   * True once the app has navigated at least once. The shell only takes focus
   * when this is set, so a cold page load leaves the user where they landed.
   */
  shouldFocusMain: boolean
  /** Publishes the new page title to the app's persistent polite live region. */
  announcePage: (title: string) => void
}

/**
 * Supplied by `RouteFocusProvider` in `App.tsx`. The inert default keeps
 * AppLayout usable on its own (page tests, storybook-style renders) without
 * hijacking focus.
 */
export const RouteFocusContext = createContext<RouteFocusContextValue>({
  shouldFocusMain: false,
  announcePage: () => {},
})

interface AppLayoutProps {
  children: ReactNode
  title?: ReactNode
}

export function AppLayout({ children, title }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const mainRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const { shouldFocusMain, announcePage } = useContext(RouteFocusContext)
  const { pathname } = useLocation()

  // A client-side route change leaves focus on whatever was clicked - usually a
  // sidebar link - so a screen reader is never told the page changed and the
  // next Tab carries on through the navigation. Move focus to the main region
  // and announce its title instead. `shouldFocusMain` stays false until the
  // first real navigation, so the initial paint is untouched.
  useEffect(() => {
    if (!shouldFocusMain) return
    mainRef.current?.focus()
    const pageTitle = headingRef.current?.textContent?.trim()
    if (pageTitle) announcePage(pageTitle)
  }, [shouldFocusMain, pathname, announcePage])

  // Fragment navigation alone does not move focus in every browser, and it
  // leaves a stray hash behind, so drive the skip link from script.
  const focusMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    mainRef.current?.focus()
  }

  const closeSidebar = () => {
    if (!sidebarOpen) return
    setSidebarOpen(false)
    // Without this the drawer's focused control is destroyed and focus falls
    // back to <body>, stranding keyboard users at the top of the document.
    menuButtonRef.current?.focus()
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F]">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        onClick={focusMain}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-60 focus:rounded-lg focus:border focus:border-guava-red/50 focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-text focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-guava-red"
      >
        Skip to content
      </a>

      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      <div className="xl:ml-60 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 min-h-12.25 flex items-center justify-between gap-3 px-4 py-2 xl:px-8 bg-[#0F0F0F]/90 backdrop-blur-sm border-b border-border shrink-0">
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="xl:hidden text-muted hover:text-text p-1.5 -ml-1.5"
              aria-label="Open navigation"
              aria-controls={SIDEBAR_ID}
              aria-expanded={sidebarOpen}
            >
              <Menu className="w-5 h-5" />
            </button>
            {title && (
              <h1
                ref={headingRef}
                id={PAGE_TITLE_ID}
                className="text-text text-lg xl:text-xl font-semibold tracking-tight flex min-w-0 flex-wrap items-center gap-2 whitespace-normal wrap-break-word"
              >
                {title}
              </h1>
            )}
          </div>
          <TopToolbar />
        </header>

        {/* Main Content */}
        <main
          ref={mainRef}
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          aria-labelledby={title ? PAGE_TITLE_ID : undefined}
          className="flex-1 p-4 xl:p-8 overflow-y-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
