import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BellRing,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  Settings,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
  icon: LucideIcon
  badge?: {
    label: string
    variant: 'info' | 'warning' | 'success'
  }
  search?: Record<string, string>
}

interface SummaryCardProps {
  title: string
  value: number | string
  description: string
  variant: 'info' | 'warning' | 'success'
}

function SummaryCard({ title, value, description, variant }: SummaryCardProps) {
  return (
    <Card>
      <CardHeader className="space-y-1 pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <Badge variant={variant}>{description}</Badge>
      </CardContent>
    </Card>
  )
}

function NavCard({ to, title, description, icon: Icon, badge, search }: NavCardProps) {
  return (
    <Link
      to={to as never}
      search={search as never}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <CardTitle className="text-lg">{title}</CardTitle>
            </div>
            {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Open
            <ArrowRight className="h-4 w-4" />
          </p>
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

  const summaryCards: SummaryCardProps[] = [
    {
      title: 'Unread alerts',
      value: unreadNotifications,
      description: unreadNotifications > 0 ? 'Needs attention' : 'All clear',
      variant: unreadNotifications > 0 ? 'warning' : 'success',
    },
    {
      title: 'Workspace role',
      value: `${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`,
      description: 'Current access level',
      variant: 'info',
    },
  ]

  if (user.role === 'manager' || user.role === 'admin') {
    summaryCards.push({
      title: 'Checkout queue',
      value: pendingCheckoutCount,
      description: pendingCheckoutCount > 0 ? 'Pending review' : 'Up to date',
      variant: pendingCheckoutCount > 0 ? 'warning' : 'success',
    })
  }

  if (user.role === 'admin') {
    summaryCards.push({
      title: 'Booking requests',
      value: pendingRequestCount,
      description: pendingRequestCount > 0 ? 'Awaiting decisions' : 'No backlog',
      variant: pendingRequestCount > 0 ? 'warning' : 'success',
    })
  }

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container space-y-8 py-6 md:py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome, {user.name || user.email}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your dashboard is grouped by work area so core actions are faster to reach.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map((item) => (
            <SummaryCard
              key={item.title}
              title={item.title}
              value={item.value}
              description={item.description}
              variant={item.variant}
            />
          ))}
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Notifications</CardTitle>
              </div>
              <CardDescription>Recent updates relevant to your reservations and approvals.</CardDescription>
            </div>
            {notifications.length > 0 && unreadNotifications > 0 && (
              <Button variant="secondary" onClick={handleMarkAllRead} disabled={markingAll}>
                {markingAll ? 'Marking...' : 'Mark all read'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {notifications.length > 0 ? (
              <ul className="space-y-3">
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{notification.title}</p>
                        <Badge variant={notification.readAt ? 'info' : 'warning'}>
                          {notification.readAt ? 'Read' : 'Unread'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{notification.message}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(notification.createdAt)}</p>
                    </div>
                    {!notification.readAt && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleMarkRead(notification.id)}
                        disabled={markingNotificationId === notification.id}
                        className="sm:self-start"
                      >
                        {markingNotificationId === notification.id ? 'Saving...' : 'Mark read'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
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
              description="Complete modules and track your progress toward machine access."
              icon={BookOpenCheck}
            />
            <NavCard
              to="/machines"
              title="Machines"
              description="Find available resources and see what you can reserve now."
              icon={Wrench}
            />
            <NavCard
              to="/reservations"
              title="Reservations"
              description="View upcoming bookings and manage existing reservation requests."
              icon={CalendarClock}
            />
          </div>
        </section>

        {(user.role === 'manager' || user.role === 'admin') && (
          <section className="space-y-6">
            <h2 className="text-xl font-semibold tracking-tight">Management</h2>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Approvals
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <NavCard
                  to="/admin/checkouts"
                  title="Checkout Approvals"
                  description="Approve final checkout access for members who completed training."
                  icon={ClipboardCheck}
                  badge={{
                    label: pendingCheckoutCount > 0 ? `${pendingCheckoutCount} pending` : 'Clear',
                    variant: pendingCheckoutCount > 0 ? 'warning' : 'success',
                  }}
                />

                {user.role === 'admin' && (
                  <NavCard
                    to="/admin/booking-requests"
                    search={{ view: 'pending', q: '' }}
                    title="Booking Requests"
                    description="Moderate reservation requests that need administrative review."
                    icon={ShieldAlert}
                    badge={{
                      label: pendingRequestCount > 0 ? `${pendingRequestCount} pending` : 'Clear',
                      variant: pendingRequestCount > 0 ? 'warning' : 'success',
                    }}
                  />
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Configuration
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <NavCard
                  to="/admin/machines"
                  title="Machines Admin"
                  description="Configure machine availability and requirements."
                  icon={Wrench}
                  badge={{ label: user.role === 'admin' ? 'Admin' : 'Manager', variant: 'info' }}
                />

                <NavCard
                  to="/admin/users"
                  title="Users"
                  description="Manage member access and account status changes."
                  icon={Users}
                  badge={{ label: user.role === 'admin' ? 'Admin' : 'Manager', variant: 'info' }}
                />

                {user.role === 'admin' && (
                  <NavCard
                    to="/admin/training"
                    title="Training Admin"
                    description="Create and update training content tied to machine eligibility."
                    icon={BookOpenCheck}
                    badge={{ label: 'Admin', variant: 'info' }}
                  />
                )}

                {user.role === 'admin' && (
                  <NavCard
                    to="/admin/settings"
                    title="Settings"
                    description="Update scheduling and makerspace-level system defaults."
                    icon={Settings}
                    badge={{ label: 'Admin', variant: 'info' }}
                  />
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
