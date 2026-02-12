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
  sql,
} from 'drizzle-orm'
import {
  checkoutAppointments,
  checkoutAvailabilityRules,
  db,
  managerCheckouts,
  machines,
  type NewCheckoutAppointment,
  type NewCheckoutAvailabilityRule,
  users,
} from '~/lib/db'
import { checkEligibility } from './eligibility'
import {
  notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentCancelled,
} from './notifications'
import { getMakerspaceTimezone } from './makerspace-settings'

const ACTIVE_APPOINTMENT_STATUSES = ['scheduled'] as const

const MANAGER_LOCK_NAMESPACE = 7001
const MACHINE_LOCK_NAMESPACE = 7002
const USER_LOCK_NAMESPACE = 7003
const WEEKDAY_BY_SHORT_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>()
const timezoneOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>()

function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
) {
  return leftStart < rightEnd && leftEnd > rightStart
}

function validateMinuteRange(startMinuteOfDay: number, endMinuteOfDay: number): string | null {
  if (!Number.isInteger(startMinuteOfDay) || !Number.isInteger(endMinuteOfDay)) {
    return 'Start and end times must align to whole minutes'
  }

  if (startMinuteOfDay < 0 || startMinuteOfDay >= 24 * 60) {
    return 'Start time must be within the day'
  }

  if (endMinuteOfDay <= 0 || endMinuteOfDay > 24 * 60) {
    return 'End time must be within the day'
  }

  if (endMinuteOfDay <= startMinuteOfDay) {
    return 'End time must be after start time'
  }

  return null
}

function getZonedDateTimeFormatter(timeZone: string) {
  let formatter = zonedDateTimeFormatterCache.get(timeZone)
  if (formatter) {
    return formatter
  }

  formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })
  zonedDateTimeFormatterCache.set(timeZone, formatter)
  return formatter
}

function getTimezoneOffsetFormatter(timeZone: string) {
  let formatter = timezoneOffsetFormatterCache.get(timeZone)
  if (formatter) {
    return formatter
  }

  formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  timezoneOffsetFormatterCache.set(timeZone, formatter)
  return formatter
}

function getTimezoneOffsetMinutes(timeZone: string, value: Date) {
  const parts = getTimezoneOffsetFormatter(timeZone).formatToParts(value)
  const token = parts.find((part) => part.type === 'timeZoneName')?.value

  if (!token || token === 'GMT' || token === 'UTC') {
    return 0
  }

  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(token)
  if (!match) {
    return 0
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] || '0')
  return sign * (hours * 60 + minutes)
}

interface ZonedDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dayOfWeek: number
}

function getZonedDateTimeParts(value: Date, timeZone: string): ZonedDateTimeParts {
  const rawParts = getZonedDateTimeFormatter(timeZone).formatToParts(value)
  const partMap: Record<string, string> = {}

  for (const part of rawParts) {
    partMap[part.type] = part.value
  }

  const weekday = WEEKDAY_BY_SHORT_NAME[partMap.weekday ?? 'Sun'] ?? 0

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    dayOfWeek: weekday,
  }
}

function getMinuteOfDay(parts: ZonedDateTimeParts) {
  return parts.hour * 60 + parts.minute
}

function zonedDateTimeToUtc(input: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}, timeZone: string) {
  const utcGuess = new Date(
    Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0)
  )

  const firstOffsetMinutes = getTimezoneOffsetMinutes(timeZone, utcGuess)
  let resolved = new Date(utcGuess.getTime() - firstOffsetMinutes * 60 * 1000)

  const secondOffsetMinutes = getTimezoneOffsetMinutes(timeZone, resolved)
  if (secondOffsetMinutes !== firstOffsetMinutes) {
    resolved = new Date(utcGuess.getTime() - secondOffsetMinutes * 60 * 1000)
  }

  return resolved
}

function getZonedCalendarDay(value: Date, timeZone: string, offsetDays: number) {
  const parts = getZonedDateTimeParts(value, timeZone)
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  if (offsetDays !== 0) {
    day.setUTCDate(day.getUTCDate() + offsetDays)
  }

  return day
}

