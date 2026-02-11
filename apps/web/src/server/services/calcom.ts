import { z } from 'zod'

const CALCOM_API_URL = process.env.CALCOM_API_URL || 'http://localhost:5555'

class CalcomClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async getAvailability(
    eventTypeId: number,
    startDate: Date,
    endDate: Date
  ): Promise<AvailabilitySlot[]> {
    const input = JSON.stringify({
      json: {
        eventTypeId,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        timeZone: 'America/New_York',
        isTeamEvent: false,
      },
    })

    const url = `${this.baseUrl}/api/trpc/slots/getSchedule?input=${encodeURIComponent(input)}`
    console.log(`[CalcomClient] GET slots/getSchedule eventTypeId=${eventTypeId}`)

    const response = await fetch(url)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Cal.com tRPC error ${response.status}: ${text}`)
    }

    const data = (await response.json()) as {
      result: { data: { json: { slots: Record<string, { time: string }[]> } } }
    }

    // Flatten the date-keyed slots object
    const allSlots: AvailabilitySlot[] = []
    for (const dateSlots of Object.values(data.result.data.json.slots)) {
      allSlots.push(...dateSlots)
    }

    return allSlots
  }

  async createBooking(params: CreateBookingParams): Promise<CalcomBooking> {
    const url = `${this.baseUrl}/api/book/event`
    console.log(`[CalcomClient] POST book/event eventTypeId=${params.eventTypeId}`)

    // Calculate end time from event type length (60 min default)
    const startTime = params.start
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000)

    const body = {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      eventTypeId: params.eventTypeId,
      timeZone: params.attendee.timeZone || 'America/New_York',
      language: 'en',
      responses: {
        name: params.attendee.name,
        email: params.attendee.email,
      },
      metadata: params.metadata || {},
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status}`,
      }))
      throw new Error(error.message || `Cal.com booking error: ${response.status}`)
    }

    const data = await response.json()

    return {
      id: data.id || data.bookingId,
      uid: data.uid,
      title: data.title || '',
      startTime: data.startTime || startTime.toISOString(),
      endTime: data.endTime || endTime.toISOString(),
      status: data.status || 'ACCEPTED',
      attendees: data.attendees || [
        {
          email: params.attendee.email,
          name: params.attendee.name,
          timeZone: params.attendee.timeZone || 'America/New_York',
        },
      ],
      metadata: data.metadata,
    }
  }

  async cancelBooking(bookingUid: string, reason?: string): Promise<void> {
    // The /api/cancel endpoint requires a CSRF token
    console.log(`[CalcomClient] Cancelling booking uid=${bookingUid}`)

    // 1. Get CSRF token
    const csrfResponse = await fetch(`${this.baseUrl}/api/auth/csrf`)
    if (!csrfResponse.ok) {
      throw new Error(`Failed to get CSRF token: ${csrfResponse.status}`)
    }
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

    // 2. Cancel with CSRF token
    const response = await fetch(`${this.baseUrl}/api/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: bookingUid,
        csrfToken,
        cancellationReason: reason,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status}`,
      }))
      throw new Error(error.message || `Cal.com cancel error: ${response.status}`)
    }
  }
}

// Types
export interface AvailabilitySlot {
  time: string
}

export interface CreateBookingParams {
  eventTypeId: number
  start: Date
  attendee: {
    name: string
    email: string
    timeZone?: string
  }
  metadata?: Record<string, string>
}

export interface CalcomBooking {
  id: number
  uid: string
  title: string
  startTime: string
  endTime: string
  status: string
  attendees: Array<{
    email: string
    name: string
    timeZone: string
  }>
  metadata?: Record<string, string>
}

export interface ListBookingsParams {
  attendeeEmail?: string
  status?: string
  eventTypeId?: number
}

// Webhook payload schemas
export const webhookBookingSchema = z.object({
  triggerEvent: z.enum([
    'BOOKING_CREATED',
    'BOOKING_RESCHEDULED',
    'BOOKING_CANCELLED',
    'BOOKING_REJECTED',
    'BOOKING_REQUESTED',
    'BOOKING_PAYMENT_INITIATED',
    'BOOKING_NO_SHOW_UPDATED',
  ]),
  payload: z.object({
    bookingId: z.number(),
    uid: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    status: z.string(),
    metadata: z.record(z.string()).optional(),
    attendees: z.array(
      z.object({
        email: z.string(),
        name: z.string(),
        timeZone: z.string(),
      })
    ),
  }),
})

export type WebhookPayload = z.infer<typeof webhookBookingSchema>

// Singleton client
let calcomClient: CalcomClient | null = null

export function getCalcomClient(): CalcomClient {
  if (!calcomClient) {
    calcomClient = new CalcomClient(CALCOM_API_URL)
  }
  return calcomClient
}

// Convenience exports
export const calcom = {
  getAvailability: (eventTypeId: number, startDate: Date, endDate: Date) =>
    getCalcomClient().getAvailability(eventTypeId, startDate, endDate),

  createBooking: (params: CreateBookingParams) =>
    getCalcomClient().createBooking(params),

  cancelBooking: (bookingUid: string, reason?: string) =>
    getCalcomClient().cancelBooking(bookingUid, reason),
}
