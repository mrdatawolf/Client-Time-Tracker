# Client Time Tracker

## Project Overview

Full-stack time tracking application for client billing. Monorepo using pnpm workspaces.

**The codebase is mid-migration.** Per `docs/supabase-migration-plan.md`, the primary Next.js app
(`src/app`, `src/components`, `src/lib`) is being converted in place from a local-first architecture to a
static browser app that talks directly to Supabase — no backend server, RLS as the security boundary. The
old local-first system (`packages/server` Hono API + PGlite + Electron/NSIS installers) still exists in the
repo, frozen (not developed further except emergency fixes), until cutover (migration plan Phase 5) deletes
it. **Don't assume the two share a runtime, an auth mechanism, or a database — they don't.** Check which
system a file belongs to before reasoning about how it behaves.

## Current app: Supabase-native (`src/app`, primary, actively developed)

No backend server. The browser talks to Supabase (Auth + PostgREST + RPC) directly via `@supabase/supabase-js`.

### Connection & Authentication Flow

1. Each org runs its own Supabase project and shares a connection code (`CTTW:` + base64 of
   `{ url, anonKey }`) — see `src/lib/supabase.ts`. First load with no stored config redirects to
   `/connect`; the code is decoded and stored in localStorage (`ctt_supabase_config`).
2. Auth is Supabase Auth (email + password) — `src/app/login/page.tsx` redirects to `/connect` if
   `isConfigured()` is false. `auth.login()`/`auth.signup()` (`src/lib/api.ts`) call
   `supabase.auth.signInWithPassword()` / `.signUp()` directly.
3. The Supabase JS client is configured with `storageKey: 'ctt_auth'` (`getSupabase()` in
   `src/lib/supabase.ts`), so the SDK manages its own session in localStorage under that key.
4. The app's own `users` row (role, status, display name — not the Supabase auth user) is cached
   separately in localStorage (`ctt_user`) via `src/lib/api-client.ts`, so synchronous helpers
   (`getUser()`, `isAdmin()`, `isPartner()`, `isAuthenticated()`) work without an await through the
   component tree. `refreshCurrentUser()` re-derives it from the live session + a `users` lookup keyed on
   `auth_user_id`.
5. New signups land as `status: 'pending'` (RLS blocks all data) until an admin activates them.
6. `(app)/layout.tsx` is the route guard: no config → `/connect`; cached user renders immediately, then
   `refreshCurrentUser()` corrects it — no session → `/login`; `status !== 'active'` → `/pending`.

### Data layer

`src/lib/api.ts` is a thin typed wrapper — every `*Api` group (`clients`, `timeEntries`, `jobTypes`,
`rateTiers`, `users`, `settings`, `projects`, `invoices`, ...) calls `db()` (== `getSupabase()`) directly
against PostgREST/RPC from the browser. **There is no server-side authorization layer** — RLS policies in
the org's own Supabase project are the only security boundary; the UI hiding admin-only fields is a
convenience, not a guarantee. `fail()` in `api.ts` translates Postgres error codes into friendly messages
(`23503` FK violation → "Invalid reference...", `23505` unique violation → "That name already exists.").

### Time entry forms (shared between the dialog and the mobile quick-log card)

- `src/lib/useTimeEntryForm.ts` — all state, validation, rate-tier auto-defaulting
  (`resolveRateTierId()`), save/delete logic. Takes `active` (mount/reset trigger), optional `entry` (edit
  mode), `defaultClientId`/`defaultDate`/`defaultTechId`, and `resetOnSave`.
- `src/components/TimeEntryFormFields.tsx` — presentational fields only (client/date/hours/job
  type/rate/tech/notes/billed/paid/total), with `showClientPicker`/`showDate`/`showTech` flags so callers
  can render a subset.
- `src/components/TimeEntryDialog.tsx` — desktop/grid modal; thin shell around the hook + fields.
- `src/components/QuickLogTimeCard.tsx` — phone-only inline card on the dashboard (`< md`, 768px):
  Client, Date (defaults today), Tech (admin/partner only, defaults to last-used via
  `src/components/LastTechProvider.tsx`, localStorage `ctt_last_tech`) are always visible; the rest of the
  form reveals once a client is picked; resets fully back to the 3-field state after a successful save.
