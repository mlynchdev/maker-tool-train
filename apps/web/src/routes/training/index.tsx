import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import { requireAuth } from '~/server/auth/middleware'
import { getAllModulesWithProgress } from '~/server/services/training'

const getTrainingData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()
  const modules = await getAllModulesWithProgress(user.id)
  return { modules }
})

export const Route = createFileRoute('/training/')({
  component: TrainingPage,
  loader: async () => {
    return await getTrainingData()
  },
})

function TrainingPage() {
  const { modules } = Route.useLoaderData()

  const completedModules = modules.filter((module) => Boolean(module.completedAt))
  const incompleteModules = modules
    .filter((module) => !module.completedAt)
    .sort((a, b) => b.percentComplete - a.percentComplete)

  const completedCount = completedModules.length
  const totalCount = modules.length
  const overallPercent = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0

  const renderModuleCard = (module: (typeof modules)[number]) => (
    <Link
      key={module.id}
      to="/training/$moduleId"
      params={{ moduleId: module.id }}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg">{module.title}</CardTitle>
            {module.completedAt ? (
              <Badge variant="success">Complete</Badge>
            ) : module.percentComplete > 0 ? (
              <Badge variant="warning">{module.percentComplete}%</Badge>
            ) : (
              <Badge variant="info">Not started</Badge>
            )}
          </div>
          {module.description && <CardDescription>{module.description}</CardDescription>}
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          <Progress
            value={module.percentComplete}
            indicatorClassName={module.completedAt ? 'bg-emerald-500' : ''}
          />
          <p className="text-sm text-muted-foreground">{Math.floor(module.durationSeconds / 60)} min video</p>
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className="min-h-screen">
      <main className="container space-y-8 py-6 md:py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Training</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Modules are grouped by next actions so it is easier to continue where you left off.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card className="sm:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Overall Progress</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Completion</span>
                <span className="font-medium">{overallPercent}%</span>
              </div>
              <Progress value={overallPercent} indicatorClassName={overallPercent === 100 ? 'bg-emerald-500' : ''} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Completed modules</CardDescription>
              <CardTitle className="text-2xl">
                {completedCount} / {totalCount}
              </CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Next up</h2>
            <Badge variant="warning">{incompleteModules.length}</Badge>
          </div>

          {incompleteModules.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {incompleteModules.map(renderModuleCard)}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                You have completed all training modules.
              </CardContent>
            </Card>
          )}
        </section>

        {completedModules.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Completed</h2>
              <Badge variant="success">{completedModules.length}</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {completedModules.map(renderModuleCard)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
