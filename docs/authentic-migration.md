# Authentic Migration Guide

This document describes how to migrate the authentication system from the development implementation to Authentic.

## Current Architecture

The application uses an abstraction layer for authentication defined in:
- `apps/web/src/server/auth/types.ts` - Auth interfaces
- `apps/web/src/server/auth/dev-auth.ts` - Development implementation
- `apps/web/src/server/auth/middleware.ts` - Request middleware

The `AuthService` interface defines all authentication operations:
- Session management (create, validate, invalidate)
- User management (credentials verification, password hashing, user lookup)

## Migration Steps

### 1. Create Authentic Service Implementation

Create `apps/web/src/server/auth/authentic-auth.ts`:

```typescript
import type { AuthService, AuthUser, UserRole } from './types'
import { db, users } from '~/lib/db'
import { eq } from 'drizzle-orm'

const AUTHENTIC_URL = process.env.AUTHENTIC_URL

export class AuthenticAuthService implements AuthService {
  async createSession(userId: string): Promise<string> {
    // Authentic handles session creation
    // This might be called after Authentic OAuth flow completes
    // Return the Authentic session token
    const response = await fetch(`${AUTHENTIC_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const { token } = await response.json()
    return token
  }

  async validateSession(token: string): Promise<AuthUser | null> {
    // Validate token with Authentic
    const response = await fetch(`${AUTHENTIC_URL}/api/sessions/validate`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) return null

    const { userId, email } = await response.json()

    // Map Authentic user to local user record
    const localUser = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (!localUser || localUser.status !== 'active') return null

    return {
      id: localUser.id,
      email: localUser.email,
      name: localUser.name,
      role: localUser.role,
    }
  }

  async invalidateSession(token: string): Promise<void> {
    await fetch(`${AUTHENTIC_URL}/api/sessions`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  async invalidateUserSessions(userId: string): Promise<void> {
    // Find user email to revoke all sessions
    const user = await this.getUserById(userId)
    if (user) {
      await fetch(`${AUTHENTIC_URL}/api/users/${user.email}/sessions`, {
        method: 'DELETE',
      })
    }
  }

  async verifyCredentials(email: string, password: string): Promise<AuthUser | null> {
    // Authentic handles credential verification
    const response = await fetch(`${AUTHENTIC_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!response.ok) return null

    const { user: authenticUser } = await response.json()

    // Map to local user
    const localUser = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    })

    if (!localUser || localUser.status !== 'active') return null

    return {
      id: localUser.id,
      email: localUser.email,
      name: localUser.name,
      role: localUser.role,
    }
  }

  async hashPassword(password: string): Promise<string> {
    // Not used with Authentic - passwords are managed externally
    throw new Error('Password hashing is managed by Authentic')
  }

  async createUser(
    email: string,
    password: string,
    name?: string,
    role: UserRole = 'member'
  ): Promise<AuthUser> {
    // Create user in Authentic
    await fetch(`${AUTHENTIC_URL}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    // Create local user record (without password)
    const [user] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        name: name || null,
        role,
        passwordHash: null, // No local password with Authentic
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

    if (!user || user.status !== 'active') return null

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

    if (!user || user.status !== 'active') return null

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  }
}
```

### 2. Update Auth Service Factory

Modify `apps/web/src/server/auth/dev-auth.ts` to include Authentic:

```typescript
import { AuthenticAuthService } from './authentic-auth'

export function getAuthService(): AuthService {
  if (!authService) {
    const provider = process.env.AUTH_PROVIDER || 'dev'

    if (provider === 'dev') {
      authService = new DevAuthService()
    } else if (provider === 'authentic') {
      authService = new AuthenticAuthService()
    } else {
      throw new Error(`Unknown auth provider: ${provider}`)
    }
  }

  return authService
}
```

### 3. Update Environment Variables

```env
# Switch to Authentic
AUTH_PROVIDER=authentic
AUTHENTIC_URL=https://auth.example.com
```

### 4. Handle Session Token Format Differences

The session cookie format may differ between dev and Authentic:

1. **Dev mode**: 64-character hex string stored in database
2. **Authentic**: JWT or opaque token validated via API

Update the middleware if the token format changes:

```typescript
// In middleware.ts, handle both token formats
const sessionToken = cookies[SESSION_COOKIE_NAME]
if (!sessionToken) return null

// Authentic tokens may be JWTs
if (process.env.AUTH_PROVIDER === 'authentic') {
  // JWT validation or API call
}
```

### 5. User Synchronization

Ensure local user records exist for Authentic users:

1. On first login, create local user if not exists
2. Sync user metadata (name, email) periodically
3. Handle user deletion/suspension in both systems

### 6. OAuth/SSO Considerations

If using Authentic's OAuth providers:

1. Add OAuth callback routes
2. Handle token exchange
3. Create/link local user records on first OAuth login

### 7. Migration Checklist

- [ ] Create `AuthenticAuthService` implementation
- [ ] Update `getAuthService()` factory
- [ ] Set `AUTH_PROVIDER=authentic` in environment
- [ ] Set `AUTHENTIC_URL` to Authentic instance
- [ ] Test login flow end-to-end
- [ ] Test session validation
- [ ] Test logout/session invalidation
- [ ] Test user creation
- [ ] Verify role mapping works correctly
- [ ] Test in staging before production
- [ ] Plan for running both providers in parallel during transition

### 8. Rollback Plan

If issues arise:
1. Set `AUTH_PROVIDER=dev` to revert immediately
2. Users with Authentic-only accounts will need password reset
3. Consider maintaining dual-write during transition

## Testing Both Providers

During migration, you can test both providers:

```typescript
// In a test route or script
const devAuth = new DevAuthService()
const authenticAuth = new AuthenticAuthService()

// Verify same user returns from both
const devUser = await devAuth.getUserByEmail('test@example.com')
const authenticUser = await authenticAuth.getUserByEmail('test@example.com')

assert(devUser.id === authenticUser.id)
```
