import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    query: {
      users: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    update: vi.fn(),
    delete: vi.fn(),
  }

  return {
    db,
    users: {
      id: 'users.id',
      email: 'users.email',
      role: 'users.role',
    },
    reservations: {
      reviewedBy: 'reservations.reviewedBy',
      reviewedAt: 'reservations.reviewedAt',
      updatedAt: 'reservations.updatedAt',
    },
    managerCheckouts: {
      approvedBy: 'managerCheckouts.approvedBy',
    },
  }
})

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ kind: 'eq', args })),
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  users: mocks.users,
  reservations: mocks.reservations,
  managerCheckouts: mocks.managerCheckouts,
}))

import { deleteUserAccount } from './user-management'

function mockDeleteReturning(rows: Array<Record<string, unknown>>) {
  const returning = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ returning })
  mocks.db.delete.mockReturnValue({ where })
  return { where, returning }
}

describe('user-management service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks deleting the current admin account', async () => {
    const result = await deleteUserAccount({
      actorId: 'admin-1',
      userId: 'admin-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'You cannot delete your own account',
    })
    expect(mocks.db.query.users.findFirst).not.toHaveBeenCalled()
  })

  it('blocks deleting the last admin account', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
    })
    mocks.db.query.users.findMany.mockResolvedValue([{ id: 'admin-1' }])

    const result = await deleteUserAccount({
      actorId: 'admin-2',
      userId: 'admin-1',
    })

    expect(result).toEqual({
      success: false,
      error: 'Cannot delete the last admin account',
    })
    expect(mocks.db.delete).not.toHaveBeenCalled()
  })

  it('returns user not found when target account does not exist', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue(null)

    const result = await deleteUserAccount({
      actorId: 'admin-1',
      userId: 'missing-user',
    })

    expect(result).toEqual({
      success: false,
      error: 'User not found',
    })
    expect(mocks.db.delete).not.toHaveBeenCalled()
  })

  it('deletes a user and reassigns constrained references before delete', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.com',
      role: 'member',
    })

    const reservationsWhere = vi.fn().mockResolvedValue([])
    const reservationsSet = vi.fn().mockReturnValue({ where: reservationsWhere })
    const checkoutsWhere = vi.fn().mockResolvedValue([])
    const checkoutsSet = vi.fn().mockReturnValue({ where: checkoutsWhere })

    mocks.db.update
      .mockReturnValueOnce({ set: reservationsSet })
      .mockReturnValueOnce({ set: checkoutsSet })

    mockDeleteReturning([
      {
        id: 'member-1',
        email: 'member@example.com',
        role: 'member',
      },
    ])

    const result = await deleteUserAccount({
      actorId: 'admin-1',
      userId: 'member-1',
    })

    expect(reservationsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: expect.any(Date),
      })
    )
    expect(checkoutsSet).toHaveBeenCalledWith({ approvedBy: 'admin-1' })
    expect(mocks.db.delete).toHaveBeenCalledWith(mocks.users)
    expect(result).toEqual({
      success: true,
      user: {
        id: 'member-1',
        email: 'member@example.com',
        role: 'member',
      },
    })
  })
})
