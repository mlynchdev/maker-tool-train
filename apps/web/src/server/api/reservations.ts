import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, gte, desc } from 'drizzle-orm'
import { requireAuth } from '../auth'
import { db, reservations } from '~/lib/db'
import { cancelBookingRequestByMember } from '../services/booking-workflow'

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

    return cancelBookingRequestByMember({
      reservationId: data.reservationId,
      userId: user.id,
      reason: data.reason,
    })
  })
