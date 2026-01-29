import { Link } from '@tanstack/react-router'
import type { AuthUser } from '~/server/auth/types'
import { Header } from './Header'

interface DashboardProps {
  user: AuthUser
}

export function Dashboard({ user }: DashboardProps) {
  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <h1 className="mb-3">Welcome, {user.name || user.email}</h1>

          <div className="grid grid-3">
            <Link to="/training" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Training</h3>
              </div>
              <p className="text-muted text-small">
                Complete required training modules to unlock machine access.
              </p>
            </Link>

            <Link to="/machines" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Machines</h3>
              </div>
              <p className="text-muted text-small">
                View available machines and check your eligibility.
              </p>
            </Link>

            <Link to="/reservations" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card-header">
                <h3 className="card-title">Reservations</h3>
              </div>
              <p className="text-muted text-small">
                View and manage your upcoming reservations.
              </p>
            </Link>
          </div>

          {(user.role === 'manager' || user.role === 'admin') && (
            <>
              <h2 className="mt-3 mb-2">Management</h2>
              <div className="grid grid-3">
                <Link to="/admin/checkouts" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="card-header">
                    <h3 className="card-title">Checkouts</h3>
                    <span className="badge badge-info">Manager</span>
                  </div>
                  <p className="text-muted text-small">
                    Approve member checkouts after training completion.
                  </p>
                </Link>

                {user.role === 'admin' && (
                  <>
                    <Link to="/admin/machines" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="card-header">
                        <h3 className="card-title">Manage Machines</h3>
                        <span className="badge badge-warning">Admin</span>
                      </div>
                      <p className="text-muted text-small">
                        Add and configure machines and their requirements.
                      </p>
                    </Link>

                    <Link to="/admin/training" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="card-header">
                        <h3 className="card-title">Manage Training</h3>
                        <span className="badge badge-warning">Admin</span>
                      </div>
                      <p className="text-muted text-small">
                        Create and manage training modules.
                      </p>
                    </Link>

                    <Link to="/admin/users" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="card-header">
                        <h3 className="card-title">Users</h3>
                        <span className="badge badge-warning">Admin</span>
                      </div>
                      <p className="text-muted text-small">
                        Manage user accounts and roles.
                      </p>
                    </Link>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
