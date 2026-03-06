import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { queryKeys } from '~/lib/query/keys'
import {
  activeReservationCountQueryOptions,
  pendingCheckoutCountQueryOptions,
  pendingReservationRequestCountQueryOptions,
  unreadNotificationCountQueryOptions,
} from '~/lib/query/options'
import type { AuthUser } from '~/server/auth/types'

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
  const activeReservationCountQuery = useQuery(activeReservationCountQueryOptions())
  const pendingCheckoutCountQuery = useQuery({
    ...pendingCheckoutCountQueryOptions(),
    enabled: isAdmin,
  })
  const pendingRequestCountQuery = useQuery({
    ...pendingReservationRequestCountQueryOptions(),
    enabled: isAdmin,
  })

  const badges = useMemo<ShellBadges>(() => {
    return {
      unreadNotifications: unreadCountQuery.data?.count ?? 0,
      pendingCheckoutCount: pendingCheckoutCountQuery.data?.count ?? 0,
      pendingRequestCount: pendingRequestCountQuery.data?.count ?? 0,
      activeReservationCount: activeReservationCountQuery.data?.count ?? 0,
    }
  }, [
    activeReservationCountQuery.data?.count,
    pendingCheckoutCountQuery.data?.count,
    pendingRequestCountQuery.data?.count,
    unreadCountQuery.data?.count,
  ])

  const refreshBadges = useCallback(async () => {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.reservations.activeCount(),
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
    activeReservationCountQuery.dataUpdatedAt,
    pendingCheckoutCountQuery.dataUpdatedAt,
    pendingRequestCountQuery.dataUpdatedAt,
  ].filter((value) => value > 0)

  const lastRefreshedAt =
    refreshTimestamps.length > 0 ? new Date(Math.max(...refreshTimestamps)) : null

  const refreshing =
    unreadCountQuery.isFetching ||
    activeReservationCountQuery.isFetching ||
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
