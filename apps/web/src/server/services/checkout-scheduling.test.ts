import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    query: {
      users: { findFirst: vi.fn() },
      machines: { findFirst: vi.fn() },
      checkoutAvailabilityBlocks: {
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
  }

  return {
    db,
    users: { id: 'users.id' },
    machines: { id: 'machines.id' },
    checkoutAvailabilityBlocks: {
      id: 'checkout_availability_blocks.id',
      machineId: 'checkout_availability_blocks.machine_id',
      managerId: 'checkout_availability_blocks.manager_id',
      startTime: 'checkout_availability_blocks.start_time',
      endTime: 'checkout_availability_blocks.end_time',
      active: 'checkout_availability_blocks.active',
      updatedAt: 'checkout_availability_blocks.updated_at',
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
    checkEligibility: vi.fn(),
    notifyManagerCheckoutAppointmentBooked: vi.fn(),
    notifyUserCheckoutAppointmentBooked: vi.fn(),
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
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  users: mocks.users,
  machines: mocks.machines,
  checkoutAvailabilityBlocks: mocks.checkoutAvailabilityBlocks,
  checkoutAppointments: mocks.checkoutAppointments,
}))

vi.mock('./eligibility', () => ({
  checkEligibility: mocks.checkEligibility,
}))

vi.mock('./notifications', () => ({
  notifyManagerCheckoutAppointmentBooked: mocks.notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked: mocks.notifyUserCheckoutAppointmentBooked,
}))

import {
  bookCheckoutAppointment,
  createCheckoutAvailabilityBlock,
} from './checkout-scheduling'
import {
  notifyManagerCheckoutAppointmentBooked,
  notifyUserCheckoutAppointmentBooked,
} from './notifications'

function mockInsertReturning(row: Record<string, unknown>) {
  const returning = vi.fn().mockResolvedValue([row])
  const values = vi.fn().mockReturnValue({ returning })
  mocks.db.insert.mockReturnValue({ values })
}

describe('checkout-scheduling service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      requirements: [],
      hasCheckout: false,
    })
  })

  it('rejects availability blocks with invalid date ranges', async () => {
    const result = await createCheckoutAvailabilityBlock({
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: new Date('2026-02-15T11:00:00.000Z'),
      endTime: new Date('2026-02-15T10:00:00.000Z'),
    })

    expect(result).toEqual({
      success: false,
      error: 'End time must be after start time',
    })
    expect(mocks.db.query.machines.findFirst).not.toHaveBeenCalled()
  })

  it('rejects overlapping availability blocks for the same manager', async () => {
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      active: true,
    })
    mocks.db.query.checkoutAvailabilityBlocks.findMany.mockResolvedValue([
      { id: 'block-1' },
    ])

    const result = await createCheckoutAvailabilityBlock({
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
    })

    expect(result).toEqual({
      success: false,
      error: 'This availability block overlaps another block you already set',
    })
  })

  it('creates availability blocks when there are no conflicts', async () => {
    const block = {
      id: 'block-2',
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      active: true,
    }

    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      active: true,
    })
    mocks.db.query.checkoutAvailabilityBlocks.findMany.mockResolvedValue([])
    mockInsertReturning(block)

    const result = await createCheckoutAvailabilityBlock({
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: block.startTime,
      endTime: block.endTime,
    })

    expect(result).toEqual({
      success: true,
      data: block,
    })
  })

  it('rejects checkout appointment booking when member already has checkout access', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
    })
    mocks.db.query.checkoutAvailabilityBlocks.findFirst.mockResolvedValue({
      id: 'block-1',
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      active: true,
      manager: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      machine: { id: 'machine-1', name: 'Laser Cutter', active: true },
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
      blockId: 'block-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'You are already checked out for this machine or tool',
    })
    expect(mocks.db.insert).not.toHaveBeenCalled()
  })

  it('books checkout appointments and emits notifications when eligible', async () => {
    const appointment = {
      id: 'appointment-1',
      userId: 'member-1',
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      status: 'scheduled',
    }

    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      name: 'Member',
      status: 'active',
    })
    mocks.db.query.checkoutAvailabilityBlocks.findFirst.mockResolvedValue({
      id: 'block-1',
      machineId: 'machine-1',
      managerId: 'admin-1',
      startTime: appointment.startTime,
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      active: true,
      manager: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      machine: { id: 'machine-1', name: 'Laser Cutter', active: true },
    })
    mocks.checkEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      requirements: [{ completed: true }],
      hasCheckout: false,
    })
    mocks.db.query.checkoutAppointments.findFirst.mockResolvedValue(null)
    mocks.db.query.checkoutAppointments.findMany.mockResolvedValue([])
    mockInsertReturning(appointment)

    const result = await bookCheckoutAppointment({
      userId: 'member-1',
      machineId: 'machine-1',
      blockId: 'block-1',
    })

    expect(result).toEqual({
      success: true,
      data: appointment,
    })
    expect(notifyManagerCheckoutAppointmentBooked).toHaveBeenCalledTimes(1)
    expect(notifyUserCheckoutAppointmentBooked).toHaveBeenCalledTimes(1)
  })
})
