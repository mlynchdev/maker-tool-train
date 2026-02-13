import { Link } from '@tanstack/react-router'
import {
  Bell,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getPendingCheckoutCount,
  getPendingCheckouts,
  getPendingReservationRequestCount,
  getPendingReservationRequests,
  getCheckoutAvailability,
} from '~/server/api/admin'
import { getMachines } from '~/server/api/machines'
import {
  getNotifications,
  getMyUnreadNotificationCount,
  markAllMyNotificationsRead,
  markMyNotificationRead,
} from '~/server/api/notifications'
import { getReservations } from '~/server/api/reservations'
import { getTrainingStatus } from '~/server/api/training'
import type { AuthUser } from '~/server/auth/types'
import { parseSSEMessage } from '~/lib/sse'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'

interface DashboardProps {
  user: AuthUser
}

type DateValue = Date | string

type NotificationsPayload = Awaited<ReturnType<typeof getNotifications>>
type NotificationRow = NotificationsPayload['notifications'][number]

type TrainingStatusPayload = Awaited<ReturnType<typeof getTrainingStatus>>
type TrainingModuleSummary = TrainingStatusPayload['modules'][number]

type ReservationsPayload = Awaited<ReturnType<typeof getReservations>>
type ReservationRow = ReservationsPayload['reservations'][number]

type MachinesPayload = Awaited<ReturnType<typeof getMachines>>
type MachineRow = MachinesPayload['machines'][number]

type PendingCheckoutPayload = Awaited<ReturnType<typeof getPendingCheckouts>>
type PendingCheckoutRow = PendingCheckoutPayload['pendingApprovals'][number]

type PendingRequestsPayload = Awaited<ReturnType<typeof getPendingReservationRequests>>
type PendingRequestRow = PendingRequestsPayload['requests'][number]

type CheckoutAvailabilityPayload = Awaited<ReturnType<typeof getCheckoutAvailability>>
type CheckoutAppointmentRow = CheckoutAvailabilityPayload['appointments'][number]

interface QueueItem {
  id: string
  title: string
  subtitle: string
  description: string
  kind: 'request' | 'approval' | 'alert'
  priority: number
  time?: DateValue
  action?: {
    label: string
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
  }
}

interface TimelineItem {
  id: string
  title: string
  subtitle: string
  kind: 'reservation' | 'checkout'
  startsAt: DateValue
}

const ACTIVE_RESERVATION_STATUSES = ['pending', 'approved', 'confirmed'] as const

function toDate(value: DateValue) {
  return new Date(value)
}