function addUtcDays(value: Date, days: number) {
  const day = new Date(value)
  day.setUTCDate(day.getUTCDate() + days)
  return day
}

interface GeneratedSlot {
  startTime: Date
  endTime: Date
}

function generateRuleSlots(input: {
  dayOfWeek: number
  startMinuteOfDay: number
  endMinuteOfDay: number
  timeZone: string
  startTime: Date
  endTime: Date
  durationMinutes: number
}): GeneratedSlot[] {
  const slots: GeneratedSlot[] = []
  const durationMs = input.durationMinutes * 60 * 1000

  const rangeStartDay = getZonedCalendarDay(input.startTime, input.timeZone, -1)
  const rangeEndDay = getZonedCalendarDay(input.endTime, input.timeZone, 1)

  for (
    let cursor = new Date(rangeStartDay);
    cursor <= rangeEndDay;
    cursor = addUtcDays(cursor, 1)
  ) {
    if (cursor.getUTCDay() !== input.dayOfWeek) continue

    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth() + 1
    const day = cursor.getUTCDate()

    const windowStart = zonedDateTimeToUtc(
      {
        year,
        month,
        day,
        hour: Math.floor(input.startMinuteOfDay / 60),
        minute: input.startMinuteOfDay % 60,
      },
      input.timeZone
    )

    const windowEnd = zonedDateTimeToUtc(
      {
        year,
        month,
        day,
        hour: Math.floor(input.endMinuteOfDay / 60),
        minute: input.endMinuteOfDay % 60,
      },
      input.timeZone
    )

    if (windowEnd <= windowStart) continue

    for (
      let slotStart = new Date(windowStart);
      slotStart < windowEnd;
      slotStart = new Date(slotStart.getTime() + durationMs)
    ) {
      const slotEnd = new Date(slotStart.getTime() + durationMs)
      if (slotEnd > windowEnd) break
      if (slotEnd <= input.startTime || slotStart >= input.endTime) continue

      slots.push({
        startTime: slotStart,
        endTime: slotEnd,
      })
    }
  }

  return slots
}

export interface CheckoutAvailabilitySlot {
  ruleId: string
  managerId: string
  manager: {
    id: string
    email: string
    name: string | null
  }
  notes: string | null
  startTime: Date
  endTime: Date
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
  managerId: string
  dayOfWeek: number
  startMinuteOfDay: number
  endMinuteOfDay: number
  notes?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAvailabilityRules.$inferSelect>> {
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
    return { success: false, error: 'Invalid day of week' }
  }

  const rangeError = validateMinuteRange(input.startMinuteOfDay, input.endMinuteOfDay)
  if (rangeError) {
    return { success: false, error: rangeError }
  }

  const manager = await db.query.users.findFirst({
    where: eq(users.id, input.managerId),
  })

  if (!manager) {
    return { success: false, error: 'Manager not found' }
  }

  if (manager.status !== 'active') {
    return { success: false, error: 'Manager account is not active' }
  }

  if (manager.role !== 'manager' && manager.role !== 'admin') {
    return { success: false, error: 'Only managers/admins can create checkout availability' }
  }

  const conflictingRules = await db.query.checkoutAvailabilityRules.findMany({
    where: and(
      eq(checkoutAvailabilityRules.managerId, input.managerId),
      eq(checkoutAvailabilityRules.active, true),
      eq(checkoutAvailabilityRules.dayOfWeek, input.dayOfWeek),
      lt(checkoutAvailabilityRules.startMinuteOfDay, input.endMinuteOfDay),
      gt(checkoutAvailabilityRules.endMinuteOfDay, input.startMinuteOfDay)
    ),
    columns: {
      id: true,
    },
  })

  if (conflictingRules.length > 0) {
    return {
      success: false,
      error: 'This recurring availability overlaps another rule you already set',
    }
  }

  const timezone = await getMakerspaceTimezone()

