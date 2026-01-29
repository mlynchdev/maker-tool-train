import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { getAuthService, getAuthUser, createSessionCookie, createLogoutCookie, SESSION_DURATION_MS } from '../auth'
import { setResponseHeader } from 'vinxi/http'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
})

export const login = createServerFn({ method: 'POST' })
  .validator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const auth = getAuthService()

    const user = await auth.verifyCredentials(data.email, data.password)
    if (!user) {
      return { success: false, error: 'Invalid email or password' }
    }

    const token = await auth.createSession(user.id)
    const maxAge = Math.floor(SESSION_DURATION_MS / 1000)

    setResponseHeader('Set-Cookie', createSessionCookie(token, maxAge))

    return { success: true, user }
  })

export const register = createServerFn({ method: 'POST' })
  .validator((data: unknown) => registerSchema.parse(data))
  .handler(async ({ data }) => {
    const auth = getAuthService()

    // Check if user already exists
    const existing = await auth.getUserByEmail(data.email)
    if (existing) {
      return { success: false, error: 'Email already registered' }
    }

    const user = await auth.createUser(data.email, data.password, data.name)
    const token = await auth.createSession(user.id)
    const maxAge = Math.floor(SESSION_DURATION_MS / 1000)

    setResponseHeader('Set-Cookie', createSessionCookie(token, maxAge))

    return { success: true, user }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  setResponseHeader('Set-Cookie', createLogoutCookie())
  return { success: true }
})

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await getAuthUser()
  return { user }
})
