import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    query: {
      machines: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
      reservations: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
  }

  return {
    db,
    machines: { id: 'machines.id', name: 'machines.name' },
    users: { id: 'users.id' },
    reservations: {
      id: 'reservations.id',
      machineId: 'reservations.machineId',
      userId: 'reservations.userId',
      status: 'reservations.status',
      startTime: 'reservations.startTime',
      endTime: 'reservations.endTime',
    },
    checkEligibility: vi.fn(),
    findReservationConflicts: vi.fn(),
    emitBookingEvent: vi.fn(),
    broadcastMachineAvailabilityChange: vi.fn(),
    notifyAdminsBookingRequested: vi.fn(),
    notifyUserBookingDecision: vi.fn(),
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ kind: 'eq', args })),
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  machines: mocks.machines,
  users: mocks.users,
  reservations: mocks.reservations,
}))

vi.mock('./eligibility', () => ({
  checkEligibility: mocks.checkEligibility,
}))

vi.mock('./booking-conflicts', () => ({
  findReservationConflicts: mocks.findReservationConflicts,
}))

vi.mock('./events', () => ({
  emitBookingEvent: mocks.emitBookingEvent,
  broadcastMachineAvailabilityChange: mocks.broadcastMachineAvailabilityChange,
}))

vi.mock('./notifications', () => ({
  notifyAdminsBookingRequested: mocks.notifyAdminsBookingRequested,
  notifyUserBookingDecision: mocks.notifyUserBookingDecision,
}))

