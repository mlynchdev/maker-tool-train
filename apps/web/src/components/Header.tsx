import { Link, useNavigate } from '@tanstack/react-router'
import type { AuthUser } from '~/server/auth/types'
import { logout } from '~/server/api/auth'

interface HeaderProps {
  user: AuthUser
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate({ to: '/' })
  }

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="logo">
          Training System
        </Link>

        <nav className="nav">
          <Link to="/training">Training</Link>
          <Link to="/machines">Machines</Link>
          <Link to="/reservations">Reservations</Link>

          {(user.role === 'manager' || user.role === 'admin') && (
            <Link to="/admin/checkouts">Checkouts</Link>
          )}

          <span className="text-muted text-small">{user.email}</span>
          <button onClick={handleLogout} className="btn btn-secondary">
            Logout
          </button>
        </nav>
      </div>
    </header>
  )
}
