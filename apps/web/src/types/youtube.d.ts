declare namespace YT {
  type PlayerState = -1 | 0 | 1 | 2 | 3 | 5

  interface VideoData {
    title: string
  }

  interface OnStateChangeEvent {
    data: PlayerState
    target: Player
  }

  interface OnPlaybackRateChangeEvent {
    data: number
    target: Player
  }

  interface PlayerOptions {
    host?: string
    videoId?: string
    playerVars?: Record<string, unknown>
    events?: {
      onReady?: (event: { target: Player }) => void
      onStateChange?: (event: OnStateChangeEvent) => void
      onPlaybackRateChange?: (event: OnPlaybackRateChangeEvent) => void
      onError?: (event: { data: number; target: Player }) => void
    }
  }

  interface Player {
    destroy(): void
    getCurrentTime(): number
    getPlaybackRate(): number
    setPlaybackRate(rate: number): void
    getDuration(): number
    getPlayerState(): PlayerState
    pauseVideo(): void
    getVideoData(): VideoData
  }

  interface PlayerConstructor {
    new (element: HTMLElement | string, options?: PlayerOptions): Player
  }
}

declare const YT: {
  Player: YT.PlayerConstructor
}
