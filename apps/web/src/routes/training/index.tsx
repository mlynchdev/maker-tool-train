import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { getAuthUser, requireAuth } from '~/server/auth/middleware'
import { getAllModulesWithProgress } from '~/server/services/training'
import { Header } from '~/components/Header'

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

  const completedCount = modules.filter((m) => m.completedAt).length
  const totalCount = modules.length
  const overallPercent = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0

  return (
    <div>
      <Header user={user} />

      <main className="main">
        <div className="container">
          <div className="flex flex-between flex-center mb-3">
            <h1>Training Modules</h1>
            <span className="badge badge-info">
              {completedCount} / {totalCount} completed
            </span>
          </div>

          <div className="card mb-3">
            <div className="flex flex-between flex-center mb-1">
              <span className="text-small text-muted">Overall Progress</span>
              <span className="text-small">{overallPercent}%</span>
            </div>
            <div className="progress">
              <div
                className={`progress-bar ${overallPercent === 100 ? 'complete' : ''}`}
                style={{ width: `${overallPercent}%` }}
              />
            </div>
          </div>

          <div className="grid grid-2">
            {modules.map((module) => (
              <Link
                key={module.id}
                to="/training/$moduleId"
                params={{ moduleId: module.id }}
                className="card"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card-header">
                  <h3 className="card-title">{module.title}</h3>
                  {module.completedAt ? (
                    <span className="badge badge-success">Complete</span>
                  ) : (
                    <span className="badge badge-warning">{module.percentComplete}%</span>
                  )}
                </div>

                {module.description && (
                  <p className="text-muted text-small mb-2">{module.description}</p>
                )}

                <div className="progress">
                  <div
                    className={`progress-bar ${module.completedAt ? 'complete' : ''}`}
                    style={{ width: `${module.percentComplete}%` }}
                  />
                </div>

                <p className="text-small text-muted mt-1">
                  {Math.floor(module.durationSeconds / 60)} min video
                </p>
              </Link>
            ))}
          </div>

          {modules.length === 0 && (
            <div className="card">
              <p className="text-center text-muted">No training modules available.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
