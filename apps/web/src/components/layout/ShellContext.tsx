import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { queryKeys } from '~/lib/query/keys'
import {
  pendingCheckoutCountQueryOptions,
  pendingReservationRequestCountQueryOptions,
  reservationsListQueryOptions,
  unreadNotificationCountQueryOptions,
} from '~/lib/query/options'
import type { AuthUser } from '~/server/auth/types'

const ACTIVE_RESERVATION_STATUSES = ['pending', 'approved', 'confirmed'] as const
const SHELL_RESERVATIONS_OPTIONS = { includesPast: true } as const

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
  const queryClient = useQueryClient()
  const isAdmin = user.role === 'admin'

  const unreadCountQuery = useQuery(unreadNotificationCountQueryOptions())
  const reservationsQuery = useQuery(reservationsListQueryOptions(SHELL_RESERVATIONS_OPTIONS))
  const pendingCheckoutCountQuery = useQuery({
    ...pendingCheckoutCountQueryOptions(),
    enabled: isAdmin,
  })
  const pendingRequestCountQuery = useQuery({
    ...pendingReservationRequestCountQueryOptions(),
    enabled: isAdmin,
  })

  const badges = useMemo<ShellBadges>(() => {
    const now = new Date()
    const reservations = reservationsQuery.data?.reservations ?? []

    const activeReservationCount = reservations.filter((reservation) => {
      return (
        ACTIVE_RESERVATION_STATUSES.includes(
          reservation.status as (typeof ACTIVE_RESERVATION_STATUSES)[number]
        ) &&
        new Date(reservation.endTime) > now
      )
    }).length

    return {
      unreadNotifications: unreadCountQuery.data?.count ?? 0,
      pendingCheckoutCount: pendingCheckoutCountQuery.data?.count ?? 0,
      pendingRequestCount: pendingRequestCountQuery.data?.count ?? 0,
      activeReservationCount,
    }
  }, [
    pendingCheckoutCountQuery.data?.count,
    pendingRequestCountQuery.data?.count,
    reservationsQuery.data?.reservations,
    unreadCountQuery.data?.count,
  ])

  const refreshBadges = useCallback(async () => {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.reservations.mine(SHELL_RESERVATIONS_OPTIONS),
      }),
    ]

    if (isAdmin) {
      invalidations.push(
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingCheckoutCount(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.pendingReservationRequestCount(),
        })
      )
    }

    await Promise.all(invalidations)
  }, [isAdmin, queryClient])

  const refreshTimestamps = [
    unreadCountQuery.dataUpdatedAt,
    reservationsQuery.dataUpdatedAt,
    pendingCheckoutCountQuery.dataUpdatedAt,
    pendingRequestCountQuery.dataUpdatedAt,
  ].filter((value) => value > 0)

  const lastRefreshedAt =
    refreshTimestamps.length > 0 ? new Date(Math.max(...refreshTimestamps)) : null

  const refreshing =
    unreadCountQuery.isFetching ||
    reservationsQuery.isFetching ||
    (isAdmin && pendingCheckoutCountQuery.isFetching) ||
    (isAdmin && pendingRequestCountQuery.isFetching)

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
