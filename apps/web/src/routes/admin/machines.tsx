import { Outlet, createFileRoute, Link, useChildMatches } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { Plus, Search, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { requireManager } from '~/server/auth/middleware'
import { db, machines } from '~/lib/db'
import { Header } from '~/components/Header'
import { createMachine, updateMachine } from '~/server/api/admin'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

const TRAINING_DURATION_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
] as const

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

  return { user, machines: machineList }
})

export const Route = createFileRoute('/admin/machines')({
  component: AdminMachinesPage,
  loader: async () => {
    return await getAdminMachinesData()
  },
})

function AdminMachinesPage() {
  const childMatches = useChildMatches()
  const { user, machines: initialMachines } = Route.useLoaderData()
  const [machineList, setMachineList] = useState(initialMachines)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [machineQuery, setMachineQuery] = useState('')

  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newResourceType, setNewResourceType] = useState<'machine' | 'tool'>(
    'machine'
  )
  const [newTrainingDurationMinutes, setNewTrainingDurationMinutes] = useState(30)

  if (childMatches.length > 0) {
    return <Outlet />
  }

  const normalizedQuery = machineQuery.trim().toLowerCase()

  const filteredMachines = useMemo(() => {
    if (!normalizedQuery) return machineList

    return machineList.filter((machine) => {
      const name = machine.name.toLowerCase()
      const description = (machine.description || '').toLowerCase()
      const type = machine.resourceType.toLowerCase()
      return (
        name.includes(normalizedQuery) ||
        description.includes(normalizedQuery) ||
        type.includes(normalizedQuery)
      )
    })
  }, [machineList, normalizedQuery])

  const activeMachines = filteredMachines.filter((machine) => machine.active)
  const inactiveMachines = filteredMachines.filter((machine) => !machine.active)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const result = await createMachine({
        data: {
          name: newName,
          description: newDescription || undefined,
          resourceType: newResourceType,
          trainingDurationMinutes: newTrainingDurationMinutes,
        },
      })

      if (result.success && result.machine) {
        setMachineList((prev) => [...prev, { ...result.machine, requirements: [] }])
        setNewName('')
        setNewDescription('')
        setNewResourceType('machine')
        setNewTrainingDurationMinutes(30)
        setShowCreate(false)
      }
    } catch {
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
    } catch {
      alert('Failed to update machine')
    }
  }

  const selectClassName =
    'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

  const renderMachineCard = (machine: (typeof machineList)[number]) => (
    <Card key={machine.id}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{machine.name}</CardTitle>
            {machine.description && (
              <CardDescription className="mt-1">{machine.description}</CardDescription>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="capitalize">
              {machine.resourceType}
            </Badge>
            <Badge variant={machine.active ? 'success' : 'destructive'}>
              {machine.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Final checkout duration: {machine.trainingDurationMinutes === 60 ? '1 hour' : `${machine.trainingDurationMinutes} minutes`}
        </p>

        <div>
          <p className="mb-2 text-sm font-medium">Training requirements</p>
          {machine.requirements.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {machine.requirements.map((req) => (
                <Badge key={req.id} variant="secondary">
                  {req.module.title} ({req.requiredWatchPercent}%)
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No requirements configured.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/machines/$machineId" params={{ machineId: machine.id }}>
              Edit details
            </Link>
          </Button>
          <Button
            variant={machine.active ? 'destructive' : 'default'}
            size="sm"
            onClick={() => handleToggleActive(machine.id, !machine.active)}
          >
            {machine.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container space-y-8 py-6 md:py-8">
        <section className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Machine Administration</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure resources, activation state, and requirements in one streamlined workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.role === 'admin' && (
              <Button asChild variant="outline">
                <Link to="/admin/training">Manage training modules</Link>
              </Button>
            )}
            <Button onClick={() => setShowCreate((prev) => !prev)}>
              <Plus className="mr-2 h-4 w-4" />
              {showCreate ? 'Close form' : 'Add machine'}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total resources</CardDescription>
              <CardTitle className="text-2xl">{machineList.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active</CardDescription>
              <CardTitle className="text-2xl">{machineList.filter((machine) => machine.active).length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>With requirements</CardDescription>
              <CardTitle className="text-2xl">
                {machineList.filter((machine) => machine.requirements.length > 0).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </section>

        {showCreate && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create new resource</CardTitle>
              <CardDescription>Choose the resource type and default checkout duration.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="machine-name">Name</Label>
                    <Input
                      id="machine-name"
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="machine-type">Type</Label>
                    <select
                      id="machine-type"
                      className={selectClassName}
                      value={newResourceType}
                      onChange={(e) =>
                        setNewResourceType(e.target.value as 'machine' | 'tool')
                      }
                    >
                      <option value="machine">Machine</option>
                      <option value="tool">Tool</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="machine-description">Description</Label>
                  <Input
                    id="machine-description"
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Short summary of this resource"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="machine-duration">Training duration</Label>
                  <select
                    id="machine-duration"
                    className={selectClassName}
                    value={newTrainingDurationMinutes}
                    onChange={(e) => setNewTrainingDurationMinutes(Number(e.target.value))}
                  >
                    {TRAINING_DURATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Creating...' : 'Create resource'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
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
                <CardTitle className="text-base">Resources</CardTitle>
                <CardDescription>Search by name, description, or type.</CardDescription>
              </div>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={machineQuery}
                  onChange={(e) => setMachineQuery(e.target.value)}
                  placeholder="Search resources"
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
        </Card>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Active</h2>
            <Badge variant="success">{activeMachines.length}</Badge>
          </div>
          {activeMachines.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">{activeMachines.map(renderMachineCard)}</div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No active resources match your search.
              </CardContent>
            </Card>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Inactive</h2>
            <Badge variant="destructive">{inactiveMachines.length}</Badge>
          </div>
          {inactiveMachines.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">{inactiveMachines.map(renderMachineCard)}</div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No inactive resources match your search.
              </CardContent>
            </Card>
          )}
        </section>

        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Wrench className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Keep resource descriptions concise so members can quickly identify the correct machine.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
