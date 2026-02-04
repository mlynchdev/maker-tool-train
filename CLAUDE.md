# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Maker Tool Train is a training-gated machine reservation system for makerspaces. Members must complete training videos and receive manager checkout approval before booking equipment. Cal.com handles scheduling/availability.

## Commands

```bash
# Development (from root)
bun run dev              # Start dev server (port 3001, Cal.com uses 3000)
bun run build            # Build for production
bun run db:push          # Push schema to database
bun run db:generate      # Generate migration files
bun run db:migrate       # Run migrations
bun run db:studio        # Open Drizzle Studio GUI

# Database setup
cd deploy && docker-compose -f docker-compose.dev.yml up -d  # Start PostgreSQL
bun run scripts/seed.ts  # Seed test data

# Direct commands (apps/web)
vite dev                 # TanStack Start dev server
vite build               # Build to .output/
drizzle-kit push         # Push schema directly
drizzle-kit studio       # Database GUI at local.drizzle.studio
```

## Architecture

**Stack**: Bun runtime, TanStack Start (React SSR), Drizzle ORM, PostgreSQL, Cal.com API v2

**Monorepo Structure**:
- `apps/web/` - Main application (TanStack Start)
- `deploy/` - Docker Compose configs and Caddy reverse proxy
- `docs/` - Setup and migration guides

**Server Architecture** (`apps/web/src/server/`):
```
server/
├── api/           # TanStack Start server functions (RPC endpoints)
│   ├── auth.ts    # Login, register, logout, getMe
│   ├── machines.ts, training.ts, reservations.ts, admin.ts
│   └── webhooks.ts, sse.ts
├── auth/          # Pluggable auth abstraction (dev vs Authentic)
│   ├── types.ts   # AuthService interface
│   └── dev-auth.ts # Argon2 + database sessions
└── services/      # Business logic
    ├── eligibility.ts  # Core: training + checkout validation
    └── calcom.ts       # Cal.com API client
```

**Database Schema** (`apps/web/drizzle/schema.ts`):
- `users` - Auth with roles (member/manager/admin)
- `machines` - Equipment linked to Cal.com event types
- `trainingModules` - YouTube videos with duration
- `machineRequirements` - Which modules required per machine
- `trainingProgress` - User watch progress tracking
- `managerCheckouts` - Approval records
- `reservations` - Bookings synced with Cal.com
- `sessions` - Auth tokens

**Key Pattern - Eligibility Check**:
All booking authorization flows through `checkEligibility(userId, machineId)` in `services/eligibility.ts`. This validates: user active, machine active, all required training at required watch %, manager checkout exists.

## File Conventions

- Path alias `~/` maps to `src/`
- Server functions use `createServerFn()` from TanStack Start
- All server function inputs validated with Zod schemas
- Routes in `src/routes/` follow file-based routing

## Environment

Dev PostgreSQL runs on port **5433** (not 5432). Copy `.env.example` to `.env`:
```env
DATABASE_URL=postgres://training:training_dev_password@localhost:5433/training
AUTH_PROVIDER=dev
CALCOM_API_URL=http://localhost:3000
```

## Test Accounts (after seeding)

- `admin@example.com` / `admin123`
- `manager@example.com` / `manager123`
- `member@example.com` / `member123`
