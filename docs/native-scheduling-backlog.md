# Native Scheduling Backlog (Cal.com Replacement)

## Epic Summary
Replace Cal.com with an internal scheduling workflow where admins/managers manage tools/machines, members request booking time, admins moderate requests, and all users can view availability. Add a second flow for in-person checkout appointments after training completion.

## Definitions
- `Resource`: bookable entity; includes both tools and machines.
- `Booking request`: member-submitted time block request for a resource.
- `Checkout appointment`: meeting slot between member and manager/admin for physical checkout.

## Milestones
1. M1: Native booking backend (schema + server APIs + conflict checks + moderation).
2. M2: Member/admin scheduling UI (mobile-first responsive views).
3. M3: Checkout appointment scheduling.
4. M4: Notifications + realtime + Cal.com deprecation cleanup.

## Ticket Backlog

### B01 - Schema: Native Scheduling Core
- Type: Backend/DB
- Priority: P0
- Dependencies: None
- Files:
  - `apps/web/drizzle/schema.ts`
- Scope:
  - Add `resource_type` enum (`machine`, `tool`) on `machines`.
  - Expand reservation statuses to request lifecycle:
    - `pending`, `approved`, `rejected`, `cancelled`, `completed`.
  - Add moderation fields on reservations:
    - `requestedBy`, `reviewedBy`, `reviewedAt`, `reviewNotes`, `decisionReason`.
  - Keep Cal.com fields temporarily for transition compatibility.
- Acceptance criteria:
  - Schema compiles and exports updated types.
  - Existing entities remain queryable without data loss.

### B02 - Service Layer: Booking Conflict + Workflow Engine
- Type: Backend
- Priority: P0
- Dependencies: B01
- Files:
  - `apps/web/src/server/services/booking-conflicts.ts` (new)
  - `apps/web/src/server/services/booking-workflow.ts` (new)
  - `apps/web/src/server/services/eligibility.ts` (reuse)
- Scope:
  - Implement overlap checks against non-cancelled/non-rejected reservations.
  - Implement request create/approve/reject/cancel primitives with role constraints.
  - Enforce eligibility via existing training + checkout logic.
- Acceptance criteria:
  - Conflict detection rejects partial and full overlap.
  - Workflow functions return consistent errors and status transitions.

### B03 - API: Replace Cal.com Booking Endpoints
- Type: Backend/API
- Priority: P0
- Dependencies: B01, B02
- Files:
  - `apps/web/src/server/api/machines.ts`
  - `apps/web/src/server/api/reservations.ts`
  - `apps/web/src/server/api/index.ts`
- Scope:
  - `getMachineAvailability`: derive from local reservations.
  - `reserveMachine`: create `pending` booking request with variable duration.
  - Add request filtering/listing by state for member history.
  - Remove Cal.com booking creation/cancel calls from runtime flow.
- Acceptance criteria:
  - Member can submit request for any unbooked range.
  - API returns clear errors for overlap and eligibility failures.

### B04 - API: Admin Moderation + Notifications
- Type: Backend/API
- Priority: P0
- Dependencies: B03
- Files:
  - `apps/web/src/server/api/admin.ts`
  - `apps/web/src/server/services/events.ts`
- Scope:
  - Add list endpoint for pending booking requests.
  - Add admin actions: approve/reject/cancel reservation requests.
  - Emit member and admin notifications/events for each state transition.
- Acceptance criteria:
  - Only admin can approve/reject/cancel booking requests.
  - Member receives event when request is moderated.

### B05 - UI: Member Resource Availability + Request Form
- Type: Frontend
- Priority: P1
- Dependencies: B03
- Files:
  - `apps/web/src/routes/machines/index.tsx`
  - `apps/web/src/routes/machines/$machineId.tsx`
  - `apps/web/src/routes/machines/$machineId.reserve.tsx`
  - `apps/web/src/components/AvailabilityPicker.tsx`
- Scope:
  - Display transparent schedule for all users.
  - Replace fixed 1-hour slot flow with start/end request selection.
  - Show lifecycle state (`pending`, `approved`, etc.).