  const [rule] = await db
    .insert(checkoutAvailabilityRules)
    .values({
      managerId: input.managerId,
      dayOfWeek: input.dayOfWeek,
      startMinuteOfDay: input.startMinuteOfDay,
      endMinuteOfDay: input.endMinuteOfDay,
      timezone,
      notes: input.notes,
      active: true,
    } satisfies NewCheckoutAvailabilityRule)
    .returning()

  return { success: true, data: rule }
}

export async function deactivateCheckoutAvailabilityBlock(input: {
  ruleId: string
  managerId: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAvailabilityRules.$inferSelect>> {
  const rule = await db.query.checkoutAvailabilityRules.findFirst({
    where: and(
      eq(checkoutAvailabilityRules.id, input.ruleId),
      eq(checkoutAvailabilityRules.managerId, input.managerId)
    ),
  })

  if (!rule) {
    return { success: false, error: 'Availability rule not found' }
  }

  const [updated] = await db
    .update(checkoutAvailabilityRules)
    .set({
      active: false,
      updatedAt: new Date(),
    })
    .where(eq(checkoutAvailabilityRules.id, input.ruleId))
    .returning()

  return { success: true, data: updated }
}

export async function getAvailableCheckoutSlots(input: {
  machineId: string
  userId?: string
  startTime: Date
  endTime: Date
}): Promise<CheckoutAvailabilitySlot[]> {
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, input.machineId),
  })

  if (!machine || !machine.active) {
    return []
  }

  if (input.userId) {
    const existingUpcomingAppointment = await db.query.checkoutAppointments.findFirst({
      where: and(
        eq(checkoutAppointments.userId, input.userId),
        inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        gt(checkoutAppointments.endTime, new Date())
      ),
      columns: {
        id: true,
      },
    })

    if (existingUpcomingAppointment) {
      return []
    }

    const existingCheckout = await db.query.managerCheckouts.findFirst({
      where: and(
        eq(managerCheckouts.userId, input.userId),
        eq(managerCheckouts.machineId, input.machineId)
      ),
      columns: {
        id: true,
      },
    })

    if (existingCheckout) {
      return []
    }
  }

  const rules = await db.query.checkoutAvailabilityRules.findMany({
    where: eq(checkoutAvailabilityRules.active, true),
    with: {
      manager: {
        columns: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
    orderBy: [
      asc(checkoutAvailabilityRules.dayOfWeek),
      asc(checkoutAvailabilityRules.startMinuteOfDay),
    ],
  })

  if (rules.length === 0) {
    return []
  }

  const appointments = await db.query.checkoutAppointments.findMany({
    where: and(
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      lt(checkoutAppointments.startTime, input.endTime),
      gt(checkoutAppointments.endTime, input.startTime)
    ),
    columns: {
      userId: true,
      machineId: true,
      managerId: true,
      startTime: true,
      endTime: true,
    },
  })

  const now = new Date()
  const slots: CheckoutAvailabilitySlot[] = []
  const makerspaceTimezone = await getMakerspaceTimezone()

  for (const rule of rules) {
    const generated = generateRuleSlots({
      dayOfWeek: rule.dayOfWeek,
      startMinuteOfDay: rule.startMinuteOfDay,
      endMinuteOfDay: rule.endMinuteOfDay,
      timeZone: makerspaceTimezone,
      startTime: input.startTime,
      endTime: input.endTime,
      durationMinutes: machine.trainingDurationMinutes,
    })

    for (const slot of generated) {
      if (slot.endTime <= now) continue

      const hasConflict = appointments.some((appointment) => {
        if (!rangesOverlap(slot.startTime, slot.endTime, appointment.startTime, appointment.endTime)) {
          return false
        }

        if (appointment.managerId === rule.managerId) return true
        if (appointment.machineId === input.machineId) return true
        if (input.userId && appointment.userId === input.userId) return true

        return false
      })

      if (!hasConflict) {
        slots.push({
          ruleId: rule.id,
          managerId: rule.managerId,
          manager: rule.manager,
          notes: rule.notes,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })
      }
    }
  }

  return slots.sort((left, right) => {
    const startDelta = left.startTime.getTime() - right.startTime.getTime()
    if (startDelta !== 0) return startDelta
    return left.manager.email.localeCompare(right.manager.email)
  })
}

export async function getAdminCheckoutAvailability(input: {
  managerId: string
  startTime: Date
  endTime: Date
}) {
  const rules = await db.query.checkoutAvailabilityRules.findMany({
    where: eq(checkoutAvailabilityRules.managerId, input.managerId),
    orderBy: [
      asc(checkoutAvailabilityRules.dayOfWeek),
      asc(checkoutAvailabilityRules.startMinuteOfDay),
    ],
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

  return { rules, appointments }
}

export async function bookCheckoutAppointment(input: {
  userId: string
  machineId: string
  managerId: string
  slotStartTime: Date
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

  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, input.machineId),
  })

  if (!machine) {
    return { success: false, error: 'Machine or tool not found' }
  }

  if (!machine.active) {
    return { success: false, error: 'Machine or tool is inactive' }
  }

  const existingCheckout = await db.query.managerCheckouts.findFirst({
    where: and(
      eq(managerCheckouts.userId, input.userId),
      eq(managerCheckouts.machineId, input.machineId)
    ),
    columns: {
      id: true,
    },
  })

  if (existingCheckout) {
    return {
      success: false,
      error: 'You are already checked out for this machine or tool',
    }
  }

  const slotStartTime = new Date(input.slotStartTime)
  if (Number.isNaN(slotStartTime.getTime())) {
    return { success: false, error: 'Invalid slot start time' }
  }

  slotStartTime.setSeconds(0, 0)

  if (slotStartTime <= new Date()) {
    return { success: false, error: 'This checkout slot is no longer available' }
  }

  const durationMinutes = machine.trainingDurationMinutes
  const slotEndTime = new Date(slotStartTime.getTime() + durationMinutes * 60 * 1000)

  const makerspaceTimezone = await getMakerspaceTimezone()
  const slotStartLocal = getZonedDateTimeParts(slotStartTime, makerspaceTimezone)
  const dayOfWeek = slotStartLocal.dayOfWeek
  const startMinuteOfDay = getMinuteOfDay(slotStartLocal)

  const rule = await db.query.checkoutAvailabilityRules.findFirst({
    where: and(
      eq(checkoutAvailabilityRules.managerId, input.managerId),
      eq(checkoutAvailabilityRules.active, true),
      eq(checkoutAvailabilityRules.dayOfWeek, dayOfWeek),
      lte(checkoutAvailabilityRules.startMinuteOfDay, startMinuteOfDay),
      gte(checkoutAvailabilityRules.endMinuteOfDay, startMinuteOfDay + durationMinutes)
    ),
    with: {
      manager: {
        columns: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  })

  if (!rule) {
    return { success: false, error: 'This checkout slot is no longer available' }
  }

  const minutesFromRuleStart = startMinuteOfDay - rule.startMinuteOfDay
  if (minutesFromRuleStart < 0 || minutesFromRuleStart % durationMinutes !== 0) {
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
      inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
      gt(checkoutAppointments.endTime, new Date())
    ),
    columns: { id: true },
  })

  if (existingAppointment) {
    return {
      success: false,
      error: 'You already have an upcoming checkout appointment',
    }
  }

  const bookingResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MANAGER_LOCK_NAMESPACE}, hashtext(${input.managerId}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(${MACHINE_LOCK_NAMESPACE}, hashtext(${input.machineId}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(${USER_LOCK_NAMESPACE}, hashtext(${input.userId}))`)

    const checkoutAfterLock = await tx.query.managerCheckouts.findFirst({
      where: and(
        eq(managerCheckouts.userId, input.userId),
        eq(managerCheckouts.machineId, input.machineId)
      ),
      columns: { id: true },
    })

    if (checkoutAfterLock) {
      return {
        success: false,
        error: 'You are already checked out for this machine or tool',
      } as const
    }

    const existingUserAppointmentAfterLock = await tx.query.checkoutAppointments.findFirst({
      where: and(
        eq(checkoutAppointments.userId, input.userId),
        inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        gt(checkoutAppointments.endTime, new Date())
      ),
      columns: { id: true },
    })

    if (existingUserAppointmentAfterLock) {
      return {
        success: false,
        error: 'You already have an upcoming checkout appointment',
      } as const
    }

    const conflicts = await tx.query.checkoutAppointments.findMany({
      where: and(
        inArray(checkoutAppointments.status, [...ACTIVE_APPOINTMENT_STATUSES]),
        lt(checkoutAppointments.startTime, slotEndTime),
        gt(checkoutAppointments.endTime, slotStartTime),
        or(
          eq(checkoutAppointments.machineId, input.machineId),
          eq(checkoutAppointments.managerId, input.managerId),
          eq(checkoutAppointments.userId, input.userId)
        )
      ),
      columns: { id: true },
    })

    if (conflicts.length > 0) {
      return { success: false, error: 'This checkout slot has already been booked' } as const
    }

    const [appointment] = await tx
      .insert(checkoutAppointments)
      .values({
        userId: input.userId,
        machineId: input.machineId,
        managerId: input.managerId,
        availabilityRuleId: rule.id,
        availabilityBlockId: null,
        startTime: slotStartTime,
        endTime: slotEndTime,
        status: 'scheduled',
        notes: input.notes,
      } satisfies NewCheckoutAppointment)
      .returning()

    return { success: true, data: appointment } as const
  })

  if (!bookingResult.success) {
    return bookingResult
  }

  await notifyManagerCheckoutAppointmentBooked({
    managerId: input.managerId,
    userName: user.name || user.email,
    userId: user.id,
    machineName: machine.name,
    machineId: machine.id,
    appointmentId: bookingResult.data.id,
    startTimeIso: bookingResult.data.startTime.toISOString(),
    endTimeIso: bookingResult.data.endTime.toISOString(),
  })

  await notifyUserCheckoutAppointmentBooked({
    userId: user.id,
    managerName: rule.manager.name || rule.manager.email,
    machineName: machine.name,
    machineId: machine.id,
    appointmentId: bookingResult.data.id,
    startTimeIso: bookingResult.data.startTime.toISOString(),
    endTimeIso: bookingResult.data.endTime.toISOString(),
  })

  return { success: true, data: bookingResult.data }
}

export async function cancelCheckoutAppointmentByManager(input: {
  appointmentId: string
  managerId: string
  reason?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAppointments.$inferSelect>> {
  const appointment = await db.query.checkoutAppointments.findFirst({
    where: and(
      eq(checkoutAppointments.id, input.appointmentId),
      eq(checkoutAppointments.managerId, input.managerId)
    ),
    with: {
      user: {
        columns: {
          id: true,
          email: true,
          name: true,
        },
      },
      manager: {
        columns: {
          id: true,
          email: true,
          name: true,
        },
      },
      machine: {
        columns: {
          id: true,
          name: true,
        },
      },
    },
  })

  if (!appointment) {
    return { success: false, error: 'Checkout appointment not found' }
  }

  if (appointment.status !== 'scheduled') {
    return { success: false, error: 'Only scheduled appointments can be cancelled' }
  }

  if (appointment.startTime <= new Date()) {
    return { success: false, error: 'Only future appointments can be cancelled' }
  }

  const [updated] = await db
    .update(checkoutAppointments)
    .set({
      status: 'cancelled',
      cancellationReason: input.reason,
      updatedAt: new Date(),
    })
    .where(eq(checkoutAppointments.id, input.appointmentId))
    .returning()

  await notifyUserCheckoutAppointmentCancelled({
    userId: appointment.user.id,
    managerName: appointment.manager.name || appointment.manager.email,
    machineName: appointment.machine.name,
    machineId: appointment.machine.id,
    appointmentId: appointment.id,
    startTimeIso: appointment.startTime.toISOString(),
    endTimeIso: appointment.endTime.toISOString(),
    reason: input.reason,
  })

  return { success: true, data: updated }
}
