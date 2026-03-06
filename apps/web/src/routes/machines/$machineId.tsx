import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Outlet, createFileRoute, Link, useChildMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { db, machines } from '~/lib/db'
import { queryKeys } from '~/lib/query/keys'
import { requestCheckoutAppointment } from '~/server/api/machines'
import { requireAuth } from '~/server/auth/middleware'
import { getMachineBookingsInRange } from '~/server/services/booking-conflicts'
import { getAvailableCheckoutSlots } from '~/server/services/checkout-scheduling'
import { checkEligibility, getMachineRequirements } from '~/server/services/eligibility'
import { getMakerspaceTimezone } from '~/server/services/makerspace-settings'

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
    const trainingComplete = eligibility.requirements.every((requirement) => requirement.completed)

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

type MachineDetailData = Awaited<ReturnType<typeof getMachineData>>

const machineDetailDataQueryOptions = (machineId: string) =>
  queryOptions({
    queryKey: queryKeys.machines.detail(machineId),
    queryFn: () => getMachineData({ data: { machineId } }),
  })

export const Route = createFileRoute('/machines/$machineId')({
  component: MachineDetailPage,
})

function MachineDetailPage() {
  const { machineId } = Route.useParams()
  const childMatches = useChildMatches()
  const queryClient = useQueryClient()
  const machineDetailQuery = useQuery({
    ...machineDetailDataQueryOptions(machineId),
    enabled: childMatches.length === 0,
  })

  const [bookingSlotKey, setBookingSlotKey] = useState<string | null>(null)
  const [checkoutMessage, setCheckoutMessage] = useState('')

  const requestCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Unable to submit checkout request',
    },
    mutationFn: async (variables: {
      machineId: string
      managerId: string
      slotStartTimeIso: string
    }) => {
      const result = await requestCheckoutAppointment({
        data: {
          machineId: variables.machineId,
          managerId: variables.managerId,
          slotStartTime: variables.slotStartTimeIso,
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Unable to submit checkout request')
      }

      return result
    },
    onSuccess: (_result, variables) => {
      setCheckoutMessage('Checkout request submitted. Status: pending admin review.')

      queryClient.setQueryData<MachineDetailData>(
        queryKeys.machines.detail(variables.machineId),
        (current) => {
          if (!current) return current

          return {
            ...current,
            availableCheckoutSlots: current.availableCheckoutSlots.filter(
              (slot) =>
                !(
                  slot.managerId === variables.managerId &&
                  new Date(slot.startTime).toISOString() === variables.slotStartTimeIso
                )
            ),
          }
        }
      )
    },
    onError: () => {
      setCheckoutMessage('Unable to submit checkout request')
    },
    onSettled: (_result, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.machines.detail(variables.machineId),
      })
    },
  })

  if (childMatches.length > 0) {
    return <Outlet />
  }

  if (machineDetailQuery.isPending && typeof machineDetailQuery.data === 'undefined') {
    return <QueryLoadingScreen message="Loading machine details..." />
  }

  if (machineDetailQuery.isError && typeof machineDetailQuery.data === 'undefined') {
    return (
      <QueryErrorScreen
        message="Unable to load machine details."
        onRetry={() => {
          void machineDetailQuery.refetch()
        }}
      />
    )
  }

  const machine = machineDetailQuery.data?.machine
  const makerspaceTimezone = machineDetailQuery.data?.makerspaceTimezone ?? 'UTC'
  const eligibility = machineDetailQuery.data?.eligibility
  const requirements = machineDetailQuery.data?.requirements ?? []
  const trainingComplete = machineDetailQuery.data?.trainingComplete ?? false
  const checkoutSlots = machineDetailQuery.data?.availableCheckoutSlots ?? []
  const upcomingBookings = machineDetailQuery.data?.upcomingBookings ?? []

  if (!machine || !eligibility) {
    return <QueryErrorScreen message="Machine details are unavailable." />
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
    const slotStartTimeIso = slotStartTime.toISOString()
    const slotKey = `${managerId}-${slotStartTimeIso}`
    setBookingSlotKey(slotKey)
    setCheckoutMessage('')

    try {
      await requestCheckoutMutation.mutateAsync({
        machineId: machine.id,
        managerId,
        slotStartTimeIso,
      })
    } catch {
      // Error handling is managed in mutation callbacks.
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
            {machine.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{machine.description}</p>
            ) : null}
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
                    {eligibility.requirements.map((requirement) => (
                      <li
                        key={requirement.moduleId}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{requirement.moduleTitle}</p>
                          <p className="text-xs text-muted-foreground">
                            {requirement.watchedPercent}% watched / {requirement.requiredPercent}% required
                          </p>
                        </div>
                        <Badge variant={requirement.completed ? 'success' : 'warning'}>
                          {requirement.completed ? 'Complete' : 'Incomplete'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No training requirements.</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">In-person checkout</p>
                <div className="rounded-lg border p-3">
                  {eligibility.hasCheckout ? (
                    <Badge variant="success">Checkout completed</Badge>
                  ) : (
                    <Badge variant="warning">Required before reservations</Badge>
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
                  {outstandingEligibilityReasons.length > 0 ? (
                    <ul className="space-y-2">
                      {outstandingEligibilityReasons.map((reason, index) => (
                        <li key={index} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {eligibility.requirements.some((requirement) => !requirement.completed) ? (
                    <Button asChild variant="outline">
                      <Link to="/training">Go to training</Link>
                    </Button>
                  ) : null}

                  {trainingComplete && !eligibility.hasCheckout ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Training is complete. Request your in-person checkout appointment.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Times shown in <strong>{makerspaceTimezone}</strong>. Duration is{' '}
                        <strong>{trainingDurationLabel}</strong>.
                      </p>

                      {checkoutMessage ? (
                        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
                          <AlertTitle>Checkout update</AlertTitle>
                          <AlertDescription>{checkoutMessage}</AlertDescription>
                        </Alert>
                      ) : null}

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
                                  {bookingSlotKey === slotKey ? 'Submitting...' : 'Request checkout'}
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
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {requirements.length > 0 ? (
          <section>
            <h2 className="mb-3 text-xl font-semibold tracking-tight">Required training modules</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {requirements.map((requirement) => {
                const status = eligibility.requirements.find(
                  (item) => item.moduleId === requirement.moduleId
                )
                return (
                  <Link
                    key={requirement.moduleId}
                    to="/training/$moduleId"
                    params={{ moduleId: requirement.moduleId }}
                    className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-shadow hover:shadow-md">
                      <CardContent className="flex items-center justify-between gap-3 pt-6">
                        <p className="text-sm font-medium">{requirement.module.title}</p>
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
        ) : null}

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
                      <Badge
                        variant={getReservationStatusVariant(booking.status)}
                        className="w-fit capitalize"
                      >
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
