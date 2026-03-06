/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { createTrainingModule, updateTrainingModule } from '~/server/api/admin'

let trainingData: {
  modules: Array<{
    id: string
    title: string
    description: string | null
    youtubeVideoId: string
    durationSeconds: number
    active: boolean
    requirements: Array<{ machine: { name: string } | null }>
  }>
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to?: string
  }) => createElement('a', { ...props, href: to ?? '#' }, children),
  createFileRoute: () => (options: { component: ReactNode }) => ({ options }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: () => vi.fn(async () => trainingData),
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  trainingModules: {},
}))

vi.mock('~/server/api/admin', () => ({
  createTrainingModule: vi.fn(),
  updateTrainingModule: vi.fn(),
}))

describe('admin training route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    trainingData = {
      modules: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Laser Safety',
          description: 'Safe startup and shutdown.',
          youtubeVideoId: 'laser123',
          durationSeconds: 900,
          active: true,
          requirements: [{ machine: { name: 'Laser Cutter' } }],
        },
      ],
    }

    vi.mocked(createTrainingModule).mockResolvedValue({
      success: true,
      module: {
        id: '22222222-2222-2222-2222-222222222222',
      } as never,
    } as Awaited<ReturnType<typeof createTrainingModule>>)

    vi.mocked(updateTrainingModule).mockResolvedValue({
      success: true,
      module: {
        id: '11111111-1111-1111-1111-111111111111',
        title: 'Laser Safety',
        description: 'Safe startup and shutdown.',
        youtubeVideoId: 'laser123',
        durationSeconds: 900,
        active: false,
      } as never,
    } as Awaited<ReturnType<typeof updateTrainingModule>>)
  })

  it('revalidates the training modules query after toggling a module', async () => {
    const { Route } = await import('./training')
    const TrainingPage = Route.options.component as () => ReactNode
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <TrainingPage />
      </QueryClientProvider>
    )

    expect(await screen.findByText('Laser Safety')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      expect(updateTrainingModule).toHaveBeenCalledWith({
        data: {
          moduleId: '11111111-1111-1111-1111-111111111111',
          active: false,
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.trainingModules(),
      })
    })
  })
})
