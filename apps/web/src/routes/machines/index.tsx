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

  const eligibleMachines = machines.filter((machine) => machine.eligibility.eligible)
  const blockedMachines = machines.filter((machine) => !machine.eligibility.eligible)

  const renderMachineCard = (machine: (typeof machines)[number]) => (
    <Link
      key={machine.id}
      to="/machines/$machineId"
      params={{ machineId: machine.id }}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg">{machine.name}</CardTitle>
            {machine.eligibility.eligible ? (
              <Badge variant="success">Ready</Badge>
            ) : (
              <Badge variant="warning">Needs steps</Badge>
            )}
          </div>
          {machine.description && <CardDescription>{machine.description}</CardDescription>}
        </CardHeader>

        <CardContent className="space-y-3 pt-0">
          {!machine.eligibility.eligible ? (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">Next requirements:</p>
              <ul className="space-y-2">
                {machine.eligibility.reasons.slice(0, 2).map((reason, index) => (
                  <li key={index} className="rounded-md border bg-muted/30 px-2.5 py-2 text-sm">
                    {reason}
                  </li>
                ))}
                {machine.eligibility.reasons.length > 2 && (
                  <li className="text-sm text-muted-foreground">
                    +{machine.eligibility.reasons.length - 2} more requirements
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Open details to review schedule and request time.</p>
          )}
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <div className="min-h-screen">
      <Header user={user} />

      <main className="container space-y-8 py-6 md:py-8">
        <section>
          <h1 className="text-3xl font-semibold tracking-tight">Machines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resources are grouped by readiness so you can reserve quickly or tackle requirements.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Ready to reserve</CardDescription>
              <CardTitle className="text-2xl">{eligibleMachines.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Needs requirements</CardDescription>
              <CardTitle className="text-2xl">{blockedMachines.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total resources</CardDescription>
              <CardTitle className="text-2xl">{machines.length}</CardTitle>
            </CardHeader>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Ready to reserve</h2>
            <Badge variant="success">{eligibleMachines.length}</Badge>
          </div>
          {eligibleMachines.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {eligibleMachines.map(renderMachineCard)}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Complete training modules to unlock your first machine.
              </CardContent>
            </Card>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Needs requirements</h2>
            <Badge variant="warning">{blockedMachines.length}</Badge>
          </div>
          {blockedMachines.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {blockedMachines.map(renderMachineCard)}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                You are eligible for every active resource.
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  )
}