- Acceptance criteria:
  - Mobile-first interactions work at 360px width.
  - Request duration can exceed 1 hour.

### B06 - UI: Admin Booking Moderation Queue
- Type: Frontend
- Priority: P1
- Dependencies: B04
- Files:
  - `apps/web/src/routes/admin/booking-requests.tsx` (new)
  - `apps/web/src/components/Header.tsx`
  - `apps/web/src/components/Dashboard.tsx`
- Scope:
  - Add pending queue with approve/reject/cancel actions.
  - Add navigation and pending count badges.
- Acceptance criteria:
  - Admin can process requests from single queue.
  - UI is responsive for mobile/tablet/desktop.

### B07 - Feature 2 Schema: Checkout Appointment Scheduling
- Type: Backend/DB
- Priority: P0
- Dependencies: B01
- Files:
  - `apps/web/drizzle/schema.ts`
- Scope:
  - Add `checkout_availability_blocks`.
  - Add `checkout_appointments` with statuses and links to user/resource.
- Acceptance criteria:
  - Admin availability can be represented as time blocks.
  - Member appointment records support approval/cancellation lifecycle.

### B08 - Feature 2 API: Admin Availability + Member Appointment Booking
- Type: Backend/API
- Priority: P0
- Dependencies: B07
- Files:
  - `apps/web/src/server/api/admin.ts`
  - `apps/web/src/server/api/machines.ts`
  - `apps/web/src/server/api/training.ts` (if training-complete filters are exposed)
- Scope:
  - Admin CRUD for checkout availability blocks.
  - Member endpoint to view blocks and reserve appointment time.
  - Enforce prerequisite: training completed for target resource.
- Acceptance criteria:
  - Member cannot reserve checkout appointment unless training prerequisite met.
  - Overlapping appointments are blocked.

### B09 - Feature 2 UI: Checkout Appointment Booking
- Type: Frontend
- Priority: P1
- Dependencies: B08
- Files:
  - `apps/web/src/routes/checkouts/book.tsx` (new)
  - `apps/web/src/routes/machines/$machineId.tsx`
  - `apps/web/src/routes/admin/checkouts.tsx`
- Scope:
  - Member booking UI for in-person checkout.
  - Admin availability management UI.
- Acceptance criteria:
  - Members can book from available admin blocks.
  - Admin can update weekly availability from mobile and desktop.

### B10 - Notifications Persistence + SSE Enhancements
- Type: Backend
- Priority: P1
- Dependencies: B04, B08
- Files:
  - `apps/web/drizzle/schema.ts`
  - `apps/web/src/server/services/events.ts`
  - `apps/web/src/server/api/sse.ts`
- Scope:
  - Add persistent `notifications` table.
  - Push realtime events and allow later retrieval.
- Acceptance criteria:
  - Notifications survive reconnect.
  - Event payloads are typed and versioned.

### B11 - Mobile-First Layout Pass
- Type: Frontend/UX
- Priority: P1
- Dependencies: B05, B06, B09
- Files:
  - `apps/web/public/styles.css`
  - All touched route components above
- Scope:
  - Mobile-first cards/forms/lists for booking and admin queue.
  - Responsive behavior from phone to ultrawide.
- Acceptance criteria:
  - No horizontal overflow at 360px.
  - Core pages remain usable at >=1440px and ultrawide.

### B12 - Cal.com Decommission Cleanup
- Type: Backend/Infra
- Priority: P2
- Dependencies: B03, B04, B10
- Files:
  - `apps/web/src/server/services/calcom.ts`
  - `apps/web/src/server/api/webhooks.ts`
  - `apps/web/src/routes/api/webhooks.calcom.ts`
- Scope:
  - Remove dead code/env vars/routes after native scheduler is fully active.
- Acceptance criteria:
  - No runtime references to Cal.com remain.
  - Docs reflect native scheduling architecture.

## Immediate Sprint (Start Now)
1. B01
2. B02
3. B03 (partial member flow)
4. B04 (backend moderation primitives)
