import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { Plus, Search, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import { requireAdmin } from '~/server/auth/middleware'
import { db, trainingModules } from '~/lib/db'
import { Header } from '~/components/Header'
import { createTrainingModule, updateTrainingModule } from '~/server/api/admin'
import { YouTubePreview } from '~/components/YouTubePreview'
import { formatDuration, normalizeYouTubeId } from '~/lib/youtube'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

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
  const [moduleQuery, setModuleQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newTitleTouched, setNewTitleTouched] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newVideoInput, setNewVideoInput] = useState('')
  const [newAutoDuration, setNewAutoDuration] = useState<number | null>(null)
  const [newDurationOverride, setNewDurationOverride] = useState(false)
  const [newDurationMinutes, setNewDurationMinutes] = useState('')

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

  const filteredModules = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase()
    if (!query) return moduleList

    return moduleList.filter((module) => {
      const usedBy = module.requirements
        ?.map((req) => req.machine?.name || '')
        .join(' ')
        .toLowerCase()

      return (
        module.title.toLowerCase().includes(query) ||
        (module.description || '').toLowerCase().includes(query) ||
        module.youtubeVideoId.toLowerCase().includes(query) ||
        usedBy.includes(query)
      )
    })
  }, [moduleList, moduleQuery])

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
    } catch {
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
    } catch {
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
    } catch {
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
    <div className="space-y-2">
      <Label>Duration (minutes)</Label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="number"
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
          className="sm:max-w-[220px]"
        />
        <Button type="button" variant="outline" onClick={onToggleOverride}>
          {override ? 'Use auto duration' : 'Edit manually'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {override
          ? 'Manual override must be at least the real video length.'
          : autoDuration
            ? `Auto-detected from preview: ${formatDuration(autoDuration)}.`
            : 'Duration auto-fills after preview metadata loads.'}
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

  const textareaClassName =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container space-y-8 py-6 md:py-8">
        <section className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Training Module Administration</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Maintain content quality and machine eligibility mappings from one editor.
            </p>
          </div>
          <Button onClick={toggleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {showCreate ? 'Close form' : 'Add module'}
          </Button>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total modules</CardDescription>
              <CardTitle className="text-2xl">{moduleList.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active</CardDescription>
              <CardTitle className="text-2xl">{moduleList.filter((module) => module.active).length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Linked to machines</CardDescription>
              <CardTitle className="text-2xl">
                {moduleList.filter((module) => module.requirements.length > 0).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </section>

        {successMessage && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertTitle>Module created</AlertTitle>
            <AlertDescription>
              {successMessage}{' '}
              <Link to="/admin/machines" className="font-medium underline">
                Assign to machines
              </Link>
            </AlertDescription>
          </Alert>
        )}

        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New training module</CardTitle>
              <CardDescription>
                Add title, video source, and duration. Preview fills metadata automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                {createError && (
                  <Alert variant="destructive">
                    <AlertTitle>Unable to create module</AlertTitle>
                    <AlertDescription>{createError}</AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-module-title">Title</Label>
                    <Input
                      id="new-module-title"
                      type="text"
                      value={newTitle}
                      onChange={(e) => {
                        setNewTitle(e.target.value)
                        setNewTitleTouched(true)
                      }}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-module-video">YouTube URL or ID</Label>
                    <Input
                      id="new-module-video"
                      type="text"
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
                    <p className="text-xs text-muted-foreground">
                      Accepts full links, share URLs, and raw 11-character IDs.
                    </p>
                    {newVideoError && <p className="text-xs text-destructive">{newVideoError}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-module-description">Description</Label>
                  <textarea
                    id="new-module-description"
                    className={textareaClassName}
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
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Preview</CardTitle>
                    </CardHeader>
                    <CardContent>
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
                    </CardContent>
                  </Card>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Creating...' : 'Create module'}
                  </Button>
                  <Button type="button" variant="outline" onClick={toggleCreate}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Existing modules</CardTitle>
                <CardDescription>Search by title, description, video ID, or linked machine.</CardDescription>
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={moduleQuery}
                  onChange={(e) => setModuleQuery(e.target.value)}
                  placeholder="Search modules"
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        {filteredModules.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No training modules match your filters.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredModules.map((module) => {
              const machineNames = module.requirements
                ?.map((req) => req.machine?.name)
                .filter(Boolean) as string[]

              return (
                <Card key={module.id}>
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">{module.title}</CardTitle>
                        {module.description && (
                          <CardDescription className="mt-1">{module.description}</CardDescription>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={module.active ? 'success' : 'destructive'}>
                          {module.active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant="outline">{formatDuration(module.durationSeconds)}</Badge>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                      <p className="flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        Video ID: {module.youtubeVideoId}
                      </p>
                      <p>Used by: {machineNames.length > 0 ? machineNames.length : 0} machine(s)</p>
                      <p>
                        Linked machines: {machineNames.length > 0 ? machineNames.join(', ') : 'None'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(module)}>
                        Edit module
                      </Button>
                      <Button
                        variant={module.active ? 'destructive' : 'default'}
                        size="sm"
                        onClick={() => handleToggleActive(module.id, !module.active)}
                      >
                        {module.active ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>

                    {editingId === module.id && (
                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          Edit Module
                        </h4>

                        {editError && (
                          <Alert variant="destructive">
                            <AlertTitle>Unable to save module</AlertTitle>
                            <AlertDescription>{editError}</AlertDescription>
                          </Alert>
                        )}

                        <form onSubmit={handleUpdate} className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor={`edit-title-${module.id}`}>Title</Label>
                              <Input
                                id={`edit-title-${module.id}`}
                                type="text"
                                value={editTitle}
                                onChange={(e) => {
                                  setEditTitle(e.target.value)
                                  setEditTitleTouched(true)
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor={`edit-video-${module.id}`}>YouTube URL or ID</Label>
                              <Input
                                id={`edit-video-${module.id}`}
                                type="text"
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
                                <p className="text-xs text-destructive">{editVideoError}</p>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`edit-description-${module.id}`}>Description</Label>
                            <textarea
                              id={`edit-description-${module.id}`}
                              className={textareaClassName}
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
                            <Card>
                              <CardHeader>
                                <CardTitle className="text-sm">Preview</CardTitle>
                              </CardHeader>
                              <CardContent>
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
                              </CardContent>
                            </Card>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button type="submit" disabled={saving}>
                              {saving ? 'Saving...' : 'Save changes'}
                            </Button>
                            <Button type="button" variant="outline" onClick={cancelEdit}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
