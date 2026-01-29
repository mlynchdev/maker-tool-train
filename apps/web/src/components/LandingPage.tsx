import { Link } from '@tanstack/react-router'

export function LandingPage() {
  return (
    <div className="landing">
      <header className="header">
        <div className="container header-inner">
          <span className="logo">Training System</span>
          <nav className="nav">
            <Link to="/login">Login</Link>
            <Link to="/register" className="btn btn-primary">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <div className="hero">
        <div>
          <h1>Machine Training & Reservation System</h1>
          <p>
            Complete your training modules, get manager approval, and reserve
            equipment all in one place.
          </p>
          <div className="flex gap-2" style={{ justifyContent: 'center' }}>
            <Link to="/register" className="btn btn-primary">
              Create Account
            </Link>
            <Link to="/login" className="btn btn-secondary">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
