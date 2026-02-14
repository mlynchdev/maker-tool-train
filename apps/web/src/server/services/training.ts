import { eq, and } from 'drizzle-orm'
import { db, trainingProgress, trainingModules } from '~/lib/db'
import { z } from 'zod'
import {
  addWatchedRange,
  coerceWatchedRanges,
  getWatchedRangeSeconds,
  normalizeWatchedRanges,
  type WatchedRange,
} from '~/lib/watch-ranges'

const ENDED_POSITION_TOLERANCE_SECONDS = 3
const END_COMPLETION_SNAP_SECONDS = 5

const watchedRangeSchema = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
})

export const progressUpdateSchema = z.object({
  moduleId: z.string().uuid(),
  watchedSeconds: z.number().int().min(0).optional(),
  watchedRanges: z.array(watchedRangeSchema).optional(),
  currentPosition: z.number().int().min(0),
  sessionDuration: z.number().int().min(0),
  videoDuration: z.number().int().min(0).optional(),
  ended: z.boolean().optional(),
})

export type ProgressUpdate = z.infer<typeof progressUpdateSchema>

interface ProgressValidationResult {
  valid: boolean
  reason?: string
}

function getStoredRanges(
  storedRanges: unknown,
  existingWatchedSeconds: number,
  moduleDurationSeconds: number
): WatchedRange[] {
  const normalizedStored = normalizeWatchedRanges(
    coerceWatchedRanges(storedRanges),
    moduleDurationSeconds
  )

  if (normalizedStored.length > 0) {
    return normalizedStored
  }

  if (existingWatchedSeconds <= 0) {
    return []
  }

  // Backward compatibility for old records before watched_ranges existed.
  return normalizeWatchedRanges(
    [{ start: 0, end: existingWatchedSeconds }],
    moduleDurationSeconds
  )
}

export function mergeProgressRanges(
  existingRanges: WatchedRange[],
  update: ProgressUpdate,
  moduleDurationSeconds: number
): WatchedRange[] {
  const claimedRanges = normalizeWatchedRanges(
    update.watchedRanges && update.watchedRanges.length > 0
      ? update.watchedRanges
      : update.watchedSeconds && update.watchedSeconds > 0
        ? [{ start: 0, end: update.watchedSeconds }]
        : [],
    moduleDurationSeconds
  )

  let mergedRanges = normalizeWatchedRanges(
    [...existingRanges, ...claimedRanges],
    moduleDurationSeconds
  )

  if (
    update.ended &&
    moduleDurationSeconds > 0 &&
    update.currentPosition >= moduleDurationSeconds - ENDED_POSITION_TOLERANCE_SECONDS
  ) {
    mergedRanges = addWatchedRange(
      mergedRanges,
      { start: Math.max(0, moduleDurationSeconds - 1), end: moduleDurationSeconds },
      moduleDurationSeconds
    )
  }

  return mergedRanges
}

export function shouldSnapEndedProgressToFullDuration(
  mergedRanges: WatchedRange[],
  update: ProgressUpdate,
  moduleDurationSeconds: number
): boolean {
  if (!update.ended || moduleDurationSeconds <= 0) {
    return false
  }

  if (update.currentPosition < moduleDurationSeconds - ENDED_POSITION_TOLERANCE_SECONDS) {
    return false
  }

  const remainingSeconds = moduleDurationSeconds - getWatchedRangeSeconds(mergedRanges)
  return remainingSeconds > 0 && remainingSeconds <= END_COMPLETION_SNAP_SECONDS
}

export function validateProgressUpdate(
  existingWatchedSeconds: number,
  nextWatchedSeconds: number,
  update: ProgressUpdate,
  moduleDurationSeconds: number
): ProgressValidationResult {
  // Reject if session duration is unreasonably large.
  if (update.sessionDuration > 300) {
    return {
      valid: false,
      reason: 'Session duration too large',
    }
  }

  // Reject if watched seconds exceed video duration
  if (nextWatchedSeconds > moduleDurationSeconds) {
    return {
      valid: false,
      reason: 'Watched seconds exceed video duration',
    }
  }

  // Calculate the delta being claimed
  const claimedDelta = nextWatchedSeconds - existingWatchedSeconds

  // If they're not claiming new progress, allow it (position updates)
  if (claimedDelta <= 0) {
    return { valid: true }
  }

  // Reject if claimed progress is more than 2.5x the session duration
  // (allows for some buffer with playback speed variations)
  const maxAllowedDelta = Math.max(1, update.sessionDuration) * 2.5

  if (claimedDelta > maxAllowedDelta) {
    return {
      valid: false,
      reason: `Progress delta (${claimedDelta}s) exceeds allowed based on session duration (${update.sessionDuration}s)`,
    }
  }

  return { valid: true }
}

