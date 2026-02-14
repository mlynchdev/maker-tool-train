import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, and, desc, asc } from 'drizzle-orm'
import { requireManager, requireAdmin } from '../auth'
import { normalizeYouTubeId } from '~/lib/youtube'
import {
  db,
  checkoutAppointments,
  users,
  machines,
  checkoutAvailabilityRules,
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
  cancelFutureCheckoutAppointmentsForUserMachine,
  cancelCheckoutAppointmentByManager,
  createCheckoutAvailabilityBlock as createCheckoutAvailabilityBlockService,
  deactivateCheckoutAvailabilityBlock as deactivateCheckoutAvailabilityBlockService,
  finalizeCheckoutAppointment as finalizeCheckoutAppointmentService,
  getAdminCheckoutAvailability,
  moderateCheckoutAppointmentRequest as moderateCheckoutAppointmentRequestService,
} from '../services/checkout-scheduling'
import {
  getMakerspaceTimezone,
  getSupportedIanaTimezones,
  isValidIanaTimezone,
  setMakerspaceTimezone,
} from '../services/makerspace-settings'
import { deleteUserAccount } from '../services/user-management'

const trainingDurationMinutesSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(45),
  z.literal(60),
])

const timezoneSchema = z.string().min(1).refine((value) => isValidIanaTimezone(value), {
  message: 'Invalid timezone',
})

function parseTimeToMinuteOfDay(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours * 60 + minutes
}

// ============ Checkout Management (Admin) ============

export const getPendingCheckoutCount = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()

    const pendingRequests = await db.query.checkoutAppointments.findMany({
      where: eq(checkoutAppointments.status, 'pending'),
      columns: {
        id: true,
      },
      with: {
        user: {
          columns: {
            id: true,
            status: true,
          },
        },
      },
    })

    return {
      count: pendingRequests.filter((item) => item.user.status === 'active').length,
    }
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

export const getMakerspaceSettings = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()

  return {
    timezone: await getMakerspaceTimezone(),
    timezoneOptions: getSupportedIanaTimezones(),
  }
})

export const updateMakerspaceSettings = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        timezone: timezoneSchema,
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    await requireAdmin()

    const setting = await setMakerspaceTimezone(data.timezone)

    await db
      .update(checkoutAvailabilityRules)
      .set({
        timezone: data.timezone,
        updatedAt: new Date(),
      })

    return { success: true, setting }
  })

export const getPendingCheckouts = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()

    const pendingRequests = await db.query.checkoutAppointments.findMany({
      where: eq(checkoutAppointments.status, 'pending'),
      with: {
        user: true,
        machine: true,
        manager: true,
      },
      orderBy: [asc(checkoutAppointments.startTime)],
    })

    return {
      pendingApprovals: pendingRequests
        .filter((item) => item.user.status === 'active')
        .map((item) => ({
          appointmentId: item.id,
          startTime: item.startTime,
          endTime: item.endTime,
          manager: {
            id: item.manager.id,
            email: item.manager.email,
            name: item.manager.name,
          },
          user: {
            id: item.user.id,
            email: item.user.email,
            name: item.user.name,
          },
          machine: {
            id: item.machine.id,
            name: item.machine.name,
          },
          trainingStatus: [],
        })),
    }
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
    const admin = await requireAdmin()

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

    const eligibility = await checkEligibility(data.userId, data.machineId)
    const trainingComplete = eligibility.requirements.every((requirement) => requirement.completed)
    if (!trainingComplete) {
      return {
        success: false,
        error: 'Training requirements are not complete',
        reasons: eligibility.reasons,
      }
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
        approvedBy: admin.id,
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
    const admin = await requireAdmin()

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

    const cancelledAppointments =
      await cancelFutureCheckoutAppointmentsForUserMachine({
        userId: data.userId,
        machineId: data.machineId,
        reason: 'Checkout approval revoked',
        actedByUserId: admin.id,
        actedByRole: 'admin',
      })

    // Emit real-time event
    emitCheckoutEvent(data.userId, {
      type: 'revoked',
      userId: data.userId,
      machineId: data.machineId,
      machineName: checkout.machine.name,
    })

    return { success: true, cancelledAppointments: cancelledAppointments.length }
  })

// ============ Machine Management (Admin) ============

export const createMachine = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        resourceType: z.enum(['machine', 'tool']).optional(),
        trainingDurationMinutes: trainingDurationMinutesSchema.default(30),
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
        trainingDurationMinutes: data.trainingDurationMinutes,
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
        trainingDurationMinutes: trainingDurationMinutesSchema.optional(),
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
    const manager = await requireManager()

    const startTime = data?.startDate ? new Date(data.startDate) : new Date()
    const endTime = data?.endDate
      ? new Date(data.endDate)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

    return getAdminCheckoutAvailability({
      managerId: manager.id,
      startTime,
      endTime,
    })
  })

export const createCheckoutAvailabilityBlock = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        dayOfWeek: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        notes: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const manager = await requireManager()
    const startMinuteOfDay = parseTimeToMinuteOfDay(data.startTime)
    const endMinuteOfDay = parseTimeToMinuteOfDay(data.endTime)

    if (startMinuteOfDay === null || endMinuteOfDay === null) {
      return { success: false, error: 'Invalid start or end time' }
    }

    return createCheckoutAvailabilityBlockService({
      managerId: manager.id,
      dayOfWeek: data.dayOfWeek,
      startMinuteOfDay,
      endMinuteOfDay,
      notes: data.notes,
    })
  })

export const deactivateCheckoutAvailabilityBlock = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z.object({ ruleId: z.string().uuid() }).parse(data)
  )
  .handler(async ({ data }) => {
    const manager = await requireManager()

    return deactivateCheckoutAvailabilityBlockService({
      ruleId: data.ruleId,
      managerId: manager.id,
    })
  })

export const cancelCheckoutAppointment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        reason: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return cancelCheckoutAppointmentByManager({
      appointmentId: data.appointmentId,
      managerId: admin.id,
      actorRole: 'admin',
      actorName: admin.name || admin.email,
      reason: data.reason,
    })
  })

export const moderateCheckoutRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        decision: z.enum(['accept', 'reject']),
        reason: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return moderateCheckoutAppointmentRequestService({
      appointmentId: data.appointmentId,
      adminId: admin.id,
      decision: data.decision,
      reason: data.reason,
    })
  })

export const finalizeCheckoutMeeting = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        appointmentId: z.string().uuid(),
        result: z.enum(['pass', 'fail']),
        notes: z.string().optional(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return finalizeCheckoutAppointmentService({
      appointmentId: data.appointmentId,
      adminId: admin.id,
      result: data.result,
      notes: data.notes,
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

export const deleteUser = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
      })
      .parse(data)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin()

    return deleteUserAccount({
      actorId: admin.id,
      userId: data.userId,
    })
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
