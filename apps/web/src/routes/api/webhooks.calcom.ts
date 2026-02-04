import { createFileRoute } from '@tanstack/react-router'
import { handleCalcomWebhook } from '~/server/api/webhooks'

export const Route = createFileRoute('/api/webhooks/calcom')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const result = await handleCalcomWebhook({ data: body })
          return Response.json(result)
        } catch (error) {
          console.error('Webhook error:', error)
          return Response.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 400 }
          )
        }
      },
    },
  },
})
