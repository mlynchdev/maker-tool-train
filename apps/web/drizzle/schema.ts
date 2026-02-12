import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Enums
export const userRoleEnum = pgEnum('user_role', ['member', 'manager', 'admin'])
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended'])
export const resourceTypeEnum = pgEnum('resource_type', ['machine', 'tool'])
export const checkoutAppointmentStatusEnum = pgEnum('checkout_appointment_status', [
  'scheduled',
  'cancelled',
  'completed',
])
export const notificationTypeEnum = pgEnum('notification_type', [
  'booking_requested',
  'booking_approved',
  'booking_rejected',
  'booking_cancelled',
  'checkout_appointment_booked',
  'checkout_appointment_cancelled',
])
export const reservationStatusEnum = pgEnum('reservation_status', [
  'pending',
  'approved',
  'rejected',
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
export const machines = pgTable(
  'machines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    resourceType: resourceTypeEnum('resource_type').default('machine').notNull(),
    calcomEventTypeId: integer('calcom_event_type_id'),
    trainingDurationMinutes: integer('training_duration_minutes')
      .default(30)
      .notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    durationAllowedCheck: check(
      'machine_training_duration_allowed_check',
      sql`${table.trainingDurationMinutes} in (15, 30, 45, 60)`
    ),
  })
)

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

// Reservations - native booking requests (Cal.com fields retained for migration)
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
    status: reservationStatusEnum('status').default('pending').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    reviewNotes: text('review_notes'),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userStartIdx: index('user_start_idx').on(table.userId, table.startTime),
    machineStartIdx: index('machine_start_idx').on(table.machineId, table.startTime),
    machineEndIdx: index('machine_end_idx').on(table.machineId, table.endTime),
    machineStatusIdx: index('machine_status_idx').on(table.machineId, table.status),
    reviewedByIdx: index('reservation_reviewed_by_idx').on(table.reviewedBy),
    calcomBookingIdx: index('calcom_booking_idx').on(table.calcomBookingId),
  })
)

// Checkout availability blocks - admin/manager time windows for in-person checkout
export const checkoutAvailabilityBlocks = pgTable(
  'checkout_availability_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: uuid('machine_id')
      .references(() => machines.id, { onDelete: 'cascade' })
      .notNull(),
    managerId: uuid('manager_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time').notNull(),
    notes: text('notes'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    machineStartIdx: index('checkout_block_machine_start_idx').on(
      table.machineId,
      table.startTime
    ),
    managerStartIdx: index('checkout_block_manager_start_idx').on(
      table.managerId,
      table.startTime
    ),
    activeIdx: index('checkout_block_active_idx').on(table.active),
  })
)

// Checkout recurring availability rules - manager/admin weekly recurring windows
export const checkoutAvailabilityRules = pgTable(
  'checkout_availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    managerId: uuid('manager_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    startMinuteOfDay: integer('start_minute_of_day').notNull(),
    endMinuteOfDay: integer('end_minute_of_day').notNull(),
    timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),
    notes: text('notes'),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    managerDayIdx: index('checkout_rule_manager_day_idx').on(
      table.managerId,
      table.dayOfWeek
    ),
    managerActiveIdx: index('checkout_rule_manager_active_idx').on(
      table.managerId,
      table.active
    ),
    dayOfWeekCheck: check(
      'checkout_rule_day_of_week_check',
      sql`${table.dayOfWeek} >= 0 and ${table.dayOfWeek} <= 6`
    ),
    startMinuteCheck: check(
      'checkout_rule_start_minute_check',
      sql`${table.startMinuteOfDay} >= 0 and ${table.startMinuteOfDay} < 1440`
    ),
    endMinuteCheck: check(
      'checkout_rule_end_minute_check',
      sql`${table.endMinuteOfDay} > 0 and ${table.endMinuteOfDay} <= 1440`
    ),
    rangeCheck: check(
      'checkout_rule_range_check',
      sql`${table.endMinuteOfDay} > ${table.startMinuteOfDay}`
    ),
  })
)

// Checkout appointments - member bookings against checkout availability blocks
export const checkoutAppointments = pgTable(
  'checkout_appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    machineId: uuid('machine_id')
      .references(() => machines.id, { onDelete: 'cascade' })
      .notNull(),
    managerId: uuid('manager_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    availabilityBlockId: uuid('availability_block_id').references(
      () => checkoutAvailabilityBlocks.id,
      { onDelete: 'set null' }
    ),
    availabilityRuleId: uuid('availability_rule_id').references(
      () => checkoutAvailabilityRules.id,
      { onDelete: 'set null' }
    ),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time').notNull(),
    status: checkoutAppointmentStatusEnum('status').default('scheduled').notNull(),
    notes: text('notes'),
    cancellationReason: text('cancellation_reason'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    userStartIdx: index('checkout_appt_user_start_idx').on(
      table.userId,
      table.startTime
    ),
    machineStartIdx: index('checkout_appt_machine_start_idx').on(
      table.machineId,
      table.startTime
    ),
    managerStartIdx: index('checkout_appt_manager_start_idx').on(
      table.managerId,
      table.startTime
    ),
    blockIdx: index('checkout_appt_block_idx').on(table.availabilityBlockId),
    ruleIdx: index('checkout_appt_rule_idx').on(table.availabilityRuleId),
  })
)

