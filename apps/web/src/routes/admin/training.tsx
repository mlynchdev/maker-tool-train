import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { asc } from 'drizzle-orm'
import { useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { Header } from '~/components/Header'
import { createTrainingModule, updateTrainingModule } from '~/server/api/admin'

const getAdminTrainingData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAdmin()

  const moduleList = await db.query.trainingModules.findMany({
    orderBy: [asc(trainingModules.title)],
  })

  return { user, modules: moduleList }
})

export const Route = createFileRoute('/admin/training')({
  component: AdminTrainingPage,
  loader: async () => {
    return await getAdminTrainingData()
  },
})

function AdminTrainingPage() {
  const { user, modules: initialModules } = Route.useLoaderData()
  const [moduleList, setModuleList] = useState(initialModules)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Create form state
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newVideoId, setNewVideoId] = useState('')
  const [newDuration, setNewDuration] = useState('')

  // Edit form state
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editVideoId, setEditVideoId] = useState('')
  const [editDuration, setEditDuration] = useState('')

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const result = await createTrainingModule({
        data: {
          title: newTitle,
          description: newDescription || undefined,
          youtubeVideoId: newVideoId,
          durationSeconds: parseInt(newDuration) * 60, // Convert minutes to seconds
        },
      })

      if (result.success && result.module) {
        setModuleList((prev) => [...prev, result.module])
        setNewTitle('')
        setNewDescription('')
        setNewVideoId('')
        setNewDuration('')
        setShowCreate(false)
      }
    } catch (error) {
      alert('Failed to create module')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (module: (typeof moduleList)[0]) => {
    setEditingId(module.id)
    setEditTitle(module.title)
    setEditDescription(module.description || '')
    setEditVideoId(module.youtubeVideoId)
    setEditDuration((module.durationSeconds / 60).toString())
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    setSaving(true)

    try {
      const result = await updateTrainingModule({
        data: {
          moduleId: editingId,
          title: editTitle,
          description: editDescription || undefined,
          youtubeVideoId: editVideoId,
          durationSeconds: parseInt(editDuration) * 60,
        },
      })

      if (result.success && result.module) {
        setModuleList((prev) =>
          prev.map((m) => (m.id === editingId ? result.module : m))
        )
        setEditingId(null)
      }
    } catch (error) {
      alert('Failed to update module')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (moduleId: string, active: boolean) => {
    try {
      const result = await updateTrainingModule({
        data: { moduleId, active },
      })

      if (result.success) {
        setModuleList((prev) =>
          prev.map((m) => (m.id === moduleId ? { ...m, active } : m))
        )
      }
    } catch (error) {
      alert('Failed to update module')
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    return `${mins} min`
  }

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="flex flex-between flex-center mb-3">
            <h1>Manage Training Modules</h1>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? 'Cancel' : 'Add Module'}
            </button>
          </div>

          {/* Create Form */}
          {showCreate && (
            <div className="card mb-3">
              <h3 className="card-title mb-2">New Training Module</h3>
              <form onSubmit={handleCreate}>
                <div className="grid grid-2">
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">YouTube Video ID</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newVideoId}
                      onChange={(e) => setNewVideoId(e.target.value)}
                      placeholder="e.g., dQw4w9WgXcQ"
                      required
                    />
                  </div>
                </div>
                <div className="grid grid-2">
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
                    <label className="form-label">Duration (minutes)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={newDuration}
                      onChange={(e) => setNewDuration(e.target.value)}
                      min="1"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Module'}
                </button>
              </form>
            </div>
          )}

          {/* Module List */}
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Video ID</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {moduleList.map((module) => (
                  <tr key={module.id}>
                    {editingId === module.id ? (
                      <>
                        <td>
                          <input
                            type="text"
                            className="form-input"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="form-input"
                            value={editVideoId}
                            onChange={(e) => setEditVideoId(e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="form-input"
                            style={{ width: '80px' }}
                            value={editDuration}
                            onChange={(e) => setEditDuration(e.target.value)}
                          />
                        </td>
                        <td>
                          <span
                            className={`badge ${module.active ? 'badge-success' : 'badge-danger'}`}
                          >
                            {module.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button
                              className="btn btn-success"
                              onClick={handleUpdate}
                              disabled={saving}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div>{module.title}</div>
                          {module.description && (
                            <div className="text-small text-muted">
                              {module.description}
                            </div>
                          )}
                        </td>
                        <td className="text-small">{module.youtubeVideoId}</td>
                        <td>{formatDuration(module.durationSeconds)}</td>
                        <td>
                          <span
                            className={`badge ${module.active ? 'badge-success' : 'badge-danger'}`}
                          >
                            {module.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            <button
                              className="btn btn-secondary"
                              onClick={() => startEdit(module)}
                            >
                              Edit
                            </button>
                            <button
                              className={`btn ${module.active ? 'btn-danger' : 'btn-success'}`}
                              onClick={() =>
                                handleToggleActive(module.id, !module.active)
                              }
                            >
                              {module.active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {moduleList.length === 0 && (
              <p className="text-center text-muted" style={{ padding: '2rem' }}>
                No training modules configured.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
