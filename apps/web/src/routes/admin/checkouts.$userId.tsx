import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, users, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { Header } from '~/components/Header'
import { approveCheckout, revokeCheckout } from '~/server/api/admin'

const getUserCheckoutData = createServerFn({ method: 'GET' })
  .validator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const currentUser = await requireManager()

    const member = await db.query.users.findFirst({
      where: eq(users.id, data.userId),
      with: {
        trainingProgress: {
          with: {
            module: true,
          },
        },
        managerCheckouts: {
          with: {
            machine: true,
            approver: true,
          },
        },
      },
    })

    if (!member) {
      throw new Response('User not found', { status: 404 })
    }

    const allMachines = await db.query.machines.findMany({
      where: eq(machines.active, true),
    })

    const machineStatuses = await Promise.all(
      allMachines.map(async (machine) => {
        const eligibility = await checkEligibility(member.id, machine.id)
        const hasCheckout = member.managerCheckouts.some(
          (c) => c.machineId === machine.id
        )
        const checkout = member.managerCheckouts.find(
          (c) => c.machineId === machine.id
        )
        return {
          machine,
          eligibility,
          hasCheckout,
          checkout,
        }
      })
    )

    return { user: currentUser, member, machineStatuses }
  })

export const Route = createFileRoute('/admin/checkouts/$userId')({
  component: UserCheckoutPage,
  loader: async ({ params }) => {
    return await getUserCheckoutData({ data: { userId: params.userId } })
  },
})

function UserCheckoutPage() {
  const { user, member, machineStatuses: initialStatuses } = Route.useLoaderData()
  const [machineStatuses, setMachineStatuses] = useState(initialStatuses)
  const [processing, setProcessing] = useState<string | null>(null)

  const handleApprove = async (machineId: string) => {
    setProcessing(machineId)

    try {
      const result = await approveCheckout({
        data: { userId: member.id, machineId },
      })

      if (result.success) {
        setMachineStatuses((prev) =>
          prev.map((s) =>
            s.machine.id === machineId
              ? {
                  ...s,
                  hasCheckout: true,
                  checkout: result.checkout,
                  eligibility: { ...s.eligibility, hasCheckout: true },
                }
              : s
          )
        )
      } else {
        alert(result.error || 'Failed to approve')
      }
    } catch (error) {
      alert('An error occurred')
    } finally {
      setProcessing(null)
    }
  }

  const handleRevoke = async (machineId: string) => {
    if (!confirm('Are you sure you want to revoke this checkout?')) return

    setProcessing(machineId)

    try {
      const result = await revokeCheckout({
        data: { userId: member.id, machineId },
      })

      if (result.success) {
        setMachineStatuses((prev) =>
          prev.map((s) =>
            s.machine.id === machineId
              ? {
                  ...s,
                  hasCheckout: false,
                  checkout: undefined,
                  eligibility: { ...s.eligibility, hasCheckout: false },
                }
              : s
          )
        )
      } else {
        alert(result.error || 'Failed to revoke')
      }
    } catch (error) {
      alert('An error occurred')
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/admin/checkouts" className="text-small">
              &larr; Back to Checkouts
            </Link>
          </div>

          <h1 className="mb-1">{member.name || member.email}</h1>
          {member.name && <p className="text-muted mb-3">{member.email}</p>}

          {/* Training Progress */}
          <div className="card mb-3">
            <h3 className="card-title mb-2">Training Progress</h3>
            {member.trainingProgress.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Progress</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {member.trainingProgress.map((progress) => {
                    const percent = Math.floor(
                      (progress.watchedSeconds / progress.module.durationSeconds) * 100
                    )
                    return (
                      <tr key={progress.id}>
                        <td>{progress.module.title}</td>
                        <td>
                          <div className="progress" style={{ width: '100px' }}>
                            <div
                              className={`progress-bar ${percent >= 90 ? 'complete' : ''}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className="text-small text-muted ml-1">
                            {percent}%
                          </span>
                        </td>
                        <td>
                          {progress.completedAt ? (
                            <span className="badge badge-success">Complete</span>
                          ) : (
                            <span className="badge badge-warning">In Progress</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-muted">No training progress recorded.</p>
            )}
          </div>

          {/* Machine Checkouts */}
          <div className="card">
            <h3 className="card-title mb-2">Machine Checkouts</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Machine</th>
                  <th>Training</th>
                  <th>Checkout Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {machineStatuses.map((status) => {
                  const trainingComplete = status.eligibility.requirements.every(
                    (r) => r.completed
                  )
                  return (
                    <tr key={status.machine.id}>
                      <td>{status.machine.name}</td>
                      <td>
                        {status.eligibility.requirements.length === 0 ? (
                          <span className="text-muted">No requirements</span>
                        ) : trainingComplete ? (
                          <span className="badge badge-success">Complete</span>
                        ) : (
                          <span className="badge badge-warning">
                            {status.eligibility.requirements.filter((r) => r.completed).length}/
                            {status.eligibility.requirements.length}
                          </span>
                        )}
                      </td>
                      <td>
                        {status.hasCheckout ? (
                          <span className="badge badge-success">Approved</span>
                        ) : (
                          <span className="badge badge-warning">Pending</span>
                        )}
                      </td>
                      <td>
                        {status.hasCheckout ? (
                          <button
                            className="btn btn-danger"
                            onClick={() => handleRevoke(status.machine.id)}
                            disabled={processing === status.machine.id}
                          >
                            {processing === status.machine.id
                              ? 'Revoking...'
                              : 'Revoke'}
                          </button>
                        ) : trainingComplete ? (
                          <button
                            className="btn btn-success"
                            onClick={() => handleApprove(status.machine.id)}
                            disabled={processing === status.machine.id}
                          >
                            {processing === status.machine.id
                              ? 'Approving...'
                              : 'Approve'}
                          </button>
                        ) : (
                          <span className="text-muted text-small">
                            Training incomplete
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
