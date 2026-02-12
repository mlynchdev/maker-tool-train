import { Outlet, createFileRoute, Link, useChildMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility, getMachineRequirements } from '~/server/services/eligibility'
import { getMachineBookingsInRange } from '~/server/services/booking-conflicts'
import { getAvailableCheckoutBlocks } from '~/server/services/checkout-scheduling'
import { Header } from '~/components/Header'
import { requestCheckoutAppointment } from '~/server/api/machines'

const getMachineData = createServerFn({ method: 'GET' })
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
    const requirements = await getMachineRequirements(data.machineId)
    const trainingComplete = eligibility.requirements.every((req) => req.completed)

    const rangeStart = new Date()
    const rangeEnd = new Date(rangeStart)
    rangeEnd.setDate(rangeEnd.getDate() + 21)
    const bookingRangeEnd = new Date(rangeStart)
    bookingRangeEnd.setDate(bookingRangeEnd.getDate() + 14)

    const availableCheckoutBlocks =
      trainingComplete && !eligibility.hasCheckout
        ? await getAvailableCheckoutBlocks({
            machineId: data.machineId,
            startTime: rangeStart,
            endTime: rangeEnd,
          })
        : []

    const upcomingBookings = await getMachineBookingsInRange(
      data.machineId,
      rangeStart,
      bookingRangeEnd
    )

    return {
      user,
      machine,
      eligibility,
      requirements,
      trainingComplete,
      availableCheckoutBlocks,
      upcomingBookings,
    }
  })

export const Route = createFileRoute('/machines/$machineId')({
  component: MachineDetailPage,
  loader: async ({ params }) => {
    return await getMachineData({ data: { machineId: params.machineId } })
  },
})

