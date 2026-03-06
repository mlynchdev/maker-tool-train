import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const insertValues = vi.fn().mockResolvedValue(undefined)

  return {
    db: {
      query: {
        trainingModules: { findFirst: vi.fn(), findMany: vi.fn() },
        trainingProgress: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    },
    trainingProgress: {
      id: 'training_progress.id',
      userId: 'training_progress.user_id',
      moduleId: 'training_progress.module_id',
    },
    trainingModules: {
      id: 'training_modules.id',
      active: 'training_modules.active',
    },
    updateSet,
    updateWhere,
    insertValues,
  }
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  eq: vi.fn((...args: unknown[]) => ({ kind: 'eq', args })),
}))

vi.mock('~/lib/db', () => ({
  db: mocks.db,
  trainingProgress: mocks.trainingProgress,
  trainingModules: mocks.trainingModules,
}))

import { getWatchedRangeSeconds } from '~/lib/watch-ranges'
import {
  getAllModulesWithProgress,
  getModuleProgress,
  mergeProgressRanges,
  shouldSnapEndedProgressToFullDuration,
  updateTrainingProgress,
  validateProgressUpdate,
  type ProgressUpdate,
} from './training'

function makeUpdate(overrides: Partial<ProgressUpdate> = {}): ProgressUpdate {
  return {
    moduleId: '00000000-0000-0000-0000-000000000001',
    watchedSeconds: 60,
    watchedRanges: [{ start: 0, end: 60 }],
    currentPosition: 60,
    sessionDuration: 30,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.db.query.trainingModules.findFirst.mockResolvedValue(null)
  mocks.db.query.trainingModules.findMany.mockResolvedValue([])
  mocks.db.query.trainingProgress.findFirst.mockResolvedValue(null)
  mocks.db.query.trainingProgress.findMany.mockResolvedValue([])
})

