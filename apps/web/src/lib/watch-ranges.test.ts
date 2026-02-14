import { describe, expect, it } from 'vitest'
import {
  addWatchedRange,
  getWatchedRangeSeconds,
  normalizeWatchedRanges,
} from './watch-ranges'

describe('watch range helpers', () => {
  it('merges overlaps and adjacency into unique ranges', () => {
    const merged = normalizeWatchedRanges(
      [
        { start: 0, end: 10 },
        { start: 9.5, end: 20 },
        { start: 20, end: 22 },
      ],
      120
    )

    expect(merged).toEqual([{ start: 0, end: 22 }])
    expect(getWatchedRangeSeconds(merged)).toBe(22)
  })

  it('drops invalid and out-of-bounds ranges', () => {
    const merged = normalizeWatchedRanges(
      [
        { start: -10, end: 5 },
        { start: 50, end: 49.99 },
        { start: 119, end: 150 },
      ],
      120
    )

    expect(merged).toEqual([
      { start: 0, end: 5 },
      { start: 119, end: 120 },
    ])
  })

  it('does not increase unique watched time when adding a rewatch segment', () => {
    const afterFirstPass = normalizeWatchedRanges([{ start: 0, end: 30 }], 120)
    const afterRewatch = addWatchedRange(afterFirstPass, { start: 5, end: 20 }, 120)

    expect(getWatchedRangeSeconds(afterFirstPass)).toBe(30)
    expect(getWatchedRangeSeconds(afterRewatch)).toBe(30)
    expect(afterRewatch).toEqual([{ start: 0, end: 30 }])
  })
})
