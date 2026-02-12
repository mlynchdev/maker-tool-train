# Startup Guide

This guide covers how to run the Training & Reservation System in development and staging/production environments.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) and Docker Compose
- PostgreSQL 16 (via Docker or local installation)

### 1. Start Development Database

```bash
cd deploy
docker compose -f docker-compose.dev.yml up -d
```

This starts a PostgreSQL container exposed on port 5433 with:
- User: `training`
- Password: `training_dev_password`
- Database: `training`

### 2. Install Dependencies

```bash
cd apps/web
bun install
```

### 3. Configure Environment

```bash
# From project root
cp .env.example .env
```

Edit `.env` with your settings:

```env
DATABASE_URL=postgres://training:training_dev_password@localhost:5433/training
AUTH_PROVIDER=dev
SESSION_SECRET=your-random-32-character-secret-here
```

### 4. Run Database Migrations

Push the schema to the database:

```bash
cd apps/web
bun run db:push
```

Or generate and run migrations:

```bash
bun run db:generate
bun run db:migrate
```

### 5. Seed Test Data

```bash
cd apps/web
bun run scripts/seed.ts
```

This creates test accounts:
| Role    | Email                  | Password    |
|---------|------------------------|-------------|
| Admin   | admin@example.com      | admin123    |
| Manager | manager@example.com    | manager123  |
| Member  | member@example.com     | member123   |

It also creates sample training modules and machines.

### 6. Start Development Server

```bash
cd apps/web
bun run dev
```

The app will be available at http://localhost:3001

---

## Admin Workflow: Training Modules

1. Log in as an admin account.
2. Go to `Admin > Training` to manage modules.
3. Add a module by pasting a YouTube URL or ID; the preview auto-detects duration.
4. Save the module, then assign it to machines in `Admin > Machines`.

### Database Studio

To explore the database visually:

```bash
cd apps/web
bun run db:studio
```

This opens Drizzle Studio at https://local.drizzle.studio

---

## Staging (Beta) Deployment

### 1. Configure Environment

Create a `.env` file in the `deploy` directory (you can start from `deploy/.env.staging.example`):

```env
# Isolates resources for this stack
COMPOSE_PROJECT_NAME=training-staging

# Public staging hostname and canonical URL
APP_HOST=beta.example.com
PUBLIC_URL=https://beta.example.com
ACME_EMAIL=ops@example.com

# App configuration
AUTH_PROVIDER=dev

# Secrets
POSTGRES_PASSWORD=replace-with-long-random-password
SESSION_SECRET=replace-with-random-32-char-plus-secret
```

### 2. Build and Start (Migrations Included)

```bash
cd deploy
./staging-deploy.sh
```

This script performs preflight checks (required env vars, placeholder values, Compose validation), then runs `docker compose up -d --build`. The `migrate` service (`bun run db:push`) runs automatically before the app starts.

### 3. Verify Deployment

Check service health:

```bash
docker compose ps
docker compose logs migrate
docker compose logs app
```

The app should be accessible at your configured domain with automatic HTTPS via Caddy.

## Production Deployment

Use the same steps as staging, but with:
- A production domain (for example `training.example.com`)
- Production secrets
- A distinct project name (for example `COMPOSE_PROJECT_NAME=training-prod`)
- `AUTH_PROVIDER` set to your production auth provider when ready

---

## Scheduling Configuration

Scheduling is managed natively in the app:

1. Admins/managers create machines/tools in `Admin > Machines`.
2. Members submit booking requests for open time windows.
3. Admins moderate pending requests from `Admin > Checkouts`.
4. Admins define checkout availability blocks for in-person sign-offs.

---

## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker compose -f docker-compose.dev.yml ps

# View PostgreSQL logs
docker compose -f docker-compose.dev.yml logs postgres

# Test connection
psql postgres://training:training_dev_password@localhost:5433/training
```

### App Won't Start

```bash
# Check for TypeScript errors
cd apps/web
bun run build

# Check environment variables
cat .env
```

### Reset Development Database

```bash
cd deploy
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d

cd ../apps/web
bun run db:push
bun run scripts/seed.ts
```
