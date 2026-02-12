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
    getMakerspaceTimezone: vi.fn(),
    checkEligibility: vi.fn(),
    notifyManagerCheckoutAppointmentBooked: vi.fn(),
    notifyUserCheckoutAppointmentBooked: vi.fn(),
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
}))

vi.mock('./eligibility', () => ({
  checkEligibility: mocks.checkEligibility,
}))

vi.mock('./makerspace-settings', () => ({
  getMakerspaceTimezone: mocks.getMakerspaceTimezone,
}))

vi.mock('./notifications', () => ({
  notifyManagerCheckoutAppointmentBooked: mocks.notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked: mocks.notifyUserCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentCancelled: mocks.notifyUserCheckoutAppointmentCancelled,
}))

import {
  bookCheckoutAppointment,
  cancelFutureCheckoutAppointmentsForUserMachine,
  cancelCheckoutAppointmentByManager,
  createCheckoutAvailabilityBlock,
} from './checkout-scheduling'
import {
  notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentCancelled,
} from './notifications'

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

describe('checkout-scheduling service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.getMakerspaceTimezone.mockResolvedValue('America/Los_Angeles')
    mocks.db.query.managerCheckouts.findFirst.mockResolvedValue(null)
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
      status: 'scheduled',
    }

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
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
      startMinuteOfDay: slotStartTime.getHours() * 60,
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
    expect(notifyManagerCheckoutAppointmentBooked).toHaveBeenCalledTimes(1)
    expect(notifyUserCheckoutAppointmentBooked).toHaveBeenCalledTimes(1)
  })

  it('rejects booking when overlapping checkout appointment already exists', async () => {
    const slotStartTime = new Date(Date.now() + 3 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
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
      startMinuteOfDay: slotStartTime.getHours() * 60,
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

  it('rejects booking when user already has another upcoming checkout appointment', async () => {
    const slotStartTime = new Date(Date.now() + 3 * 60 * 60 * 1000)
    slotStartTime.setMinutes(0, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
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
      startMinuteOfDay: slotStartTime.getHours() * 60,
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
      error: 'You already have an upcoming checkout appointment',
    })
    expect(mocks.db.transaction).not.toHaveBeenCalled()
  })

  it('matches manager availability using makerspace timezone instead of UTC day/hour', async () => {
    const slotStartTime = new Date('2026-02-14T01:30:00.000Z')
    const appointmentEnd = new Date(slotStartTime.getTime() + 30 * 60 * 1000)
    const expectedDayOfWeek = 5 // Friday in America/Los_Angeles
    const expectedStartMinute = 17 * 60 + 30
    const expectedEndMinute = expectedStartMinute + 30

    mocks.getMakerspaceTimezone.mockResolvedValue('America/Los_Angeles')
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
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
      status: 'scheduled',
    })

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'manager-1',
      slotStartTime,
    })

    expect(result).toEqual({
      success: true,
      data: {
        id: 'timezone-appointment',
        userId: 'member-1',
        machineId: 'machine-1',
        managerId: 'manager-1',
        startTime: slotStartTime,
        endTime: appointmentEnd,
        status: 'scheduled',
      },
    })
  })

  it('rejects booking when start time is not aligned to the training duration grid', async () => {
    const slotStartTime = new Date(Date.now() + 5 * 60 * 60 * 1000)
    slotStartTime.setMinutes(15, 0, 0)

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
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
      startMinuteOfDay: slotStartTime.getHours() * 60,
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
      startMinuteOfDay: slotStartTime.getHours() * 60,
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

  it('cancels future scheduled appointments for a user/machine pair', async () => {
    mockUpdateReturning({ id: 'appointment-future-1' })

    const result = await cancelFutureCheckoutAppointmentsForUserMachine({
      userId: 'member-1',
      machineId: 'machine-1',
      reason: 'Checkout approval revoked',
    })

    expect(result).toEqual([{ id: 'appointment-future-1' }])
    expect(mocks.db.update).toHaveBeenCalledTimes(1)
  })

  it('cancels a scheduled future appointment by manager/admin', async () => {
    const startTime = new Date(Date.now() + 6 * 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000)

    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-1',
      managerId: 'manager-1',
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      status: 'scheduled',
      startTime,
      endTime,
    })
    mockUpdateReturning({
      id: 'appointment-1',
      status: 'cancelled',
      startTime,
      endTime,
    })

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

  it('does not allow cancelling an appointment that already started', async () => {
    const startTime = new Date(Date.now() - 10 * 60 * 1000)

    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue({
      id: 'appointment-2',
      managerId: 'manager-1',
      user: { id: 'member-1', email: 'member@example.com', name: 'Member' },
      manager: { id: 'manager-1', email: 'manager@example.com', name: 'Manager' },
      machine: { id: 'machine-1', name: 'Laser Cutter' },
      status: 'scheduled',
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
})