export async function updateTrainingProgress(
  userId: string,
  update: ProgressUpdate
): Promise<{ success: boolean; error?: string; watchedSeconds?: number; percentComplete?: number }> {
  // Get module info
  const module = await db.query.trainingModules.findFirst({
    where: eq(trainingModules.id, update.moduleId),
  })

  if (!module) {
    return { success: false, error: 'Module not found' }
  }

  if (!module.active) {
    return { success: false, error: 'Module is not active' }
  }

  // Auto-correct module duration from the actual YouTube video duration
  let effectiveDuration = module.durationSeconds
  if (update.videoDuration && update.videoDuration > 0 && update.videoDuration !== module.durationSeconds) {
    effectiveDuration = update.videoDuration
    await db
      .update(trainingModules)
      .set({ durationSeconds: update.videoDuration })
      .where(eq(trainingModules.id, update.moduleId))
  }

  // Get existing progress
  const existing = await db.query.trainingProgress.findFirst({
    where: and(
      eq(trainingProgress.userId, userId),
      eq(trainingProgress.moduleId, update.moduleId)
    ),
  })

  const existingWatchedSeconds = existing?.watchedSeconds || 0
  const existingRanges = getStoredRanges(
    existing?.watchedRanges,
    existingWatchedSeconds,
    effectiveDuration
  )
  const mergedRanges = mergeProgressRanges(
    existingRanges,
    update,
    effectiveDuration
  )
  const finalizedRanges = shouldSnapEndedProgressToFullDuration(
    mergedRanges,
    update,
    effectiveDuration
  )
    ? [{ start: 0, end: effectiveDuration }]
    : mergedRanges
  const existingWatchedRangeSeconds = getWatchedRangeSeconds(existingRanges)
  const mergedWatchedRangeSeconds = getWatchedRangeSeconds(finalizedRanges)

  // Validate the update
  const validation = validateProgressUpdate(
    existingWatchedRangeSeconds,
    mergedWatchedRangeSeconds,
    update,
    effectiveDuration
  )

  if (!validation.valid) {
    return { success: false, error: validation.reason }
  }

  // Cap watched seconds at the effective duration (fixes inflated values from old bugs)
  const savedWatchedSeconds = Math.min(
    Math.floor(mergedWatchedRangeSeconds),
    effectiveDuration
  )
  const savedLastPosition = Math.min(
    update.ended ? effectiveDuration : update.currentPosition,
    effectiveDuration
  )

  // Calculate if completed (90% threshold)
  const watchPercent = effectiveDuration > 0
    ? (savedWatchedSeconds / effectiveDuration) * 100
    : 0
  const isCompleted = watchPercent >= 90
  const completedAt = isCompleted && !existing?.completedAt ? new Date() : existing?.completedAt

  if (existing) {
    // Update existing record with the merged unique watch ranges.
    await db
      .update(trainingProgress)
      .set({
        watchedSeconds: savedWatchedSeconds,
        watchedRanges: finalizedRanges,
        lastPosition: savedLastPosition,
        completedAt,
        updatedAt: new Date(),
      })
      .where(eq(trainingProgress.id, existing.id))
  } else {
    // Create new record
    await db.insert(trainingProgress).values({
      userId,
      moduleId: update.moduleId,
      watchedSeconds: savedWatchedSeconds,
      watchedRanges: finalizedRanges,
      lastPosition: savedLastPosition,
      completedAt,
    })
  }

  const percentComplete = effectiveDuration > 0
    ? Math.min(Math.floor((savedWatchedSeconds / effectiveDuration) * 100), 100)
    : 0

  return { success: true, watchedSeconds: savedWatchedSeconds, percentComplete }
}

export async function getModuleProgress(userId: string, moduleId: string) {
  const progress = await db.query.trainingProgress.findFirst({
    where: and(
      eq(trainingProgress.userId, userId),
      eq(trainingProgress.moduleId, moduleId)
    ),
  })

  const module = await db.query.trainingModules.findFirst({
    where: eq(trainingModules.id, moduleId),
  })

  if (!module) {
    return null
  }

  return {
    moduleId,
    moduleTitle: module.title,
    durationSeconds: module.durationSeconds,
    watchedSeconds: progress?.watchedSeconds || 0,
    watchedRanges: getStoredRanges(
      progress?.watchedRanges,
      progress?.watchedSeconds || 0,
      module.durationSeconds
    ),
    lastPosition: progress?.lastPosition || 0,
    completedAt: progress?.completedAt,
    percentComplete: module.durationSeconds > 0
      ? Math.floor(((progress?.watchedSeconds || 0) / module.durationSeconds) * 100)
      : 0,
  }
}

export async function getAllModulesWithProgress(userId: string) {
  const modules = await db.query.trainingModules.findMany({
    where: eq(trainingModules.active, true),
  })

  const userProgress = await db.query.trainingProgress.findMany({
    where: eq(trainingProgress.userId, userId),
  })

  const progressMap = new Map(
    userProgress.map((p) => [p.moduleId, p])
  )

  return modules.map((module) => {
    const progress = progressMap.get(module.id)
    const watchedRanges = getStoredRanges(
      progress?.watchedRanges,
      progress?.watchedSeconds || 0,
      module.durationSeconds
    )
    return {
      ...module,
      watchedSeconds: progress?.watchedSeconds || 0,
      watchedRanges,
      lastPosition: progress?.lastPosition || 0,
      completedAt: progress?.completedAt,
      percentComplete: module.durationSeconds > 0
        ? Math.floor(((progress?.watchedSeconds || 0) / module.durationSeconds) * 100)
        : 0,
    }
  })
}
