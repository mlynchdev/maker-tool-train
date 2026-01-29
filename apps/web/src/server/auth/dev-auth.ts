import { eq, lt } from 'drizzle-orm'
import { db, users, sessions } from '~/lib/db'
import type { AuthService, AuthUser, UserRole } from './types'
import { SESSION_DURATION_MS } from './types'

function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class DevAuthService implements AuthService {
  async createSession(userId: string): Promise<string> {
    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

    await db.insert(sessions).values({
      id: token,
      userId,
      expiresAt,
    })

    return token
  }

  async validateSession(token: string): Promise<AuthUser | null> {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, token),
      with: {
        user: true,
      },
    })

    if (!session) {
      return null
    }

    if (session.expiresAt < new Date()) {
      await this.invalidateSession(token)
      return null
    }

    if (session.user.status !== 'active') {
      return null
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    }
  }

  async invalidateSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, token))
  }

  async invalidateUserSessions(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId))
  }

  async verifyCredentials(
    email: string,
    password: string
  ): Promise<AuthUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    })

    if (!user || !user.passwordHash) {
      return null
    }

    const isValid = await Bun.password.verify(password, user.passwordHash)
    if (!isValid) {
      return null
    }

    if (user.status !== 'active') {
      return null
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }

  async hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, {
      algorithm: 'argon2id',
      memoryCost: 19456,
      timeCost: 2,
    })
  }

  async createUser(
    email: string,
    password: string,
    name?: string,
    role: UserRole = 'member'
  ): Promise<AuthUser> {
    const passwordHash = await this.hashPassword(password)

    const [user] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        name: name || null,
        role,
      })
      .returning()

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }

  async getUserById(id: string): Promise<AuthUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    })

    if (!user || user.status !== 'active') {
      return null
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }

  async getUserByEmail(email: string): Promise<AuthUser | null> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    })

    if (!user || user.status !== 'active') {
      return null
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }

  // Utility: Clean up expired sessions
  async cleanupExpiredSessions(): Promise<number> {
    const result = await db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date()))
      .returning()

    return result.length
  }
}

// Singleton instance
let authService: AuthService | null = null

export function getAuthService(): AuthService {
  if (!authService) {
    const provider = process.env.AUTH_PROVIDER || 'dev'

    if (provider === 'dev') {
      authService = new DevAuthService()
    } else if (provider === 'authentic') {
      // TODO: Implement AuthenticAuthService
      throw new Error('Authentic auth provider not yet implemented')
    } else {
      throw new Error(`Unknown auth provider: ${provider}`)
    }
  }

  return authService
}
