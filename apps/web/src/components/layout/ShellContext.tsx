import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getPendingCheckoutCount, getPendingReservationRequestCount } from '~/server/api/admin'
import { getMyUnreadNotificationCount } from '~/server/api/notifications'
import { getReservations } from '~/server/api/reservations'
import type { AuthUser } from '~/server/auth/types'
import { parseSSEMessage } from '~/lib/sse'

const ACTIVE_RESERVATION_STATUSES = ['pending', 'approved', 'confirmed'] as const

interface ShellBadges {
  unreadNotifications: number
  pendingCheckoutCount: number
  pendingRequestCount: number
  activeReservationCount: number
}

interface ShellContextValue {
  user: AuthUser
  badges: ShellBadges
  refreshing: boolean
  lastRefreshedAt: Date | null
  refreshBadges: () => Promise<void>
}

const ShellContext = createContext<ShellContextValue | null>(null)

interface ShellProviderProps {
  user: AuthUser
  children: ReactNode
}

export function ShellProvider({ user, children }: ShellProviderProps) {
  const [badges, setBadges] = useState<ShellBadges>({
    unreadNotifications: 0,
    pendingCheckoutCount: 0,
    pendingRequestCount: 0,
    activeReservationCount: 0,
  })
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  const isManagerOrAdmin = user.role === 'manager' || user.role === 'admin'
  const isAdmin = user.role === 'admin'

  const refreshBadges = useCallback(async () => {
    setRefreshing(true)

    try {
      const unreadPromise = getMyUnreadNotificationCount()
      const reservationsPromise = getReservations({ data: { includesPast: false } })
      const checkoutPromise = isManagerOrAdmin ? getPendingCheckoutCount() : Promise.resolve({ count: 0 })
      const requestPromise = isAdmin ? getPendingReservationRequestCount() : Promise.resolve({ count: 0 })

      const [unread, reservations, pendingCheckout, pendingRequests] = await Promise.all([
        unreadPromise,
        reservationsPromise,
        checkoutPromise,
        requestPromise,
      ])

      const now = new Date()
      const activeReservationCount = reservations.reservations.filter((reservation) => {
        return (
          ACTIVE_RESERVATION_STATUSES.includes(
            reservation.status as (typeof ACTIVE_RESERVATION_STATUSES)[number]
          ) &&
          new Date(reservation.endTime) > now
        )
      }).length

      setBadges({
        unreadNotifications: unread.count,
        pendingCheckoutCount: pendingCheckout.count,
        pendingRequestCount: pendingRequests.count,
        activeReservationCount,
      })
      setLastRefreshedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [isAdmin, isManagerOrAdmin])

  useEffect(() => {
    refreshBadges()
  }, [refreshBadges])

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
        refreshBadges()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [refreshBadges])

  const value = useMemo(
    () => ({
      user,
      badges,
      refreshing,
      lastRefreshedAt,
      refreshBadges,
    }),
    [badges, lastRefreshedAt, refreshBadges, refreshing, user]
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

export function useShellContext() {
  const context = useContext(ShellContext)
  if (!context) {
    throw new Error('useShellContext must be used inside ShellProvider')
  }
  return context
}
