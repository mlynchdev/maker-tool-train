import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../auth'
import { db, machines } from '~/lib/db'
import { checkEligibility, getMachineRequirements } from '../services/eligibility'
import { getMachineBookingsInRange } from '../services/booking-conflicts'
import { createBookingRequest } from '../services/booking-workflow'
import {
  bookCheckoutAppointment,
  getAvailableCheckoutBlocks,
} from '../services/checkout-scheduling'

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

    const bookings = await getMachineBookingsInRange(
      machine.id,
      new Date(data.startDate),
      new Date(data.endDate)
    )

    return {
      bookings: bookings.map((booking) => ({
        id: booking.id,
        userId: booking.userId,
        userName: booking.user?.name || booking.user?.email || 'Member',
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
      })),
    }
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

    const result = await createBookingRequest({
      userId: user.id,
      machineId: data.machineId,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
    })

    return result
  })

export const getMachineCheckoutAvailability = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
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

    const startTime = data.startDate ? new Date(data.startDate) : new Date()
    const endTime = data.endDate
      ? new Date(data.endDate)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    const blocks = await getAvailableCheckoutBlocks({
      machineId: data.machineId,
      startTime,
      endTime,
    })

    return {
      blocks: blocks.map((block) => ({
        id: block.id,
        managerId: block.managerId,
        managerName: block.manager.name || block.manager.email,
        startTime: block.startTime,
        endTime: block.endTime,
        notes: block.notes,
      })),
    }
  })

export const requestCheckoutAppointment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        blockId: z.string().uuid(),
        notes: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()

    return bookCheckoutAppointment({
      userId: user.id,
      machineId: data.machineId,
      blockId: data.blockId,
      notes: data.notes,
    })
  })
