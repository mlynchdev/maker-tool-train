import { eq } from 'drizzle-orm'
import { db, managerCheckouts, reservations, users } from '~/lib/db'

interface DeleteUserInput {
  actorId: string
  userId: string
}

interface DeleteUserSuccess {
  success: true
  user: {
    id: string
    email: string
    role: 'member' | 'manager' | 'admin'
  }
}

interface DeleteUserFailure {
  success: false
  error: string
}

export type DeleteUserResult = DeleteUserSuccess | DeleteUserFailure

export async function deleteUserAccount(input: DeleteUserInput): Promise<DeleteUserResult> {
  if (input.actorId === input.userId) {
    return { success: false, error: 'You cannot delete your own account' }
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: {
      id: true,
      email: true,
      role: true,
    },
  })

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  if (user.role === 'admin') {
    const adminUsers = await db.query.users.findMany({
      where: eq(users.role, 'admin'),
      columns: {
        id: true,
      },
    })

    if (adminUsers.length <= 1) {
      return { success: false, error: 'Cannot delete the last admin account' }
    }
  }

  const now = new Date()

  await db
    .update(reservations)
    .set({
      reviewedBy: null,
      reviewedAt: null,
      updatedAt: now,
    })
    .where(eq(reservations.reviewedBy, input.userId))

  await db
    .update(managerCheckouts)
    .set({
      approvedBy: input.actorId,
    })
    .where(eq(managerCheckouts.approvedBy, input.userId))

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, input.userId))
    .returning({
      id: users.id,
      email: users.email,
      role: users.role,
    })

  if (!deleted) {
    return { success: false, error: 'User not found' }
  }

  return {
    success: true,
    user: deleted,
  }
}
