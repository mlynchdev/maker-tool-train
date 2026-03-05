/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
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
  getPendingCheckoutCount: vi.fn(),
  getPendingCheckouts: vi.fn(),
  getPendingReservationRequestCount: vi.fn(),
  getPendingReservationRequests: vi.fn(),
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
    vi.mocked(getPendingCheckouts).mockResolvedValue({ pendingApprovals: [] })
    vi.mocked(getPendingReservationRequestCount).mockResolvedValue({ count: 0 })
    vi.mocked(getPendingReservationRequests).mockResolvedValue({ requests: [] })
    vi.mocked(getMyUpcomingCheckoutAppointments).mockResolvedValue({ appointments: [] })
  })

  it('does not crash when upcoming checkout payload omits appointments', async () => {
    vi.mocked(getMyUpcomingCheckoutAppointments).mockResolvedValue(
      {} as Awaited<ReturnType<typeof getMyUpcomingCheckoutAppointments>>
    )

    render(
      <Dashboard
        user={{
          id: 'manager-user',
          email: 'manager@example.com',
          name: null,
          role: 'manager',
        }}
      />
    )

    await waitFor(() => {
      expect(getMyUpcomingCheckoutAppointments).toHaveBeenCalled()
    })

    expect(await screen.findByText('Main Dashboard')).toBeInTheDocument()
    expect(
      await screen.findByText('No upcoming events scheduled in the next three weeks.')
    ).toBeInTheDocument()
  })
})
