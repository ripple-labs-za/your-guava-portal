import { useState, useEffect, useRef, type ComponentType, type KeyboardEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import {
  LayoutDashboard,
  TrendingUp,
  Upload,
  Sparkles,
  Settings,
  LogOut,
  X,
  Users,
  ChevronDown,
  Store,
  BarChart3,
  Cable,
  Coffee,
  SlidersHorizontal,
  History,
  Lightbulb,
  UserCircle,
  CalendarDays,
  CalendarOff,
} from 'lucide-react'
import guavaIcon from '@/assets/guava-icon.png'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { WORKFORCE_ENABLED } from '@/lib/features'
import { useMediaQuery } from '@/hooks/useMediaQuery'

interface NavItem {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  activePaths?: { path: string; exact?: boolean }[]
  exact?: boolean
  badge?: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Operate',
    items: [
      { label: 'Today', to: '/today', icon: LayoutDashboard, exact: true, activePaths: [{ path: '/dashboard', exact: true }] },
      { label: 'Planning', to: '/planning', icon: TrendingUp, exact: true, activePaths: [{ path: '/forecasts', exact: true }] },
      { label: 'Factors', to: '/planning/factors', icon: SlidersHorizontal, activePaths: [{ path: '/factors', exact: true }] },
    ],
  },
  {
    label: 'Learn',
    items: [
      { label: 'Performance', to: '/performance', icon: BarChart3, exact: true, activePaths: [{ path: '/analytics', exact: true }] },
      { label: 'History', to: '/history', icon: History, exact: true },
      { label: 'Ask Guava', to: '/ask-guava', icon: Sparkles, exact: true, activePaths: [{ path: '/insights', exact: true }] },
    ],
  },
  {
    label: 'Data',
    items: [
      {
        label: 'Data Health',
        to: '/data-health',
        icon: Upload,
        exact: true,
        activePaths: [{ path: '/connect', exact: true }, { path: '/uploads' }],
      },
      { label: 'Menu Items', to: '/data-health/menu-items', icon: Coffee, exact: true, activePaths: [{ path: '/menu-items', exact: true }] },
      { label: 'Integrations', to: '/integrations', icon: Cable, badge: 'Soon' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Improvements', to: '/improvements', icon: Lightbulb, exact: true },
      { label: 'Settings', to: '/settings', icon: Settings, exact: true, activePaths: [{ path: '/account', exact: true }] },
    ],
  },
  ...(WORKFORCE_ENABLED
    ? [{
        label: 'Workforce',
        items: [
          { label: 'Staff', to: '/staff', icon: UserCircle, exact: true },
          { label: 'Roster', to: '/roster', icon: CalendarDays, exact: true },
          { label: 'Leave', to: '/leave', icon: CalendarOff, exact: true },
        ],
      }]
    : []),
]

// Tailwind's `xl` breakpoint: from here the drawer is a fixed, always-visible sidebar.
const DESKTOP_SIDEBAR_QUERY = '(min-width: 80rem)'

/** Lets the top bar's menu button point `aria-controls` at the drawer. */
export const SIDEBAR_ID = 'app-sidebar'

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
}

