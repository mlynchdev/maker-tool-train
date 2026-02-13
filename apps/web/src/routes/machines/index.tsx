import { createFileRoute, Link } from '@tanstack/react-router'
import { Header } from '~/components/Header'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { getMachines } from '~/server/api/machines'

export const Route = createFileRoute('/machines/')({
  component: MachinesPage,
  loader: async () => {
    return await getMachines()
  },
})

function MachinesPage() {
  const { user, machines } = Route.useLoaderData()

  const eligibleCount = machines.filter((machine) => machine.eligibility.eligible).length

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Machines</h1>
          <Badge variant="info">
            {eligibleCount} / {machines.length} available
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {machines.map((machine) => (
            <Link
              key={machine.id}
              to="/machines/$machineId"
              params={{ machineId: machine.id }}
              className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
                  <CardTitle className="text-lg">{machine.name}</CardTitle>
                  {machine.eligibility.eligible ? (
                    <Badge variant="success">Available</Badge>
                  ) : (
                    <Badge variant="warning">Requirements</Badge>
                  )}
                </CardHeader>

                <CardContent className="space-y-3">
                  {machine.description && (
                    <CardDescription>{machine.description}</CardDescription>
                  )}

                  {!machine.eligibility.eligible && (
                    <div>
                      <p className="mb-2 text-sm text-muted-foreground">Missing requirements:</p>
                      <ul className="space-y-2">
                        {machine.eligibility.reasons.slice(0, 2).map((reason, index) => (
                          <li key={index} className="flex items-start gap-2 text-sm">
                            <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive/20 text-xs font-semibold text-destructive">
                              !
                            </span>
                            <span>{reason}</span>
                          </li>
                        ))}
                        {machine.eligibility.reasons.length > 2 && (
                          <li className="text-sm text-muted-foreground">
                            +{machine.eligibility.reasons.length - 2} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {machine.eligibility.eligible && (
                    <p className="text-sm text-muted-foreground">
                      Click to view availability and make a reservation.
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {machines.length === 0 && (
          <Card className="mt-4">
            <CardContent className="py-8 text-center text-muted-foreground">
              No machines available.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
