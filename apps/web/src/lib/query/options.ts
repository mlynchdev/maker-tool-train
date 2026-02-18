import { queryOptions } from '@tanstack/react-query'
import {
  getPendingCheckoutCount,
  getPendingCheckouts,
  getPendingReservationRequestCount,
  getPendingReservationRequests,
} from '~/server/api/admin'
import { getMachines, getMyUpcomingCheckoutAppointments } from '~/server/api/machines'
import { getMyUnreadNotificationCount, getNotifications } from '~/server/api/notifications'
import { getReservations } from '~/server/api/reservations'
import { getModules, getTrainingStatus } from '~/server/api/training'
import { queryKeys } from './keys'

interface NotificationsListOptions {
  unreadOnly?: boolean
  limit?: number
}

interface ReservationListOptions {
  includesPast: boolean
}

export function unreadNotificationCountQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.notifications.unreadCount(),
    queryFn: () => getMyUnreadNotificationCount(),
  })
}

export function notificationsListQueryOptions(options: NotificationsListOptions = {}) {
  const normalized: Required<NotificationsListOptions> = {
    unreadOnly: options.unreadOnly ?? false,
    limit: options.limit ?? 25,
  }

  return queryOptions({
    queryKey: queryKeys.notifications.list(normalized),
    queryFn: () => getNotifications({ data: normalized }),
  })
}

export function reservationsListQueryOptions(options: ReservationListOptions) {
  return queryOptions({
    queryKey: queryKeys.reservations.mine(options),
    queryFn: () => getReservations({ data: options }),
  })
}

export function machinesListQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.machines.list(),
    queryFn: () => getMachines(),
  })
}

export function myUpcomingCheckoutAppointmentsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
    queryFn: () => {
      const rangeStart = new Date()
      const rangeEnd = new Date(rangeStart)
      rangeEnd.setDate(rangeEnd.getDate() + 21)

      return getMyUpcomingCheckoutAppointments({
        data: {
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString(),
        },
      })
    },
  })
}

export function trainingStatusQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.training.status(),
    queryFn: () => getTrainingStatus(),
  })
}

export function trainingModulesQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.training.modules(),
    queryFn: () => getModules(),
  })
}

export function pendingCheckoutCountQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.admin.pendingCheckoutCount(),
    queryFn: () => getPendingCheckoutCount(),
  })
}

export function pendingCheckoutsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.admin.pendingCheckouts(),
    queryFn: () => getPendingCheckouts(),
  })
}

export function pendingReservationRequestCountQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.admin.pendingReservationRequestCount(),
    queryFn: () => getPendingReservationRequestCount(),
  })
}

export function pendingReservationRequestsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.admin.pendingReservationRequests(),
    queryFn: () => getPendingReservationRequests(),
  })
}
