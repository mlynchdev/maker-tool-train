import { Outlet, createFileRoute, Link, useChildMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, machines, trainingModules } from '~/lib/db'
import { Header } from '~/components/Header'
import { createMachine, updateMachine, setMachineRequirements } from '~/server/api/admin'

const getAdminMachinesData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireManager()

  const machineList = await db.query.machines.findMany({
    with: {
      requirements: {
        with: {
          module: true,
        },
      },
    },
    orderBy: [asc(machines.name)],
  })

  const moduleList = await db.query.trainingModules.findMany({
    orderBy: [asc(trainingModules.title)],
  })

  return { user, machines: machineList, modules: moduleList }
})

export const Route = createFileRoute('/admin/machines')({
  component: AdminMachinesPage,
  loader: async () => {
    return await getAdminMachinesData()
  },
})

function AdminMachinesPage() {
  const childMatches = useChildMatches()
  const { user, machines: initialMachines, modules } = Route.useLoaderData()
  const [machineList, setMachineList] = useState(initialMachines)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newResourceType, setNewResourceType] = useState<'machine' | 'tool'>(
    'machine'
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const result = await createMachine({
        data: {
          name: newName,
          description: newDescription || undefined,
          resourceType: newResourceType,
        },
      })

      if (result.success && result.machine) {
        setMachineList((prev) => [...prev, { ...result.machine, requirements: [] }])
        setNewName('')
        setNewDescription('')
        setNewResourceType('machine')
        setShowCreate(false)
      }
    } catch (error) {
      alert('Failed to create machine')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (machineId: string, active: boolean) => {
    try {
      const result = await updateMachine({
        data: { machineId, active },
      })

      if (result.success) {
        setMachineList((prev) =>
          prev.map((m) => (m.id === machineId ? { ...m, active } : m))
        )
      }
    } catch (error) {
      alert('Failed to update machine')
    }
  }

  if (childMatches.length > 0) {
    return <Outlet />
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div
            className="flex flex-between flex-center mb-3"
            style={{ flexWrap: 'wrap', gap: '0.75rem' }}
          >
            <h1>Manage Machines</h1>
            <div className="action-row">
              {user.role === 'admin' && (
                <Link to="/admin/training" className="btn btn-secondary">
                  Manage Training
                </Link>
              )}
              <button
                className="btn btn-primary"
                onClick={() => setShowCreate(!showCreate)}
              >
                {showCreate ? 'Cancel' : 'Add Machine'}
              </button>
            </div>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="card mb-3">
              <h3 className="card-title mb-2">New Machine</h3>
              <form onSubmit={handleCreate}>
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select
                    className="form-input"
                    value={newResourceType}
                    onChange={(e) =>
                      setNewResourceType(e.target.value as 'machine' | 'tool')
                    }
                  >
                    <option value="machine">Machine</option>
                    <option value="tool">Tool</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Machine'}
                </button>
              </form>
            </div>
          )}

          {/* Machine List */}
          <div className="grid grid-2">
            {machineList.map((machine) => (
              <div key={machine.id} className="card">
                <div className="card-header">
                  <h3 className="card-title">{machine.name}</h3>
                  <div className="action-row">
                    <span className="badge badge-info" style={{ textTransform: 'capitalize' }}>
                      {machine.resourceType}
                    </span>
                    <span
                      className={`badge ${machine.active ? 'badge-success' : 'badge-danger'}`}
                    >
                      {machine.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>

                {machine.description && (
                  <p className="text-small text-muted mb-2">{machine.description}</p>
                )}

                <div className="mb-2">
                  <strong className="text-small">Training Requirements:</strong>
                  {machine.requirements.length > 0 ? (
                    <ul className="eligibility-list">
                      {machine.requirements.map((req) => (
                        <li key={req.id} className="eligibility-item">
                          <span className="text-small">
                            {req.module.title} ({req.requiredWatchPercent}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-muted">No requirements</p>
                  )}
                </div>

                <div className="action-row">
                  <Link
                    to="/admin/machines/$machineId"
                    params={{ machineId: machine.id }}
                    className="btn btn-secondary"
                  >
                    Edit
                  </Link>
                  <button
                    className={`btn ${machine.active ? 'btn-danger' : 'btn-success'}`}
                    onClick={() => handleToggleActive(machine.id, !machine.active)}
                  >
                    {machine.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {machineList.length === 0 && (
            <div className="card">
              <p className="text-center text-muted">No machines configured.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
