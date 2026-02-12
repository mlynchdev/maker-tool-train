import { eq, and } from 'drizzle-orm'
import {
  db,
  users,
  machines,
  machineRequirements,
  trainingProgress,
  trainingModules,
  managerCheckouts,
} from '~/lib/db'

export interface EligibilityResult {
  eligible: boolean
  reasons: string[]
  requirements: RequirementStatus[]
  hasCheckout: boolean
}

export interface RequirementStatus {
  moduleId: string
  moduleTitle: string
  requiredPercent: number
  watchedPercent: number
  completed: boolean
}

export async function checkEligibility(
  userId: string,
  machineId: string
): Promise<EligibilityResult> {
  const reasons: string[] = []
  const requirements: RequirementStatus[] = []

  // 1. Check user exists and is active
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (!user) {
    return {
      eligible: false,
      reasons: ['User not found'],
      requirements: [],
      hasCheckout: false,
    }
  }

  if (user.status !== 'active') {
    reasons.push('User account is not active')
  }

  // 2. Check machine exists and is active
  const machine = await db.query.machines.findFirst({
    where: eq(machines.id, machineId),
  })

  if (!machine) {
    return {
      eligible: false,
      reasons: ['Machine not found'],
      requirements: [],
      hasCheckout: false,
    }
  }

  if (!machine.active) {
    reasons.push('Machine is not available')
  }

  // 3. Check all required training modules are completed
  const machineReqs = await db.query.machineRequirements.findMany({
    where: eq(machineRequirements.machineId, machineId),
    with: {
      module: true,
    },
  })

  for (const req of machineReqs) {
    const progress = await db.query.trainingProgress.findFirst({
      where: and(
        eq(trainingProgress.userId, userId),
        eq(trainingProgress.moduleId, req.moduleId)
      ),
    })

    const watchedSeconds = progress?.watchedSeconds || 0
    const watchedPercent =
      req.module.durationSeconds > 0
        ? Math.floor((watchedSeconds / req.module.durationSeconds) * 100)
        : 0

    const completed = watchedPercent >= req.requiredWatchPercent

    requirements.push({
      moduleId: req.moduleId,
      moduleTitle: req.module.title,
      requiredPercent: req.requiredWatchPercent,
      watchedPercent,
      completed,
    })

    if (!completed) {
      reasons.push(
        `Training "${req.module.title}" not completed (${watchedPercent}% of ${req.requiredWatchPercent}% required)`
      )
    }
  }

  // 4. Check manager checkout exists (admins are implicitly checked out)
  const hasCheckout =
    user.role === 'admin'
      ? true
      : !!(await db.query.managerCheckouts.findFirst({
          where: and(
            eq(managerCheckouts.userId, userId),
            eq(managerCheckouts.machineId, machineId)
          ),
        }))

  if (!hasCheckout) {
    reasons.push('Manager checkout not approved')
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    requirements,
    hasCheckout,
  }
}

export async function getMachineRequirements(machineId: string) {
  return db.query.machineRequirements.findMany({
    where: eq(machineRequirements.machineId, machineId),
    with: {
      module: true,
    },
  })
}

export async function getUserTrainingProgress(userId: string) {
  return db.query.trainingProgress.findMany({
    where: eq(trainingProgress.userId, userId),
    with: {
      module: true,
    },
  })
}

export async function getUserCheckouts(userId: string) {
  return db.query.managerCheckouts.findMany({
    where: eq(managerCheckouts.userId, userId),
    with: {
      machine: true,
      approver: true,
    },
  })
}
