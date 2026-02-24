# Gemini Project Context: Client Time Tracker

This document provides a comprehensive overview of the Client Time Tracker project to be used as context for AI-assisted development.

## 1. Project Overview

Client Time Tracker is a full-stack, self-hosted time tracking and invoicing application designed for IT service providers and consultants. It is built as a TypeScript monorepo using pnpm workspaces.

The architecture consists of three main parts:
1.  **Frontend:** A [Next.js](https://nextjs.org/) (App Router) application serving the user interface.
2.  **Backend:** An API server built with [Hono](https://hono.dev/) running on Node.js.
3.  **Desktop:** An [Electron](https://www.electronjs.org/) wrapper that bundles the frontend and backend into a single cross-platform desktop application.

The application uses [PGlite](https://github.com/electric-sql/pglite) (a WASM-based PostgreSQL server) for its database, requiring no external database setup for standalone operation. [Drizzle ORM](https://orm.drizzle.team/) is used for database access and schema management.

### Key Technologies

| Category | Technology | Path / Config |
| :--- | :--- | :--- |
| Package Manager | pnpm (workspaces) | `pnpm-workspace.yaml` |
| Frontend | Next.js 16 (React 19) | `next.config.ts`, `src/` |
| UI | Radix UI, Tailwind CSS | `src/components/ui`, `tailwind.config.mjs` |
| Backend | Hono | `packages/server/` |
| Database | PGlite (PostgreSQL) | `packages/shared/src/db/` |
| ORM / Schema | Drizzle ORM | `drizzle.config.ts`, `packages/shared/src/schema.ts` |
| Desktop App | Electron | `electron-app/` |
| Authentication | JWT | `packages/server/src/lib/jwt.ts` |

## 2. Project Structure

The project is organized as a monorepo with the following structure:

```
/
├── src/                  # Next.js frontend application
│   ├── app/              # App Router pages and layouts
│   └── components/       # React components
├── packages/             # Shared libraries (pnpm workspaces)
│   ├── server/           # Hono backend API
│   └── shared/           # Drizzle schema, DB logic, and shared types
├── electron-app/         # Electron main process and packaging config
├── scripts/              # Build, packaging, and development scripts
├── drizzle.config.ts     # Drizzle ORM configuration
├── electron-builder.json # Electron builder configuration
└── package.json          # Root package.json for frontend and project scripts
```

-   **`@ctt/server`**: The backend Hono application, responsible for all business logic and database interactions.
-   **`@ctt/shared`**: A shared package containing the Drizzle ORM schema, database connection logic, and types used by both the frontend and backend.

## 3. Getting Started & Development

### Initial Setup

1.  Clone the repository.
2.  Install dependencies using pnpm:
    ```bash
    pnpm install
    ```
3.  Copy the example environment file for local development:
    ```bash
    cp .env.example .env.local
    ```
4.  Ensure `JWT_SECRET` is set in `.env.local`.

### Running the Development Environment

The primary development script starts both the frontend and backend servers concurrently.

```bash
pnpm dev:all
```

This command executes `scripts/dev.js`, which in turn runs:
-   **API Server (`pnpm dev:server`):** Starts the Hono API on `http://localhost:3001`.
-   **Frontend (`pnpm dev`):** Starts the Next.js development server on `http://localhost:3700`.

On first launch, the application will guide you through creating an admin account.

### Database

-   The database schema is defined in `packages/shared/src/schema.ts`.
-   To seed the database with initial data, run: `pnpm db:seed`.
-   Drizzle Studio can be used to browse the database, but is not yet configured in the project.

## 4. Building and Distribution

The project can be packaged as a standalone server or an Electron desktop app.

### Key Build Scripts

-   `pnpm build`: Builds the Next.js frontend.
-   `pnpm build:server`: Compiles the Hono API server using `esbuild`.
-   `pnpm build:all`: (For Windows) A full pipeline that builds the frontend, backend, Electron app, and a standalone server installer.
-   `pnpm build:linux`: (For Linux) The equivalent full build pipeline for Linux, creating `.rpm` and `.deb` packages.

### Output Directories

-   `dist-electron/`: Output for the unpackaged Electron app.
-   `dist-server/`: Staging directory for the standalone server bundle.
-   `distribute/`: Final location for user-facing Electron installers.
-   `distribute_server/`: Final location for user-facing server installers.
