export type UserRole = 'member' | 'manager' | 'admin'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  role: UserRole
}

export interface AuthService {
  // Session management
  createSession(userId: string): Promise<string>
  validateSession(token: string): Promise<AuthUser | null>
  invalidateSession(token: string): Promise<void>
  invalidateUserSessions(userId: string): Promise<void>

  // User management
  verifyCredentials(email: string, password: string): Promise<AuthUser | null>
  hashPassword(password: string): Promise<string>
  createUser(
    email: string,
    password: string,
    name?: string,
    role?: UserRole
  ): Promise<AuthUser>
  getUserById(id: string): Promise<AuthUser | null>
  getUserByEmail(email: string): Promise<AuthUser | null>
}

export interface SessionData {
  userId: string
  expiresAt: Date
}

export const SESSION_COOKIE_NAME = 'session_token'
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
