import { createFileRoute } from '@tanstack/react-router'
import { handleCalcomWebhook } from '~/server/api/webhooks'

export const Route = createFileRoute('/api/webhooks/calcom')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}))
        const result = await handleCalcomWebhook({ data: body })
        return Response.json(result, { status: 410 })
      },
    },
  },
})
