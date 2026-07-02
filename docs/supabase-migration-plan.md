# Supabase-Native Migration Plan

**Goal:** Retire the local-first architecture (PGlite + Hono server + Electron/NSIS installers) in favor of a
static browser app that talks directly to Supabase. Zero installation: a user opens the hosted app URL,
pastes an org config string, and works.

**Status:** Planned 2026-07-02. Not started.

## Decisions (locked)

| Question | Decision |
|---|---|
| Tenancy | **Bring-your-own Supabase.** The app is a generic static site; each org runs its own Supabase project and shares a config string (project URL + anon key only). |
| Auth | **Supabase Auth, email + password.** Usernames retired. Roles (`partner`/`admin`/`basic`) live in the app's `users` table, enforced by RLS. |
| New accounts | **Self-signup + admin approval.** Anyone with the config string can sign up but lands as `pending` with RLS blocking all data until an admin activates them, assigns a role, and optionally links them to an existing tech record. No service-role key anywhere in the app. |
| Server compute | **SQL-first.** Postgres functions (RPC) for invoice creation/numbering/splits/reports, triggers for audit logging, `pg_cron` for auto-invoicing. PDF rendering moves to the browser. No Edge Functions (they'd require per-org deployment, breaking the paste-and-go story). |
| Offline | **Time-entry capture only.** Cached reference data + an IndexedDB outbox for the user's own new/edited entries, flushed on reconnect. Everything else requires a connection. |
| Hosting | **Next.js static export** (`output: 'export'`) on a public host (Cloudflare Pages / GitHub Pages / Vercel). One canonical URL for all orgs. A service worker is required anyway for offline entry, so the app becomes a PWA as a side effect. |
| Org setup DDL | **Copy-paste SQL.** The app bundles a versioned `setup.sql`; the org owner pastes it into the Supabase SQL Editor once. The app checks a `schema_meta` version row and shows the same flow for future migrations. |
| Sequencing | **Freeze the old system, convert in place.** Production installs are frozen build artifacts, so changing `main` touches nobody. Tag the last legacy release (bugfixes cherry-picked to that tag's branch if ever needed), then convert the frontend destructively on `main` — no dual-mode, no abstraction layer, no parallel package. The old system is not developed further; it just keeps running until cutover. |
| Data migration | **Dump/restore, no new code.** Production data is already in a Supabase project via the sync engine. Test projects are seeded with `pg_dump` from prod + `setup.sql` on top, and destroyed/re-seeded freely during testing. Cutover is a final dump into a **fresh** production project. |
| Coexistence | **The new app and the old system never share a database.** See "Why not share the sync target" below. |

## Security model shift (read this before writing any RLS)

Today the Hono server is the security boundary; the UI hides what roles shouldn't see. In the new world
**RLS is the only boundary** — any authenticated user has the anon key and can query PostgREST directly,
bypassing the UI. Every table must have explicit policies. Current role semantics to mirror
(from `packages/server/src/routes/*` + `middleware/auth.ts`):

- `basic`: read/write **own** time entries only (`tech_id = self`); read clients, job types, rate tiers
  (needed for the entry form). No invoices, payments, reports, users, partner data, audit log, settings writes.
- `admin`: everything except partner-role management (can't create/edit/delete `partner` users).
- `partner`: everything.
- `pending` (new status): authenticated but no data access at all.

Watch items:
- `app_settings` is key-value; if any key is sensitive, split policies per-key or move sensitive keys to an
  admin-only table. `basic` users need read access to at least `baseHourlyRate` for rate defaults.
- Role/status columns on `users` must not be self-editable (column-level: separate the "my profile"
  update policy from the admin update policy).
- Helper functions (`is_admin()`, `current_app_user()`) must be `SECURITY DEFINER` with pinned
  `search_path`, reading `users` by `auth_user_id = auth.uid()`.

## Why not share the sync target

It's tempting to point the new app at the Supabase project the old system already syncs into. Don't:

- The sync engine's pull side does `SELECT *` on remote tables (`sync-engine.ts`); the new schema's added
  columns (`auth_user_id`, `email`, `status`, …) would flow into upserts against local PGlite tables that
  don't have them, breaking pulls — unless every new column is also mirrored into `local.ts`, which is
  exactly the dual-maintenance this plan avoids.
- Two auto-invoice engines (the old hourly scheduler + the new `pg_cron` job) would double-generate
  invoices, and per-client sequential invoice numbering would race across the two systems.
- Testing is destructive by design and can never point at the project production syncs into.

(For the record: enabling RLS alone would *not* break the old sync — it connects as the `postgres` role
via the direct database URL, and RLS doesn't bind the table owner unless forced. The problems are the
ones above, not RLS.)

Fallback strategy at cutover is not "both systems live" — it's "the frozen old install still exists and
holds the data as of the freeze."

## Phase 0 — Freeze the legacy system

1. Tag the current release (e.g. `legacy-final`) and cut a `legacy` branch from it. Any emergency bugfix
   for the old system happens there and gets rebuilt via the existing installer pipeline; `main` is now
   free to change destructively.
2. Production installs keep running and syncing, untouched, until Phase 5.

## Phase 1 — Canonical schema + security in SQL (`supabase/setup.sql`)

The deliverable is one idempotent, versioned SQL script (plus future `migrate-vN.sql` scripts):
`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE` for
functions/policies — so it runs cleanly both on a blank project and on a `pg_dump`-restored copy of the
production data.

1. **Tables** — consolidate from `packages/shared/src/schema.ts` and the DDL in
   `packages/server/src/routes/supabase.ts` (`setup-schema`). Add:
   - `users.auth_user_id uuid UNIQUE REFERENCES auth.users(id)`, `users.email text`,
     `users.status text` (`pending`/`active`/`disabled`). Keep existing `users.id` UUIDs — all FK history
     (`time_entries.tech_id`, etc.) is preserved.
   - `schema_meta(version int, applied_at)` for the in-app version check.
2. **Signup trigger** — `AFTER INSERT ON auth.users`: if a `users` row already has that email (and no
   auth link), the account **auto-links** to it and activates; else if nobody can log in yet, the first
   signup becomes an active partner (bootstrap); else a `pending` row is created for admin approval.
   The approval UI can also **link a pending account to an existing user row** manually. Either way,
   staff keep their historical tech record — no password import, no service-key tooling.
   Known emails to pre-fill before cutover: `patrick` → patrickmoon@gmail.com,
   `anthony` → atech8700@gmail.com (collect the rest before Phase 5).
3. **RLS policies** — per the model above, on every table. Deny by default.
4. **RPC functions** (port from server routes; most report queries in `routes/reports.ts` are already raw
   SQL and port nearly verbatim):
   - `create_invoice(...)` / `generate_invoice_for_client(...)` — includes per-client sequential invoice
     numbering via `SELECT ... FOR UPDATE` on `clients.next_invoice_number` (fixes the existing race, too).
   - Invoice split operations (`routes/invoices.ts` split/toggle-paid logic).
   - One function per report (`client_summary`, `tech_summary`, `balance`, `aged_receivables`, `wip`,
     `effective_rate`, `tech_utilization`, `annual_revenue`, `partner_*`, `payments_ledger`, `tax_export`).
   - `resolve_rate_tier(amount)` for the auto-create-rate-tier-on-save behavior.
5. **Audit triggers** — replace `middleware/audit.ts` with row-level triggers writing to `audit_log`.
6. **Auto-invoicing** — port `lib/auto-invoice-scheduler.ts` to a SQL function; schedule hourly with
   `pg_cron` (extension enable is part of setup.sql; available on all Supabase plans).
7. **Sync-cruft cleanup section** — setup.sql (or a companion `cleanup-legacy-sync.sql`) drops
   `remote_sync_changelog` and its triggers if present, so a restored prod dump comes out clean.
8. **Setup checklist doc** — things SQL can't do that the org owner does once in the dashboard:
   create project, get URL + anon key, set Auth email settings (confirmations on/off, SMTP if custom).

**Verify:** seed a test project (`pg_dump` prod → restore → setup.sql), run setup.sql twice
(idempotency), and write RLS tests (e.g. `pgTAP` or a script hitting PostgREST with JWTs for each role:
pending sees nothing, basic sees only own entries, basic cannot read invoices, etc.). Re-seed the test
project destructively as often as needed — it's two commands.

## Phase 2 — Convert the frontend in place (supabase-js replaces the REST client)

The seam is `src/lib/api.ts` — every component already goes through typed functions
(`timeEntriesApi`, `invoicesApi`, ...). Keep those signatures where convenient; there is no second
backend to preserve, so signatures may also change freely where supabase-js fits better.

1. **Connection config + onboarding** — new browser-safe config string (versioned `CTTW:` prefix or
   similar) containing **only** project URL + anon key, AES-encrypted like the current export format.
   Paste screen on first load; stored in localStorage. The old `CTT:` string (which contains the database
   URL and service keys) is never accepted by the browser app.
2. **Auth** — supabase-js session replaces `ctt_token`/`ctt_user` outright; login page becomes email
   login + signup; add "pending approval" screen; `(app)/layout.tsx` guard uses the Supabase session;
   `users.role`/`status` fetched into the user context. Delete the JWT/localStorage token plumbing.
3. **Data layer** — rewrite `api.ts` module-by-module (each `*Api` group is one PR-sized unit) against
   supabase-js + RPC. Numeric columns come back as strings from PostgREST just as they do from the
   current API, so types mostly hold. The app will be partially broken between modules — that's fine,
   nothing on `main` ships to production until cutover.
4. **Admin approval UI** — user management page gains: pending list, activate + assign role,
   "link to existing tech" (sets `auth_user_id` on the historical row instead of using the new stub row).
5. **Reports/invoices → RPC calls**; **PDF in browser** — port `lib/invoice-generator.ts` (pdfkit has a
   browser build; else pdf-lib) and render client-side from the same invoice data.
6. **Excel import** (`routes/migrate.ts`) — parse client-side (`xlsx`), insert via supabase-js.
7. **Schema version gate** — on connect, read `schema_meta`; if missing/stale, show the copy-paste-SQL
   flow with the bundled script.

**Verify:** every screen exercised against a freshly re-seeded test project (real production data shape)
with one login per role.

## Phase 3 — Offline time entry + PWA

1. Service worker (`serwist` works with Next static export) precaching the app shell.
2. Cache reference data (clients, job types, rate tiers, own recent entries) in IndexedDB on each load.
3. **Outbox**: own new/edited time entries created offline get client-generated UUIDs and queue in
   IndexedDB; on reconnect, upsert in order; surface per-item failures. Conflicts are near-impossible by
   construction (users only queue their own entries), so last-write-wins is fine.
4. Offline UI state: banner, disabled non-entry sections, queue count + retry.

## Phase 4 — Static export + hosting

1. `output: 'export'` in `next.config.ts`; remove/replace anything incompatible (no dynamic API routes,
   no server actions; `NEXT_PUBLIC_API_URL` disappears with the REST client).
2. CI deploy of the static bundle to the chosen host (Cloudflare Pages recommended: free, fast, custom
   domain). Same URL for every org.
3. Demo mode: point at a public demo Supabase project via a baked-in demo config, replacing `DEMO_MODE`.

## Phase 5 — Cutover + retirement

Runs only after the team agrees the new app is stable against test-project seeds.

1. Create a **fresh** production Supabase project (don't reuse the sync target — the final restore +
   cleanup script gives it a clean start with no changelog cruft).
2. Announce a freeze; stop work in the old app. Run a final sync from the desktop install, then
   `pg_dump` the old sync target → restore into the fresh project → run `setup.sql` +
   `cleanup-legacy-sync.sql` on it.
3. Verify: row counts per table, spot-check invoices/balances/reports against the old app's numbers.
4. Pre-fill each staff member's email on their `users` row (partners: patrickmoon@gmail.com,
   atech8700@gmail.com), so signing up auto-links them to their history. Anyone without a
   pre-filled email lands pending and gets linked via the admin approval UI. Verify roles.
5. Hand out the new config string; team switches to the browser URL. Keep the frozen desktop/server
   install and the old sync-target project untouched for a comfort window (e.g. 30 days) as the
   rollback of record, then decommission both.
6. Delete from the repo: `packages/server`, the sync engine/scheduler/changelog and PGlite code in
   `packages/shared`, `electron-app/`, NSIS/build pipeline (`build:server`, `build:standalone`,
   `electron:build`, `server:installer`, `build:all`), `dist-server/`, `dist-electron/`, `distribute*/`.
   Update CLAUDE.md/README. The `legacy-final` tag preserves all of it in history.
7. Log the retirement in Project Brain.

## Risks / notes

- **RLS is load-bearing.** Budget real time for policy tests; a missing policy = data exposure to any
  authenticated (even pending) user.
- **No soft-launch overlap.** The old and new systems are never live against the same data; rollback
  during the comfort window means returning to the frozen desktop install (accepting loss of anything
  entered in the new app since cutover). Acceptable for a small team; keep the comfort window short.
- **BYO schema drift.** Every org self-applies migrations; the schema version gate must hard-block the
  app on mismatch, and migration scripts must be strictly ordered and idempotent.
- **Supabase free tier** pauses projects after ~1 week of inactivity — fine for daily-use orgs; document it.
- **pg_cron granularity** is fine for the hourly auto-invoice job; job runs as the function owner —
  keep the function `SECURITY DEFINER` and self-contained.
- **Password migration is avoided by design** (link-account flow) — nobody's bcrypt hash needs importing.
- **Anon key in a shared config string is not a secret** (it's designed to be public); safety rests
  entirely on RLS + Auth. The service role key and database URL must never appear in the browser or the
  `CTTW:` string.
