# Client Time Tracker

A full-stack time tracking and invoicing application built for IT service providers and consultants who bill clients by the hour. Manage clients, log time entries, generate PDF invoices, and track project status — all from a single self-hosted app with no external database required.

## Features

- **Dashboard** — At-a-glance view of today's hours, weekly hours, unbilled totals, and active clients
- **Time Entry** — Log hours by client, job type, and technician with flexible rate input and rate tier suggestions
- **Client Management** — Track client details, contact info, mailing addresses, default hourly rates, and per-client invoice settings
- **Invoice Generation** — Create sequential invoices from time entries with tech name and date in descriptions, edit line items inline, and export to PDF
- **Project Tracker** — Lightweight kanban-style project tracking grouped by client with status labels (in progress, waiting on client, needs call, etc.)
- **Reports** — Filter and analyze time entries across date ranges, clients, and technicians
- **Partner Revenue Split** — Per-entry revenue split based on account holder vs technician with configurable percentages
- **Supabase Cloud Sync** — Optional bidirectional sync to Supabase PostgreSQL for team collaboration, with encrypted config export/import for easy setup
- **Audit Log** — Track changes across the system
- **Multi-user Auth** — JWT-based authentication with admin, partner, and standard user roles
- **First-Time Setup** — Self-service account creation when no users exist yet
- **Company Settings** — Configurable company name and "payable to" address for invoices

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, Radix UI, Tailwind CSS 4 |
| Backend | Hono 4 on @hono/node-server |
| Database | PGlite (embedded PostgreSQL via WASM) — no external DB server needed |
| Auth | JWT + bcryptjs |
| PDF | pdfkit |
| Desktop | Electron (optional) |
| Package Manager | pnpm 10 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10

### Install

```bash
git clone https://github.com/mrdatawolf/Client-Time-Tracker.git
cd Client-Time-Tracker
pnpm install
```

### Configure

Copy the example environment file and edit as needed:

```bash
cp .env.example .env.local
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | Secret key for signing JWT tokens (required) |
| `API_PORT` | `3001` | Backend API server port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for the frontend |

### Run (Development)

```bash
# Start both frontend and backend
pnpm dev:all

# Or individually:
pnpm dev            # Frontend only (Next.js)
pnpm dev:server     # Backend only (Hono API)
```

The web app will be available at `http://localhost:3700` and the API at `http://localhost:3701`.

On first launch, you'll be prompted to create an admin account.

## Project Structure

```
/                           # Next.js frontend (root workspace)
├── src/
│   ├── app/                # App Router pages
│   │   ├── login/          # Public login page + first-time setup
│   │   └── (app)/          # Protected routes (auth-guarded)
│   │       ├── clients/
│   │       ├── time-entry/
│   │       ├── invoices/   # List + detail with inline editing
│   │       ├── projects/   # Project tracker grouped by client
│   │       ├── reports/
│   │       ├── partner/
│   │       ├── audit-log/
│   │       └── settings/
│   ├── lib/                # API client, utilities
│   └── components/         # Radix-based UI components
├── packages/
│   ├── server/             # Hono API server (@ctt/server)
│   └── shared/             # Shared schema, types, DB setup (@ctt/shared)
├── electron-app/           # Electron desktop wrapper
└── scripts/                # Build, bundle, and packaging scripts
```

## Building & Packaging

The app can be distributed as a standalone server (with systemd integration on Linux) or as an Electron desktop app. **You must build on the target platform** — use `build:all` on Windows and `build:linux` on Linux.

### Windows

```bash
# Full Windows build pipeline (Next.js + API bundle + Electron .exe + NSIS server installer)
pnpm build:all
```

**Output:**
- `distribute/` — Electron desktop installer (`.exe`)
- `distribute_server/` — Standalone server installer (`.exe`) with bundled Node.js

**Requires:** [NSIS](https://nsis.sourceforge.io/Download) installed on the build machine.

### Linux

```bash
# Full Linux build pipeline (Next.js + API bundle + Electron .deb/.rpm + server .deb/.rpm)
pnpm build:linux
```

**Output:**
- `distribute/` — Electron desktop packages (`.rpm`, `.deb`)
- `distribute_server/` — Standalone server packages (`.rpm`, `.deb`)

**Note:** `build:all` is Windows-only (builds NSIS installers). On Linux, always use `build:linux` — it builds native `.deb` and `.rpm` packages for both the desktop client and standalone server.

**Requires:** `fpm` and platform build tools. The build script checks prerequisites and tells you exactly what to install:

```bash
# Fedora / RHEL
sudo dnf install ruby ruby-devel rpm-build dpkg gcc make
gem install fpm

# Debian / Ubuntu
sudo apt install ruby ruby-dev build-essential rpm
gem install fpm
```

### Installing the Linux Server Package

```bash
# Fedora
sudo dnf install ./client-time-tracker-server-*.rpm

# Debian / Ubuntu
sudo dpkg -i ./client-time-tracker-server_*.deb

# Start and enable the service
sudo systemctl enable --now client-time-tracker
```

The server installs to `/opt/client-time-tracker/` with configuration at `/etc/client-time-tracker/.env` and data at `/var/lib/client-time-tracker/`. The database is preserved on uninstall.

### Individual Build Steps

| Command | Description |
|---------|-------------|
| `pnpm build` | Build Next.js frontend |
| `pnpm build:server` | Bundle Hono API server via esbuild |
| `pnpm build:standalone` | Assemble complete `dist-server/` directory |
| `pnpm electron:build` | Create Electron desktop installer |
| `pnpm server:installer` | Create Windows NSIS server installer |
| `pnpm server:installer:linux` | Create Linux RPM/DEB server packages |
| `pnpm clean` | Remove build output directories |

## Environment & Data

### Standalone Server

When installed via the server package, the app uses these locations:

| Item | Path |
|------|------|
| Application | `/opt/client-time-tracker/` (Linux) or `C:\ClientTimeTracker\` (Windows) |
| Configuration | `/etc/client-time-tracker/.env` (Linux) or `<install>\server\.env` (Windows) |
| Database | `/var/lib/client-time-tracker/` (Linux) or `<install>\server\data\` (Windows) |
| Service | `client-time-tracker.service` (systemd) |
| Default ports | Web: `3700`, API: `3701` |

### Electron Desktop

Data is stored in the user's app data directory (e.g., `%LOCALAPPDATA%\ClientTimeTracker\` on Windows).

## License

MIT
