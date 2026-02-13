import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, users, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { getAdminCheckoutAvailability } from '~/server/services/checkout-scheduling'
import { getMakerspaceTimezone } from '~/server/services/makerspace-settings'
import { getNotificationsForUser } from '~/server/services/notifications'
import {
  approveCheckout,
  cancelCheckoutAppointment,
  createCheckoutAvailabilityBlock,
  deactivateCheckoutAvailabilityBlock,
} from '~/server/api/admin'
import { markMyNotificationRead } from '~/server/api/notifications'
import { parseSSEMessage } from '~/lib/sse'

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const

function formatMinuteOfDay(value: number) {
  const hours24 = Math.floor(value / 60)
  const minutes = value % 60
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${`${minutes}`.padStart(2, '0')} ${suffix}`
}

const getCheckoutsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireManager()

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

  const pendingApprovals = []

  for (const member of allUsers) {
    if (member.status !== 'active') continue

    for (const machine of allMachines) {
      const hasCheckout = member.managerCheckouts.some((c) => c.machineId === machine.id)
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

  const checkoutAvailability = await getAdminCheckoutAvailability({
    managerId: user.id,
    startTime: new Date(),
    endTime: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
  })

  const unreadNotifications = await getNotificationsForUser(user.id, true, 25)

  const relevantNotificationTypes = [
    'checkout_appointment_booked',
    'checkout_appointment_cancelled',
  ]

  const roleNotifications = unreadNotifications.filter((notification) =>
    relevantNotificationTypes.includes(notification.type)
  )

  return {
    user,
    makerspaceTimezone: await getMakerspaceTimezone(),
    pendingApprovals,
    checkoutAvailabilityRules: checkoutAvailability.rules,
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
    makerspaceTimezone: initialMakerspaceTimezone,
    pendingApprovals: initialApprovals,
    checkoutAvailabilityRules: initialAvailabilityRules,
    checkoutAppointments: initialCheckoutAppointments,
    roleNotifications: initialRoleNotifications,
  } = Route.useLoaderData()

  const [pendingApprovals, setPendingApprovals] = useState(initialApprovals)
  const [approving, setApproving] = useState<string | null>(null)

  const [availabilityRules, setAvailabilityRules] = useState(initialAvailabilityRules)
  const [checkoutAppointments, setCheckoutAppointments] = useState(initialCheckoutAppointments)
  const [roleNotifications, setRoleNotifications] = useState(initialRoleNotifications)
  const [makerspaceTimezone, setMakerspaceTimezone] = useState(initialMakerspaceTimezone)

  const [selectedDayOfWeek, setSelectedDayOfWeek] = useState(6)
  const [ruleStartTime, setRuleStartTime] = useState('14:00')
  const [ruleEndTime, setRuleEndTime] = useState('22:00')
  const [ruleNotes, setRuleNotes] = useState('')

  const [creatingRule, setCreatingRule] = useState(false)
  const [deactivatingRuleId, setDeactivatingRuleId] = useState<string | null>(null)
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<string | null>(null)
  const [availabilityMessage, setAvailabilityMessage] = useState('')
  const [markingNotificationId, setMarkingNotificationId] = useState<string | null>(null)

  const now = new Date()

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: makerspaceTimezone,
    })

  const getNotificationTypeLabel = (type: string) => {
    if (type === 'checkout_appointment_booked') return 'Checkout appointment'
    if (type === 'checkout_appointment_cancelled') return 'Checkout cancellation'
    return 'Notification'
  }

  const refreshAdminData = useCallback(async () => {
    const latest = await getCheckoutsData()
    setPendingApprovals(latest.pendingApprovals)
    setAvailabilityRules(latest.checkoutAvailabilityRules)
    setCheckoutAppointments(latest.checkoutAppointments)
    setRoleNotifications(latest.roleNotifications)
    setMakerspaceTimezone(latest.makerspaceTimezone)
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
    } catch {
      alert('An error occurred')
    } finally {
      setApproving(null)
    }
  }

  const handleCreateAvailabilityRule = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingRule(true)
    setAvailabilityMessage('')

    try {
      const result = await createCheckoutAvailabilityBlock({
        data: {
          dayOfWeek: selectedDayOfWeek,
          startTime: ruleStartTime,
          endTime: ruleEndTime,
          notes: ruleNotes || undefined,
        },
      })

      if (!result.success) {
        setAvailabilityMessage(result.error || 'Failed to create availability rule.')
        return
      }

      setAvailabilityRules((prev) =>
        [...prev, result.data].sort((left, right) => {
          if (left.dayOfWeek !== right.dayOfWeek) return left.dayOfWeek - right.dayOfWeek
          return left.startMinuteOfDay - right.startMinuteOfDay
        })
      )
      setRuleNotes('')
      setAvailabilityMessage('Recurring availability rule created.')
    } catch {
      setAvailabilityMessage('Failed to create availability rule.')
    } finally {
      setCreatingRule(false)
    }
  }

  const handleDeactivateAvailabilityRule = async (ruleId: string) => {
    setDeactivatingRuleId(ruleId)
    setAvailabilityMessage('')

    try {
      const result = await deactivateCheckoutAvailabilityBlock({
        data: { ruleId },
      })

      if (!result.success) {
        setAvailabilityMessage(result.error || 'Failed to deactivate rule.')
        return
      }

      setAvailabilityRules((prev) =>
        prev.map((rule) =>
          rule.id === ruleId ? { ...rule, active: false, updatedAt: new Date() } : rule
        )
      )
    } catch {
      setAvailabilityMessage('Failed to deactivate rule.')
    } finally {
      setDeactivatingRuleId(null)
    }
  }

  const handleCancelAppointment = async (appointmentId: string) => {
    const reason = prompt('Optional cancellation reason:') || undefined
    setCancellingAppointmentId(appointmentId)
    setAvailabilityMessage('')

    try {
      const result = await cancelCheckoutAppointment({
        data: {
          appointmentId,
          reason,
        },
      })

      if (!result.success) {
        setAvailabilityMessage(result.error || 'Failed to cancel appointment.')
        return
      }

      setCheckoutAppointments((prev) => prev.filter((item) => item.id !== appointmentId))
      setAvailabilityMessage('Checkout appointment cancelled.')
    } catch {
      setAvailabilityMessage('Failed to cancel appointment.')
    } finally {
      setCancellingAppointmentId(null)
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
                              <div className="text-small text-muted">{approval.user.email}</div>
                            )}
                          </td>
                          <td data-label="Machine">{approval.machine.name}</td>
                          <td data-label="Training Status">
                            <span className="badge badge-success">All training complete</span>
                          </td>
                          <td data-label="Actions">
                            <div className="flex gap-1">
                              <button
                                className="btn btn-success"
                                onClick={() => handleApprove(approval.user.id, approval.machine.id)}
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
              <p className="text-center text-muted">No pending checkout approvals.</p>
              <p className="text-center text-small text-muted mt-1">
                Members will appear here once they complete all required training for a machine.
              </p>
            </div>
          )}

          {user.role === 'admin' && (
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
          )}

          <h2 className="mt-3 mb-2">Recurring Checkout Availability</h2>
          <p className="text-small text-muted mb-2">
            Availability and appointment times use timezone: <strong>{makerspaceTimezone}</strong>
            {user.role === 'admin' ? ' (change in Admin Settings).' : '.'}
          </p>
          <div className="card mb-2">
            <h3 className="card-title mb-2">Add Weekly Availability Rule</h3>
            <form onSubmit={handleCreateAvailabilityRule}>
              <div className="form-group">
                <label className="form-label">Day Of Week</label>
                <select
                  className="form-input"
                  value={selectedDayOfWeek}
                  onChange={(e) => setSelectedDayOfWeek(Number(e.target.value))}
                  required
                >
                  {DAY_OPTIONS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Start Time</label>
                <input
                  type="time"
                  className="form-input"
                  value={ruleStartTime}
                  onChange={(e) => setRuleStartTime(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">End Time</label>
                <input
                  type="time"
                  className="form-input"
                  value={ruleEndTime}
                  onChange={(e) => setRuleEndTime(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Notes (Optional)</label>
                <input
                  type="text"
                  className="form-input"
                  value={ruleNotes}
                  onChange={(e) => setRuleNotes(e.target.value)}
                />
              </div>

              {availabilityMessage && (
                <div className="alert alert-info mb-2">{availabilityMessage}</div>
              )}

              <button type="submit" className="btn btn-primary" disabled={creatingRule}>
                {creatingRule ? 'Saving...' : 'Add Recurring Rule'}
              </button>
            </form>
          </div>

          <div className="card mb-2">
            <h3 className="card-title mb-2">Recurring Rules</h3>
            {availabilityRules.length > 0 ? (
              <div className="table-wrapper">
                <table className="table table-mobile-cards">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availabilityRules.map((rule) => (
                      <tr key={rule.id}>
                        <td data-label="Day">{DAY_OPTIONS[rule.dayOfWeek]?.label || 'Unknown'}</td>
                        <td data-label="Start">{formatMinuteOfDay(rule.startMinuteOfDay)}</td>
                        <td data-label="End">{formatMinuteOfDay(rule.endMinuteOfDay)}</td>
                        <td data-label="Status">
                          {rule.active ? (
                            <span className="badge badge-success">Active</span>
                          ) : (
                            <span className="badge badge-danger">Inactive</span>
                          )}
                        </td>
                        <td data-label="Actions">
                          {rule.active ? (
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleDeactivateAvailabilityRule(rule.id)}
                              disabled={deactivatingRuleId === rule.id}
                            >
                              {deactivatingRuleId === rule.id ? 'Updating...' : 'Deactivate'}
                            </button>
                          ) : (
                            <span className="text-small text-muted">Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted text-small">
                No recurring rules yet. Add one above so members can book in-person final checkout slots.
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
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkoutAppointments.map((appointment) => (
                      <tr key={appointment.id}>
                        <td data-label="Member">{appointment.user.name || appointment.user.email}</td>
                        <td data-label="Resource">{appointment.machine.name}</td>
                        <td data-label="Start">{formatDateTime(appointment.startTime)}</td>
                        <td data-label="End">{formatDateTime(appointment.endTime)}</td>
                        <td data-label="Actions">
                          {new Date(appointment.startTime) > now ? (
                            <button
                              className="btn btn-danger"
                              onClick={() => handleCancelAppointment(appointment.id)}
                              disabled={cancellingAppointmentId === appointment.id}
                            >
                              {cancellingAppointmentId === appointment.id
                                ? 'Cancelling...'
                                : 'Cancel'}
                            </button>
                          ) : (
                            <span className="text-small text-muted">Started</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted text-small">No scheduled checkout appointments.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
