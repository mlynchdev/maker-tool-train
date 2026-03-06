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
import {
  cancelCheckoutAppointment,
  finalizeCheckoutMeeting,
  moderateCheckoutRequest,
  moderateReservationRequest,
} from '~/server/api/admin'
import type { getNotifications } from '~/server/api/notifications'
import { queryKeys } from '~/lib/query/keys'
import {
  applyPendingCheckoutCountDecrement,
  applyPendingReservationRequestCountDecrement,
} from '~/lib/query/optimistic-admin'
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

type AdminActionItem =
  | {
      id: string
      source: 'booking'
      reservationId: string
      requestedAt: DateValue
      memberName: string
      memberEmail: string
      machineName: string
      startTime: DateValue
      endTime: DateValue
    }
  | {
      id: string
      source: 'checkout'
      appointmentId: string
      checkoutStatus: 'pending' | 'accepted'
      requestedAt: DateValue
      memberName: string
      memberEmail: string
      machineName: string
      managerName: string
      reviewerName?: string | null
      startTime: DateValue
      endTime: DateValue
    }

interface PendingCheckoutListData {
  pendingApprovals: Array<{ appointmentId: string }>
  actionableAppointments?: Array<{
    appointmentId: string
    status: 'pending' | 'accepted'
  }>
}

interface PendingReservationRequestListData {
  requests: Array<{ id: string }>
}

