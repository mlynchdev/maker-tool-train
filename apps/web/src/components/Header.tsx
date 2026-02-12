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

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="logo">
          Training System
        </Link>

        <nav className="nav">
          <Link to="/training">Training</Link>
          <Link to="/machines">Machines</Link>
          <Link to="/reservations">Reservations</Link>

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/machines">Resources</Link>
          )}

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/users">Users</Link>
          )}

          {user.role === 'admin' && <Link to="/admin/training">Training Admin</Link>}

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/checkouts" style={{ position: 'relative' }}>
              Checkouts
              {pendingCheckoutCount > 0 && (
                <span className="badge badge-warning" style={{ marginLeft: '0.35rem' }}>
                  {pendingCheckoutCount}
                </span>
              )}
            </Link>
          )}

          {user.role === 'admin' && (
            <Link
              to="/admin/booking-requests"
              search={{ view: 'pending', q: '' }}
              style={{ position: 'relative' }}
            >
              Booking Requests
              {pendingRequestCount > 0 && (
                <span className="badge badge-warning" style={{ marginLeft: '0.35rem' }}>
                  {pendingRequestCount}
                </span>
              )}
            </Link>
          )}

          {user.role === 'admin' && <Link to="/admin/settings">Settings</Link>}

          {unreadNotifications > 0 && (
            <span className="badge badge-info">{unreadNotifications} alerts</span>
          )}

          <span className="text-muted text-small">{user.email}</span>
          <button onClick={handleLogout} className="btn btn-secondary">
            Logout
          </button>
        </nav>
      </div>
    </header>
  )
}
