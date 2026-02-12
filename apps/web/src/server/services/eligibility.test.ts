import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    query: {
      users: { findFirst: vi.fn() },
      machines: { findFirst: vi.fn() },
      machineRequirements: { findMany: vi.fn() },
      trainingProgress: { findFirst: vi.fn() },
      managerCheckouts: { findFirst: vi.fn() },
    },
  }

  return {
    db,
    users: { id: 'users.id' },
    machines: { id: 'machines.id' },
    machineRequirements: { machineId: 'machine_requirements.machine_id' },
    trainingProgress: {
      userId: 'training_progress.user_id',
      moduleId: 'training_progress.module_id',
    },
    managerCheckouts: {
      userId: 'manager_checkouts.user_id',
      machineId: 'manager_checkouts.machine_id',
    },
    trainingModules: {},
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ kind: 'eq', args })),
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  users: mocks.users,
  machines: mocks.machines,
  machineRequirements: mocks.machineRequirements,
  trainingProgress: mocks.trainingProgress,
  managerCheckouts: mocks.managerCheckouts,
  trainingModules: mocks.trainingModules,
}))

import { checkEligibility } from './eligibility'

describe('eligibility service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.db.query.machineRequirements.findMany.mockResolvedValue([])
    mocks.db.query.trainingProgress.findFirst.mockResolvedValue(null)
  })

  it('treats admin users as checked out on all machines', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'admin-1',
      role: 'admin',
      status: 'active',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      active: true,
    })

    const result = await checkEligibility('admin-1', 'machine-1')

    expect(result).toEqual({
      eligible: true,
      reasons: [],
      requirements: [],
      hasCheckout: true,
    })
    expect(mocks.db.query.managerCheckouts.findFirst).not.toHaveBeenCalled()
  })

  it('requires explicit checkout approval for members', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      role: 'member',
      status: 'active',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      active: true,
    })
    mocks.db.query.managerCheckouts.findFirst.mockResolvedValue(null)

    const result = await checkEligibility('member-1', 'machine-1')

    expect(result.hasCheckout).toBe(false)
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('Manager checkout not approved')
  })

  it('reports incomplete training progress per requirement', async () => {
    mocks.db.query.users.findFirst.mockResolvedValue({
      id: 'member-1',
      role: 'member',
      status: 'active',
    })
    mocks.db.query.machines.findFirst.mockResolvedValue({
      id: 'machine-1',
      active: true,
    })
    mocks.db.query.machineRequirements.findMany.mockResolvedValue([
      {
        moduleId: 'module-1',
        requiredWatchPercent: 90,
        module: {
          id: 'module-1',
          title: 'Safety Fundamentals',
          durationSeconds: 100,
        },
      },
    ])
    mocks.db.query.trainingProgress.findFirst.mockResolvedValue({
      watchedSeconds: 50,
    })
    mocks.db.query.managerCheckouts.findFirst.mockResolvedValue({
      id: 'checkout-1',
    })

    const result = await checkEligibility('member-1', 'machine-1')

    expect(result.hasCheckout).toBe(true)
    expect(result.eligible).toBe(false)
    expect(result.requirements).toEqual([
      {
        moduleId: 'module-1',
        moduleTitle: 'Safety Fundamentals',
        requiredPercent: 90,
        watchedPercent: 50,
        completed: false,
      },
    ])
    expect(result.reasons).toContain(
      'Training "Safety Fundamentals" not completed (50% of 90% required)'
    )
  })
})
