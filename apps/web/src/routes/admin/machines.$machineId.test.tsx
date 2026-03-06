/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { saveMachineEditor } from '~/server/api/admin'

let machineEditData: {
  user: { id: string; email: string; name: string | null; role: string }
  machine: {
    id: string
    name: string
    description: string | null
    resourceType: 'machine' | 'tool'
    trainingDurationMinutes: number
    requirements: Array<{
      moduleId: string
      requiredWatchPercent: number
    }>
  }
  modules: Array<{
    id: string
    title: string
  }>
}

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: ReactNode
    to?: string
  }) => createElement('a', { ...props, href: to ?? '#' }, children),
  createFileRoute: () => (options: { component: unknown }) => ({
    options,
    useParams: () => ({ machineId: 'machine-1' }),
  }),
  useNavigate: () => navigateMock,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: () => vi.fn(async () => machineEditData),
    }),
    handler: () => vi.fn(async () => machineEditData),
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  machines: {},
  trainingModules: {},
}))

vi.mock('~/server/api/admin', () => ({
  saveMachineEditor: vi.fn(),
}))

describe('admin machine editor route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigateMock.mockReset()

    machineEditData = {
      user: {
        id: 'manager-1',
        email: 'manager@example.com',
        name: 'Manager',
        role: 'manager',
      },
      machine: {
        id: 'machine-1',
        name: 'Laser Cutter',
        description: 'Fast cuts',
        resourceType: 'machine',
        trainingDurationMinutes: 30,
        requirements: [
          {
            moduleId: 'module-1',
            requiredWatchPercent: 90,
          },
        ],
      },
      modules: [
        {
          id: 'module-1',
          title: 'Laser Safety',
        },
      ],
    }

    vi.mocked(saveMachineEditor).mockResolvedValue({
      success: true,
      machine: {
        id: 'machine-1',
      } as never,
    } as Awaited<ReturnType<typeof saveMachineEditor>>)
  })

  it('revalidates machine caches and navigates after a successful save', async () => {
    const { Route } = await import('./machines.$machineId')
    const MachineEditorPage = Route.options.component as () => ReactNode
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
        <MachineEditorPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Edit Machine' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(saveMachineEditor).toHaveBeenCalledWith({
        data: {
          machineId: 'machine-1',
          name: 'Laser Cutter',
          description: 'Fast cuts',
          resourceType: 'machine',
          trainingDurationMinutes: 30,
          requirements: [
            {
              moduleId: 'module-1',
              requiredWatchPercent: 90,
            },
          ],
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.machines(),
      })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.machineEditor('machine-1'),
      })
    })

    expect(navigateMock).toHaveBeenCalledWith({ to: '/admin/machines' })
  })

  it('revalidates machine caches even when save fails', async () => {
    vi.mocked(saveMachineEditor).mockRejectedValue(new Error('save failed'))

    const { Route } = await import('./machines.$machineId')
    const MachineEditorPage = Route.options.component as () => ReactNode
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
        <MachineEditorPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Edit Machine' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(saveMachineEditor).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.machines(),
      })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.machineEditor('machine-1'),
      })
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })
})
