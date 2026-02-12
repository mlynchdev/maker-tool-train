# Startup Guide

This guide covers how to run the Training & Reservation System in development and production environments.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) and Docker Compose
- PostgreSQL 16 (via Docker or local installation)

### 1. Start Development Database

```bash
cd deploy
docker-compose -f docker-compose.dev.yml up -d
```

This starts a PostgreSQL container on port 5432 with:
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
DATABASE_URL=postgres://training:training_dev_password@localhost:5432/training
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

The app will be available at http://localhost:3000

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

## Production Deployment

### 1. Configure Environment

Create a `.env` file in the `deploy` directory:

```env
# App database
POSTGRES_PASSWORD=secure-random-password

# App
SESSION_SECRET=random-32-char-session-secret
PUBLIC_URL=https://training.example.com
```

### 2. Update Caddyfile

Edit `deploy/caddy/Caddyfile` and replace `training.example.com` with your domain.

### 3. Build and Start

```bash
cd deploy
docker-compose up -d --build
```

### 4. Run Migrations

```bash
docker-compose exec app bun run db:push
```

### 5. Verify Deployment

Check service health:

```bash
docker-compose ps
docker-compose logs app
```

The app should be accessible at your configured domain with automatic HTTPS via Caddy.

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
docker-compose -f docker-compose.dev.yml ps

# View PostgreSQL logs
docker-compose -f docker-compose.dev.yml logs postgres

# Test connection
psql postgres://training:training_dev_password@localhost:5432/training
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
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d

cd ../apps/web
bun run db:push
bun run scripts/seed.ts
```
