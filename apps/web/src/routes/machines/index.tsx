import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { Header } from '~/components/Header'

const getMachinesData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()

  const machineList = await db.query.machines.findMany({
    where: eq(machines.active, true),
  })

  const machinesWithEligibility = await Promise.all(
    machineList.map(async (machine) => {
      const eligibility = await checkEligibility(user.id, machine.id)
      return {
        ...machine,
        eligibility,
      }
    })
  )

  return { user, machines: machinesWithEligibility }
})

export const Route = createFileRoute('/machines/')({
  component: MachinesPage,
  loader: async () => {
    return await getMachinesData()
  },
})

function MachinesPage() {
  const { user, machines } = Route.useLoaderData()

  const eligibleCount = machines.filter((m) => m.eligibility.eligible).length

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="flex flex-between flex-center mb-3">
            <h1>Machines</h1>
            <span className="badge badge-info">
              {eligibleCount} / {machines.length} available
            </span>
          </div>

          <div className="grid grid-2">
            {machines.map((machine) => (
              <Link
                key={machine.id}
                to="/machines/$machineId"
                params={{ machineId: machine.id }}
                className="card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card-header">
                  <h3 className="card-title">{machine.name}</h3>
                  {machine.eligibility.eligible ? (
                    <span className="badge badge-success">Available</span>
                  ) : (
                    <span className="badge badge-warning">Requirements</span>
                  )}
                </div>

                {machine.description && (
                  <p className="text-muted text-small mb-2">{machine.description}</p>
                )}

                {!machine.eligibility.eligible && (
                  <div className="mt-2">
                    <p className="text-small text-muted">Missing requirements:</p>
                    <ul className="eligibility-list">
                      {machine.eligibility.reasons.slice(0, 2).map((reason, i) => (
                        <li key={i} className="eligibility-item">
                          <span className="eligibility-icon incomplete">!</span>
                          <span className="text-small">{reason}</span>
                        </li>
                      ))}
                      {machine.eligibility.reasons.length > 2 && (
                        <li className="text-small text-muted">
                          +{machine.eligibility.reasons.length - 2} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {machine.eligibility.eligible && (
                  <p className="text-small text-muted mt-2">
                    Click to view availability and make a reservation.
                  </p>
                )}
              </Link>
            ))}
          </div>

          {machines.length === 0 && (
            <div className="card">
              <p className="text-center text-muted">No machines available.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
