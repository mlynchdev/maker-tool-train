import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    query: {
      users: { findFirst: vi.fn() },
      machines: { findFirst: vi.fn() },
      managerCheckouts: { findFirst: vi.fn() },
      checkoutAvailabilityRules: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      checkoutAppointments: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  }

  return {
    db,
    users: { id: 'users.id' },
    machines: { id: 'machines.id' },
    managerCheckouts: {
      id: 'manager_checkouts.id',
      userId: 'manager_checkouts.user_id',
      machineId: 'manager_checkouts.machine_id',
    },
    checkoutAvailabilityRules: {
      id: 'checkout_availability_rules.id',
      managerId: 'checkout_availability_rules.manager_id',
      dayOfWeek: 'checkout_availability_rules.day_of_week',
      startMinuteOfDay: 'checkout_availability_rules.start_minute_of_day',
      endMinuteOfDay: 'checkout_availability_rules.end_minute_of_day',
      active: 'checkout_availability_rules.active',
      updatedAt: 'checkout_availability_rules.updated_at',
    },
    checkoutAppointments: {
      id: 'checkout_appointments.id',
      userId: 'checkout_appointments.user_id',
      machineId: 'checkout_appointments.machine_id',
      managerId: 'checkout_appointments.manager_id',
      startTime: 'checkout_appointments.start_time',
      endTime: 'checkout_appointments.end_time',
      status: 'checkout_appointments.status',
    },
    checkoutAppointmentEvents: {
      id: 'checkout_appointment_events.id',
      appointmentId: 'checkout_appointment_events.appointment_id',
      eventType: 'checkout_appointment_events.event_type',
    },
    getMakerspaceTimezone: vi.fn(),
    checkEligibility: vi.fn(),
    notifyAdminsCheckoutRequestSubmitted: vi.fn(),
    notifyUserCheckoutRequestAccepted: vi.fn(),
    notifyUserCheckoutRequestRejected: vi.fn(),
    notifyUserCheckoutResultPassed: vi.fn(),
    notifyUserCheckoutResultFailed: vi.fn(),
    notifyUserCheckoutAppointmentCancelled: vi.fn(),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  asc: vi.fn((arg: unknown) => ({ kind: 'asc', arg })),
  eq: vi.fn((...args: unknown[]) => ({ kind: 'eq', args })),
  gt: vi.fn((...args: unknown[]) => ({ kind: 'gt', args })),
  gte: vi.fn((...args: unknown[]) => ({ kind: 'gte', args })),
  inArray: vi.fn((...args: unknown[]) => ({ kind: 'inArray', args })),
  lt: vi.fn((...args: unknown[]) => ({ kind: 'lt', args })),
  lte: vi.fn((...args: unknown[]) => ({ kind: 'lte', args })),
  ne: vi.fn((...args: unknown[]) => ({ kind: 'ne', args })),
  or: vi.fn((...args: unknown[]) => ({ kind: 'or', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings,
    values,
  })),
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  users: mocks.users,
  machines: mocks.machines,
  managerCheckouts: mocks.managerCheckouts,
  checkoutAvailabilityRules: mocks.checkoutAvailabilityRules,
  checkoutAppointments: mocks.checkoutAppointments,
  checkoutAppointmentEvents: mocks.checkoutAppointmentEvents,
}))

vi.mock('./eligibility', () => ({
  checkEligibility: mocks.checkEligibility,
}))

vi.mock('./makerspace-settings', () => ({
  getMakerspaceTimezone: mocks.getMakerspaceTimezone,
}))

vi.mock('./notifications', () => ({
  notifyAdminsCheckoutRequestSubmitted: mocks.notifyAdminsCheckoutRequestSubmitted,
  notifyUserCheckoutRequestAccepted: mocks.notifyUserCheckoutRequestAccepted,
  notifyUserCheckoutRequestRejected: mocks.notifyUserCheckoutRequestRejected,
  notifyUserCheckoutResultPassed: mocks.notifyUserCheckoutResultPassed,
  notifyUserCheckoutResultFailed: mocks.notifyUserCheckoutResultFailed,
  notifyUserCheckoutAppointmentCancelled: mocks.notifyUserCheckoutAppointmentCancelled,
}))

