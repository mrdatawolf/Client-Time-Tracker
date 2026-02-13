# Client Time Tracker

## Project Overview

Full-stack time tracking application for client billing. Monorepo using pnpm workspaces.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Radix UI, Tailwind CSS 4
- **Backend**: Hono 4 on @hono/node-server
- **Database**: PGlite (embedded PostgreSQL) via Drizzle ORM
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Package Manager**: pnpm 10

## Project Structure

```
/                         # Next.js frontend (root workspace)
├── src/app/              # App Router pages
│   ├── login/            # Public login page
│   └── (app)/            # Protected route group (auth-guarded layout)
│       ├── clients/
│       ├── time-entry/
│       ├── invoices/
│       ├── reports/
│       ├── partner/
│       ├── audit-log/
│       └── settings/
├── src/lib/              # Frontend utilities (api-client, helpers)
├── src/components/       # UI components (Radix-based)
├── packages/server/      # Hono API server (@ctt/server)
│   └── src/
│       ├── index.ts      # Server entry, middleware, route mounting
│       ├── routes/       # Route handlers (auth, users, clients, etc.)
│       ├── middleware/   # Auth middleware (requireAuth, requireAdmin)
│       └── lib/          # JWT utilities, helpers
└── packages/shared/      # Shared package (@ctt/shared)
    └── src/
        ├── schema.ts     # Drizzle database schema
        ├── relations.ts  # Drizzle relation definitions
        ├── db/           # PGlite database setup
        └── types/        # Shared TypeScript types
```

## Development

```bash
pnpm dev:all          # Start both frontend and backend
pnpm dev              # Frontend only (Next.js on :3000)
pnpm dev:server       # Backend only (Hono on :3001)
pnpm db:seed          # Seed the database
```

## Environment Variables

Defined in `.env.local` at project root:

- `JWT_SECRET` - JWT signing secret
- `API_PORT` - Backend port (default: 3001)
- `NEXT_PUBLIC_API_URL` - API base URL for the frontend (default: http://localhost:3001)

## Architecture Notes

### Authentication Flow

1. Frontend POSTs to `/api/auth/login` with `{ username, password }`
2. Backend validates credentials, returns `{ token, user }`
3. Token stored in localStorage (`ctt_token`), user in (`ctt_user`)
4. All subsequent API calls include `Authorization: Bearer <token>` header
5. Protected frontend routes use `(app)/layout.tsx` which checks `isAuthenticated()`

### API Client (`src/lib/api-client.ts`)

- `apiClient<T>(path, options)` - fetch wrapper that prepends `API_BASE` and attaches the JWT token
- Throws `ApiError` on non-2xx responses

### Hono Middleware Order (server `index.ts`)

The middleware registration order matters. Auth routes (`/api/auth/*`) handle their own
authentication internally — the global `requireAuth` middleware explicitly skips them.
Other routes under `/api/*` go through the global auth middleware.

CORS is configured to allow any origin (for LAN access) with credentials support.

### Database

Uses PGlite (embedded Postgres via WASM). Schema defined with Drizzle ORM in
`packages/shared/src/schema.ts`. No external database server needed.

**NEVER delete, drop, recreate, or reset the database or its tables without explicitly telling the user first and getting confirmation.** The database contains real client/billing data. Schema changes must always use additive migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), never destructive ones. Do not run `pnpm db:seed` unless the user specifically asks — it may overwrite existing data.
