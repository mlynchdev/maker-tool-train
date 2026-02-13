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

Pushing to the `staging` branch triggers an automatic deploy via GitHub Actions. The workflow SSHes into the VPS, pulls the latest code, and runs the deploy script.

### VPS Prerequisites

- A VPS with Docker and Docker Compose installed
- A domain pointing to the VPS IP

### 1. Create a Deploy User (on VPS as root)

```bash
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
```

### 2. Clone the Repo (on VPS as root)

```bash
git clone git@github.com:<your-org>/maker-tool-train.git /opt/training
chown -R deploy:deploy /opt/training
```

### 3. Give the Deploy User GitHub Access

Generate an SSH key for the deploy user:

```bash
su - deploy -c "ssh-keygen -t ed25519 -f /home/deploy/.ssh/github_deploy -N '' -C 'vps-deploy-key'"
cat /home/deploy/.ssh/github_deploy.pub
```

Add the public key as a **deploy key** on GitHub (repo → Settings → Deploy keys). Read-only access is sufficient.

Configure SSH to use the key:

```bash
echo 'Host github.com
  IdentityFile ~/.ssh/github_deploy
  StrictHostKeyChecking accept-new' > /home/deploy/.ssh/config
chmod 600 /home/deploy/.ssh/config
chown deploy:deploy /home/deploy/.ssh/config
```

Verify:

```bash
su - deploy -c "ssh -T git@github.com"
# Should print: "Hi <repo>! You've successfully authenticated..."
```

### 4. Set Up SSH Access for GitHub Actions

On your local machine, generate a key pair for the CI pipeline:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_staging -N "" -C "github-actions-deploy"
```

Add the **public** key to the deploy user's authorized keys on the VPS:

```bash
cat ~/.ssh/deploy_staging.pub | ssh root@<VPS_IP> "cat >> /home/deploy/.ssh/authorized_keys"
```

Ensure permissions are correct (on VPS as root):

```bash
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

Test the connection from your local machine:

```bash
ssh -i ~/.ssh/deploy_staging deploy@<VPS_IP> "whoami && groups"
# Should print: deploy, with docker in the groups list
```

### 5. Add GitHub Secrets

From the repo directory on your local machine (requires [GitHub CLI](https://cli.github.com/)):

```bash
gh secret set VPS_HOST --body "<VPS_IP>"
gh secret set VPS_USER --body "deploy"
gh secret set VPS_SSH_KEY < ~/.ssh/deploy_staging
gh secret set VPS_DEPLOY_PATH --body "/opt/training"
```

### 6. Configure the Staging Environment

On the VPS, create a `.env` file in the `deploy` directory (start from `deploy/.env.staging.example`):

```env
COMPOSE_PROJECT_NAME=training-staging
APP_HOST=beta.example.com
PUBLIC_URL=https://beta.example.com
ACME_EMAIL=ops@example.com
AUTH_PROVIDER=dev
POSTGRES_PASSWORD=replace-with-long-random-password
SESSION_SECRET=replace-with-random-32-char-plus-secret
```

### 7. Initial Deploy

Checkout the staging branch and run the deploy script manually the first time:

```bash
su - deploy -c "cd /opt/training && git fetch origin && git checkout -B staging origin/staging"
su - deploy -c "cd /opt/training/deploy && ./staging-deploy.sh"
```

The script performs preflight checks (required env vars, placeholder values, Compose validation), then runs `docker compose up -d --build`. The `migrate` service (`bun run db:push`) runs automatically before the app starts.

### 8. Verify

Check service health:

```bash
docker compose ps
docker compose logs migrate
docker compose logs app
```

The app should be accessible at your configured domain with automatic HTTPS via Caddy.

### Subsequent Deploys

Push or merge to the `staging` branch. GitHub Actions will automatically SSH into the VPS, pull the latest code, and run `staging-deploy.sh`. Check the Actions tab on GitHub for deploy status — green means the deploy succeeded and health checks passed.

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
