interface NotificationListKeyOptions {
  unreadOnly?: boolean
  limit?: number
}

interface ReservationListKeyOptions {
  includesPast: boolean
}

export const queryKeys = {
  notifications: {
    all: ['notifications'] as const,
    list: (options: NotificationListKeyOptions) =>
      ['notifications', 'list', options] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
  reservations: {
    all: ['reservations'] as const,
    mine: (options: ReservationListKeyOptions) =>
      ['reservations', 'mine', options] as const,
  },
  machines: {
    all: ['machines'] as const,
    list: () => ['machines', 'list'] as const,
    detail: (machineId: string) => ['machines', 'detail', machineId] as const,
    reserve: (machineId: string) => ['machines', 'reserve', machineId] as const,
    myUpcomingCheckoutAppointments: () =>
      ['machines', 'my-upcoming-checkout-appointments'] as const,
  },
  training: {
    all: ['training'] as const,
    modules: () => ['training', 'modules'] as const,
    module: (moduleId: string) => ['training', 'module', moduleId] as const,
    status: () => ['training', 'status'] as const,
  },
  admin: {
    all: ['admin'] as const,
    checkouts: () => ['admin', 'checkouts'] as const,
    userCheckouts: (userId: string) => ['admin', 'checkouts', 'user', userId] as const,
    bookingRequests: () => ['admin', 'booking-requests'] as const,
    machines: () => ['admin', 'machines'] as const,
    machineEditor: (machineId: string) => ['admin', 'machines', 'editor', machineId] as const,
    trainingModules: () => ['admin', 'training-modules'] as const,
    users: () => ['admin', 'users'] as const,
    settings: () => ['admin', 'settings'] as const,
    pendingCheckoutCount: () => ['admin', 'pending-checkouts', 'count'] as const,
    pendingCheckouts: () => ['admin', 'pending-checkouts', 'list'] as const,
    pendingReservationRequestCount: () =>
      ['admin', 'pending-reservation-requests', 'count'] as const,
    pendingReservationRequests: () =>
      ['admin', 'pending-reservation-requests', 'list'] as const,
  },
} as const
