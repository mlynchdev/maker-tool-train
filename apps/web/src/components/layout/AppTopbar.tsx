import { Bell, ClipboardCheck, Menu, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useShellContext } from '~/components/layout/ShellContext'

interface AppTopbarProps {
  pathname: string
  onOpenSidebar: () => void
}

interface TopbarMeta {
  title: string
  subtitle: string
}

function normalizePath(pathname: string) {
  if (pathname !== '/' && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

function getTopbarMeta(pathname: string): TopbarMeta {
  const normalizedPath = normalizePath(pathname)

  if (normalizedPath === '/') {
    return {
      title: 'Command Center',
      subtitle: 'Operational overview for training, reservations, and approvals.',
    }
  }

  if (normalizedPath === '/training') {
    return {
      title: 'Training',
      subtitle: 'Track module progress, completion, and next steps.',
    }
  }

  if (normalizedPath.startsWith('/training/')) {
    return {
      title: 'Training Module',
      subtitle: 'Watch, review, and complete this module.',
    }
  }

  if (normalizedPath === '/machines') {
    return {
      title: 'Machines',
      subtitle: 'Review machine readiness and reservation options.',
    }
  }

  if (normalizedPath.endsWith('/reserve')) {
    return {
      title: 'Reserve Machine',
      subtitle: 'Choose time slots and submit reservation requests.',
    }
  }

  if (normalizedPath.startsWith('/machines/')) {
    return {
      title: 'Machine Details',
      subtitle: 'Read requirements, eligibility, and upcoming availability.',
    }
  }

  if (normalizedPath === '/reservations') {
    return {
      title: 'My Reservations',
      subtitle: 'Manage active bookings and review reservation history.',
    }
  }

  if (normalizedPath === '/admin/checkouts') {
    return {
      title: 'Checkout Management',
      subtitle: 'Review pending requests, finalize accepted meetings, and manage availability.',
    }
  }

  if (normalizedPath.startsWith('/admin/checkouts/')) {
    return {
      title: 'Member Checkout Review',
      subtitle: 'Audit eligibility and grant or revoke machine checkout access.',
    }
  }

  if (normalizedPath === '/admin/booking-requests') {
    return {
      title: 'Booking Requests',
      subtitle: 'Moderate pending machine reservation requests.',
    }
  }

  if (normalizedPath === '/admin/machines') {
    return {
      title: 'Machine Administration',
      subtitle: 'Configure active machines, requirements, and metadata.',
    }
  }

  if (normalizedPath.startsWith('/admin/machines/')) {
    return {
      title: 'Edit Machine',
      subtitle: 'Update machine details and training constraints.',
    }
  }

  if (normalizedPath === '/admin/users') {
    return {
      title: 'User Management',
      subtitle: 'Adjust member status, roles, and checkout permissions.',
    }
  }

  if (normalizedPath === '/admin/training') {
    return {
      title: 'Training Administration',
      subtitle: 'Maintain modules, videos, and machine requirements.',
    }
  }

  if (normalizedPath === '/admin/settings') {
    return {
      title: 'Settings',
      subtitle: 'Control system-wide operational defaults.',
    }
  }

  return {
    title: 'Workspace',
    subtitle: 'Training and reservation operations.',
  }
}

export function AppTopbar({ pathname, onOpenSidebar }: AppTopbarProps) {
  const { user, badges, refreshing, lastRefreshedAt, refreshBadges } = useShellContext()
  const meta = getTopbarMeta(pathname)

  const isAdmin = user.role === 'admin'

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            onClick={onOpenSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight md:text-xl">{meta.title}</h1>
            <p className="truncate text-xs text-muted-foreground">{meta.subtitle}</p>
          </div>
        </div>

        <div className="hidden min-w-[260px] flex-1 justify-center xl:flex">
          <div className="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border bg-card/70 px-3 text-sm text-muted-foreground">
            <Search className="h-4 w-4" />
            <span>Command bar coming soon</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {badges.unreadNotifications > 0 && (
            <Badge variant="warning" className="hidden sm:inline-flex">
              <Bell className="mr-1 h-3.5 w-3.5" />
              {badges.unreadNotifications}
            </Badge>
          )}

          {isAdmin && badges.pendingCheckoutCount > 0 && (
            <Badge variant="warning" className="hidden md:inline-flex">
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
              {badges.pendingCheckoutCount}
            </Badge>
          )}

          {isAdmin && badges.pendingRequestCount > 0 && (
            <Badge variant="warning" className="hidden md:inline-flex">
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              {badges.pendingRequestCount}
            </Badge>
          )}

          <Button size="sm" variant="outline" onClick={refreshBadges} disabled={refreshing}>
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="border-t px-4 py-2 text-[11px] text-muted-foreground md:px-6">
        Badge sync {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString() : 'pending'}
      </div>
    </header>
  )
}
