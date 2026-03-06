/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { cancelMyCheckoutAppointment } from '~/server/api/machines'
import { cancelReservation } from '~/server/api/reservations'

let reservationsData: {
  reservations: Array<{
    id: string
    status: 'pending' | 'approved' | 'confirmed' | 'cancelled'
    startTime: Date
    endTime: Date
    machine: { name: string }
  }>
}

let checkoutAppointmentsData: {
  appointments: Array<{
    id: string
    status: 'pending' | 'accepted'
    startTime: Date
    endTime: Date
    machine: { name: string }
    manager: { email: string; name: string | null }
  }>
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  createFileRoute: () => (options: { component: unknown }) => ({ options }),
}))

vi.mock('~/lib/query/options', () => ({
  myUpcomingCheckoutAppointmentsQueryOptions: vi.fn(() => ({
    queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
    queryFn: vi.fn(async () => checkoutAppointmentsData),
  })),
  reservationsListQueryOptions: vi.fn(() => ({
    queryKey: queryKeys.reservations.mine({ includesPast: true }),
    queryFn: vi.fn(async () => reservationsData),
  })),
}))

vi.mock('~/server/api/machines', () => ({
  cancelMyCheckoutAppointment: vi.fn(),
}))

vi.mock('~/server/api/reservations', () => ({
  cancelReservation: vi.fn(),
}))

describe('reservations route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('prompt', vi.fn(() => ''))

    reservationsData = {
      reservations: [
        {
          id: 'reservation-1',
          status: 'approved',
          startTime: new Date('2026-03-07T19:00:00.000Z'),
          endTime: new Date('2026-03-07T20:00:00.000Z'),
          machine: { name: 'Laser Cutter' },
        },
      ],
    }

    checkoutAppointmentsData = {
      appointments: [],
    }

    vi.mocked(cancelReservation).mockResolvedValue({
      success: true,
      reservation: {} as never,
    } as Awaited<ReturnType<typeof cancelReservation>>)
    vi.mocked(cancelMyCheckoutAppointment).mockResolvedValue({
      success: true,
      appointment: {} as never,
    } as unknown as Awaited<ReturnType<typeof cancelMyCheckoutAppointment>>)
  })

  it('revalidates the active reservation count after cancellation', async () => {
    const { Route } = await import('./index')
    const ReservationsPage = Route.options.component as () => ReactNode
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
        <ReservationsPage />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('button', { name: 'Cancel reservation' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel reservation' }))

    await waitFor(() => {
      expect(cancelReservation).toHaveBeenCalledWith({
        data: {
          reservationId: 'reservation-1',
        },
      })
    })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.reservations.activeCount(),
      })
    })
  })
})
