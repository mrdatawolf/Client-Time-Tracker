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
│   ├── login/            # Public login page (+ first-time setup flow)
│   └── (app)/            # Protected route group (auth-guarded layout)
│       ├── clients/
│       ├── time-entry/
│       ├── invoices/      # List + [id] detail (inline editable)
│       ├── projects/      # Project tracker grouped by client
│       ├── reports/
│       ├── partner/
│       ├── audit-log/
│       └── settings/
├── src/lib/              # Frontend utilities (api-client, helpers)
│   ├── api-client.ts     # Fetch wrapper with JWT + 401 auto-redirect
│   └── api.ts            # Typed API namespaces for all endpoints
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
        ├── db/           # PGlite database setup + migrations
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
- Auto-redirects to `/login` on 401 (clears stale token from localStorage)

### First-Time Setup

If no users exist in the database, the login page shows a "Create Your Account" form.
Endpoints: `GET /api/auth/setup-status`, `POST /api/auth/setup`

### Hono Middleware Order (server `index.ts`)

The middleware registration order matters. Auth routes (`/api/auth/*`) handle their own
authentication internally — the global `requireAuth` middleware explicitly skips them.
Other routes under `/api/*` go through the global auth middleware.

CORS is configured to allow any origin (for LAN access) with credentials support.

### Database

Uses PGlite (embedded Postgres via WASM). Schema defined with Drizzle ORM in
`packages/shared/src/schema.ts`. No external database server needed.

**NEVER delete, drop, recreate, or reset the database or its tables without explicitly telling the user first and getting confirmation.** The database contains real client/billing data. Schema changes must always use additive migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), never destructive ones. Do not run `pnpm db:seed` unless the user specifically asks — it may overwrite existing data.

### Projects & Chat Logs

Lightweight project tracker for seeing where client work is stalled at a glance.

- **Tables**: `projects` (client_id, name, status, assigned_to, note, is_active) and `client_chat_logs` (client_id, content — one per client for pasted Telegram history)
- **Statuses**: `in_progress`, `waiting_on_client`, `need_to_reach_out`, `needs_call`, `on_hold`, `completed`
- **Routes**: `packages/server/src/routes/projects.ts`, `packages/server/src/routes/client-chat-logs.ts`
- **Frontend**: `src/app/(app)/projects/page.tsx` — grouped by client, inline status editing, side panel for chat logs
- **Dashboard**: Shows last 5 recently updated projects on the main dashboard

### Invoices & PDF Generation

- **PDF generation**: `GET /api/invoices/:id/pdf` using `pdfkit` — generates a PDF matching the company invoice template (see `Examples/Invoice - Client 0001.docx`)
- **Company settings** (stored in `app_settings`): `companyName` (default: "Lost Coast IT"), `invoicePayableTo` (default: "Patrick, Moon\n6336 Purdue Dr. Eureka, Ca 95503")
- **Inline editing**: Invoice detail page supports editing line items (description, hours, rate), adding/deleting lines, and editing invoice fields (number, dates, notes) for draft/sent invoices
- **Line item endpoints**: `PUT /:invoiceId/line-items/:lineId`, `POST /:invoiceId/line-items`, `DELETE /:invoiceId/line-items/:lineId`

### Client Fields

Clients have: `name`, `accountHolder`, `phone`, `mailingAddress`, `notes`, `defaultHourlyRate`. Phone and mailing address are used on PDF invoices.
