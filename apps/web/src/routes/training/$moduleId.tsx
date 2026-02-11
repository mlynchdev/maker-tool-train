import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useCallback, useRef, useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { getModuleProgress, updateTrainingProgress } from '~/server/services/training'
import { Header } from '~/components/Header'
import { YouTubePlayer } from '~/components/YouTubePlayer'
import { updateProgress } from '~/server/api/training'

const getModuleData = createServerFn({ method: 'GET' })
  .inputValidator((data: { moduleId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const module = await db.query.trainingModules.findFirst({
      where: eq(trainingModules.id, data.moduleId),
    })

    if (!module) {
      throw new Response('Module not found', { status: 404 })
    }

    const progress = await getModuleProgress(user.id, data.moduleId)

    return { user, module, progress }
  })

export const Route = createFileRoute('/training/$moduleId')({
  component: TrainingModulePage,
  loader: async ({ params }) => {
    return await getModuleData({ data: { moduleId: params.moduleId } })
  },
})

function TrainingModulePage() {
  const { user, module, progress } = Route.useLoaderData()
  const [currentProgress, setCurrentProgress] = useState(progress?.percentComplete || 0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const handleProgress = useCallback(
    async (watchedSeconds: number, currentPosition: number, sessionDuration: number) => {
      if (savingRef.current) return

      savingRef.current = true
      setSaving(true)
      try {
        await updateProgress({
          data: {
            moduleId: module.id,
            watchedSeconds,
            currentPosition,
            sessionDuration,
          },
        })

        // Update local progress display
        const newPercent = Math.floor((watchedSeconds / module.durationSeconds) * 100)
        setCurrentProgress(Math.min(newPercent, 100))
      } catch (error) {
        console.error('Failed to save progress:', error)
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [module.id, module.durationSeconds]
  )

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/training" className="text-small">
              &larr; Back to Training
            </Link>
          </div>

          <div className="flex flex-between flex-center mb-2">
            <h1>{module.title}</h1>
            {currentProgress >= 90 ? (
              <span className="badge badge-success">Complete</span>
            ) : (
              <span className="badge badge-warning">{currentProgress}%</span>
            )}
          </div>

          {module.description && (
            <p className="text-muted mb-2">{module.description}</p>
          )}

          <div className="card mb-2">
            <YouTubePlayer
              videoId={module.youtubeVideoId}
              onProgress={handleProgress}
              initialPosition={progress?.lastPosition || 0}
              initialWatchedSeconds={progress?.watchedSeconds || 0}
            />

            <div className="flex flex-between flex-center mb-1">
              <span className="text-small text-muted">
                {saving ? 'Saving progress...' : 'Progress auto-saved'}
              </span>
              <span className="text-small">{currentProgress}%</span>
            </div>
            <div className="progress">
              <div
                className={`progress-bar ${currentProgress >= 90 ? 'complete' : ''}`}
                style={{ width: `${currentProgress}%` }}
              />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title mb-1">Training Requirements</h3>
            <p className="text-small text-muted">
              Watch at least 90% of this video to complete the training module.
              Your progress is automatically tracked as you watch.
            </p>
            <p className="text-small text-muted mt-1">
              Video duration: {Math.floor(module.durationSeconds / 60)} minutes
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
