import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, users, machines } from '~/lib/db'
import { checkEligibility } from '~/server/services/eligibility'
import { Header } from '~/components/Header'
import { approveCheckout } from '~/server/api/admin'

const getCheckoutsData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireManager()

  // Get all members
  const allUsers = await db.query.users.findMany({
    where: eq(users.role, 'member'),
    with: {
      managerCheckouts: {
        with: {
          machine: true,
        },
      },
    },
  })

  const allMachines = await db.query.machines.findMany({
    where: eq(machines.active, true),
  })

  // Find users ready for checkout (completed training but no checkout)
  const pendingApprovals = []

  for (const member of allUsers) {
    if (member.status !== 'active') continue

    for (const machine of allMachines) {
      const hasCheckout = member.managerCheckouts.some(
        (c) => c.machineId === machine.id
      )
      if (hasCheckout) continue

      const eligibility = await checkEligibility(member.id, machine.id)
      const trainingComplete = eligibility.requirements.every((r) => r.completed)

      if (trainingComplete) {
        pendingApprovals.push({
          user: {
            id: member.id,
            email: member.email,
            name: member.name,
          },
          machine: {
            id: machine.id,
            name: machine.name,
          },
          trainingStatus: eligibility.requirements,
        })
      }
    }
  }

  return { user, pendingApprovals }
})

export const Route = createFileRoute('/admin/checkouts')({
  component: CheckoutsPage,
  loader: async () => {
    return await getCheckoutsData()
  },
})

function CheckoutsPage() {
  const { user, pendingApprovals: initialApprovals } = Route.useLoaderData()
  const [pendingApprovals, setPendingApprovals] = useState(initialApprovals)
  const [approving, setApproving] = useState<string | null>(null)

  const handleApprove = async (userId: string, machineId: string) => {
    const key = `${userId}-${machineId}`
    setApproving(key)

    try {
      const result = await approveCheckout({ userId, machineId })

      if (result.success) {
        setPendingApprovals((prev) =>
          prev.filter((a) => !(a.user.id === userId && a.machine.id === machineId))
        )
      } else {
        alert(result.error || 'Failed to approve checkout')
      }
    } catch (error) {
      alert('An error occurred')
    } finally {
      setApproving(null)
    }
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">Pending Checkouts</h1>

          {pendingApprovals.length > 0 ? (
            <div className="card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Machine</th>
                    <th>Training Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map((approval) => {
                    const key = `${approval.user.id}-${approval.machine.id}`
                    return (
                      <tr key={key}>
                        <td>
                          <div>{approval.user.name || approval.user.email}</div>
                          {approval.user.name && (
                            <div className="text-small text-muted">
                              {approval.user.email}
                            </div>
                          )}
                        </td>
                        <td>{approval.machine.name}</td>
                        <td>
                          <span className="badge badge-success">
                            All training complete
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button
                              className="btn btn-success"
                              onClick={() =>
                                handleApprove(approval.user.id, approval.machine.id)
                              }
                              disabled={approving === key}
                            >
                              {approving === key ? 'Approving...' : 'Approve'}
                            </button>
                            <Link
                              to="/admin/checkouts/$userId"
                              params={{ userId: approval.user.id }}
                              className="btn btn-secondary"
                            >
                              View Details
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              <p className="text-center text-muted">
                No pending checkout approvals.
              </p>
              <p className="text-center text-small text-muted mt-1">
                Members will appear here once they complete all required training
                for a machine.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