import {
  bookCheckoutAppointment,
  cancelFutureCheckoutAppointmentsForUserMachine,
  cancelCheckoutAppointmentByManager,
  createCheckoutAvailabilityBlock,
  deactivateCheckoutAvailabilityBlock,
  finalizeCheckoutAppointment,
  moderateCheckoutAppointmentRequest,
} from './checkout-scheduling'
import {
  notifyAdminsCheckoutRequestSubmitted,
  notifyUserCheckoutAppointmentCancelled,
  notifyUserCheckoutRequestAccepted,
  notifyUserCheckoutResultFailed,
} from './notifications'

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function getMinuteOfDayInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date)

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')

  return hour * 60 + minute
}

function getDayOfWeekInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).formatToParts(date)

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun'
  return WEEKDAY_TO_NUMBER[weekday] ?? 0
}

function mockInsertReturning(row: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([row])
  const values = vi.fn().mockReturnValue({ returning })
  mocks.db.insert.mockReturnValue({ values })
}

function mockUpdateReturning(row: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([row])
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  mocks.db.update.mockReturnValue({ set })
}

function mockTransactionalUpdateReturning(rows: Array<Record<string, unknown>>) {
  const tx = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  }

  mocks.db.transaction.mockImplementation(async (callback: (arg: unknown) => unknown) => {
    return callback(tx)
  })
}

function mockSuccessfulBookingTransaction(
  appointment: Record<string, unknown>,
  conflicts: Array<Record<string, unknown>> = []
) {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      managerCheckouts: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      checkoutAppointments: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(conflicts),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([appointment]),
      }),
    }),
  }

  mocks.db.transaction.mockImplementation(async (callback: (arg: unknown) => unknown) => {
    return callback(tx)
  })
}

function mockModerationTransaction(updated: Record<string, unknown>) {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      checkoutAppointments: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'appointment-1',
          userId: 'member-1',
          machineId: 'machine-1',
          managerId: 'manager-1',
          startTime: new Date(Date.now() + 60 * 60 * 1000),
          endTime: new Date(Date.now() + 90 * 60 * 1000),
          status: 'pending',
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  }

  mocks.db.transaction.mockImplementation(async (callback: (arg: unknown) => unknown) => {
    return callback(tx)
  })
}

function mockFinalizeFailTransaction(updated: Record<string, unknown>) {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    query: {
      checkoutAppointments: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'appointment-2',
          userId: 'member-1',
          machineId: 'machine-1',
          status: 'accepted',
        }),
      },
      managerCheckouts: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  }

  mocks.db.transaction.mockImplementation(async (callback: (arg: unknown) => unknown) => {
    return callback(tx)
  })
}

