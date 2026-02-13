import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { ReactNode } from 'react'
import appStylesHref from '../styles.css?url'
import { AppShell } from '~/components/layout/AppShell'
import { Button } from '~/components/ui/button'
import { getAuthUser } from '~/server/auth/middleware'

const getRootUser = createServerFn({ method: 'GET' }).handler(async () => {
  return await getAuthUser()
})

function normalizePath(pathname: string) {
  if (pathname !== '/' && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

function isAuthenticatedShellPath(pathname: string) {
  const normalizedPath = normalizePath(pathname)

  if (normalizedPath === '/') return true

  return (
    normalizedPath.startsWith('/training') ||
    normalizedPath.startsWith('/machines') ||
    normalizedPath.startsWith('/reservations') ||
    normalizedPath.startsWith('/admin')
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'referrer', content: 'strict-origin-when-cross-origin' },
      { title: 'Training & Reservation System' },
    ],
    links: [
      { rel: 'stylesheet', href: appStylesHref },
    ],
  }),
  loader: async () => {
    return {
      user: await getRootUser(),
    }
  },
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})

function RootComponent() {
  const { user } = Route.useLoaderData()
  const location = useLocation()

  const shouldRenderShell = Boolean(user) && isAuthenticatedShellPath(location.pathname)

  return (
    <RootDocument>
      {shouldRenderShell ? (
        <AppShell user={user!} pathname={location.pathname}>
          <Outlet />
        </AppShell>
      ) : (
        <Outlet />
      )}
    </RootDocument>
  )
}

function NotFoundComponent() {
  return (
    <RootDocument>
      <div className="container py-20 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">404 - Page Not Found</h1>
        <p className="mt-2 text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Button asChild className="mt-6">
          <Link to="/">Go Home</Link>
        </Button>
      </div>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
