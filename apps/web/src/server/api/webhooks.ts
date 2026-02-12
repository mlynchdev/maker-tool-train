import { createServerFn } from '@tanstack/react-start'

export const handleCalcomWebhook = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data)
  .handler(async () => {
    return {
      success: false,
      error: 'Cal.com webhooks are no longer supported by this application.',
      status: 410,
    }
  })
