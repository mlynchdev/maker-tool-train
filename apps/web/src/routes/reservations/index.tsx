import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { queryKeys } from '~/lib/query/keys'
import {
  myUpcomingCheckoutAppointmentsQueryOptions,
  reservationsListQueryOptions,
} from '~/lib/query/options'
import {
  cancelMyCheckoutAppointment,
  type getMyUpcomingCheckoutAppointments,
} from '~/server/api/machines'
import { cancelReservation, type getReservations } from '~/server/api/reservations'

const RESERVATIONS_QUERY_OPTIONS = { includesPast: true } as const
const ACTIVE_RESERVATION_STATUSES = ['pending', 'approved', 'confirmed'] as const

type ReservationsPayload = Awaited<ReturnType<typeof getReservations>>
type UpcomingCheckoutPayload = Awaited<
  ReturnType<typeof getMyUpcomingCheckoutAppointments>
>

export const Route = createFileRoute('/reservations/')({
  component: ReservationsPage,
})

function ReservationsPage() {
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancellingCheckoutId, setCancellingCheckoutId] = useState<string | null>(null)

  const reservationsQuery = useQuery(
    reservationsListQueryOptions(RESERVATIONS_QUERY_OPTIONS)
  )
  const checkoutAppointmentsQuery = useQuery(
    myUpcomingCheckoutAppointmentsQueryOptions()
  )

  const reservationsList = reservationsQuery.data?.reservations ?? []
  const checkoutAppointmentsList = checkoutAppointmentsQuery.data?.appointments ?? []

  const loading =
    typeof reservationsQuery.data === 'undefined' &&
    typeof checkoutAppointmentsQuery.data === 'undefined' &&
    (reservationsQuery.isPending || checkoutAppointmentsQuery.isPending)

  const refreshReservations = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
      }),
    ])
  }, [queryClient])

  const cancelReservationMutation = useMutation({
    meta: {
      errorMessage: 'Failed to cancel reservation',
    },
    mutationFn: async (variables: { reservationId: string }) => {
      const result = await cancelReservation({ data: variables })

      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel reservation')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS),
      })

      const previousReservations = queryClient.getQueryData<ReservationsPayload>(
        queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS)
      )

      queryClient.setQueryData<ReservationsPayload>(
        queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS),
        (current) => {
          if (!current) return current

          return {
            ...current,
            reservations: current.reservations.map((reservation) =>
              reservation.id === variables.reservationId
                ? { ...reservation, status: 'cancelled' as const }
                : reservation
            ),
          }
        }
      )

      return { previousReservations }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousReservations) {
        queryClient.setQueryData(
          queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS),
          context.previousReservations
        )
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reservations.mine(RESERVATIONS_QUERY_OPTIONS),
      })
    },
  })

  const cancelCheckoutAppointmentMutation = useMutation({
    meta: {
      errorMessage: 'Failed to cancel checkout appointment',
    },
    mutationFn: async (variables: { appointmentId: string; reason?: string }) => {
      const result = await cancelMyCheckoutAppointment({
        data: variables,
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel checkout appointment')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
      })

      const previousAppointments = queryClient.getQueryData<UpcomingCheckoutPayload>(
        queryKeys.machines.myUpcomingCheckoutAppointments()
      )

      queryClient.setQueryData<UpcomingCheckoutPayload>(
        queryKeys.machines.myUpcomingCheckoutAppointments(),
        (current) => {
          if (!current) return current

          return {
            ...current,
            appointments: current.appointments.filter(
              (appointment) => appointment.id !== variables.appointmentId
            ),
          }
        }
      )

      return { previousAppointments }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousAppointments) {
        queryClient.setQueryData(
          queryKeys.machines.myUpcomingCheckoutAppointments(),
          context.previousAppointments
        )
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.machines.myUpcomingCheckoutAppointments(),
      })
    },
  })

  const formatDateTime = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const getStatusVariant = (status: string): 'success' | 'warning' | 'destructive' | 'info' => {
    if (status === 'approved' || status === 'confirmed' || status === 'completed') {
      return 'success'
    }
    if (status === 'pending') return 'warning'
    if (status === 'cancelled' || status === 'rejected') return 'destructive'
    return 'info'
  }

  const handleCancel = async (reservationId: string) => {
    if (!confirm('Are you sure you want to cancel this reservation?')) return

    setCancelling(reservationId)

    try {
      await cancelReservationMutation.mutateAsync({
        reservationId,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setCancelling(null)
    }
  }

  const handleCancelCheckoutAppointment = async (appointmentId: string) => {
    const reason = prompt('Cancellation reason (optional):')?.trim()
    if (!confirm('Are you sure you want to cancel this checkout appointment?')) return

    setCancellingCheckoutId(appointmentId)

    try {
      await cancelCheckoutAppointmentMutation.mutateAsync({
        appointmentId,
        reason: reason || undefined,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setCancellingCheckoutId(null)
    }
  }

  const upcomingReservations = reservationsList.filter(
    (reservation) =>
      ACTIVE_RESERVATION_STATUSES.includes(
        reservation.status as (typeof ACTIVE_RESERVATION_STATUSES)[number]
      ) && new Date(reservation.startTime) > new Date()
  )

  const historyReservations = reservationsList.filter(
    (reservation) =>
      !ACTIVE_RESERVATION_STATUSES.includes(
        reservation.status as (typeof ACTIVE_RESERVATION_STATUSES)[number]
      ) || new Date(reservation.startTime) <= new Date()
  )

  const cancelledCount = reservationsList.filter(
    (reservation) => reservation.status === 'cancelled'
  ).length

  if (loading) {
    return <QueryLoadingScreen message="Loading reservations..." />
  }

  if (
    typeof reservationsQuery.data === 'undefined' &&
    typeof checkoutAppointmentsQuery.data === 'undefined' &&
    (reservationsQuery.isError || checkoutAppointmentsQuery.isError)
  ) {
    return (
      <QueryErrorScreen
        message="Unable to load reservations right now."
        onRetry={() => {
          void refreshReservations()
        }}
      />
    )
  }

  return (
    <div className="min-h-screen">
      <main className="container space-y-8 py-6 md:py-8">
        <section className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">My Reservations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upcoming and historical bookings are separated for quicker access.
            </p>
          </div>
          <Button asChild>
            <Link to="/machines">New reservation</Link>
          </Button>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Upcoming</CardDescription>
              <CardTitle className="text-2xl">{upcomingReservations.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>History</CardDescription>
              <CardTitle className="text-2xl">{historyReservations.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Cancelled</CardDescription>
              <CardTitle className="text-2xl">{cancelledCount}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Upcoming checkout appointments</h2>
            <Badge variant="warning">{checkoutAppointmentsList.length}</Badge>
          </div>

          {checkoutAppointmentsList.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {checkoutAppointmentsList.map((appointment) => (
                <Card key={appointment.id}>
                  <CardHeader className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{appointment.machine.name}</CardTitle>
                      <Badge
                        variant={appointment.status === 'accepted' ? 'success' : 'warning'}
                        className="capitalize"
                      >
                        {appointment.status}
                      </Badge>
                    </div>
                    <CardDescription>
                      {formatDateTime(appointment.startTime)} to {formatDateTime(appointment.endTime)}
                    </CardDescription>
                    <CardDescription>
                      With {appointment.manager.name || appointment.manager.email}
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <Button
                      variant="destructive"
                      onClick={() => handleCancelCheckoutAppointment(appointment.id)}
                      disabled={cancellingCheckoutId === appointment.id}
                    >
                      {cancellingCheckoutId === appointment.id
                        ? 'Cancelling...'
                        : 'Cancel checkout appointment'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No upcoming checkout appointments.</p>
              </CardContent>
            </Card>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Upcoming</h2>
            <Badge variant="info">{upcomingReservations.length}</Badge>
          </div>

          {upcomingReservations.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingReservations.map((reservation) => (
                <Card key={reservation.id}>
                  <CardHeader className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{reservation.machine.name}</CardTitle>
                      <Badge variant={getStatusVariant(reservation.status)} className="capitalize">
                        {reservation.status}
                      </Badge>
                    </div>
                    <CardDescription>
                      {formatDateTime(reservation.startTime)} to {formatDateTime(reservation.endTime)}
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    {(reservation.status === 'pending' ||
                      reservation.status === 'approved' ||
                      reservation.status === 'confirmed') && (
                      <Button
                        variant="destructive"
                        onClick={() => handleCancel(reservation.id)}
                        disabled={cancelling === reservation.id}
                      >
                        {cancelling === reservation.id ? 'Cancelling...' : 'Cancel reservation'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-muted-foreground">No upcoming reservations.</p>
                <Button asChild className="mt-4">
                  <Link to="/machines">Browse machines</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {historyReservations.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Past and cancelled</h2>
              <Badge variant="secondary">{historyReservations.length}</Badge>
            </div>
            <div className="grid gap-3">
              {historyReservations.map((reservation) => (
                <Card key={reservation.id}>
                  <CardContent className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{reservation.machine.name}</p>
                      <p className="text-sm text-muted-foreground">{formatDateTime(reservation.startTime)}</p>
                    </div>
                    <Badge variant={getStatusVariant(reservation.status)} className="w-fit capitalize">
                      {reservation.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
