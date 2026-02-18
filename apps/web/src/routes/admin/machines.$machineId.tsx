import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { asc, eq } from 'drizzle-orm'
import { useEffect, useState, type FormEvent } from 'react'
import { QueryErrorScreen, QueryLoadingScreen } from '~/components/query/QueryStateScreen'
import { db, machines, trainingModules } from '~/lib/db'
import { queryKeys } from '~/lib/query/keys'
import { setMachineRequirements, updateMachine } from '~/server/api/admin'
import { requireManager } from '~/server/auth/middleware'

const TRAINING_DURATION_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 45, label: '45 minutes' },
  { value: 60, label: '1 hour' },
] as const

const getMachineEditData = createServerFn({ method: 'GET' })
  .inputValidator((data: { machineId: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireManager()

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

const machineEditDataQueryOptions = (machineId: string) =>
  queryOptions({
    queryKey: queryKeys.admin.machineEditor(machineId),
    queryFn: () => getMachineEditData({ data: { machineId } }),
  })

export const Route = createFileRoute('/admin/machines/$machineId')({
  component: EditMachinePage,
})

function EditMachinePage() {
  const { machineId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const machineEditQuery = useQuery(machineEditDataQueryOptions(machineId))

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [resourceType, setResourceType] = useState<'machine' | 'tool'>('machine')
  const [trainingDurationMinutes, setTrainingDurationMinutes] = useState(30)
  const [selectedModules, setSelectedModules] = useState<
    Array<{ moduleId: string; percent: number }>
  >([])
  const [initializedMachineId, setInitializedMachineId] = useState<string | null>(null)

  useEffect(() => {
    const machine = machineEditQuery.data?.machine
    if (!machine) return
    if (initializedMachineId === machine.id) return

    setName(machine.name)
    setDescription(machine.description || '')
    setResourceType(machine.resourceType)
    setTrainingDurationMinutes(machine.trainingDurationMinutes)
    setSelectedModules(
      machine.requirements.map((requirement) => ({
        moduleId: requirement.moduleId,
        percent: requirement.requiredWatchPercent,
      }))
    )
    setInitializedMachineId(machine.id)
  }, [initializedMachineId, machineEditQuery.data?.machine])

  const saveMachineMutation = useMutation({
    meta: {
      errorMessage: 'Failed to save changes',
    },
    mutationFn: async (variables: {
      machineId: string
      name: string
      description?: string
      resourceType: 'machine' | 'tool'
      trainingDurationMinutes: number
      requirements: Array<{ moduleId: string; requiredWatchPercent: number }>
    }) => {
      const [machineResult, requirementsResult] = await Promise.all([
        updateMachine({
          data: {
            machineId: variables.machineId,
            name: variables.name,
            description: variables.description,
            resourceType: variables.resourceType,
            trainingDurationMinutes: variables.trainingDurationMinutes,
          },
        }),
        setMachineRequirements({
          data: {
            machineId: variables.machineId,
            requirements: variables.requirements,
          },
        }),
      ])

      if (!machineResult.success || !requirementsResult.success) {
        throw new Error('Failed to save changes')
      }

      return machineResult
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.machines() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.machineEditor(machineId) }),
      ])

      navigate({ to: '/admin/machines' })
    },
  })

  if (machineEditQuery.isPending && typeof machineEditQuery.data === 'undefined') {
    return <QueryLoadingScreen message="Loading machine editor..." />
  }

  if (machineEditQuery.isError && typeof machineEditQuery.data === 'undefined') {
    return (
      <QueryErrorScreen
        message="Unable to load machine details."
        onRetry={() => {
          void machineEditQuery.refetch()
        }}
      />
    )
  }

  const user = machineEditQuery.data?.user
  const machine = machineEditQuery.data?.machine
  const modules = machineEditQuery.data?.modules ?? []

  if (!machine) {
    return <QueryErrorScreen message="Machine not found." />
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()

    try {
      await saveMachineMutation.mutateAsync({
        machineId: machine.id,
        name,
        description: description || undefined,
        resourceType,
        trainingDurationMinutes,
        requirements: selectedModules.map((selected) => ({
          moduleId: selected.moduleId,
          requiredWatchPercent: selected.percent,
        })),
      })
    } catch {
      // Error handling is managed by centralized mutation handlers.
    }
  }

  const toggleModule = (moduleId: string) => {
    setSelectedModules((prev) => {
      const exists = prev.find((module) => module.moduleId === moduleId)
      if (exists) {
        return prev.filter((module) => module.moduleId !== moduleId)
      }

      return [...prev, { moduleId, percent: 90 }]
    })
  }

  const updatePercent = (moduleId: string, percent: number) => {
    setSelectedModules((prev) =>
      prev.map((module) =>
        module.moduleId === moduleId ? { ...module, percent } : module
      )
    )
  }

  return (
    <div>
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
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={resourceType}
                  onChange={(e) =>
                    setResourceType(e.target.value as 'machine' | 'tool')
                  }
                >
                  <option value="machine">Machine</option>
                  <option value="tool">Tool</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Training Duration</label>
                <select
                  className="form-input"
                  value={trainingDurationMinutes}
                  onChange={(e) => setTrainingDurationMinutes(Number(e.target.value))}
                >
                  {TRAINING_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="card mb-3">
              <h3 className="card-title mb-2">Training Requirements</h3>
              <p className="text-small text-muted mb-2">
                Select the training modules that must be completed before a member
                can reserve this machine.
              </p>

              {modules.length > 0 ? (
                <div className="table-wrapper">
                  <table className="table table-mobile-cards">
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
                          (item) => item.moduleId === module.id
                        )
                        return (
                          <tr key={module.id}>
                            <td data-label="Required">
                              <input
                                type="checkbox"
                                checked={!!selected}
                                onChange={() => toggleModule(module.id)}
                              />
                            </td>
                            <td data-label="Module">{module.title}</td>
                            <td data-label="Min %">
                              {selected ? (
                                <input
                                  type="number"
                                  className="form-input table-inline-input"
                                  min="1"
                                  max="100"
                                  value={selected.percent}
                                  onChange={(e) =>
                                    updatePercent(
                                      module.id,
                                      Number.parseInt(e.target.value, 10) || 90
                                    )
                                  }
                                />
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted">
                  No training modules available.{' '}
                  {user?.role === 'admin' ? (
                    <Link to="/admin/training">Create a training module.</Link>
                  ) : (
                    'Ask an admin to create one in Training Admin.'
                  )}
                </p>
              )}
            </div>

            <div className="action-row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saveMachineMutation.isPending}
              >
                {saveMachineMutation.isPending ? 'Saving...' : 'Save Changes'}
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
