import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db, reservations } from '~/lib/db'
import { webhookBookingSchema } from '../services/calcom'
import { emitBookingEvent, broadcastMachineAvailabilityChange } from '../services/events'

// Verify webhook comes from Cal.com (basic secret check)
// In production, you might also want to verify based on IP or signature
function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.CALCOM_WEBHOOK_SECRET
  if (!secret) return true // Skip verification if no secret configured

  const providedSecret = request.headers.get('x-cal-signature') ||
                         request.headers.get('authorization')?.replace('Bearer ', '')

  return providedSecret === secret
}

export const handleCalcomWebhook = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => webhookBookingSchema.parse(data))
  .handler(async ({ data }) => {
    const { triggerEvent, payload } = data

    console.log(`Received Cal.com webhook: ${triggerEvent}`, payload.uid)

    // Find the reservation by Cal.com booking UID
    const reservation = await db.query.reservations.findFirst({
      where: eq(reservations.calcomBookingUid, payload.uid),
    })

    if (!reservation) {
      // This might be a booking created outside our system
      console.log(`No matching reservation found for booking UID: ${payload.uid}`)

      // Try to create one if we have the metadata
      if (payload.metadata?.machineId && payload.metadata?.userId) {
        const [newReservation] = await db
          .insert(reservations)
          .values({
            userId: payload.metadata.userId,
            machineId: payload.metadata.machineId,
            calcomBookingId: payload.bookingId.toString(),
            calcomBookingUid: payload.uid,
            startTime: new Date(payload.startTime),
            endTime: new Date(payload.endTime),
            status: triggerEvent === 'BOOKING_CANCELLED' ? 'cancelled' : 'confirmed',
          })
          .returning()

        if (newReservation) {
          emitBookingEvent(payload.metadata.userId, {
            type: 'created',
            bookingId: newReservation.id,
            machineId: payload.metadata.machineId,
            userId: payload.metadata.userId,
            startTime: payload.startTime,
            endTime: payload.endTime,
          })

          broadcastMachineAvailabilityChange(payload.metadata.machineId)
        }
      }

      return { success: true, message: 'No matching reservation, attempted creation' }
    }

    switch (triggerEvent) {
      case 'BOOKING_CREATED':
        // Already created locally before Cal.com, just update if needed
        await db
          .update(reservations)
          .set({
            startTime: new Date(payload.startTime),
            endTime: new Date(payload.endTime),
            status: 'confirmed',
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id))
        break

      case 'BOOKING_RESCHEDULED':
        await db
          .update(reservations)
          .set({
            startTime: new Date(payload.startTime),
            endTime: new Date(payload.endTime),
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id))

        emitBookingEvent(reservation.userId, {
          type: 'updated',
          bookingId: reservation.id,
          machineId: reservation.machineId,
          userId: reservation.userId,
          startTime: payload.startTime,
          endTime: payload.endTime,
        })

        broadcastMachineAvailabilityChange(reservation.machineId)
        break

      case 'BOOKING_CANCELLED':
      case 'BOOKING_REJECTED':
        await db
          .update(reservations)
          .set({
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id))

        emitBookingEvent(reservation.userId, {
          type: 'cancelled',
          bookingId: reservation.id,
          machineId: reservation.machineId,
          userId: reservation.userId,
          startTime: reservation.startTime.toISOString(),
          endTime: reservation.endTime.toISOString(),
        })

        broadcastMachineAvailabilityChange(reservation.machineId)
        break

      default:
        console.log(`Unhandled webhook event: ${triggerEvent}`)
    }

    return { success: true }
  })
