import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../drizzle/schema'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required')
}

// Create postgres connection
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

// Create drizzle instance with schema
export const db = drizzle(client, { schema })

// Export schema for convenience
export * from '../../drizzle/schema'
