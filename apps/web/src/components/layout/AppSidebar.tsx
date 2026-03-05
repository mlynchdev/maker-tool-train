import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldAlert,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { logout } from '~/server/api/auth'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useShellContext } from '~/components/layout/ShellContext'

interface SidebarLink {
  title: string
  to: string
  icon: LucideIcon
  badge?: number
  search?: Record<string, string>
}

interface AppSidebarProps {
  mobile?: boolean
  onNavigate?: () => void
  onClose?: () => void
}

function normalizePath(pathname: string) {
  if (pathname !== '/' && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

export function AppSidebar({ mobile = false, onNavigate, onClose }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, badges } = useShellContext()

  const isManagerOrAdmin = user.role === 'manager' || user.role === 'admin'
  const isAdmin = user.role === 'admin'

  const workspaceLinks: SidebarLink[] = [
    {
      title: 'Command Center',
      to: '/',
      icon: LayoutDashboard,
    },
    {
      title: 'Training',
      to: '/training',
      icon: BookOpenCheck,
    },
    {
      title: 'Machines',
      to: '/machines',
      icon: Wrench,
    },
    {
      title: 'Reservations',
      to: '/reservations',
      icon: CalendarClock,
      badge: badges.activeReservationCount,
    },
  ]

  const managementLinks: SidebarLink[] = []

  if (isManagerOrAdmin) {
    managementLinks.push(
      {
        title: 'Machines Admin',
        to: '/admin/machines',
        icon: Wrench,
      },
      {
        title: 'Users',
        to: '/admin/users',
        icon: Users,
      }
    )
  }

  if (isAdmin) {
    managementLinks.push(
      {
        title: 'Checkout Queue',
        to: '/admin/checkouts',
        icon: ClipboardCheck,
        badge: badges.pendingCheckoutCount,
      },
      {
        title: 'Booking Requests',
        to: '/admin/booking-requests',
        icon: ShieldAlert,
        badge: badges.pendingRequestCount,
        search: { view: 'pending', q: '' },
      },
      {
        title: 'Training Admin',
        to: '/admin/training',
        icon: BookOpenCheck,
      },
      {
        title: 'Settings',
        to: '/admin/settings',
        icon: Settings,
      }
    )
  }

  const handleLogout = async () => {
    await logout()
    navigate({ to: '/' })
  }

  const currentPath = normalizePath(location.pathname)

  const isLinkActive = (to: string) => {
    const target = normalizePath(to)

    if (target === '/') {
      return currentPath === '/'
    }

    return currentPath === target || currentPath.startsWith(`${target}/`)
  }

  const renderLink = (link: SidebarLink) => {
    const active = isLinkActive(link.to)

    return (
      <Link
        key={link.title}
        to={link.to as never}
        search={link.search as never}
        onClick={onNavigate}
        className={cn(
          'group flex items-center justify-between rounded-lg border-l-2 px-2.5 py-2 text-sm transition-colors',
          active
            ? 'border-l-primary bg-primary/10 text-primary'
            : 'border-l-transparent text-muted-foreground hover:border-l-primary/45 hover:bg-accent/35 hover:text-foreground'
        )}
      >
        <span className="flex items-center gap-2">
          <link.icon className={cn('h-4 w-4 transition-colors', active ? 'text-primary' : 'text-current/85')} />
          <span
            className={cn(
              'font-medium decoration-2 underline-offset-4 transition-colors',
              active && 'font-semibold underline decoration-primary/70'
            )}
          >
            {link.title}
          </span>
        </span>
        {typeof link.badge === 'number' && link.badge > 0 && (
          <Badge variant="warning" className="min-w-5 justify-center px-1.5 py-0 text-[11px]">
            {link.badge}
          </Badge>
        )}
      </Link>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Control Deck</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">SBHX Training</h2>
            <p className="mt-1 text-xs text-muted-foreground">{user.name || user.email}</p>
          </div>
          {mobile && onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <section>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </p>
          <div className="mt-2 space-y-1">{workspaceLinks.map(renderLink)}</div>
        </section>

        {managementLinks.length > 0 && (
          <section>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Management
            </p>
            <div className="mt-2 space-y-1">{managementLinks.map(renderLink)}</div>
          </section>
        )}
      </div>

      <div className="border-t px-3 py-3">
        <Button variant="outline" className="w-full justify-start" onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}