function MachineDetailPage() {
  const {
    user,
    machine,
    eligibility,
    requirements,
    trainingComplete,
    availableCheckoutBlocks,
    upcomingBookings,
  } = Route.useLoaderData()
  const childMatches = useChildMatches()
  const [checkoutBlocks, setCheckoutBlocks] = useState(availableCheckoutBlocks)
  const [bookingBlockId, setBookingBlockId] = useState<string | null>(null)
  const [checkoutMessage, setCheckoutMessage] = useState('')

  if (childMatches.length > 0) {
    return <Outlet />
  }

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  const getReservationStatusBadgeClass = (status: string) => {
    if (status === 'approved' || status === 'confirmed') return 'badge-success'
    if (status === 'pending') return 'badge-warning'
    if (status === 'cancelled' || status === 'rejected') return 'badge-danger'
    return 'badge-info'
  }

  const handleBookCheckout = async (blockId: string) => {
    setBookingBlockId(blockId)
    setCheckoutMessage('')

    try {
      const result = await requestCheckoutAppointment({
        data: {
          machineId: machine.id,
          blockId,
        },
      })

      if (result.success) {
        setCheckoutMessage(
          'Checkout appointment booked. A manager/admin will meet you during that slot.'
        )
        setCheckoutBlocks((prev) => prev.filter((block) => block.id !== blockId))
      } else {
        setCheckoutMessage(result.error || 'Unable to book checkout appointment')
      }
    } catch {
      setCheckoutMessage('Unable to book checkout appointment')
    } finally {
      setBookingBlockId(null)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/machines" className="text-small">
              &larr; Back to Machines
            </Link>
          </div>

          <div className="flex flex-between flex-center mb-2">
            <h1>{machine.name}</h1>
            {eligibility.eligible ? (
              <span className="badge badge-success">Eligible</span>
            ) : (
              <span className="badge badge-warning">Not Eligible</span>
            )}
          </div>

          {machine.description && (
            <p className="text-muted mb-3">{machine.description}</p>
          )}

          <div className="grid grid-2">
            {/* Eligibility Status */}
            <div className="card">
              <h3 className="card-title mb-2">Eligibility Checklist</h3>

              {/* Training Requirements */}
              <h4 className="text-small mb-1">Training Requirements</h4>
              {eligibility.requirements.length > 0 ? (
                <ul className="eligibility-list">
                  {eligibility.requirements.map((req) => (
                    <li key={req.moduleId} className="eligibility-item">
                      <span
                        className={`eligibility-icon ${req.completed ? 'complete' : 'incomplete'}`}
                      >
                        {req.completed ? '✓' : '!'}
                      </span>
                      <div>
                        <span className="text-small">{req.moduleTitle}</span>
                        <span className="text-small text-muted" style={{ marginLeft: '0.5rem' }}>
                          ({req.watchedPercent}% / {req.requiredPercent}%)
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted">No training requirements.</p>
              )}

              {/* Manager Checkout */}
              <h4 className="text-small mt-2 mb-1">Manager Checkout</h4>
              <div className="eligibility-item">
                <span
                  className={`eligibility-icon ${eligibility.hasCheckout ? 'complete' : 'incomplete'}`}
                >
                  {eligibility.hasCheckout ? '✓' : '!'}
                </span>
                <span className="text-small">
                  {eligibility.hasCheckout
                    ? 'Approved by manager'
                    : 'Pending manager approval'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="card">
              <h3 className="card-title mb-2">Actions</h3>

              {eligibility.eligible ? (
                <div>
                  <p className="text-small text-muted mb-2">
                    You are eligible to reserve this machine.
                  </p>
                  <Link
                    to="/machines/$machineId/reserve"
                    params={{ machineId: machine.id }}
                    className="btn btn-primary"
                  >
                    Request Reservation
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-small text-muted mb-2">
                    Complete the following to become eligible:
                  </p>
                  <ul className="eligibility-list">
                    {eligibility.reasons.map((reason, i) => (
                      <li key={i} className="eligibility-item">
                        <span className="eligibility-icon incomplete">!</span>
                        <span className="text-small">{reason}</span>
                      </li>
                    ))}
                  </ul>

                  {eligibility.requirements.some((r) => !r.completed) && (
                    <Link to="/training" className="btn btn-secondary mt-2">
                      Go to Training
                    </Link>
                  )}

                  {trainingComplete && !eligibility.hasCheckout && (
                    <div className="mt-2">
                      <p className="text-small text-muted mb-1">
                        Training is complete. Book an in-person checkout slot to unlock
                        reservations.
                      </p>

                      {checkoutMessage && (
                        <div className="alert alert-info mb-2">{checkoutMessage}</div>
                      )}

                      {checkoutBlocks.length > 0 ? (
                        <div className="table-wrapper">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Start</th>
                                <th>End</th>
                                <th>With</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {checkoutBlocks.map((block) => (
                                <tr key={block.id}>
                                  <td>{formatDateTime(block.startTime)}</td>
                                  <td>{formatDateTime(block.endTime)}</td>
                                  <td>{block.manager.name || block.manager.email}</td>
                                  <td>
                                    <button
                                      className="btn btn-primary"
                                      onClick={() => handleBookCheckout(block.id)}
                                      disabled={bookingBlockId === block.id}
                                    >
                                      {bookingBlockId === block.id
                                        ? 'Booking...'
                                        : 'Book Checkout'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-small text-muted">
                          No checkout slots are currently available for this resource.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Training Modules Required */}
          {requirements.length > 0 && (
            <div className="card mt-2">
              <h3 className="card-title mb-2">Required Training Modules</h3>
              <div className="grid grid-3">
                {requirements.map((req) => {
                  const status = eligibility.requirements.find(
                    (r) => r.moduleId === req.moduleId
                  )
                  return (
                    <Link
                      key={req.moduleId}
                      to="/training/$moduleId"
                      params={{ moduleId: req.moduleId }}
                      className="card"
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                        border: status?.completed
                          ? '1px solid #28a745'
                          : '1px solid #e0e0e0',
                      }}
                    >
                      <div className="flex flex-between flex-center">
                        <span className="text-small">{req.module.title}</span>
                        {status?.completed ? (
                          <span className="badge badge-success">Done</span>
                        ) : (
                          <span className="badge badge-warning">
                            {status?.watchedPercent || 0}%
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card mt-2">
            <h3 className="card-title mb-2">Upcoming Reservation Schedule (Next 14 Days)</h3>
            {upcomingBookings.length > 0 ? (
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
                    {upcomingBookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>{formatDateTime(booking.startTime)}</td>
                        <td>{formatDateTime(booking.endTime)}</td>
                        <td>
                          <span className={`badge ${getReservationStatusBadgeClass(booking.status)}`}>
                            {booking.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-small text-muted">
                No reserved blocks are scheduled in the next 14 days.
              </p>
            )}
            <p className="text-small text-muted mt-1">
              This shared schedule helps you plan project time before requesting a booking.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
