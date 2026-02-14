import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, notifications, users, type NewNotification } from '~/lib/db'
import { emitNotificationEvent } from './events'

interface NotificationPayload {
  userId: string
  type: NewNotification['type']
  title: string
  message: string
  metadata?: Record<string, string | null>
}

export async function createNotification(payload: NotificationPayload) {
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      metadata: payload.metadata,
    })
    .returning()

  emitNotificationEvent(notification.userId, {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    metadata: notification.metadata || undefined,
    createdAt: notification.createdAt.toISOString(),
  })

  return notification
}

export async function createNotifications(payloads: NotificationPayload[]) {
  if (payloads.length === 0) return []

  const created = await db
    .insert(notifications)
    .values(
      payloads.map((payload) => ({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        metadata: payload.metadata,
      }))
    )
    .returning()

  for (const notification of created) {
    emitNotificationEvent(notification.userId, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata || undefined,
      createdAt: notification.createdAt.toISOString(),
    })
  }

  return created
}

export async function getNotificationsForUser(userId: string, unreadOnly = false, limit = 25) {
  return db.query.notifications.findMany({
    where: unreadOnly
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
    limit,
  })
}

export async function getUnreadNotificationCount(userId: string) {
  const unread = await db.query.notifications.findMany({
    where: and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    columns: { id: true },
  })

  return unread.length
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const [notification] = await db
    .update(notifications)
    .set({
      readAt: new Date(),
    })
    .where(
      and(eq(notifications.id, notificationId), eq(notifications.userId, userId))
    )
    .returning()

  return notification
}

export async function markAllNotificationsRead(userId: string) {
  const unread = await db.query.notifications.findMany({
    where: and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    columns: { id: true },
  })

  if (unread.length === 0) return { updated: 0 }

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))

  return { updated: unread.length }
}

export async function notifyAdminsBookingRequested(input: {
  requestedByUserId: string
  requestedByName: string
  machineId: string
  machineName: string
  reservationId: string
  startTimeIso: string
  endTimeIso: string
}) {
  const admins = await db.query.users.findMany({
    where: and(eq(users.role, 'admin'), eq(users.status, 'active')),
    columns: {
      id: true,
    },
  })

  if (admins.length === 0) return []

  return createNotifications(
    admins.map((admin) => ({
      userId: admin.id,
      type: 'booking_requested',
      title: 'New booking request',
      message: `${input.requestedByName} requested ${input.machineName} from ${new Date(
        input.startTimeIso
      ).toLocaleString()} to ${new Date(input.endTimeIso).toLocaleString()}.`,
      metadata: {
        reservationId: input.reservationId,
        machineId: input.machineId,
        requestedByUserId: input.requestedByUserId,
      },
    }))
  )
}

export async function notifyUserBookingDecision(input: {
  userId: string
  reservationId: string
  machineId: string
  machineName: string
  status: 'approved' | 'rejected' | 'cancelled'
  startTimeIso: string
  endTimeIso: string
}) {
  const title =
    input.status === 'approved'
      ? 'Booking approved'
      : input.status === 'rejected'
        ? 'Booking rejected'
        : 'Booking cancelled'

  const message =
    input.status === 'approved'
      ? `Your ${input.machineName} booking request was approved for ${new Date(
          input.startTimeIso
        ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}.`
      : input.status === 'rejected'
        ? `Your ${input.machineName} booking request was rejected.`
        : `Your ${input.machineName} booking was cancelled.`

  return createNotification({
    userId: input.userId,
    type:
      input.status === 'approved'
        ? 'booking_approved'
        : input.status === 'rejected'
          ? 'booking_rejected'
          : 'booking_cancelled',
    title,
    message,
    metadata: {
      reservationId: input.reservationId,
      machineId: input.machineId,
    },
  })
}

