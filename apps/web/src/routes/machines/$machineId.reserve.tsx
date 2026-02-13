import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useMemo, useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { getMachineBookingsInRange } from '~/server/services/booking-conflicts'
import { reserveMachine } from '~/server/api/machines'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

function formatDateTimeLocal(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDisplayDate(dateValue: Date | string) {
  return new Date(dateValue).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const getReserveData = createServerFn({ method: 'GET' })
  .inputValidator((data: { machineId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuth()

    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      throw new Response('Machine not found', { status: 404 })
    }

    const eligibility = await checkEligibility(user.id, data.machineId)

    const now = new Date()
    const horizon = new Date(now)
    horizon.setDate(horizon.getDate() + 14)

    const bookings = await getMachineBookingsInRange(machine.id, now, horizon)

    return { machine, bookings, eligibility }
  })

export const Route = createFileRoute('/machines/$machineId/reserve')({
  component: ReserveMachinePage,
  loader: async ({ params }) => {
    return await getReserveData({ data: { machineId: params.machineId } })
  },
})

function ReserveMachinePage() {
  const { machine, bookings, eligibility } = Route.useLoaderData()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const defaultRange = useMemo(() => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    const end = new Date(start)
    end.setHours(end.getHours() + 1)
    return {
      start: formatDateTimeLocal(start),
      end: formatDateTimeLocal(end),
    }
  }, [])

  const [startTime, setStartTime] = useState(defaultRange.start)
  const [endTime, setEndTime] = useState(defaultRange.end)

  const handleReserve = async () => {
    const start = new Date(startTime)
    const end = new Date(endTime)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('Please select valid start and end times.')
      return
    }

    if (end <= start) {
      setError('End time must be after start time.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const result = await reserveMachine({
        data: {
          machineId: machine.id,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      })

      if (result.success) {
        navigate({ to: '/reservations' })
      } else {
        const reasonText =
          result.reasons && result.reasons.length > 0
            ? ` (${result.reasons.join('; ')})`
            : ''
        setError((result.error || 'Failed to create reservation request') + reasonText)
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getStatusVariant = (status: string): 'success' | 'warning' | 'destructive' | 'info' => {
    if (status === 'approved' || status === 'confirmed' || status === 'completed') {
      return 'success'
    }
    if (status === 'pending') return 'warning'
    if (status === 'cancelled' || status === 'rejected') return 'destructive'
    return 'info'
  }

  return (
    <div className="min-h-screen">
      <main className="container space-y-6 py-6 md:py-8">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link to="/machines/$machineId" params={{ machineId: machine.id }}>
            &larr; Back to {machine.name}
          </Link>
        </Button>

        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Request Time on {machine.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose your time range, then submit for review.
          </p>
        </section>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Reservation request failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose start and end time</CardTitle>
            <CardDescription>Times are interpreted in your current local timezone.</CardDescription>
          </CardHeader>
          <CardContent>
            {eligibility.eligible ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="start-time">Start time</Label>
                    <Input
                      id="start-time"
                      type="datetime-local"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="end-time">End time</Label>
                    <Input
                      id="end-time"
                      type="datetime-local"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleReserve} disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit request'}
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/machines/$machineId" params={{ machineId: machine.id }}>
                      Cancel
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900">
                <AlertTitle>You are not eligible yet</AlertTitle>
                <AlertDescription>
                  <p className="mb-2">Complete these requirements before requesting time:</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {eligibility.reasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming booked times (next 14 days)</CardTitle>
            <CardDescription>Use this to avoid conflicts before submitting your request.</CardDescription>
          </CardHeader>
          <CardContent>
            {bookings.length > 0 ? (
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="text-sm">
                      <p>
                        <span className="font-medium">Start:</span> {formatDisplayDate(booking.startTime)}
                      </p>
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">End:</span> {formatDisplayDate(booking.endTime)}
                      </p>
                    </div>
                    <Badge variant={getStatusVariant(booking.status)} className="w-fit capitalize">
                      {booking.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No upcoming bookings in the next 14 days.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
