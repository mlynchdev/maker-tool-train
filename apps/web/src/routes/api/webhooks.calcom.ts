import { json } from '@tanstack/start'
import { createAPIFileRoute } from '@tanstack/start/api'
import { handleCalcomWebhook } from '~/server/api/webhooks'

export const APIRoute = createAPIFileRoute('/api/webhooks/calcom')({
  POST: async ({ request }) => {
    try {
      const body = await request.json()
      const result = await handleCalcomWebhook({ data: body })
      return json(result)
    } catch (error) {
      console.error('Webhook error:', error)
      return json(
        { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
        { status: 400 }
      )
    }
  },
})
