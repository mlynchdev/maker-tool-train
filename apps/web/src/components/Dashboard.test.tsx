/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'
import {
  getPendingCheckoutCount,
  getPendingCheckouts,
  getPendingReservationRequestCount,
  getPendingReservationRequests,
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
  markAllMyNotificationsRead: vi.fn(),
  markMyNotificationRead: vi.fn(),
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

describe('Dashboard', () => {
  const renderDashboard = (role: 'manager' | 'admin' = 'manager') => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <Dashboard
          user={{
            id: 'manager-user',
            email: 'manager@example.com',
            name: null,
            role,
          }}
        />
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource

    vi.mocked(getMyUnreadNotificationCount).mockResolvedValue({ count: 0 })
    vi.mocked(getNotifications).mockResolvedValue({ notifications: [] })
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
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [],
    })
    vi.mocked(getPendingReservationRequestCount).mockResolvedValue({ count: 0 })
    vi.mocked(getPendingReservationRequests).mockResolvedValue({ requests: [] })
    vi.mocked(getMyUpcomingCheckoutAppointments).mockResolvedValue({ appointments: [] })
  })

  it('does not crash when upcoming checkout payload omits appointments', async () => {
    vi.mocked(getMyUpcomingCheckoutAppointments).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getMyUpcomingCheckoutAppointments>>
    )

    renderDashboard()

    await waitFor(() => {
      expect(getMyUpcomingCheckoutAppointments).toHaveBeenCalled()
    })

    expect(
      await screen.findByRole('heading', { name: 'Action Queue' })
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No queue items match your search.')
    ).toBeInTheDocument()
  })

  it('shows accepted checkout meetings as actionable items for admins', async () => {
    vi.mocked(getPendingCheckouts).mockResolvedValue({
      pendingApprovals: [],
      actionableAppointments: [
        {
          appointmentId: 'checkout-1',
          createdAt: new Date('2026-02-20T17:00:00Z'),
          startTime: new Date('2026-02-21T22:00:00Z'),
          endTime: new Date('2026-02-21T22:30:00Z'),
          status: 'accepted',
          decisionReason: null,
          reviewedAt: new Date('2026-02-20T18:00:00Z'),
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
            id: 'member-1',
            email: 'foo@bar.baz',
            name: 'asdf',
          },
          machine: {
            id: 'machine-1',
            name: '3D Printer',
          },
        },
      ],
    })

    renderDashboard('admin')

    expect(
      await screen.findByRole('heading', { name: 'Action Queue' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Checkout Accepted')).toBeInTheDocument()
    expect(await screen.findByText('3D Printer')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Pass' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Fail' })).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Cancel' }),
    ).toBeInTheDocument()
  })
})
