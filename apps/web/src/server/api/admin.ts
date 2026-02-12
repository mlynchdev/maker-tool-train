import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, desc, asc } from 'drizzle-orm'
import { requireManager, requireAdmin } from '../auth'
import { normalizeYouTubeId } from '~/lib/youtube'
import {
  db,
  users,
  machines,
  reservations,
  trainingModules,
  machineRequirements,
  managerCheckouts,
  trainingProgress,
} from '~/lib/db'
import { checkEligibility } from '../services/eligibility'
import { emitCheckoutEvent } from '../services/events'
import { moderateBookingRequest } from '../services/booking-workflow'
import {
  createCheckoutAvailabilityBlock as createCheckoutAvailabilityBlockService,
  deactivateCheckoutAvailabilityBlock as deactivateCheckoutAvailabilityBlockService,
  getAdminCheckoutAvailability,
} from '../services/checkout-scheduling'

// ============ Checkout Management (Manager+) ============

export const getPendingCheckoutCount = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireManager()

    const allUsers = await db.query.users.findMany({
      where: and(eq(users.status, 'active'), eq(users.role, 'member')),
      with: {
        trainingProgress: true,
        managerCheckouts: true,
      },
    })

    const allMachines = await db.query.machines.findMany({
      where: eq(machines.active, true),
      with: {
        requirements: true,
      },
    })

    let count = 0
    for (const user of allUsers) {
      for (const machine of allMachines) {
        const hasCheckout = user.managerCheckouts.some(
          (c) => c.machineId === machine.id
        )
        if (hasCheckout) continue

        const eligibility = await checkEligibility(user.id, machine.id)
        if (eligibility.requirements.every((r) => r.completed)) {
          count++
        }
      }
    }

    return { count }
  }
)

export const getPendingReservationRequestCount = createServerFn({
  method: 'GET',
}).handler(async () => {
  await requireAdmin()

  const requests = await db.query.reservations.findMany({
    where: eq(reservations.status, 'pending'),
    columns: {
      id: true,
    },
  })

  return { count: requests.length }
})

export const getPendingCheckouts = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireManager()

    // Get all users who have completed training but don't have checkouts for machines
    const allUsers = await db.query.users.findMany({
      where: eq(users.status, 'active'),
      with: {
        trainingProgress: {
          with: {
            module: true,
          },
        },
        managerCheckouts: {
          with: {
            machine: true,
          },
        },
      },
    })

    const allMachines = await db.query.machines.findMany({
      where: eq(machines.active, true),
      with: {
        requirements: {
          with: {
            module: true,
          },
        },
      },
    })

    // Find users eligible for checkout on each machine
    const pendingApprovals = []

    for (const user of allUsers) {
      if (user.role === 'admin' || user.role === 'manager') continue

      for (const machine of allMachines) {
        // Check if already checked out
        const hasCheckout = user.managerCheckouts.some(
          (c) => c.machineId === machine.id
        )
        if (hasCheckout) continue

        // Check training completion for this machine
        const eligibility = await checkEligibility(user.id, machine.id)

        // User has completed all training but no checkout yet
        const trainingComplete = eligibility.requirements.every((r) => r.completed)

        if (trainingComplete) {
          pendingApprovals.push({
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
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

    return { pendingApprovals }
  }
)

export const getUserForCheckout = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    await requireManager()

    const user = await db.query.users.findFirst({
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

    if (!user) {
      throw new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const allMachines = await db.query.machines.findMany({
      where: eq(machines.active, true),
    })

    const machineStatuses = await Promise.all(
      allMachines.map(async (machine) => {
        const eligibility = await checkEligibility(user.id, machine.id)
        return {
          machine,
          eligibility,
        }
      })
    )

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      trainingProgress: user.trainingProgress.map((p) => ({
        moduleId: p.moduleId,
        moduleTitle: p.module.title,
        watchedSeconds: p.watchedSeconds,
        durationSeconds: p.module.durationSeconds,
        percentComplete: Math.floor(
          (p.watchedSeconds / p.module.durationSeconds) * 100
        ),
        completed: !!p.completedAt,
      })),
      checkouts: user.managerCheckouts,
      machineStatuses,
    }
  })

const approveCheckoutSchema = z.object({
  userId: z.string().uuid(),
  machineId: z.string().uuid(),
  notes: z.string().optional(),
})

export const approveCheckout = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => approveCheckoutSchema.parse(data))
  .handler(async ({ data }) => {
    const manager = await requireManager()

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, data.userId),
    })

    if (!user) {
      return { success: false, error: 'User not found' }
    }

    // Verify machine exists
    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
    })

    if (!machine) {
      return { success: false, error: 'Machine not found' }
    }

    // Check if checkout already exists
    const existingCheckout = await db.query.managerCheckouts.findFirst({
      where: and(
        eq(managerCheckouts.userId, data.userId),
        eq(managerCheckouts.machineId, data.machineId)
      ),
    })

    if (existingCheckout) {
      return { success: false, error: 'Checkout already approved' }
    }

    // Create checkout record
    const [checkout] = await db
      .insert(managerCheckouts)
      .values({
        userId: data.userId,
        machineId: data.machineId,
        approvedBy: manager.id,
        notes: data.notes,
      })
      .returning()

    // Emit real-time event
    emitCheckoutEvent(data.userId, {
      type: 'approved',
      userId: data.userId,
      machineId: data.machineId,
      machineName: machine.name,
    })

    return { success: true, checkout }
  })

