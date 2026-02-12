import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq } from 'drizzle-orm'
import { useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, machines, users } from '~/lib/db'
import { Header } from '~/components/Header'
import { approveCheckout, revokeCheckout, updateUser } from '~/server/api/admin'

const getAdminUsersData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireManager()

  const userList = await db.query.users.findMany({
    columns: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
    },
    orderBy: [desc(users.createdAt)],
  })

  const machineList = await db.query.machines.findMany({
    where: eq(machines.active, true),
    orderBy: [asc(machines.name)],
  })

  const checkoutList = await db.query.managerCheckouts.findMany({
    columns: {
      userId: true,
      machineId: true,
    },
  })

  return {
    user,
    users: userList,
    machines: machineList.map((machine) => ({
      id: machine.id,
      name: machine.name,
      resourceType: machine.resourceType,
    })),
    checkoutPairs: checkoutList,
  }
})

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
  loader: async () => {
    return await getAdminUsersData()
  },
})

function AdminUsersPage() {
  const {
    user: currentUser,
    users: initialUsers,
    machines: activeMachines,
    checkoutPairs: initialCheckoutPairs,
  } = Route.useLoaderData()
  const canEditUsers = currentUser.role === 'admin'

  const buildCheckoutKey = (userId: string, machineId: string) => `${userId}:${machineId}`

  const [userList, setUserList] = useState(initialUsers)
  const [updating, setUpdating] = useState<string | null>(null)
  const [updatingCheckoutKey, setUpdatingCheckoutKey] = useState<string | null>(null)
  const [checkoutKeys, setCheckoutKeys] = useState<Set<string>>(
    () => new Set(initialCheckoutPairs.map((pair) => buildCheckoutKey(pair.userId, pair.machineId)))
  )

  const handleRoleChange = async (userId: string, role: 'member' | 'manager' | 'admin') => {
    if (!canEditUsers) return
    setUpdating(userId)

    try {
      const result = await updateUser({ data: { userId, role } })

      if (result.success) {
        setUserList((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role } : u))
        )
      }
    } catch (error) {
      alert('Failed to update user')
    } finally {
      setUpdating(null)
    }
  }

  const handleStatusChange = async (userId: string, status: 'active' | 'suspended') => {
    if (!canEditUsers) return
    setUpdating(userId)

    try {
      const result = await updateUser({ data: { userId, status } })

      if (result.success) {
        setUserList((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status } : u))
        )
      }
    } catch (error) {
      alert('Failed to update user')
    } finally {
      setUpdating(null)
    }
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleToggleCheckout = async (userId: string, machineId: string) => {
    const checkoutKey = buildCheckoutKey(userId, machineId)
    const hasCheckout = checkoutKeys.has(checkoutKey)
    setUpdatingCheckoutKey(checkoutKey)

    try {
      const result = hasCheckout
        ? await revokeCheckout({ data: { userId, machineId } })
        : await approveCheckout({ data: { userId, machineId } })

      if (!result.success) {
        alert(result.error || 'Failed to update checkout')
        return
      }

      setCheckoutKeys((prev) => {
        const next = new Set(prev)
        if (hasCheckout) {
          next.delete(checkoutKey)
        } else {
          next.add(checkoutKey)
        }
        return next
      })
    } catch {
      alert('Failed to update checkout')
    } finally {
      setUpdatingCheckoutKey(null)
    }
  }

  const memberUsers = userList.filter((user) => user.role === 'member')

  return (
    <div>
      <Header user={currentUser} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">User Management</h1>
          {!canEditUsers && (
            <p className="text-small text-muted mb-2">
              Managers can manage checkout access. Role and account status changes are admin-only.
            </p>
          )}

          <div className="card">
            <div className="table-wrapper">
              <table className="table table-mobile-cards">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {userList.map((user) => {
                    const isSelf = user.id === currentUser.id
                    return (
                      <tr key={user.id}>
                        <td data-label="User">
                          <div>{user.name || 'No name'}</div>
                          <div className="text-small text-muted">{user.email}</div>
                        </td>
                        <td data-label="Role">
                          {canEditUsers ? (
                            <select
                              className="form-input table-inline-input"
                              value={user.role}
                              onChange={(e) =>
                                handleRoleChange(
                                  user.id,
                                  e.target.value as 'member' | 'manager' | 'admin'
                                )
                              }
                              disabled={isSelf || updating === user.id}
                            >
                              <option value="member">Member</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                            </select>
                          ) : (
                            <span className="text-small" style={{ textTransform: 'capitalize' }}>
                              {user.role}
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span
                            className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-danger'}`}
                          >
                            {user.status}
                          </span>
                        </td>
                        <td className="text-small" data-label="Joined">
                          {formatDate(user.createdAt)}
                        </td>
                        <td data-label="Actions">
                          {canEditUsers && !isSelf && (
                            <button
                              className={`btn ${user.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                              onClick={() =>
                                handleStatusChange(
                                  user.id,
                                  user.status === 'active' ? 'suspended' : 'active'
                                )
                              }
                              disabled={updating === user.id}
                            >
                              {user.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                          )}
                          {canEditUsers && isSelf && (
                            <span className="text-small text-muted">Current user</span>
                          )}
                          {!canEditUsers && (
                            <span className="text-small text-muted">Admin only</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {userList.length === 0 && (
              <p className="text-center text-muted" style={{ padding: '2rem' }}>
                No users found.
              </p>
            )}
          </div>

          <div className="card mt-2">
            <h3 className="card-title mb-2">Member Checkout Access</h3>
            {memberUsers.length > 0 ? (
              activeMachines.length > 0 ? (
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        {activeMachines.map((machine) => (
                          <th key={machine.id}>
                            {machine.name}
                            <div className="text-small text-muted" style={{ textTransform: 'capitalize' }}>
                              {machine.resourceType}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {memberUsers.map((member) => (
                        <tr key={member.id}>
                          <td>
                            <div>{member.name || member.email}</div>
                            {member.name && (
                              <div className="text-small text-muted">{member.email}</div>
                            )}
                          </td>
                          {activeMachines.map((machine) => {
                            const key = buildCheckoutKey(member.id, machine.id)
                            const checkedOut = checkoutKeys.has(key)
                            const isUpdating = updatingCheckoutKey === key
                            const disabled = member.status !== 'active' || isUpdating

                            return (
                              <td key={machine.id}>
                                <button
                                  className={`btn ${checkedOut ? 'btn-success' : 'btn-secondary'}`}
                                  onClick={() => handleToggleCheckout(member.id, machine.id)}
                                  disabled={disabled}
                                >
                                  {isUpdating
                                    ? 'Saving...'
                                    : checkedOut
                                      ? 'Checked Out'
                                      : 'Not Checked Out'}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-small text-muted">No active machines or tools available.</p>
              )
            ) : (
              <p className="text-small text-muted">No members found.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
