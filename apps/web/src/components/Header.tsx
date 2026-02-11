import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import type { AuthUser } from '~/server/auth/types'
import { logout } from '~/server/api/auth'
import { getPendingCheckoutCount } from '~/server/api/admin'

interface HeaderProps {
  user: AuthUser
}

export function Header({ user }: HeaderProps) {
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    if (user.role === 'manager' || user.role === 'admin') {
      getPendingCheckoutCount().then((r) => setPendingCount(r.count))
    }
  }, [user.role])

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
            <Link to="/admin/checkouts" style={{ position: 'relative' }}>
              Checkouts
              {pendingCount > 0 && (
                <span className="badge badge-warning" style={{ marginLeft: '0.35rem' }}>
                  {pendingCount}
                </span>
              )}
            </Link>
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
