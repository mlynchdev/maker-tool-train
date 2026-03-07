/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type ModuleData = {
  module: {
    id: string
    title: string
    description: string | null
    youtubeVideoId: string
    durationSeconds: number
  }
  progress: {
    percentComplete: number
    watchedSeconds: number
    watchedRanges: Array<{ start: number; end: number }>
    lastPosition: number
  }
  hasValidVideoId: boolean
}

let getModuleDataMock = vi.fn<() => Promise<ModuleData>>()
let resolveModuleData: ((value: ModuleData) => void) | null = null

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to?: string
  }) => createElement('a', { ...props, href: to ?? '#' }, children),
  createFileRoute: () => (options: { component: unknown }) => ({ options }),
  useParams: () => ({ moduleId: '11111111-1111-1111-1111-111111111111' }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: () => getModuleDataMock,
    }),
    handler: () => getModuleDataMock,
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  trainingModules: {},
}))

vi.mock('~/server/auth/middleware', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('~/server/services/training', () => ({
  getModuleProgress: vi.fn(),
}))

vi.mock('~/server/api/training', () => ({
  updateProgress: vi.fn(),
}))

vi.mock('~/lib/youtube', () => ({
  normalizeYouTubeId: (value: string) => value,
}))

vi.mock('~/components/YouTubePlayer', () => ({
  YouTubePlayer: ({ videoId }: { videoId: string }) => (
    <div data-testid="youtube-player">{videoId}</div>
  ),
}))

describe('training module route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    resolveModuleData = null
    getModuleDataMock = vi.fn(
      () =>
        new Promise<ModuleData>((resolve) => {
          resolveModuleData = resolve
        })
    )
  })

  it('renders successfully after transitioning from loading to loaded state', async () => {
    const { Route } = await import('./$moduleId')
    const TrainingModulePage = Route.options.component as () => ReactNode
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <TrainingModulePage />
      </QueryClientProvider>
    )

    expect(screen.getByText('Loading training module...')).toBeInTheDocument()

    await act(async () => {
      resolveModuleData?.({
        module: {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Laser Safety',
          description: 'Safe startup and shutdown.',
          youtubeVideoId: 'laser123',
          durationSeconds: 900,
        },
        progress: {
          percentComplete: 35,
          watchedSeconds: 315,
          watchedRanges: [{ start: 0, end: 315 }],
          lastPosition: 315,
        },
        hasValidVideoId: true,
      })
    })

    expect(await screen.findByRole('heading', { name: 'Laser Safety' })).toBeInTheDocument()
    expect(screen.getByTestId('youtube-player')).toHaveTextContent('laser123')
    expect(screen.getByText('35%')).toBeInTheDocument()
  })
})
