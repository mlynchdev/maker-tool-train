import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { asc } from 'drizzle-orm'
import { useMemo, useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { Header } from '~/components/Header'
import { createTrainingModule, updateTrainingModule } from '~/server/api/admin'
import { YouTubePreview } from '~/components/YouTubePreview'
import { formatDuration, normalizeYouTubeId } from '~/lib/youtube'

const getAdminTrainingData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAdmin()

  const moduleList = await db.query.trainingModules.findMany({
    orderBy: [asc(trainingModules.title)],
    with: {
      requirements: {
        with: {
          machine: true,
        },
      },
    },
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
  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Create form state
  const [newTitle, setNewTitle] = useState('')
  const [newTitleTouched, setNewTitleTouched] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newVideoInput, setNewVideoInput] = useState('')
  const [newAutoDuration, setNewAutoDuration] = useState<number | null>(null)
  const [newDurationOverride, setNewDurationOverride] = useState(false)
  const [newDurationMinutes, setNewDurationMinutes] = useState('')

  // Edit form state
  const [editTitle, setEditTitle] = useState('')
  const [editTitleTouched, setEditTitleTouched] = useState(false)
  const [editDescription, setEditDescription] = useState('')
  const [editVideoInput, setEditVideoInput] = useState('')
  const [editAutoDuration, setEditAutoDuration] = useState<number | null>(null)
  const [editDurationOverride, setEditDurationOverride] = useState(false)
  const [editDurationMinutes, setEditDurationMinutes] = useState('')

  const newVideoId = useMemo(
    () => normalizeYouTubeId(newVideoInput),
    [newVideoInput]
  )
  const editVideoId = useMemo(
    () => normalizeYouTubeId(editVideoInput),
    [editVideoInput]
  )

  const resetCreateForm = () => {
    setNewTitle('')
    setNewTitleTouched(false)
    setNewDescription('')
    setNewVideoInput('')
    setNewAutoDuration(null)
    setNewDurationOverride(false)
    setNewDurationMinutes('')
    setCreateError(null)
  }

  const toggleCreate = () => {
    if (showCreate) {
      resetCreateForm()
      setShowCreate(false)
    } else {
      setShowCreate(true)
      setSuccessMessage(null)
    }
  }

  const toggleNewDurationOverride = () => {
    setNewDurationOverride((prev) => {
      const next = !prev
      if (next && newAutoDuration && !newDurationMinutes) {
        setNewDurationMinutes(Math.ceil(newAutoDuration / 60).toString())
      }
      return next
    })
  }

  const toggleEditDurationOverride = () => {
    setEditDurationOverride((prev) => {
      const next = !prev
      if (next && editAutoDuration && !editDurationMinutes) {
        setEditDurationMinutes(Math.ceil(editAutoDuration / 60).toString())
      }
      return next
    })
  }

  const sortModules = (modules: typeof moduleList) =>
    [...modules].sort((a, b) => a.title.localeCompare(b.title))

  const getDurationSeconds = (
    autoSeconds: number | null,
    override: boolean,
    overrideMinutes: string
  ) => {
    if (!override) return autoSeconds

    const minutes = parseFloat(overrideMinutes)
    if (!minutes || minutes <= 0) return null

    return Math.round(minutes * 60)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setSuccessMessage(null)

    if (!newTitle.trim()) {
      setCreateError('Title is required.')
      return
    }

    if (!newVideoInput.trim()) {
      setCreateError('YouTube URL or ID is required.')
      return
    }

    if (!newVideoId) {
      setCreateError('Invalid YouTube URL or ID.')
      return
    }

    const durationSeconds = getDurationSeconds(
      newAutoDuration,
      newDurationOverride,
      newDurationMinutes
    )

    if (!durationSeconds) {
      setCreateError('Duration is required. Confirm the video or enter it manually.')
      return
    }

    setSaving(true)

    try {
      const result = await createTrainingModule({
        data: {
          title: newTitle,
          description: newDescription || undefined,
          youtubeVideoId: newVideoInput,
          durationSeconds,
        },
      })

      if (!result.success) {
        setCreateError(result.error || 'Failed to create module')
        return
      }

      if (result.module) {
        setModuleList((prev) =>
          sortModules([
            ...prev,
            {
              ...result.module,
              requirements: [],
            },
          ])
        )
        setShowCreate(false)
        resetCreateForm()
        setSuccessMessage('Training module created. Assign it to machines next.')
      }
    } catch (error) {
      setCreateError('Failed to create module')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (module: (typeof moduleList)[0]) => {
    setEditingId(module.id)
    setEditTitle(module.title)
    setEditTitleTouched(false)
    setEditDescription(module.description || '')
    setEditVideoInput(module.youtubeVideoId)
    setEditAutoDuration(module.durationSeconds)
    setEditDurationOverride(false)
    setEditDurationMinutes(Math.ceil(module.durationSeconds / 60).toString())
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!editingId) return

    setEditError(null)

    if (!editTitle.trim()) {
      setEditError('Title is required.')
      return
    }

    if (!editVideoInput.trim()) {
      setEditError('YouTube URL or ID is required.')
      return
    }

    if (!editVideoId) {
      setEditError('Invalid YouTube URL or ID.')
      return
    }

    const durationSeconds = getDurationSeconds(
      editAutoDuration,
      editDurationOverride,
      editDurationMinutes
    )

    if (!durationSeconds) {
      setEditError('Duration is required. Confirm the video or enter it manually.')
      return
    }

    setSaving(true)

    try {
      const result = await updateTrainingModule({
        data: {
          moduleId: editingId,
          title: editTitle,
          description: editDescription || undefined,
          youtubeVideoId: editVideoInput,
          durationSeconds,
        },
      })

      if (!result.success) {
        setEditError(result.error || 'Failed to update module')
        return
      }

      if (result.module) {
        setModuleList((prev) =>
          sortModules(
            prev.map((m) =>
              m.id === editingId
                ? {
                    ...m,
                    ...result.module,
                  }
                : m
            )
          )
        )
        setEditingId(null)
      }
    } catch (error) {
      setEditError('Failed to update module')
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

  const renderDurationInput = (
    autoDuration: number | null,
    override: boolean,
    overrideMinutes: string,
    onOverrideChange: (value: string) => void,
    onToggleOverride: () => void
  ) => (
    <div className="form-group">
      <label className="form-label">Duration</label>
      <div className="flex gap-1">
        <input
          type="number"
          className="form-input"
          value={
            override
              ? overrideMinutes
              : autoDuration
                ? Math.ceil(autoDuration / 60).toString()
                : ''
          }
          onChange={(e) => onOverrideChange(e.target.value)}
          min="1"
          step="1"
          disabled={!override}
        />
        <button type="button" className="btn btn-secondary" onClick={onToggleOverride}>
          {override ? 'Use Auto' : 'Edit'}
        </button>
      </div>
      <p className="text-small text-muted mt-1">
        {override
          ? 'Override duration in minutes. Ensure it is at least the actual video length.'
          : autoDuration
            ? `Auto-detected from preview: ${formatDuration(autoDuration)}.`
            : 'Duration will auto-fill once the preview loads.'}
      </p>
    </div>
  )

  const newVideoError =
    newVideoInput.trim().length > 0 && !newVideoId
      ? 'Invalid YouTube URL or ID.'
      : null

  const editVideoError =
    editVideoInput.trim().length > 0 && !editVideoId
      ? 'Invalid YouTube URL or ID.'
      : null

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="flex flex-between flex-center mb-3">
            <h1>Manage Training Modules</h1>
            <button className="btn btn-primary" onClick={toggleCreate}>
              {showCreate ? 'Cancel' : 'Add Module'}
            </button>
          </div>

          {successMessage && (
            <div className="alert alert-success">
              {successMessage}{' '}
              <Link to="/admin/machines" className="text-small">
                Assign to machines
              </Link>
            </div>
          )}

          {showCreate && (
            <div className="card mb-3">
              <h3 className="card-title mb-2">New Training Module</h3>
              {createError && <div className="alert alert-danger">{createError}</div>}
              <form onSubmit={handleCreate}>
                <div className="grid grid-2">
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newTitle}
                      onChange={(e) => {
                        setNewTitle(e.target.value)
                        setNewTitleTouched(true)
                      }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">YouTube URL or ID</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newVideoInput}
                      onChange={(e) => {
                        setNewVideoInput(e.target.value)
                        setNewAutoDuration(null)
                        if (!newDurationOverride) {
                          setNewDurationMinutes('')
                        }
                      }}
                      placeholder="https://www.youtube.com/watch?v=..."
                      required
                    />
                    <p className="text-small text-muted mt-1">
                      Accepts full YouTube URLs, share links, or the 11-character video ID.
                    </p>
                    {newVideoError && <div className="form-error">{newVideoError}</div>}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Short summary of the training module"
                  />
                </div>

                {renderDurationInput(
                  newAutoDuration,
                  newDurationOverride,
                  newDurationMinutes,
                  (value) => setNewDurationMinutes(value),
                  toggleNewDurationOverride
                )}

                {newVideoId && (
                  <div className="card mb-2">
                    <h4 className="card-title mb-2">Preview</h4>
                    <YouTubePreview
                      videoId={newVideoId}
                      onMetadata={(metadata) => {
                        if (metadata.durationSeconds) {
                          setNewAutoDuration(metadata.durationSeconds)
                          if (!newDurationOverride) {
                            setNewDurationMinutes(
                              Math.ceil(metadata.durationSeconds / 60).toString()
                            )
                          }
                        }
                        if (!newTitleTouched && !newTitle.trim() && metadata.title) {
                          setNewTitle(metadata.title)
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Creating...' : 'Create Module'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={toggleCreate}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <h2 className="mb-2">Existing Modules</h2>

          {moduleList.length === 0 ? (
            <div className="card">
              <p className="text-center text-muted">No training modules configured.</p>
            </div>
          ) : (
            moduleList.map((module) => {
              const machineNames = module.requirements
                ?.map((req) => req.machine?.name)
                .filter(Boolean) as string[]

              return (
                <div key={module.id} className="card">
                  <div className="flex flex-between flex-center mb-1">
                    <div>
                      <div className="card-title">{module.title}</div>
                      {module.description && (
                        <div className="text-small text-muted">
                          {module.description}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <span
                        className={`badge ${module.active ? 'badge-success' : 'badge-danger'}`}
                      >
                        {module.active ? 'Active' : 'Inactive'}
                      </span>
                      <button className="btn btn-secondary" onClick={() => startEdit(module)}>
                        Edit
                      </button>
                      <button
                        className={`btn ${module.active ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => handleToggleActive(module.id, !module.active)}
                      >
                        {module.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-3 text-small text-muted mt-2">
                    <div>Video ID: {module.youtubeVideoId}</div>
                    <div>Duration: {formatDuration(module.durationSeconds)}</div>
                    <div>
                      Used by:{' '}
                      {machineNames && machineNames.length > 0
                        ? machineNames.join(', ')
                        : 'No machines'}
                    </div>
                  </div>

                  {editingId === module.id && (
                    <div
                      style={{
                        borderTop: '1px solid #e0e0e0',
                        marginTop: '1rem',
                        paddingTop: '1rem',
                      }}
                    >
                      <h4 className="card-title mb-2">Edit Module</h4>
                      {editError && <div className="alert alert-danger">{editError}</div>}
                      <form onSubmit={handleUpdate}>
                        <div className="grid grid-2">
                          <div className="form-group">
                            <label className="form-label">Title</label>
                            <input
                              type="text"
                              className="form-input"
                              value={editTitle}
                              onChange={(e) => {
                                setEditTitle(e.target.value)
                                setEditTitleTouched(true)
                              }}
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">YouTube URL or ID</label>
                            <input
                              type="text"
                              className="form-input"
                              value={editVideoInput}
                              onChange={(e) => {
                                setEditVideoInput(e.target.value)
                                setEditAutoDuration(null)
                                if (!editDurationOverride) {
                                  setEditDurationMinutes('')
                                }
                              }}
                            />
                            {editVideoError && (
                              <div className="form-error">{editVideoError}</div>
                            )}
                          </div>
                        </div>

                        <div className="form-group">
                          <label className="form-label">Description</label>
                          <textarea
                            className="form-input"
                            rows={3}
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                          />
                        </div>

                        {renderDurationInput(
                          editAutoDuration,
                          editDurationOverride,
                          editDurationMinutes,
                          (value) => setEditDurationMinutes(value),
                          toggleEditDurationOverride
                        )}

                        {editVideoId && (
                          <div className="card mb-2">
                            <h4 className="card-title mb-2">Preview</h4>
                            <YouTubePreview
                              videoId={editVideoId}
                              onMetadata={(metadata) => {
                                if (metadata.durationSeconds) {
                                  setEditAutoDuration(metadata.durationSeconds)
                                  if (!editDurationOverride) {
                                    setEditDurationMinutes(
                                      Math.ceil(metadata.durationSeconds / 60).toString()
                                    )
                                  }
                                }
                                if (
                                  !editTitleTouched &&
                                  !editTitle.trim() &&
                                  metadata.title
                                ) {
                                  setEditTitle(metadata.title)
                                }
                              }}
                            />
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="btn btn-success"
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