interface CafeOption {
  _id: string
  name: string
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout, switchCafe, isOwner } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [cafeName, setCafeName] = useState('')
  const [cafeList, setCafeList] = useState<CafeOption[]>([])
  const [switcherOpen, setSwitcherOpen] = useState(false)
  // Below xl the closed drawer only slides off-canvas, which hides it from
  // sight alone: its links, cafe switcher and Sign Out stayed in the tab order
  // and the accessibility tree. When the viewport cannot be queried, assume the
  // always-visible layout so nothing is ever wrongly hidden.
  const isDesktop = useMediaQuery(DESKTOP_SIDEBAR_QUERY, true)
  const isDrawerHidden = !isDesktop && !isOpen
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  // The drawer sits before the top bar in the DOM, so a keyboard user who opens
  // it would otherwise Tab away from it rather than into it.
  useEffect(() => {
    const justOpened = !!isOpen && !wasOpenRef.current
    wasOpenRef.current = !!isOpen
    if (justOpened && !isDesktop) closeButtonRef.current?.focus()
  }, [isOpen, isDesktop])

  useEffect(() => {
    if (!user) return
    api.get('/cafe/me').then(({ data }) => {
      setCafeName(data?.cafe?.name || '')
    }).catch(() => {})

    if (user.cafeIds && user.cafeIds.length > 1) {
      api.get<{ success: boolean; cafes: CafeOption[] }>('/cafe/list').then(({ data }) => {
        setCafeList(data.cafes || [])
      }).catch(() => {})
    }
  }, [user])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleNavClick = () => {
    onClose?.()
  }

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isDesktop || !isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(navRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button,input,select,textarea,[tabindex]'
    ) ?? []).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled')
      && !el.closest('[hidden],[inert],[aria-hidden="true"]')
      && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
    const first = controls[0], last = controls[controls.length - 1]
    if (!first || !last) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const isPathActive = (path: string, exact?: boolean) => {
    if (exact) return location.pathname === path
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }

  const isItemActive = (item: NavItem) => {
    const paths = [{ path: item.to, exact: item.exact }, ...(item.activePaths ?? [])]
    return paths.some(({ path, exact }) => isPathActive(path, exact))
  }

  const visibleSections: NavSection[] = navSections.map((section) => {
    if (section.label !== 'Setup' || !isOwner) return section
    return {
      ...section,
      items: [
        { label: 'Team', to: '/team', icon: Users, exact: true },
        ...section.items,
      ],
    }
  })

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 xl:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <nav
        ref={navRef}
        id={SIDEBAR_ID}
        onKeyDown={handleDrawerKeyDown}
        aria-label="Main"
        inert={isDrawerHidden}
        aria-hidden={isDrawerHidden || undefined}
        className={cn(
          'fixed left-0 top-0 h-full w-60 bg-[#111111] border-r border-border flex flex-col z-50 transition-transform duration-200',
          'max-xl:-translate-x-full',
          isOpen && 'max-xl:translate-x-0',
          'xl:translate-x-0'
        )}
      >
        <div className="h-12.25 px-4 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={guavaIcon} alt="" className="w-8 h-8 object-contain shrink-0" />
            <div>
              <div style={{ fontFamily: "'Fredoka', sans-serif" }} className="leading-none">
                <span className="text-[#6B8E3A] text-base font-bold">Your</span>{' '}
                <span className="text-guava-red-text text-base font-bold">Guava</span>
              </div>
              <p className="text-[#999999] text-[10px] leading-tight mt-0.5">{cafeName || ''}</p>
            </div>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="xl:hidden text-muted hover:text-text p-1" aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        </div>

        {user && user.cafeIds && user.cafeIds.length > 1 && (
          <div className="px-3 pt-3 pb-1">
            <div className="relative">
              <button
                onClick={() => setSwitcherOpen(!switcherOpen)}
                aria-expanded={switcherOpen}
                aria-haspopup="listbox"
                aria-label="Switch active cafe"
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text hover:border-[#3A3A3A] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Store className="w-3.5 h-3.5 shrink-0 text-muted" />
                  <span className="truncate">{cafeName || 'Select cafe'}</span>
                </div>
                <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 text-muted transition-transform', switcherOpen && 'rotate-180')} />
              </button>
              {switcherOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                  {cafeList.map((cafe) => (
                    <button
                      key={cafe._id}
                      onClick={() => {
                        setSwitcherOpen(false)
                        if (cafe._id !== user.activeCafeId) {
                          switchCafe(cafe._id)
                        }
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm transition-colors',
                        cafe._id === user.activeCafeId
                          ? 'bg-guava-red/10 text-guava-red-text'
                          : 'text-muted hover:bg-white/5 hover:text-text'
                      )}
                    >
                      {cafe.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* The <nav> landmark is the drawer itself, so the link list is a plain
            container: one named navigation landmark instead of two unnamed ones. */}
        <div className="flex-1 px-3 py-4 overflow-y-auto">
          {visibleSections.map((section) => (
            <div key={section.label} className="mb-3 last:mb-0">
              <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const { label, to, icon: Icon, badge } = item
                  const active = isItemActive(item)

                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={item.exact}
                      onClick={handleNavClick}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group relative',
                        active
                          ? 'bg-guava-red/10 text-guava-red-text border-l-2 border-guava-red pl-2.5'
                          : 'text-muted hover:text-text hover:bg-white/5 border-l-2 border-transparent'
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-4 h-4 shrink-0',
                          active ? 'text-guava-red-text' : 'text-muted group-hover:text-text'
                        )}
                      />
                      <span>{label}</span>
                      {badge && (
                        <span className="ml-auto rounded-full border border-border bg-[#1B1B1B] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#9E9E9E]">
                          {badge}
                        </span>
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-3 pb-4 pt-3 border-t border-border">
          <div className="px-3 py-2 mb-1">
            <p className="text-text text-sm font-medium truncate">{user?.name ?? '-'}</p>
            <p className="text-muted text-xs truncate">{user?.email ?? '-'}</p>
          </div>
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-text hover:bg-white/5 transition-colors group"
          >
            <LogOut className="w-4 h-4 shrink-0 group-hover:text-red-400 transition-colors" />
            <span>Sign Out</span>
          </button>
        </div>
      </nav>
    </>
  )
}
