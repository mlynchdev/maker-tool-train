import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { useCallback, useEffect, useState } from 'react'
import { Header } from '~/components/Header'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
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
    } catch (error) {
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

  const pastReservations = reservationsList.filter(
    (reservation) => !activeStatuses.includes(reservation.status) || new Date(reservation.startTime) <= new Date()
  )

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">My Reservations</h1>
          <Button asChild>
            <Link to="/machines">New Reservation</Link>
          </Button>
        </div>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Upcoming</h2>
          {upcomingReservations.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingReservations.map((reservation) => (
                <Card key={reservation.id}>
                  <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
                    <CardTitle className="text-lg">{reservation.machine.name}</CardTitle>
                    <Badge variant={getStatusVariant(reservation.status)} className="capitalize">
                      {reservation.status}
                    </Badge>
                  </CardHeader>

                  <CardContent>
                    <p className="mb-1 text-sm">
                      <span className="font-medium">Start:</span> {formatDateTime(reservation.startTime)}
                    </p>
                    <p className="mb-4 text-sm">
                      <span className="font-medium">End:</span> {formatDateTime(reservation.endTime)}
                    </p>

                    {(reservation.status === 'pending' ||
                      reservation.status === 'approved' ||
                      reservation.status === 'confirmed') && (
                      <Button
                        variant="destructive"
                        onClick={() => handleCancel(reservation.id)}
                        disabled={cancelling === reservation.id}
                      >
                        {cancelling === reservation.id ? 'Cancelling...' : 'Cancel'}
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
                  <Link to="/machines">Browse Machines</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {pastReservations.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold tracking-tight">Past & Cancelled</h2>
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Machine</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastReservations.map((reservation) => (
                      <TableRow key={reservation.id}>
                        <TableCell className="font-medium">{reservation.machine.name}</TableCell>
                        <TableCell>{formatDateTime(reservation.startTime)}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(reservation.status)} className="capitalize">
                            {reservation.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  )
}
