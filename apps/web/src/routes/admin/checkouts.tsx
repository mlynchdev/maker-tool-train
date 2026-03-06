import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, eq, inArray } from 'drizzle-orm'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { queryKeys } from '~/lib/query/keys'
import {
  applyCheckoutModerationOptimistic,
  applyCheckoutQueueRemovalOptimistic,
  applyPendingCheckoutCountDecrement,
  applyPendingCheckoutRemoval,
  type PendingCheckoutCountData,
  type PendingCheckoutsData,
} from '~/lib/query/optimistic-admin'
import { checkoutAppointments, db } from '~/lib/db'
import {
  cancelCheckoutAppointment,
  createCheckoutAvailabilityBlock,
  deactivateCheckoutAvailabilityBlock,
  finalizeCheckoutMeeting,
  moderateCheckoutRequest,
} from '~/server/api/admin'
import { requireAdmin } from '~/server/auth/middleware'
import { getAdminCheckoutAvailability } from '~/server/services/checkout-scheduling'
import { getMakerspaceTimezone } from '~/server/services/makerspace-settings'

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const

const CHECKOUT_QUEUE_STATUSES = ['pending', 'accepted', 'rejected'] as const
type CheckoutQueueStatus = (typeof CHECKOUT_QUEUE_STATUSES)[number]
type QueueFilter = 'all' | CheckoutQueueStatus

