import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import {
  applyBookingModerationOptimistic,
  applyBookingNotificationReadOptimistic,
  applyBookingNotificationsClearOptimistic,
  applyCheckoutModerationOptimistic,
  applyCheckoutQueueRemovalOptimistic,
  applyPendingCheckoutCountDecrement,
  applyPendingCheckoutRemoval,
  applyPendingReservationRequestCountDecrement,
  applyUnreadCountDelta,
  type BookingRequestsDataLike,
  type CheckoutsDataLike,
} from './optimistic-admin'

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

describe('optimistic admin cache helpers', () => {
  it('applies and rolls back checkout moderation updates', () => {
    const client = createClient()
    const checkoutsKey = queryKeys.admin.checkouts()
    const pendingCountKey = queryKeys.admin.pendingCheckoutCount()
    const pendingCheckoutsKey = queryKeys.admin.pendingCheckouts()

    const initialCheckouts: CheckoutsDataLike & { makerspaceTimezone: string } = {
      makerspaceTimezone: 'UTC',
      checkoutQueue: [
        {
          id: 'apt-1',
          status: 'pending',
          decisionReason: null,
          reviewedAt: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'apt-2',
          status: 'pending',
          decisionReason: null,
          reviewedAt: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    }

    client.setQueryData(checkoutsKey, initialCheckouts)
    client.setQueryData(pendingCountKey, { count: 2 })
    client.setQueryData(pendingCheckoutsKey, {
      pendingApprovals: [{ appointmentId: 'apt-1' }, { appointmentId: 'apt-2' }],
    })

    const previousCheckouts = client.getQueryData(checkoutsKey)
    const previousPendingCount = client.getQueryData(pendingCountKey)
    const previousPendingCheckouts = client.getQueryData(pendingCheckoutsKey)

    client.setQueryData(checkoutsKey, (current: CheckoutsDataLike | undefined) =>
      applyCheckoutModerationOptimistic(
        current,
        {
          appointmentId: 'apt-1',
          decision: 'reject',
          reason: 'Not ready',
        },
        new Date('2026-02-17T18:00:00.000Z')
      )
    )
    client.setQueryData(pendingCountKey, applyPendingCheckoutCountDecrement)
    client.setQueryData(
      pendingCheckoutsKey,
      (current: { pendingApprovals: Array<{ appointmentId: string }> } | undefined) =>
        applyPendingCheckoutRemoval(current, 'apt-1')
    )

    expect(client.getQueryData<CheckoutsDataLike>(checkoutsKey)?.checkoutQueue[0]).toMatchObject({
      id: 'apt-1',
      status: 'rejected',
      decisionReason: 'Not ready',
    })
    expect(client.getQueryData<{ count: number }>(pendingCountKey)).toEqual({ count: 1 })
    expect(
      client.getQueryData<{ pendingApprovals: Array<{ appointmentId: string }> }>(
        pendingCheckoutsKey
      )?.pendingApprovals
    ).toEqual([{ appointmentId: 'apt-2' }])

    if (previousCheckouts) client.setQueryData(checkoutsKey, previousCheckouts)
    if (previousPendingCount) client.setQueryData(pendingCountKey, previousPendingCount)
    if (previousPendingCheckouts) {
      client.setQueryData(pendingCheckoutsKey, previousPendingCheckouts)
    }

    expect(client.getQueryData(checkoutsKey)).toEqual(initialCheckouts)
    expect(client.getQueryData(pendingCountKey)).toEqual({ count: 2 })
    expect(client.getQueryData(pendingCheckoutsKey)).toEqual({
      pendingApprovals: [{ appointmentId: 'apt-1' }, { appointmentId: 'apt-2' }],
    })
  })

  it('applies and rolls back checkout queue removal updates', () => {
    const client = createClient()
    const checkoutsKey = queryKeys.admin.checkouts()

    const initialCheckouts: CheckoutsDataLike = {
      checkoutQueue: [
        { id: 'apt-1', status: 'accepted' },
        { id: 'apt-2', status: 'accepted' },
      ],
    }

    client.setQueryData(checkoutsKey, initialCheckouts)
    const previousCheckouts = client.getQueryData(checkoutsKey)

    client.setQueryData(checkoutsKey, (current: CheckoutsDataLike | undefined) =>
      applyCheckoutQueueRemovalOptimistic(current, 'apt-2')
    )

    expect(client.getQueryData<CheckoutsDataLike>(checkoutsKey)?.checkoutQueue).toEqual([
      { id: 'apt-1', status: 'accepted' },
    ])

    if (previousCheckouts) client.setQueryData(checkoutsKey, previousCheckouts)
    expect(client.getQueryData(checkoutsKey)).toEqual(initialCheckouts)
  })

  it('applies and rolls back booking request moderation updates', () => {
    const client = createClient()
    const bookingRequestsKey = queryKeys.admin.bookingRequests()
    const pendingCountKey = queryKeys.admin.pendingReservationRequestCount()

    const initialData: BookingRequestsDataLike = {
      pendingRequests: [
        {
          id: 'res-1',
          status: 'pending',
          decisionReason: null,
          reviewNotes: null,
          reviewedAt: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      recentDecisions: [
        {
          id: 'res-0',
          status: 'approved',
          decisionReason: null,
          reviewNotes: null,
          reviewedAt: new Date('2025-12-01T00:00:00.000Z'),
          updatedAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      ],
      bookingNotifications: [],
    }

    client.setQueryData(bookingRequestsKey, initialData)
    client.setQueryData(pendingCountKey, { count: 1 })

    const previousData = client.getQueryData(bookingRequestsKey)
    const previousCount = client.getQueryData(pendingCountKey)

    client.setQueryData(bookingRequestsKey, (current: BookingRequestsDataLike | undefined) =>
      applyBookingModerationOptimistic(
        current,
        {
          reservationId: 'res-1',
          decision: 'reject',
          reason: 'Not enough time',
          notes: 'Conflicts with another training',
        },
        new Date('2026-02-17T18:00:00.000Z')
      )
    )
    client.setQueryData(pendingCountKey, applyPendingReservationRequestCountDecrement)

    const current = client.getQueryData<BookingRequestsDataLike>(bookingRequestsKey)
    expect(current?.pendingRequests).toHaveLength(0)
    expect(current?.recentDecisions[0]).toMatchObject({
      id: 'res-1',
      status: 'rejected',
      decisionReason: 'Not enough time',
      reviewNotes: 'Conflicts with another training',
    })
    expect(client.getQueryData<{ count: number }>(pendingCountKey)).toEqual({ count: 0 })

    if (previousData) client.setQueryData(bookingRequestsKey, previousData)
    if (previousCount) client.setQueryData(pendingCountKey, previousCount)

    expect(client.getQueryData(bookingRequestsKey)).toEqual(initialData)
    expect(client.getQueryData(pendingCountKey)).toEqual({ count: 1 })
  })

  it('applies and rolls back booking notification updates', () => {
    const client = createClient()
    const bookingRequestsKey = queryKeys.admin.bookingRequests()
    const unreadCountKey = queryKeys.notifications.unreadCount()

    const initialData: BookingRequestsDataLike = {
      pendingRequests: [],
      recentDecisions: [],
      bookingNotifications: [{ id: 'notif-1' }, { id: 'notif-2' }, { id: 'notif-3' }],
    }

    client.setQueryData(bookingRequestsKey, initialData)
    client.setQueryData(unreadCountKey, { count: 3 })

    const previousData = client.getQueryData(bookingRequestsKey)
    const previousUnreadCount = client.getQueryData(unreadCountKey)

    client.setQueryData(bookingRequestsKey, (current: BookingRequestsDataLike | undefined) =>
      applyBookingNotificationReadOptimistic(current, 'notif-2')
    )
    client.setQueryData(unreadCountKey, (current: { count: number } | undefined) =>
      applyUnreadCountDelta(current, -1)
    )

    expect(
      client.getQueryData<BookingRequestsDataLike>(bookingRequestsKey)?.bookingNotifications
    ).toEqual([{ id: 'notif-1' }, { id: 'notif-3' }])
    expect(client.getQueryData(unreadCountKey)).toEqual({ count: 2 })

    client.setQueryData(bookingRequestsKey, (current: BookingRequestsDataLike | undefined) =>
      applyBookingNotificationsClearOptimistic(current)
    )
    client.setQueryData(unreadCountKey, (current: { count: number } | undefined) =>
      applyUnreadCountDelta(current, -2)
    )

    expect(
      client.getQueryData<BookingRequestsDataLike>(bookingRequestsKey)?.bookingNotifications
    ).toEqual([])
    expect(client.getQueryData(unreadCountKey)).toEqual({ count: 0 })

    if (previousData) client.setQueryData(bookingRequestsKey, previousData)
    if (previousUnreadCount) client.setQueryData(unreadCountKey, previousUnreadCount)

    expect(client.getQueryData(bookingRequestsKey)).toEqual(initialData)
    expect(client.getQueryData(unreadCountKey)).toEqual({ count: 3 })
  })
})
