import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import type { AuthUser } from '~/server/auth/types'
import { logout } from '~/server/api/auth'
import { getMyUnreadNotificationCount } from '~/server/api/notifications'
import {
  getPendingCheckoutCount,
  getPendingReservationRequestCount,
} from '~/server/api/admin'
import { parseSSEMessage } from '~/lib/sse'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'

interface HeaderProps {
  user: AuthUser
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()
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

  const navLinkClass =
    'inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground'

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex flex-wrap items-center justify-between gap-3 py-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          Training System
        </Link>

        <nav className="flex flex-wrap items-center gap-2 md:gap-4">
          <Link to="/training" className={navLinkClass}>Training</Link>
          <Link to="/machines" className={navLinkClass}>Machines</Link>
          <Link to="/reservations" className={navLinkClass}>Reservations</Link>

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/machines" className={navLinkClass}>Resources</Link>
          )}

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/users" className={navLinkClass}>Users</Link>
          )}

          {user.role === 'admin' && (
            <Link to="/admin/training" className={navLinkClass}>Training Admin</Link>
          )}

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/checkouts" className={navLinkClass}>
              Checkouts
              {pendingCheckoutCount > 0 && (
                <Badge variant="warning" className="ml-1">
                  {pendingCheckoutCount}
                </Badge>
              )}
            </Link>
          )}

          {user.role === 'admin' && (
            <Link
              to="/admin/booking-requests"
              search={{ view: 'pending', q: '' }}
              className={navLinkClass}
            >
              Booking Requests
              {pendingRequestCount > 0 && (
                <Badge variant="warning" className="ml-1">
                  {pendingRequestCount}
                </Badge>
              )}
            </Link>
          )}

          {user.role === 'admin' && (
            <Link to="/admin/settings" className={navLinkClass}>Settings</Link>
          )}

          {unreadNotifications > 0 && (
            <Badge variant="info">{unreadNotifications} alerts</Badge>
          )}

          <span className="text-xs text-muted-foreground">{user.email}</span>
          <Button onClick={handleLogout} variant="secondary" size="sm">
            Logout
          </Button>
        </nav>
      </div>
    </header>
  )
}
