type EventCallback = (data: unknown) => void

interface Subscription {
  userId: string
  callback: EventCallback
}

class EventBus {
  private subscriptions: Map<string, Set<Subscription>> = new Map()

  subscribe(channel: string, userId: string, callback: EventCallback): () => void {
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set())
    }

    const subscription: Subscription = { userId, callback }
    this.subscriptions.get(channel)!.add(subscription)

    // Return unsubscribe function
    return () => {
      this.subscriptions.get(channel)?.delete(subscription)
    }
  }

  publish(channel: string, data: unknown, targetUserId?: string): void {
    const subs = this.subscriptions.get(channel)
    if (!subs) return

    for (const sub of subs) {
      if (!targetUserId || sub.userId === targetUserId) {
        try {
          sub.callback(data)
        } catch (error) {
          console.error('Error in event callback:', error)
        }
      }
    }
  }

  publishToUser(userId: string, event: string, data: unknown): void {
    this.publish(`user:${userId}`, { event, data })
  }

  subscribeToUser(userId: string, callback: EventCallback): () => void {
    return this.subscribe(`user:${userId}`, userId, callback)
  }

  // Broadcast to all connected users
  broadcast(event: string, data: unknown): void {
    for (const [channel, subs] of this.subscriptions) {
      if (channel.startsWith('user:')) {
        for (const sub of subs) {
          try {
            sub.callback({ event, data })
          } catch (error) {
            console.error('Error in broadcast callback:', error)
          }
        }
      }
    }
  }
}

// Singleton event bus
export const eventBus = new EventBus()

// Event types
export interface BookingEvent {
  type: 'requested' | 'approved' | 'rejected' | 'updated' | 'cancelled'
  status: string
  bookingId: string
  machineId: string
  userId: string
  startTime: string
  endTime: string
}

export interface CheckoutEvent {
  type: 'approved' | 'revoked'
  userId: string
  machineId: string
  machineName: string
}

export interface NotificationEvent {
  id: string
  type: string
  title: string
  message: string
  metadata?: Record<string, string | null>
  createdAt: string
}

// Helper functions
export function emitBookingEvent(userId: string, event: BookingEvent): void {
  eventBus.publishToUser(userId, 'booking', event)
}

export function emitCheckoutEvent(userId: string, event: CheckoutEvent): void {
  eventBus.publishToUser(userId, 'checkout', event)
}

export function emitNotificationEvent(
  userId: string,
  event: NotificationEvent
): void {
  eventBus.publishToUser(userId, 'notification', event)
}

export function broadcastMachineAvailabilityChange(machineId: string): void {
  eventBus.broadcast('machine_availability', { machineId })
}
