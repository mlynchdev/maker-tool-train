import { createAPIFileRoute } from '@tanstack/start/api'
import { createSSEHandler } from '~/server/api/sse'

export const APIRoute = createAPIFileRoute('/api/sse/bookings')({
  GET: async ({ request }) => {
    return createSSEHandler(request)
  },
})
