import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, users, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { getAdminCheckoutAvailability } from '~/server/services/checkout-scheduling'
import { getNotificationsForUser } from '~/server/services/notifications'
import { Header } from '~/components/Header'
import {
  approveCheckout,
  createCheckoutAvailabilityBlock,
  deactivateCheckoutAvailabilityBlock,
} from '~/server/api/admin'
import { markMyNotificationRead } from '~/server/api/notifications'
import { parseSSEMessage } from '~/lib/sse'

function toDatetimeLocal(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

const getCheckoutsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireManager()

  // Get all members
  const allUsers = await db.query.users.findMany({
    where: eq(users.role, 'member'),
    with: {
      managerCheckouts: {
        with: {
          machine: true,
        },
      },
    },
  })

  const allMachines = await db.query.machines.findMany({
    where: eq(machines.active, true),
  })

  // Find users ready for checkout (completed training but no checkout)
  const pendingApprovals = []

  for (const member of allUsers) {
    if (member.status !== 'active') continue

    for (const machine of allMachines) {
      const hasCheckout = member.managerCheckouts.some(
        (c) => c.machineId === machine.id
      )
      if (hasCheckout) continue

      const eligibility = await checkEligibility(member.id, machine.id)
      const trainingComplete = eligibility.requirements.every((r) => r.completed)

      if (trainingComplete) {
        pendingApprovals.push({
          user: {
            id: member.id,
            email: member.email,
            name: member.name,
          },
          machine: {
            id: machine.id,
            name: machine.name,
          },
          trainingStatus: eligibility.requirements,
        })
      }
    }
  }

  const managedResources =
    user.role === 'admin'
      ? await db.query.machines.findMany({
          where: eq(machines.active, true),
          orderBy: [asc(machines.name)],
        })
      : []

  const checkoutAvailability =
    user.role === 'admin'
      ? await getAdminCheckoutAvailability({
          managerId: user.id,
          startTime: new Date(),
          endTime: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
        })
      : { blocks: [], appointments: [] }

  const unreadNotifications = await getNotificationsForUser(user.id, true, 25)

  const relevantNotificationTypes = ['checkout_appointment_booked']

  const roleNotifications = unreadNotifications.filter((notification) =>
    relevantNotificationTypes.includes(notification.type)
  )

  return {
    user,
    pendingApprovals,
    managedResources,
    checkoutAvailabilityBlocks: checkoutAvailability.blocks,
    checkoutAppointments: checkoutAvailability.appointments,
    roleNotifications,
  }
})

export const Route = createFileRoute('/admin/checkouts')({
  component: CheckoutsPage,
  loader: async () => {
    return await getCheckoutsData()
  },
})

