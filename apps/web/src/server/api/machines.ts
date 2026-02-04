import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../auth'
import { db, machines, reservations, NewReservation } from '~/lib/db'
import { checkEligibility, getMachineRequirements } from '../services/eligibility'
import { calcom } from '../services/calcom'
import { emitBookingEvent, broadcastMachineAvailabilityChange } from '../services/events'

export const getMachines = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()

  const machineList = await db.query.machines.findMany({
    where: eq(machines.active, true),
  })

  // Get eligibility for each machine
  const machinesWithEligibility = await Promise.all(
    machineList.map(async (machine) => {
      const eligibility = await checkEligibility(user.id, machine.id)
      return {
        ...machine,
        eligibility,
      }
    })
  )

  return { user, machines: machinesWithEligibility }
})

export const getMachine = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ machineId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      throw new Response(JSON.stringify({ error: 'Machine not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const eligibility = await checkEligibility(user.id, data.machineId)
    const requirements = await getMachineRequirements(data.machineId)

    return {
      machine,
      eligibility,
      requirements: requirements.map((r) => ({
        moduleId: r.moduleId,
        moduleTitle: r.module.title,
        requiredPercent: r.requiredWatchPercent,
      })),
    }
  })

export const getMachineEligibility = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ machineId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const eligibility = await checkEligibility(user.id, data.machineId)

    return eligibility
  })

export const getMachineAvailability = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireAuth()

    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      throw new Response(JSON.stringify({ error: 'Machine not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!machine.calcomEventTypeId) {
      return { slots: [], error: 'Machine not configured for scheduling' }
    }

    const slots = await calcom.getAvailability(
      machine.calcomEventTypeId,
      new Date(data.startDate),
      new Date(data.endDate)
    )

    return { slots }
  })

const reserveSchema = z.object({
  machineId: z.string().uuid(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
})

export const reserveMachine = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => reserveSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth()

    // Check eligibility
    const eligibility = await checkEligibility(user.id, data.machineId)
    if (!eligibility.eligible) {
      return {
        success: false,
        error: 'Not eligible to reserve this machine',
        reasons: eligibility.reasons,
      }
    }

    // Get machine for Cal.com event type
    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      return { success: false, error: 'Machine not found' }
    }

    if (!machine.calcomEventTypeId) {
      return { success: false, error: 'Machine not configured for scheduling' }
    }

    // Get user details for booking
    const userRecord = await db.query.users.findFirst({
      where: eq(db._.fullSchema.users.id, user.id),
    })

    if (!userRecord) {
      return { success: false, error: 'User not found' }
    }

    // Create booking in Cal.com
    let calcomBooking
    try {
      calcomBooking = await calcom.createBooking({
        eventTypeId: machine.calcomEventTypeId,
        start: new Date(data.startTime),
        attendee: {
          name: userRecord.name || userRecord.email,
          email: userRecord.email,
          timeZone: 'UTC',
        },
        metadata: {
          machineId: data.machineId,
          userId: user.id,
        },
      })
    } catch (error) {
      console.error('Cal.com booking error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create booking',
      }
    }

    // Create local reservation record
    const [reservation] = await db
      .insert(reservations)
      .values({
        userId: user.id,
        machineId: data.machineId,
        calcomBookingId: calcomBooking.id.toString(),
        calcomBookingUid: calcomBooking.uid,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        status: 'confirmed',
      } satisfies NewReservation)
      .returning()

    // Emit real-time event
    emitBookingEvent(user.id, {
      type: 'created',
      bookingId: reservation.id,
      machineId: data.machineId,
      userId: user.id,
      startTime: data.startTime,
      endTime: data.endTime,
    })

    broadcastMachineAvailabilityChange(data.machineId)

    return { success: true, reservation }
  })
