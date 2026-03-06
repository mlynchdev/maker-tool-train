/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '~/lib/query/keys'
import { useBookingsSSEInvalidation } from './useBookingsSSEInvalidation'

class MockEventSource {
  static instances: MockEventSource[] = []

  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  close = vi.fn()

  constructor(_url: string) {
    MockEventSource.instances.push(this)
  }
}

function TestComponent() {
  useBookingsSSEInvalidation()
  return null
}

describe('useBookingsSSEInvalidation', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.useFakeTimers()
    ;(globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reconnects with exponential backoff, resets after reconnect, and stops on cleanup', async () => {
    const queryClient = new QueryClient()

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    )

    expect(MockEventSource.instances).toHaveLength(1)

    MockEventSource.instances[0].onerror?.(new Event('error'))
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_999)
    expect(MockEventSource.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(MockEventSource.instances).toHaveLength(2)

    MockEventSource.instances[1].onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(3_999)
    expect(MockEventSource.instances).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(MockEventSource.instances).toHaveLength(3)

    MockEventSource.instances[2].onopen?.(new Event('open'))
    MockEventSource.instances[2].onerror?.(new Event('error'))
    await vi.advanceTimersByTimeAsync(1_999)
    expect(MockEventSource.instances).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(1)
    expect(MockEventSource.instances).toHaveLength(4)

    MockEventSource.instances[3].onerror?.(new Event('error'))
    unmount()
    await vi.runOnlyPendingTimersAsync()

    expect(MockEventSource.instances).toHaveLength(4)
    expect(MockEventSource.instances[3].close).toHaveBeenCalled()
  })

  it('invalidates the expected queries for SSE events', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    )

    const source = MockEventSource.instances[0]

    source.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ event: 'booking' }),
      })
    )

    await Promise.resolve()

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.reservations.all,
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.pendingReservationRequestCount(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.pendingReservationRequests(),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.bookingRequests(),
    })

    source.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ event: 'machine_availability' }),
      })
    )

    await Promise.resolve()

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.machines(),
    })
  })
})