function CheckoutsPage() {
  const {
    user,
    pendingApprovals: initialApprovals,
    managedResources,
    checkoutAvailabilityBlocks: initialAvailabilityBlocks,
    checkoutAppointments: initialCheckoutAppointments,
    roleNotifications: initialRoleNotifications,
  } = Route.useLoaderData()
  const [pendingApprovals, setPendingApprovals] = useState(initialApprovals)
  const [approving, setApproving] = useState<string | null>(null)
  const [availabilityBlocks, setAvailabilityBlocks] = useState(initialAvailabilityBlocks)
  const [checkoutAppointments, setCheckoutAppointments] = useState(
    initialCheckoutAppointments
  )
  const [roleNotifications, setRoleNotifications] = useState(initialRoleNotifications)
  const [selectedMachineId, setSelectedMachineId] = useState(
    managedResources[0]?.id || ''
  )
  const [creatingBlock, setCreatingBlock] = useState(false)
  const [deactivatingBlockId, setDeactivatingBlockId] = useState<string | null>(null)
  const [blockMessage, setBlockMessage] = useState('')

  const defaultStart = new Date()
  defaultStart.setMinutes(0, 0, 0)
  defaultStart.setHours(defaultStart.getHours() + 1)
  const defaultEnd = new Date(defaultStart)
  defaultEnd.setHours(defaultEnd.getHours() + 1)

  const [blockStart, setBlockStart] = useState(toDatetimeLocal(defaultStart))
  const [blockEnd, setBlockEnd] = useState(toDatetimeLocal(defaultEnd))
  const [blockNotes, setBlockNotes] = useState('')
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null)

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

  const getNotificationTypeLabel = (type: string) => {
    if (type === 'checkout_appointment_booked') return 'Checkout appointment'
    return 'Notification'
  }

  const rangesOverlap = (
    leftStart: Date,
    leftEnd: Date,
    rightStart: Date,
    rightEnd: Date
  ) => {
    return leftStart < rightEnd && leftEnd > rightStart
  }

  const refreshAdminData = useCallback(async () => {
    const latest = await getCheckoutsData()
    setPendingApprovals(latest.pendingApprovals)
    setAvailabilityBlocks(latest.checkoutAvailabilityBlocks)
    setCheckoutAppointments(latest.checkoutAppointments)
    setRoleNotifications(latest.roleNotifications)
  }, [])

  const handleMarkNotificationRead = async (notificationId: string) => {
    setMarkingNotificationId(notificationId)
    try {
      const result = await markMyNotificationRead({ data: { notificationId } })
      if (!result.success) return
      setRoleNotifications((prev) => prev.filter((item) => item.id !== notificationId))
    } finally {
      setMarkingNotificationId(null)
    }
  }

  const handleMarkAllNotificationsRead = async () => {
    const ids = roleNotifications.map((item) => item.id)
    if (ids.length === 0) return

    await Promise.all(
      ids.map((notificationId) => markMyNotificationRead({ data: { notificationId } }))
    )
    setRoleNotifications([])
  }

  const handleApprove = async (userId: string, machineId: string) => {
    const key = `${userId}-${machineId}`
    setApproving(key)

    try {
      const result = await approveCheckout({ data: { userId, machineId } })

      if (result.success) {
        setPendingApprovals((prev) =>
          prev.filter((a) => !(a.user.id === userId && a.machine.id === machineId))
        )
      } else {
        alert(result.error || 'Failed to approve checkout')
      }
    } catch (error) {
      alert('An error occurred')
    } finally {
      setApproving(null)
    }
  }

  const handleCreateAvailabilityBlock = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedMachineId) {
      setBlockMessage('Select a resource before creating availability.')
      return
    }

    const start = new Date(blockStart)
    const end = new Date(blockEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setBlockMessage('Provide a valid start/end time range.')
      return
    }

    setCreatingBlock(true)
    setBlockMessage('')

    try {
      const result = await createCheckoutAvailabilityBlock({
        data: {
          machineId: selectedMachineId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          notes: blockNotes || undefined,
        },
      })

      if (!result.success) {
        setBlockMessage(result.error || 'Failed to create availability block.')
        return
      }

      const machine = managedResources.find((item) => item.id === selectedMachineId)

      if (machine) {
        setAvailabilityBlocks((prev) =>
          [...prev, { ...result.data, machine }].sort(
            (a, b) => +new Date(a.startTime) - +new Date(b.startTime)
          )
        )
      }

      setBlockNotes('')
      setBlockMessage('Availability block created.')
    } catch {
      setBlockMessage('Failed to create availability block.')
    } finally {
      setCreatingBlock(false)
    }
  }

  const handleDeactivateAvailabilityBlock = async (blockId: string) => {
    setDeactivatingBlockId(blockId)
    setBlockMessage('')

    try {
      const result = await deactivateCheckoutAvailabilityBlock({
        data: { blockId },
      })

      if (!result.success) {
        setBlockMessage(result.error || 'Failed to deactivate block.')
        return
      }

      setAvailabilityBlocks((prev) =>
        prev.map((block) =>
          block.id === blockId ? { ...block, active: false, updatedAt: new Date() } : block
        )
      )
    } catch {
      setBlockMessage('Failed to deactivate block.')
    } finally {
      setDeactivatingBlockId(null)
    }
  }

  useEffect(() => {
    const source = new EventSource('/api/sse/bookings')

    source.onmessage = (event) => {
      const message = parseSSEMessage(event.data)
      if (!message) return
      if (message.type === 'connected') return

      if (
        message.event === 'notification' ||
        message.event === 'checkout' ||
        message.event === 'booking'
      ) {
        refreshAdminData()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [refreshAdminData])

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">Checkout Approvals</h1>

          <div className="card mb-2">
            <div className="card-header">
              <h3 className="card-title">
                {user.role === 'admin' ? 'Admin Alerts' : 'Manager Alerts'}
              </h3>
              {roleNotifications.length > 0 && (
                <button className="btn btn-secondary" onClick={handleMarkAllNotificationsRead}>
                  Mark all read
                </button>
              )}
            </div>

            {roleNotifications.length > 0 ? (
              <div className="table-wrapper">
                <table className="table table-mobile-cards">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Message</th>
                      <th>Time</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roleNotifications.map((notification) => (
                      <tr key={notification.id}>
                        <td data-label="Type">
                          <span className="badge badge-info">
                            {getNotificationTypeLabel(notification.type)}
                          </span>
                        </td>
                        <td data-label="Message">
                          <strong>{notification.title}</strong>
                          <div className="text-small text-muted">{notification.message}</div>
                        </td>
                        <td data-label="Time">{formatDateTime(notification.createdAt)}</td>
                        <td data-label="Action">
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleMarkNotificationRead(notification.id)}
                            disabled={markingNotificationId === notification.id}
                          >
                            {markingNotificationId === notification.id
                              ? 'Saving...'
                              : 'Mark read'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted text-small">No unread alerts.</p>
            )}
          </div>

          {pendingApprovals.length > 0 ? (
            <div className="card">
              <div className="table-wrapper">
                <table className="table table-mobile-cards">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Machine</th>
                      <th>Training Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingApprovals.map((approval) => {
                      const key = `${approval.user.id}-${approval.machine.id}`
                      return (
                        <tr key={key}>
                          <td data-label="Member">
                            <div>{approval.user.name || approval.user.email}</div>
                            {approval.user.name && (
                              <div className="text-small text-muted">
                                {approval.user.email}
                              </div>
                            )}
                          </td>
                          <td data-label="Machine">{approval.machine.name}</td>
                          <td data-label="Training Status">
                            <span className="badge badge-success">
                              All training complete
                            </span>
                          </td>
                          <td data-label="Actions">
                            <div className="flex gap-1">
                              <button
                                className="btn btn-success"
                                onClick={() =>
                                  handleApprove(approval.user.id, approval.machine.id)
                                }
                                disabled={approving === key}
                              >
                                {approving === key ? 'Approving...' : 'Approve'}
                              </button>
                              <Link
                                to="/admin/checkouts/$userId"
                                params={{ userId: approval.user.id }}
                                className="btn btn-secondary"
                              >
                                View Details
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card">
              <p className="text-center text-muted">
                No pending checkout approvals.
              </p>
              <p className="text-center text-small text-muted mt-1">
                Members will appear here once they complete all required training
                for a machine.
              </p>
            </div>
          )}

          {user.role === 'admin' && (
            <>
              <div className="card mb-2">
                <div className="flex flex-between flex-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                  <p className="text-small text-muted">
                    Reservation request moderation now has a dedicated queue.
                  </p>
                  <Link
                    to="/admin/booking-requests"
                    search={{ view: 'pending', q: '' }}
                    className="btn btn-secondary"
                  >
                    Open Booking Requests
                  </Link>
                </div>
              </div>

              <h2 className="mt-3 mb-2">Checkout Availability</h2>
              <div className="card mb-2">
                <h3 className="card-title mb-2">Add Availability Block</h3>
                <form onSubmit={handleCreateAvailabilityBlock}>
                  <div className="form-group">
                    <label className="form-label">Resource</label>
                    <select
                      className="form-input"
                      value={selectedMachineId}
                      onChange={(e) => setSelectedMachineId(e.target.value)}
                      required
                    >
                      {managedResources.map((resource) => (
                        <option key={resource.id} value={resource.id}>
                          {resource.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Start Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">End Time</label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Notes (Optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={blockNotes}
                      onChange={(e) => setBlockNotes(e.target.value)}
                    />
                  </div>

                  {blockMessage && <div className="alert alert-info mb-2">{blockMessage}</div>}

                  <button type="submit" className="btn btn-primary" disabled={creatingBlock}>
                    {creatingBlock ? 'Saving...' : 'Add Block'}
                  </button>
                </form>
              </div>

              <div className="card mb-2">
                <h3 className="card-title mb-2">Upcoming Availability Blocks</h3>
                {availabilityBlocks.length > 0 ? (
                  <div className="table-wrapper">
                    <table className="table table-mobile-cards">
                      <thead>
                        <tr>
                          <th>Resource</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availabilityBlocks.map((block) => {
                          const hasScheduledAppointment = checkoutAppointments.some(
                            (appointment) =>
                              appointment.status === 'scheduled' &&
                              appointment.machineId === block.machineId &&
                              rangesOverlap(
                                new Date(block.startTime),
                                new Date(block.endTime),
                                new Date(appointment.startTime),
                                new Date(appointment.endTime)
                              )
                          )

                          return (
                            <tr key={block.id}>
                              <td data-label="Resource">{block.machine.name}</td>
                              <td data-label="Start">{formatDateTime(block.startTime)}</td>
                              <td data-label="End">{formatDateTime(block.endTime)}</td>
                              <td data-label="Status">
                                {block.active ? (
                                  hasScheduledAppointment ? (
                                    <span className="badge badge-warning">Booked</span>
                                  ) : (
                                    <span className="badge badge-success">Open</span>
                                  )
                                ) : (
                                  <span className="badge badge-danger">Inactive</span>
                                )}
                              </td>
                              <td data-label="Actions">
                                {block.active ? (
                                  <button
                                    className="btn btn-secondary"
                                    onClick={() =>
                                      handleDeactivateAvailabilityBlock(block.id)
                                    }
                                    disabled={deactivatingBlockId === block.id}
                                  >
                                    {deactivatingBlockId === block.id
                                      ? 'Updating...'
                                      : 'Deactivate'}
                                  </button>
                                ) : (
                                  <span className="text-small text-muted">Unavailable</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted text-small">
                    No availability blocks yet. Add one above so members can book checkout
                    appointments.
                  </p>
                )}
              </div>

              <div className="card">
                <h3 className="card-title mb-2">Scheduled Checkout Appointments</h3>
                {checkoutAppointments.length > 0 ? (
                  <div className="table-wrapper">
                    <table className="table table-mobile-cards">
                      <thead>
                        <tr>
                          <th>Member</th>
                          <th>Resource</th>
                          <th>Start</th>
                          <th>End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checkoutAppointments.map((appointment) => (
                          <tr key={appointment.id}>
                            <td data-label="Member">
                              {appointment.user.name || appointment.user.email}
                            </td>
                            <td data-label="Resource">{appointment.machine.name}</td>
                            <td data-label="Start">{formatDateTime(appointment.startTime)}</td>
                            <td data-label="End">{formatDateTime(appointment.endTime)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-muted text-small">No scheduled checkout appointments.</p>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
