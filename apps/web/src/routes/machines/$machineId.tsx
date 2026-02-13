import { Outlet, createFileRoute, Link, useChildMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility, getMachineRequirements } from '~/server/services/eligibility'
import { getMachineBookingsInRange } from '~/server/services/booking-conflicts'
import { getAvailableCheckoutSlots } from '~/server/services/checkout-scheduling'
import { getMakerspaceTimezone } from '~/server/services/makerspace-settings'
import { requestCheckoutAppointment } from '~/server/api/machines'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

const getMachineData = createServerFn({ method: 'GET' })
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
    const requirements = await getMachineRequirements(data.machineId)
    const trainingComplete = eligibility.requirements.every((req) => req.completed)

    const rangeStart = new Date()
    const rangeEnd = new Date(rangeStart)
    rangeEnd.setDate(rangeEnd.getDate() + 21)
    const bookingRangeEnd = new Date(rangeStart)
    bookingRangeEnd.setDate(bookingRangeEnd.getDate() + 14)

    const availableCheckoutSlots =
      trainingComplete && !eligibility.hasCheckout
        ? await getAvailableCheckoutSlots({
            machineId: data.machineId,
            userId: user.id,
            startTime: rangeStart,
            endTime: rangeEnd,
          })
        : []

    const upcomingBookings = await getMachineBookingsInRange(
      data.machineId,
      rangeStart,
      bookingRangeEnd
    )

    return {
      machine,
      makerspaceTimezone: await getMakerspaceTimezone(),
      eligibility,
      requirements,
      trainingComplete,
      availableCheckoutSlots,
      upcomingBookings,
    }
  })

export const Route = createFileRoute('/machines/$machineId')({
  component: MachineDetailPage,
  loader: async ({ params }) => {
    return await getMachineData({ data: { machineId: params.machineId } })
  },
})

