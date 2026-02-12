// Auth API
export { login, register, logout, getMe } from './auth'

// Training API
export { getModules, getModule, updateProgress, getTrainingStatus } from './training'

// Machines API
export {
  getMachines,
  getMachine,
  getMachineEligibility,
  getMachineAvailability,
  getMachineCheckoutAvailability,
  requestCheckoutAppointment,
  reserveMachine,
} from './machines'

// Reservations API
export { getReservations, getReservation, cancelReservation } from './reservations'

// Notifications API
export {
  getNotifications,
  getMyUnreadNotificationCount,
  markMyNotificationRead,
  markAllMyNotificationsRead,
} from './notifications'

// Admin API
export {
  getPendingCheckouts,
  getPendingReservationRequestCount,
  getUserForCheckout,
  approveCheckout,
  revokeCheckout,
  getPendingReservationRequests,
  moderateReservationRequest,
  getCheckoutAvailability,
  createCheckoutAvailabilityBlock,
  deactivateCheckoutAvailabilityBlock,
  createMachine,
  updateMachine,
  setMachineRequirements,
  createTrainingModule,
  updateTrainingModule,
  getUsers,
  updateUser,
  getAdminMachines,
  getAdminModules,
} from './admin'

// Webhooks
export { handleCalcomWebhook } from './webhooks'

// SSE
export { createSSEHandler } from './sse'
