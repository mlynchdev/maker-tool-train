import { z } from 'zod'

const CALCOM_API_URL = process.env.CALCOM_API_URL || 'http://localhost:5555'
const CALCOM_API_KEY = process.env.CALCOM_API_KEY || ''

interface CalcomError {
  message: string
  code?: string
}

class CalcomClient {
  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'cal-api-version': '2024-08-13',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status}`,
      }))
      throw new Error(error.message || `Cal.com API error: ${response.status}`)
    }

    return response.json()
  }

  async getAvailability(
    eventTypeId: number,
    startDate: Date,
    endDate: Date
  ): Promise<AvailabilitySlot[]> {
    const params = new URLSearchParams({
      eventTypeId: eventTypeId.toString(),
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    })

    const response = await this.request<{ data: { slots: Record<string, AvailabilitySlot[]> } }>(
      'GET',
      `/v2/slots/available?${params}`
    )

    // Flatten the slots from the date-keyed object
    const allSlots: AvailabilitySlot[] = []
    for (const dateSlots of Object.values(response.data.slots)) {
      allSlots.push(...dateSlots)
    }

    return allSlots
  }

  async createBooking(params: CreateBookingParams): Promise<CalcomBooking> {
    const response = await this.request<{ data: CalcomBooking }>(
      'POST',
      '/v2/bookings',
      {
        eventTypeId: params.eventTypeId,
        start: params.start.toISOString(),
        attendee: {
          name: params.attendee.name,
          email: params.attendee.email,
          timeZone: params.attendee.timeZone || 'UTC',
        },
        metadata: params.metadata,
      }
    )

    return response.data
  }

  async cancelBooking(bookingUid: string, reason?: string): Promise<void> {
    await this.request('POST', `/v2/bookings/${bookingUid}/cancel`, {
      cancellationReason: reason,
    })
  }

  async rescheduleBooking(
    bookingUid: string,
    newStart: Date
  ): Promise<CalcomBooking> {
    const response = await this.request<{ data: CalcomBooking }>(
      'POST',
      `/v2/bookings/${bookingUid}/reschedule`,
      {
        start: newStart.toISOString(),
      }
    )

    return response.data
  }

  async getBooking(bookingUid: string): Promise<CalcomBooking | null> {
    try {
      const response = await this.request<{ data: CalcomBooking }>(
        'GET',
        `/v2/bookings/${bookingUid}`
      )
      return response.data
    } catch {
      return null
    }
  }

  async listBookings(params?: ListBookingsParams): Promise<CalcomBooking[]> {
    const searchParams = new URLSearchParams()

    if (params?.attendeeEmail) {
      searchParams.set('attendeeEmail', params.attendeeEmail)
    }
    if (params?.status) {
      searchParams.set('status', params.status)
    }
    if (params?.eventTypeId) {
      searchParams.set('eventTypeId', params.eventTypeId.toString())
    }

    const query = searchParams.toString()
    const path = query ? `/v2/bookings?${query}` : '/v2/bookings'

    const response = await this.request<{ data: CalcomBooking[] }>('GET', path)
    return response.data
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
    if (!CALCOM_API_KEY) {
      throw new Error('CALCOM_API_KEY environment variable is required')
    }
    calcomClient = new CalcomClient(CALCOM_API_URL, CALCOM_API_KEY)
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

  rescheduleBooking: (bookingUid: string, newStart: Date) =>
    getCalcomClient().rescheduleBooking(bookingUid, newStart),

  getBooking: (bookingUid: string) =>
    getCalcomClient().getBooking(bookingUid),

  listBookings: (params?: ListBookingsParams) =>
    getCalcomClient().listBookings(params),
}