describe('checkout-scheduling service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMakerspaceTimezone.mockResolvedValue('America/Los_Angeles')
    mocks.db.query.managerCheckouts.findFirst.mockResolvedValue(null)
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue(null)
    mocks.db.query.checkoutAppointments.findMany.mockResolvedValue([])
    mocks.checkEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      requirements: [{ completed: true }],
      hasCheckout: false,
    })
  })

  it('rejects overlapping recurring availability rules for the same manager/day', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'manager-1',
      role: 'manager',
      status: 'active',
    })
    mocks.db.query.checkoutAvailabilityRules.findMany.mockResolvedValue([{ id: 'rule-1' }])

    const result = await createCheckoutAvailabilityBlock({
      managerId: 'manager-1',
      dayOfWeek: 6,
      startMinuteOfDay: 14 * 60,
      endMinuteOfDay: 16 * 60,
    })

    expect(result).toEqual({
      success: false,
      error: 'This recurring availability overlaps another rule you already set',
    })
  })

  it('creates recurring availability rules when there are no conflicts', async () => {
    const rule = {
      id: 'rule-2',
      managerId: 'manager-1',
      dayOfWeek: 6,
      startMinuteOfDay: 14 * 60,
      endMinuteOfDay: 22 * 60,
      timezone: 'America/New_York',
      active: true,
    }

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'manager-1',
      role: 'manager',
      status: 'active',
    })
    mocks.db.query.checkoutAvailabilityRules.findMany.mockResolvedValue([])
    mockInsertReturning(rule)

    const result = await createCheckoutAvailabilityBlock({
      managerId: 'manager-1',
      dayOfWeek: 6,
      startMinuteOfDay: rule.startMinuteOfDay,
      endMinuteOfDay: rule.endMinuteOfDay,
    })

    expect(result).toEqual({
      success: true,
      data: rule,
    })
  })

  it('allows booking when training is complete and manager checkout is still pending', async () => {
    const slotStartTime = new Date(Date.now() + 2 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)
    const appointmentEnd = new Date(slotStartTime.getTime() + 30 * 60 * 1000)

    const appointment = {
      id: 'appointment-pending-checkout',
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      startTime: slotStartTime,
      endTime: appointmentEnd,
      status: 'pending',
    }

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      startMinuteOfDay: getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles'),
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })
    mocks.checkEligibility.mockResolvedValue({
      eligible: false,
      reasons: ['Manager checkout not approved'],
      requirements: [{ completed: true }],
      hasCheckout: false,
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue(null)

    mockSuccessfulBookingTransaction(appointment)

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: true,
      data: appointment,
    })
    expect(notifyAdminsCheckoutRequestSubmitted).toHaveBeenCalledTimes(1)
  })

  it('rejects booking when overlapping checkout appointment already exists', async () => {
    const slotStartTime = new Date(Date.now() + 3 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      startMinuteOfDay: getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles'),
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue(null)

    mockSuccessfulBookingTransaction(
      {
        id: 'unused-appointment',
      },
      [{ id: 'existing-conflict' }]
    )

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: false,
      error: 'This checkout slot has already been booked',
    })
  })

  it('rejects booking when manager checkout already exists for that machine', async () => {
    const slotStartTime = new Date(Date.now() + 3 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.managerCheckouts.findFirst.mockResolvedValue({
      id: 'checkout-1',
      userId: 'member-1',
      machineId: 'machine-1',
    })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: false,
      error: 'You are already checked out for this machine or tool',
    })
    expect(mocks.db.transaction).not.toHaveBeenCalled()
  })

  it('rejects booking when user already has an active checkout request for the same machine', async () => {
    const slotStartTime = new Date(Date.now() + 3 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      startMinuteOfDay: getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles'),
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({ id: 'appointment-1' })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: false,
      error: 'You already have an active checkout request for this machine or tool',
    })
    expect(mocks.db.transaction).not.toHaveBeenCalled()
  })

  it('matches manager availability using makerspace timezone instead of UTC day/hour', async () => {
    const slotStartTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    slotStartTime.setUTCHours(1, 30, 0, 0)
    const appointmentEnd = new Date(slotStartTime.getTime() + 30 * 60 * 1000)
    const expectedDayOfWeek = getDayOfWeekInTimeZone(slotStartTime, 'America/Los_Angeles')
    const expectedStartMinute = getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles')
    const expectedEndMinute = expectedStartMinute + 30

    mocks.getMakerspaceTimezone.mockResolvedValue('America/Los_Angeles')
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockImplementation(
      ({ where }: { where?: { args?: Array<{ kind?: string; args?: unknown[] }> } }) => {
        const clauses = where?.args ?? []
        const hasExpectedDay = clauses.some(
          (clause) =>
            clause.kind === 'eq' &&
            clause.args?.[0] === mocks.checkoutAvailabilityRules.dayOfWeek &&
            clause.args?.[1] === expectedDayOfWeek
        )
        const hasExpectedStartMinute = clauses.some(
          (clause) =>
            clause.kind === 'lte' &&
            clause.args?.[0] === mocks.checkoutAvailabilityRules.startMinuteOfDay &&
            clause.args?.[1] === expectedStartMinute
        )
        const hasExpectedEndMinute = clauses.some(
          (clause) =>
            clause.kind === 'gte' &&
            clause.args?.[0] === mocks.checkoutAvailabilityRules.endMinuteOfDay &&
            clause.args?.[1] === expectedEndMinute
        )

        if (!hasExpectedDay || !hasExpectedStartMinute || !hasExpectedEndMinute) {
          return Promise.resolve(null)
        }

        return Promise.resolve({
          id: 'rule-1',
          managerId: 'manager-1',
          startMinuteOfDay: expectedStartMinute,
          manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
        })
      }
    )
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue(null)

    mockSuccessfulBookingTransaction({
      id: 'timezone-appointment',
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      startTime: slotStartTime,
      endTime: appointmentEnd,
      status: 'pending',
    })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(expectedDayOfWeek).not.toBe(slotStartTime.getUTCDay())
    expect(result).toEqual({
      success: true,
      data: {
        id: 'timezone-appointment',
        userId: 'member-1',
        machineId: 'machine-1',
        managerId: 'manager-1',
        startTime: slotStartTime,
        endTime: appointmentEnd,
        status: 'pending',
      },
    })
  })

  it('rejects booking when start time is not aligned to the training duration grid', async () => {
    const slotStartTime = new Date(Date.now() + 5 * 60 * 60 * 1000)
    slotStartTime.setMinutes(15, 0, 0)
    const slotStartMinuteOfDay = getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles')
    const ruleStartMinuteOfDay = slotStartMinuteOfDay - (slotStartMinuteOfDay % 60)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      startMinuteOfDay: ruleStartMinuteOfDay,
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: false,
      error: 'This checkout slot is no longer available',
    })
    expect(mocks.db.transaction).not.toHaveBeenCalled()
  })

  it('rejects checkout appointment booking when member already has checkout access', async () => {
    const slotStartTime = new Date(Date.now() + 4 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
      role: 'member',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
      trainingDurationMinutes: 30,
    })
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      startMinuteOfDay: getMinuteOfDayInTimeZone(slotStartTime, 'America/Los_Angeles'),
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })
    mocks.checkEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      requirements: [{ completed: true }],
      hasCheckout: true,
    })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: false,
      error: 'You are already checked out for this machine or tool',
    })
  })

  it('cancels future pending/accepted appointments for a user/machine pair', async () => {
    mocks.db.query.checkoutAppointments.findMany.mockResolvedValue([
      { id: 'appointment-future-1', status: 'pending' },
    ])
    mockTransactionalUpdateReturning([{ id: 'appointment-future-1' }])

    const result = await cancelFutureCheckoutAppointmentsForUserMachine({
      userId: 'member-1',
      machineId: 'machine-1',
      reason: 'Checkout approval revoked',
    })

    expect(result).toEqual([{ id: 'appointment-future-1' }])
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1)
  })

  it('cancels an accepted future appointment by manager/admin', async () => {
    const startTime = new Date(Date.now() + 6 * 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-1',
      managerId: 'manager-1',
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      status: 'accepted',
      startTime,
      endTime,
    })
    mockTransactionalUpdateReturning([
      {
        id: 'appointment-1',
        status: 'cancelled',
        startTime,
        endTime,
      },
    ])

    const result = await cancelCheckoutAppointmentByManager({
      appointmentId: 'appointment-1',
      managerId: 'manager-1',
      reason: 'Unexpected emergency',
    })

    expect(result).toEqual({
      success: true,
      data: {
        id: 'appointment-1',
        status: 'cancelled',
        startTime,
        endTime,
      },
    })
    expect(notifyUserCheckoutAppointmentCancelled).toHaveBeenCalledTimes(1)
  })

  it('allows a member to cancel their own future checkout appointment', async () => {
    const startTime = new Date(Date.now() + 4 * 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-member-1',
      managerId: 'manager-1',
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      status: 'pending',
      startTime,
      endTime,
    })
    mockTransactionalUpdateReturning([
      {
        id: 'appointment-member-1',
        status: 'cancelled',
        startTime,
        endTime,
      },
    ])

    const result = await cancelCheckoutAppointmentByManager({
      appointmentId: 'appointment-member-1',
      managerId: 'member-1',
      actorRole: 'member',
      reason: 'Schedule conflict',
    })

    expect(result).toEqual({
      success: true,
      data: {
        id: 'appointment-member-1',
        status: 'cancelled',
        startTime,
        endTime,
      },
    })
    expect(notifyUserCheckoutAppointmentCancelled).not.toHaveBeenCalled()
  })

  it('does not allow cancelling an appointment that already started', async () => {
    const startTime = new Date(Date.now() - 10 * 60 * 1000)

    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-2',
      managerId: 'manager-1',
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      status: 'accepted',
      startTime,
      endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
    })

    const result = await cancelCheckoutAppointmentByManager({
      appointmentId: 'appointment-2',
      managerId: 'manager-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'Only future appointments can be cancelled',
    })
  })

  it('allows admin to accept a pending checkout request', async () => {
    const startTime = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-1',
      userId: 'member-1',
      managerId: 'manager-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime,
      endTime,
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
    })
    mockModerationTransaction({
      id: 'appointment-1',
      status: 'accepted',
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
    })

    const result = await moderateCheckoutAppointmentRequest({
      appointmentId: 'appointment-1',
      adminId: 'admin-1',
      decision: 'accept',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe('accepted')
    }
    expect(notifyUserCheckoutRequestAccepted).toHaveBeenCalledTimes(1)
  })

  it('records failed checkout outcomes without granting checkout access', async () => {
    const startTime = new Date(Date.now() - 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-2',
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      status: 'accepted',
      startTime,
      endTime,
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })
    mockFinalizeFailTransaction({
      id: 'appointment-2',
      status: 'completed',
      result: 'fail',
      resultedBy: 'admin-1',
      resultedAt: new Date(),
    })

    const result = await finalizeCheckoutAppointment({
      appointmentId: 'appointment-2',
      adminId: 'admin-1',
      result: 'fail',
      notes: 'Needs more supervised practice',
    })

    expect(result).toEqual({
      success: true,
      data: {
        appointment: {
          id: 'appointment-2',
          status: 'completed',
          result: 'fail',
          resultedBy: 'admin-1',
          resultedAt: expect.any(Date),
        },
        checkoutGranted: false,
      },
    })
    expect(notifyUserCheckoutResultFailed).toHaveBeenCalledTimes(1)
  })

  it('allows finalizing an accepted checkout before its scheduled start time', async () => {
    const startTime = new Date(Date.now() + 45 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      status: 'active',
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-early',
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      status: 'accepted',
      startTime,
      endTime,
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })
    mockFinalizeFailTransaction({
      id: 'appointment-early',
      status: 'completed',
      result: 'fail',
      resultedBy: 'admin-1',
      resultedAt: new Date(),
    })

    const result = await finalizeCheckoutAppointment({
      appointmentId: 'appointment-early',
      adminId: 'admin-1',
      result: 'fail',
      notes: 'Member requested an early outcome',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.appointment.status).toBe('completed')
      expect(result.data.appointment.result).toBe('fail')
    }
  })

  it('deactivates an existing availability rule', async () => {
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue({
      id: 'rule-1',
      managerId: 'manager-1',
      active: true,
    })
    const deactivatedRule = {
      id: 'rule-1',
      managerId: 'manager-1',
      active: false,
    }
    mockUpdateReturning(deactivatedRule)

    const result = await deactivateCheckoutAvailabilityBlock({
      ruleId: 'rule-1',
      managerId: 'manager-1',
    })

    expect(result).toEqual({
      success: true,
      data: deactivatedRule,
    })
  })

  it('returns not found when deactivating a nonexistent rule', async () => {
    mocks.db.query.checkoutAvailabilityRules.findFirst.mockResolvedValue(null)

    const result = await deactivateCheckoutAvailabilityBlock({
      ruleId: 'nonexistent',
      managerId: 'manager-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'Availability rule not found',
    })
  })

  it('rejects availability block with invalid day of week', async () => {
    const result = await createCheckoutAvailabilityBlock({
      managerId: 'manager-1',
      dayOfWeek: 7,
      startMinuteOfDay: 8 * 60,
      endMinuteOfDay: 10 * 60,
    })

    expect(result).toEqual({
      success: false,
      error: 'Invalid day of week',
    })
  })

  it('rejects availability block with end time before start time', async () => {
    const result = await createCheckoutAvailabilityBlock({
      managerId: 'manager-1',
      dayOfWeek: 3,
      startMinuteOfDay: 16 * 60,
      endMinuteOfDay: 10 * 60,
    })

    expect(result).toEqual({
      success: false,
      error: 'End time must be after start time',
    })
  })
})
