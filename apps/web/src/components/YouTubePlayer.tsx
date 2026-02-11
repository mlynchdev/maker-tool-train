import { useEffect, useRef, useCallback, useState } from 'react'
import { loadYouTubeIframeAPI } from '~/lib/youtube-iframe'

declare global {
  interface Window {
    YT: typeof YT
    onYouTubeIframeAPIReady: () => void
  }
}

interface YouTubePlayerProps {
  videoId: string
  onProgress: (watchedSeconds: number, currentPosition: number, sessionDuration: number) => void
  initialPosition?: number
  initialWatchedSeconds?: number
}

export function YouTubePlayer({ videoId, onProgress, initialPosition = 0, initialWatchedSeconds = 0 }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const [isReady, setIsReady] = useState(false)
  const lastUpdateRef = useRef<number>(Date.now())
  const lastTimeRef = useRef<number>(initialPosition)
  const watchedSecondsRef = useRef<number>(initialWatchedSeconds)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  const trackProgress = useCallback(() => {
    if (!playerRef.current) return

    const player = playerRef.current
    const state = player.getPlayerState()

    // Only track when playing (state === 1)
    if (state === 1) {
      const currentTime = Math.floor(player.getCurrentTime())
      const now = Date.now()
      const sessionDuration = Math.floor((now - lastUpdateRef.current) / 1000)

      // Accumulate only forward, continuous playback (not seeks)
      const delta = currentTime - lastTimeRef.current
      if (delta > 0 && delta <= 2) {
        watchedSecondsRef.current += delta
      }
      lastTimeRef.current = currentTime

      // Report progress every 5 seconds
      if (sessionDuration >= 5) {
        onProgressRef.current(watchedSecondsRef.current, currentTime, sessionDuration)
        lastUpdateRef.current = now
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const initPlayer = async () => {
      await loadYouTubeIframeAPI()

      if (!mounted || !containerRef.current) return

      // Clear any existing player
      if (playerRef.current) {
        playerRef.current.destroy()
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          start: initialPosition,
        },
        events: {
          onReady: () => {
            setIsReady(true)
            lastUpdateRef.current = Date.now()
          },
          onStateChange: (event) => {
            // When video ends, send final progress
            if (event.data === 0) {
              const player = playerRef.current
              if (player) {
                const duration = Math.floor(player.getDuration())
                const now = Date.now()
                const sessionDuration = Math.floor((now - lastUpdateRef.current) / 1000)
                onProgressRef.current(duration, duration, sessionDuration)
              }
            }
          },
        },
      })
    }

    initPlayer()

    return () => {
      mounted = false
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [videoId, initialPosition])

  // Set up progress tracking interval
  useEffect(() => {
    if (isReady) {
      intervalRef.current = setInterval(trackProgress, 1000)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isReady, trackProgress])

  return (
    <div className="video-container">
      <div ref={containerRef} />
    </div>
  )
}
