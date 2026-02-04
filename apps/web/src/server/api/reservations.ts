import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, gte, desc } from 'drizzle-orm'
import { requireAuth } from '../auth'
import { db, reservations } from '~/lib/db'
import { calcom } from '../services/calcom'
import { emitBookingEvent, broadcastMachineAvailabilityChange } from '../services/events'

export const getReservations = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z
      .object({
        includesPast: z.boolean().optional(),
      })
      .optional()
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const conditions = [eq(reservations.userId, user.id)]

    if (!data?.includesPast) {
      conditions.push(gte(reservations.endTime, new Date()))
    }

    const userReservations = await db.query.reservations.findMany({
      where: and(...conditions),
      with: {
        machine: true,
      },
      orderBy: [desc(reservations.startTime)],
    })

    return { reservations: userReservations }
  })

export const getReservation = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z.object({ reservationId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, data.reservationId),
        eq(reservations.userId, user.id)
      ),
      with: {
        machine: true,
      },
    })

    if (!reservation) {
      throw new Response(JSON.stringify({ error: 'Reservation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return { reservation }
  })

export const cancelReservation = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        reservationId: z.string().uuid(),
        reason: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(reservations.id, data.reservationId),
        eq(reservations.userId, user.id)
      ),
    })

    if (!reservation) {
      return { success: false, error: 'Reservation not found' }
    }

    if (reservation.status === 'cancelled') {
      return { success: false, error: 'Reservation already cancelled' }
    }

    if (reservation.startTime < new Date()) {
      return { success: false, error: 'Cannot cancel past reservations' }
    }

    // Cancel in Cal.com if we have a booking UID
    if (reservation.calcomBookingUid) {
      try {
        await calcom.cancelBooking(reservation.calcomBookingUid, data.reason)
      } catch (error) {
        console.error('Cal.com cancellation error:', error)
        // Continue with local cancellation even if Cal.com fails
      }
    }

    // Update local record
    await db
      .update(reservations)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, data.reservationId))

    // Emit real-time event
    emitBookingEvent(user.id, {
      type: 'cancelled',
      bookingId: reservation.id,
      machineId: reservation.machineId,
      userId: user.id,
      startTime: reservation.startTime.toISOString(),
      endTime: reservation.endTime.toISOString(),
    })

    broadcastMachineAvailabilityChange(reservation.machineId)

    return { success: true }
  })
