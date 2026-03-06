/** @vitest-environment jsdom */

import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import {
  cancelCheckoutAppointment,
  finalizeCheckoutMeeting,
  moderateCheckoutRequest,
} from '~/server/api/admin'

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
    vi.clearAllMocks()

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

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('removes finalized appointments from the pending checkouts cache optimistically', async () => {
    vi.mocked(finalizeCheckoutMeeting).mockResolvedValue({
      success: true,
      data: {
        appointment: {} as never,
        checkoutGranted: false,
      },
    } as Awaited<ReturnType<typeof finalizeCheckoutMeeting>>)

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

    queryClient.setQueryData(queryKeys.admin.pendingCheckouts(), {
      pendingApprovals: [
        { appointmentId: 'accepted-1' },
        { appointmentId: 'pending-1' },
      ],
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckoutsPage />
      </QueryClientProvider>
    )

    await screen.findByRole('heading', { name: 'Checkout Request Queue' })
    await user.click(screen.getByRole('button', { name: 'Accepted' }))
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.click(screen.getByRole('button', { name: 'Record pass' }))

    await waitFor(() => {
      expect(finalizeCheckoutMeeting).toHaveBeenCalledWith({
        data: {
          appointmentId: 'accepted-1',
          result: 'pass',
          notes: undefined,
        },
      })
    })

    expect(queryClient.getQueryData(queryKeys.admin.pendingCheckouts())).toEqual({
      pendingApprovals: [{ appointmentId: 'pending-1' }],
    })
  })

  it('removes cancelled appointments from the pending checkouts cache optimistically', async () => {
    vi.mocked(cancelCheckoutAppointment).mockResolvedValue({
      success: true,
      data: {} as never,
    } as Awaited<ReturnType<typeof cancelCheckoutAppointment>>)

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

    queryClient.setQueryData(queryKeys.admin.pendingCheckouts(), {
      pendingApprovals: [
        { appointmentId: 'accepted-1' },
        { appointmentId: 'pending-1' },
      ],
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckoutsPage />
      </QueryClientProvider>
    )

    await screen.findByRole('heading', { name: 'Checkout Request Queue' })
    await user.click(screen.getByRole('button', { name: 'Accepted' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.type(
      screen.getByLabelText('Cancellation reason'),
      'Manager unavailable'
    )
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }))

    await waitFor(() => {
      expect(cancelCheckoutAppointment).toHaveBeenCalledWith({
        data: {
          appointmentId: 'accepted-1',
          reason: 'Manager unavailable',
        },
      })
    })

    expect(queryClient.getQueryData(queryKeys.admin.pendingCheckouts())).toEqual({
      pendingApprovals: [{ appointmentId: 'pending-1' }],
    })
  })

  it('requires an inline rejection reason before rejecting a request', async () => {
    vi.mocked(moderateCheckoutRequest).mockResolvedValue({
      success: true,
      data: {} as never,
    } as Awaited<ReturnType<typeof moderateCheckoutRequest>>)

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

    await screen.findByRole('heading', { name: 'Checkout Request Queue' })
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.click(screen.getByRole('button', { name: 'Submit rejection' }))

    expect(screen.getByText('Rejection reason is required.')).toBeInTheDocument()
    expect(moderateCheckoutRequest).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText('Rejection reason'),
      'Missing prerequisite'
    )
    await user.click(screen.getByRole('button', { name: 'Submit rejection' }))

    await waitFor(() => {
      expect(moderateCheckoutRequest).toHaveBeenCalledWith({
        data: {
          appointmentId: 'pending-1',
          decision: 'reject',
          reason: 'Missing prerequisite',
        },
      })
    })
  })

  it('requires inline confirmation before finalizing a future meeting early', async () => {
    checkoutsData.checkoutQueue[1] = {
      ...checkoutsData.checkoutQueue[1],
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }

    vi.mocked(finalizeCheckoutMeeting).mockResolvedValue({
      success: true,
      data: {
        appointment: {} as never,
        checkoutGranted: false,
      },
    } as Awaited<ReturnType<typeof finalizeCheckoutMeeting>>)

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

    await screen.findByRole('heading', { name: 'Checkout Request Queue' })
    await user.click(screen.getByRole('button', { name: 'Accepted' }))
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.click(screen.getByRole('button', { name: 'Record pass' }))

    expect(
      screen.getByText('Confirm recording a pass result before the meeting starts.')
    ).toBeInTheDocument()
    expect(finalizeCheckoutMeeting).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Confirm recording this result before the meeting starts.',
      })
    )
    await user.click(screen.getByRole('button', { name: 'Record pass' }))

    await waitFor(() => {
      expect(finalizeCheckoutMeeting).toHaveBeenCalledWith({
        data: {
          appointmentId: 'accepted-1',
          result: 'pass',
          notes: undefined,
        },
      })
    })
  })
})
