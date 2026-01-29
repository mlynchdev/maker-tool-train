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
CALCOM_API_URL=http://localhost:5555
CALCOM_API_KEY=cal_live_your_api_key_here
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

# Cal.com
CALCOM_DB_PASSWORD=secure-calcom-db-password
CALCOM_API_KEY=cal_live_your_production_key
CALCOM_WEBHOOK_SECRET=your-webhook-secret
CALCOM_NEXTAUTH_SECRET=random-32-char-string
CALCOM_ENCRYPTION_KEY=random-32-char-string
CALCOM_JWT_SECRET=random-jwt-secret

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

## Cal.com Configuration

### Setting Up Cal.com Event Types

1. Access the Cal.com admin UI (internal network only)
2. Create event types for each machine
3. Note the event type IDs
4. Update machines in the admin panel with corresponding Cal.com event type IDs

### Webhook Configuration

Configure Cal.com to send webhooks to your app:

1. In Cal.com admin, go to Settings > Developer > Webhooks
2. Add webhook URL: `https://your-domain.com/api/webhooks/calcom`
3. Select events: `BOOKING_CREATED`, `BOOKING_CANCELLED`, `BOOKING_RESCHEDULED`
4. Set the webhook secret (must match `CALCOM_WEBHOOK_SECRET`)

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

### Cal.com Integration Issues

- Verify `CALCOM_API_URL` is accessible from the app container
- Check API key permissions in Cal.com
- Review webhook delivery logs in Cal.com admin

### Reset Development Database

```bash
cd deploy
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d

cd ../apps/web
bun run db:push
bun run scripts/seed.ts
```
