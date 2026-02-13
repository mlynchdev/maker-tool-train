import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Header } from '~/components/Header'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import { requireAuth } from '~/server/auth/middleware'
import { getAllModulesWithProgress } from '~/server/services/training'

const getTrainingData = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuth()
  const modules = await getAllModulesWithProgress(user.id)
  return { user, modules }
})

export const Route = createFileRoute('/training/')({
  component: TrainingPage,
  loader: async () => {
    return await getTrainingData()
  },
})

function TrainingPage() {
  const { user, modules } = Route.useLoaderData()

  const completedCount = modules.filter((module) => module.completedAt).length
  const totalCount = modules.length
  const overallPercent = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Training Modules</h1>
          <Badge variant="info">
            {completedCount} / {totalCount} completed
          </Badge>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Overall Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Completion</span>
              <span className="font-medium">{overallPercent}%</span>
            </div>
            <Progress value={overallPercent} indicatorClassName={overallPercent === 100 ? 'bg-emerald-500' : ''} />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((module) => (
            <Link
              key={module.id}
              to="/training/$moduleId"
              params={{ moduleId: module.id }}
              className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
                  <CardTitle className="text-lg">{module.title}</CardTitle>
                  {module.completedAt ? (
                    <Badge variant="success">Complete</Badge>
                  ) : (
                    <Badge variant="warning">{module.percentComplete}%</Badge>
                  )}
                </CardHeader>

                <CardContent className="space-y-4">
                  {module.description && (
                    <CardDescription>{module.description}</CardDescription>
                  )}

                  <Progress
                    value={module.percentComplete}
                    indicatorClassName={module.completedAt ? 'bg-emerald-500' : ''}
                  />

                  <p className="text-sm text-muted-foreground">
                    {Math.floor(module.durationSeconds / 60)} min video
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {modules.length === 0 && (
          <Card className="mt-4">
            <CardContent className="py-8 text-center text-muted-foreground">
              No training modules available.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
