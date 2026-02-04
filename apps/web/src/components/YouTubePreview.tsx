import { useEffect, useRef, useState } from 'react'
import { loadYouTubeIframeAPI } from '~/lib/youtube-iframe'
import { formatDuration } from '~/lib/youtube'

interface YouTubePreviewProps {
  videoId: string
  onMetadata?: (metadata: { title?: string; durationSeconds?: number }) => void
  onError?: (message: string) => void
}

export function YouTubePreview({ videoId, onMetadata, onError }: YouTubePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const titleReportedRef = useRef(false)

  useEffect(() => {
    setTitle(null)
    setDurationSeconds(null)
    setError(null)
    titleReportedRef.current = false
  }, [videoId])

  useEffect(() => {
    let mounted = true
    let retries = 0
    let retryTimeout: ReturnType<typeof setTimeout> | null = null

    const reportMetadata = () => {
      const player = playerRef.current
      if (!player) return

      const data = player.getVideoData()
      const duration = Math.floor(player.getDuration())

      if (data?.title) {
        setTitle(data.title)
        if (!titleReportedRef.current) {
          onMetadata?.({ title: data.title })
          titleReportedRef.current = true
        }
      }

      if (duration > 0) {
        setDurationSeconds(duration)
        onMetadata?.({ title: data?.title, durationSeconds: duration })
        return
      }

      if (retries < 5) {
        retries += 1
        retryTimeout = setTimeout(reportMetadata, 300)
      }
    }

    const initPlayer = async () => {
      try {
        await loadYouTubeIframeAPI()
      } catch {
        if (mounted) {
          const message = 'Failed to load YouTube preview.'
          setError(message)
          onError?.(message)
        }
        return
      }

      if (!mounted || !containerRef.current) return

      if (playerRef.current) {
        playerRef.current.destroy()
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: reportMetadata,
          onError: () => {
            const message = 'Unable to load this video. Check the URL or ID.'
            setError(message)
            onError?.(message)
          },
        },
      })
    }

    initPlayer()

    return () => {
      mounted = false
      if (retryTimeout) {
        clearTimeout(retryTimeout)
      }
      if (playerRef.current) {
        playerRef.current.destroy()
        playerRef.current = null
      }
    }
  }, [videoId, onMetadata, onError])

  return (
    <div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="video-container">
        <div ref={containerRef} />
      </div>
      {(title || durationSeconds) && (
        <div className="text-small text-muted">
          {title && (
            <div>
              <strong>Title:</strong> {title}
            </div>
          )}
          {durationSeconds && (
            <div>
              <strong>Duration:</strong> {formatDuration(durationSeconds)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
