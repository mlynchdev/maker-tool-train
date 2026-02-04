import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { checkEligibility, getMachineRequirements } from '~/server/services/eligibility'
import { Header } from '~/components/Header'

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

    return { user, machine, eligibility, requirements }
  })

export const Route = createFileRoute('/machines/$machineId')({
  component: MachineDetailPage,
  loader: async ({ params }) => {
    return await getMachineData({ machineId: params.machineId })
  },
})

function MachineDetailPage() {
  const { user, machine, eligibility, requirements } = Route.useLoaderData()

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/machines" className="text-small">
              &larr; Back to Machines
            </Link>
          </div>

          <div className="flex flex-between flex-center mb-2">
            <h1>{machine.name}</h1>
            {eligibility.eligible ? (
              <span className="badge badge-success">Eligible</span>
            ) : (
              <span className="badge badge-warning">Not Eligible</span>
            )}
          </div>

          {machine.description && (
            <p className="text-muted mb-3">{machine.description}</p>
          )}

          <div className="grid grid-2">
            {/* Eligibility Status */}
            <div className="card">
              <h3 className="card-title mb-2">Eligibility Checklist</h3>

              {/* Training Requirements */}
              <h4 className="text-small mb-1">Training Requirements</h4>
              {eligibility.requirements.length > 0 ? (
                <ul className="eligibility-list">
                  {eligibility.requirements.map((req) => (
                    <li key={req.moduleId} className="eligibility-item">
                      <span
                        className={`eligibility-icon ${req.completed ? 'complete' : 'incomplete'}`}
                      >
                        {req.completed ? '✓' : '!'}
                      </span>
                      <div>
                        <span className="text-small">{req.moduleTitle}</span>
                        <span className="text-small text-muted" style={{ marginLeft: '0.5rem' }}>
                          ({req.watchedPercent}% / {req.requiredPercent}%)
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted">No training requirements.</p>
              )}

              {/* Manager Checkout */}
              <h4 className="text-small mt-2 mb-1">Manager Checkout</h4>
              <div className="eligibility-item">
                <span
                  className={`eligibility-icon ${eligibility.hasCheckout ? 'complete' : 'incomplete'}`}
                >
                  {eligibility.hasCheckout ? '✓' : '!'}
                </span>
                <span className="text-small">
                  {eligibility.hasCheckout
                    ? 'Approved by manager'
                    : 'Pending manager approval'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="card">
              <h3 className="card-title mb-2">Actions</h3>

              {eligibility.eligible ? (
                <div>
                  <p className="text-small text-muted mb-2">
                    You are eligible to reserve this machine.
                  </p>
                  <Link
                    to="/machines/$machineId/reserve"
                    params={{ machineId: machine.id }}
                    className="btn btn-primary"
                  >
                    Make Reservation
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-small text-muted mb-2">
                    Complete the following to become eligible:
                  </p>
                  <ul className="eligibility-list">
                    {eligibility.reasons.map((reason, i) => (
                      <li key={i} className="eligibility-item">
                        <span className="eligibility-icon incomplete">!</span>
                        <span className="text-small">{reason}</span>
                      </li>
                    ))}
                  </ul>

                  {eligibility.requirements.some((r) => !r.completed) && (
                    <Link to="/training" className="btn btn-secondary mt-2">
                      Go to Training
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Training Modules Required */}
          {requirements.length > 0 && (
            <div className="card mt-2">
              <h3 className="card-title mb-2">Required Training Modules</h3>
              <div className="grid grid-3">
                {requirements.map((req) => {
                  const status = eligibility.requirements.find(
                    (r) => r.moduleId === req.moduleId
                  )
                  return (
                    <Link
                      key={req.moduleId}
                      to="/training/$moduleId"
                      params={{ moduleId: req.moduleId }}
                      className="card"
                      style={{
                        textDecoration: 'none',
                        color: 'inherit',
                        border: status?.completed
                          ? '1px solid #28a745'
                          : '1px solid #e0e0e0',
                      }}
                    >
                      <div className="flex flex-between flex-center">
                        <span className="text-small">{req.module.title}</span>
                        {status?.completed ? (
                          <span className="badge badge-success">Done</span>
                        ) : (
                          <span className="badge badge-warning">
                            {status?.watchedPercent || 0}%
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
