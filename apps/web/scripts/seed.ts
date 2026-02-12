/**
 * Database seed script for development
 * Run with: bun run scripts/seed.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../drizzle/schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}

const client = postgres(connectionString)
const db = drizzle(client, { schema })

async function seed() {
  console.log('Seeding database...')

  // Create admin user
  const adminPassword = await Bun.password.hash('admin123', {
    algorithm: 'argon2id',
  })

  const [admin] = await db
    .insert(schema.users)
    .values({
      email: 'admin@example.com',
      passwordHash: adminPassword,
      name: 'Admin User',
      role: 'admin',
    })
    .onConflictDoNothing()
    .returning()

  if (admin) {
    console.log('Created admin user:', admin.email)
  }

  // Create manager user
  const managerPassword = await Bun.password.hash('manager123', {
    algorithm: 'argon2id',
  })

  const [manager] = await db
    .insert(schema.users)
    .values({
      email: 'manager@example.com',
      passwordHash: managerPassword,
      name: 'Manager User',
      role: 'manager',
    })
    .onConflictDoNothing()
    .returning()

  if (manager) {
    console.log('Created manager user:', manager.email)
  }

  // Create member user
  const memberPassword = await Bun.password.hash('member123', {
    algorithm: 'argon2id',
  })

  const [member] = await db
    .insert(schema.users)
    .values({
      email: 'member@example.com',
      passwordHash: memberPassword,
      name: 'Test Member',
      role: 'member',
    })
    .onConflictDoNothing()
    .returning()

  if (member) {
    console.log('Created member user:', member.email)
  }

  // Create training modules
  const trainingModulesData = [
    {
      title: 'Safety Fundamentals',
      description: 'Basic safety protocols and equipment handling',
      youtubeVideoId: 'dQw4w9WgXcQ', // Replace with actual video ID
      durationSeconds: 300, // 5 minutes
    },
    {
      title: 'Machine Operation Basics',
      description: 'Introduction to machine operation and controls',
      youtubeVideoId: 'dQw4w9WgXcQ', // Replace with actual video ID
      durationSeconds: 600, // 10 minutes
    },
    {
      title: 'Advanced Techniques',
      description: 'Advanced operation techniques and best practices',
      youtubeVideoId: 'dQw4w9WgXcQ', // Replace with actual video ID
      durationSeconds: 900, // 15 minutes
    },
  ]

  const modules = await db
    .insert(schema.trainingModules)
    .values(trainingModulesData)
    .onConflictDoNothing()
    .returning()

  console.log('Created training modules:', modules.length)

  // Create machines
  const machinesData = [
    {
      name: 'Laser Cutter',
      description: 'High-precision laser cutting machine for various materials',
      calcomEventTypeId: 1, // Legacy field (unused by native scheduler)
    },
    {
      name: '3D Printer',
      description: 'Industrial-grade 3D printer for prototyping',
      calcomEventTypeId: 2, // Legacy field (unused by native scheduler)
    },
    {
      name: 'CNC Mill',
      description: 'Computer-controlled milling machine',
      calcomEventTypeId: 3, // Legacy field (unused by native scheduler)
    },
  ]

  const machines = await db
    .insert(schema.machines)
    .values(machinesData)
    .onConflictDoNothing()
    .returning()

  console.log('Created machines:', machines.length)

  // Set machine requirements
  if (modules.length > 0 && machines.length > 0) {
    const requirementsData = [
      // Laser Cutter requires Safety Fundamentals and Machine Operation
      { machineId: machines[0].id, moduleId: modules[0].id, requiredWatchPercent: 90 },
      { machineId: machines[0].id, moduleId: modules[1].id, requiredWatchPercent: 90 },
      // 3D Printer requires Safety Fundamentals only
      { machineId: machines[1].id, moduleId: modules[0].id, requiredWatchPercent: 90 },
      // CNC Mill requires all modules
      { machineId: machines[2].id, moduleId: modules[0].id, requiredWatchPercent: 90 },
      { machineId: machines[2].id, moduleId: modules[1].id, requiredWatchPercent: 90 },
      { machineId: machines[2].id, moduleId: modules[2].id, requiredWatchPercent: 90 },
    ]

    await db
      .insert(schema.machineRequirements)
      .values(requirementsData)
      .onConflictDoNothing()

    console.log('Created machine requirements')
  }

  console.log('Seed complete!')
  console.log('')
  console.log('Test accounts:')
  console.log('  Admin:   admin@example.com / admin123')
  console.log('  Manager: manager@example.com / manager123')
  console.log('  Member:  member@example.com / member123')

  await client.end()
}

seed().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
