/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeReservationCountQueryOptions,
  pendingCheckoutCountQueryOptions,
  pendingReservationRequestCountQueryOptions,
  reservationsListQueryOptions,
  unreadNotificationCountQueryOptions,
} from '~/lib/query/options'
import { ShellProvider, useShellContext } from './ShellContext'

const getActiveReservationCountMock = vi.fn(async () => ({ count: 3 }))
const getUnreadCountMock = vi.fn(async () => ({ count: 4 }))
const getPendingCheckoutCountMock = vi.fn(async () => ({ count: 0 }))
const getPendingRequestCountMock = vi.fn(async () => ({ count: 0 }))

vi.mock('~/lib/query/options', () => ({
  activeReservationCountQueryOptions: vi.fn(() => ({
    queryKey: ['reservations', 'active-count'],
    queryFn: getActiveReservationCountMock,
  })),
  unreadNotificationCountQueryOptions: vi.fn(() => ({
    queryKey: ['notifications', 'unread-count'],
    queryFn: getUnreadCountMock,
  })),
  pendingCheckoutCountQueryOptions: vi.fn(() => ({
    queryKey: ['admin', 'pending-checkouts', 'count'],
    queryFn: getPendingCheckoutCountMock,
  })),
  pendingReservationRequestCountQueryOptions: vi.fn(() => ({
    queryKey: ['admin', 'pending-reservation-requests', 'count'],
    queryFn: getPendingRequestCountMock,
  })),
  reservationsListQueryOptions: vi.fn(),
}))

function ShellConsumer() {
  const { badges } = useShellContext()

  return (
    <div>
      <span>reservations:{badges.activeReservationCount}</span>
      <span>unread:{badges.unreadNotifications}</span>
    </div>
  )
}

describe('ShellContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the active reservation count query instead of fetching the full reservation list', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    queryClient.setQueryData(['reservations', 'active-count'], { count: 3 })
    queryClient.setQueryData(['notifications', 'unread-count'], { count: 4 })

    render(
      <QueryClientProvider client={queryClient}>
        <ShellProvider
          user={{
            id: 'member-1',
            email: 'member@example.com',
            name: 'Member',
            role: 'member',
          }}
        >
          <ShellConsumer />
        </ShellProvider>
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(activeReservationCountQueryOptions).toHaveBeenCalledTimes(1)
    })

    expect(unreadNotificationCountQueryOptions).toHaveBeenCalledTimes(1)
    expect(pendingCheckoutCountQueryOptions).toHaveBeenCalledTimes(1)
    expect(pendingReservationRequestCountQueryOptions).toHaveBeenCalledTimes(1)
    expect(getPendingCheckoutCountMock).not.toHaveBeenCalled()
    expect(getPendingRequestCountMock).not.toHaveBeenCalled()
    expect(reservationsListQueryOptions).not.toHaveBeenCalled()
    expect(screen.getByText('reservations:3')).toBeInTheDocument()
    expect(screen.getByText('unread:4')).toBeInTheDocument()
  })
})
