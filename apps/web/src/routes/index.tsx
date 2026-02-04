import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getAuthUser } from '~/server/auth/middleware'
import { Dashboard } from '~/components/Dashboard'
import { LandingPage } from '~/components/LandingPage'

const getUser = createServerFn({ method: 'GET' }).handler(async () => {
  return await getAuthUser()
})

export const Route = createFileRoute('/')({
  component: Home,
  loader: async () => {
    const user = await getUser()
    return { user }
  },
})

function Home() {
  const { user } = Route.useLoaderData()

  if (!user) {
    return <LandingPage />
  }

  return <Dashboard user={user} />
}
