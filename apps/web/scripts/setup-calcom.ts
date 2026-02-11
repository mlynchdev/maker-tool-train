/**
 * Cal.com Dev Setup Script
 *
 * Automates Cal.com configuration:
 * 1. Waits for Cal.com to be ready
 * 2. Creates an admin user in Cal.com's database
 * 3. Generates an API key
 * 4. Creates event types for each machine
 * 5. Updates the app's machines table with Cal.com event type IDs
 *
 * Cal.com runs on a VPS. To reach its Postgres, open an SSH tunnel first:
 *   ssh -L 5434:localhost:5434 vps
 *
 * Usage: bun run calcom:setup
 */

import { createHash, randomBytes } from 'crypto'
import postgres from 'postgres'

const CALCOM_URL = process.env.CALCOM_API_URL || 'http://localhost:5555'
const CALCOM_DB_URL =
  process.env.CALCOM_DATABASE_URL || 'postgresql://calcom:calcom_dev_password@localhost:5434/calendso'
const APP_DB_URL =
  process.env.DATABASE_URL || 'postgresql://training:training_dev_password@localhost:5433/training'

const ADMIN_EMAIL = 'admin@makerspace.dev'
const ADMIN_USERNAME = 'makerspace-admin'
const ADMIN_NAME = 'Makerspace Admin'

const EVENT_TYPES = [
  { title: 'Laser Cutter', slug: 'laser-cutter', length: 60, machineName: 'Laser Cutter' },
  { title: '3D Printer', slug: '3d-printer', length: 60, machineName: '3D Printer' },
  { title: 'CNC Mill', slug: 'cnc-mill', length: 60, machineName: 'CNC Mill' },
]

async function waitForCalcom(maxAttempts = 60): Promise<void> {
  console.log('Waiting for Cal.com to be ready...')

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(`${CALCOM_URL}/`, { redirect: 'manual' })
      if (res.status > 0) {
        console.log(`Cal.com is ready! (attempt ${i}/${maxAttempts})`)
        return
      }
    } catch {
      // Not ready yet
    }

    if (i % 10 === 0) {
      console.log(`  Still waiting... (attempt ${i}/${maxAttempts})`)
    }

    await new Promise((r) => setTimeout(r, 3000))
  }

  throw new Error(
    'Cal.com did not become ready in time. Check docker logs: docker logs training-dev-calcom'
  )
}

async function setupCalcomUser(sql: postgres.Sql): Promise<number> {
  console.log('\nSetting up Cal.com admin user...')

  // Check if user already exists
  const existing = await sql`SELECT id FROM users WHERE email = ${ADMIN_EMAIL}`
  if (existing.length > 0) {
    console.log(`  User ${ADMIN_EMAIL} already exists (id: ${existing[0].id})`)
    return existing[0].id
  }

  // Hash password with Bun's built-in bcrypt
  const passwordHash = await Bun.password.hash('calcom123', { algorithm: 'bcrypt', cost: 12 })

  const [user] = await sql`
    INSERT INTO users (email, username, name, uuid, "emailVerified", "completedOnboarding", "timeZone", role)
    VALUES (${ADMIN_EMAIL}, ${ADMIN_USERNAME}, ${ADMIN_NAME}, gen_random_uuid(), NOW(), true, 'America/New_York', 'ADMIN')
    RETURNING id
  `
  const userId = user.id

  // Set password in UserPassword table
  await sql`INSERT INTO "UserPassword" ("userId", hash) VALUES (${userId}, ${passwordHash})`

  // Create default schedule (required for event types to work)
  const [schedule] = await sql`
    INSERT INTO "Schedule" ("userId", name, "timeZone")
    VALUES (${userId}, 'Working Hours', 'America/New_York')
    RETURNING id
  `

  // Set as default schedule
  await sql`UPDATE users SET "defaultScheduleId" = ${schedule.id} WHERE id = ${userId}`

  // Add availability for the schedule (Mon-Fri 9am-5pm)
  for (let day = 1; day <= 5; day++) {
    await sql`
      INSERT INTO "Availability" ("scheduleId", days, "startTime", "endTime")
      VALUES (${schedule.id}, ${[day]}, '1970-01-01 09:00:00', '1970-01-01 17:00:00')
    `
  }

  console.log(`  Created user ${ADMIN_EMAIL} (id: ${userId}) with schedule`)
  return userId
}

