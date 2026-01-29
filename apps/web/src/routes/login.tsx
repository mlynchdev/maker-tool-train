import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { login } from '~/server/api/auth'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await login({ data: { email, password } })

      if (result.success) {
        navigate({ to: '/' })
      } else {
        setError(result.error || 'Login failed')
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      <header className="header">
        <div className="container header-inner">
          <a href="/" className="logo">
            Training System
          </a>
        </div>
      </header>

      <div className="hero">
        <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
          <h2 className="mb-2">Sign In</h2>

          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center mt-2 text-small">
            Don't have an account? <a href="/register">Register</a>
          </p>
        </div>
      </div>
    </div>
  )
}
