import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useCallback, useRef, useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { normalizeYouTubeId } from '~/lib/youtube'
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

    const normalizedVideoId = normalizeYouTubeId(module.youtubeVideoId)
    if (normalizedVideoId && normalizedVideoId !== module.youtubeVideoId) {
      await db
        .update(trainingModules)
        .set({
          youtubeVideoId: normalizedVideoId,
          updatedAt: new Date(),
        })
        .where(eq(trainingModules.id, module.id))

      module.youtubeVideoId = normalizedVideoId
    }

    const progress = await getModuleProgress(user.id, data.moduleId)

    return { user, module, progress, hasValidVideoId: Boolean(normalizedVideoId) }
  })

export const Route = createFileRoute('/training/$moduleId')({
  component: TrainingModulePage,
  loader: async ({ params }) => {
    return await getModuleData({ data: { moduleId: params.moduleId } })
  },
})

function TrainingModulePage() {
  const { user, module, progress, hasValidVideoId } = Route.useLoaderData()
  const [currentProgress, setCurrentProgress] = useState(progress?.percentComplete || 0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const pendingRef = useRef<{ watchedSeconds: number; currentPosition: number; sessionDuration: number; videoDuration: number } | null>(null)

  const saveProgress = useCallback(
    async (watchedSeconds: number, currentPosition: number, sessionDuration: number, videoDuration: number) => {
      savingRef.current = true
      setSaving(true)

      // Always update the local display from client-tracked watchedSeconds
      const displayDuration = videoDuration > 0 ? videoDuration : module.durationSeconds
      const localPercent = Math.min(Math.floor((watchedSeconds / displayDuration) * 100), 100)
      setCurrentProgress(localPercent)

      try {
        const result = await updateProgress({
          data: {
            moduleId: module.id,
            watchedSeconds,
            currentPosition,
            sessionDuration,
            videoDuration: videoDuration > 0 ? videoDuration : undefined,
          },
        })

        if (result.success && 'percentComplete' in result) {
          // Prefer server-accepted value (may differ from local if server capped it)
          setCurrentProgress(result.percentComplete)
        } else if (!result.success) {
          console.warn('Progress update rejected:', result.error)
        }
      } catch (error) {
        console.error('Failed to save progress:', error)
      } finally {
        savingRef.current = false
        setSaving(false)
      }

      // Flush any queued update (e.g. final report on video end)
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        await saveProgress(pending.watchedSeconds, pending.currentPosition, pending.sessionDuration, pending.videoDuration)
      }
    },
    [module.id, module.durationSeconds]
  )

  const handleProgress = useCallback(
    async (watchedSeconds: number, currentPosition: number, sessionDuration: number, videoDuration: number) => {
      if (savingRef.current) {
        // Queue latest values — only the most recent matters
        pendingRef.current = { watchedSeconds, currentPosition, sessionDuration, videoDuration }
        return
      }
      await saveProgress(watchedSeconds, currentPosition, sessionDuration, videoDuration)
    },
    [saveProgress]
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
            {hasValidVideoId ? (
              <YouTubePlayer
                videoId={module.youtubeVideoId}
                onProgress={handleProgress}
                initialPosition={progress?.lastPosition || 0}
                initialWatchedSeconds={progress?.watchedSeconds || 0}
              />
            ) : (
              <div className="alert alert-warning">
                This training video is misconfigured. Ask an admin to update the YouTube URL/ID.
              </div>
            )}

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
