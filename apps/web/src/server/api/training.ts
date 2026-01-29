import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../auth'
import { db, trainingModules } from '~/lib/db'
import {
  progressUpdateSchema,
  updateTrainingProgress,
  getModuleProgress,
  getAllModulesWithProgress,
} from '../services/training'

export const getModules = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()

  const modules = await getAllModulesWithProgress(user.id)

  return { modules }
})

export const getModule = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({ moduleId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const module = await db.query.trainingModules.findFirst({
      where: eq(trainingModules.id, data.moduleId),
    })

    if (!module) {
      throw new Response(JSON.stringify({ error: 'Module not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const progress = await getModuleProgress(user.id, data.moduleId)

    return { module, progress }
  })

export const updateProgress = createServerFn({ method: 'POST' })
  .validator((data: unknown) => progressUpdateSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const result = await updateTrainingProgress(user.id, data)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return { success: true }
  })

export const getTrainingStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireAuth()

    const modules = await getAllModulesWithProgress(user.id)

    const totalModules = modules.length
    const completedModules = modules.filter((m) => m.completedAt).length
    const overallProgress =
      totalModules > 0 ? Math.floor((completedModules / totalModules) * 100) : 0

    return {
      totalModules,
      completedModules,
      overallProgress,
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        percentComplete: m.percentComplete,
        completed: !!m.completedAt,
      })),
    }
  }
)