export async function notifyAdminsCheckoutRequestSubmitted(input: {
  requestedByUserId: string
  userName: string
  machineName: string
  machineId: string
  appointmentId: string
  managerId: string
  startTimeIso: string
  endTimeIso: string
}) {
  const admins = await db.query.users.findMany({
    where: and(eq(users.role, 'admin'), eq(users.status, 'active')),
    columns: {
      id: true,
    },
  })

  if (admins.length === 0) return []

  return createNotifications(
    admins.map((admin) => ({
      userId: admin.id,
      type: 'checkout_request_submitted',
      title: 'New checkout request',
      message: `${input.userName} requested an in-person checkout for ${input.machineName} (${new Date(
        input.startTimeIso
      ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}).`,
      metadata: {
        appointmentId: input.appointmentId,
        machineId: input.machineId,
        managerId: input.managerId,
        requestedByUserId: input.requestedByUserId,
      },
    }))
  )
}

export async function notifyUserCheckoutRequestAccepted(input: {
  userId: string
  adminName: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
}) {
  return createNotification({
    userId: input.userId,
    type: 'checkout_request_accepted',
    title: 'Checkout request accepted',
    message: `${input.adminName} accepted your checkout request for ${input.machineName} (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}).`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}

export async function notifyUserCheckoutRequestRejected(input: {
  userId: string
  adminName: string
  machineName: string
  machineId: string
  appointmentId: string
  reason: string
  startTimeIso: string
  endTimeIso: string
}) {
  return createNotification({
    userId: input.userId,
    type: 'checkout_request_rejected',
    title: 'Checkout request rejected',
    message: `${input.adminName} rejected your checkout request for ${input.machineName} (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}). Reason: ${input.reason}.`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}

export async function notifyUserCheckoutResultPassed(input: {
  userId: string
  adminName: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
}) {
  return createNotification({
    userId: input.userId,
    type: 'checkout_result_passed',
    title: 'Checkout passed',
    message: `${input.adminName} marked your ${input.machineName} checkout as passed for the meeting on ${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}.`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}

export async function notifyUserCheckoutResultFailed(input: {
  userId: string
  adminName: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
  notes?: string
}) {
  const notesSuffix = input.notes ? ` Notes: ${input.notes}.` : ''

  return createNotification({
    userId: input.userId,
    type: 'checkout_result_failed',
    title: 'Checkout requires another attempt',
    message: `${input.adminName} marked your ${input.machineName} checkout meeting (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}) as failed.${notesSuffix}`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}

export async function notifyManagerCheckoutAppointmentBooked(input: {
  managerId: string
  userName: string
  userId: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
}) {
  return createNotification({
    userId: input.managerId,
    type: 'checkout_appointment_booked',
    title: 'Checkout appointment booked',
    message: `${input.userName} booked a checkout appointment for ${input.machineName} (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}).`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
      userId: input.userId,
    },
  })
}

export async function notifyUserCheckoutAppointmentBooked(input: {
  userId: string
  managerName: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
}) {
  return createNotification({
    userId: input.userId,
    type: 'checkout_appointment_booked',
    title: 'Checkout appointment confirmed',
    message: `You are scheduled with ${input.managerName} for ${input.machineName} (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}).`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}

export async function notifyUserCheckoutAppointmentCancelled(input: {
  userId: string
  managerName: string
  machineName: string
  machineId: string
  appointmentId: string
  startTimeIso: string
  endTimeIso: string
  reason?: string
}) {
  const reasonSuffix = input.reason ? ` Reason: ${input.reason}.` : ''

  return createNotification({
    userId: input.userId,
    type: 'checkout_appointment_cancelled',
    title: 'Checkout appointment cancelled',
    message: `${input.managerName} cancelled your checkout appointment for ${input.machineName} (${new Date(
      input.startTimeIso
    ).toLocaleString()} - ${new Date(input.endTimeIso).toLocaleString()}).${reasonSuffix}`,
    metadata: {
      appointmentId: input.appointmentId,
      machineId: input.machineId,
    },
  })
}
