import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { parseSSEMessage } from '~/lib/sse'
import { queryKeys } from '~/lib/query/keys'

export function useBookingsSSEInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource('/api/sse/bookings')

    source.onmessage = (event) => {
      const message = parseSSEMessage(event.data)
      if (!message) return
      if (message.type === 'connected') return

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
      source.close()
    }

    return () => {
      source.close()
    }
  }, [queryClient])
}
