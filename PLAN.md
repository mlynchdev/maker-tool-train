# TanStack Start + Self-Hosted Cal.com (API-Driven) — Implementation Plan

## 0) Target architecture (non-negotiables)

**Goal:** Users only interact with your TanStack Start app. Your app is the policy engine. Cal.com is an internal scheduling service reached **only via API**.

**Containers (typical):**

* `app` — TanStack Start (SPA mode) + your server routes
* `calcom-web` — Cal.com Next.js app (admin/managers may use UI; members do not)
* `calcom-api-v2` — Cal.com API v2 service (recommended for clean integration) ([Cal][1])
* `postgres` — shared or separate DB(s); simplest is one Postgres with separate schemas/dbs

**Network:** Put all containers on the same Docker network. Only expose:

* your app (public)
* optionally Cal.com UI (admin-only; IP allowlist / VPN)
  Keep Cal.com API v2 internal if possible.

---

## 1) Repo + licensing + “self-hostable” posture

1. Create a monorepo:

   * `/apps/app` (TanStack Start)
   * `/deploy` (docker-compose, reverse proxy config, env templates)
   * `/docs` (setup guides, threat model, contribution guide)
2. Decide how deployers provide secrets:

   * `.env` for local dev
   * Docker secrets or env vars for production
3. Document the “members never see Cal.com” rule in README and enforce it in config (routing + firewall).

---

## 2) Stand up Cal.com (self-host) correctly

1. Deploy Cal.com per self-host instructions:

   * Node, yarn, Git, PostgreSQL
   * Recommended Node version (Cal.com docs strongly recommend Node 18) ([Cal][1])
2. Configure Cal.com `.env` from `.env.example` and generate required secrets (NEXTAUTH_SECRET, etc.) ([Cal][1])
3. Plan for **cron jobs** required by Cal.com features (they live under `/apps/web/app/api/cron`) ([Cal][1])

   * In Docker: run a separate lightweight cron container that hits the cron endpoints on schedule.
4. Enable / run Cal.com **API v2**:

   * Cal.com docs show workspace build/start for `@calcom/api-v2` ([Cal][1])
5. Smoke-test Cal.com API v2 endpoints before building your integration.

**Hardening note:** There have been self-hosting/API v2 issues reported recently; pin a Cal.com version in your deploy docs and test upgrades in CI before recommending updates. ([GitHub][2])

---

## 3) Create the TanStack Start app in SPA mode

1. Initialize TanStack Start and enable **SPA mode** (client-rendered shell + server capabilities). ([TanStack][3])
2. Adopt file-based routing under `src/routes`. ([TanStack][4])
3. Decide runtime (Node/Bun) and keep it consistent across dev/prod.

---

## 4) Define your domain model (DB schema first)

Create a clean policy model so gating is deterministic and auditable.

### Core tables (suggested)

* `users`

  * id, email/username, roles (`member`, `manager`, `admin`), status, created_at
* `machines`

  * id, name, active, calcom_event_type_id (or mapping), metadata
* `training_modules`

  * id, title, youtube_video_id, duration_seconds (optional), active
* `machine_requirements`

  * machine_id, module_id, required_completion_pct, required_watch_seconds (optional)
* `training_progress`

  * user_id, module_id, watched_seconds, last_position_seconds, completed_at, updated_at
* `manager_checkouts`

  * user_id, machine_id, approved_by_user_id, approved_at, notes
* `eligibility_cache` (optional)

  * user_id, machine_id, eligible (bool), computed_at, reason_json
* `calcom_id_map`

  * user_id → calcom-managed-user-id (optional), plus any tokens if you choose managed-user auth
* `reservations`

  * id, user_id, machine_id, calcom_booking_id, start/end, status, created_at

### Policy function (single source of truth)

Define `isEligible(userId, machineId)` as:

* all required modules satisfy completion rule
* AND manager checkout exists for that machine (or machine category)
* AND user is active + not banned

