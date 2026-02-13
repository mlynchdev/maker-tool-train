import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq } from 'drizzle-orm'
import { Search, Shield, UserCheck, UserX, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, machines, users } from '~/lib/db'
import { Header } from '~/components/Header'
import { approveCheckout, revokeCheckout, updateUser } from '~/server/api/admin'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'

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
  const [userQuery, setUserQuery] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  const [updatingCheckoutKey, setUpdatingCheckoutKey] = useState<string | null>(null)
  const [checkoutKeys, setCheckoutKeys] = useState<Set<string>>(
    () => new Set(initialCheckoutPairs.map((pair) => buildCheckoutKey(pair.userId, pair.machineId)))
  )

  const normalizedQuery = userQuery.trim().toLowerCase()

  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return userList

    return userList.filter((user) => {
      const name = (user.name || '').toLowerCase()
      const email = user.email.toLowerCase()
      const role = user.role.toLowerCase()
      const status = user.status.toLowerCase()

      return (
        name.includes(normalizedQuery) ||
        email.includes(normalizedQuery) ||
        role.includes(normalizedQuery) ||
        status.includes(normalizedQuery)
      )
    })
  }, [normalizedQuery, userList])

  const memberUsers = filteredUsers.filter((user) => user.role === 'member')
  const activeMemberCount = memberUsers.filter((user) => user.status === 'active').length
  const suspendedCount = userList.filter((user) => user.status === 'suspended').length

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
    } catch {
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
    } catch {
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

  const statusBadgeVariant = (status: 'active' | 'suspended') =>
    status === 'active' ? 'success' : 'destructive'

  const roleBadgeVariant = (role: 'member' | 'manager' | 'admin') => {
    if (role === 'admin') return 'warning'
    if (role === 'manager') return 'info'
    return 'secondary'
  }

  const selectClassName =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

  return (
    <div className="min-h-screen">
      <Header user={currentUser} />

      <main className="container space-y-8 py-6 md:py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">User Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage member access, account status, and machine checkout permissions from one page.
          </p>
          {!canEditUsers && (
            <p className="mt-2 text-sm text-muted-foreground">
              Managers can update checkout access. Role and account status changes are admin-only.
            </p>
          )}
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total users</CardDescription>
              <CardTitle className="text-2xl">{userList.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Members (filtered)</CardDescription>
              <CardTitle className="text-2xl">{memberUsers.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active members</CardDescription>
              <CardTitle className="text-2xl">{activeMemberCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Suspended accounts</CardDescription>
              <CardTitle className="text-2xl">{suspendedCount}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Accounts</CardTitle>
                <CardDescription>Search and update user roles or account status.</CardDescription>
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search by name, email, role, or status"
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredUsers.length > 0 ? (
              <>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Joined</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => {
                        const isSelf = user.id === currentUser.id
                        return (
                          <TableRow key={user.id}>
                            <TableCell>
                              <p className="font-medium">{user.name || 'No name'}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </TableCell>
                            <TableCell>
                              {canEditUsers ? (
                                <select
                                  className={selectClassName}
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
                                <Badge variant={roleBadgeVariant(user.role)} className="capitalize">
                                  {user.role}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusBadgeVariant(user.status)} className="capitalize">
                                {user.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatDate(user.createdAt)}</TableCell>
                            <TableCell>
                              {canEditUsers && !isSelf && (
                                <Button
                                  variant={user.status === 'active' ? 'destructive' : 'default'}
                                  size="sm"
                                  onClick={() =>
                                    handleStatusChange(
                                      user.id,
                                      user.status === 'active' ? 'suspended' : 'active'
                                    )
                                  }
                                  disabled={updating === user.id}
                                >
                                  {user.status === 'active' ? 'Suspend' : 'Activate'}
                                </Button>
                              )}
                              {canEditUsers && isSelf && (
                                <span className="text-xs text-muted-foreground">Current user</span>
                              )}
                              {!canEditUsers && (
                                <span className="text-xs text-muted-foreground">Admin only</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-3 md:hidden">
                  {filteredUsers.map((user) => {
                    const isSelf = user.id === currentUser.id
                    return (
                      <Card key={user.id}>
                        <CardContent className="space-y-3 pt-6">
                          <div>
                            <p className="font-medium">{user.name || 'No name'}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge variant={roleBadgeVariant(user.role)} className="capitalize">
                              {user.role}
                            </Badge>
                            <Badge variant={statusBadgeVariant(user.status)} className="capitalize">
                              {user.status}
                            </Badge>
                            <Badge variant="outline">Joined {formatDate(user.createdAt)}</Badge>
                          </div>

                          {canEditUsers ? (
                            <div className="space-y-2">
                              <label className="text-xs font-medium uppercase text-muted-foreground">Role</label>
                              <select
                                className={selectClassName}
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
                            </div>
                          ) : null}

                          {canEditUsers && !isSelf ? (
                            <Button
                              variant={user.status === 'active' ? 'destructive' : 'default'}
                              size="sm"
                              onClick={() =>
                                handleStatusChange(
                                  user.id,
                                  user.status === 'active' ? 'suspended' : 'active'
                                )
                              }
                              disabled={updating === user.id}
                            >
                              {user.status === 'active' ? 'Suspend account' : 'Activate account'}
                            </Button>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {isSelf ? 'Current user account.' : 'Status changes are admin-only.'}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No users match your search.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Member Checkout Access</CardTitle>
            </div>
            <CardDescription>
              Grant or revoke per-resource checkout access for active members.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {memberUsers.length > 0 ? (
              activeMachines.length > 0 ? (
                <div className="space-y-4">
                  {memberUsers.map((member) => (
                    <Card key={member.id}>
                      <CardContent className="space-y-3 pt-6">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{member.name || member.email}</p>
                            {member.name && (
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">Member</Badge>
                            <Badge variant={member.status === 'active' ? 'success' : 'destructive'} className="capitalize">
                              {member.status}
                            </Badge>
                          </div>
                        </div>

                        {member.status !== 'active' && (
                          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                            This account is not active. Checkout toggles are disabled.
                          </div>
                        )}

                        <div className="space-y-2">
                          {activeMachines.map((machine) => {
                            const key = buildCheckoutKey(member.id, machine.id)
                            const checkedOut = checkoutKeys.has(key)
                            const isUpdating = updatingCheckoutKey === key
                            const disabled = member.status !== 'active' || isUpdating

                            return (
                              <div
                                key={machine.id}
                                className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <p className="text-sm font-medium">{machine.name}</p>
                                  <div className="mt-1 flex items-center gap-2">
                                    <Badge variant="outline" className="capitalize">
                                      {machine.resourceType}
                                    </Badge>
                                    {checkedOut ? (
                                      <Badge variant="success">
                                        <UserCheck className="mr-1 h-3.5 w-3.5" />
                                        Checked out
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary">
                                        <UserX className="mr-1 h-3.5 w-3.5" />
                                        Not checked out
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant={checkedOut ? 'outline' : 'default'}
                                  size="sm"
                                  onClick={() => handleToggleCheckout(member.id, machine.id)}
                                  disabled={disabled}
                                >
                                  {isUpdating
                                    ? 'Saving...'
                                    : checkedOut
                                      ? 'Revoke checkout'
                                      : 'Grant checkout'}
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active machines or tools available.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">No members match your search.</p>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Role changes and account status changes are audit-sensitive and should be reviewed carefully.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Active resources available for checkout assignment: {activeMachines.length}
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