import {
  cancelBookingRequestByMember,
  createBookingRequest,
  moderateBookingRequest,
} from './booking-workflow'
import { findReservationConflicts } from './booking-conflicts'
import {
  broadcastMachineAvailabilityChange,
  emitBookingEvent,
} from './events'
import {
  notifyAdminsBookingRequested,
  notifyUserBookingDecision,
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

describe('booking-workflow service', () => {
  beforeEach(() => {
    mocks.checkEligibility.mockResolvedValue({
      eligible: true,
      reasons: [],
      requirements: [],
      hasCheckout: true,
    })
    mocks.findReservationConflicts.mockResolvedValue([])
  })

  it('returns a validation error for invalid date ranges', async () => {
    const result = await createBookingRequest({
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: new Date('invalid'),
      endTime: new Date(),
    })

    expect(result).toEqual({
      success: false,
      error: 'Invalid start or end time',
    })
    expect(mocks.db.query.machines.findFirst).not.toHaveBeenCalled()
  })

  it('returns eligibility reasons when user is not allowed to book', async () => {
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
    })
    mocks.checkEligibility.mockResolvedValue({
      eligible: false,
      reasons: ['Manager checkout not approved'],
      requirements: [],
      hasCheckout: false,
    })

    const result = await createBookingRequest({
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
    })

    expect(result).toEqual({
      success: false,
      error: 'Not eligible to reserve this machine or tool',
      reasons: ['Manager checkout not approved'],
    })
    expect(findReservationConflicts).not.toHaveBeenCalled()
  })

  it('creates a pending request and emits notifications for valid input', async () => {
    const reservation = {
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      status: 'pending',
    }

    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
    })
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'user-1',
      name: 'Test Member',
      email: 'member@example.com',
    })
    mockInsertReturning(reservation)

    const result = await createBookingRequest({
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: reservation.startTime,
      endTime: reservation.endTime,
    })

    expect(result).toEqual({ success: true, reservation })
    expect(emitBookingEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'requested',
        status: 'pending',
        bookingId: 'reservation-1',
      })
    )
    expect(notifyAdminsBookingRequested).toHaveBeenCalledTimes(1)
    expect(broadcastMachineAvailabilityChange).toHaveBeenCalledWith('machine-1')
  })

  it('blocks moderation approval if there is a conflicting booking', async () => {
    mocks.db.query.reservations.findFirst.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })
    mocks.findReservationConflicts.mockResolvedValue([{ id: 'reservation-2' }])

    const result = await moderateBookingRequest({
      reservationId: 'reservation-1',
      reviewerId: 'admin-1',
      decision: 'approve',
    })

    expect(result).toEqual({
      success: false,
      error: 'Cannot approve request because the time is already booked',
    })
  })

  it('persists moderation decisions and notifies the member', async () => {
    const updatedReservation = {
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'rejected',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
    }

    mocks.db.query.reservations.findFirst.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })
    mockUpdateReturning(updatedReservation)

    const result = await moderateBookingRequest({
      reservationId: 'reservation-1',
      reviewerId: 'admin-1',
      decision: 'reject',
      reason: 'Conflicting maintenance window',
      notes: 'Please choose a different slot.',
    })

    expect(result).toEqual({
      success: true,
      reservation: updatedReservation,
    })
    expect(notifyUserBookingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        reservationId: 'reservation-1',
        status: 'rejected',
      })
    )
    expect(broadcastMachineAvailabilityChange).toHaveBeenCalledWith('machine-1')
  })

  it('prevents cancelling reservations that already started', async () => {
    mocks.db.query.reservations.findFirst.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime: new Date('2020-01-01T10:00:00.000Z'),
      endTime: new Date('2020-01-01T11:00:00.000Z'),
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })

    const result = await cancelBookingRequestByMember({
      reservationId: 'reservation-1',
      userId: 'user-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'Cannot cancel past reservations',
    })
  })

  it('cancels a future reservation and broadcasts availability changes', async () => {
    const now = Date.now()
    const reservation = {
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime: new Date(now + 60 * 60 * 1000),
      endTime: new Date(now + 2 * 60 * 60 * 1000),
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    }
    const updatedReservation = {
      ...reservation,
      status: 'cancelled',
    }

    mocks.db.query.reservations.findFirst.mockResolvedValue(reservation)
    mockUpdateReturning(updatedReservation)

    const result = await cancelBookingRequestByMember({
      reservationId: 'reservation-1',
      userId: 'user-1',
      reason: 'Change of plans',
    })

    expect(result).toEqual({
      success: true,
      reservation: updatedReservation,
    })
    expect(emitBookingEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'cancelled',
        status: 'cancelled',
      })
    )
    expect(broadcastMachineAvailabilityChange).toHaveBeenCalledWith('machine-1')
  })

  it('returns a validation error when end time is before start time', async () => {
    const result = await createBookingRequest({
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: new Date('2026-02-15T11:00:00.000Z'),
      endTime: new Date('2026-02-15T10:00:00.000Z'),
    })

    expect(result).toEqual({
      success: false,
      error: 'End time must be after start time',
    })
  })

  it('rejects booking when there is a time conflict', async () => {
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      name: 'Laser Cutter',
      active: true,
    })
    mocks.findReservationConflicts.mockResolvedValue([{ id: 'existing-booking' }])

    const result = await createBookingRequest({
      userId: 'user-1',
      machineId: 'machine-1',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
    })

    expect(result).toEqual({
      success: false,
      error: 'Selected time overlaps an existing booking',
    })
  })

  it('returns not found when moderating a nonexistent reservation', async () => {
    mocks.db.query.reservations.findFirst.mockResolvedValue(null)

    const result = await moderateBookingRequest({
      reservationId: 'nonexistent',
      reviewerId: 'admin-1',
      decision: 'approve',
    })

    expect(result).toEqual({
      success: false,
      error: 'Reservation not found',
    })
  })

  it('approves a pending reservation when there are no conflicts', async () => {
    const updatedReservation = {
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'approved',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
    }

    mocks.db.query.reservations.findFirst.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      machineId: 'machine-1',
      status: 'pending',
      startTime: new Date('2026-02-15T10:00:00.000Z'),
      endTime: new Date('2026-02-15T11:00:00.000Z'),
      machine: { id: 'machine-1', name: 'Laser Cutter' },
    })
    mockUpdateReturning(updatedReservation)

    const result = await moderateBookingRequest({
      reservationId: 'reservation-1',
      reviewerId: 'admin-1',
      decision: 'approve',
    })

    expect(result).toEqual({
      success: true,
      reservation: updatedReservation,
    })
    expect(emitBookingEvent).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        type: 'approved',
        status: 'approved',
      })
    )
    expect(notifyUserBookingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        status: 'approved',
      })
    )
  })

})