Write this logic once (server-side), and reuse everywhere.

---

## 5) Authentication + authorization in TanStack Start

You said “our own auth setup” — implement it server-first.

1. Use TanStack Start authentication patterns (sessions, http-only cookies, etc.). ([TanStack][5])
2. Add role-based authorization:

   * `member` — can view training, request reservations
   * `manager` — can approve checkouts, manage machine rules
   * `admin` — can manage everything
3. Protect all server routes with middleware-like checks (session required, role required).

---

## 6) Build server routes (your app’s internal API)

Use **TanStack Start Server Routes** for raw HTTP endpoints. ([TanStack][6])

### Server route inventory

**Auth**

* `POST /api/auth/login`
* `POST /api/auth/logout`
* `GET /api/auth/me`

**Training**

* `GET /api/training/modules`
* `POST /api/training/progress` (update watch stats)
* `POST /api/training/complete` (mark completed if criteria met)
* `GET /api/training/status` (per user)

**Eligibility**

* `GET /api/machines`
* `GET /api/machines/:id/eligibility`
* `POST /api/machines/:id/checkout` (manager-only)

**Scheduling**

* `GET /api/machines/:id/availability` (proxy to Cal.com)
* `POST /api/machines/:id/reservations` (creates booking in Cal.com)
* `GET /api/reservations` (user’s bookings)
* `POST /api/reservations/:id/cancel`

**Webhooks**

* `POST /api/webhooks/calcom` (booking created/canceled/rescheduled)

---

## 7) YouTube embedded training tracking (correctness + anti-gaming)

### Client: instrument playback

1. Use the YouTube IFrame Player API to receive:

   * play/pause
   * seek events
   * current time updates
2. Sample progress at a fixed cadence (e.g., every 5 seconds while playing) and send deltas to:

   * `POST /api/training/progress`

### Server: normalize + validate

Implement conservative server-side rules:

* Accept progress updates only if:

  * session is valid
  * module exists + active
  * deltas are plausible (e.g., watched_seconds doesn’t jump by 10 minutes instantly)
* Track:

  * `watched_seconds_total` (monotonic, capped at duration)
  * `last_position_seconds`
  * `seek_count`, `seek_forward_seconds` (optional)
* Completion criteria (pick one and document it):

  * `watched_seconds >= duration * 0.9` AND `max_gap <= X`
  * OR “must watch all segments” (harder but stricter)

**Important:** treat client signals as *claims*; server enforces plausibility.

---

## 8) Cal.com API integration strategy

You’re self-hosting, so you can call Cal.com over the Docker network. The key decision is **which auth mode** you’ll use for API v2.

### Recommended: Service-to-service credentials (server-only)

Cal.com describes v2 auth methods including:

* `Authorization: Bearer <token>` (managed-user token)
* or `x-cal-client-id` + `x-cal-secret-key` (OAuth client credentials) ([Cal][7])

**Plan:**

1. Store Cal.com credentials in server env only.
2. Create a thin Cal.com client in your Start server code:

   * `calGetAvailability(machine)`
   * `calCreateBooking(user, machine, slot)`
   * `calCancelBooking(bookingId)`
   * `calListBookings(user)` (if supported by your chosen auth mode)

### Resource mapping

You need a stable mapping between “Machine” and something schedulable in Cal.com:

* simplest: each machine maps to a Cal.com **event type** (or a booking type you can query by ID)
* store `calcom_event_type_id` (or slug) on your `machines` table

### Booking flow (enforced)

1. Client calls `POST /api/machines/:id/reservations` with desired slot
2. Server computes `isEligible(user, machine)`

   * if false → reject with explicit reason
3. Server calls Cal.com API to create booking
4. Server stores `calcom_booking_id` in `reservations`

---

## 9) Webhooks and reconciliation

Even if members never touch Cal.com UI, bookings can change (admins, cron, conflicts).

