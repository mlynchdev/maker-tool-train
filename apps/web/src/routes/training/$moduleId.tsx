import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useCallback, useRef, useState } from 'react'
import type { WatchedRange } from '~/lib/watch-ranges'
import { requireAuth } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { normalizeYouTubeId } from '~/lib/youtube'
import { getModuleProgress } from '~/server/services/training'
import { YouTubePlayer } from '~/components/YouTubePlayer'
import { updateProgress } from '~/server/api/training'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'

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

    return { module, progress, hasValidVideoId: Boolean(normalizedVideoId) }
  })

export const Route = createFileRoute('/training/$moduleId')({
  component: TrainingModulePage,
  loader: async ({ params }) => {
    return await getModuleData({ data: { moduleId: params.moduleId } })
  },
})

function TrainingModulePage() {
  const { module, progress, hasValidVideoId } = Route.useLoaderData()
  const [currentProgress, setCurrentProgress] = useState(progress?.percentComplete || 0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const pendingRef = useRef<{
    watchedSeconds: number
    watchedRanges: WatchedRange[]
    currentPosition: number
    sessionDuration: number
    videoDuration: number
    ended: boolean
  } | null>(null)

  const saveProgress = useCallback(
    async (
      watchedSeconds: number,
      watchedRanges: WatchedRange[],
      currentPosition: number,
      sessionDuration: number,
      videoDuration: number,
      ended: boolean
    ) => {
      savingRef.current = true
      setSaving(true)

      const displayDuration = videoDuration > 0 ? videoDuration : module.durationSeconds
      const localPercent = Math.min(Math.floor((watchedSeconds / displayDuration) * 100), 100)
      setCurrentProgress(localPercent)

      try {
        const result = await updateProgress({
          data: {
            moduleId: module.id,
            watchedSeconds,
            watchedRanges,
            currentPosition,
            sessionDuration,
            videoDuration: videoDuration > 0 ? videoDuration : undefined,
            ended,
          },
        })

        if (result.success && 'percentComplete' in result) {
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

      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        await saveProgress(
          pending.watchedSeconds,
          pending.watchedRanges,
          pending.currentPosition,
          pending.sessionDuration,
          pending.videoDuration,
          pending.ended
        )
      }
    },
    [module.id, module.durationSeconds]
  )

  const handleProgress = useCallback(
    async ({
      watchedSeconds,
      watchedRanges,
      currentPosition,
      sessionDuration,
      videoDuration,
      ended,
    }: {
      watchedSeconds: number
      watchedRanges: WatchedRange[]
      currentPosition: number
      sessionDuration: number
      videoDuration: number
      ended: boolean
    }) => {
      if (savingRef.current) {
        const pending = pendingRef.current
        pendingRef.current = pending
          ? {
              watchedSeconds: Math.max(pending.watchedSeconds, watchedSeconds),
              watchedRanges,
              currentPosition,
              sessionDuration: Math.min(300, pending.sessionDuration + sessionDuration),
              videoDuration: Math.max(pending.videoDuration, videoDuration),
              ended: pending.ended || ended,
            }
          : {
              watchedSeconds,
              watchedRanges,
              currentPosition,
              sessionDuration,
              videoDuration,
              ended,
            }
        return
      }
      await saveProgress(
        watchedSeconds,
        watchedRanges,
        currentPosition,
        sessionDuration,
        videoDuration,
        ended
      )
    },
    [saveProgress]
  )

  return (
    <div className="min-h-screen">
      <main className="container space-y-6 py-6 md:py-8">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link to="/training">&larr; Back to Training</Link>
        </Button>

        <section className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{module.title}</h1>
            {module.description && (
              <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
            )}
          </div>
          {currentProgress >= 90 ? (
            <Badge variant="success">Complete</Badge>
          ) : (
            <Badge variant="warning">{currentProgress}% complete</Badge>
          )}
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video Training</CardTitle>
            <CardDescription>Progress is auto-saved while you watch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasValidVideoId ? (
              <YouTubePlayer
                videoId={module.youtubeVideoId}
                onProgress={handleProgress}
                initialPosition={progress?.lastPosition || 0}
                initialWatchedSeconds={progress?.watchedSeconds || 0}
                initialWatchedRanges={progress?.watchedRanges || []}
              />
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Video configuration issue</AlertTitle>
                <AlertDescription>
                  This module has an invalid YouTube URL or ID. Ask an admin to update it.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {saving ? 'Saving progress...' : 'Progress auto-saved'}
                </span>
                <span className="font-medium">{currentProgress}%</span>
              </div>
              <Progress
                value={currentProgress}
                indicatorClassName={currentProgress >= 90 ? 'bg-emerald-500' : ''}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completion Requirement</CardTitle>
            <CardDescription>
              Watch at least 90% to complete this module and unlock required machine steps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Estimated duration: {Math.floor(module.durationSeconds / 60)} minutes.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
