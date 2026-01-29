import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { eq, and, gte, desc } from 'drizzle-orm'
import { useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, reservations } from '~/lib/db'
import { Header } from '~/components/Header'
import { cancelReservation } from '~/server/api/reservations'

const getReservationsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()

  const userReservations = await db.query.reservations.findMany({
    where: eq(reservations.userId, user.id),
    with: {
      machine: true,
    },
    orderBy: [desc(reservations.startTime)],
  })

  return { user, reservations: userReservations }
})

export const Route = createFileRoute('/reservations/')({
  component: ReservationsPage,
  loader: async () => {
    return await getReservationsData()
  },
})

function ReservationsPage() {
  const { user, reservations: initialReservations } = Route.useLoaderData()
  const [reservationsList, setReservationsList] = useState(initialReservations)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const handleCancel = async (reservationId: string) => {
    if (!confirm('Are you sure you want to cancel this reservation?')) return

    setCancelling(reservationId)

    try {
      const result = await cancelReservation({ data: { reservationId } })

      if (result.success) {
        setReservationsList((prev) =>
          prev.map((r) =>
            r.id === reservationId ? { ...r, status: 'cancelled' as const } : r
          )
        )
      } else {
        alert(result.error || 'Failed to cancel reservation')
      }
    } catch (error) {
      alert('An error occurred')
    } finally {
      setCancelling(null)
    }
  }

  const upcomingReservations = reservationsList.filter(
    (r) => r.status === 'confirmed' && new Date(r.startTime) > new Date()
  )

  const pastReservations = reservationsList.filter(
    (r) => r.status !== 'confirmed' || new Date(r.startTime) <= new Date()
  )

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="flex flex-between flex-center mb-3">
            <h1>My Reservations</h1>
            <Link to="/machines" className="btn btn-primary">
              New Reservation
            </Link>
          </div>

          {/* Upcoming Reservations */}
          <h2 className="mb-2">Upcoming</h2>
          {upcomingReservations.length > 0 ? (
            <div className="grid grid-2 mb-3">
              {upcomingReservations.map((reservation) => (
                <div key={reservation.id} className="card">
                  <div className="card-header">
                    <h3 className="card-title">{reservation.machine.name}</h3>
                    <span className="badge badge-success">Confirmed</span>
                  </div>

                  <p className="text-small mb-1">
                    <strong>Start:</strong> {formatDateTime(reservation.startTime)}
                  </p>
                  <p className="text-small mb-2">
                    <strong>End:</strong> {formatDateTime(reservation.endTime)}
                  </p>

                  <button
                    className="btn btn-danger"
                    onClick={() => handleCancel(reservation.id)}
                    disabled={cancelling === reservation.id}
                  >
                    {cancelling === reservation.id ? 'Cancelling...' : 'Cancel'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card mb-3">
              <p className="text-center text-muted">No upcoming reservations.</p>
              <div className="text-center mt-2">
                <Link to="/machines" className="btn btn-primary">
                  Browse Machines
                </Link>
              </div>
            </div>
          )}

          {/* Past / Cancelled Reservations */}
          {pastReservations.length > 0 && (
            <>
              <h2 className="mb-2">Past & Cancelled</h2>
              <div className="card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Machine</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastReservations.map((reservation) => (
                      <tr key={reservation.id}>
                        <td>{reservation.machine.name}</td>
                        <td className="text-small">
                          {formatDateTime(reservation.startTime)}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              reservation.status === 'cancelled'
                                ? 'badge-danger'
                                : reservation.status === 'completed'
                                  ? 'badge-success'
                                  : 'badge-info'
                            }`}
                          >
                            {reservation.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
