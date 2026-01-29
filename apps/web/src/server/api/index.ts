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
  reserveMachine,
} from './machines'

// Reservations API
export { getReservations, getReservation, cancelReservation } from './reservations'

// Admin API
export {
  getPendingCheckouts,
  getUserForCheckout,
  approveCheckout,
  revokeCheckout,
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
