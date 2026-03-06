/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'
import {
  cancelCheckoutAppointment,
  finalizeCheckoutMeeting,
  getPendingCheckoutCount,
  getPendingCheckouts,
  getPendingReservationRequestCount,
  getPendingReservationRequests,
  moderateCheckoutRequest,
  moderateReservationRequest,
} from '~/server/api/admin'
import { getMachines, getMyUpcomingCheckoutAppointments } from '~/server/api/machines'
import { getMyUnreadNotificationCount, getNotifications } from '~/server/api/notifications'
import { getReservations } from '~/server/api/reservations'
import { getTrainingStatus } from '~/server/api/training'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) =>
    createElement('a', { ...props, href: to ?? '#' }, children),
}))

vi.mock('~/server/api/admin', () => ({
  cancelCheckoutAppointment: vi.fn(),
  finalizeCheckoutMeeting: vi.fn(),
  getPendingCheckoutCount: vi.fn(),
  getPendingCheckouts: vi.fn(),
  getPendingReservationRequestCount: vi.fn(),
  getPendingReservationRequests: vi.fn(),
  moderateCheckoutRequest: vi.fn(),
  moderateReservationRequest: vi.fn(),
}))

vi.mock('~/server/api/machines', () => ({
  getMachines: vi.fn(),
  getMyUpcomingCheckoutAppointments: vi.fn(),
}))

vi.mock('~/server/api/notifications', () => ({
  getMyUnreadNotificationCount: vi.fn(),
  getNotifications: vi.fn(),
}))

vi.mock('~/server/api/reservations', () => ({
  getReservations: vi.fn(),
}))

vi.mock('~/server/api/training', () => ({
  getTrainingStatus: vi.fn(),
}))

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(_url: string) {}

  close() {}
}

function buildBookingRequest() {
  return {
    id: 'reservation-1',
    createdAt: new Date('2026-03-01T18:00:00Z'),
    startTime: new Date('2026-03-03T18:00:00Z'),
    endTime: new Date('2026-03-03T19:00:00Z'),
    status: 'pending' as const,
    decisionReason: null,
    reviewNotes: null,
    updatedAt: new Date('2026-03-01T18:00:00Z'),
    reviewer: null,
    user: {
      id: 'member-1',
      email: 'pat@example.com',
      name: 'Pat Pending',
    },
    machine: {
      id: 'machine-1',
      name: 'CNC Router',
    },
  }
}

function buildPendingCheckout() {
  return {
    appointmentId: 'checkout-pending-1',
    createdAt: new Date('2026-03-02T17:00:00Z'),
    startTime: new Date('2026-03-03T20:00:00Z'),
    endTime: new Date('2026-03-03T20:30:00Z'),
    status: 'pending' as const,
    decisionReason: null,
    reviewedAt: null,
    reviewer: null,
    manager: {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
    },
    user: {
      id: 'member-2',
      email: 'alex@example.com',
      name: 'Alex Checkout',
    },
    machine: {
      id: 'machine-2',
      name: 'Laser Cutter',
    },
  }
}

function buildAcceptedCheckout(startTime: Date) {
  return {
    appointmentId: 'checkout-accepted-1',
    createdAt: new Date('2026-03-02T17:30:00Z'),
    startTime,
    endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
    status: 'accepted' as const,
    decisionReason: null,
    reviewedAt: new Date('2026-03-02T18:00:00Z'),
    reviewer: {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
    },
    manager: {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
    },
    user: {
      id: 'member-3',
      email: 'jordan@example.com',
      name: 'Jordan Accepted',
    },
    machine: {
      id: 'machine-3',
      name: '3D Printer',
    },
  }
}

