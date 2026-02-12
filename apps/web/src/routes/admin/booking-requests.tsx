import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq, ne } from 'drizzle-orm'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { Header } from '~/components/Header'
import { db, reservations } from '~/lib/db'
import { parseSSEMessage } from '~/lib/sse'
import { moderateReservationRequest } from '~/server/api/admin'
import { markMyNotificationRead } from '~/server/api/notifications'
import { requireAdmin } from '~/server/auth/middleware'
import { getNotificationsForUser } from '~/server/services/notifications'

const bookingRequestViews = ['pending', 'history', 'all'] as const
type BookingRequestView = (typeof bookingRequestViews)[number]

const bookingRequestSearchSchema = z.object({
  view: z.enum(bookingRequestViews).optional(),
  q: z.string().optional(),
})

function parseBookingRequestSearch(search: Record<string, unknown>): {
  view: BookingRequestView
  q: string
} {
  const parsed = bookingRequestSearchSchema.safeParse(search)
  if (!parsed.success) {
    return { view: 'pending', q: '' }
  }

  return {
    view: parsed.data.view || 'pending',
    q: parsed.data.q || '',
  }
}

const getBookingRequestsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAdmin()

  const [pendingRequests, recentDecisions, unreadNotifications] = await Promise.all([
    db.query.reservations.findMany({
      where: eq(reservations.status, 'pending'),
      with: {
        user: true,
        machine: true,
        reviewer: true,
      },
      orderBy: [asc(reservations.startTime)],
    }),
    db.query.reservations.findMany({
      where: ne(reservations.status, 'pending'),
      with: {
        user: true,
        machine: true,
        reviewer: true,
      },
      orderBy: [desc(reservations.reviewedAt), desc(reservations.updatedAt)],
      limit: 150,
    }),
    getNotificationsForUser(user.id, true, 75),
  ])

  const bookingNotifications = unreadNotifications.filter(
    (notification) => notification.type === 'booking_requested'
  )

  return { user, pendingRequests, recentDecisions, bookingNotifications }
})

export const Route = createFileRoute('/admin/booking-requests')({
  validateSearch: (search) =>
    parseBookingRequestSearch(search as Record<string, unknown>),
  component: BookingRequestsPage,
  loader: async () => {
    return await getBookingRequestsData()
  },
})

type BookingRequestsData = Awaited<ReturnType<typeof getBookingRequestsData>>
type RequestRecord = BookingRequestsData['pendingRequests'][number]
type DecisionInputState = Record<string, { reason: string; notes: string }>

function getStatusBadgeClass(status: string) {
  if (status === 'approved' || status === 'confirmed' || status === 'completed') {
    return 'badge-success'
  }
  if (status === 'pending') return 'badge-warning'
  if (status === 'rejected' || status === 'cancelled') return 'badge-danger'
  return 'badge-info'
}

function matchesSearchQuery(request: RequestRecord, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const parts = [
    request.machine.name,
    request.user.name || '',
    request.user.email,
    request.status,
    request.decisionReason || '',
    request.reviewNotes || '',
    request.reviewer?.name || '',
    request.reviewer?.email || '',
  ]

  return parts.some((value) => value.toLowerCase().includes(query))
}

function BookingRequestsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/admin/booking-requests' })
  const {
    user,
    pendingRequests: initialPendingRequests,
    recentDecisions: initialRecentDecisions,
    bookingNotifications: initialNotifications,
  } = Route.useLoaderData()

  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests)
  const [recentDecisions, setRecentDecisions] = useState(initialRecentDecisions)
  const [bookingNotifications, setBookingNotifications] = useState(initialNotifications)
  const [decisionInputs, setDecisionInputs] = useState<DecisionInputState>({})
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null)
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null)
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  const formatDuration = (start: Date, end: Date) => {
    const minutes = Math.max(0, Math.round((+new Date(end) - +new Date(start)) / 60000))
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60

    if (hours === 0) return `${remainingMinutes}m`
    if (remainingMinutes === 0) return `${hours}h`
    return `${hours}h ${remainingMinutes}m`
  }

  const activeView = search.view
  const searchQuery = search.q

  const updateSearch = useCallback(
    (next: Partial<{ view: BookingRequestView; q: string }>) => {
      navigate({
        search: (prev) => ({
          ...prev,
          ...next,
        }),
        replace: true,
      })
    },
    [navigate]
  )

  const filteredPending = useMemo(
    () => pendingRequests.filter((request) => matchesSearchQuery(request, searchQuery)),
    [pendingRequests, searchQuery]
  )
  const filteredHistory = useMemo(
    () => recentDecisions.filter((request) => matchesSearchQuery(request, searchQuery)),
    [recentDecisions, searchQuery]
  )

  const refreshRequests = useCallback(async () => {
    setRefreshing(true)
    try {
      const latest = await getBookingRequestsData()
      setPendingRequests(latest.pendingRequests)
      setRecentDecisions(latest.recentDecisions)
      setBookingNotifications(latest.bookingNotifications)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const updateDecisionInput = (
    reservationId: string,
    field: 'reason' | 'notes',
    value: string
  ) => {
    setDecisionInputs((prev) => {
      const current = prev[reservationId] || { reason: '', notes: '' }
      return {
        ...prev,
        [reservationId]: {
          ...current,
          [field]: value,
        },
      }
    })
  }

  const handleModeration = async (
    reservationId: string,
    decision: 'approve' | 'reject' | 'cancel'
  ) => {
    setProcessingRequestId(reservationId)
    const input = decisionInputs[reservationId]
    const reason = input?.reason.trim()
    const notes = input?.notes.trim()

    try {
      const result = await moderateReservationRequest({
        data: {
          reservationId,
          decision,
          reason: reason || undefined,
          notes: notes || undefined,
        },
      })

      if (!result.success) {
        alert(result.error || 'Failed to update request')
        return
      }

      setDecisionInputs((prev) => {
        if (!prev[reservationId]) return prev
        const next = { ...prev }
        delete next[reservationId]
        return next
      })

      await refreshRequests()
    } catch {
      alert('An error occurred while processing the request')
    } finally {
      setProcessingRequestId(null)
    }
  }

  const handleMarkNotificationRead = async (notificationId: string) => {
    setMarkingNotificationId(notificationId)
    try {
      const result = await markMyNotificationRead({ data: { notificationId } })
      if (!result.success) return

      setBookingNotifications((prev) =>
        prev.filter((notification) => notification.id !== notificationId)
      )
    } finally {
      setMarkingNotificationId(null)
    }
  }

  const handleMarkAllNotificationsRead = async () => {
    if (bookingNotifications.length === 0) return
    setMarkingAllNotifications(true)

    try {
      await Promise.all(
        bookingNotifications.map((notification) =>
          markMyNotificationRead({ data: { notificationId: notification.id } })
        )
      )
      setBookingNotifications([])
    } finally {
      setMarkingAllNotifications(false)
    }
  }

  useEffect(() => {
    const source = new EventSource('/api/sse/bookings')

    source.onmessage = (event) => {
      const message = parseSSEMessage(event.data)
      if (!message) return
      if (message.type === 'connected') return

      if (message.event === 'booking' || message.event === 'notification') {
        refreshRequests()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [refreshRequests])

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div
            className="flex flex-between flex-center mb-2"
            style={{ flexWrap: 'wrap', gap: '0.75rem' }}
          >
            <h1>Booking Requests</h1>
            <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
              <span className="badge badge-warning">{pendingRequests.length} pending</span>
              <span className="badge badge-info">{recentDecisions.length} recent decisions</span>
            </div>
          </div>

          <div className="card mb-3">
            <div className="form-group">
              <label className="form-label">Search Queue</label>
              <input
                type="text"
                className="form-input"
                placeholder="Member, resource, status, notes, reviewer"
                value={searchQuery}
                onChange={(event) => updateSearch({ q: event.target.value })}
              />
            </div>
            <div className="booking-request-actions">
              <button
                className={`btn ${activeView === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSearch({ view: 'pending' })}
              >
                Pending
              </button>
              <button
                className={`btn ${activeView === 'history' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSearch({ view: 'history' })}
              >
                Review History
              </button>
              <button
                className={`btn ${activeView === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateSearch({ view: 'all' })}
              >
                All
              </button>
              <button className="btn btn-secondary" onClick={refreshRequests} disabled={refreshing}>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => updateSearch({ view: 'pending', q: '' })}
              >
                Reset Filters
              </button>
            </div>
            <p className="text-small text-muted mt-1">
              Showing {filteredPending.length} pending and {filteredHistory.length} reviewed
              results.
            </p>
          </div>

          <div className="card mb-3">
            <div className="card-header">
              <h3 className="card-title">Request Alerts</h3>
              {bookingNotifications.length > 0 && (
                <button
                  className="btn btn-secondary"
                  onClick={handleMarkAllNotificationsRead}
                  disabled={markingAllNotifications}
                >
                  {markingAllNotifications ? 'Saving...' : 'Mark all read'}
                </button>
              )}
            </div>

            {bookingNotifications.length > 0 ? (
              <div className="grid">
                {bookingNotifications.map((notification) => (
                  <div key={notification.id} className="booking-request-card">
                    <div className="booking-request-head">
                      <span className="badge badge-info">New request</span>
                      <span className="text-small text-muted">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="booking-request-title">{notification.title}</p>
                    <p className="text-small text-muted">{notification.message}</p>
                    <div className="booking-request-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleMarkNotificationRead(notification.id)}
                        disabled={markingNotificationId === notification.id}
                      >
                        {markingNotificationId === notification.id ? 'Saving...' : 'Mark read'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-small text-muted">No unread booking alerts.</p>
            )}
          </div>

          {(activeView === 'pending' || activeView === 'all') && (
            <>
              <h2 className="mb-2">Pending Queue</h2>
              {filteredPending.length > 0 ? (
                <div className="grid mb-3">
                  {filteredPending.map((request) => (
                    <div key={request.id} className="booking-request-card">
                      <div className="booking-request-head">
                        <span className="badge badge-warning">Pending</span>
                        <span className="text-small text-muted">
                          Requested {formatDateTime(request.createdAt)}
                        </span>
                      </div>

                      <p className="booking-request-title">{request.machine.name}</p>
                      <p className="text-small mb-1">
                        <strong>Member:</strong> {request.user.name || request.user.email}
                      </p>
                      <p className="text-small mb-1">
                        <strong>Start:</strong> {formatDateTime(request.startTime)}
                      </p>
                      <p className="text-small mb-1">
                        <strong>End:</strong> {formatDateTime(request.endTime)}
                      </p>
                      <p className="text-small text-muted mb-2">
                        Duration: {formatDuration(request.startTime, request.endTime)}
                      </p>

                      <div className="form-group">
                        <label className="form-label">Decision Reason (member-visible)</label>
                        <input
                          type="text"
                          className="form-input"
                          value={decisionInputs[request.id]?.reason || ''}
                          onChange={(event) =>
                            updateDecisionInput(request.id, 'reason', event.target.value)
                          }
                          placeholder="Reason for approval/rejection/cancellation"
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">Internal Notes (optional)</label>
                        <input
                          type="text"
                          className="form-input"
                          value={decisionInputs[request.id]?.notes || ''}
                          onChange={(event) =>
                            updateDecisionInput(request.id, 'notes', event.target.value)
                          }
                          placeholder="Internal moderation notes"
                        />
                      </div>

                      <div className="booking-request-actions">
                        <button
                          className="btn btn-success"
                          onClick={() => handleModeration(request.id, 'approve')}
                          disabled={processingRequestId === request.id || refreshing}
                        >
                          {processingRequestId === request.id ? 'Saving...' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => handleModeration(request.id, 'reject')}
                          disabled={processingRequestId === request.id || refreshing}
                        >
                          Reject
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleModeration(request.id, 'cancel')}
                          disabled={processingRequestId === request.id || refreshing}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card mb-3">
                  <p className="text-center text-muted">No pending booking requests.</p>
                </div>
              )}
            </>
          )}

          {(activeView === 'history' || activeView === 'all') && (
            <>
              <h2 className="mb-2">Review History</h2>
              {filteredHistory.length > 0 ? (
                <div className="grid">
                  {filteredHistory.map((request) => (
                    <div key={request.id} className="booking-request-card">
                      <div className="booking-request-head">
                        <span className={`badge ${getStatusBadgeClass(request.status)}`}>
                          {request.status}
                        </span>
                        <span className="text-small text-muted">
                          Reviewed{' '}
                          {request.reviewedAt
                            ? formatDateTime(request.reviewedAt)
                            : formatDateTime(request.updatedAt)}
                        </span>
                      </div>

                      <p className="booking-request-title">{request.machine.name}</p>
                      <p className="text-small mb-1">
                        <strong>Member:</strong> {request.user.name || request.user.email}
                      </p>
                      <p className="text-small mb-1">
                        <strong>Start:</strong> {formatDateTime(request.startTime)}
                      </p>
                      <p className="text-small mb-1">
                        <strong>End:</strong> {formatDateTime(request.endTime)}
                      </p>
                      <p className="text-small mb-1">
                        <strong>Duration:</strong> {formatDuration(request.startTime, request.endTime)}
                      </p>
                      <p className="text-small mb-1">
                        <strong>Reviewed By:</strong>{' '}
                        {request.reviewer?.name || request.reviewer?.email || 'Member/System'}
                      </p>
                      {request.decisionReason && (
                        <p className="text-small mb-1">
                          <strong>Reason:</strong> {request.decisionReason}
                        </p>
                      )}
                      {request.reviewNotes && (
                        <p className="text-small text-muted">
                          <strong>Internal Notes:</strong> {request.reviewNotes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card">
                  <p className="text-center text-muted">No reviewed reservations found.</p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
