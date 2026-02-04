import { getRequest } from '@tanstack/react-start/server'
import { getAuthService } from './dev-auth'
import { SESSION_COOKIE_NAME, type AuthUser, type UserRole } from './types'

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=')
    if (name) {
      cookies[name] = rest.join('=')
    }
  })
  return cookies
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const request = getRequest()
  const cookieHeader = request.headers.get('cookie')

  if (!cookieHeader) {
    return null
  }

  const cookies = parseCookies(cookieHeader)
  const sessionToken = cookies[SESSION_COOKIE_NAME]

  if (!sessionToken) {
    return null
  }

  const auth = getAuthService()
  return auth.validateSession(sessionToken)
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser()

  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

export async function requireRole(...roles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuth()

  if (!roles.includes(user.role)) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return user
}

export async function requireManager(): Promise<AuthUser> {
  return requireRole('manager', 'admin')
}

export async function requireAdmin(): Promise<AuthUser> {
  return requireRole('admin')
}

export function createSessionCookie(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === 'production'
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function createLogoutCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
