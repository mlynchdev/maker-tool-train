import { Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import type { AuthUser } from '~/server/auth/types'
import { Header } from './Header'
import {
  getNotifications,
  getMyUnreadNotificationCount,
  markAllMyNotificationsRead,
  markMyNotificationRead,
} from '~/server/api/notifications'
import {
  getPendingCheckoutCount,
  getPendingReservationRequestCount,
} from '~/server/api/admin'

interface DashboardProps {
  user: AuthUser
}

export function Dashboard({ user }: DashboardProps) {
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState(0)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notifications, setNotifications] = useState<
    Array<{
      id: string
      title: string
      message: string
      readAt: Date | null
      createdAt: Date
    }>
  >([])
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadNotifications = async () => {
      const [countResult, notificationsResult] = await Promise.all([
        getMyUnreadNotificationCount(),
        getNotifications({ data: { limit: 5 } }),
      ])

      if (!mounted) return

      setUnreadNotifications(countResult.count)
      setNotifications(
        notificationsResult.notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          message: notification.message,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        }))
      )
    }

    if (user.role === 'manager' || user.role === 'admin') {
      getPendingCheckoutCount().then((r) => setPendingCheckoutCount(r.count))
    }

    if (user.role === 'admin') {
      getPendingReservationRequestCount().then((r) => setPendingRequestCount(r.count))
    }

    loadNotifications()

    return () => {
      mounted = false
    }
  }, [user.role])

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  const handleMarkRead = async (notificationId: string) => {
    setMarkingNotificationId(notificationId)
    try {
      const result = await markMyNotificationRead({ data: { notificationId } })
      if (!result.success) return

      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notificationId ? { ...item, readAt: new Date() } : item
        )
      )
      setUnreadNotifications((prev) => Math.max(prev - 1, 0))
    } finally {
      setMarkingNotificationId(null)
    }
  }

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    try {
      await markAllMyNotificationsRead()
      setNotifications((prev) => prev.map((item) => ({ ...item, readAt: new Date() })))
      setUnreadNotifications(0)
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">Welcome, {user.name || user.email}</h1>

          <div className="card mb-3">
            <div className="card-header">
              <h3 className="card-title">
                Notifications
                {unreadNotifications > 0 && (
                  <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
                    {unreadNotifications} unread
                  </span>
                )}
              </h3>
              {notifications.length > 0 && unreadNotifications > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={handleMarkAllRead}
                  disabled={markingAll}
                >
                  {markingAll ? 'Marking...' : 'Mark all read'}
                </button>
              )}
            </div>

            {notifications.length > 0 ? (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Message</th>
                      <th>Time</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map((notification) => (
                      <tr key={notification.id}>
                        <td>{notification.title}</td>
                        <td>{notification.message}</td>
                        <td>{formatDateTime(notification.createdAt)}</td>
                        <td>
                          {notification.readAt ? (
                            <span className="badge badge-info">Read</span>
                          ) : (
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleMarkRead(notification.id)}
                              disabled={markingNotificationId === notification.id}
                            >
                              {markingNotificationId === notification.id
                                ? 'Saving...'
                                : 'Mark read'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted text-small">No notifications yet.</p>
            )}
          </div>

          <div className="grid grid-3">
            <Link to="/training" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Training</h3>
              </div>
              <p className="text-muted text-small">
                Complete required training modules to unlock machine access.
              </p>
            </Link>

            <Link to="/machines" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Machines</h3>
              </div>
              <p className="text-muted text-small">
                View available machines and check your eligibility.
              </p>
            </Link>

            <Link to="/reservations" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Reservations</h3>
              </div>
              <p className="text-muted text-small">
                View and manage your upcoming reservations.
              </p>
            </Link>
          </div>

          {(user.role === 'manager' || user.role === 'admin') && (
            <>
              <h2 className="mt-3 mb-2">Management</h2>
              <div className="grid grid-3">
                <Link to="/admin/checkouts" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card-header">
                    <h3 className="card-title">
                      Checkout Approvals
                      {pendingCheckoutCount > 0 && (
                        <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
                          {pendingCheckoutCount} pending
                        </span>
                      )}
                    </h3>
                    <span className="badge badge-info">Manager</span>
                  </div>
                  <p className="text-muted text-small">
                    Approve member checkouts after training completion.
                  </p>
                </Link>

                {user.role === 'admin' && (
                  <Link
                    to="/admin/booking-requests"
                    search={{ view: 'pending', q: '' }}
                    className="card"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="card-header">
                      <h3 className="card-title">
                        Booking Requests
                        {pendingRequestCount > 0 && (
                          <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
                            {pendingRequestCount} pending
                          </span>
                        )}
                      </h3>
                      <span className="badge badge-warning">Admin</span>
                    </div>
                    <p className="text-muted text-small">
                      Review and moderate member reservation requests.
                    </p>
                  </Link>
                )}

                {(user.role === 'manager' || user.role === 'admin') && (
                  <Link to="/admin/machines" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card-header">
                      <h3 className="card-title">Manage Machines & Tools</h3>
                      <span className="badge badge-warning">
                        {user.role === 'admin' ? 'Admin' : 'Manager'}
                      </span>
                    </div>
                    <p className="text-muted text-small">
                      Add and configure reservable resources and requirements.
                    </p>
                  </Link>
                )}

                {(user.role === 'manager' || user.role === 'admin') && (
                  <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div className="card-header">
                      <h3 className="card-title">Users</h3>
                      <span className="badge badge-warning">
                        {user.role === 'admin' ? 'Admin' : 'Manager'}
                      </span>
                    </div>
                    <p className="text-muted text-small">
                      Manage member checkout access and view account details.
                    </p>
                  </Link>
                )}

                {user.role === 'admin' && (
                  <>
                    <Link to="/admin/training" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="card-header">
                        <h3 className="card-title">Manage Training</h3>
                        <span className="badge badge-warning">Admin</span>
                      </div>
                      <p className="text-muted text-small">
                        Create and manage training modules.
                      </p>
                    </Link>

                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