function formatDateTime(value: DateValue) {
  return toDate(value).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatCompact(value: DateValue) {
  return toDate(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getStatusBadgeVariant(status: string): 'success' | 'warning' | 'destructive' | 'info' {
  if (status === 'approved' || status === 'confirmed' || status === 'completed') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'cancelled' || status === 'rejected') return 'destructive'
  return 'info'
}

function getQueueTone(kind: QueueItem['kind']) {
  if (kind === 'request') return 'border-l-amber-500'
  if (kind === 'approval') return 'border-l-sky-500'
  return 'border-l-emerald-500'
}

export function Dashboard({ user }: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusPayload | null>(null)
  const [reservations, setReservations] = useState<ReservationRow[]>([])
  const [machines, setMachines] = useState<MachineRow[]>([])

  const [pendingCheckoutCount, setPendingCheckoutCount] = useState(0)
  const [pendingRequestCount, setPendingRequestCount] = useState(0)
  const [pendingApprovals, setPendingApprovals] = useState<PendingCheckoutRow[]>([])
  const [pendingRequests, setPendingRequests] = useState<PendingRequestRow[]>([])
  const [checkoutAppointments, setCheckoutAppointments] = useState<CheckoutAppointmentRow[]>([])

  const isManagerOrAdmin = user.role === 'manager' || user.role === 'admin'
  const isAdmin = user.role === 'admin'

  const loadDashboardData = useCallback(async () => {
    setRefreshing(true)

    try {
      const [
        unreadResult,
        notificationsResult,
        trainingResult,
        reservationsResult,
        machinesResult,
      ] = await Promise.all([
        getMyUnreadNotificationCount(),
        getNotifications({ data: { limit: 10 } }),
        getTrainingStatus(),
        getReservations({ data: { includesPast: true } }),
        getMachines(),
      ])

      setUnreadNotifications(unreadResult.count)
      setNotifications(notificationsResult.notifications)
      setTrainingStatus(trainingResult)
      setReservations(reservationsResult.reservations)
      setMachines(machinesResult.machines)

      if (isManagerOrAdmin) {
        const rangeStart = new Date()
        const rangeEnd = new Date(rangeStart)
        rangeEnd.setDate(rangeEnd.getDate() + 2)

        const [checkoutCountResult, pendingCheckoutsResult, availabilityResult] = await Promise.all([
          getPendingCheckoutCount(),
          getPendingCheckouts(),
          getCheckoutAvailability({
            data: {
              startDate: rangeStart.toISOString(),
              endDate: rangeEnd.toISOString(),
            },
          }),
        ])

        setPendingCheckoutCount(checkoutCountResult.count)
        setPendingApprovals(pendingCheckoutsResult.pendingApprovals)
        setCheckoutAppointments(availabilityResult.appointments)
      } else {
        setPendingCheckoutCount(0)
        setPendingApprovals([])
        setCheckoutAppointments([])
      }

      if (isAdmin) {
        const [requestCountResult, requestResult] = await Promise.all([
          getPendingReservationRequestCount(),
          getPendingReservationRequests(),
        ])

        setPendingRequestCount(requestCountResult.count)
        setPendingRequests(requestResult.requests)
      } else {
        setPendingRequestCount(0)
        setPendingRequests([])
      }

      setLastRefreshedAt(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [isAdmin, isManagerOrAdmin])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

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
        loadDashboardData()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [loadDashboardData])

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

  const reservationSummary = useMemo(() => {
    const now = new Date()

    const upcoming = reservations.filter(
      (item) =>
        ACTIVE_RESERVATION_STATUSES.includes(item.status as (typeof ACTIVE_RESERVATION_STATUSES)[number]) &&
        toDate(item.startTime) > now
    )

    const pending = reservations.filter((item) => item.status === 'pending')
    const approved = reservations.filter(
      (item) => item.status === 'approved' || item.status === 'confirmed'
    )
    const completed = reservations.filter((item) => item.status === 'completed')
    const cancelled = reservations.filter(
      (item) => item.status === 'cancelled' || item.status === 'rejected'
    )

    return {
      upcoming,
      pending,
      approved,
      completed,
      cancelled,
    }
  }, [reservations])

  const timelineItems = useMemo(() => {
    const reservationEvents: TimelineItem[] = reservationSummary.upcoming.slice(0, 6).map((item) => ({
      id: `reservation-${item.id}`,
      title: item.machine.name,
      subtitle: `Reservation (${item.status})`,
      kind: 'reservation',
      startsAt: item.startTime,
    }))

    const checkoutEvents: TimelineItem[] = checkoutAppointments.slice(0, 6).map((item) => ({
      id: `checkout-${item.id}`,
      title: item.machine.name,
      subtitle: `Checkout with ${item.user.name || item.user.email}`,
      kind: 'checkout',
      startsAt: item.startTime,
    }))

    return [...reservationEvents, ...checkoutEvents]
      .sort((left, right) => toDate(left.startsAt).getTime() - toDate(right.startsAt).getTime())
      .slice(0, 10)
  }, [checkoutAppointments, reservationSummary.upcoming])

  const queueItems = useMemo(() => {
    const approvalItems: QueueItem[] = pendingApprovals.slice(0, 8).map((item) => ({
      id: `approval-${item.user.id}-${item.machine.id}`,
      title: 'Checkout approval required',
      subtitle: `${item.user.name || item.user.email}`,
      description: `${item.machine.name} is ready for final checkout`,
      kind: 'approval',
      priority: 2,
      action: {
        label: 'Review member',
        to: '/admin/checkouts/$userId',
        params: { userId: item.user.id },
      },
    }))

    const requestItems: QueueItem[] = pendingRequests.slice(0, 8).map((item) => ({
      id: `request-${item.id}`,
      title: 'Reservation request pending',
      subtitle: `${item.user.name || item.user.email}`,
      description: `${item.machine.name} · ${formatCompact(item.startTime)}`,
      kind: 'request',
      priority: 3,
      time: item.createdAt,
      action: {
        label: 'Moderate request',
        to: '/admin/booking-requests',
        search: { view: 'pending', q: '' },
      },
    }))

    const alertItems: QueueItem[] = notifications
      .filter((item) => !item.readAt)
      .slice(0, 10)
      .map((item) => ({
        id: `alert-${item.id}`,
        title: item.title,
        subtitle: 'Unread notification',
        description: item.message,
        kind: 'alert',
        priority: 1,
        time: item.createdAt,
      }))

    return [...requestItems, ...approvalItems, ...alertItems]
      .sort((left, right) => {
        if (left.priority !== right.priority) return right.priority - left.priority
        if (!left.time && !right.time) return 0
        if (!left.time) return 1
        if (!right.time) return -1
        return toDate(right.time).getTime() - toDate(left.time).getTime()
      })
      .slice(0, 14)
  }, [notifications, pendingApprovals, pendingRequests])

  const readyMachines = machines.filter((machine) => machine.eligibility.eligible)
  const blockedMachines = machines.filter((machine) => !machine.eligibility.eligible)

  const filteredQueueItems = queueItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.trim().toLowerCase()

    return (
      item.title.toLowerCase().includes(query) ||
      item.subtitle.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })

  const filteredNotifications = notifications.filter((item) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.trim().toLowerCase()

    return (
      item.title.toLowerCase().includes(query) ||
      item.message.toLowerCase().includes(query)
    )
  })

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium">Loading command center...</p>
          <Progress value={65} className="mx-auto h-2 w-40" />
        </div>
      </div>
    )
  }

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6 lg:p-8">
      <Card className="bg-card/80">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Main Dashboard</h2>
              <p className="text-xs text-muted-foreground">
                Last refreshed {lastRefreshedAt ? formatCompact(lastRefreshedAt) : 'just now'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {unreadNotifications > 0 && (
                <Badge variant="warning" className="hidden sm:inline-flex">
                  <Bell className="mr-1 h-3.5 w-3.5" />
                  {unreadNotifications}
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={loadDashboardData} disabled={refreshing}>
                <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder="Search queue, alerts, and events"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/machines">New reservation</Link>
              </Button>
              {isManagerOrAdmin && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/checkouts">Open checkout queue</Link>
                </Button>
              )}
              {unreadNotifications > 0 && (
                <Button size="sm" variant="secondary" onClick={handleMarkAllRead} disabled={markingAll}>
                  {markingAll ? 'Marking...' : 'Mark all read'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card className="bg-card/80">
          <CardHeader className="pb-2">
            <CardDescription>Unread alerts</CardDescription>
            <CardTitle className="text-2xl">{unreadNotifications}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-card/80">
          <CardHeader className="pb-2">
            <CardDescription>Upcoming reservations</CardDescription>
            <CardTitle className="text-2xl">{reservationSummary.upcoming.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-card/80">
          <CardHeader className="pb-2">
            <CardDescription>Ready machines</CardDescription>
            <CardTitle className="text-2xl">{readyMachines.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-card/80">
          <CardHeader className="pb-2">
            <CardDescription>Training completion</CardDescription>
            <CardTitle className="text-2xl">{trainingStatus?.overallProgress ?? 0}%</CardTitle>
          </CardHeader>
        </Card>
        {isManagerOrAdmin && (
          <Card className="bg-card/80">
            <CardHeader className="pb-2">
              <CardDescription>Checkout queue</CardDescription>
              <CardTitle className="text-2xl">{pendingCheckoutCount}</CardTitle>
            </CardHeader>
          </Card>
        )}
        {isAdmin && (
          <Card className="bg-card/80">
            <CardHeader className="pb-2">
              <CardDescription>Booking requests</CardDescription>
              <CardTitle className="text-2xl">{pendingRequestCount}</CardTitle>
            </CardHeader>
          </Card>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="bg-card/80 xl:col-span-5">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Action Queue</CardTitle>
                <CardDescription>Most urgent tasks sorted by operational priority.</CardDescription>
              </div>
              <Badge variant="warning">{filteredQueueItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {filteredQueueItems.length > 0 ? (
              filteredQueueItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-lg border border-border/80 border-l-4 bg-background/60 p-3',
                    getQueueTone(item.kind)
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                    </div>
                    {item.time && (
                      <p className="text-[11px] text-muted-foreground">{formatCompact(item.time)}</p>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                  {item.action && (
                    <Button asChild size="sm" variant="ghost" className="mt-2 h-7 px-0">
                      <Link
                        to={item.action.to as never}
                        params={item.action.params as never}
                        search={item.action.search as never}
                      >
                        {item.action.label}
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No queue items match your search.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/80 xl:col-span-7">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Today Timeline</CardTitle>
                <CardDescription>Reservations and checkout appointments in chronological order.</CardDescription>
              </div>
              <Clock3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {timelineItems.length > 0 ? (
              timelineItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1 rounded-lg border bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.kind === 'checkout' ? 'warning' : 'info'}>
                      {item.kind === 'checkout' ? 'Checkout' : 'Reservation'}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{formatCompact(item.startsAt)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming events scheduled in the next two days.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/80 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">Machine Readiness</CardTitle>
            <CardDescription>Eligibility health across active resources.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Ready</p>
                <p className="text-xl font-semibold">{readyMachines.length}</p>
              </div>
              <div className="rounded-lg border bg-background/60 p-3">
                <p className="text-xs text-muted-foreground">Blocked</p>
                <p className="text-xl font-semibold">{blockedMachines.length}</p>
              </div>
            </div>

            <div className="space-y-2">
              {blockedMachines.slice(0, 5).map((machine) => (
                <div key={machine.id} className="rounded-md border bg-background/60 p-2.5">
                  <p className="text-sm font-medium">{machine.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {machine.eligibility.reasons[0] || 'Missing requirements'}
                  </p>
                </div>
              ))}
              {blockedMachines.length === 0 && (
                <p className="text-sm text-muted-foreground">All resources are ready to reserve.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/80 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">Reservations Snapshot</CardTitle>
            <CardDescription>Current booking pipeline status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              ['Pending', reservationSummary.pending.length, 'warning'],
              ['Approved', reservationSummary.approved.length, 'success'],
              ['Completed', reservationSummary.completed.length, 'info'],
              ['Cancelled', reservationSummary.cancelled.length, 'destructive'],
            ].map(([label, value, variant]) => (
              <div key={label} className="flex items-center justify-between rounded-md border bg-background/60 px-3 py-2">
                <p className="text-sm">{label}</p>
                <Badge variant={variant as 'warning' | 'success' | 'info' | 'destructive'}>{value as number}</Badge>
              </div>
            ))}

            {reservationSummary.upcoming[0] && (
              <div className="rounded-lg border border-sky-300/40 bg-sky-50/40 p-3 text-sky-900">
                <p className="text-xs font-semibold uppercase tracking-wide">Next reservation</p>
                <p className="mt-1 text-sm font-medium">{reservationSummary.upcoming[0].machine.name}</p>
                <p className="text-xs">{formatDateTime(reservationSummary.upcoming[0].startTime)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/80 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">Training Progress</CardTitle>
            <CardDescription>
              {trainingStatus?.completedModules ?? 0} of {trainingStatus?.totalModules ?? 0} modules complete.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={trainingStatus?.overallProgress ?? 0} />
            <div className="space-y-2">
              {trainingStatus?.modules
                .filter((module) => !module.completed)
                .sort((a, b) => b.percentComplete - a.percentComplete)
                .slice(0, 5)
                .map((module: TrainingModuleSummary) => (
                  <div key={module.id} className="rounded-md border bg-background/60 p-2.5">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{module.title}</p>
                      <Badge variant="warning">{module.percentComplete}%</Badge>
                    </div>
                    <Progress value={module.percentComplete} className="h-1.5" />
                  </div>
                ))}

              {trainingStatus?.modules.every((module) => module.completed) && (
                <div className="rounded-lg border border-emerald-300/40 bg-emerald-50/40 p-3 text-emerald-900">
                  <p className="text-sm font-medium">All training modules are complete.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/80">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Notification Stream</CardTitle>
              <CardDescription>Recent updates with inline triage controls.</CardDescription>
            </div>
            <BellRing className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredNotifications.length > 0 ? (
            filteredNotifications.slice(0, 12).map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{item.title}</p>
                    <Badge variant={item.readAt ? 'info' : 'warning'}>
                      {item.readAt ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Read
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" />
                          Unread
                        </span>
                      )}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.message}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </div>

                {!item.readAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleMarkRead(item.id)}
                    disabled={markingNotificationId === item.id}
                  >
                    {markingNotificationId === item.id ? 'Saving...' : 'Mark read'}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No notifications match your search.</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
