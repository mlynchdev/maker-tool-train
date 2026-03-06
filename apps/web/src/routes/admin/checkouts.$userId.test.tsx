/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { approveCheckout, revokeCheckout } from '~/server/api/admin'

let userCheckoutData: {
  currentUser: {
    id: string
    email: string
    name: string | null
    role: string
  }
  member: {
    id: string
    email: string
    name: string | null
    trainingProgress: Array<{
      id: string
      watchedSeconds: number
      completedAt: Date | null
      module: {
        title: string
        durationSeconds: number
      }
    }>
    managerCheckouts: unknown[]
  }
  machineStatuses: Array<{
    machine: { id: string; name: string }
    eligibility: {
      hasCheckout: boolean
      requirements: Array<{ completed: boolean }>
    }
    hasCheckout: boolean
    checkout?: unknown
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
  createFileRoute: () => (options: { component: ReactNode }) => ({
    options,
    useParams: () => ({ userId: 'member-1' }),
  }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: () => vi.fn(async () => userCheckoutData),
    }),
    handler: () => vi.fn(async () => userCheckoutData),
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  machines: {},
  users: {},
}))

vi.mock('~/server/api/admin', () => ({
  approveCheckout: vi.fn(),
  revokeCheckout: vi.fn(),
}))

describe('admin user checkout route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    userCheckoutData = {
      currentUser: {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      member: {
        id: 'member-1',
        email: 'member@example.com',
        name: 'Member One',
        trainingProgress: [],
        managerCheckouts: [],
      },
      machineStatuses: [
        {
          machine: {
            id: 'machine-1',
            name: 'Laser Cutter',
          },
          eligibility: {
            hasCheckout: false,
            requirements: [],
          },
          hasCheckout: false,
        },
      ],
    }

    vi.mocked(approveCheckout).mockResolvedValue({
      success: true,
      checkout: {} as never,
    } as Awaited<ReturnType<typeof approveCheckout>>)
    vi.mocked(revokeCheckout).mockResolvedValue({
      success: true,
      cancelledAppointments: 0,
    } as Awaited<ReturnType<typeof revokeCheckout>>)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('revalidates the admin users query after approving checkout access', async () => {
    const { Route } = await import('./checkouts.$userId')
    const UserCheckoutPage = Route.options.component as () => ReactNode
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
        <UserCheckoutPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Member One' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(approveCheckout).toHaveBeenCalledWith({
        data: {
          userId: 'member-1',
          machineId: 'machine-1',
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.userCheckouts('member-1'),
      })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.users(),
      })
    })
  })

  it('revalidates the admin users query after revoking checkout access', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    userCheckoutData.machineStatuses = [
      {
        machine: {
          id: 'machine-1',
          name: 'Laser Cutter',
        },
        eligibility: {
          hasCheckout: true,
          requirements: [],
        },
        hasCheckout: true,
        checkout: {},
      },
    ]

    const { Route } = await import('./checkouts.$userId')
    const UserCheckoutPage = Route.options.component as () => ReactNode
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
        <UserCheckoutPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Member One' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(revokeCheckout).toHaveBeenCalledWith({
        data: {
          userId: 'member-1',
          machineId: 'machine-1',
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.userCheckouts('member-1'),
      })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.users(),
      })
    })
  })
})
