import { eq, and } from 'drizzle-orm'
import { db, trainingProgress, trainingModules } from '~/lib/db'
import { z } from 'zod'

export const progressUpdateSchema = z.object({
  moduleId: z.string().uuid(),
  watchedSeconds: z.number().int().min(0),
  currentPosition: z.number().int().min(0),
  sessionDuration: z.number().int().min(0),
  videoDuration: z.number().int().min(0).optional(),
})

export type ProgressUpdate = z.infer<typeof progressUpdateSchema>

interface ProgressValidationResult {
  valid: boolean
  reason?: string
}

export function validateProgressUpdate(
  existingWatchedSeconds: number,
  update: ProgressUpdate,
  moduleDurationSeconds: number
): ProgressValidationResult {
  // Reject if watched seconds exceed video duration
  if (update.watchedSeconds > moduleDurationSeconds) {
    return {
      valid: false,
      reason: 'Watched seconds exceed video duration',
    }
  }

  // Calculate the delta being claimed
  const claimedDelta = update.watchedSeconds - existingWatchedSeconds

  // If they're not claiming new progress, allow it (position updates)
  if (claimedDelta <= 0) {
    return { valid: true }
  }

  // Reject if claimed progress is more than 2.5x the session duration
  // (allows for some buffer with playback speed variations)
  const maxAllowedDelta = update.sessionDuration * 2.5

  if (claimedDelta > maxAllowedDelta) {
    return {
      valid: false,
      reason: `Progress delta (${claimedDelta}s) exceeds allowed based on session duration (${update.sessionDuration}s)`,
    }
  }

  // Reject if session duration is unreasonably large
  if (update.sessionDuration > 300) {
    // Max 5 minutes per update
    return {
      valid: false,
      reason: 'Session duration too large',
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

  // Validate the update
  const validation = validateProgressUpdate(
    existingWatchedSeconds,
    update,
    effectiveDuration
  )

  if (!validation.valid) {
    return { success: false, error: validation.reason }
  }

  // Cap watched seconds at the effective duration (fixes inflated values from old bugs)
  const savedWatchedSeconds = Math.min(
    Math.max(existingWatchedSeconds, update.watchedSeconds),
    effectiveDuration
  )

  // Calculate if completed (90% threshold)
  const watchPercent = (savedWatchedSeconds / effectiveDuration) * 100
  const isCompleted = watchPercent >= 90
  const completedAt = isCompleted && !existing?.completedAt ? new Date() : existing?.completedAt

  if (existing) {
    // Update existing record - only update watched seconds if it's greater
    await db
      .update(trainingProgress)
      .set({
        watchedSeconds: savedWatchedSeconds,
        lastPosition: update.currentPosition,
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
      lastPosition: update.currentPosition,
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
    return {
      ...module,
      watchedSeconds: progress?.watchedSeconds || 0,
      lastPosition: progress?.lastPosition || 0,
      completedAt: progress?.completedAt,
      percentComplete: module.durationSeconds > 0
        ? Math.floor(((progress?.watchedSeconds || 0) / module.durationSeconds) * 100)
        : 0,
    }
  })
}
