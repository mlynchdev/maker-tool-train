import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '~/components/Header'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { db, reservations } from '~/lib/db'
import { parseSSEMessage } from '~/lib/sse'
import { requireAuth } from '~/server/auth/middleware'
import { cancelReservation } from '~/server/api/reservations'

const getReservationsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()

  const userReservations = await db.query.reservations.findMany({
    where: eq(reservations.userId, user.id),
    with: {
      machine: true,
    },
    orderBy: [desc(reservations.startTime)],
  })

  return { user, reservations: userReservations }
})

export const Route = createFileRoute('/reservations/')({
  component: ReservationsPage,
  loader: async () => {
    return await getReservationsData()
  },
})

function ReservationsPage() {
  const { user, reservations: initialReservations } = Route.useLoaderData()
  const [reservationsList, setReservationsList] = useState(initialReservations)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const refreshReservations = useCallback(async () => {
    const latest = await getReservationsData()
    setReservationsList(latest.reservations)
  }, [])

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
      const result = await cancelReservation({ data: { reservationId } })

      if (result.success) {
        setReservationsList((prev) =>
          prev.map((reservation) =>
            reservation.id === reservationId ? { ...reservation, status: 'cancelled' as const } : reservation
          )
        )
      } else {
        alert(result.error || 'Failed to cancel reservation')
      }
    } catch {
      alert('An error occurred')
    } finally {
      setCancelling(null)
    }
  }

  const activeStatuses = ['pending', 'approved', 'confirmed']

  useEffect(() => {
    const source = new EventSource('/api/sse/bookings')

    source.onmessage = (event) => {
      const message = parseSSEMessage(event.data)
      if (!message) return
      if (message.type === 'connected') return

      if (message.event === 'booking') {
        refreshReservations()
      }
    }

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [refreshReservations])

  const upcomingReservations = reservationsList.filter(
    (reservation) => activeStatuses.includes(reservation.status) && new Date(reservation.startTime) > new Date()
  )

  const historyReservations = reservationsList.filter(
    (reservation) => !activeStatuses.includes(reservation.status) || new Date(reservation.startTime) <= new Date()
  )

  const cancelledCount = reservationsList.filter((reservation) => reservation.status === 'cancelled').length

  return (
    <div className="min-h-screen">
      <Header user={user} />

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
