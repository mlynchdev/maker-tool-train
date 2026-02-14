import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { loadYouTubeIframeAPI } from '~/lib/youtube-iframe'
import { normalizeYouTubeId } from '~/lib/youtube'
import {
  addWatchedRange,
  getWatchedRangeSeconds,
  normalizeWatchedRanges,
  type WatchedRange,
} from '~/lib/watch-ranges'

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }
}

const MAX_PLAYBACK_RATE = 1.5
const REPORT_INTERVAL_SECONDS = 5

// YouTube Player States
const ENDED = 0
const PLAYING = 1
const PAUSED = 2

interface YouTubePlayerProps {
  videoId: string
  onProgress: (update: {
    watchedSeconds: number
    watchedRanges: WatchedRange[]
    currentPosition: number
    sessionDuration: number
    videoDuration: number
    ended: boolean
  }) => void
  initialPosition?: number
  initialWatchedSeconds?: number
  initialWatchedRanges?: WatchedRange[]
}

export function YouTubePlayer({
  videoId,
  onProgress,
  initialPosition = 0,
  initialWatchedSeconds = 0,
  initialWatchedRanges = [],
}: YouTubePlayerProps) {
  const normalizedVideoId = useMemo(() => normalizeYouTubeId(videoId), [videoId])
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [speedWarning, setSpeedWarning] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)

  const initialRangesRef = useRef<WatchedRange[]>(
    initialWatchedRanges.length > 0
      ? normalizeWatchedRanges(initialWatchedRanges, Number.MAX_SAFE_INTEGER)
      : initialWatchedSeconds > 0
        ? [{ start: 0, end: initialWatchedSeconds }]
        : []
  )

  // Progress tracking refs
  const watchedRangesRef = useRef<WatchedRange[]>(initialRangesRef.current)
  const watchedSecondsRef = useRef(
    initialRangesRef.current.length > 0
      ? getWatchedRangeSeconds(initialRangesRef.current)
      : initialWatchedSeconds
  )
  const lastPositionRef = useRef(initialPosition)
  const initialPositionRef = useRef(initialPosition)
  const lastTickWallRef = useRef(0) // wall-clock ms of last tick; 0 = not actively tracking
  const lastReportWallRef = useRef(Date.now())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  // Accumulate watched time from the last tick to now
  const accumulate = useCallback(() => {
    const player = playerRef.current
    if (!player || lastTickWallRef.current === 0) return

    const now = Date.now()
    const currentTime = player.getCurrentTime()
    const wallElapsed = (now - lastTickWallRef.current) / 1000
    const rate = player.getPlaybackRate()
    const expectedDelta = wallElapsed * rate

    const videoDelta = currentTime - lastPositionRef.current

    // Only credit forward, continuous playback (rejects seeks and backwards jumps)
    if (videoDelta > 0 && videoDelta <= expectedDelta + 2) {
      const duration = player.getDuration() || 0
      const maxDuration = duration > 0 ? duration : Number.MAX_SAFE_INTEGER
      watchedRangesRef.current = addWatchedRange(
        watchedRangesRef.current,
        { start: lastPositionRef.current, end: currentTime },
        maxDuration
      )
      watchedSecondsRef.current = Math.min(
        getWatchedRangeSeconds(watchedRangesRef.current),
        maxDuration
      )
    }

    lastPositionRef.current = currentTime
    lastTickWallRef.current = now
  }, [])

  // Send current progress to the parent
  const report = useCallback((ended: boolean) => {
    const now = Date.now()
    const sessionDuration = Math.max(
      1,
      Math.ceil((now - lastReportWallRef.current) / 1000)
    )
    lastReportWallRef.current = now

    const videoDuration = Math.floor(playerRef.current?.getDuration() || 0)

    onProgressRef.current({
      watchedSeconds: Math.floor(watchedSecondsRef.current),
      watchedRanges: watchedRangesRef.current.map((range) => ({ ...range })),
      currentPosition: Math.floor(lastPositionRef.current),
      sessionDuration,
      videoDuration,
      ended,
    })
  }, [])

  // Interval tick: accumulate time, then report if enough time has passed
  const tick = useCallback(() => {
    const player = playerRef.current
    if (!player || player.getPlayerState() !== PLAYING) return

    accumulate()

    const sinceLastReport = (Date.now() - lastReportWallRef.current) / 1000
    if (sinceLastReport >= REPORT_INTERVAL_SECONDS) {
      report(false)
    }
  }, [accumulate, report])

  const handlePlaybackRateChange = useCallback((event: YT.OnPlaybackRateChangeEvent) => {
    if (event.data > MAX_PLAYBACK_RATE) {
      playerRef.current?.setPlaybackRate(MAX_PLAYBACK_RATE)
      setSpeedWarning(true)
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
      warningTimerRef.current = setTimeout(() => setSpeedWarning(false), 4000)
    }
  }, [])

  // Use refs for callbacks used in player events to avoid re-initializing the player
  const accumulateRef = useRef(accumulate)
  accumulateRef.current = accumulate
  const reportRef = useRef(report)
  reportRef.current = report
  const handlePlaybackRateChangeRef = useRef(handlePlaybackRateChange)
  handlePlaybackRateChangeRef.current = handlePlaybackRateChange

  useEffect(() => {
    let mounted = true

    if (!normalizedVideoId) {
      setPlayerError('Training video is misconfigured. Ask an admin to update the YouTube URL/ID.')
      return () => {
        mounted = false
      }
    }

    const initPlayer = async () => {
      try {
        await loadYouTubeIframeAPI()
      } catch {
        if (mounted) {
          setPlayerError('Failed to load YouTube player.')
        }
        return
      }

      if (!mounted || !containerRef.current) return

      setPlayerError(null)

      // Clear any existing player
      if (playerRef.current) {
        playerRef.current.destroy()
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: normalizedVideoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          start: initialPositionRef.current,
        },
        events: {
          onReady: () => {
            setIsReady(true)
            setPlayerError(null)
          },
          onStateChange: (event: YT.OnStateChangeEvent) => {
            const state = event.data

            if (state === PLAYING) {
              // Starting or resuming: reset wall-clock baseline so first tick is accurate
              lastTickWallRef.current = Date.now()
              lastPositionRef.current = playerRef.current?.getCurrentTime() || 0
            } else if (state === PAUSED) {
              // Flush any accumulated time since last tick, then report immediately
              if (lastTickWallRef.current > 0) {
                accumulateRef.current()
                reportRef.current(false)
              }
              lastTickWallRef.current = 0 // stop accumulating until next play
            } else if (state === ENDED) {
              if (lastTickWallRef.current > 0) {
                accumulateRef.current()
              }

              const duration = playerRef.current?.getDuration() || 0
              if (duration > 0) {
                watchedRangesRef.current = addWatchedRange(
                  watchedRangesRef.current,
                  { start: Math.max(0, duration - 1), end: duration },
                  duration
                )
                watchedSecondsRef.current = Math.min(
                  getWatchedRangeSeconds(watchedRangesRef.current),
                  duration
                )
                lastPositionRef.current = duration
              }

              reportRef.current(true)
              lastTickWallRef.current = 0
            }
          },
          onError: (event: { data: number; target: YT.Player }) => {
            if (event.data === 2) {
              setPlayerError('Invalid YouTube video ID or URL.')
              return
            }
            if (event.data === 100) {
              setPlayerError('This YouTube video is missing or private.')
              return
            }
            if (event.data === 101 || event.data === 150) {
              setPlayerError('This video cannot be played in an embedded player.')
              return
            }
            setPlayerError('Unable to play this YouTube video.')
          },
          onPlaybackRateChange: (e: YT.OnPlaybackRateChangeEvent) => handlePlaybackRateChangeRef.current(e),
        },
      })
    }

    initPlayer()

    return () => {
      mounted = false
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [normalizedVideoId])

  // Set up progress tracking interval
  useEffect(() => {
    if (isReady) {
      intervalRef.current = setInterval(tick, 1000)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isReady, tick])

  // Pause video when window loses focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && playerRef.current?.getPlayerState() === PLAYING) {
        playerRef.current.pauseVideo()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  return (
    <div>
      {playerError && (
        <div className="alert alert-warning">
          {playerError}
          {normalizedVideoId && (
            <span>
              {' '}
              <a
                href={`https://www.youtube.com/watch?v=${normalizedVideoId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube
              </a>
            </span>
          )}
        </div>
      )}
      {speedWarning && (
        <div className="speed-warning">
          Maximum playback speed is 1.5x. Speed has been adjusted.
        </div>
      )}
      <div className="video-container">
        <div ref={containerRef} />
      </div>
    </div>
  )
}
