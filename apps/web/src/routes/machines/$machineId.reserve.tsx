import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useMemo, useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { getMachineBookingsInRange } from '~/server/services/booking-conflicts'
import { Header } from '~/components/Header'
import { reserveMachine } from '~/server/api/machines'

function formatDateTimeLocal(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDisplayDate(dateValue: Date | string) {
  return new Date(dateValue).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const getReserveData = createServerFn({ method: 'GET' })
  .inputValidator((data: { machineId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      throw new Response('Machine not found', { status: 404 })
    }

    const eligibility = await checkEligibility(user.id, data.machineId)

    const now = new Date()
    const horizon = new Date(now)
    horizon.setDate(horizon.getDate() + 14)

    const bookings = await getMachineBookingsInRange(machine.id, now, horizon)

    return { user, machine, bookings, eligibility }
  })

export const Route = createFileRoute('/machines/$machineId/reserve')({
  component: ReserveMachinePage,
  loader: async ({ params }) => {
    return await getReserveData({ data: { machineId: params.machineId } })
  },
})

function ReserveMachinePage() {
  const { user, machine, bookings, eligibility } = Route.useLoaderData()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const defaultRange = useMemo(() => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    return {
      start: formatDateTimeLocal(start),
      end: formatDateTimeLocal(end),
    }
  }, [])

  const [startTime, setStartTime] = useState(defaultRange.start)
  const [endTime, setEndTime] = useState(defaultRange.end)

  const handleReserve = async () => {
    const start = new Date(startTime)
    const end = new Date(endTime)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('Please select valid start and end times.')
      return
    }

    if (end <= start) {
      setError('End time must be after start time.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await reserveMachine({
        data: {
          machineId: machine.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      })

      if (result.success) {
        navigate({ to: '/reservations' })
      } else {
        const reasonText =
          result.reasons && result.reasons.length > 0
            ? ` (${result.reasons.join('; ')})`
            : ''
        setError((result.error || 'Failed to create reservation request') + reasonText)
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link
              to="/machines/$machineId"
              params={{ machineId: machine.id }}
              className="text-small"
            >
              &larr; Back to {machine.name}
            </Link>
          </div>

          <h1 className="mb-3">Request Time on {machine.name}</h1>

          {error && <div className="alert alert-danger mb-2">{error}</div>}

          <div className="card mb-2">
            <h3 className="card-title mb-2">Choose Start And End Time</h3>
            {eligibility.eligible ? (
              <>
                <div className="form-group">
                  <label className="form-label">Start Time</label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">End Time</label>
                  <input
                    type="datetime-local"
                    className="form-input"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={handleReserve}
                    disabled={loading}
                  >
                    {loading ? 'Submitting...' : 'Submit Request'}
                  </button>
                  <Link
                    to="/machines/$machineId"
                    params={{ machineId: machine.id }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </Link>
                </div>
              </>
            ) : (
              <div className="alert alert-warning">
                <p className="mb-1">
                  You can view availability, but you are not eligible to book yet.
                </p>
                <ul className="eligibility-list">
                  {eligibility.reasons.map((reason, idx) => (
                    <li key={idx} className="eligibility-item">
                      <span className="text-small">{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="card-title mb-2">Upcoming Booked Times (Next 14 Days)</h3>
            {bookings.length > 0 ? (
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>{formatDisplayDate(booking.startTime)}</td>
                        <td>{formatDisplayDate(booking.endTime)}</td>
                        <td style={{ textTransform: 'capitalize' }}>{booking.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-small text-muted">
                No upcoming bookings in the next 14 days.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
