import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

interface DashboardProps {
  user: AuthUser
}

interface NotificationRow {
  id: string
  title: string
  message: string
  readAt: Date | null
  createdAt: Date
}

interface NavCardProps {
  to: string
  title: string
  description: string
  badge?: {
    label: string
    variant: 'info' | 'warning' | 'success'
  }
  search?: Record<string, string>
}

function NavCard({ to, title, description, badge, search }: NavCardProps) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
          <CardTitle className="text-lg">{title}</CardTitle>
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </CardHeader>
        <CardContent>
          <CardDescription>{description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  )
}

export function Dashboard({ user }: DashboardProps) {
  const [pendingCheckoutCount, setPendingCheckoutCount] = useState(0)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
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
      getPendingCheckoutCount().then((result) => setPendingCheckoutCount(result.count))
    }

    if (user.role === 'admin') {
      getPendingReservationRequestCount().then((result) => setPendingRequestCount(result.count))
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
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container space-y-8 py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {user.name || user.email}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage training, machine eligibility, and reservations from one dashboard.
          </p>
        </section>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>Notifications</CardTitle>
              {unreadNotifications > 0 && (
                <Badge variant="warning">{unreadNotifications} unread</Badge>
              )}
            </div>
            {notifications.length > 0 && unreadNotifications > 0 && (
              <Button variant="secondary" onClick={handleMarkAllRead} disabled={markingAll}>
                {markingAll ? 'Marking...' : 'Mark all read'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {notifications.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notifications.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell className="font-medium">{notification.title}</TableCell>
                      <TableCell>{notification.message}</TableCell>
                      <TableCell>{formatDateTime(notification.createdAt)}</TableCell>
                      <TableCell>
                        {notification.readAt ? (
                          <Badge variant="info">Read</Badge>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleMarkRead(notification.id)}
                            disabled={markingNotificationId === notification.id}
                          >
                            {markingNotificationId === notification.id ? 'Saving...' : 'Mark read'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No notifications yet.</p>
            )}
          </CardContent>
        </Card>

        <section>
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Workspace</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <NavCard
              to="/training"
              title="Training"
              description="Complete required training modules to unlock machine access."
            />
            <NavCard
              to="/machines"
              title="Machines"
              description="View available machines and check your eligibility."
            />
            <NavCard
              to="/reservations"
              title="Reservations"
              description="View and manage your upcoming reservations."
            />
          </div>
        </section>

        {(user.role === 'manager' || user.role === 'admin') && (
          <section>
            <h2 className="mb-3 text-xl font-semibold tracking-tight">Management</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <NavCard
                to="/admin/checkouts"
                title="Checkout Approvals"
                description="Approve member checkouts after training completion."
                badge={{
                  label:
                    pendingCheckoutCount > 0
                      ? `${pendingCheckoutCount} pending`
                      : user.role === 'admin'
                        ? 'Admin'
                        : 'Manager',
                  variant: pendingCheckoutCount > 0 ? 'warning' : 'info',
                }}
              />

              {user.role === 'admin' && (
                <NavCard
                  to="/admin/booking-requests"
                  search={{ view: 'pending', q: '' }}
                  title="Booking Requests"
                  description="Review and moderate member reservation requests."
                  badge={{
                    label: pendingRequestCount > 0 ? `${pendingRequestCount} pending` : 'Admin',
                    variant: 'warning',
                  }}
                />
              )}

              {(user.role === 'manager' || user.role === 'admin') && (
                <NavCard
                  to="/admin/machines"
                  title="Manage Machines"
                  description="Add and configure reservable resources and requirements."
                  badge={{ label: user.role === 'admin' ? 'Admin' : 'Manager', variant: 'warning' }}
                />
              )}

              {(user.role === 'manager' || user.role === 'admin') && (
                <NavCard
                  to="/admin/users"
                  title="Users"
                  description="Manage member checkout access and view account details."
                  badge={{ label: user.role === 'admin' ? 'Admin' : 'Manager', variant: 'warning' }}
                />
              )}

              {user.role === 'admin' && (
                <NavCard
                  to="/admin/training"
                  title="Manage Training"
                  description="Create and manage training modules."
                  badge={{ label: 'Admin', variant: 'warning' }}
                />
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
