/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import {
  approveCheckout,
  deleteUser,
  revokeCheckout,
  updateUser,
} from '~/server/api/admin'

let usersData: {
  user: { id: string; email: string; name: string | null; role: string }
  users: Array<{
    id: string
    email: string
    name: string | null
    role: 'member' | 'manager' | 'admin'
    status: 'active' | 'suspended'
    createdAt: Date
  }>
  machines: Array<{
    id: string
    name: string
    resourceType: 'machine' | 'tool'
  }>
  checkoutPairs: Array<{ userId: string; machineId: string }>
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: unknown }) => ({ options }),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: () => vi.fn(async () => usersData),
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  machines: {},
  users: {},
}))

vi.mock('~/server/api/admin', () => ({
  approveCheckout: vi.fn(),
  deleteUser: vi.fn(),
  revokeCheckout: vi.fn(),
  updateUser: vi.fn(),
}))

describe('admin users route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    usersData = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      users: [
        {
          id: 'admin-1',
          email: 'admin@example.com',
          name: 'Admin',
          role: 'admin',
          status: 'active',
          createdAt: new Date('2026-03-01T18:00:00.000Z'),
        },
        {
          id: 'member-1',
          email: 'member@example.com',
          name: 'Member One',
          role: 'member',
          status: 'active',
          createdAt: new Date('2026-03-02T18:00:00.000Z'),
        },
      ],
      machines: [
        {
          id: 'machine-1',
          name: 'Laser Cutter',
          resourceType: 'machine',
        },
      ],
      checkoutPairs: [],
    }

    vi.mocked(updateUser).mockResolvedValue({
      success: true,
      user: {
        id: 'member-1',
      } as never,
    } as Awaited<ReturnType<typeof updateUser>>)
    vi.mocked(approveCheckout).mockResolvedValue({
      success: true,
      checkout: {} as never,
    } as Awaited<ReturnType<typeof approveCheckout>>)
    vi.mocked(revokeCheckout).mockResolvedValue({
      success: true,
      cancelledAppointments: 0,
    } as Awaited<ReturnType<typeof revokeCheckout>>)
    vi.mocked(deleteUser).mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<typeof deleteUser>>)
  })

  it('revalidates the admin users query after status changes', async () => {
    const { Route } = await import('./users')
    const UsersPage = Route.options.component as () => ReactNode
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
        <UsersPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Suspend' })[0])

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({
        data: {
          userId: 'member-1',
          status: 'suspended',
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.admin.users(),
      })
    })
  })

  it('revalidates the admin users query after checkout access changes', async () => {
    const { Route } = await import('./users')
    const UsersPage = Route.options.component as () => ReactNode
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
        <UsersPage />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('button', { name: 'Grant checkout' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Grant checkout' }))

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
        queryKey: queryKeys.admin.users(),
      })
    })
  })

  it('applies refreshed admin user data after query invalidation', async () => {
    const { Route } = await import('./users')
    const UsersPage = Route.options.component as () => ReactNode
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <UsersPage />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grant checkout' })).toBeInTheDocument()

    usersData = {
      ...usersData,
      users: usersData.users.map((user) =>
        user.id === 'member-1' ? { ...user, status: 'suspended' as const } : user
      ),
      checkoutPairs: [{ userId: 'member-1', machineId: 'machine-1' }],
    }

    await queryClient.invalidateQueries({
      queryKey: queryKeys.admin.users(),
    })

    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Revoke checkout' })).toBeInTheDocument()
  })
})