interface DashboardQueryState {
  isPending: boolean
  isFetching: boolean
  dataUpdatedAt: number
  data: unknown
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

function getAdminQueueTone(source: AdminActionItem['source']) {
  if (source === 'booking') return 'border-l-amber-500'
  return 'border-l-sky-500'
}

function formatDuration(start: DateValue, end: DateValue) {
  const minutes = Math.max(
    0,
    Math.round((toDate(end).getTime() - toDate(start).getTime()) / 60000),
  )
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}

export function Dashboard({ user }: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [actingActionId, setActingActionId] = useState<string | null>(null)
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
  const actionableCheckoutAppointments = asArray(
    pendingApprovalsQuery.data?.actionableAppointments,
  )
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

  const moderateCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Unable to update checkout request',
    },
    mutationFn: async (variables: {
      appointmentId: string
      decision: 'accept' | 'reject'
      reason?: string
    }) => {
      const result = await moderateCheckoutRequest({
        data: variables,
      })

      if (!result.success) {
        throw new Error(result.error || 'Unable to update checkout request')
      }

      return result
    },
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingCheckoutCount(),
        }),
      ])

      const previousPendingApprovals =
        queryClient.getQueryData<PendingCheckoutListData>(
          queryKeys.admin.pendingCheckouts(),
        )
      const previousPendingCheckoutCount = queryClient.getQueryData<{
        count: number
      }>(queryKeys.admin.pendingCheckoutCount())

      queryClient.setQueryData<PendingCheckoutListData>(
        queryKeys.admin.pendingCheckouts(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            pendingApprovals: current.pendingApprovals.filter(
              (item) => item.appointmentId !== variables.appointmentId,
            ),
            actionableAppointments: current.actionableAppointments?.flatMap(
              (item) => {
                if (item.appointmentId !== variables.appointmentId) {
                  return [item]
                }

                if (variables.decision === 'accept') {
                  return [{ ...item, status: 'accepted' as const }]
                }

                return []
              },
            ),
          }
        },
      )

      queryClient.setQueryData<{ count: number }>(
        queryKeys.admin.pendingCheckoutCount(),
        applyPendingCheckoutCountDecrement,
      )

      return {
        previousPendingApprovals,
        previousPendingCheckoutCount,
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPendingApprovals) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckouts(),
          context.previousPendingApprovals,
        )
      }
      if (context?.previousPendingCheckoutCount) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckoutCount(),
          context.previousPendingCheckoutCount,
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckoutCount(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.checkouts(),
        }),
      ])
    },
  })

  const moderateBookingMutation = useMutation({
    meta: {
      errorMessage: 'Unable to update booking request',
    },
    mutationFn: async (variables: {
      reservationId: string
      decision: 'approve' | 'reject'
      reason?: string
    }) => {
      const result = await moderateReservationRequest({
        data: variables,
      })

      if (!result.success) {
        throw new Error(result.error || 'Unable to update booking request')
      }

      return result
    },
    onMutate: async (variables) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingReservationRequests(),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingReservationRequestCount(),
        }),
      ])

      const previousPendingRequests =
        queryClient.getQueryData<PendingReservationRequestListData>(
          queryKeys.admin.pendingReservationRequests(),
        )
      const previousPendingRequestCount = queryClient.getQueryData<{
        count: number
      }>(queryKeys.admin.pendingReservationRequestCount())

      queryClient.setQueryData<PendingReservationRequestListData>(
        queryKeys.admin.pendingReservationRequests(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            requests: current.requests.filter(
              (item) => item.id !== variables.reservationId,
            ),
          }
        },
      )

      queryClient.setQueryData<{ count: number }>(
        queryKeys.admin.pendingReservationRequestCount(),
        applyPendingReservationRequestCountDecrement,
      )

      return {
        previousPendingRequests,
        previousPendingRequestCount,
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPendingRequests) {
        queryClient.setQueryData(
          queryKeys.admin.pendingReservationRequests(),
          context.previousPendingRequests,
        )
      }
      if (context?.previousPendingRequestCount) {
        queryClient.setQueryData(
          queryKeys.admin.pendingReservationRequestCount(),
          context.previousPendingRequestCount,
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingReservationRequests(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingReservationRequestCount(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.bookingRequests(),
        }),
      ])
    },
  })

  const finalizeCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Unable to finalize checkout meeting',
    },
    mutationFn: async (variables: {
      appointmentId: string
      result: 'pass' | 'fail'
      notes?: string
    }) => {
      const result = await finalizeCheckoutMeeting({
        data: variables,
      })

      if (!result.success) {
        throw new Error(result.error || 'Unable to finalize checkout meeting')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.admin.pendingCheckouts(),
      })

      const previousPendingApprovals =
        queryClient.getQueryData<PendingCheckoutListData>(
          queryKeys.admin.pendingCheckouts(),
        )

      queryClient.setQueryData<PendingCheckoutListData>(
        queryKeys.admin.pendingCheckouts(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            actionableAppointments: current.actionableAppointments?.filter(
              (item) => item.appointmentId !== variables.appointmentId,
            ),
          }
        },
      )

      return { previousPendingApprovals }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPendingApprovals) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckouts(),
          context.previousPendingApprovals,
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.checkouts(),
        }),
      ])
    },
  })

  const cancelAcceptedCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Unable to cancel checkout meeting',
    },
    mutationFn: async (variables: { appointmentId: string; reason: string }) => {
      const result = await cancelCheckoutAppointment({
        data: variables,
      })

      if (!result.success) {
        throw new Error(result.error || 'Unable to cancel checkout meeting')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.admin.pendingCheckouts(),
      })

      const previousPendingApprovals =
        queryClient.getQueryData<PendingCheckoutListData>(
          queryKeys.admin.pendingCheckouts(),
        )

      queryClient.setQueryData<PendingCheckoutListData>(
        queryKeys.admin.pendingCheckouts(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            actionableAppointments: current.actionableAppointments?.filter(
              (item) => item.appointmentId !== variables.appointmentId,
            ),
          }
        },
      )

      return { previousPendingApprovals }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPendingApprovals) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckouts(),
          context.previousPendingApprovals,
        )
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.checkouts(),
        }),
      ])
    },
  })

  const handleModerateAction = async (
    item: AdminActionItem,
    decision: 'approve' | 'deny',
  ) => {
    let reason: string | undefined

    if (decision === 'deny') {
      const promptLabel =
        item.source === 'checkout'
          ? 'Denial reason (required):'
          : 'Denial reason (optional):'
      const rawValue = prompt(promptLabel)
      if (rawValue === null) {
        return
      }
      const value = rawValue.trim()

      if (item.source === 'checkout' && !value) {
        return
      }

      reason = value || undefined
    }

    const nextActingActionId = `${item.id}:${decision}`
    setActingActionId(nextActingActionId)

    try {
      if (item.source === 'checkout') {
        await moderateCheckoutMutation.mutateAsync({
          appointmentId: item.appointmentId,
          decision: decision === 'approve' ? 'accept' : 'reject',
          reason,
        })
      } else {
        await moderateBookingMutation.mutateAsync({
          reservationId: item.reservationId,
          decision: decision === 'approve' ? 'approve' : 'reject',
          reason,
        })
      }
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingActionId(null)
    }
  }

  const handleFinalizeCheckoutAction = async (
    item: Extract<AdminActionItem, { source: 'checkout' }>,
    resultType: 'pass' | 'fail',
  ) => {
    const startTime = toDate(item.startTime)

    if (startTime > new Date()) {
      const confirmed = confirm(
        `This meeting is scheduled for ${formatDateTime(
          startTime,
        )} and has not started yet. Record a ${resultType} result now?`,
      )
      if (!confirmed) return
    }

    const notes = prompt(
      resultType === 'pass'
        ? 'Optional notes for pass:'
        : 'Optional notes for fail (member can retry later):',
    )
    if (notes === null) return

    const nextActingActionId = `${item.id}:${resultType}`
    setActingActionId(nextActingActionId)

    try {
      await finalizeCheckoutMutation.mutateAsync({
        appointmentId: item.appointmentId,
        result: resultType,
        notes: notes.trim() || undefined,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingActionId(null)
    }
  }

  const handleCancelAcceptedCheckoutAction = async (
    item: Extract<AdminActionItem, { source: 'checkout' }>,
  ) => {
    const reason = prompt('Cancellation reason (required):')
    if (reason === null || !reason.trim()) return

    const nextActingActionId = `${item.id}:cancel`
    setActingActionId(nextActingActionId)

    try {
      await cancelAcceptedCheckoutMutation.mutateAsync({
        appointmentId: item.appointmentId,
        reason: reason.trim(),
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingActionId(null)
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

  const adminActionItems = useMemo(() => {
    if (!isAdmin) return []

    const bookingItems: AdminActionItem[] = pendingRequests.map((item) => ({
      id: `booking-${item.id}`,
      source: 'booking',
      reservationId: item.id,
      requestedAt: item.createdAt,
      memberName: item.user.name || item.user.email,
      memberEmail: item.user.email,
      machineName: item.machine.name,
      startTime: item.startTime,
      endTime: item.endTime,
    }))

    const checkoutItems: AdminActionItem[] = actionableCheckoutAppointments
      .filter(
        (item) => item.status === 'pending' || item.status === 'accepted',
      )
      .map((item) => ({
        id: `checkout-${item.appointmentId}`,
        source: 'checkout',
        appointmentId: item.appointmentId,
        checkoutStatus: item.status as 'pending' | 'accepted',
        requestedAt: item.createdAt,
        memberName: item.user.name || item.user.email,
        memberEmail: item.user.email,
        machineName: item.machine.name,
        managerName: item.manager.name || item.manager.email,
        reviewerName: item.reviewer?.name || item.reviewer?.email || null,
        startTime: item.startTime,
        endTime: item.endTime,
      }))

    return [...bookingItems, ...checkoutItems].sort(
      (left, right) =>
        toDate(left.requestedAt).getTime() - toDate(right.requestedAt).getTime(),
    )
  }, [actionableCheckoutAppointments, isAdmin, pendingRequests])

  const queueItems = useMemo(() => {
    if (isAdmin) return []

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

    return alertItems
      .sort((left, right) => {
        if (!left.time && !right.time) return 0
        if (!left.time) return 1
        if (!right.time) return -1
        return toDate(right.time).getTime() - toDate(left.time).getTime()
      })
      .slice(0, 14)
  }, [isAdmin, notifications])

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

  const filteredAdminActionItems = adminActionItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.trim().toLowerCase()

    return (
      item.machineName.toLowerCase().includes(query) ||
      item.memberName.toLowerCase().includes(query) ||
      item.memberEmail.toLowerCase().includes(query) ||
      (item.source === 'checkout' &&
        (item.managerName.toLowerCase().includes(query) ||
          item.checkoutStatus.toLowerCase().includes(query) ||
          (item.reviewerName || '').toLowerCase().includes(query)))
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
        <Card className='bg-card/80 xl:col-span-12'>
          <CardHeader>
            <div className='flex items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>Action Queue</CardTitle>
                <CardDescription>
                  {isAdmin
                    ? 'All admin-actionable booking and checkout items, sorted by request time.'
                    : 'Unread operational alerts.'}
                </CardDescription>
              </div>
              <Badge variant='warning'>
                {isAdmin
                  ? filteredAdminActionItems.length
                  : filteredQueueItems.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isAdmin ? (
              filteredAdminActionItems.length > 0 ? (
                filteredAdminActionItems.map((item) => {
                  const approving = actingActionId === `${item.id}:approve`
                  const denying = actingActionId === `${item.id}:deny`
                  const passing = actingActionId === `${item.id}:pass`
                  const failing = actingActionId === `${item.id}:fail`
                  const cancelling = actingActionId === `${item.id}:cancel`
                  const isAcceptedCheckout =
                    item.source === 'checkout' && item.checkoutStatus === 'accepted'

                  return (
                    <article
                      key={item.id}
                      className={cn(
                        'rounded-xl border border-border/80 border-l-4 bg-background/60 p-3 sm:p-4',
                        getAdminQueueTone(item.source),
                      )}
                    >
                      <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div className='space-y-1'>
                          <div className='flex flex-wrap items-center gap-2'>
                            <Badge
                              variant={
                                item.source === 'booking'
                                  ? 'warning'
                                  : isAcceptedCheckout
                                    ? 'success'
                                    : 'info'
                              }
                            >
                              {item.source === 'booking'
                                ? 'Booking Request'
                                : isAcceptedCheckout
                                  ? 'Checkout Accepted'
                                  : 'Checkout Request'}
                            </Badge>
                            <span className='text-xs text-muted-foreground'>
                              Requested {formatCompact(item.requestedAt)}
                            </span>
                          </div>
                          <p className='text-sm font-semibold'>
                            {item.machineName}
                          </p>
                          <p className='text-xs text-muted-foreground'>
                            {item.memberName}
                            {item.memberName !== item.memberEmail
                              ? ` (${item.memberEmail})`
                              : ''}
                          </p>
                          {item.source === 'checkout' && (
                            <p className='text-xs text-muted-foreground'>
                              Manager: {item.managerName}
                              {item.reviewerName && isAcceptedCheckout
                                ? ` · Accepted by ${item.reviewerName}`
                                : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className='mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2'>
                        <p>Start: {formatDateTime(item.startTime)}</p>
                        <p>End: {formatDateTime(item.endTime)}</p>
                        <p>
                          Duration: {formatDuration(item.startTime, item.endTime)}
                        </p>
                      </div>

                      {isAcceptedCheckout ? (
                        <div className='mt-3 grid grid-cols-3 gap-2 sm:max-w-md'>
                          <Button
                            size='sm'
                            onClick={() => {
                              void handleFinalizeCheckoutAction(item, 'pass')
                            }}
                            disabled={passing || failing || cancelling}
                          >
                            {passing ? 'Saving...' : 'Pass'}
                          </Button>
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() => {
                              void handleFinalizeCheckoutAction(item, 'fail')
                            }}
                            disabled={passing || failing || cancelling}
                          >
                            {failing ? 'Saving...' : 'Fail'}
                          </Button>
                          <Button
                            size='sm'
                            variant='secondary'
                            onClick={() => {
                              void handleCancelAcceptedCheckoutAction(item)
                            }}
                            disabled={passing || failing || cancelling}
                          >
                            {cancelling ? 'Saving...' : 'Cancel'}
                          </Button>
                        </div>
                      ) : (
                        <div className='mt-3 grid grid-cols-2 gap-2 sm:max-w-xs'>
                          <Button
                            size='sm'
                            onClick={() => {
                              void handleModerateAction(item, 'approve')
                            }}
                            disabled={approving || denying}
                          >
                            {approving ? 'Approving...' : 'Approve'}
                          </Button>
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() => {
                              void handleModerateAction(item, 'deny')
                            }}
                            disabled={approving || denying}
                          >
                            {denying ? 'Denying...' : 'Deny'}
                          </Button>
                        </div>
                      )}
                    </article>
                  )
                })
              ) : (
                <p className='text-sm text-muted-foreground'>
                  No actionable booking or checkout items.
                </p>
              )
            ) : filteredQueueItems.length > 0 ? (
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