- Mobile breakpoint: `src/lib/useIsMobile.ts` (`MD_BREAKPOINT = 768`), shared by `TimeEntryGrid` and the
  dashboard — keep it in sync with the Tailwind `md:` convention used everywhere else (sidebar
  hamburger/drawer, table column hiding).

### Rate Tiers & Time Entry Rates

- Free-form rate input with clickable rate-tier suggestion chips.
- Auto-defaults rate from: client's `defaultHourlyRate` → global `baseHourlyRate` setting → first active
  rate tier (in `useTimeEntryForm.ts`).
- Custom rates auto-create new rate tiers on save via `resolveRateTierId()`.

## Legacy local-first system (frozen: `packages/server`, `packages/shared` DB code, `electron-app/`)

Not under active development — see `docs/supabase-migration-plan.md` Phase 0. Still runs for existing
desktop/server installs until cutover. Do not extend it for new features; the Supabase-native app above is
where new work happens.

### Environment Variables

Defined in `.env.local` at project root (legacy backend only — the Supabase-native app takes its
connection at runtime via `/connect`, not env vars):

- `JWT_SECRET` - JWT signing secret
- `API_PORT` - Backend port (default: 3001)
- `NEXT_PUBLIC_API_URL` - API base URL for the frontend (default: http://localhost:3001)

### Old Authentication Flow (legacy Hono backend only)

1. Frontend POSTs to `/api/auth/login` with `{ username, password }`
2. Backend validates credentials, returns `{ token, user }`
3. Token stored in localStorage (`ctt_token`), user in (`ctt_user`)
4. All subsequent API calls include `Authorization: Bearer <token>` header

### Hono Middleware Order (server `index.ts`)

The middleware registration order matters. Auth routes (`/api/auth/*`) handle their own
authentication internally — the global `requireAuth` middleware explicitly skips them.
Other routes under `/api/*` go through the global auth middleware.

CORS is configured to allow any origin (for LAN access) with credentials support.

### Database

Uses PGlite (embedded Postgres via WASM). Schema defined with Drizzle ORM in
`packages/shared/src/schema.ts`. No external database server needed.

**NEVER delete, drop, recreate, or reset the database or its tables without explicitly telling the user first and getting confirmation.** The database contains real client/billing data. Schema changes must always use additive migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), never destructive ones. Do not run `pnpm db:seed` unless the user specifically asks — it may overwrite existing data. **This same caution applies to any org's live Supabase project** in the new app — never run destructive SQL, drop tables, or re-run `setup.sql` changes against production data without explicit confirmation.

### Supabase Sync (legacy — bidirectional backup/sync, distinct from the new Supabase-native app above)

Optional cloud sync from the legacy desktop app to a Supabase PostgreSQL database for team collaboration.
This is **not** the same Supabase project or mechanism the new browser app uses — see "Why not share the
sync target" in the migration plan for why they must stay separate.

- **Config**: Stored in `data/supabase-config.json` (URL, database URL, API keys)
- **Config export/import**: `POST /api/supabase/config/export` and `/config/import` — AES-256-CBC encrypted config strings (`CTT:...`) for easy sharing between installations
- **Sync engine**: Bidirectional push/pull with changelog tracking and timestamp-based conflict resolution (`packages/shared/src/db/sync-engine.ts`)
- **Scheduler**: Background sync every 30s when enabled (`packages/shared/src/db/sync-scheduler.ts`)
- **Sidebar indicator**: Shows sync state (connected/syncing/offline/error) with manual sync button for admin/partner users
- **Routes**: `packages/server/src/routes/supabase.ts` — config, test-connection, setup-schema, sync, initial-sync

### Error Handling (legacy Hono backend)

- **Global error handler**: `app.onError()` in `packages/server/src/index.ts` catches unhandled exceptions and returns structured `{ error: message }` JSON
- **Time entry creation**: Try-catch with descriptive messages for FK violations ("Invalid reference: one of the selected items...") instead of generic 500s
