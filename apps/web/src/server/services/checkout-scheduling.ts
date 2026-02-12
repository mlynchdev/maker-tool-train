import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
} from 'drizzle-orm'
import {
  checkoutAppointments,
  checkoutAvailabilityBlocks,
  db,
  machines,
  type NewCheckoutAppointment,
  type NewCheckoutAvailabilityBlock,
  users,
} from '~/lib/db'
import { checkEligibility } from './eligibility'
import {
  notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked,
} from './notifications'

const ACTIVE_APPOINTMENT_STATUSES = ['scheduled'] as const

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
) {
  return leftStart < rightEnd && leftEnd > rightStart
}

function validateDateRange(startTime: Date, endTime: Date): string | null {
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return 'Invalid start or end time'
  }

  if (endTime <= startTime) {
    return 'End time must be after start time'
  }

  return null
}

export interface CheckoutSchedulingFailure {
  success: false
  error: string
  reasons?: string[]
}

export interface CheckoutSchedulingSuccess<T> {
  success: true
  data: T
}

export type CheckoutSchedulingResult<T> =
  | CheckoutSchedulingFailure
  | CheckoutSchedulingSuccess<T>

export async function createCheckoutAvailabilityBlock(input: {
  machineId: string
  managerId: string
  startTime: Date
  endTime: Date
  notes?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAvailabilityBlocks.$inferSelect>> {
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
    return { success: false, error: 'Machine or tool is inactive' }
  }

  const conflictingBlocks = await db.query.checkoutAvailabilityBlocks.findMany({
    where: and(
      eq(checkoutAvailabilityBlocks.managerId, input.managerId),
      eq(checkoutAvailabilityBlocks.active, true),
      lt(checkoutAvailabilityBlocks.startTime, input.endTime),
      gt(checkoutAvailabilityBlocks.endTime, input.startTime)
    ),
  })

  if (conflictingBlocks.length > 0) {
    return {
      success: false,
      error: 'This availability block overlaps another block you already set',
    }
  }

  const [block] = await db
    .insert(checkoutAvailabilityBlocks)
    .values({
      machineId: input.machineId,
      managerId: input.managerId,
      startTime: input.startTime,
      endTime: input.endTime,
      notes: input.notes,
      active: true,
    } satisfies NewCheckoutAvailabilityBlock)
    .returning()

  return { success: true, data: block }
}

export async function deactivateCheckoutAvailabilityBlock(input: {
  blockId: string
  managerId: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAvailabilityBlocks.$inferSelect>> {
  const block = await db.query.checkoutAvailabilityBlocks.findFirst({
    where: and(
      eq(checkoutAvailabilityBlocks.id, input.blockId),
      eq(checkoutAvailabilityBlocks.managerId, input.managerId)
    ),
  })

  if (!block) {
    return { success: false, error: 'Availability block not found' }
  }

  const [updated] = await db
    .update(checkoutAvailabilityBlocks)
    .set({
      active: false,
      updatedAt: new Date(),
    })
    .where(eq(checkoutAvailabilityBlocks.id, input.blockId))
    .returning()

  return { success: true, data: updated }
}

export async function getAvailableCheckoutBlocks(input: {
  machineId: string
  startTime: Date
  endTime: Date
}) {
  const blocks = await db.query.checkoutAvailabilityBlocks.findMany({
    where: and(
      eq(checkoutAvailabilityBlocks.machineId, input.machineId),
      eq(checkoutAvailabilityBlocks.active, true),
      gte(checkoutAvailabilityBlocks.startTime, input.startTime),
      lte(checkoutAvailabilityBlocks.endTime, input.endTime),
      gt(checkoutAvailabilityBlocks.endTime, new Date())
    ),
    with: {
      manager: true,
    },
    orderBy: [asc(checkoutAvailabilityBlocks.startTime)],
  })

  if (blocks.length === 0) {
    return []
  }

  const overlappingAppointments = await db.query.checkoutAppointments.findMany({
    where: and(
      eq(checkoutAppointments.machineId, input.machineId),
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      lt(checkoutAppointments.startTime, input.endTime),
      gt(checkoutAppointments.endTime, input.startTime)
    ),
  })

  return blocks.filter((block) => {
    return !overlappingAppointments.some((appointment) =>
      rangesOverlap(
        block.startTime,
        block.endTime,
        appointment.startTime,
        appointment.endTime
      )
    )
  })
}

export async function getAdminCheckoutAvailability(input: {
  managerId: string
  startTime: Date
  endTime: Date
}) {
  const blocks = await db.query.checkoutAvailabilityBlocks.findMany({
    where: and(
      eq(checkoutAvailabilityBlocks.managerId, input.managerId),
      gte(checkoutAvailabilityBlocks.endTime, input.startTime),
      lte(checkoutAvailabilityBlocks.startTime, input.endTime)
    ),
    with: {
      machine: true,
    },
    orderBy: [asc(checkoutAvailabilityBlocks.startTime)],
  })

  const appointments = await db.query.checkoutAppointments.findMany({
    where: and(
      eq(checkoutAppointments.managerId, input.managerId),
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      lt(checkoutAppointments.startTime, input.endTime),
      gt(checkoutAppointments.endTime, input.startTime)
    ),
    with: {
      user: true,
      machine: true,
    },
    orderBy: [asc(checkoutAppointments.startTime)],
  })

  return { blocks, appointments }
}

export async function bookCheckoutAppointment(input: {
  userId: string
  machineId: string
  blockId: string
  notes?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAppointments.$inferSelect>> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (user.status !== 'active') {
    return { success: false, error: 'User account is not active' }
  }

  const block = await db.query.checkoutAvailabilityBlocks.findFirst({
    where: and(
      eq(checkoutAvailabilityBlocks.id, input.blockId),
      eq(checkoutAvailabilityBlocks.machineId, input.machineId),
      eq(checkoutAvailabilityBlocks.active, true)
    ),
    with: {
      manager: true,
      machine: true,
    },
  })

  if (!block) {
    return { success: false, error: 'Checkout availability block not found' }
  }

  if (!block.machine.active) {
    return { success: false, error: 'Machine or tool is inactive' }
  }

  if (block.endTime <= new Date()) {
    return { success: false, error: 'This checkout slot is no longer available' }
  }

  const eligibility = await checkEligibility(input.userId, input.machineId)
  const trainingComplete = eligibility.requirements.every((req) => req.completed)

  if (!trainingComplete) {
    return {
      success: false,
      error: 'Training requirements are not complete',
      reasons: eligibility.reasons,
    }
  }

  if (eligibility.hasCheckout) {
    return {
      success: false,
      error: 'You are already checked out for this machine or tool',
    }
  }

  const existingAppointment = await db.query.checkoutAppointments.findFirst({
    where: and(
      eq(checkoutAppointments.userId, input.userId),
      eq(checkoutAppointments.machineId, input.machineId),
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      gt(checkoutAppointments.endTime, new Date())
    ),
  })

  if (existingAppointment) {
    return {
      success: false,
      error: 'You already have an upcoming checkout appointment for this resource',
    }
  }

  const conflicts = await db.query.checkoutAppointments.findMany({
    where: and(
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      lt(checkoutAppointments.startTime, block.endTime),
      gt(checkoutAppointments.endTime, block.startTime),
      or(
        eq(checkoutAppointments.machineId, input.machineId),
        eq(checkoutAppointments.managerId, block.managerId),
        eq(checkoutAppointments.userId, input.userId)
      )
    ),
  })

  if (conflicts.length > 0) {
    return { success: false, error: 'This checkout slot has already been booked' }
  }

  const [appointment] = await db
    .insert(checkoutAppointments)
    .values({
      userId: input.userId,
      machineId: input.machineId,
      managerId: block.managerId,
      availabilityBlockId: block.id,
      startTime: block.startTime,
      endTime: block.endTime,
      status: 'scheduled',
      notes: input.notes,
    } satisfies NewCheckoutAppointment)
    .returning()

  await notifyManagerCheckoutAppointmentBooked({
    managerId: block.managerId,
    userName: user.name || user.email,
    userId: user.id,
    machineName: block.machine.name,
    machineId: block.machine.id,
    appointmentId: appointment.id,
    startTimeIso: appointment.startTime.toISOString(),
    endTimeIso: appointment.endTime.toISOString(),
  })

  await notifyUserCheckoutAppointmentBooked({
    userId: user.id,
    managerName: block.manager.name || block.manager.email,
    machineName: block.machine.name,
    machineId: block.machine.id,
    appointmentId: appointment.id,
    startTimeIso: appointment.startTime.toISOString(),
    endTimeIso: appointment.endTime.toISOString(),
  })

  return { success: true, data: appointment }
}
