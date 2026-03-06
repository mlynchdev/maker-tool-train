import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { useState } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { db, machines, users } from '~/lib/db'
import { queryKeys } from '~/lib/query/keys'
import { approveCheckout, revokeCheckout } from '~/server/api/admin'
import { requireManager } from '~/server/auth/middleware'
import { checkEligibility } from '~/server/services/eligibility'

const getUserCheckoutData = createServerFn({ method: 'GET' })
  .inputValidator((data: { userId: string }) => data)
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
          (checkout) => checkout.machineId === machine.id
        )
        const checkout = member.managerCheckouts.find(
          (checkout) => checkout.machineId === machine.id
        )
        return {
          machine,
          eligibility,
          hasCheckout,
          checkout,
        }
      })
    )

    return { currentUser, member, machineStatuses }
  })

type UserCheckoutData = Awaited<ReturnType<typeof getUserCheckoutData>>

const userCheckoutDataQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: queryKeys.admin.userCheckouts(userId),
    queryFn: () => getUserCheckoutData({ data: { userId } }),
  })

export const Route = createFileRoute('/admin/checkouts/$userId')({
  component: UserCheckoutPage,
})

function UserCheckoutPage() {
  const { userId } = Route.useParams()
  const queryClient = useQueryClient()
  const userCheckoutsQuery = useQuery(userCheckoutDataQueryOptions(userId))
  const [processing, setProcessing] = useState<string | null>(null)

  const approveCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Failed to approve checkout',
    },
    mutationFn: async (variables: { memberId: string; machineId: string }) => {
      const result = await approveCheckout({
        data: {
          userId: variables.memberId,
          machineId: variables.machineId,
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to approve checkout')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.userCheckouts(userId) })
      const previousData = queryClient.getQueryData<UserCheckoutData>(
        queryKeys.admin.userCheckouts(userId)
      )

      queryClient.setQueryData<UserCheckoutData>(
        queryKeys.admin.userCheckouts(userId),
        (current) => {
          if (!current) return current

          return {
            ...current,
            machineStatuses: current.machineStatuses.map((status) =>
              status.machine.id === variables.machineId
                ? {
                    ...status,
                    hasCheckout: true,
                    eligibility: { ...status.eligibility, hasCheckout: true },
                  }
                : status
            ),
          }
        }
      )

      return { previousData }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.admin.userCheckouts(userId), context.previousData)
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.userCheckouts(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
      ])
    },
  })

  const revokeCheckoutMutation = useMutation({
    meta: {
      errorMessage: 'Failed to revoke checkout',
    },
    mutationFn: async (variables: { memberId: string; machineId: string }) => {
      const result = await revokeCheckout({
        data: {
          userId: variables.memberId,
          machineId: variables.machineId,
        },
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to revoke checkout')
      }

      return result
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.userCheckouts(userId) })
      const previousData = queryClient.getQueryData<UserCheckoutData>(
        queryKeys.admin.userCheckouts(userId)
      )

      queryClient.setQueryData<UserCheckoutData>(
        queryKeys.admin.userCheckouts(userId),
        (current) => {
          if (!current) return current

          return {
            ...current,
            machineStatuses: current.machineStatuses.map((status) =>
              status.machine.id === variables.machineId
                ? {
                    ...status,
                    hasCheckout: false,
                    checkout: undefined,
                    eligibility: { ...status.eligibility, hasCheckout: false },
                  }
                : status
            ),
          }
        }
      )

      return { previousData }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKeys.admin.userCheckouts(userId), context.previousData)
      }
    },
    onSettled: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.userCheckouts(userId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() }),
      ])
    },
  })

  if (userCheckoutsQuery.isPending && typeof userCheckoutsQuery.data === 'undefined') {
    return <QueryLoadingScreen message="Loading member checkout profile..." />
  }

  if (userCheckoutsQuery.isError && typeof userCheckoutsQuery.data === 'undefined') {
    return (
      <QueryErrorScreen
        message="Unable to load member checkout profile."
        onRetry={() => {
          void userCheckoutsQuery.refetch()
        }}
      />
    )
  }

  const currentUser = userCheckoutsQuery.data?.currentUser
  const member = userCheckoutsQuery.data?.member
  const machineStatuses = userCheckoutsQuery.data?.machineStatuses ?? []

  if (!currentUser || !member) {
    return <QueryErrorScreen message="Member checkout profile not found." />
  }

  const canManageCheckouts = currentUser.role === 'admin'

  const handleApprove = async (machineId: string) => {
    setProcessing(machineId)

    try {
      await approveCheckoutMutation.mutateAsync({
        memberId: member.id,
        machineId,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setProcessing(null)
    }
  }

  const handleRevoke = async (machineId: string) => {
    if (!confirm('Are you sure you want to revoke this checkout?')) return

    setProcessing(machineId)

    try {
      await revokeCheckoutMutation.mutateAsync({
        memberId: member.id,
        machineId,
      })
    } catch {
      // Error handling and rollback is managed in mutation callbacks.
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div>
      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/admin/checkouts" className="text-small">
              &larr; Back to Checkouts
            </Link>
          </div>

          <h1 className="mb-1">{member.name || member.email}</h1>
          {member.name ? <p className="text-muted mb-3">{member.email}</p> : null}

          <div className="card mb-3">
            <h3 className="card-title mb-2">Training Progress</h3>
            {member.trainingProgress.length > 0 ? (
              <div className="table-wrapper">
                <table className="table table-mobile-cards">
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
                          <td data-label="Module">{progress.module.title}</td>
                          <td data-label="Progress">
                            <div>
                              <div className="progress" style={{ width: '100px' }}>
                                <div
                                  className={`progress-bar ${percent >= 90 ? 'complete' : ''}`}
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="text-small text-muted">{percent}%</span>
                            </div>
                          </td>
                          <td data-label="Status">
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
              </div>
            ) : (
              <p className="text-muted">No training progress recorded.</p>
            )}
          </div>

          <div className="card">
            <h3 className="card-title mb-2">Machine Checkouts</h3>
            <div className="table-wrapper">
              <table className="table table-mobile-cards">
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
                      (requirement) => requirement.completed
                    )

                    return (
                      <tr key={status.machine.id}>
                        <td data-label="Machine">{status.machine.name}</td>
                        <td data-label="Training">
                          {status.eligibility.requirements.length === 0 ? (
                            <span className="text-muted">No requirements</span>
                          ) : trainingComplete ? (
                            <span className="badge badge-success">Complete</span>
                          ) : (
                            <span className="badge badge-warning">
                              {
                                status.eligibility.requirements.filter(
                                  (requirement) => requirement.completed
                                ).length
                              }
                              /{status.eligibility.requirements.length}
                            </span>
                          )}
                        </td>
                        <td data-label="Checkout Status">
                          {status.hasCheckout ? (
                            <span className="badge badge-success">Approved</span>
                          ) : (
                            <span className="badge badge-warning">Pending</span>
                          )}
                        </td>
                        <td data-label="Actions">
                          {!canManageCheckouts ? (
                            <span className="text-muted text-small">Admin only</span>
                          ) : status.hasCheckout ? (
                            <button
                              className="btn btn-danger"
                              onClick={() => handleRevoke(status.machine.id)}
                              disabled={processing === status.machine.id}
                            >
                              {processing === status.machine.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          ) : trainingComplete ? (
                            <button
                              className="btn btn-success"
                              onClick={() => handleApprove(status.machine.id)}
                              disabled={processing === status.machine.id}
                            >
                              {processing === status.machine.id ? 'Approving...' : 'Approve'}
                            </button>
                          ) : (
                            <span className="text-muted text-small">Training incomplete</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
