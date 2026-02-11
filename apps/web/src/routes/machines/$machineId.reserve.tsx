import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { calcom } from '~/server/services/calcom'
import { Header } from '~/components/Header'
import { AvailabilityPicker } from '~/components/AvailabilityPicker'
import { reserveMachine } from '~/server/api/machines'

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

    if (!eligibility.eligible) {
      throw new Response('Not eligible to reserve this machine', { status: 403 })
    }

    // Fetch availability for next 14 days
    let slots: { time: string }[] = []
    if (machine.calcomEventTypeId) {
      const startDate = new Date()
      const endDate = new Date()
      endDate.setDate(endDate.getDate() + 14)

      try {
        slots = await calcom.getAvailability(
          machine.calcomEventTypeId,
          startDate,
          endDate
        )
      } catch (error) {
        console.error('Failed to fetch availability:', error)
      }
    }

    return { user, machine, slots }
  })

export const Route = createFileRoute('/machines/$machineId/reserve')({
  component: ReserveMachinePage,
  loader: async ({ params }) => {
    return await getReserveData({ data: { machineId: params.machineId } })
  },
})

function ReserveMachinePage() {
  const { user, machine, slots } = Route.useLoaderData()
  const navigate = useNavigate()
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleReserve = async () => {
    if (!selectedSlot) return

    setLoading(true)
    setError('')

    try {
      // Calculate end time (assume 1 hour slots)
      const startTime = new Date(selectedSlot)
      const endTime = new Date(startTime)
      endTime.setHours(endTime.getHours() + 1)

      const result = await reserveMachine({
        data: {
          machineId: machine.id,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
      })

      if (result.success) {
        navigate({ to: '/reservations' })
      } else {
        setError(result.error || 'Failed to create reservation')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link
              to="/machines/$machineId"
              params={{ machineId: machine.id }}
              className="text-small"
            >
              &larr; Back to {machine.name}
            </Link>
          </div>

          <h1 className="mb-3">Reserve {machine.name}</h1>

          {error && <div className="alert alert-danger mb-2">{error}</div>}

          <div className="card">
            <h3 className="card-title mb-2">Select a Time Slot</h3>

            {slots.length > 0 ? (
              <>
                <AvailabilityPicker
                  slots={slots}
                  selectedSlot={selectedSlot}
                  onSelect={setSelectedSlot}
                />

                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={handleReserve}
                    disabled={!selectedSlot || loading}
                  >
                    {loading ? 'Reserving...' : 'Confirm Reservation'}
                  </button>
                  <Link
                    to="/machines/$machineId"
                    params={{ machineId: machine.id }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </Link>
                </div>
              </>
            ) : (
              <div className="alert alert-warning">
                {machine.calcomEventTypeId
                  ? 'No available time slots found for the next 14 days.'
                  : 'This machine is not configured for online scheduling. Please contact an administrator.'}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
