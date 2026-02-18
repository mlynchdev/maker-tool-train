import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useCallback, useMemo, useState } from 'react'
import {
  markAllMyNotificationsRead,
  markMyNotificationRead,
} from '~/server/api/notifications'
import type { getNotifications } from '~/server/api/notifications'
import { queryKeys } from '~/lib/query/keys'
import {
  machinesListQueryOptions,
  myUpcomingCheckoutAppointmentsQueryOptions,
  notificationsListQueryOptions,
  pendingCheckoutCountQueryOptions,
  pendingCheckoutsQueryOptions,
  pendingReservationRequestCountQueryOptions,
  pendingReservationRequestsQueryOptions,
  reservationsListQueryOptions,
  trainingStatusQueryOptions,
  unreadNotificationCountQueryOptions,
} from '~/lib/query/options'
import type { AuthUser } from '~/server/auth/types'
import { cn } from '~/lib/utils'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Progress } from '~/components/ui/progress'

interface DashboardProps {
  user: AuthUser
}

type DateValue = Date | string

type NotificationsPayload = Awaited<ReturnType<typeof getNotifications>>

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

const ACTIVE_RESERVATION_STATUSES = [
  'pending',
  'approved',
  'confirmed',
] as const
const DASHBOARD_NOTIFICATION_OPTIONS = { unreadOnly: false, limit: 10 } as const
const DASHBOARD_RESERVATIONS_OPTIONS = { includesPast: true } as const

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

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

function getQueueTone(kind: QueueItem['kind']) {
  if (kind === 'request') return 'border-l-amber-500'
  if (kind === 'approval') return 'border-l-sky-500'
  return 'border-l-emerald-500'
}

