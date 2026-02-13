import { Link, useNavigate } from '@tanstack/react-router'
import { Bell, LogOut, Menu, X } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import type { AuthUser } from '~/server/auth/types'
import { logout } from '~/server/api/auth'
import { getMyUnreadNotificationCount } from '~/server/api/notifications'
import {
  getPendingCheckoutCount,
  getPendingReservationRequestCount,
} from '~/server/api/admin'
import { parseSSEMessage } from '~/lib/sse'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

interface HeaderProps {
  user: AuthUser
}

interface NavLinkConfig {
  to: string
  label: string
  badgeCount?: number
  search?: Record<string, string>
}

interface HeaderNavLinkProps extends NavLinkConfig {
  mobile?: boolean
  onNavigate?: () => void
}

function HeaderNavLink({
  to,
  label,
  badgeCount = 0,
  search,
  mobile = false,
  onNavigate,
}: HeaderNavLinkProps) {
  return (
    <Link
      to={to as never}
      search={search as never}
      onClick={onNavigate}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
        mobile
          ? 'w-full justify-between text-foreground'
          : 'border border-transparent text-muted-foreground hover:border-border hover:text-foreground'
      )}
    >
      <span>{label}</span>
      {badgeCount > 0 && (
        <Badge variant="warning" className="min-w-5 justify-center px-1.5 py-0 text-[11px]">
          {badgeCount}
        </Badge>
      )}
    </Link>
  )
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState(0)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  const refreshBadgeData = useCallback(async () => {
    if (user.role === 'manager' || user.role === 'admin') {
      const checkout = await getPendingCheckoutCount()
      setPendingCheckoutCount(checkout.count)
    } else {
      setPendingCheckoutCount(0)
    }

    if (user.role === 'admin') {
      const requests = await getPendingReservationRequestCount()
      setPendingRequestCount(requests.count)
    } else {
      setPendingRequestCount(0)
    }

    const notifications = await getMyUnreadNotificationCount()
    setUnreadNotifications(notifications.count)
  }, [user.role])

  useEffect(() => {
    refreshBadgeData()
  }, [refreshBadgeData])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/sse/bookings')

    source.onmessage = (event) => {
      const message = parseSSEMessage(event.data)
      if (!message) return

      if (message.type === 'connected') return

      if (
        message.event === 'notification' ||
        message.event === 'checkout' ||
        message.event === 'booking'
      ) {
        refreshBadgeData()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [refreshBadgeData])

  const handleLogout = async () => {
    await logout()
    navigate({ to: '/' })
  }

  const closeMobileMenu = () => setMobileMenuOpen(false)

  const workspaceLinks: NavLinkConfig[] = [
    { to: '/training', label: 'Training' },
    { to: '/machines', label: 'Machines' },
    { to: '/reservations', label: 'Reservations' },
  ]

  const managementLinks: NavLinkConfig[] = []

  if (user.role === 'manager' || user.role === 'admin') {
    managementLinks.push({
      to: '/admin/checkouts',
      label: 'Checkouts',
      badgeCount: pendingCheckoutCount,
    })
  }

  if (user.role === 'admin') {
    managementLinks.push({
      to: '/admin/booking-requests',
      label: 'Booking Requests',
      search: { view: 'pending', q: '' },
      badgeCount: pendingRequestCount,
    })
  }

  if (user.role === 'manager' || user.role === 'admin') {
    managementLinks.push(
      { to: '/admin/machines', label: 'Machines Admin' },
      { to: '/admin/users', label: 'Users' }
    )
  }

  if (user.role === 'admin') {
    managementLinks.push(
      { to: '/admin/training', label: 'Training Admin' },
      { to: '/admin/settings', label: 'Settings' }
    )
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link to="/" className="text-lg font-semibold tracking-tight">
              Training System
            </Link>
            <Badge variant="secondary" className="hidden md:inline-flex">
              Workspace
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {unreadNotifications > 0 && (
              <Badge variant="info" className="hidden sm:inline-flex">
                <Bell className="mr-1 h-3.5 w-3.5" />
                {unreadNotifications} alerts
              </Badge>
            )}
            <span className="hidden max-w-[240px] truncate text-sm text-muted-foreground lg:inline">
              {user.email}
            </span>
            <Button onClick={handleLogout} variant="outline" size="sm" className="hidden md:inline-flex">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMobileMenuOpen((prev) => !prev)}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="mt-3 hidden flex-wrap items-center gap-2 rounded-xl border bg-card/70 p-2 md:flex">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workspace
          </p>
          {workspaceLinks.map((link) => (
            <HeaderNavLink key={link.to} {...link} />
          ))}

          {managementLinks.length > 0 && (
            <>
              <div className="mx-1 hidden h-6 w-px bg-border lg:block" />
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Management
              </p>
              {managementLinks.map((link) => (
                <HeaderNavLink key={link.to} {...link} />
              ))}
            </>
          )}
        </div>

        {mobileMenuOpen && (
          <div className="mt-3 space-y-4 rounded-xl border bg-card p-3 shadow-sm md:hidden">
            <div className="space-y-1">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workspace
              </p>
              {workspaceLinks.map((link) => (
                <HeaderNavLink key={link.to} {...link} mobile onNavigate={closeMobileMenu} />
              ))}
            </div>

            {managementLinks.length > 0 && (
              <div className="space-y-1">
                <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Management
                </p>
                {managementLinks.map((link) => (
                  <HeaderNavLink key={link.to} {...link} mobile onNavigate={closeMobileMenu} />
                ))}
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Signed in as</p>
              <p className="mt-1 break-all text-sm font-medium">{user.email}</p>
              {unreadNotifications > 0 && (
                <Badge variant="info" className="mt-3">
                  <Bell className="mr-1 h-3.5 w-3.5" />
                  {unreadNotifications} alerts
                </Badge>
              )}
              <Button onClick={handleLogout} variant="outline" className="mt-3 w-full">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
