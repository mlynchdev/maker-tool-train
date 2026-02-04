import { createFileRoute } from '@tanstack/react-router'
import { createSSEHandler } from '~/server/api/sse'

export const Route = createFileRoute('/api/sse/bookings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return createSSEHandler(request)
      },
    },
  },
})
