import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

interface QueryMetaLike {
  errorMessage?: unknown
  suppressToast?: unknown
}

interface MutationMetaLike {
  errorMessage?: unknown
  suppressToast?: unknown
}

interface QueryClientErrorNotification {
  message: string
  source: 'query' | 'mutation'
  queryKey?: readonly unknown[]
  mutationKey?: readonly unknown[]
  error: unknown
}

interface CreateQueryClientOptions {
  onErrorNotification?: (notification: QueryClientErrorNotification) => void
}

function getErrorStatus(error: unknown): number | null {
  if (error instanceof Response) {
    return error.status
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status
  }

  return null
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = getErrorStatus(error)

  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return false
  }

  return failureCount < 2
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }

  return fallback
}

function shouldSurfaceError(meta: QueryMetaLike | MutationMetaLike | undefined) {
  return meta?.suppressToast !== true
}

function getMetaErrorMessage(
  meta: QueryMetaLike | MutationMetaLike | undefined
): string | undefined {
  return typeof meta?.errorMessage === 'string' ? meta.errorMessage : undefined
}

export function createQueryClient(options: CreateQueryClientOptions = {}) {
  const { onErrorNotification } = options

  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: 0,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        const meta = query.meta as QueryMetaLike | undefined
        if (onErrorNotification && shouldSurfaceError(meta)) {
          onErrorNotification({
            message: getMetaErrorMessage(meta)
              ?? getErrorMessage(error, 'Unable to load data right now.'),
            source: 'query',
            queryKey: query.queryKey,
            error,
          })
        }

        console.error('Query failed', {
          queryKey: query.queryKey,
          error,
        })
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const meta = mutation.meta as MutationMetaLike | undefined
        if (onErrorNotification && shouldSurfaceError(meta)) {
          onErrorNotification({
            message: getMetaErrorMessage(meta)
              ?? getErrorMessage(error, 'Unable to save your changes right now.'),
            source: 'mutation',
            mutationKey: mutation.options.mutationKey,
            error,
          })
        }

        console.error('Mutation failed', {
          mutationKey: mutation.options.mutationKey,
          error,
        })
      },
    }),
  })
}
