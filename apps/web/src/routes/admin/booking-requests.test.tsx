/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { moderateReservationRequest } from '~/server/api/admin'

let bookingRequestsData: {
  user: { id: string; email: string; name: string | null; role: string }
  pendingRequests: Array<{
    id: string
    createdAt: Date
    startTime: Date
    endTime: Date
    status: 'pending'
    decisionReason: string | null
    reviewNotes: string | null
    user: { name: string | null; email: string }
    machine: { name: string }
    reviewer: null
    updatedAt: Date
  }>
  recentDecisions: unknown[]
  bookingNotifications: Array<{ id: string; type: string }>
}

let bookingSearch = { view: 'pending', q: '' }
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: unknown }) => ({
    options,
    useSearch: () => bookingSearch,
  }),
  useNavigate: () => navigateMock,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: () => vi.fn(async () => bookingRequestsData),
  }),
}))

vi.mock('~/lib/db', () => ({
  db: {},
  reservations: {},
}))

vi.mock('~/server/api/admin', () => ({
  moderateReservationRequest: vi.fn(),
}))

vi.mock('~/server/api/notifications', () => ({
  markMyNotificationRead: vi.fn(),
}))

describe('admin booking requests route', () => {
  beforeEach(() => {
    bookingSearch = { view: 'pending', q: '' }
    navigateMock.mockReset()
    bookingRequestsData = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      pendingRequests: [
        {
          id: 'reservation-1',
          createdAt: new Date('2026-03-01T18:00:00.000Z'),
          startTime: new Date('2026-03-03T18:00:00.000Z'),
          endTime: new Date('2026-03-03T19:00:00.000Z'),
          status: 'pending',
          decisionReason: null,
          reviewNotes: null,
          user: { name: 'Pat Pending', email: 'pat@example.com' },
          machine: { name: 'CNC Router' },
          reviewer: null,
          updatedAt: new Date('2026-03-01T18:00:00.000Z'),
        },
      ],
      recentDecisions: [],
      bookingNotifications: [],
    }

    vi.mocked(moderateReservationRequest).mockResolvedValue({
      success: false,
      error: 'Moderation failed',
    })
  })

  it('restores the pending reservation count when moderation fails', async () => {
    const { Route } = await import('./booking-requests')
    const BookingRequestsPage = Route.options.component as () => ReactNode
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    queryClient.setQueryData(queryKeys.admin.pendingReservationRequestCount(), {
      count: 1,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <BookingRequestsPage />
      </QueryClientProvider>
    )

    expect(await screen.findByText('CNC Router')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(moderateReservationRequest).toHaveBeenCalledWith({
        data: {
          reservationId: 'reservation-1',
          decision: 'approve',
          reason: undefined,
          notes: undefined,
        },
      })
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData(queryKeys.admin.pendingReservationRequestCount())
      ).toEqual({ count: 1 })
    })

    expect(screen.getByText('CNC Router')).toBeInTheDocument()
  })
})
