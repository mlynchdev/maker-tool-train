import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState, type FormEvent } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { queryKeys } from '~/lib/query/keys'
import { updateMakerspaceSettings } from '~/server/api/admin'
import { requireAdmin } from '~/server/auth/middleware'
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

type AdminSettingsData = Awaited<ReturnType<typeof getAdminSettingsData>>

const adminSettingsDataQueryOptions = queryOptions({
  queryKey: queryKeys.admin.settings(),
  queryFn: () => getAdminSettingsData(),
})

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const queryClient = useQueryClient()
  const adminSettingsQuery = useQuery(adminSettingsDataQueryOptions)
  const [timezone, setTimezone] = useState('')
  const [initializedTimezone, setInitializedTimezone] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (initializedTimezone) return
    if (!adminSettingsQuery.data?.timezone) return
    setTimezone(adminSettingsQuery.data.timezone)
    setInitializedTimezone(true)
  }, [adminSettingsQuery.data?.timezone, initializedTimezone])

  const updateSettingsMutation = useMutation({
    meta: {
      errorMessage: 'Failed to save settings',
    },
    mutationFn: async (variables: { timezone: string }) => {
      const result = await updateMakerspaceSettings({ data: variables })
      if (!result.success) {
        throw new Error('Failed to save settings')
      }
      return result
    },
    onSuccess: async () => {
      setMessage('Timezone updated. Checkout availability now uses this timezone.')
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings() })
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin.checkouts() })
    },
  })

  if (adminSettingsQuery.isPending && typeof adminSettingsQuery.data === 'undefined') {
    return <QueryLoadingScreen message="Loading admin settings..." />
  }

  if (adminSettingsQuery.isError && typeof adminSettingsQuery.data === 'undefined') {
    return (
      <QueryErrorScreen
        message="Unable to load admin settings."
        onRetry={() => {
          void adminSettingsQuery.refetch()
        }}
      />
    )
  }

  const timezoneOptions = adminSettingsQuery.data?.timezoneOptions ?? []

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')

    try {
      await updateSettingsMutation.mutateAsync({ timezone })
    } catch {
      setMessage('Failed to save settings.')
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

            {message ? <div className="alert alert-info mb-2">{message}</div> : null}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <select
                  className="form-input"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  disabled={updateSettingsMutation.isPending}
                >
                  {timezoneOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={updateSettingsMutation.isPending}
              >
                {updateSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
