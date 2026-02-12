import { and, eq } from 'drizzle-orm'
import { db, machines, reservations, users, type NewReservation } from '~/lib/db'
import { checkEligibility } from './eligibility'
import { findReservationConflicts } from './booking-conflicts'
import { broadcastMachineAvailabilityChange, emitBookingEvent } from './events'
import { notifyAdminsBookingRequested, notifyUserBookingDecision } from './notifications'

export interface BookingWorkflowFailure {
  success: false
  error: string
  reasons?: string[]
}

export interface BookingWorkflowSuccess {
  success: true
  reservation: typeof reservations.$inferSelect
}

export type BookingWorkflowResult = BookingWorkflowSuccess | BookingWorkflowFailure

function validateDateRange(startTime: Date, endTime: Date): string | null {
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return 'Invalid start or end time'
  }

  if (endTime <= startTime) {
    return 'End time must be after start time'
  }

  return null
}

export async function createBookingRequest(input: {
  userId: string
  machineId: string
  startTime: Date
  endTime: Date
}): Promise<BookingWorkflowResult> {
  const rangeError = validateDateRange(input.startTime, input.endTime)
  if (rangeError) {
    return { success: false, error: rangeError }
  }

  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, input.machineId),
  })

  if (!machine) {
    return { success: false, error: 'Machine or tool not found' }
  }

  if (!machine.active) {
    return { success: false, error: 'Machine or tool is not available' }
  }

  const eligibility = await checkEligibility(input.userId, input.machineId)
  if (!eligibility.eligible) {
    return {
      success: false,
      error: 'Not eligible to reserve this machine or tool',
      reasons: eligibility.reasons,
    }
  }

  const conflicts = await findReservationConflicts({
    machineId: input.machineId,
    startTime: input.startTime,
    endTime: input.endTime,
  })

  if (conflicts.length > 0) {
    return {
      success: false,
      error: 'Selected time overlaps an existing booking',
    }
  }

  const [reservation] = await db
    .insert(reservations)
    .values({
      userId: input.userId,
      machineId: input.machineId,
      startTime: input.startTime,
      endTime: input.endTime,
      status: 'pending',
    } satisfies NewReservation)
    .returning()

  const requestingUser = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  })

  emitBookingEvent(input.userId, {
    type: 'requested',
    status: 'pending',
    bookingId: reservation.id,
    machineId: input.machineId,
    userId: input.userId,
    startTime: reservation.startTime.toISOString(),
    endTime: reservation.endTime.toISOString(),
  })

  await notifyAdminsBookingRequested({
    requestedByUserId: input.userId,
    requestedByName:
      requestingUser?.name || requestingUser?.email || 'Member',
    machineId: input.machineId,
    machineName: machine.name,
    reservationId: reservation.id,
    startTimeIso: reservation.startTime.toISOString(),
    endTimeIso: reservation.endTime.toISOString(),
  })

  broadcastMachineAvailabilityChange(input.machineId)

  return { success: true, reservation }
}

export type ReservationDecision = 'approve' | 'reject' | 'cancel'

const decisionStatusMap = {
  approve: 'approved',
  reject: 'rejected',
  cancel: 'cancelled',
} as const

const terminalStatuses = new Set(['cancelled', 'rejected', 'completed'])

export async function moderateBookingRequest(input: {
  reservationId: string
  reviewerId: string
  decision: ReservationDecision
  notes?: string
  reason?: string
}): Promise<BookingWorkflowResult> {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, input.reservationId),
    with: {
      machine: true,
    },
  })

  if (!reservation) {
    return { success: false, error: 'Reservation not found' }
  }

  if (terminalStatuses.has(reservation.status)) {
    return {
      success: false,
      error: `Reservation is already ${reservation.status}`,
    }
  }

  const nextStatus = decisionStatusMap[input.decision]

  if (nextStatus === 'approved') {
    const conflicts = await findReservationConflicts({
      machineId: reservation.machineId,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      excludeReservationId: reservation.id,
    })

    if (conflicts.length > 0) {
      return {
        success: false,
        error: 'Cannot approve request because the time is already booked',
      }
    }
  }

  const [updated] = await db
    .update(reservations)
    .set({
      status: nextStatus,
      reviewedBy: input.reviewerId,
      reviewedAt: new Date(),
      reviewNotes: input.notes,
      decisionReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservation.id))
    .returning()

  const eventType =
    nextStatus === 'approved'
      ? 'approved'
      : nextStatus === 'rejected'
        ? 'rejected'
        : 'cancelled'

  emitBookingEvent(updated.userId, {
    type: eventType,
    status: updated.status,
    bookingId: updated.id,
    machineId: updated.machineId,
    userId: updated.userId,
    startTime: updated.startTime.toISOString(),
    endTime: updated.endTime.toISOString(),
  })

  await notifyUserBookingDecision({
    userId: updated.userId,
    reservationId: updated.id,
    machineId: updated.machineId,
    machineName: reservation.machine.name,
    status: nextStatus,
    startTimeIso: updated.startTime.toISOString(),
    endTimeIso: updated.endTime.toISOString(),
  })

  broadcastMachineAvailabilityChange(updated.machineId)

  return { success: true, reservation: updated }
}

export async function cancelBookingRequestByMember(input: {
  reservationId: string
  userId: string
  reason?: string
}): Promise<BookingWorkflowResult> {
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, input.reservationId),
      eq(reservations.userId, input.userId)
    ),
    with: {
      machine: true,
    },
  })

  if (!reservation) {
    return { success: false, error: 'Reservation not found' }
  }

  if (terminalStatuses.has(reservation.status) || reservation.status === 'cancelled') {
    return { success: false, error: 'Reservation is already closed' }
  }

  if (reservation.startTime < new Date()) {
    return { success: false, error: 'Cannot cancel past reservations' }
  }

  const [updated] = await db
    .update(reservations)
    .set({
      status: 'cancelled',
      decisionReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservation.id))
    .returning()

  emitBookingEvent(input.userId, {
    type: 'cancelled',
    status: updated.status,
    bookingId: updated.id,
    machineId: updated.machineId,
    userId: updated.userId,
    startTime: updated.startTime.toISOString(),
    endTime: updated.endTime.toISOString(),
  })

  await notifyUserBookingDecision({
    userId: updated.userId,
    reservationId: updated.id,
    machineId: updated.machineId,
    machineName: reservation.machine.name,
    status: 'cancelled',
    startTimeIso: updated.startTime.toISOString(),
    endTimeIso: updated.endTime.toISOString(),
  })

  broadcastMachineAvailabilityChange(updated.machineId)

  return { success: true, reservation: updated }
}
