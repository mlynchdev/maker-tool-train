# Cal.com Dev Setup (Hetzner VPS)

Cal.com's Docker image is AMD64-only. Instead of QEMU emulation on Apple Silicon (which breaks loopback connections), Cal.com runs on a Hetzner VPS with native x86.

## Architecture

```
Local (Apple Silicon)                  Hetzner VPS (x86)
┌─────────────────────┐                ┌──────────────────────┐
│ bun run dev (:3001) │──CALCOM_API──▶ │ Cal.com (:5555)      │
│ Postgres (:5433)    │                │ Postgres (localhost)  │
└─────────────────────┘                │ Redis (internal)      │
                                       └──────────────────────┘
```

## 1. Provision the VPS

Any small Hetzner VPS (CX22 or similar) works. Install Docker:

```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh
```

## 2. Deploy Cal.com

Copy the compose file to the VPS and start it:

```bash
scp deploy/docker-compose.calcom.yml root@YOUR_VPS_IP:~/docker-compose.calcom.yml
ssh root@YOUR_VPS_IP "docker compose -f docker-compose.calcom.yml up -d"
```

First boot takes 2-3 minutes for database migrations. Check progress:

```bash
ssh root@YOUR_VPS_IP "docker logs -f calcom"
```

Verify Cal.com is running:

```bash
curl http://YOUR_VPS_IP:5555/
```

## 3. Run the Setup Script

The setup script writes directly to Cal.com's Postgres. The DB is bound to `127.0.0.1:5434` on the VPS (not publicly accessible), so use an SSH tunnel:

```bash
# Terminal 1: SSH tunnel (local 5434 → VPS 5434 → calcom-postgres)
ssh -L 5434:localhost:5434 root@YOUR_VPS_IP

# Terminal 2: run the setup script
CALCOM_API_URL=http://YOUR_VPS_IP:5555 bun run calcom:setup
```

The script will:
1. Wait for Cal.com to respond on the VPS
2. Create an admin user via direct DB access through the tunnel
3. Generate an API key
4. Create event types (Laser Cutter, 3D Printer, CNC Mill)
5. Update local app machines with Cal.com event type IDs

## 4. Configure Local Environment

Copy the API key from the setup script output into your `.env`:

```env
CALCOM_API_URL=http://YOUR_VPS_IP:5555
CALCOM_API_KEY=cal_live_xxxxxxxxxxxx
```

Start the app:

```bash
bun run dev
```

## Cal.com Web UI

Access the Cal.com admin interface at `http://YOUR_VPS_IP:5555`:
- Email: `admin@makerspace.dev`
- Password: `calcom123`

## Troubleshooting

**Cal.com won't start**: Check logs with `ssh root@YOUR_VPS_IP "docker logs calcom"`. First startup takes 2-3 minutes for migrations.

**Setup script can't connect to Postgres**: Make sure the SSH tunnel is active on port 5434.

**Empty time slots**: Cal.com may return empty slots from `/v2/slots/available` if no calendar credential is configured. Check whether a minimal calendar integration is needed.

**Reset everything**:
```bash
ssh root@YOUR_VPS_IP "docker compose -f docker-compose.calcom.yml down -v"
ssh root@YOUR_VPS_IP "docker compose -f docker-compose.calcom.yml up -d"
```

**API key stopped working**: Re-run the setup script with the SSH tunnel active.