export function Dashboard({ user }: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [markingNotificationId, setMarkingNotificationId] = useState<
    string | null
  >(null)
  const [markingAll, setMarkingAll] = useState(false)
  const queryClient = useQueryClient()

  const isAdmin = user.role === 'admin'

  const unreadCountQuery = useQuery(unreadNotificationCountQueryOptions())
  const notificationsQuery = useQuery(
    notificationsListQueryOptions(DASHBOARD_NOTIFICATION_OPTIONS),
  )
  const trainingStatusQuery = useQuery(trainingStatusQueryOptions())
  const reservationsQuery = useQuery(
    reservationsListQueryOptions(DASHBOARD_RESERVATIONS_OPTIONS),
  )
  const machinesQuery = useQuery(machinesListQueryOptions())
  const upcomingCheckoutAppointmentsQuery = useQuery(
    myUpcomingCheckoutAppointmentsQueryOptions(),
  )
  const pendingCheckoutCountQuery = useQuery({
    ...pendingCheckoutCountQueryOptions(),
    enabled: isAdmin,
  })
  const pendingApprovalsQuery = useQuery({
    ...pendingCheckoutsQueryOptions(),
    enabled: isAdmin,
  })
  const pendingRequestCountQuery = useQuery({
    ...pendingReservationRequestCountQueryOptions(),
    enabled: isAdmin,
  })
  const pendingRequestsQuery = useQuery({
    ...pendingReservationRequestsQueryOptions(),
    enabled: isAdmin,
  })

  const unreadNotifications = unreadCountQuery.data?.count ?? 0
  const notifications = asArray(notificationsQuery.data?.notifications)
  const trainingStatus = trainingStatusQuery.data ?? null
  const reservations = asArray(reservationsQuery.data?.reservations)
  const machines = asArray(machinesQuery.data?.machines)
  const upcomingCheckoutAppointments = asArray(
    upcomingCheckoutAppointmentsQuery.data?.appointments,
  )
  const pendingCheckoutCount = pendingCheckoutCountQuery.data?.count ?? 0
  const pendingApprovals = asArray(pendingApprovalsQuery.data?.pendingApprovals)
  const pendingRequestCount = pendingRequestCountQuery.data?.count ?? 0
  const pendingRequests = asArray(pendingRequestsQuery.data?.requests)

  const refreshDashboardData = useCallback(async () => {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.training.status(),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.reservations.mine(DASHBOARD_RESERVATIONS_OPTIONS),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.machines.list(),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
      }),
    ]

    if (isAdmin) {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckoutCount(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingReservationRequestCount(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingReservationRequests(),
        }),
      )
    }

    await Promise.all(invalidations)
  }, [isAdmin, queryClient])

  interface DashboardQueryState {
    isPending: boolean
    isFetching: boolean
    dataUpdatedAt: number
    data: unknown
  }

  const loadingQueries: DashboardQueryState[] = [
    unreadCountQuery,
    notificationsQuery,
    trainingStatusQuery,
    reservationsQuery,
    machinesQuery,
    upcomingCheckoutAppointmentsQuery,
  ]

  if (isAdmin) {
    loadingQueries.push(
      pendingCheckoutCountQuery,
      pendingApprovalsQuery,
      pendingRequestCountQuery,
      pendingRequestsQuery,
    )
  }

  const primaryQueries: DashboardQueryState[] = [
    unreadCountQuery,
    notificationsQuery,
    trainingStatusQuery,
    reservationsQuery,
    machinesQuery,
  ]
  const hasPrimaryData = primaryQueries.some(
    (query) => typeof query.data !== 'undefined',
  )
  const loading =
    !hasPrimaryData &&
    primaryQueries.some((query) => query.isPending || query.isFetching)
  const refreshing = loadingQueries.some((query) => query.isFetching)
  const refreshTimestamps = loadingQueries
    .map((query) => query.dataUpdatedAt)
    .filter((value) => value > 0)
  const lastRefreshedAt =
    refreshTimestamps.length > 0
      ? new Date(Math.max(...refreshTimestamps))
      : null

  const markNotificationReadMutation = useMutation({
    meta: {
      errorMessage: 'Failed to mark notification as read',
    },
    mutationFn: async (variables: { notificationId: string }) => {
      const result = await markMyNotificationRead({ data: variables })
      if (!result.success) {
        throw new Error(result.error || 'Failed to mark notification as read')
      }
      return result
    },
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.notifications.unreadCount(),
        }),
      ])

      const previousNotifications = queryClient.getQueryData<NotificationsPayload>(
        queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS)
      )
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(
        queryKeys.notifications.unreadCount()
      )

      queryClient.setQueryData<NotificationsPayload>(
        queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        (current) => {
          if (!current) return current

          return {
            ...current,
            notifications: current.notifications.map((item) =>
              item.id === variables.notificationId
                ? { ...item, readAt: new Date() }
                : item,
            ),
          }
        },
      )

      queryClient.setQueryData<{ count: number }>(
        queryKeys.notifications.unreadCount(),
        (current) => {
          if (!current) return current
          return { count: Math.max(current.count - 1, 0) }
        },
      )

      return {
        previousNotifications,
        previousUnreadCount,
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(
          queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
          context.previousNotifications
        )
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(
          queryKeys.notifications.unreadCount(),
          context.previousUnreadCount
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.unreadCount(),
        }),
      ])
    },
  })

  const markAllNotificationsReadMutation = useMutation({
    meta: {
      errorMessage: 'Failed to mark all notifications as read',
    },
    mutationFn: async () => {
      return markAllMyNotificationsRead()
    },
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.notifications.unreadCount(),
        }),
      ])

      const previousNotifications = queryClient.getQueryData<NotificationsPayload>(
        queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS)
      )
      const previousUnreadCount = queryClient.getQueryData<{ count: number }>(
        queryKeys.notifications.unreadCount()
      )

      queryClient.setQueryData<NotificationsPayload>(
        queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        (current) => {
          if (!current) return current

          return {
            ...current,
            notifications: current.notifications.map((item) => ({
              ...item,
              readAt: new Date(),
            })),
          }
        },
      )

      queryClient.setQueryData(queryKeys.notifications.unreadCount(), {
        count: 0,
      })

      return {
        previousNotifications,
        previousUnreadCount,
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(
          queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
          context.previousNotifications
        )
      }
      if (context?.previousUnreadCount) {
        queryClient.setQueryData(
          queryKeys.notifications.unreadCount(),
          context.previousUnreadCount
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.list(DASHBOARD_NOTIFICATION_OPTIONS),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.unreadCount(),
        }),
      ])
    },
  })

  const handleMarkRead = async (notificationId: string) => {
    setMarkingNotificationId(notificationId)
    try {
      await markNotificationReadMutation.mutateAsync({ notificationId })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setMarkingNotificationId(null)
    }
  }

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    try {
      await markAllNotificationsReadMutation.mutateAsync()
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setMarkingAll(false)
    }
  }

  const reservationSummary = useMemo(() => {
    const now = new Date()

    const upcoming = reservations.filter(
      (item) =>
        ACTIVE_RESERVATION_STATUSES.includes(
          item.status as (typeof ACTIVE_RESERVATION_STATUSES)[number],
        ) && toDate(item.startTime) > now,
    )

    const pending = reservations.filter((item) => item.status === 'pending')
    const approved = reservations.filter(
      (item) => item.status === 'approved' || item.status === 'confirmed',
    )
    const completed = reservations.filter((item) => item.status === 'completed')
    const cancelled = reservations.filter(
      (item) => item.status === 'cancelled' || item.status === 'rejected',
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
    const reservationEvents: TimelineItem[] = reservationSummary.upcoming
      .slice(0, 6)
      .map((item) => ({
        id: `reservation-${item.id}`,
        title: item.machine.name,
        subtitle: `Reservation (${item.status})`,
        kind: 'reservation',
        startsAt: item.startTime,
      }))

    const checkoutEvents: TimelineItem[] = upcomingCheckoutAppointments
      .slice(0, 6)
      .map((item) => ({
        id: `checkout-${item.id}`,
        title: item.machine.name,
        subtitle:
          user.role === 'member'
            ? `Checkout with ${item.manager.name || item.manager.email}`
            : `Checkout for ${item.user.name || item.user.email}`,
        kind: 'checkout',
        startsAt: item.startTime,
      }))

    return [...reservationEvents, ...checkoutEvents]
      .sort(
        (left, right) =>
          toDate(left.startsAt).getTime() - toDate(right.startsAt).getTime(),
      )
      .slice(0, 10)
  }, [reservationSummary.upcoming, upcomingCheckoutAppointments, user.role])

  const queueItems = useMemo(() => {
    const approvalItems: QueueItem[] = pendingApprovals
      .slice(0, 8)
      .map((item) => ({
        id: `approval-${item.appointmentId}`,
        title: 'Checkout request pending',
        subtitle: `${item.user.name || item.user.email}`,
        description: `${item.machine.name} · ${formatCompact(item.startTime)}`,
        kind: 'approval',
        priority: 2,
        action: {
          label: 'Review queue',
          to: '/admin/checkouts',
        },
      }))

    const requestItems: QueueItem[] = pendingRequests
      .slice(0, 8)
      .map((item) => ({
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
        if (left.priority !== right.priority)
          return right.priority - left.priority
        if (!left.time && !right.time) return 0
        if (!left.time) return 1
        if (!right.time) return -1
        return toDate(right.time).getTime() - toDate(left.time).getTime()
      })
      .slice(0, 14)
  }, [notifications, pendingApprovals, pendingRequests])

  const readyMachines = machines.filter(
    (machine) => machine.eligibility.eligible,
  )
  const blockedMachines = machines.filter(
    (machine) => !machine.eligibility.eligible,
  )

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
      <div className='flex min-h-[60vh] items-center justify-center'>
        <div className='space-y-3 text-center'>
          <p className='text-sm font-medium'>Loading command center...</p>
          <Progress value={65} className='mx-auto h-2 w-40' />
        </div>
      </div>
    )
  }

  return (
    <main className='space-y-4 p-4 md:space-y-6 md:p-6 lg:p-8'>
      <div className='grid gap-4 xl:grid-cols-12'>
        <Card className='bg-card/80 xl:col-span-5'>
          <CardHeader>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>Action Queue</CardTitle>
                <CardDescription>
                  Most urgent tasks sorted by operational priority.
                </CardDescription>
              </div>
              <Badge variant='warning'>{filteredQueueItems.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className='space-y-2'>
            {filteredQueueItems.length > 0 ? (
              filteredQueueItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-lg border border-border/80 border-l-4 bg-background/60 p-3',
                    getQueueTone(item.kind),
                  )}
                >
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <p className='text-sm font-medium'>{item.title}</p>
                      <p className='text-xs text-muted-foreground'>
                        {item.subtitle}
                      </p>
                    </div>
                    {item.time && (
                      <p className='text-[11px] text-muted-foreground'>
                        {formatCompact(item.time)}
                      </p>
                    )}
                  </div>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {item.description}
                  </p>
                  {item.action && (
                    <Button
                      asChild
                      size='sm'
                      variant='ghost'
                      className='mt-2 h-7 px-0'
                    >
                      <Link
                        to={item.action.to as never}
                        params={item.action.params as never}
                        search={item.action.search as never}
                      >
                        {item.action.label}
                        <ChevronRight className='ml-1 h-3.5 w-3.5' />
                      </Link>
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                No queue items match your search.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