describe('Dashboard', () => {
  const renderDashboard = (role: 'manager' | 'admin' = 'manager') => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    const user = userEvent.setup()

    return {
      user,
      queryClient,
      ...render(
        <QueryClientProvider client={queryClient}>
          <Dashboard
            user={{
              id: 'manager-user',
              email: 'manager@example.com',
              name: null,
              role,
            }}
          />
        </QueryClientProvider>,
      ),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource

    vi.mocked(getNotifications).mockResolvedValue({ notifications: [] })
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [],
    } as Awaited<ReturnType<typeof getPendingCheckouts>>)
    vi.mocked(getPendingReservationRequests).mockResolvedValue({
      requests: [],
    } as Awaited<ReturnType<typeof getPendingReservationRequests>>)

    vi.mocked(moderateReservationRequest).mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<typeof moderateReservationRequest>>)
    vi.mocked(moderateCheckoutRequest).mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<typeof moderateCheckoutRequest>>)
    vi.mocked(finalizeCheckoutMeeting).mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<typeof finalizeCheckoutMeeting>>)
    vi.mocked(cancelCheckoutAppointment).mockResolvedValue({
      success: true,
    } as Awaited<ReturnType<typeof cancelCheckoutAppointment>>)

    vi.mocked(getMyUnreadNotificationCount).mockResolvedValue({ count: 0 })
    vi.mocked(getTrainingStatus).mockResolvedValue({
      totalModules: 0,
      completedModules: 0,
      overallProgress: 0,
      modules: [],
    })
    vi.mocked(getReservations).mockResolvedValue({ reservations: [] })
    vi.mocked(getMachines).mockResolvedValue({
      user: {
        id: 'manager-user',
        email: 'manager@example.com',
        name: null,
        role: 'manager',
      },
      machines: [],
    })
    vi.mocked(getPendingCheckoutCount).mockResolvedValue({ count: 0 })
    vi.mocked(getPendingReservationRequestCount).mockResolvedValue({ count: 0 })
    vi.mocked(getMyUpcomingCheckoutAppointments).mockResolvedValue({
      appointments: [],
    })
  })

  it('only fetches notifications for members in phase 1', async () => {
    renderDashboard()

    expect(
      await screen.findByRole('heading', { name: 'Action Queue' }),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(getNotifications).toHaveBeenCalledTimes(1)
    })

    expect(getMyUnreadNotificationCount).not.toHaveBeenCalled()
    expect(getTrainingStatus).not.toHaveBeenCalled()
    expect(getReservations).not.toHaveBeenCalled()
    expect(getMachines).not.toHaveBeenCalled()
    expect(getMyUpcomingCheckoutAppointments).not.toHaveBeenCalled()
    expect(getPendingCheckoutCount).not.toHaveBeenCalled()
    expect(getPendingCheckouts).not.toHaveBeenCalled()
    expect(getPendingReservationRequestCount).not.toHaveBeenCalled()
    expect(getPendingReservationRequests).not.toHaveBeenCalled()
    expect(
      await screen.findByText('No unread operational alerts.'),
    ).toBeInTheDocument()
  })

  it('only fetches admin action queue queries for admins in phase 1', async () => {
    renderDashboard('admin')

    await waitFor(() => {
      expect(getPendingCheckouts).toHaveBeenCalledTimes(1)
      expect(getPendingReservationRequests).toHaveBeenCalledTimes(1)
    })

    expect(getNotifications).not.toHaveBeenCalled()
    expect(getMyUnreadNotificationCount).not.toHaveBeenCalled()
    expect(getTrainingStatus).not.toHaveBeenCalled()
    expect(getReservations).not.toHaveBeenCalled()
    expect(getMachines).not.toHaveBeenCalled()
    expect(getMyUpcomingCheckoutAppointments).not.toHaveBeenCalled()
    expect(getPendingCheckoutCount).not.toHaveBeenCalled()
    expect(getPendingReservationRequestCount).not.toHaveBeenCalled()
  })

  it('submits booking approval from the inline action editor', async () => {
    vi.mocked(getPendingReservationRequests).mockResolvedValue({
      requests: [buildBookingRequest()],
    } as unknown as Awaited<ReturnType<typeof getPendingReservationRequests>>)

    const { user } = renderDashboard('admin')
    const bookingCard = (await screen.findByText('CNC Router')).closest('article')

    expect(bookingCard).not.toBeNull()

    await user.click(
      within(bookingCard as HTMLElement).getByRole('button', { name: 'Approve' }),
    )

    expect(
      within(bookingCard as HTMLElement).getByText('Approve booking request'),
    ).toBeInTheDocument()

    await user.click(
      within(bookingCard as HTMLElement).getByRole('button', {
        name: 'Confirm approval',
      }),
    )

    await waitFor(() => {
      expect(moderateReservationRequest).toHaveBeenCalledWith({
        data: {
          reservationId: 'reservation-1',
          decision: 'approve',
          reason: undefined,
        },
      })
    })
  })

  it('allows optional booking denial reasons in the inline editor', async () => {
    vi.mocked(getPendingReservationRequests).mockResolvedValue({
      requests: [buildBookingRequest()],
    } as unknown as Awaited<ReturnType<typeof getPendingReservationRequests>>)

    const { user } = renderDashboard('admin')
    const bookingCard = (await screen.findByText('CNC Router')).closest('article')

    expect(bookingCard).not.toBeNull()

    await user.click(
      within(bookingCard as HTMLElement).getByRole('button', { name: 'Deny' }),
    )

    expect(
      within(bookingCard as HTMLElement).getByLabelText('Denial reason'),
    ).toBeInTheDocument()

    await user.click(
      within(bookingCard as HTMLElement).getByRole('button', {
        name: 'Submit denial',
      }),
    )

    await waitFor(() => {
      expect(moderateReservationRequest).toHaveBeenCalledWith({
        data: {
          reservationId: 'reservation-1',
          decision: 'reject',
          reason: undefined,
        },
      })
    })
  })

  it('requires a checkout denial reason before submitting', async () => {
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [{ appointmentId: 'checkout-pending-1' }],
      actionableAppointments: [buildPendingCheckout()],
    } as Awaited<ReturnType<typeof getPendingCheckouts>>)

    const { user } = renderDashboard('admin')
    const checkoutCard = (await screen.findByText('Laser Cutter')).closest('article')

    expect(checkoutCard).not.toBeNull()

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', { name: 'Deny' }),
    )

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Submit denial',
      }),
    )

    expect(moderateCheckoutRequest).not.toHaveBeenCalled()
    expect(
      within(checkoutCard as HTMLElement).getByText(
        'Denial reason is required for checkout requests.',
      ),
    ).toBeInTheDocument()

    await user.type(
      within(checkoutCard as HTMLElement).getByLabelText('Denial reason'),
      'Needs machine orientation',
    )
    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Submit denial',
      }),
    )

    await waitFor(() => {
      expect(moderateCheckoutRequest).toHaveBeenCalledWith({
        data: {
          appointmentId: 'checkout-pending-1',
          decision: 'reject',
          reason: 'Needs machine orientation',
        },
      })
    })
  })

  it('requires explicit confirmation before recording a future pass result', async () => {
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [
        buildAcceptedCheckout(new Date('2099-03-03T20:00:00Z')),
      ],
    } as Awaited<ReturnType<typeof getPendingCheckouts>>)

    const { user } = renderDashboard('admin')
    const checkoutCard = (await screen.findByText('3D Printer')).closest('article')

    expect(checkoutCard).not.toBeNull()

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', { name: 'Pass' }),
    )

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Record pass',
      }),
    )

    expect(finalizeCheckoutMeeting).not.toHaveBeenCalled()
    expect(
      within(checkoutCard as HTMLElement).getByText(
        'Confirm recording a pass result before the meeting starts.',
      ),
    ).toBeInTheDocument()

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('checkbox'),
    )
    await user.type(
      within(checkoutCard as HTMLElement).getByLabelText('Pass notes'),
      'Ready to operate solo',
    )
    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Record pass',
      }),
    )

    await waitFor(() => {
      expect(finalizeCheckoutMeeting).toHaveBeenCalledWith({
        data: {
          appointmentId: 'checkout-accepted-1',
          result: 'pass',
          notes: 'Ready to operate solo',
        },
      })
    })
  })

  it('submits fail notes from the inline editor', async () => {
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [
        buildAcceptedCheckout(new Date('2026-03-03T20:00:00Z')),
      ],
    } as Awaited<ReturnType<typeof getPendingCheckouts>>)

    const { user } = renderDashboard('admin')
    const checkoutCard = (await screen.findByText('3D Printer')).closest('article')

    expect(checkoutCard).not.toBeNull()

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', { name: 'Fail' }),
    )
    await user.type(
      within(checkoutCard as HTMLElement).getByLabelText('Fail notes'),
      'Needs another supervised session',
    )
    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Record fail',
      }),
    )

    await waitFor(() => {
      expect(finalizeCheckoutMeeting).toHaveBeenCalledWith({
        data: {
          appointmentId: 'checkout-accepted-1',
          result: 'fail',
          notes: 'Needs another supervised session',
        },
      })
    })
  })

  it('requires a cancellation reason before cancelling an accepted checkout', async () => {
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [
        buildAcceptedCheckout(new Date('2026-03-03T20:00:00Z')),
      ],
    } as Awaited<ReturnType<typeof getPendingCheckouts>>)

    const { user } = renderDashboard('admin')
    const checkoutCard = (await screen.findByText('3D Printer')).closest('article')

    expect(checkoutCard).not.toBeNull()

    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', { name: 'Cancel' }),
    )
    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Confirm cancellation',
      }),
    )

    expect(cancelCheckoutAppointment).not.toHaveBeenCalled()
    expect(
      within(checkoutCard as HTMLElement).getByText(
        'Cancellation reason is required.',
      ),
    ).toBeInTheDocument()

    await user.type(
      within(checkoutCard as HTMLElement).getByLabelText('Cancellation reason'),
      'Manager unavailable',
    )
    await user.click(
      within(checkoutCard as HTMLElement).getByRole('button', {
        name: 'Confirm cancellation',
      }),
    )

    await waitFor(() => {
      expect(cancelCheckoutAppointment).toHaveBeenCalledWith({
        data: {
          appointmentId: 'checkout-accepted-1',
          reason: 'Manager unavailable',
        },
      })
    })
  })
})
