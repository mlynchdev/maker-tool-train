export interface PendingCheckoutCountData {
  count: number
}

export interface PendingCheckoutsData {
  pendingApprovals: Array<{ appointmentId: string }>
}

export interface CheckoutQueueItem {
  id: string
  status: string
  decisionReason?: string | null
  reviewedAt?: Date | null
  updatedAt?: Date | null
}

export interface CheckoutsDataLike {
  checkoutQueue: CheckoutQueueItem[]
}

export interface ReservationRequestItem {
  id: string
  status: string
  decisionReason?: string | null
  reviewNotes?: string | null
  reviewedAt?: Date | null
  updatedAt?: Date | null
}

export interface BookingNotificationLike {
  id: string
}

export interface BookingRequestsDataLike {
  pendingRequests: ReservationRequestItem[]
  recentDecisions: ReservationRequestItem[]
  bookingNotifications: BookingNotificationLike[]
}

export function applyCheckoutModerationOptimistic<T extends CheckoutsDataLike>(
  current: T | undefined,
  variables: {
    appointmentId: string
    decision: 'accept' | 'reject'
    reason?: string
  },
  now = new Date()
): T | undefined {
  if (!current) return current

  return {
    ...current,
    checkoutQueue: current.checkoutQueue.map((item) =>
      item.id === variables.appointmentId
        ? {
            ...item,
            status: variables.decision === 'accept' ? 'accepted' : 'rejected',
            decisionReason: variables.reason || item.decisionReason,
            reviewedAt: now,
            updatedAt: now,
          }
        : item
    ),
  }
}

export function applyCheckoutQueueRemovalOptimistic<T extends CheckoutsDataLike>(
  current: T | undefined,
  appointmentId: string
): T | undefined {
  if (!current) return current

  return {
    ...current,
    checkoutQueue: current.checkoutQueue.filter((item) => item.id !== appointmentId),
  }
}

export function applyPendingCheckoutCountDecrement(
  current: PendingCheckoutCountData | undefined
): PendingCheckoutCountData | undefined {
  if (!current) return current
  return { count: Math.max(current.count - 1, 0) }
}

export function applyPendingCheckoutRemoval(
  current: PendingCheckoutsData | undefined,
  appointmentId: string
): PendingCheckoutsData | undefined {
  if (!current) return current

  return {
    ...current,
    pendingApprovals: current.pendingApprovals.filter(
      (item) => item.appointmentId !== appointmentId
    ),
  }
}

export function applyBookingModerationOptimistic<T extends BookingRequestsDataLike>(
  current: T | undefined,
  variables: {
    reservationId: string
    decision: 'approve' | 'reject' | 'cancel'
    reason?: string
    notes?: string
  },
  now = new Date()
): T | undefined {
  if (!current) return current

  const pendingRecord = current.pendingRequests.find(
    (request) => request.id === variables.reservationId
  )
  if (!pendingRecord) return current

  const nextStatus: ReservationRequestItem['status'] =
    variables.decision === 'approve'
      ? 'approved'
      : variables.decision === 'reject'
        ? 'rejected'
        : 'cancelled'

  const updatedRecord = {
    ...pendingRecord,
    status: nextStatus,
    decisionReason: variables.reason || pendingRecord.decisionReason,
    reviewNotes: variables.notes || pendingRecord.reviewNotes,
    reviewedAt: now,
    updatedAt: now,
  }

  return {
    ...current,
    pendingRequests: current.pendingRequests.filter(
      (request) => request.id !== variables.reservationId
    ),
    recentDecisions: [updatedRecord, ...current.recentDecisions],
  }
}

export function applyPendingReservationRequestCountDecrement(
  current: { count: number } | undefined
): { count: number } | undefined {
  if (!current) return current
  return { count: Math.max(current.count - 1, 0) }
}

export function applyBookingNotificationReadOptimistic<T extends BookingRequestsDataLike>(
  current: T | undefined,
  notificationId: string
): T | undefined {
  if (!current) return current

  return {
    ...current,
    bookingNotifications: current.bookingNotifications.filter(
      (notification) => notification.id !== notificationId
    ),
  }
}

export function applyBookingNotificationsClearOptimistic<T extends BookingRequestsDataLike>(
  current: T | undefined
): T | undefined {
  if (!current) return current
  return {
    ...current,
    bookingNotifications: [],
  }
}

export function applyUnreadCountDelta(
  current: { count: number } | undefined,
  delta: number
): { count: number } | undefined {
  if (!current) return current
  return { count: Math.max(current.count + delta, 0) }
}
