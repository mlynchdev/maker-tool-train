import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import {
  checkoutAppointmentEvents,
  checkoutAppointments,
  checkoutAvailabilityRules,
  db,
  managerCheckouts,
  machines,
  type NewCheckoutAppointment,
  type NewCheckoutAppointmentEvent,
  type NewCheckoutAvailabilityRule,
  users,
} from '~/lib/db'
import { checkEligibility } from './eligibility'
import {
  notifyAdminsCheckoutRequestSubmitted,
  notifyUserCheckoutRequestAccepted,
  notifyUserCheckoutRequestRejected,
  notifyUserCheckoutResultFailed,
  notifyUserCheckoutResultPassed,
  notifyUserCheckoutAppointmentCancelled,
} from './notifications'
import { getMakerspaceTimezone } from './makerspace-settings'

const CONFLICT_APPOINTMENT_STATUSES = ['pending', 'accepted'] as const

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
    const existingPendingOrAcceptedForMachine =
      await db.query.checkoutAppointments.findFirst({
      where: and(
        eq(checkoutAppointments.userId, input.userId),
        eq(checkoutAppointments.machineId, input.machineId),
        inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
        gt(checkoutAppointments.endTime, new Date())
      ),
      columns: {
        id: true,
      },
    })

    if (existingPendingOrAcceptedForMachine) {
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
      inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
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
      inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
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

export async function getUpcomingCheckoutAppointmentsForUser(input: {
  userId: string
  role: 'member' | 'manager' | 'admin'
  startTime: Date
  endTime: Date
}) {
  const roleCondition =
    input.role === 'member'
      ? eq(checkoutAppointments.userId, input.userId)
      : input.role === 'admin'
        ? eq(checkoutAppointments.reviewedBy, input.userId)
        : eq(checkoutAppointments.managerId, input.userId)

  return db.query.checkoutAppointments.findMany({
    where: and(
      roleCondition,
      eq(checkoutAppointments.status, 'accepted'),
      lt(checkoutAppointments.startTime, input.endTime),
      gt(checkoutAppointments.endTime, input.startTime)
    ),
    with: {
      user: true,
      machine: true,
      manager: true,
      reviewer: true,
      resultedByUser: true,
    },
    orderBy: [asc(checkoutAppointments.startTime)],
  })
}

export async function requestCheckoutAppointment(input: {
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

  const existingActiveRequestForMachine = await db.query.checkoutAppointments.findFirst({
    where: and(
      eq(checkoutAppointments.userId, input.userId),
      eq(checkoutAppointments.machineId, input.machineId),
      inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
      gt(checkoutAppointments.endTime, new Date())
    ),
    columns: { id: true },
  })

  if (existingActiveRequestForMachine) {
    return {
      success: false,
      error: 'You already have an active checkout request for this machine or tool',
    }
  }

  const requestResult = await db.transaction(async (tx) => {
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

    const existingRequestAfterLock = await tx.query.checkoutAppointments.findFirst({
      where: and(
        eq(checkoutAppointments.userId, input.userId),
        eq(checkoutAppointments.machineId, input.machineId),
        inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
        gt(checkoutAppointments.endTime, new Date())
      ),
      columns: { id: true },
    })

    if (existingRequestAfterLock) {
      return {
        success: false,
        error: 'You already have an active checkout request for this machine or tool',
      } as const
    }

    const conflicts = await tx.query.checkoutAppointments.findMany({
      where: and(
        inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
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
        status: 'pending',
        notes: input.notes,
      } satisfies NewCheckoutAppointment)
      .returning()

    await tx.insert(checkoutAppointmentEvents).values({
      appointmentId: appointment.id,
      eventType: 'requested',
      actorId: user.id,
      actorRole: user.role,
      fromStatus: null,
      toStatus: 'pending',
      metadata: {
        machineId: machine.id,
        managerId: input.managerId,
      },
    } satisfies NewCheckoutAppointmentEvent)

    return { success: true, data: appointment } as const
  })

  if (!requestResult.success) {
    return requestResult
  }

  await notifyAdminsCheckoutRequestSubmitted({
    requestedByUserId: user.id,
    userName: user.name || user.email,
    machineName: machine.name,
    machineId: machine.id,
    appointmentId: requestResult.data.id,
    managerId: input.managerId,
    startTimeIso: requestResult.data.startTime.toISOString(),
    endTimeIso: requestResult.data.endTime.toISOString(),
  })

  return { success: true, data: requestResult.data }
}

export async function bookCheckoutAppointment(input: {
  userId: string
  machineId: string
  managerId: string
  slotStartTime: Date
  notes?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAppointments.$inferSelect>> {
  return requestCheckoutAppointment(input)
}

export async function moderateCheckoutAppointmentRequest(input: {
  appointmentId: string
  adminId: string
  decision: 'accept' | 'reject'
  reason?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAppointments.$inferSelect>> {
  const admin = await db.query.users.findFirst({
    where: eq(users.id, input.adminId),
    columns: {
      id: true,
      role: true,
      status: true,
      email: true,
      name: true,
    },
  })

  if (!admin || admin.status !== 'active' || admin.role !== 'admin') {
    return { success: false, error: 'Only active admins can moderate checkout requests' }
  }

  const appointment = await db.query.checkoutAppointments.findFirst({
    where: eq(checkoutAppointments.id, input.appointmentId),
    with: {
      user: {
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
      manager: {
        columns: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  })

  if (!appointment) {
    return { success: false, error: 'Checkout appointment not found' }
  }

  if (appointment.status !== 'pending') {
    return { success: false, error: 'Only pending requests can be moderated' }
  }

  const decisionReason = input.reason?.trim() || null
  if (input.decision === 'reject' && !decisionReason) {
    return { success: false, error: 'A rejection reason is required' }
  }

  if (input.decision === 'accept' && appointment.startTime <= new Date()) {
    return { success: false, error: 'Past checkout requests cannot be accepted' }
  }

  const nextStatus = input.decision === 'accept' ? 'accepted' : 'rejected'
  const now = new Date()

  const moderationResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MANAGER_LOCK_NAMESPACE}, hashtext(${appointment.managerId}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(${MACHINE_LOCK_NAMESPACE}, hashtext(${appointment.machineId}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(${USER_LOCK_NAMESPACE}, hashtext(${appointment.userId}))`)

    const latest = await tx.query.checkoutAppointments.findFirst({
      where: eq(checkoutAppointments.id, appointment.id),
      columns: {
        id: true,
        userId: true,
        machineId: true,
        managerId: true,
        startTime: true,
        endTime: true,
        status: true,
      },
    })

    if (!latest) {
      return { success: false, error: 'Checkout appointment not found' } as const
    }

    if (latest.status !== 'pending') {
      return { success: false, error: 'Only pending requests can be moderated' } as const
    }

    if (nextStatus === 'accepted') {
      const conflicts = await tx.query.checkoutAppointments.findMany({
        where: and(
          ne(checkoutAppointments.id, latest.id),
          inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
          lt(checkoutAppointments.startTime, latest.endTime),
          gt(checkoutAppointments.endTime, latest.startTime),
          or(
            eq(checkoutAppointments.machineId, latest.machineId),
            eq(checkoutAppointments.managerId, latest.managerId),
            eq(checkoutAppointments.userId, latest.userId)
          )
        ),
        columns: { id: true },
      })

      if (conflicts.length > 0) {
        return {
          success: false,
          error: 'Cannot accept this request because the slot now conflicts with another checkout request',
        } as const
      }
    }

    const [updated] = await tx
      .update(checkoutAppointments)
      .set({
        status: nextStatus,
        reviewedBy: admin.id,
        reviewedAt: now,
        decisionReason,
        updatedAt: now,
      })
      .where(eq(checkoutAppointments.id, latest.id))
      .returning()

    await tx.insert(checkoutAppointmentEvents).values({
      appointmentId: latest.id,
      eventType: nextStatus === 'accepted' ? 'accepted' : 'rejected',
      actorId: admin.id,
      actorRole: admin.role,
      fromStatus: 'pending',
      toStatus: nextStatus,
      metadata: {
        reason: decisionReason,
      },
    } satisfies NewCheckoutAppointmentEvent)

    return { success: true, data: updated } as const
  })

  if (!moderationResult.success) {
    return moderationResult
  }

  if (nextStatus === 'accepted') {
    await notifyUserCheckoutRequestAccepted({
      userId: appointment.user.id,
      adminName: admin.name || admin.email,
      machineName: appointment.machine.name,
      machineId: appointment.machine.id,
      appointmentId: appointment.id,
      startTimeIso: appointment.startTime.toISOString(),
      endTimeIso: appointment.endTime.toISOString(),
    })
  } else {
    await notifyUserCheckoutRequestRejected({
      userId: appointment.user.id,
      adminName: admin.name || admin.email,
      machineName: appointment.machine.name,
      machineId: appointment.machine.id,
      appointmentId: appointment.id,
      reason: decisionReason || 'No reason provided',
      startTimeIso: appointment.startTime.toISOString(),
      endTimeIso: appointment.endTime.toISOString(),
    })
  }

  return moderationResult
}

export async function finalizeCheckoutAppointment(input: {
  appointmentId: string
  adminId: string
  result: 'pass' | 'fail'
  notes?: string
}): Promise<
  CheckoutSchedulingResult<{
    appointment: typeof checkoutAppointments.$inferSelect
    checkoutGranted: boolean
  }>
> {
  const admin = await db.query.users.findFirst({
    where: eq(users.id, input.adminId),
    columns: {
      id: true,
      role: true,
      status: true,
      email: true,
      name: true,
    },
  })

  if (!admin || admin.status !== 'active' || admin.role !== 'admin') {
    return { success: false, error: 'Only active admins can finalize checkout meetings' }
  }

  const appointment = await db.query.checkoutAppointments.findFirst({
    where: eq(checkoutAppointments.id, input.appointmentId),
    with: {
      user: {
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

  if (appointment.status !== 'accepted') {
    return { success: false, error: 'Only accepted checkout meetings can be finalized' }
  }

  const now = new Date()
  const trimmedNotes = input.notes?.trim() || null

  const finalizeResult = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MACHINE_LOCK_NAMESPACE}, hashtext(${appointment.machineId}))`)
    await tx.execute(sql`select pg_advisory_xact_lock(${USER_LOCK_NAMESPACE}, hashtext(${appointment.userId}))`)

    const latest = await tx.query.checkoutAppointments.findFirst({
      where: eq(checkoutAppointments.id, appointment.id),
      columns: {
        id: true,
        userId: true,
        machineId: true,
        status: true,
      },
    })

    if (!latest) {
      return { success: false, error: 'Checkout appointment not found' } as const
    }

    if (latest.status !== 'accepted') {
      return {
        success: false,
        error: 'Only accepted checkout meetings can be finalized',
      } as const
    }

    let checkoutGranted = false

    if (input.result === 'pass') {
      const existingCheckout = await tx.query.managerCheckouts.findFirst({
        where: and(
          eq(managerCheckouts.userId, latest.userId),
          eq(managerCheckouts.machineId, latest.machineId)
        ),
        columns: { id: true },
      })

      if (!existingCheckout) {
        await tx.insert(managerCheckouts).values({
          userId: latest.userId,
          machineId: latest.machineId,
          approvedBy: admin.id,
          notes: trimmedNotes ?? `Checkout passed via appointment ${latest.id}`,
        })
        checkoutGranted = true
      }
    }

    const [updated] = await tx
      .update(checkoutAppointments)
      .set({
        status: 'completed',
        result: input.result,
        resultNotes: trimmedNotes,
        resultedBy: admin.id,
        resultedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(checkoutAppointments.id, latest.id))
      .returning()

    await tx.insert(checkoutAppointmentEvents).values({
      appointmentId: latest.id,
      eventType: input.result === 'pass' ? 'passed' : 'failed',
      actorId: admin.id,
      actorRole: admin.role,
      fromStatus: 'accepted',
      toStatus: 'completed',
      metadata: {
        result: input.result,
        notes: trimmedNotes,
        checkoutGranted,
      },
    } satisfies NewCheckoutAppointmentEvent)

    return {
      success: true,
      data: {
        appointment: updated,
        checkoutGranted,
      },
    } as const
  })

  if (!finalizeResult.success) {
    return finalizeResult
  }

  if (input.result === 'pass') {
    await notifyUserCheckoutResultPassed({
      userId: appointment.user.id,
      adminName: admin.name || admin.email,
      machineName: appointment.machine.name,
      machineId: appointment.machine.id,
      appointmentId: appointment.id,
      startTimeIso: appointment.startTime.toISOString(),
      endTimeIso: appointment.endTime.toISOString(),
    })
  } else {
    await notifyUserCheckoutResultFailed({
      userId: appointment.user.id,
      adminName: admin.name || admin.email,
      machineName: appointment.machine.name,
      machineId: appointment.machine.id,
      appointmentId: appointment.id,
      startTimeIso: appointment.startTime.toISOString(),
      endTimeIso: appointment.endTime.toISOString(),
      notes: trimmedNotes || undefined,
    })
  }

  return finalizeResult
}

export async function cancelFutureCheckoutAppointmentsForUserMachine(input: {
  userId: string
  machineId: string
  reason?: string
  actedByUserId?: string
  actedByRole?: 'manager' | 'admin'
}) {
  const now = new Date()

  const targets = await db.query.checkoutAppointments.findMany({
    where: and(
      eq(checkoutAppointments.userId, input.userId),
      eq(checkoutAppointments.machineId, input.machineId),
      inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
      gt(checkoutAppointments.startTime, now)
    ),
    columns: {
      id: true,
      status: true,
    },
  })

  if (targets.length === 0) {
    return []
  }

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(checkoutAppointments)
      .set({
        status: 'cancelled',
        cancellationReason: input.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(checkoutAppointments.userId, input.userId),
          eq(checkoutAppointments.machineId, input.machineId),
          inArray(checkoutAppointments.status, [...CONFLICT_APPOINTMENT_STATUSES]),
          gt(checkoutAppointments.startTime, now)
        )
      )
      .returning({
        id: checkoutAppointments.id,
      })

    const eventRows: NewCheckoutAppointmentEvent[] = targets.map((target) => ({
      appointmentId: target.id,
      eventType: 'cancelled',
      actorId: input.actedByUserId ?? null,
      actorRole: input.actedByRole ?? null,
      fromStatus: target.status,
      toStatus: 'cancelled',
      metadata: {
        reason: input.reason || null,
        source: 'cancelFutureCheckoutAppointmentsForUserMachine',
      },
    }))

    await tx.insert(checkoutAppointmentEvents).values(eventRows)

    return updated
  })
}

export async function cancelCheckoutAppointmentByManager(input: {
  appointmentId: string
  managerId: string
  actorRole?: 'member' | 'manager' | 'admin'
  actorName?: string
  reason?: string
}): Promise<CheckoutSchedulingResult<typeof checkoutAppointments.$inferSelect>> {
  const appointment = await db.query.checkoutAppointments.findFirst({
    where: eq(checkoutAppointments.id, input.appointmentId),
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

  const actorRole = input.actorRole ?? 'manager'
  if (actorRole === 'manager' && appointment.managerId !== input.managerId) {
    return { success: false, error: 'Only the assigned manager can cancel this appointment' }
  }
  if (actorRole === 'member' && appointment.user.id !== input.managerId) {
    return { success: false, error: 'Only the requesting member can cancel this appointment' }
  }

  if (appointment.status !== 'pending' && appointment.status !== 'accepted') {
    return { success: false, error: 'Only pending or accepted appointments can be cancelled' }
  }

  if (appointment.startTime <= new Date()) {
    return { success: false, error: 'Only future appointments can be cancelled' }
  }

  const [updated] = await db.transaction(async (tx) => {
    const [next] = await tx
      .update(checkoutAppointments)
      .set({
        status: 'cancelled',
        cancellationReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(checkoutAppointments.id, input.appointmentId))
      .returning()

    await tx.insert(checkoutAppointmentEvents).values({
      appointmentId: appointment.id,
      eventType: 'cancelled',
      actorId: input.managerId,
      actorRole,
      fromStatus: appointment.status,
      toStatus: 'cancelled',
      metadata: {
        reason: input.reason || null,
      },
    } satisfies NewCheckoutAppointmentEvent)

    return [next]
  })

  if (actorRole !== 'member') {
    await notifyUserCheckoutAppointmentCancelled({
      userId: appointment.user.id,
      managerName:
        input.actorName || appointment.manager.name || appointment.manager.email,
      machineName: appointment.machine.name,
      machineId: appointment.machine.id,
      appointmentId: appointment.id,
      startTimeIso: appointment.startTime.toISOString(),
      endTimeIso: appointment.endTime.toISOString(),
      reason: input.reason,
    })
  }

  return { success: true, data: updated }
}