function MachineDetailPage() {
  const {
    machine,
    makerspaceTimezone,
    eligibility,
    requirements,
    trainingComplete,
    availableCheckoutSlots,
    upcomingBookings,
  } = Route.useLoaderData()
  const childMatches = useChildMatches()
  const [checkoutSlots, setCheckoutSlots] = useState(availableCheckoutSlots)
  const [bookingSlotKey, setBookingSlotKey] = useState<string | null>(null)
  const [checkoutMessage, setCheckoutMessage] = useState('')

  if (childMatches.length > 0) {
    return <Outlet />
  }

  const formatDateTime = (value: Date) =>
    new Date(value).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: makerspaceTimezone,
    })

  const trainingDurationLabel =
    machine.trainingDurationMinutes === 60
      ? '1 hour'
      : `${machine.trainingDurationMinutes} minutes`

  const getReservationStatusVariant = (
    status: string
  ): 'success' | 'warning' | 'destructive' | 'info' => {
    if (status === 'approved' || status === 'confirmed') return 'success'
    if (status === 'pending') return 'warning'
    if (status === 'cancelled' || status === 'rejected') return 'destructive'
    return 'info'
  }

  const managerCheckoutReason = 'Manager checkout not approved'
  const outstandingEligibilityReasons =
    trainingComplete && !eligibility.hasCheckout
      ? eligibility.reasons.filter((reason) => reason !== managerCheckoutReason)
      : eligibility.reasons

  const handleBookCheckout = async (managerId: string, slotStartTime: Date) => {
    const slotKey = `${managerId}-${slotStartTime.toISOString()}`
    setBookingSlotKey(slotKey)
    setCheckoutMessage('')

    try {
      const result = await requestCheckoutAppointment({
        data: {
          machineId: machine.id,
          managerId,
          slotStartTime: slotStartTime.toISOString(),
        },
      })

      if (result.success) {
        setCheckoutMessage(
          'Checkout appointment booked. A manager/admin will meet you during that slot.'
        )
        setCheckoutSlots((prev) =>
          prev.filter(
            (slot) =>
              !(
                slot.managerId === managerId &&
                new Date(slot.startTime).getTime() === slotStartTime.getTime()
              )
          )
        )
      } else {
        setCheckoutMessage(result.error || 'Unable to book checkout appointment')
      }
    } catch {
      setCheckoutMessage('Unable to book checkout appointment')
    } finally {
      setBookingSlotKey(null)
    }
  }

  return (
    <div className="min-h-screen">
      <main className="container space-y-6 py-6 md:py-8">
        <Button asChild variant="ghost" className="w-fit px-0">
          <Link to="/machines">&larr; Back to Machines</Link>
        </Button>

        <section className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{machine.name}</h1>
            {machine.description && (
              <p className="mt-1 text-sm text-muted-foreground">{machine.description}</p>
            )}
          </div>
          {eligibility.eligible ? (
            <Badge variant="success">Eligible</Badge>
          ) : (
            <Badge variant="warning">Not eligible</Badge>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Eligibility checklist</CardTitle>
              <CardDescription>Complete each requirement to unlock reservations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium">Training requirements</p>
                {eligibility.requirements.length > 0 ? (
                  <ul className="space-y-2">
                    {eligibility.requirements.map((req) => (
                      <li
                        key={req.moduleId}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{req.moduleTitle}</p>
                          <p className="text-xs text-muted-foreground">
                            {req.watchedPercent}% watched / {req.requiredPercent}% required
                          </p>
                        </div>
                        <Badge variant={req.completed ? 'success' : 'warning'}>
                          {req.completed ? 'Complete' : 'Incomplete'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No training requirements.</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Manager checkout</p>
                <div className="rounded-lg border p-3">
                  {eligibility.hasCheckout ? (
                    <Badge variant="success">Approved by manager</Badge>
                  ) : (
                    <Badge variant="warning">Pending manager approval</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
              <CardDescription>
                {eligibility.eligible
                  ? 'You can request a reservation immediately.'
                  : 'Follow these steps to become eligible.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {eligibility.eligible ? (
                <Button asChild>
                  <Link to="/machines/$machineId/reserve" params={{ machineId: machine.id }}>
                    Request reservation
                  </Link>
                </Button>
              ) : (
                <>
                  {outstandingEligibilityReasons.length > 0 && (
                    <ul className="space-y-2">
                      {outstandingEligibilityReasons.map((reason, index) => (
                        <li key={index} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  )}

                  {eligibility.requirements.some((r) => !r.completed) && (
                    <Button asChild variant="outline">
                      <Link to="/training">Go to training</Link>
                    </Button>
                  )}

                  {trainingComplete && !eligibility.hasCheckout && (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Training is complete. Book your final in-person checkout.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Times shown in <strong>{makerspaceTimezone}</strong>. Duration is{' '}
                        <strong>{trainingDurationLabel}</strong>.
                      </p>

                      {checkoutMessage && (
                        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                          <AlertTitle>Checkout update</AlertTitle>
                          <AlertDescription>{checkoutMessage}</AlertDescription>
                        </Alert>
                      )}

                      {checkoutSlots.length > 0 ? (
                        <div className="space-y-2">
                          {checkoutSlots.map((slot) => {
                            const slotKey = `${slot.managerId}-${new Date(slot.startTime).toISOString()}`

                            return (
                              <div
                                key={slotKey}
                                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="text-sm">
                                  <p>
                                    <span className="font-medium">Start:</span>{' '}
                                    {formatDateTime(slot.startTime)}
                                  </p>
                                  <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground">With:</span>{' '}
                                    {slot.manager.name || slot.manager.email}
                                  </p>
                                </div>
                                <Button
                                  onClick={() =>
                                    handleBookCheckout(slot.managerId, new Date(slot.startTime))
                                  }
                                  disabled={bookingSlotKey === slotKey}
                                >
                                  {bookingSlotKey === slotKey ? 'Booking...' : 'Book checkout'}
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No checkout slots are currently available.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {requirements.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold tracking-tight">Required training modules</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {requirements.map((req) => {
                const status = eligibility.requirements.find((r) => r.moduleId === req.moduleId)
                return (
                  <Link
                    key={req.moduleId}
                    to="/training/$moduleId"
                    params={{ moduleId: req.moduleId }}
                    className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex items-center justify-between gap-3 pt-6">
                        <p className="text-sm font-medium">{req.module.title}</p>
                        {status?.completed ? (
                          <Badge variant="success">Done</Badge>
                        ) : (
                          <Badge variant="warning">{status?.watchedPercent || 0}%</Badge>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Upcoming reservation schedule</h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Next 14 days</CardTitle>
              <CardDescription>
                Shared schedule helps you plan project time before requesting a booking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingBookings.length > 0 ? (
                <div className="space-y-2">
                  {upcomingBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="text-sm">
                        <p>
                          <span className="font-medium">Start:</span>{' '}
                          {formatDateTime(booking.startTime)}
                        </p>
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">End:</span>{' '}
                          {formatDateTime(booking.endTime)}
                        </p>
                      </div>
                      <Badge variant={getReservationStatusVariant(booking.status)} className="w-fit capitalize">
                        {booking.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No reserved blocks are scheduled in the next 14 days.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
