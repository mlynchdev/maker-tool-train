import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  cancelCheckoutAppointment,
  finalizeCheckoutMeeting,
  moderateCheckoutRequest,
  moderateReservationRequest,
} from '~/server/api/admin'
import { queryKeys } from '~/lib/query/keys'
import {
  applyPendingCheckoutCountDecrement,
  applyPendingReservationRequestCountDecrement,
} from '~/lib/query/optimistic-admin'
import {
  notificationsListQueryOptions,
  pendingCheckoutsQueryOptions,
  pendingReservationRequestsQueryOptions,
} from '~/lib/query/options'
import type { AuthUser } from '~/server/auth/types'
import { cn } from '~/lib/utils'
import { Alert, AlertDescription } from '~/components/ui/alert'
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
import { Label } from '~/components/ui/label'
import { Progress } from '~/components/ui/progress'

interface DashboardProps {
  user: AuthUser
}

type DateValue = Date | string

interface QueueItem {
  id: string
  title: string
  subtitle: string
  description: string
  kind: 'request' | 'approval' | 'alert'
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

type AdminAction = 'approve' | 'deny' | 'pass' | 'fail' | 'cancel'

interface DashboardQueryState {
  isPending: boolean
  isFetching: boolean
  data: unknown
}

interface AdminActionEditorState {
  itemId: string
  action: AdminAction
  value: string
  confirmed: boolean
  error: string | null
}

const DASHBOARD_NOTIFICATION_OPTIONS = { unreadOnly: false, limit: 10 } as const

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

function actionRequiresValue(item: AdminActionItem, action: AdminAction) {
  return action === 'cancel' || (action === 'deny' && item.source === 'checkout')
}

function actionShowsValueInput(action: AdminAction) {
  return action !== 'approve'
}

function actionNeedsEarlyConfirmation(
  item: AdminActionItem,
  action: AdminAction,
) {
  return (
    item.source === 'checkout' &&
    (action === 'pass' || action === 'fail') &&
    toDate(item.startTime) > new Date()
  )
}

function getActionEditorCopy(item: AdminActionItem, action: AdminAction) {
  switch (action) {
    case 'approve':
      return {
        title:
          item.source === 'checkout'
            ? 'Approve checkout request'
            : 'Approve booking request',
        description:
          item.source === 'checkout'
            ? 'This request will move into the accepted checkout queue.'
            : 'This request will be approved for the member.',
        submitLabel: 'Confirm approval',
      }
    case 'deny':
      return {
        title:
          item.source === 'checkout'
            ? 'Deny checkout request'
            : 'Deny booking request',
        description:
          item.source === 'checkout'
            ? 'Checkout denials require a reason.'
            : 'A denial reason is optional for booking requests.',
        inputLabel: 'Denial reason',
        inputPlaceholder:
          item.source === 'checkout'
            ? 'Enter the reason for denying this checkout request'
            : 'Optional reason for denying this booking request',
        submitLabel: 'Submit denial',
      }
    case 'pass':
      return {
        title: 'Mark checkout as passed',
        description: 'Record a passing result for this checkout meeting.',
        inputLabel: 'Pass notes',
        inputPlaceholder: 'Optional notes for pass',
        submitLabel: 'Record pass',
      }
    case 'fail':
      return {
        title: 'Mark checkout as failed',
        description:
          'Record a failed result for this checkout meeting. The member can retry later.',
        inputLabel: 'Fail notes',
        inputPlaceholder: 'Optional notes for fail',
        submitLabel: 'Record fail',
      }
    case 'cancel':
      return {
        title: 'Cancel accepted checkout',
        description: 'A cancellation reason is required before this meeting can be cancelled.',
        inputLabel: 'Cancellation reason',
        inputPlaceholder: 'Enter the cancellation reason',
        submitLabel: 'Confirm cancellation',
      }
  }
}

export function Dashboard({ user }: DashboardProps) {
  const [actingActionId, setActingActionId] = useState<string | null>(null)
  const [actionEditor, setActionEditor] = useState<AdminActionEditorState | null>(
    null,
  )
  const queryClient = useQueryClient()

  const isAdmin = user.role === 'admin'

  const notificationsQuery = useQuery(
    {
      ...notificationsListQueryOptions(DASHBOARD_NOTIFICATION_OPTIONS),
      enabled: !isAdmin,
    },
  )
  const pendingApprovalsQuery = useQuery({
    ...pendingCheckoutsQueryOptions(),
    enabled: isAdmin,
  })
  const pendingRequestsQuery = useQuery({
    ...pendingReservationRequestsQueryOptions(),
    enabled: isAdmin,
  })

  const notifications = asArray(notificationsQuery.data?.notifications)
  const actionableCheckoutAppointments = asArray(
    pendingApprovalsQuery.data?.actionableAppointments,
  )
  const pendingRequests = asArray(pendingRequestsQuery.data?.requests)

  const visibleQueries: DashboardQueryState[] = isAdmin
    ? [pendingApprovalsQuery, pendingRequestsQuery]
    : [notificationsQuery]
  const hasVisibleData = visibleQueries.some((query) => typeof query.data !== 'undefined')
  const loading =
    !hasVisibleData &&
    visibleQueries.some((query) => query.isPending || query.isFetching)

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

  const openActionEditor = (item: AdminActionItem, action: AdminAction) => {
    setActionEditor({
      itemId: item.id,
      action,
      value: '',
      confirmed: !actionNeedsEarlyConfirmation(item, action),
      error: null,
    })
  }

  const handleActionEditorSubmit = async (item: AdminActionItem) => {
    if (!actionEditor || actionEditor.itemId !== item.id) return

    const trimmedValue = actionEditor.value.trim()

    if (actionRequiresValue(item, actionEditor.action) && !trimmedValue) {
      setActionEditor({
        ...actionEditor,
        error:
          actionEditor.action === 'cancel'
            ? 'Cancellation reason is required.'
            : 'Denial reason is required for checkout requests.',
      })
      return
    }

    if (
      actionNeedsEarlyConfirmation(item, actionEditor.action) &&
      !actionEditor.confirmed
    ) {
      setActionEditor({
        ...actionEditor,
        error: `Confirm recording a ${actionEditor.action} result before the meeting starts.`,
      })
      return
    }

    const nextActingActionId = `${item.id}:${actionEditor.action}`
    setActingActionId(nextActingActionId)

    try {
      if (actionEditor.action === 'approve' || actionEditor.action === 'deny') {
        if (item.source === 'checkout') {
          await moderateCheckoutMutation.mutateAsync({
            appointmentId: item.appointmentId,
            decision: actionEditor.action === 'approve' ? 'accept' : 'reject',
            reason: trimmedValue || undefined,
          })
        } else {
          await moderateBookingMutation.mutateAsync({
            reservationId: item.reservationId,
            decision: actionEditor.action === 'approve' ? 'approve' : 'reject',
            reason: trimmedValue || undefined,
          })
        }
      } else if (actionEditor.action === 'pass' || actionEditor.action === 'fail') {
        if (item.source !== 'checkout') return

        await finalizeCheckoutMutation.mutateAsync({
          appointmentId: item.appointmentId,
          result: actionEditor.action,
          notes: trimmedValue || undefined,
        })
      } else {
        if (item.source !== 'checkout') return

        await cancelAcceptedCheckoutMutation.mutateAsync({
          appointmentId: item.appointmentId,
          reason: trimmedValue,
        })
      }

      setActionEditor(null)
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingActionId(null)
    }
  }

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
                {isAdmin ? adminActionItems.length : queueItems.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isAdmin ? (
              adminActionItems.length > 0 ? (
                adminActionItems.map((item) => {
                  const approving = actingActionId === `${item.id}:approve`
                  const denying = actingActionId === `${item.id}:deny`
                  const passing = actingActionId === `${item.id}:pass`
                  const failing = actingActionId === `${item.id}:fail`
                  const cancelling = actingActionId === `${item.id}:cancel`
                  const isAcceptedCheckout =
                    item.source === 'checkout' && item.checkoutStatus === 'accepted'
                  const currentEditor =
                    actionEditor?.itemId === item.id ? actionEditor : null
                  const editorCopy = currentEditor
                    ? getActionEditorCopy(item, currentEditor.action)
                    : null
                  const editorShowsInput = currentEditor
                    ? actionShowsValueInput(currentEditor.action)
                    : false
                  const editorNeedsConfirmation = currentEditor
                    ? actionNeedsEarlyConfirmation(item, currentEditor.action)
                    : false
                  const editorSubmitting = currentEditor
                    ? actingActionId === `${item.id}:${currentEditor.action}`
                    : false

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

                      {currentEditor ? (
                        <form
                          className='mt-3 space-y-3 rounded-lg border border-border/80 bg-background/80 p-3'
                          onSubmit={(event) => {
                            event.preventDefault()
                            void handleActionEditorSubmit(item)
                          }}
                        >
                          <div className='space-y-1'>
                            <p className='text-sm font-medium'>{editorCopy?.title}</p>
                            <p className='text-xs text-muted-foreground'>
                              {editorCopy?.description}
                            </p>
                          </div>

                          {editorShowsInput && editorCopy?.inputLabel && (
                            <div className='space-y-2'>
                              <Label htmlFor={`${item.id}-${currentEditor.action}-value`}>
                                {editorCopy.inputLabel}
                              </Label>
                              <Input
                                id={`${item.id}-${currentEditor.action}-value`}
                                value={currentEditor.value}
                                placeholder={editorCopy.inputPlaceholder}
                                disabled={editorSubmitting}
                                onChange={(event) => {
                                  setActionEditor({
                                    ...currentEditor,
                                    value: event.target.value,
                                    error: null,
                                  })
                                }}
                              />
                            </div>
                          )}

                          {editorNeedsConfirmation && (
                            <label
                              className='flex items-start gap-2 text-xs text-muted-foreground'
                              htmlFor={`${item.id}-${currentEditor.action}-confirm`}
                            >
                              <input
                                id={`${item.id}-${currentEditor.action}-confirm`}
                                type='checkbox'
                                checked={currentEditor.confirmed}
                                disabled={editorSubmitting}
                                onChange={(event) => {
                                  setActionEditor({
                                    ...currentEditor,
                                    confirmed: event.target.checked,
                                    error: null,
                                  })
                                }}
                              />
                              <span>
                                This meeting starts {formatDateTime(item.startTime)}.
                                Confirm that you want to record a{' '}
                                {currentEditor.action} result before it begins.
                              </span>
                            </label>
                          )}

                          {currentEditor.error && (
                            <Alert variant='destructive' className='py-3'>
                              <AlertDescription>
                                {currentEditor.error}
                              </AlertDescription>
                            </Alert>
                          )}

                          <div className='flex flex-wrap gap-2'>
                            <Button size='sm' type='submit' disabled={editorSubmitting}>
                              {editorSubmitting
                                ? 'Saving...'
                                : (editorCopy?.submitLabel ?? 'Save')}
                            </Button>
                            <Button
                              size='sm'
                              type='button'
                              variant='secondary'
                              disabled={editorSubmitting}
                              onClick={() => setActionEditor(null)}
                            >
                              Back
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          {isAcceptedCheckout ? (
                            <div className='mt-3 grid grid-cols-3 gap-2 sm:max-w-md'>
                              <Button
                                size='sm'
                                onClick={() => openActionEditor(item, 'pass')}
                                disabled={passing || failing || cancelling}
                              >
                                {passing ? 'Saving...' : 'Pass'}
                              </Button>
                              <Button
                                size='sm'
                                variant='destructive'
                                onClick={() => openActionEditor(item, 'fail')}
                                disabled={passing || failing || cancelling}
                              >
                                {failing ? 'Saving...' : 'Fail'}
                              </Button>
                              <Button
                                size='sm'
                                variant='secondary'
                                onClick={() => openActionEditor(item, 'cancel')}
                                disabled={passing || failing || cancelling}
                              >
                                {cancelling ? 'Saving...' : 'Cancel'}
                              </Button>
                            </div>
                          ) : (
                            <div className='mt-3 grid grid-cols-2 gap-2 sm:max-w-xs'>
                              <Button
                                size='sm'
                                onClick={() => openActionEditor(item, 'approve')}
                                disabled={approving || denying}
                              >
                                {approving ? 'Approving...' : 'Approve'}
                              </Button>
                              <Button
                                size='sm'
                                variant='destructive'
                                onClick={() => openActionEditor(item, 'deny')}
                                disabled={approving || denying}
                              >
                                {denying ? 'Denying...' : 'Deny'}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </article>
                  )
                })
              ) : (
                <p className='text-sm text-muted-foreground'>
                  No actionable booking or checkout items.
                </p>
              )
            ) : queueItems.length > 0 ? (
              queueItems.map((item) => (
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
                No unread operational alerts.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