1. Implement `POST /api/webhooks/calcom`
2. Verify webhook authenticity (signature/shared secret if Cal.com supports it in your deployment; otherwise enforce network-level restrictions).
3. On webhook events:

   * update `reservations.status`
   * persist timestamps and any relevant metadata
4. Add a periodic reconciliation job:

   * nightly `calListBookings` vs your DB
   * fix drift + alert on mismatches

---

## 10) UI routes + UX flow (member + manager)

### Member UX

* `/training`

  * shows modules + completion state
* `/machines`

  * shows machines, eligibility badge, “Reserve” button
* `/machines/:id`

  * requirements checklist + “Request checkout” instructions
* `/machines/:id/reserve`

  * availability picker (from your server) → booking create

### Manager UX

* `/admin/checkouts`

  * search user
  * view per-machine readiness (training complete?)
  * approve checkout (writes `manager_checkouts`)
* `/admin/machines`

  * set requirements and policies

---

## 11) Security checklist (do these before “v1”)

1. **Network isolation**

   * Cal.com API not publicly exposed (or tightly restricted)
2. **Server-only secrets**

   * Cal.com keys/tokens never in client code
3. **Rate limiting**

   * training progress endpoints
   * booking endpoints
4. **Audit logs**

   * manager checkout approvals
   * reservation creates/cancels
5. **Idempotency**

   * booking create should be idempotent (client retries happen)
6. **RBAC enforcement**

   * server routes must enforce roles, not just UI

---

## 12) Testing plan (avoid “it works on my machine”)

### Unit tests

* `isEligible` with many combinations
* training normalization / anti-gaming rules
* Cal.com client error handling

### Integration tests (docker-compose in CI)

* Spin up Postgres + Cal.com API v2 + your app
* Test:

  * create user session
  * submit training progress → complete module
  * manager approves checkout
  * availability → create booking
  * webhook updates reservation state

### Migration tests

* schema migration up/down
* seed data scripts for local dev

---

## 13) Deployment plan (repeatable)

1. Provide a `docker-compose.yml` that runs:

   * app
   * calcom-web
   * calcom-api-v2
   * postgres
   * reverse proxy (Caddy/Nginx/Traefik)
2. Reverse proxy routes:

   * `/` → your app
   * `/admin/cal` → calcom-web (restricted)
   * **no** public route to calcom-api-v2
3. Document upgrade steps for Cal.com and your app:

   * backup DB
   * run migrations
   * smoke tests (API + booking)

---

## 14) Deliverables checklist (what “done” means)

* [ ] Members can’t book unless **training + manager checkout** are satisfied
* [ ] Bookings are created via Cal.com API only
* [ ] Webhooks keep your DB in sync
* [ ] Manager can approve checkout with full audit trail
* [ ] Single-command local dev (compose up) and a clean production compose
* [ ] Clear docs for self-hosters (env vars, ports, reverse proxy, cron)

---

If you want, I can follow this with a **proposed directory structure + minimal TypeScript interfaces** for `CalClient`, `EligibilityService`, and the exact server-route signatures so you can start coding without rework.

[1]: https://cal.com/docs/self-hosting/installation "Installation - Cal.com Docs"
[2]: https://github.com/calcom/cal.com/issues/26502?utm_source=chatgpt.com "api v2: license key check incorrect #26502 - calcom/cal.com"
[3]: https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode?utm_source=chatgpt.com "SPA mode | TanStack Start React Docs"
[4]: https://tanstack.com/start/latest/docs/framework/react/guide/routing?utm_source=chatgpt.com "Routing | TanStack Start React Docs"
[5]: https://tanstack.com/start/latest/docs/framework/react/guide/authentication?utm_source=chatgpt.com "Authentication | TanStack Start React Docs"
[6]: https://tanstack.com/start/latest/docs/framework/react/guide/server-routes?utm_source=chatgpt.com "Server Routes | TanStack Start React Docs"
[7]: https://cal.com/docs/platform/faq?utm_source=chatgpt.com "FAQ - Cal.com Docs"

