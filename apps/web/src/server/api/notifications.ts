import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from '../auth'
import {
  getNotificationsForUser,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications'

export const getNotifications = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z
      .object({
        unreadOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .optional()
      .parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()
    const unreadOnly = data?.unreadOnly || false
    const limit = data?.limit || 25

    const notifications = await getNotificationsForUser(user.id, unreadOnly, limit)
    return { notifications }
  })

export const getMyUnreadNotificationCount = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await requireAuth()
    const count = await getUnreadNotificationCount(user.id)
    return { count }
  }
)

export const markMyNotificationRead = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z.object({ notificationId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const user = await requireAuth()
    const notification = await markNotificationRead(user.id, data.notificationId)

    if (!notification) {
      return { success: false, error: 'Notification not found' }
    }

    return { success: true, notification }
  })

export const markAllMyNotificationsRead = createServerFn({ method: 'POST' }).handler(
  async () => {
    const user = await requireAuth()
    return markAllNotificationsRead(user.id)
  }
)
