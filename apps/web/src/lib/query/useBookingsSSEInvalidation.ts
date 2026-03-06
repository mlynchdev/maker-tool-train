import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { parseSSEMessage } from '~/lib/sse'
import { queryKeys } from '~/lib/query/keys'

const INITIAL_RETRY_MS = 2_000
const MAX_RETRY_MS = 30_000

export function useBookingsSSEInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let retryMs = INITIAL_RETRY_MS
    let disposed = false

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const resetRetryDelay = () => {
      retryMs = INITIAL_RETRY_MS
    }

    const closeSource = () => {
      if (!source) return
      source.close()
      source = null
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }

    const connect = () => {
      if (disposed) return

      clearReconnectTimer()
      closeSource()

      source = new EventSource('/api/sse/bookings')

      source.onopen = () => {
        resetRetryDelay()
      }

      source.onmessage = (event) => {
        const message = parseSSEMessage(event.data)
        if (!message) return
        if (message.type === 'connected') {
          resetRetryDelay()
          return
        }

        if (message.event === 'notification') {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.bookingRequests() }),
          ])
          return
        }

        if (message.event === 'booking') {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.reservations.all }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.admin.pendingReservationRequestCount(),
            }),
            queryClient.invalidateQueries({
              queryKey: queryKeys.admin.pendingReservationRequests(),
            }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.bookingRequests() }),
          ])
          return
        }

        if (message.event === 'checkout') {
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
            }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckoutCount() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.pendingCheckouts() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.checkouts() }),
          ])
          return
        }

        if (message.event === 'machine_availability') {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.machines.all }),
            queryClient.invalidateQueries({ queryKey: queryKeys.admin.machines() }),
          ])
        }
      }

      source.onerror = () => {
        closeSource()
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      closeSource()
    }
  }, [queryClient])
}
