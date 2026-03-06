/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let checkoutsData: {
  user: { id: string; email: string; name: string | null; role: string }
  makerspaceTimezone: string
  checkoutQueue: Array<{
    id: string
    status: 'pending' | 'accepted' | 'rejected'
    decisionReason: string | null
    startTime: Date
    manager: { name: string | null; email: string }
    machine: { name: string }
    reviewer?: { name: string | null; email: string } | null
    user: { name: string | null; email: string }
  }>
  checkoutAvailabilityRules: Array<{
    id: string
    active: boolean
    dayOfWeek: number
    startMinuteOfDay: number
    endMinuteOfDay: number
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
    handler: () => vi.fn(async () => checkoutsData),
  }),
}))

vi.mock('~/lib/db', () => ({
  checkoutAppointments: {},
  db: {},
}))

vi.mock('~/server/api/admin', () => ({
  cancelCheckoutAppointment: vi.fn(),
  createCheckoutAvailabilityBlock: vi.fn(),
  deactivateCheckoutAvailabilityBlock: vi.fn(),
  finalizeCheckoutMeeting: vi.fn(),
  moderateCheckoutRequest: vi.fn(),
}))

describe('admin checkouts route', () => {
  beforeEach(() => {
    checkoutsData = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      },
      makerspaceTimezone: 'UTC',
      checkoutQueue: [
        {
          id: 'pending-1',
          status: 'pending',
          decisionReason: null,
          startTime: new Date('2026-03-01T18:00:00.000Z'),
          machine: { name: 'CNC Router' },
          manager: { name: 'Morgan Manager', email: 'morgan@example.com' },
          reviewer: null,
          user: { name: 'Pat Pending', email: 'pat@example.com' },
        },
        {
          id: 'accepted-1',
          status: 'accepted',
          decisionReason: null,
          startTime: new Date('2026-03-02T18:00:00.000Z'),
          machine: { name: 'Laser Cutter' },
          manager: { name: 'Avery Lead', email: 'avery@example.com' },
          reviewer: { name: 'Admin', email: 'admin@example.com' },
          user: { name: 'Alex Accepted', email: 'alex@example.com' },
        },
        {
          id: 'rejected-1',
          status: 'rejected',
          decisionReason: 'Missing prerequisite',
          startTime: new Date('2026-03-03T18:00:00.000Z'),
          machine: { name: 'Solder Station' },
          manager: { name: 'Jordan Supervisor', email: 'jordan@example.com' },
          reviewer: { name: 'Admin', email: 'admin@example.com' },
          user: { name: 'Riley Rejected', email: 'riley@example.com' },
        },
      ],
      checkoutAvailabilityRules: [],
    }
  })

  it('restores queue counts, filters, search, and booking shortcut link', async () => {
    const { Route } = await import('./checkouts')
    const CheckoutsPage = Route.options.component as () => ReactNode
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckoutsPage />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('heading', { name: 'Checkout Request Queue' })
    ).toBeInTheDocument()

    expect(screen.getByText('1 pending')).toBeInTheDocument()
    expect(screen.getByText('1 accepted')).toBeInTheDocument()
    expect(screen.getByText('1 rejected')).toBeInTheDocument()
    expect(screen.getByText('3 total')).toBeInTheDocument()

    expect(screen.getByText('CNC Router')).toBeInTheDocument()
    expect(screen.queryByText('Laser Cutter')).not.toBeInTheDocument()
    expect(screen.queryByText('Solder Station')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Laser Cutter')).toBeInTheDocument()
    expect(screen.getByText('Solder Station')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText(
      'Search member, machine, manager'
    )
    await user.clear(searchInput)
    await user.type(searchInput, 'jordan')

    await waitFor(() => {
      expect(screen.getByText('Solder Station')).toBeInTheDocument()
    })
    expect(screen.queryByText('CNC Router')).not.toBeInTheDocument()
    expect(screen.queryByText('Laser Cutter')).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.click(screen.getByRole('button', { name: 'Accepted' }))

    expect(screen.getByText('Laser Cutter')).toBeInTheDocument()
    expect(screen.queryByText('CNC Router')).not.toBeInTheDocument()
    expect(screen.queryByText('Solder Station')).not.toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: 'Open Booking Requests' })
    ).toHaveAttribute('href', '/admin/booking-requests')
  })
})
