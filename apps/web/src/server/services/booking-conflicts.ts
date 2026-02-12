import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import { db, reservations } from '~/lib/db'

export const CONFLICTING_RESERVATION_STATUSES = [
  'pending',
  'approved',
  'confirmed',
] as const

export interface ReservationRangeQuery {
  machineId: string
  startTime: Date
  endTime: Date
  excludeReservationId?: string
}

export async function findReservationConflicts({
  machineId,
  startTime,
  endTime,
  excludeReservationId,
}: ReservationRangeQuery) {
  const conditions = [
    eq(reservations.machineId, machineId),
    lt(reservations.startTime, endTime),
    gt(reservations.endTime, startTime),
    inArray(reservations.status, [...CONFLICTING_RESERVATION_STATUSES]),
  ]

  if (excludeReservationId) {
    conditions.push(ne(reservations.id, excludeReservationId))
  }

  return db.query.reservations.findMany({
    where: and(...conditions),
    orderBy: [reservations.startTime],
    with: {
      user: true,
    },
  })
}

export async function hasReservationConflict(query: ReservationRangeQuery) {
  const conflicts = await findReservationConflicts(query)
  return conflicts.length > 0
}

export async function getMachineBookingsInRange(
  machineId: string,
  startTime: Date,
  endTime: Date
) {
  return db.query.reservations.findMany({
    where: and(
      eq(reservations.machineId, machineId),
      lt(reservations.startTime, endTime),
      gt(reservations.endTime, startTime),
      inArray(reservations.status, [...CONFLICTING_RESERVATION_STATUSES])
    ),
    orderBy: [reservations.startTime],
    with: {
      user: true,
    },
  })
}
