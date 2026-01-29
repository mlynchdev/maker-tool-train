import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enums
export const userRoleEnum = pgEnum('user_role', ['member', 'manager', 'admin'])
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended'])
export const reservationStatusEnum = pgEnum('reservation_status', [
  'confirmed',
  'cancelled',
  'completed',
])

// Users table
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  name: varchar('name', { length: 255 }),
  role: userRoleEnum('role').default('member').notNull(),
  status: userStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Machines table
export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  calcomEventTypeId: integer('calcom_event_type_id'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Training modules table
export const trainingModules = pgTable('training_modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  youtubeVideoId: varchar('youtube_video_id', { length: 20 }).notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Machine requirements - which modules needed for each machine
export const machineRequirements = pgTable(
  'machine_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .references(() => machines.id, { onDelete: 'cascade' })
      .notNull(),
    moduleId: uuid('module_id')
      .references(() => trainingModules.id, { onDelete: 'cascade' })
      .notNull(),
    requiredWatchPercent: integer('required_watch_percent').default(90).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    machineModuleIdx: uniqueIndex('machine_module_idx').on(
      table.machineId,
      table.moduleId
    ),
  })
)

// Training progress - user watch progress
export const trainingProgress = pgTable(
  'training_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    moduleId: uuid('module_id')
      .references(() => trainingModules.id, { onDelete: 'cascade' })
      .notNull(),
    watchedSeconds: integer('watched_seconds').default(0).notNull(),
    lastPosition: integer('last_position').default(0).notNull(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userModuleIdx: uniqueIndex('user_module_idx').on(table.userId, table.moduleId),
  })
)

// Manager checkouts - approval records
export const managerCheckouts = pgTable(
  'manager_checkouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    machineId: uuid('machine_id')
      .references(() => machines.id, { onDelete: 'cascade' })
      .notNull(),
    approvedBy: uuid('approved_by')
      .references(() => users.id)
      .notNull(),
    approvedAt: timestamp('approved_at').defaultNow().notNull(),
    notes: text('notes'),
  },
  (table) => ({
    userMachineIdx: uniqueIndex('checkout_user_machine_idx').on(
      table.userId,
      table.machineId
    ),
  })
)

// Reservations - booking records synced with Cal.com
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    machineId: uuid('machine_id')
      .references(() => machines.id, { onDelete: 'cascade' })
      .notNull(),
    calcomBookingId: varchar('calcom_booking_id', { length: 100 }),
    calcomBookingUid: varchar('calcom_booking_uid', { length: 100 }),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time').notNull(),
    status: reservationStatusEnum('status').default('confirmed').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userStartIdx: index('user_start_idx').on(table.userId, table.startTime),
    machineStartIdx: index('machine_start_idx').on(table.machineId, table.startTime),
    calcomBookingIdx: index('calcom_booking_idx').on(table.calcomBookingId),
  })
)

// Sessions - for auth abstraction
export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('session_user_idx').on(table.userId),
    expiresAtIdx: index('session_expires_idx').on(table.expiresAt),
  })
)

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  trainingProgress: many(trainingProgress),
  managerCheckouts: many(managerCheckouts, { relationName: 'userCheckouts' }),
  approvedCheckouts: many(managerCheckouts, { relationName: 'approverCheckouts' }),
  reservations: many(reservations),
  sessions: many(sessions),
}))

export const machinesRelations = relations(machines, ({ many }) => ({
  requirements: many(machineRequirements),
  checkouts: many(managerCheckouts),
  reservations: many(reservations),
}))

export const trainingModulesRelations = relations(trainingModules, ({ many }) => ({
  requirements: many(machineRequirements),
  progress: many(trainingProgress),
}))

export const machineRequirementsRelations = relations(
  machineRequirements,
  ({ one }) => ({
    machine: one(machines, {
      fields: [machineRequirements.machineId],
      references: [machines.id],
    }),
    module: one(trainingModules, {
      fields: [machineRequirements.moduleId],
      references: [trainingModules.id],
    }),
  })
)

export const trainingProgressRelations = relations(trainingProgress, ({ one }) => ({
  user: one(users, {
    fields: [trainingProgress.userId],
    references: [users.id],
  }),
  module: one(trainingModules, {
    fields: [trainingProgress.moduleId],
    references: [trainingModules.id],
  }),
}))

export const managerCheckoutsRelations = relations(managerCheckouts, ({ one }) => ({
  user: one(users, {
    fields: [managerCheckouts.userId],
    references: [users.id],
    relationName: 'userCheckouts',
  }),
  machine: one(machines, {
    fields: [managerCheckouts.machineId],
    references: [machines.id],
  }),
  approver: one(users, {
    fields: [managerCheckouts.approvedBy],
    references: [users.id],
    relationName: 'approverCheckouts',
  }),
}))

export const reservationsRelations = relations(reservations, ({ one }) => ({
  user: one(users, {
    fields: [reservations.userId],
    references: [users.id],
  }),
  machine: one(machines, {
    fields: [reservations.machineId],
    references: [machines.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}))

// Type exports
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Machine = typeof machines.$inferSelect
export type NewMachine = typeof machines.$inferInsert
export type TrainingModule = typeof trainingModules.$inferSelect
export type NewTrainingModule = typeof trainingModules.$inferInsert
export type MachineRequirement = typeof machineRequirements.$inferSelect
export type TrainingProgress = typeof trainingProgress.$inferSelect
export type ManagerCheckout = typeof managerCheckouts.$inferSelect
export type Reservation = typeof reservations.$inferSelect
export type NewReservation = typeof reservations.$inferInsert
export type Session = typeof sessions.$inferSelect
