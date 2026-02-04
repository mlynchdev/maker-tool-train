import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { eq, asc } from 'drizzle-orm'
import { useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { db, machines, trainingModules } from '~/lib/db'
import { Header } from '~/components/Header'
import { updateMachine, setMachineRequirements } from '~/server/api/admin'

const getMachineEditData = createServerFn({ method: 'GET' })
  .inputValidator((data: { machineId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireAdmin()

    const machine = await db.query.machines.findFirst({
      where: eq(machines.id, data.machineId),
      with: {
        requirements: {
          with: {
            module: true,
          },
        },
      },
    })

    if (!machine) {
      throw new Response('Machine not found', { status: 404 })
    }

    const moduleList = await db.query.trainingModules.findMany({
      where: eq(trainingModules.active, true),
      orderBy: [asc(trainingModules.title)],
    })

    return { user, machine, modules: moduleList }
  })

export const Route = createFileRoute('/admin/machines/$machineId')({
  component: EditMachinePage,
  loader: async ({ params }) => {
    return await getMachineEditData({ machineId: params.machineId })
  },
})

function EditMachinePage() {
  const { user, machine, modules } = Route.useLoaderData()
  const navigate = useNavigate()

  const [name, setName] = useState(machine.name)
  const [description, setDescription] = useState(machine.description || '')
  const [calcomId, setCalcomId] = useState(
    machine.calcomEventTypeId?.toString() || ''
  )
  const [selectedModules, setSelectedModules] = useState<
    Array<{ moduleId: string; percent: number }>
  >(
    machine.requirements.map((r) => ({
      moduleId: r.moduleId,
      percent: r.requiredWatchPercent,
    }))
  )
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      // Update machine details
      await updateMachine({
        data: {
          machineId: machine.id,
          name,
          description: description || undefined,
          calcomEventTypeId: calcomId ? parseInt(calcomId) : undefined,
        },
      })

      // Update requirements
      await setMachineRequirements({
        data: {
          machineId: machine.id,
          requirements: selectedModules.map((m) => ({
            moduleId: m.moduleId,
            requiredWatchPercent: m.percent,
          })),
        },
      })

      navigate({ to: '/admin/machines' })
    } catch (error) {
      alert('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const toggleModule = (moduleId: string) => {
    setSelectedModules((prev) => {
      const exists = prev.find((m) => m.moduleId === moduleId)
      if (exists) {
        return prev.filter((m) => m.moduleId !== moduleId)
      } else {
        return [...prev, { moduleId, percent: 90 }]
      }
    })
  }

  const updatePercent = (moduleId: string, percent: number) => {
    setSelectedModules((prev) =>
      prev.map((m) => (m.moduleId === moduleId ? { ...m, percent } : m))
    )
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="mb-2">
            <Link to="/admin/machines" className="text-small">
              &larr; Back to Machines
            </Link>
          </div>

          <h1 className="mb-3">Edit Machine</h1>

          <form onSubmit={handleSave}>
            <div className="card mb-3">
              <h3 className="card-title mb-2">Machine Details</h3>

              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Cal.com Event Type ID</label>
                <input
                  type="number"
                  className="form-input"
                  value={calcomId}
                  onChange={(e) => setCalcomId(e.target.value)}
                  placeholder="Leave empty if not using Cal.com"
                />
                <p className="text-small text-muted mt-1">
                  This links the machine to a Cal.com event type for scheduling.
                </p>
              </div>
            </div>

            <div className="card mb-3">
              <h3 className="card-title mb-2">Training Requirements</h3>
              <p className="text-small text-muted mb-2">
                Select the training modules that must be completed before a member
                can reserve this machine.
              </p>

              {modules.length > 0 ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Required</th>
                      <th>Module</th>
                      <th>Min %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((module) => {
                      const selected = selectedModules.find(
                        (m) => m.moduleId === module.id
                      )
                      return (
                        <tr key={module.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={!!selected}
                              onChange={() => toggleModule(module.id)}
                            />
                          </td>
                          <td>{module.title}</td>
                          <td>
                            {selected && (
                              <input
                                type="number"
                                className="form-input"
                                style={{ width: '80px' }}
                                min="1"
                                max="100"
                                value={selected.percent}
                                onChange={(e) =>
                                  updatePercent(module.id, parseInt(e.target.value) || 90)
                                }
                              />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-muted">No training modules available.</p>
              )}
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <Link to="/admin/machines" className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