async function generateApiKey(sql: postgres.Sql, userId: number): Promise<string> {
  console.log('\nGenerating Cal.com API key...')

  // Delete existing dev key if any
  const existing = await sql`
    SELECT id FROM "ApiKey" WHERE "userId" = ${userId} AND note = 'makerspace-dev'
  `
  if (existing.length > 0) {
    await sql`DELETE FROM "ApiKey" WHERE "userId" = ${userId} AND note = 'makerspace-dev'`
    console.log('  Replacing existing API key...')
  }

  // Generate a random API key
  const rawKey = `cal_live_${randomBytes(24).toString('hex')}`
  const hashedKey = createHash('sha256').update(rawKey).digest('hex')
  const keyId = randomBytes(16).toString('hex')
  const expiresAt = new Date('2030-01-01')

  await sql`
    INSERT INTO "ApiKey" (id, "userId", "hashedKey", "expiresAt", note)
    VALUES (${keyId}, ${userId}, ${hashedKey}, ${expiresAt}, 'makerspace-dev')
  `

  console.log('  API key generated successfully')
  return rawKey
}

async function createEventTypes(
  sql: postgres.Sql,
  userId: number
): Promise<Map<string, number>> {
  console.log('\nCreating Cal.com event types...')

  const eventTypeIds = new Map<string, number>()

  // Get the user's default schedule
  const [user] = await sql`SELECT "defaultScheduleId" FROM users WHERE id = ${userId}`
  const scheduleId = user?.defaultScheduleId

  for (let i = 0; i < EVENT_TYPES.length; i++) {
    const et = EVENT_TYPES[i]

    // Check if event type already exists
    const existing = await sql`
      SELECT id FROM "EventType" WHERE "userId" = ${userId} AND slug = ${et.slug}
    `

    if (existing.length > 0) {
      console.log(`  Event type "${et.title}" already exists (id: ${existing[0].id})`)
      eventTypeIds.set(et.machineName, existing[0].id)
      continue
    }

    const [result] = await sql`
      INSERT INTO "EventType" (title, slug, length, "userId", "scheduleId", hidden, position)
      VALUES (${et.title}, ${et.slug}, ${et.length}, ${userId}, ${scheduleId}, false, ${i})
      RETURNING id
    `

    eventTypeIds.set(et.machineName, result.id)
    console.log(`  Created event type "${et.title}" (id: ${result.id})`)
  }

  return eventTypeIds
}

async function updateAppMachines(eventTypeIds: Map<string, number>): Promise<void> {
  console.log('\nUpdating app machines with Cal.com event type IDs...')

  const appSql = postgres(APP_DB_URL)

  try {
    for (const [machineName, eventTypeId] of eventTypeIds) {
      const result = await appSql`
        UPDATE machines SET calcom_event_type_id = ${eventTypeId} WHERE name = ${machineName}
      `

      if (result.count > 0) {
        console.log(`  Updated "${machineName}" → eventTypeId ${eventTypeId}`)
      } else {
        console.log(
          `  Machine "${machineName}" not found in app database (will need manual mapping)`
        )
      }
    }
  } finally {
    await appSql.end()
  }
}

async function main() {
  console.log('=== Cal.com Local Dev Setup ===\n')

  // Step 1: Wait for Cal.com
  await waitForCalcom()

  // Step 2-4: Connect to Cal.com DB and set everything up
  const calcomSql = postgres(CALCOM_DB_URL)

  try {
    const userId = await setupCalcomUser(calcomSql)
    const apiKey = await generateApiKey(calcomSql, userId)
    const eventTypeIds = await createEventTypes(calcomSql, userId)

    // Step 5: Update app machines
    await updateAppMachines(eventTypeIds)

    // Print summary
    console.log('\n=== Setup Complete ===\n')
    console.log('Add these to your .env file:\n')
    console.log(`CALCOM_API_URL=${CALCOM_URL}`)
    console.log(`CALCOM_API_KEY=${apiKey}`)
    console.log('')
    console.log(`Cal.com web UI: ${CALCOM_URL}`)
    console.log(`Cal.com login:  ${ADMIN_EMAIL} / calcom123`)
    console.log('')
    console.log('Event type IDs:')
    for (const [name, id] of eventTypeIds) {
      console.log(`  ${name}: ${id}`)
    }
  } finally {
    await calcomSql.end()
  }
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message)
  process.exit(1)
})
