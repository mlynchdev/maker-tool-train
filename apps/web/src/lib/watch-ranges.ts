export interface WatchedRange {
  start: number
  end: number
}

const RANGE_EPSILON_SECONDS = 0.001

function clampRangeToDuration(range: WatchedRange, durationSeconds: number): WatchedRange | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) {
    return null
  }

  const start = Math.max(0, Math.min(range.start, durationSeconds))
  const end = Math.max(0, Math.min(range.end, durationSeconds))

  if (end - start <= RANGE_EPSILON_SECONDS) {
    return null
  }

  return { start, end }
}

export function normalizeWatchedRanges(
  ranges: WatchedRange[] | null | undefined,
  durationSeconds: number
): WatchedRange[] {
  if (!ranges || ranges.length === 0 || durationSeconds <= 0) {
    return []
  }

  const clamped = ranges
    .map((range) => clampRangeToDuration(range, durationSeconds))
    .filter((range): range is WatchedRange => Boolean(range))
    .sort((a, b) => a.start - b.start)

  if (clamped.length === 0) {
    return []
  }

  const merged: WatchedRange[] = [clamped[0]]

  for (let i = 1; i < clamped.length; i++) {
    const current = clamped[i]
    const last = merged[merged.length - 1]

    if (current.start <= last.end + RANGE_EPSILON_SECONDS) {
      last.end = Math.max(last.end, current.end)
      continue
    }

    merged.push({ ...current })
  }

  return merged
}

export function addWatchedRange(
  existingRanges: WatchedRange[],
  nextRange: WatchedRange,
  durationSeconds: number
): WatchedRange[] {
  return normalizeWatchedRanges([...existingRanges, nextRange], durationSeconds)
}

export function getWatchedRangeSeconds(ranges: WatchedRange[]): number {
  return ranges.reduce((total, range) => total + (range.end - range.start), 0)
}

export function coerceWatchedRanges(value: unknown): WatchedRange[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'start' in entry &&
      'end' in entry &&
      typeof entry.start === 'number' &&
      typeof entry.end === 'number'
    ) {
      return [{ start: entry.start, end: entry.end }]
    }

    return []
  })
}
