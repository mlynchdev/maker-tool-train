import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  QueryErrorScreen,
  QueryLoadingScreen,
} from '~/components/query/QueryStateScreen'
import { Badge } from '~/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Progress } from '~/components/ui/progress'
import { trainingModulesQueryOptions } from '~/lib/query/options'

export const Route = createFileRoute('/training/')({
  component: TrainingPage,
})

function TrainingPage() {
  const trainingModulesQuery = useQuery(trainingModulesQueryOptions())
  const modules = trainingModulesQuery.data?.modules ?? []

  if (
    trainingModulesQuery.isPending &&
    typeof trainingModulesQuery.data === 'undefined'
  ) {
    return <QueryLoadingScreen message='Loading training modules...' />
  }

  if (
    trainingModulesQuery.isError &&
    typeof trainingModulesQuery.data === 'undefined'
  ) {
    return (
      <QueryErrorScreen
        message='Unable to load training modules.'
        onRetry={() => {
          void trainingModulesQuery.refetch()
        }}
      />
    )
  }

  const completedModules = modules.filter((module) =>
    Boolean(module.completedAt),
  )
  const incompleteModules = modules
    .filter((module) => !module.completedAt)
    .sort((a, b) => b.percentComplete - a.percentComplete)

  const renderModuleCard = (module: (typeof modules)[number]) => (
    <Link
      key={module.id}
      to='/training/$moduleId'
      params={{ moduleId: module.id }}
      className='block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <Card className='h-full transition-shadow hover:shadow-md'>
        <CardHeader className='space-y-3'>
          <div className='flex items-start justify-between gap-3'>
            <CardTitle className='text-lg'>{module.title}</CardTitle>
            {module.completedAt ? (
              <Badge variant='success'>Complete</Badge>
            ) : module.percentComplete > 0 ? (
              <Badge variant='warning'>{module.percentComplete}%</Badge>
            ) : (
              <Badge variant='info'>Not started</Badge>
            )}
          </div>
          {module.description && (
            <CardDescription>{module.description}</CardDescription>
          )}
        </CardHeader>

        <CardContent className='space-y-3 pt-0'>
          <Progress
            value={module.percentComplete}
            indicatorClassName={module.completedAt ? 'bg-emerald-500' : ''}
          />
          <p className='text-sm text-muted-foreground'>
            {Math.floor(module.durationSeconds / 60)} min video
          </p>
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className='min-h-screen'>
      <main className='container space-y-8 py-6 md:py-8'>
        <section>
          <h1 className='text-3xl font-semibold tracking-tight'>My Training</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Modules are grouped by next actions so it is easier to continue
            where you left off.
          </p>
        </section>

        <section>
          <div className='mb-3 flex items-center gap-2'>
            <h2 className='text-xl font-semibold tracking-tight'>Next up</h2>
            <Badge variant='warning'>{incompleteModules.length}</Badge>
          </div>

          {incompleteModules.length > 0 ? (
            <div className='grid gap-4 md:grid-cols-2'>
              {incompleteModules.map(renderModuleCard)}
            </div>
          ) : (
            <Card>
              <CardContent className='py-8 text-center text-muted-foreground'>
                You have completed all training modules.
              </CardContent>
            </Card>
          )}
        </section>

        {completedModules.length > 0 && (
          <section>
            <div className='mb-3 flex items-center gap-2'>
              <h2 className='text-xl font-semibold tracking-tight'>
                Completed
              </h2>
              <Badge variant='success'>{completedModules.length}</Badge>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              {completedModules.map(renderModuleCard)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
