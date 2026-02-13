import { Link } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-slate-100/70">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-4">
          <span className="text-lg font-semibold tracking-tight">Training System</span>
          <nav className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Login
            </Link>
            <Button asChild size="sm">
              <Link to="/register">Get Started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="container flex min-h-[calc(100vh-73px)] items-center py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Machine Training & Reservation System
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Complete your training modules, get manager approval, and reserve equipment all in
            one place.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <Link to="/register">Create Account</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/login">Sign In</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