function formatMinuteOfDay(value: number) {
  const hours24 = Math.floor(value / 60)
  const minutes = value % 60
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${`${minutes}`.padStart(2, '0')} ${suffix}`
}

function matchesCheckoutSearchQuery(
  item: CheckoutsData['checkoutQueue'][number],
  rawQuery: string
) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const values = [
    item.user.name || '',
    item.user.email,
    item.machine.name,
    item.manager.name || '',
    item.manager.email,
    item.decisionReason || '',
    item.status,
  ]

  return values.some((value) => value.toLowerCase().includes(query))
}

const getCheckoutsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAdmin()

  const [queueItems, checkoutAvailability] = await Promise.all([
    db.query.checkoutAppointments.findMany({
      where: inArray(checkoutAppointments.status, [...CHECKOUT_QUEUE_STATUSES]),
      with: {
        user: true,
        machine: true,
        manager: true,
        reviewer: true,
        resultedByUser: true,
      },
      orderBy: [asc(checkoutAppointments.startTime)],
      limit: 400,
    }),
    getAdminCheckoutAvailability({
      managerId: user.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }),
  ])

  return {
    user,
    makerspaceTimezone: await getMakerspaceTimezone(),
    checkoutQueue: queueItems,
    checkoutAvailabilityRules: checkoutAvailability.rules,
  }
})

type CheckoutsData = Awaited<ReturnType<typeof getCheckoutsData>>

const checkoutsDataQueryOptions = queryOptions({
  queryKey: queryKeys.admin.checkouts(),
  queryFn: () => getCheckoutsData(),
})

export const Route = createFileRoute('/admin/checkouts')({
  component: CheckoutsPage,
})

function CheckoutsPage() {
  const queryClient = useQueryClient()
  const checkoutsQuery = useQuery(checkoutsDataQueryOptions)

  const [queueFilter, setQueueFilter] = useState<QueueFilter>('pending')
  const [queueSearch, setQueueSearch] = useState('')
  const [actingId, setActingId] = useState<string | null>(null)

  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState(6)
  const [ruleStartTime, setRuleStartTime] = useState('14:00')
  const [ruleEndTime, setRuleEndTime] = useState('22:00')
  const [ruleNotes, setRuleNotes] = useState('')

  const [creatingRule, setCreatingRule] = useState(false)
  const [deactivatingRuleId, setDeactivatingRuleId] = useState<string | null>(null)
  const [availabilityMessage, setAvailabilityMessage] = useState('')

  const checkoutQueue = checkoutsQuery.data?.checkoutQueue ?? []
  const availabilityRules = checkoutsQuery.data?.checkoutAvailabilityRules ?? []
  const makerspaceTimezone = checkoutsQuery.data?.makerspaceTimezone ?? 'UTC'

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: makerspaceTimezone,
    })

  const getStatusBadgeClass = (status: string) => {
    if (status === 'pending') return 'badge badge-warning'
    if (status === 'accepted') return 'badge badge-success'
    if (status === 'rejected') return 'badge badge-danger'
    if (status === 'completed') return 'badge badge-info'
    if (status === 'cancelled') return 'badge badge-secondary'
    return 'badge badge-danger'
  }

  const refreshAdminData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.checkouts() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckoutCount() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckouts() }),
    ])
  }, [queryClient])

  const moderateRequestMutation = useMutation({
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
        queryClient.cancelQueries({ queryKey: queryKeys.admin.checkouts() }),
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingCheckoutCount(),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.admin.pendingCheckouts(),
        }),
      ])

      const previousCheckouts = queryClient.getQueryData<CheckoutsData>(
        queryKeys.admin.checkouts()
      )
      const previousPendingCount =
        queryClient.getQueryData<PendingCheckoutCountData>(
          queryKeys.admin.pendingCheckoutCount()
        )
      const previousPendingCheckouts =
        queryClient.getQueryData<PendingCheckoutsData>(
          queryKeys.admin.pendingCheckouts()
        )

      queryClient.setQueryData<CheckoutsData>(
        queryKeys.admin.checkouts(),
        (current) => applyCheckoutModerationOptimistic(current, variables)
      )

      queryClient.setQueryData<PendingCheckoutCountData>(
        queryKeys.admin.pendingCheckoutCount(),
        applyPendingCheckoutCountDecrement
      )
      queryClient.setQueryData<PendingCheckoutsData>(
        queryKeys.admin.pendingCheckouts(),
        (current) => applyPendingCheckoutRemoval(current, variables.appointmentId)
      )

      return {
        previousCheckouts,
        previousPendingCount,
        previousPendingCheckouts,
      }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousCheckouts) {
        queryClient.setQueryData(
          queryKeys.admin.checkouts(),
          context.previousCheckouts
        )
      }
      if (context?.previousPendingCount) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckoutCount(),
          context.previousPendingCount
        )
      }
      if (context?.previousPendingCheckouts) {
        queryClient.setQueryData(
          queryKeys.admin.pendingCheckouts(),
          context.previousPendingCheckouts
        )
      }
    },
    onSettled: () => {
      void refreshAdminData()
    },
  })

  const finalizeMeetingMutation = useMutation({
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
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.checkouts() })
      const previousCheckouts = queryClient.getQueryData<CheckoutsData>(
        queryKeys.admin.checkouts()
      )

      queryClient.setQueryData<CheckoutsData>(
        queryKeys.admin.checkouts(),
        (current) => applyCheckoutQueueRemovalOptimistic(current, variables.appointmentId)
      )

      return { previousCheckouts }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousCheckouts) {
        queryClient.setQueryData(
          queryKeys.admin.checkouts(),
          context.previousCheckouts
        )
      }
    },
    onSettled: () => {
      void refreshAdminData()
    },
  })

  const cancelMeetingMutation = useMutation({
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
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.checkouts() })
      const previousCheckouts = queryClient.getQueryData<CheckoutsData>(
        queryKeys.admin.checkouts()
      )

      queryClient.setQueryData<CheckoutsData>(
        queryKeys.admin.checkouts(),
        (current) => applyCheckoutQueueRemovalOptimistic(current, variables.appointmentId)
      )

      return { previousCheckouts }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousCheckouts) {
        queryClient.setQueryData(
          queryKeys.admin.checkouts(),
          context.previousCheckouts
        )
      }
    },
    onSettled: () => {
      void refreshAdminData()
    },
  })

  const handleModerateRequest = async (
    appointmentId: string,
    decision: 'accept' | 'reject'
  ) => {
    let reason: string | undefined

    if (decision === 'reject') {
      const value = prompt('Rejection reason (required):')?.trim()
      if (!value) return
      reason = value
    }

    setActingId(`${appointmentId}:${decision}`)

    try {
      await moderateRequestMutation.mutateAsync({
        appointmentId,
        decision,
        reason,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingId(null)
    }
  }

  const handleFinalize = async (
    appointmentId: string,
    resultType: 'pass' | 'fail',
    startTime: Date
  ) => {
    if (startTime > new Date()) {
      const confirmed = confirm(
        `This meeting is scheduled for ${formatDateTime(
          startTime
        )} and has not started yet. Record a ${resultType} result now?`
      )
      if (!confirmed) return
    }

    const notes = prompt(
      resultType === 'pass'
        ? 'Optional notes for pass:'
        : 'Optional notes for fail (member can retry later):'
    )

    setActingId(`${appointmentId}:${resultType}`)

    try {
      await finalizeMeetingMutation.mutateAsync({
        appointmentId,
        result: resultType,
        notes: notes?.trim() || undefined,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingId(null)
    }
  }

  const handleCancelAcceptedMeeting = async (appointmentId: string) => {
    const reason = prompt('Cancellation reason (required):')?.trim()
    if (!reason) return

    setActingId(`${appointmentId}:cancel`)

    try {
      await cancelMeetingMutation.mutateAsync({
        appointmentId,
        reason,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setActingId(null)
    }
  }

  const handleCreateAvailabilityRule = async (e: FormEvent) => {
    e.preventDefault()
    setCreatingRule(true)
    setAvailabilityMessage('')

    try {
      const result = await createCheckoutAvailabilityBlock({
        data: {
          dayOfWeek: selectedDayOfWeek,
          startTime: ruleStartTime,
          endTime: ruleEndTime,
          notes: ruleNotes || undefined,
        },
      })

      if (!result.success) {
        setAvailabilityMessage(result.error || 'Failed to create availability rule.')
        return
      }

      queryClient.setQueryData<CheckoutsData>(
        queryKeys.admin.checkouts(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            checkoutAvailabilityRules: [...current.checkoutAvailabilityRules, result.data].sort(
              (left, right) => {
                if (left.dayOfWeek !== right.dayOfWeek) {
                  return left.dayOfWeek - right.dayOfWeek
                }
                return left.startMinuteOfDay - right.startMinuteOfDay
              }
            ),
          }
        }
      )

      setRuleNotes('')
      setAvailabilityMessage('Recurring availability rule created.')
      void refreshAdminData()
    } catch {
      setAvailabilityMessage('Failed to create availability rule.')
    } finally {
      setCreatingRule(false)
    }
  }

  const handleDeactivateAvailabilityRule = async (ruleId: string) => {
    setDeactivatingRuleId(ruleId)
    setAvailabilityMessage('')

    try {
      const result = await deactivateCheckoutAvailabilityBlock({
        data: { ruleId },
      })

      if (!result.success) {
        setAvailabilityMessage(result.error || 'Failed to deactivate rule.')
        return
      }

      queryClient.setQueryData<CheckoutsData>(
        queryKeys.admin.checkouts(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            checkoutAvailabilityRules: current.checkoutAvailabilityRules.map((rule) =>
              rule.id === ruleId ? { ...rule, active: false, updatedAt: new Date() } : rule
            ),
          }
        }
      )

      void refreshAdminData()
    } catch {
      setAvailabilityMessage('Failed to deactivate rule.')
    } finally {
      setDeactivatingRuleId(null)
    }
  }

  const filteredQueue = useMemo(() => {
    return checkoutQueue.filter((item) => {
      if (queueFilter !== 'all' && item.status !== queueFilter) {
        return false
      }

      return matchesCheckoutSearchQuery(item, queueSearch)
    })
  }, [checkoutQueue, queueFilter, queueSearch])

  const counts = useMemo(() => {
    let pending = 0
    let accepted = 0
    let rejected = 0

    for (const item of checkoutQueue) {
      if (item.status === 'pending') pending++
      if (item.status === 'accepted') accepted++
      if (item.status === 'rejected') rejected++
    }

    return {
      pending,
      accepted,
      rejected,
      total: checkoutQueue.length,
    }
  }, [checkoutQueue])

  if (checkoutsQuery.isPending && typeof checkoutsQuery.data === 'undefined') {
    return <QueryLoadingScreen message="Loading checkout queue..." />
  }

  if (checkoutsQuery.isError && typeof checkoutsQuery.data === 'undefined') {
    return (
      <QueryErrorScreen
        message="Unable to load checkout queue."
        onRetry={() => {
          void checkoutsQuery.refetch()
        }}
      />
    )
  }

  return (
    <div>
      <main className='main'>
        <div className='container'>
          <div className='card mb-2'>
            <div
              className='flex flex-between flex-center'
              style={{ flexWrap: 'wrap', gap: '0.75rem' }}
            >
              <div className='flex gap-1' style={{ flexWrap: 'wrap' }}>
                <span className='badge badge-warning'>{counts.pending} pending</span>
                <span className='badge badge-success'>{counts.accepted} accepted</span>
                <span className='badge badge-danger'>{counts.rejected} rejected</span>
                <span className='badge badge-info'>{counts.total} total</span>
              </div>

              <input
                type='text'
                className='form-input'
                style={{ minWidth: '240px' }}
                placeholder='Search member, machine, manager'
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
              />
            </div>

            <div className='flex gap-1 mt-2' style={{ flexWrap: 'wrap' }}>
              <button
                className={`btn ${queueFilter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQueueFilter('pending')}
              >
                Pending
              </button>
              <button
                className={`btn ${queueFilter === 'accepted' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQueueFilter('accepted')}
              >
                Accepted
              </button>
              <button
                className={`btn ${queueFilter === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQueueFilter('rejected')}
              >
                Rejected
              </button>
              <button
                className={`btn ${queueFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setQueueFilter('all')}
              >
                All
              </button>
              <button className='btn btn-secondary' onClick={() => void refreshAdminData()}>
                Refresh
              </button>
            </div>
          </div>

          <div className='card mb-3'>
            <h3 className='card-title mb-2'>Checkout Request Queue</h3>
            {filteredQueue.length > 0 ? (
              <div className='table-wrapper'>
                <table className='table table-mobile-cards'>
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Member</th>
                      <th>Machine</th>
                      <th>Start</th>
                      <th>Manager</th>
                      <th>Decision</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQueue.map((item) => {
                      const itemStartTime = new Date(item.startTime)
                      const started = itemStartTime <= new Date()

                      return (
                        <tr key={item.id}>
                          <td data-label='Status'>
                            <span className={getStatusBadgeClass(item.status)}>
                              {item.status}
                            </span>
                          </td>
                          <td data-label='Member'>
                            <div>{item.user.name || item.user.email}</div>
                            {item.user.name && (
                              <div className='text-small text-muted'>
                                {item.user.email}
                              </div>
                            )}
                          </td>
                          <td data-label='Machine'>{item.machine.name}</td>
                          <td data-label='Start'>
                            {formatDateTime(item.startTime)}
                          </td>
                          <td data-label='Manager'>
                            {item.manager.name || item.manager.email}
                          </td>
                          <td data-label='Decision'>
                            {item.status === 'rejected' ? (
                              <div className='text-small'>
                                <div>
                                  {item.decisionReason || 'No reason provided'}
                                </div>
                                {item.reviewer && (
                                  <div className='text-muted'>
                                    by{' '}
                                    {item.reviewer.name || item.reviewer.email}
                                  </div>
                                )}
                              </div>
                            ) : item.status === 'accepted' ? (
                              <div className='text-small text-muted'>
                                {item.reviewer
                                  ? `Accepted by ${item.reviewer.name || item.reviewer.email}`
                                  : 'Accepted'}
                              </div>
                            ) : (
                              <div className='text-small text-muted'>
                                Awaiting review
                              </div>
                            )}
                          </td>
                          <td data-label='Actions'>
                            {item.status === 'pending' ? (
                              <div className='flex gap-1'>
                                <button
                                  className='btn btn-success'
                                  onClick={() =>
                                    handleModerateRequest(item.id, 'accept')
                                  }
                                  disabled={actingId === `${item.id}:accept`}
                                >
                                  {actingId === `${item.id}:accept`
                                    ? 'Saving...'
                                    : 'Accept'}
                                </button>
                                <button
                                  className='btn btn-danger'
                                  onClick={() =>
                                    handleModerateRequest(item.id, 'reject')
                                  }
                                  disabled={actingId === `${item.id}:reject`}
                                >
                                  {actingId === `${item.id}:reject`
                                    ? 'Saving...'
                                    : 'Reject'}
                                </button>
                              </div>
                            ) : item.status === 'accepted' ? (
                              <div className='space-y-1'>
                                <div className='flex gap-1'>
                                  <button
                                    className='btn btn-success'
                                    onClick={() =>
                                      handleFinalize(
                                        item.id,
                                        'pass',
                                        itemStartTime,
                                      )
                                    }
                                    disabled={actingId === `${item.id}:pass`}
                                  >
                                    {actingId === `${item.id}:pass`
                                      ? 'Saving...'
                                      : 'Pass'}
                                  </button>
                                  <button
                                    className='btn btn-danger'
                                    onClick={() =>
                                      handleFinalize(
                                        item.id,
                                        'fail',
                                        itemStartTime,
                                      )
                                    }
                                    disabled={actingId === `${item.id}:fail`}
                                  >
                                    {actingId === `${item.id}:fail`
                                      ? 'Saving...'
                                      : 'Fail'}
                                  </button>
                                  <button
                                    className='btn btn-secondary'
                                    onClick={() =>
                                      handleCancelAcceptedMeeting(item.id)
                                    }
                                    disabled={actingId === `${item.id}:cancel`}
                                  >
                                    {actingId === `${item.id}:cancel`
                                      ? 'Saving...'
                                      : 'Cancel'}
                                  </button>
                                </div>
                                {!started && (
                                  <span className='text-small text-muted'>
                                    Meeting not started
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className='text-small text-muted'>
                                No actions
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className='text-muted text-small'>
                No checkout requests match this filter.
              </p>
            )}
          </div>

          <div className='card mb-2'>
            <div
              className='flex flex-between flex-center'
              style={{ flexWrap: 'wrap', gap: '0.75rem' }}
            >
              <p className='text-small text-muted'>
                Reservation request moderation has its own queue.
              </p>
              <Link
                to='/admin/booking-requests'
                search={{ view: 'pending', q: '' }}
                className='btn btn-secondary'
              >
                Open Booking Requests
              </Link>
            </div>
          </div>

          <h2 className='mt-3 mb-2'>Recurring Checkout Availability</h2>
          <p className='text-small text-muted mb-2'>
            Availability times use timezone:{' '}
            <strong>{makerspaceTimezone}</strong> (change in Admin Settings).
          </p>
          <div className='card mb-2'>
            <h3 className='card-title mb-2'>Add Weekly Availability Rule</h3>
            <form onSubmit={handleCreateAvailabilityRule}>
              <div className='form-group'>
                <label className='form-label'>Day Of Week</label>
                <select
                  className='form-input'
                  value={selectedDayOfWeek}
                  onChange={(e) => setSelectedDayOfWeek(Number(e.target.value))}
                  required
                >
                  {DAY_OPTIONS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className='form-group'>
                <label className='form-label'>Start Time</label>
                <input
                  type='time'
                  className='form-input'
                  value={ruleStartTime}
                  onChange={(e) => setRuleStartTime(e.target.value)}
                  required
                />
              </div>

              <div className='form-group'>
                <label className='form-label'>End Time</label>
                <input
                  type='time'
                  className='form-input'
                  value={ruleEndTime}
                  onChange={(e) => setRuleEndTime(e.target.value)}
                  required
                />
              </div>

              <div className='form-group'>
                <label className='form-label'>Notes (Optional)</label>
                <input
                  type='text'
                  className='form-input'
                  value={ruleNotes}
                  onChange={(e) => setRuleNotes(e.target.value)}
                />
              </div>

              {availabilityMessage && (
                <div className='alert alert-info mb-2'>
                  {availabilityMessage}
                </div>
              )}

              <button
                type='submit'
                className='btn btn-primary'
                disabled={creatingRule}
              >
                {creatingRule ? 'Saving...' : 'Add Recurring Rule'}
              </button>
            </form>
          </div>

          <div className='card'>
            <h3 className='card-title mb-2'>Recurring Rules</h3>
            {availabilityRules.length > 0 ? (
              <div className='table-wrapper'>
                <table className='table table-mobile-cards'>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availabilityRules.map((rule) => (
                      <tr key={rule.id}>
                        <td data-label='Day'>
                          {DAY_OPTIONS[rule.dayOfWeek]?.label || 'Unknown'}
                        </td>
                        <td data-label='Start'>
                          {formatMinuteOfDay(rule.startMinuteOfDay)}
                        </td>
                        <td data-label='End'>
                          {formatMinuteOfDay(rule.endMinuteOfDay)}
                        </td>
                        <td data-label='Status'>
                          {rule.active ? (
                            <span className='badge badge-success'>Active</span>
                          ) : (
                            <span className='badge badge-danger'>Inactive</span>
                          )}
                        </td>
                        <td data-label='Actions'>
                          {rule.active ? (
                            <button
                              className='btn btn-secondary'
                              onClick={() =>
                                handleDeactivateAvailabilityRule(rule.id)
                              }
                              disabled={deactivatingRuleId === rule.id}
                            >
                              {deactivatingRuleId === rule.id
                                ? 'Updating...'
                                : 'Deactivate'}
                            </button>
                          ) : (
                            <span className='text-small text-muted'>
                              Unavailable
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className='text-muted text-small'>
                No recurring rules yet. Add one above so members can request
                in-person checkout slots.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
