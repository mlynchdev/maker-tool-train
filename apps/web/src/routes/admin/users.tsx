import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { desc } from 'drizzle-orm'
import { useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { db, users } from '~/lib/db'
import { Header } from '~/components/Header'
import { updateUser } from '~/server/api/admin'

const getAdminUsersData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAdmin()

  const userList = await db.query.users.findMany({
    orderBy: [desc(users.createdAt)],
  })

  return { user, users: userList }
})

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
  loader: async () => {
    return await getAdminUsersData()
  },
})

function AdminUsersPage() {
  const { user: currentUser, users: initialUsers } = Route.useLoaderData()
  const [userList, setUserList] = useState(initialUsers)
  const [updating, setUpdating] = useState<string | null>(null)

  const handleRoleChange = async (userId: string, role: 'member' | 'manager' | 'admin') => {
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

  return (
    <div>
      <Header user={currentUser} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">User Management</h1>

          <div className="card">
            <table className="table">
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
                      <td>
                        <div>{user.name || 'No name'}</div>
                        <div className="text-small text-muted">{user.email}</div>
                      </td>
                      <td>
                        <select
                          className="form-input"
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(
                              user.id,
                              e.target.value as 'member' | 'manager' | 'admin'
                            )
                          }
                          disabled={isSelf || updating === user.id}
                          style={{ width: 'auto' }}
                        >
                          <option value="member">Member</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <span
                          className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-danger'}`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="text-small">{formatDate(user.createdAt)}</td>
                      <td>
                        {!isSelf && (
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
                        {isSelf && (
                          <span className="text-small text-muted">Current user</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {userList.length === 0 && (
              <p className="text-center text-muted" style={{ padding: '2rem' }}>
                No users found.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