describe('validateProgressUpdate', () => {
  it('rejects when watched seconds exceed video duration', () => {
    const result = validateProgressUpdate(0, 200, makeUpdate({ watchedSeconds: 200 }), 100)

    expect(result).toEqual({
      valid: false,
      reason: 'Watched seconds exceed video duration',
    })
  })

  it('allows updates that do not claim new progress', () => {
    const result = validateProgressUpdate(
      80,
      80,
      makeUpdate({ watchedSeconds: 60, sessionDuration: 10 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('allows progress delta within 2.5x session duration', () => {
    const result = validateProgressUpdate(
      0,
      50,
      makeUpdate({ watchedSeconds: 50, sessionDuration: 30 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('rejects progress delta exceeding 2.5x session duration', () => {
    const result = validateProgressUpdate(
      0,
      80,
      makeUpdate({ watchedSeconds: 80, sessionDuration: 30 }),
      100
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Progress delta/)
  })

  it('rejects session duration exceeding 300 seconds', () => {
    const result = validateProgressUpdate(
      0,
      10,
      makeUpdate({ watchedSeconds: 10, sessionDuration: 301 }),
      100
    )

    expect(result).toEqual({
      valid: false,
      reason: 'Session duration too large',
    })
  })

  it('allows session duration of exactly 300 seconds', () => {
    const result = validateProgressUpdate(
      0,
      50,
      makeUpdate({ watchedSeconds: 50, sessionDuration: 300 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('allows progress delta at exactly the 2.5x limit', () => {
    const result = validateProgressUpdate(
      0,
      75,
      makeUpdate({ watchedSeconds: 75, sessionDuration: 30 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('allows a final 1-second claim even if the report window is sub-second', () => {
    const result = validateProgressUpdate(
      89,
      90,
      makeUpdate({ watchedSeconds: 90, sessionDuration: 0 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })
})

describe('mergeProgressRanges', () => {
  it('does not increase unique watched time on rewind and rewatch', () => {
    const merged = mergeProgressRanges(
      [{ start: 0, end: 40 }],
      makeUpdate({
        watchedRanges: [{ start: 10, end: 20 }],
        watchedSeconds: 20,
        currentPosition: 20,
      }),
      100
    )

    expect(merged).toEqual([{ start: 0, end: 40 }])
    expect(getWatchedRangeSeconds(merged)).toBe(40)
  })

  it('credits only previously unseen segments', () => {
    const merged = mergeProgressRanges(
      [{ start: 0, end: 40 }],
      makeUpdate({
        watchedRanges: [{ start: 35, end: 55 }],
        watchedSeconds: 55,
        currentPosition: 55,
      }),
      100
    )

    expect(merged).toEqual([{ start: 0, end: 55 }])
    expect(getWatchedRangeSeconds(merged)).toBe(55)
  })

  it('adds a final tail segment when the video ends near duration', () => {
    const merged = mergeProgressRanges(
      [{ start: 0, end: 89 }],
      makeUpdate({
        watchedRanges: [{ start: 0, end: 89 }],
        watchedSeconds: 89,
        currentPosition: 99,
        ended: true,
      }),
      100
    )

    expect(getWatchedRangeSeconds(merged)).toBe(90)
  })

  it('does not add end credit when ended flag is far from the video end', () => {
    const merged = mergeProgressRanges(
      [{ start: 0, end: 50 }],
      makeUpdate({
        watchedRanges: [{ start: 0, end: 50 }],
        watchedSeconds: 50,
        currentPosition: 70,
        ended: true,
      }),
      100
    )

    expect(getWatchedRangeSeconds(merged)).toBe(50)
  })
})

describe('shouldSnapEndedProgressToFullDuration', () => {
  it('snaps a near-complete ended video to full duration', () => {
    const shouldSnap = shouldSnapEndedProgressToFullDuration(
      [{ start: 0, end: 99 }],
      makeUpdate({
        watchedRanges: [{ start: 0, end: 99 }],
        watchedSeconds: 99,
        currentPosition: 100,
        ended: true,
      }),
      100
    )

    expect(shouldSnap).toBe(true)
  })

  it('does not snap if remaining gap is larger than tolerance', () => {
    const shouldSnap = shouldSnapEndedProgressToFullDuration(
      [{ start: 0, end: 94 }],
      makeUpdate({
        watchedRanges: [{ start: 0, end: 94 }],
        watchedSeconds: 94,
        currentPosition: 100,
        ended: true,
      }),
      100
    )

    expect(shouldSnap).toBe(false)
  })

  it('does not snap if ended position is not near the end', () => {
    const shouldSnap = shouldSnapEndedProgressToFullDuration(
      [{ start: 0, end: 99 }],
      makeUpdate({
        watchedRanges: [{ start: 0, end: 99 }],
        watchedSeconds: 99,
        currentPosition: 70,
        ended: true,
      }),
      100
    )

    expect(shouldSnap).toBe(false)
  })
})

describe('updateTrainingProgress', () => {
  it('validates against pre-snap progress and still persists snapped completion', async () => {
    mocks.db.query.trainingModules.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      active: true,
      durationSeconds: 100,
    })
    mocks.db.query.trainingProgress.findFirst.mockResolvedValue({
      id: 'progress-1',
      watchedSeconds: 94,
      watchedRanges: [{ start: 0, end: 94 }],
      completedAt: null,
    })

    const result = await updateTrainingProgress(
      'user-1',
      makeUpdate({
        watchedRanges: [{ start: 99, end: 100 }],
        currentPosition: 99,
        sessionDuration: 1,
        ended: true,
      })
    )

    expect(result).toEqual({
      success: true,
      watchedSeconds: 100,
      percentComplete: 100,
    })
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        watchedSeconds: 100,
        watchedRanges: [{ start: 0, end: 100 }],
        lastPosition: 100,
        completedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
    )
    expect(mocks.db.update).toHaveBeenCalledWith(mocks.trainingProgress)
    // Avoid asserting updateWhere call counts here: a videoDuration correction
    // adds a separate trainingModules update before the trainingProgress update.
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it('inserts a new progress record when no existing row is found', async () => {
    mocks.db.query.trainingModules.findFirst.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000001',
      active: true,
      durationSeconds: 100,
    })

    const result = await updateTrainingProgress(
      'user-1',
      makeUpdate({
        watchedRanges: [{ start: 0, end: 60 }],
        currentPosition: 60,
        sessionDuration: 30,
      })
    )

    expect(result).toEqual({
      success: true,
      watchedSeconds: 60,
      percentComplete: 60,
    })
    expect(mocks.insertValues).toHaveBeenCalledWith({
      userId: 'user-1',
      moduleId: '00000000-0000-0000-0000-000000000001',
      watchedSeconds: 60,
      watchedRanges: [{ start: 0, end: 60 }],
      lastPosition: 60,
      completedAt: undefined,
    })
    expect(mocks.updateSet).not.toHaveBeenCalled()
    expect(mocks.updateWhere).not.toHaveBeenCalled()
  })
})

describe('getModuleProgress', () => {
  it('derives watched seconds and percent complete from normalized ranges', async () => {
    mocks.db.query.trainingProgress.findFirst.mockResolvedValue({
      watchedSeconds: 20,
      watchedRanges: [{ start: 0, end: 60 }],
      lastPosition: 42,
      completedAt: null,
    })
    mocks.db.query.trainingModules.findFirst.mockResolvedValue({
      id: 'module-1',
      title: 'Safety Fundamentals',
      durationSeconds: 100,
    })

    const result = await getModuleProgress('user-1', 'module-1')

    expect(result).toEqual({
      moduleId: 'module-1',
      moduleTitle: 'Safety Fundamentals',
      durationSeconds: 100,
      watchedSeconds: 60,
      watchedRanges: [{ start: 0, end: 60 }],
      lastPosition: 42,
      completedAt: null,
      percentComplete: 60,
    })
  })

  it('caps normalized over-long stored ranges at 100 percent', async () => {
    mocks.db.query.trainingProgress.findFirst.mockResolvedValue({
      watchedSeconds: 20,
      watchedRanges: [{ start: 0, end: 150 }],
      lastPosition: 42,
      completedAt: null,
    })
    mocks.db.query.trainingModules.findFirst.mockResolvedValue({
      id: 'module-1',
      title: 'Safety Fundamentals',
      durationSeconds: 100,
    })

    const result = await getModuleProgress('user-1', 'module-1')

    expect(result).toEqual({
      moduleId: 'module-1',
      moduleTitle: 'Safety Fundamentals',
      durationSeconds: 100,
      watchedSeconds: 100,
      watchedRanges: [{ start: 0, end: 100 }],
      lastPosition: 42,
      completedAt: null,
      percentComplete: 100,
    })
  })
})

describe('getAllModulesWithProgress', () => {
  it('returns watched seconds and percent complete from range-derived progress', async () => {
    mocks.db.query.trainingModules.findMany.mockResolvedValue([
      {
        id: 'module-1',
        title: 'Safety Fundamentals',
        durationSeconds: 100,
        active: true,
      },
      {
        id: 'module-2',
        title: 'Laser Safety',
        durationSeconds: 80,
        active: true,
      },
    ])
    mocks.db.query.trainingProgress.findMany.mockResolvedValue([
      {
        moduleId: 'module-1',
        watchedSeconds: 10,
        watchedRanges: [{ start: 0, end: 95 }],
        lastPosition: 95,
        completedAt: null,
      },
    ])

    const result = await getAllModulesWithProgress('user-1')

    expect(result).toEqual([
      {
        id: 'module-1',
        title: 'Safety Fundamentals',
        durationSeconds: 100,
        active: true,
        watchedSeconds: 95,
        watchedRanges: [{ start: 0, end: 95 }],
        lastPosition: 95,
        completedAt: null,
        percentComplete: 95,
      },
      {
        id: 'module-2',
        title: 'Laser Safety',
        durationSeconds: 80,
        active: true,
        watchedSeconds: 0,
        watchedRanges: [],
        lastPosition: 0,
        completedAt: undefined,
        percentComplete: 0,
      },
    ])
  })

  it('caps normalized over-long stored ranges at 100 percent', async () => {
    mocks.db.query.trainingModules.findMany.mockResolvedValue([
      {
        id: 'module-1',
        title: 'Safety Fundamentals',
        durationSeconds: 100,
        active: true,
      },
    ])
    mocks.db.query.trainingProgress.findMany.mockResolvedValue([
      {
        moduleId: 'module-1',
        watchedSeconds: 10,
        watchedRanges: [{ start: 0, end: 150 }],
        lastPosition: 95,
        completedAt: null,
      },
    ])

    const result = await getAllModulesWithProgress('user-1')

    expect(result).toEqual([
      {
        id: 'module-1',
        title: 'Safety Fundamentals',
        durationSeconds: 100,
        active: true,
        watchedSeconds: 100,
        watchedRanges: [{ start: 0, end: 100 }],
        lastPosition: 95,
        completedAt: null,
        percentComplete: 100,
      },
    ])
  })
})
