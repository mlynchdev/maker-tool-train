# Maker Tool Train Application Overview

## Summary
Maker Tool Train is a training-gated machine reservation system for makerspaces, fab labs, and community workshops. It enforces equipment safety policies by requiring members to complete training modules and receive manager checkout approval before booking machines. The app combines training progress tracking, manager approvals, and self-service scheduling into a single workflow.

## Core Workflow
1. Members watch YouTube-hosted training videos inside the app, with progress tracked server-side.
2. Managers perform an in-person checkout and record approval for each machine.
3. Once both requirements are met, members can request equipment time slots via the native scheduling workflow.

## Primary Users And Roles
- Members: watch training, complete requirements, and book machines.
- Managers: approve checkout for machines, review training completion, and support members.
- Admins: manage machines, training modules, requirements, and operational settings.

## Key Capabilities
- Training progress tracking with server-validated watch percentages.
- Configurable training requirements per machine.
- Manager checkout approvals to replace paper sign-offs.
- Self-service reservations with cancelation support.
- Admin moderation workflow for booking requests (approve/reject/cancel).
- Checkout appointment scheduling for in-person final sign-off.
- Role-based access controls for member, manager, and admin tasks.
- Real-time availability updates using Server-Sent Events.
- Persistent notifications for booking and checkout events.

## Data Model At A Glance
- `users`: accounts with role and status.
- `machines`: reservable equipment definitions.
- `training_modules`: YouTube-based modules with duration.
- `machine_requirements`: mapping of required training modules per machine.
- `training_progress`: per-user watch progress and completion timestamps.
- `manager_checkouts`: manager approval records for user-machine access.
- `reservations`: native booking request records and moderation status.
- `checkout_availability_blocks`: manager/admin-defined in-person checkout slots.
- `checkout_appointments`: member bookings for checkout meetings.
- `notifications`: persistent user notifications.
- `sessions`: auth sessions for logged-in users.

## System Components
- Web application: TanStack Start app in `apps/web`.
- Database: PostgreSQL with Drizzle ORM schema in `apps/web/drizzle`.
- Scheduling: native scheduling services in app server code.
- Real-time: Server-Sent Events for availability updates.

## Tech Stack
- Runtime: Bun
- Framework: TanStack Start
- Database: PostgreSQL + Drizzle ORM
- Validation: Zod
- Scheduling: native booking + checkout appointment engine
- Real-time: Server-Sent Events

## Repository Structure
- `apps/web`: TanStack Start application
- `apps/web/src/routes`: UI pages and route handlers
- `apps/web/src/server`: server functions and services
- `apps/web/drizzle`: database schema and migrations
- `deploy`: Docker compose configurations
- `docs`: project documentation

## Licensing
The project is licensed under Elastic License 2.0 (ELv2). It is free to self-host for internal or community use but cannot be offered as a hosted SaaS product to third parties.

## Further Reading
- `docs/startup-docs.md` for setup and deployment guidance.
- `docs/authentic-migration.md` for authentication provider migration.
