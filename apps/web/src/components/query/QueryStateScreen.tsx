import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'

interface QueryStateScreenProps {
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export function QueryLoadingScreen({ message }: QueryStateScreenProps) {
  return (
    <div className="min-h-screen">
      <main className="container py-8">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {message}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

export function QueryErrorScreen({
  message,
  onRetry,
  retryLabel = 'Try again',
}: QueryStateScreenProps) {
  return (
    <div className="min-h-screen">
      <main className="container py-8">
        <Card>
          <CardContent className="space-y-3 py-8 text-center text-muted-foreground">
            <p>{message}</p>
            {onRetry ? (
              <Button variant="outline" onClick={onRetry}>
                {retryLabel}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
