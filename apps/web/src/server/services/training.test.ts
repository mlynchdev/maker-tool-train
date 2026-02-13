import { describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/db', () => ({
  db: {},
  trainingProgress: {},
  trainingModules: {},
}))

import { validateProgressUpdate, type ProgressUpdate } from './training'

function makeUpdate(overrides: Partial<ProgressUpdate> = {}): ProgressUpdate {
  return {
    moduleId: 'module-1',
    watchedSeconds: 60,
    currentPosition: 60,
    sessionDuration: 30,
    ...overrides,
  }
}

describe('validateProgressUpdate', () => {
  it('rejects when watched seconds exceed video duration', () => {
    const result = validateProgressUpdate(0, makeUpdate({ watchedSeconds: 200 }), 100)

    expect(result).toEqual({
      valid: false,
      reason: 'Watched seconds exceed video duration',
    })
  })

  it('allows updates that do not claim new progress', () => {
    const result = validateProgressUpdate(
      80,
      makeUpdate({ watchedSeconds: 60, sessionDuration: 10 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('allows progress delta within 2.5x session duration', () => {
    const result = validateProgressUpdate(
      0,
      makeUpdate({ watchedSeconds: 50, sessionDuration: 30 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('rejects progress delta exceeding 2.5x session duration', () => {
    const result = validateProgressUpdate(
      0,
      makeUpdate({ watchedSeconds: 80, sessionDuration: 30 }),
      100
    )

    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/Progress delta/)
  })

  it('rejects session duration exceeding 300 seconds', () => {
    const result = validateProgressUpdate(
      0,
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
      makeUpdate({ watchedSeconds: 50, sessionDuration: 300 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })

  it('allows progress delta at exactly the 2.5x limit', () => {
    const result = validateProgressUpdate(
      0,
      makeUpdate({ watchedSeconds: 75, sessionDuration: 30 }),
      100
    )

    expect(result).toEqual({ valid: true })
  })
})
