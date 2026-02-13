import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { updateMakerspaceSettings } from '~/server/api/admin'
import {
  getMakerspaceTimezone,
  getSupportedIanaTimezones,
} from '~/server/services/makerspace-settings'

const getAdminSettingsData = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdmin()

  return {
    timezone: await getMakerspaceTimezone(),
    timezoneOptions: getSupportedIanaTimezones(),
  }
})

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
  loader: async () => {
    return await getAdminSettingsData()
  },
})

function AdminSettingsPage() {
  const { timezone: initialTimezone, timezoneOptions } = Route.useLoaderData()
  const [timezone, setTimezone] = useState(initialTimezone)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      await updateMakerspaceSettings({ data: { timezone } })
      setMessage('Timezone updated. Checkout availability now uses this timezone.')
    } catch {
      setMessage('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <main className="main">
        <div className="container">
          <h1 className="mb-3">Admin Settings</h1>

          <div className="card" style={{ maxWidth: '42rem' }}>
            <h3 className="card-title mb-2">Makerspace Timezone</h3>
            <p className="text-small text-muted mb-2">
              Final checkout availability and bookings are evaluated in this timezone.
            </p>

            {message && <div className="alert alert-info mb-2">{message}</div>}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <select
                  className="form-input"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  disabled={saving}
                >
                  {timezoneOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