export const revokeCheckout = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        machineId: z.string().uuid(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireManager()

    const checkout = await db.query.managerCheckouts.findFirst({
      where: and(
        eq(managerCheckouts.userId, data.userId),
        eq(managerCheckouts.machineId, data.machineId)
      ),
      with: {
        machine: true,
      },
    })

    if (!checkout) {
      return { success: false, error: 'Checkout not found' }
    }

    await db
      .delete(managerCheckouts)
      .where(eq(managerCheckouts.id, checkout.id))

    // Emit real-time event
    emitCheckoutEvent(data.userId, {
      type: 'revoked',
      userId: data.userId,
      machineId: data.machineId,
      machineName: checkout.machine.name,
    })

    return { success: true }
  })

// ============ Machine Management (Admin) ============

export const createMachine = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        resourceType: z.enum(['machine', 'tool']).optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireManager()

    const [machine] = await db
      .insert(machines)
      .values({
        name: data.name,
        description: data.description,
        resourceType: data.resourceType || 'machine',
      })
      .returning()

    return { success: true, machine }
  })

export const updateMachine = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        resourceType: z.enum(['machine', 'tool']).optional(),
        active: z.boolean().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireManager()

    const { machineId, ...updates } = data

    const [machine] = await db
      .update(machines)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(machines.id, machineId))
      .returning()

    return { success: true, machine }
  })

export const setMachineRequirements = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        requirements: z.array(
          z.object({
            moduleId: z.string().uuid(),
            requiredWatchPercent: z.number().min(0).max(100).default(90),
          })
        ),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireManager()

    // Delete existing requirements
    await db
      .delete(machineRequirements)
      .where(eq(machineRequirements.machineId, data.machineId))

    // Insert new requirements
    if (data.requirements.length > 0) {
      await db.insert(machineRequirements).values(
        data.requirements.map((r) => ({
          machineId: data.machineId,
          moduleId: r.moduleId,
          requiredWatchPercent: r.requiredWatchPercent,
        }))
      )
    }

    return { success: true }
  })

// ============ Training Module Management (Admin) ============

export const getPendingReservationRequests = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()

    const requests = await db.query.reservations.findMany({
      where: eq(reservations.status, 'pending'),
      with: {
        user: true,
        machine: true,
      },
      orderBy: [asc(reservations.startTime)],
    })

    return { requests }
  }
)

export const moderateReservationRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        reservationId: z.string().uuid(),
        decision: z.enum(['approve', 'reject', 'cancel']),
        notes: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return moderateBookingRequest({
      reservationId: data.reservationId,
      reviewerId: admin.id,
      decision: data.decision,
      notes: data.notes,
      reason: data.reason,
    })
  })

export const getCheckoutAvailability = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) =>
    z
      .object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
      .optional()
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    const startTime = data?.startDate ? new Date(data.startDate) : new Date()
    const endTime = data?.endDate
      ? new Date(data.endDate)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    return getAdminCheckoutAvailability({
      managerId: admin.id,
      startTime,
      endTime,
    })
  })

export const createCheckoutAvailabilityBlock = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        machineId: z.string().uuid(),
        startTime: z.string().datetime(),
        endTime: z.string().datetime(),
        notes: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return createCheckoutAvailabilityBlockService({
      machineId: data.machineId,
      managerId: admin.id,
      startTime: new Date(data.startTime),
      endTime: new Date(data.endTime),
      notes: data.notes,
    })
  })

export const deactivateCheckoutAvailabilityBlock = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z.object({ blockId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return deactivateCheckoutAvailabilityBlockService({
      blockId: data.blockId,
      managerId: admin.id,
    })
  })

export const createTrainingModule = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        youtubeVideoId: z.string().min(1),
        durationSeconds: z.number().int().positive(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireAdmin()

    const normalizedVideoId = normalizeYouTubeId(data.youtubeVideoId)
    if (!normalizedVideoId) {
      return { success: false, error: 'Invalid YouTube URL or ID.' }
    }

    const [module] = await db
      .insert(trainingModules)
      .values({
        title: data.title,
        description: data.description,
        youtubeVideoId: normalizedVideoId,
        durationSeconds: data.durationSeconds,
      })
      .returning()

    return { success: true, module }
  })

export const updateTrainingModule = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        moduleId: z.string().uuid(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        youtubeVideoId: z.string().min(1).optional(),
        durationSeconds: z.number().int().positive().optional(),
        active: z.boolean().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireAdmin()

    const { moduleId, ...updates } = data
    let normalizedVideoId: string | undefined

    if (updates.youtubeVideoId) {
      const normalized = normalizeYouTubeId(updates.youtubeVideoId)
      if (!normalized) {
        return { success: false, error: 'Invalid YouTube URL or ID.' }
      }
      normalizedVideoId = normalized
    }

    const [module] = await db
      .update(trainingModules)
      .set({
        ...updates,
        ...(normalizedVideoId ? { youtubeVideoId: normalizedVideoId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(trainingModules.id, moduleId))
      .returning()

    return { success: true, module }
  })

// ============ User Management (Admin) ============

export const getUsers = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()

  const userList = await db.query.users.findMany({
    orderBy: [desc(users.createdAt)],
  })

  return {
    users: userList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
    })),
  }
})

export const updateUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(['member', 'manager', 'admin']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        name: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireAdmin()

    const { userId, ...updates } = data

    const [user] = await db
      .update(users)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning()

    return { success: true, user }
  })

// ============ Admin Dashboard Data ============

export const getAdminMachines = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireManager()

    const machineList = await db.query.machines.findMany({
      with: {
        requirements: {
          with: {
            module: true,
          },
        },
      },
      orderBy: [asc(machines.name)],
    })

    return { machines: machineList }
  }
)

export const getAdminModules = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()

    const moduleList = await db.query.trainingModules.findMany({
      orderBy: [asc(trainingModules.title)],
    })

    return { modules: moduleList }
  }
)
