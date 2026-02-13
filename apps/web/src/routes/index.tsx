import { createFileRoute } from '@tanstack/react-router'
import { Dashboard } from '~/components/Dashboard'
import { LandingPage } from '~/components/LandingPage'
import { Route as RootRoute } from '~/routes/__root'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { user } = RootRoute.useLoaderData()

  if (!user) {
    return <LandingPage />
  }

  return <Dashboard user={user} />
}