// Notifications - persistent user notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, string | null>>(),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index('notification_user_created_idx').on(
      table.userId,
      table.createdAt
    ),
    userReadIdx: index('notification_user_read_idx').on(table.userId, table.readAt),
    userTypeIdx: index('notification_user_type_idx').on(table.userId, table.type),
  })
)

// App settings - global key/value configuration for a makerspace instance
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

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
  reservations: many(reservations, { relationName: 'reservationOwner' }),
  reviewedReservations: many(reservations, { relationName: 'reservationReviewer' }),
  managedCheckoutAvailabilityBlocks: many(checkoutAvailabilityBlocks, {
    relationName: 'checkoutBlockManager',
  }),
  managedCheckoutAvailabilityRules: many(checkoutAvailabilityRules, {
    relationName: 'checkoutRuleManager',
  }),
  checkoutAppointments: many(checkoutAppointments, {
    relationName: 'checkoutAppointmentUser',
  }),
  hostedCheckoutAppointments: many(checkoutAppointments, {
    relationName: 'checkoutAppointmentManager',
  }),
  notifications: many(notifications),
  sessions: many(sessions),
}))

export const machinesRelations = relations(machines, ({ many }) => ({
  requirements: many(machineRequirements),
  checkouts: many(managerCheckouts),
  reservations: many(reservations),
  checkoutAvailabilityBlocks: many(checkoutAvailabilityBlocks),
  checkoutAppointments: many(checkoutAppointments),
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
    relationName: 'reservationOwner',
  }),
  reviewer: one(users, {
    fields: [reservations.reviewedBy],
    references: [users.id],
    relationName: 'reservationReviewer',
  }),
  machine: one(machines, {
    fields: [reservations.machineId],
    references: [machines.id],
  }),
}))

export const checkoutAvailabilityBlocksRelations = relations(
  checkoutAvailabilityBlocks,
  ({ one, many }) => ({
    machine: one(machines, {
      fields: [checkoutAvailabilityBlocks.machineId],
      references: [machines.id],
    }),
    manager: one(users, {
      fields: [checkoutAvailabilityBlocks.managerId],
      references: [users.id],
      relationName: 'checkoutBlockManager',
    }),
    appointments: many(checkoutAppointments, {
      relationName: 'appointmentBlock',
    }),
  })
)

export const checkoutAvailabilityRulesRelations = relations(
  checkoutAvailabilityRules,
  ({ one, many }) => ({
    manager: one(users, {
      fields: [checkoutAvailabilityRules.managerId],
      references: [users.id],
      relationName: 'checkoutRuleManager',
    }),
    appointments: many(checkoutAppointments, {
      relationName: 'appointmentRule',
    }),
  })
)

export const checkoutAppointmentsRelations = relations(checkoutAppointments, ({ one }) => ({
  user: one(users, {
    fields: [checkoutAppointments.userId],
    references: [users.id],
    relationName: 'checkoutAppointmentUser',
  }),
  manager: one(users, {
    fields: [checkoutAppointments.managerId],
    references: [users.id],
    relationName: 'checkoutAppointmentManager',
  }),
  machine: one(machines, {
    fields: [checkoutAppointments.machineId],
    references: [machines.id],
  }),
  availabilityBlock: one(checkoutAvailabilityBlocks, {
    fields: [checkoutAppointments.availabilityBlockId],
    references: [checkoutAvailabilityBlocks.id],
    relationName: 'appointmentBlock',
  }),
  availabilityRule: one(checkoutAvailabilityRules, {
    fields: [checkoutAppointments.availabilityRuleId],
    references: [checkoutAvailabilityRules.id],
    relationName: 'appointmentRule',
  }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}))

export const appSettingsRelations = relations(appSettings, () => ({}))

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
export type CheckoutAvailabilityBlock = typeof checkoutAvailabilityBlocks.$inferSelect
export type NewCheckoutAvailabilityBlock = typeof checkoutAvailabilityBlocks.$inferInsert
export type CheckoutAvailabilityRule = typeof checkoutAvailabilityRules.$inferSelect
export type NewCheckoutAvailabilityRule = typeof checkoutAvailabilityRules.$inferInsert
export type CheckoutAppointment = typeof checkoutAppointments.$inferSelect
export type NewCheckoutAppointment = typeof checkoutAppointments.$inferInsert
export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
export type Session = typeof sessions.$inferSelect
