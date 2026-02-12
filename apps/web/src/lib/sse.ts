export interface SSEMessageEnvelope {
  event?: string
  type?: string
  data?: unknown
}

export function parseSSEMessage(raw: string): SSEMessageEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as SSEMessageEnvelope
  } catch {
    return null
  }
}
