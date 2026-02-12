import { eventBus } from '../services/events'
import { getAuthService } from '../auth'
import { SESSION_COOKIE_NAME } from '../auth/types'

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split('=')
    if (name) {
      cookies[name] = rest.join('=')
    }
  })
  return cookies
}

export async function createSSEHandler(request: Request): Promise<Response> {
  // Authenticate the request
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) {
    return new Response('Unauthorized', { status: 401 })
  }

  const cookies = parseCookies(cookieHeader)
  const sessionToken = cookies[SESSION_COOKIE_NAME]

  if (!sessionToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const auth = getAuthService()
  const user = await auth.validateSession(sessionToken)

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)
      )

      // Set up heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30000)

      // Subscribe to user events
      const unsubscribe = eventBus.subscribeToUser(user.id, (eventData) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`)
          )
        } catch (error) {
          console.error('Error sending SSE event:', error)
        }
      })

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
