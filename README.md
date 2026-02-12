# Maker Tool Train

A training-gated machine reservation system designed for makerspaces, fab labs, and community workshops.

## The Problem

Makerspaces face a common challenge: ensuring members are properly trained before using potentially dangerous or expensive equipment. Traditional approaches rely on paper sign-off sheets, honor systems, or manual tracking—all prone to errors and difficult to scale.

## The Solution

Maker Tool Train provides a complete digital workflow:

1. **Members watch training videos** — YouTube-hosted content with automatic progress tracking
2. **Managers verify competency** — In-person checkout approval after training completion
3. **Members book equipment** — Self-service reservation system (only available after training + checkout)

The system acts as a policy engine, enforcing your makerspace's training requirements while keeping the booking experience simple for members.

## Key Features

- **Training Progress Tracking** — Members watch embedded YouTube videos with server-validated progress (no skipping ahead)
- **Flexible Requirements** — Configure which training modules are required for each machine
- **Manager Approval Workflow** — Digital checkout records replace paper sign-off sheets
- **Self-Service Reservations** — Members book available time slots without staff involvement
- **Role-Based Access** — Member, Manager, and Admin roles with appropriate permissions
- **Real-Time Updates** — Server-Sent Events keep availability current across all users
- **Native Scheduling Engine** — Local conflict checks, admin moderation, and checkout appointments

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| Framework | TanStack Start |
| Database | PostgreSQL + Drizzle ORM |
| Scheduling | Native scheduling workflow (Drizzle + TanStack Start server functions) |
| Validation | Zod |
| Real-time | Server-Sent Events |

## Free for Makerspaces

Maker Tool Train is **free to use and self-host** under the Elastic License 2.0. We believe every makerspace, regardless of budget, should have access to proper safety infrastructure.

### Why This Model?

- **No vendor lock-in** — Host it yourself, modify it freely
- **Community-driven** — Features shaped by real makerspace needs
- **Transparent** — Review the code, understand how your data is handled
- **Sustainable** — Commercial hosting option funds ongoing development
- **Protected** — License prevents others from reselling your community's tool

### Who Is This For?

- Community makerspaces and hackerspaces
- University fab labs and machine shops
- Library maker programs
- Vocational training facilities
- Any organization managing shared equipment access

## Quick Start

See the [Startup Guide](docs/startup-docs.md) for detailed setup instructions.

```bash
# Clone the repository
git clone https://github.com/mlynchdev/maker-tool-train.git
cd maker-tool-train

# Start the database
cd deploy && docker compose -f docker-compose.dev.yml up -d

# Install dependencies
cd ../apps/web && bun install

# Configure environment
cp ../../.env.example ../../.env
# Edit .env with your database credentials

# Run migrations and seed data
bun run db:push
bun run scripts/seed.ts

# Start the development server
bun run dev
```

## Project Structure

```
├── apps/web/              # TanStack Start application
│   ├── src/
│   │   ├── routes/        # File-based routing (UI pages)
│   │   ├── server/        # Server functions and services
│   │   ├── components/    # React components
│   │   └── lib/           # Database client
│   └── drizzle/           # Database schema
├── deploy/                # Docker Compose configurations
├── docs/                  # Documentation
└── .env.example           # Environment template
```

## Documentation

- [Startup Guide](docs/startup-docs.md) — Development and production setup
- [Authentication Migration](docs/authentic-migration.md) — Swapping auth providers

## Roadmap

- [ ] Email notifications for booking confirmations
- [ ] Waitlist for fully-booked time slots
- [ ] Equipment maintenance scheduling
- [ ] Usage analytics and reporting
- [ ] Mobile-friendly UI improvements
- [ ] Multi-language support

## Contributing

Contributions are welcome! Whether it's bug fixes, new features, or documentation improvements—we appreciate the help.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[Elastic License 2.0 (ELv2)](LICENSE)

**You can:**
- Self-host for your makerspace, fab lab, or organization
- Modify the code and contribute improvements
- Use it for commercial internal purposes (e.g., a makerspace that charges membership fees)

**You cannot:**
- Offer this software as a hosted/managed service to third parties
- Resell or rebrand this as your own commercial SaaS product

This license keeps the software free for the maker community while preventing commercial exploitation.

---

Built for the maker community.
