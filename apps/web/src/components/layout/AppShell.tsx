import { useEffect, useState, type ReactNode } from 'react'
import type { AuthUser } from '~/server/auth/types'
import { AppSidebar } from '~/components/layout/AppSidebar'
import { AppTopbar } from '~/components/layout/AppTopbar'
import { ShellProvider } from '~/components/layout/ShellContext'
import { cn } from '~/lib/utils'

interface AppShellProps {
  user: AuthUser
  pathname: string
  children: ReactNode
}

export function AppShell({ user, pathname, children }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [pathname])

  return (
    <ShellProvider user={user}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_42%),radial-gradient(circle_at_bottom_right,hsl(var(--accent)/0.18),transparent_38%),hsl(var(--background))]">
        <div className="flex min-h-screen">
          <aside className="hidden w-72 border-r bg-card/65 backdrop-blur lg:flex">
            <AppSidebar />
          </aside>

          <div
            className={cn(
              'fixed inset-0 z-50 flex transition-opacity duration-300 ease-in lg:hidden',
              mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <aside
              className={cn(
                'h-full w-80 max-w-[88vw] border-r bg-card shadow-xl transition-transform duration-300 ease-in',
                mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
              )}
            >
              <AppSidebar
                mobile
                onNavigate={() => setMobileSidebarOpen(false)}
                onClose={() => setMobileSidebarOpen(false)}
              />
            </aside>
            <button
              className="flex-1 bg-foreground/30"
              aria-label="Close sidebar"
              onClick={() => setMobileSidebarOpen(false)}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <AppTopbar pathname={pathname} onOpenSidebar={() => setMobileSidebarOpen(true)} />
            {children}
          </div>
        </div>
      </div>
    </ShellProvider>
  )
}
