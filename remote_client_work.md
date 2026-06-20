# Mobile App Planning — Android Client Time Tracker

## Goal

A subset of the Client Time Tracker available on Android that can:
- Add time entries to a client's calendar (with all associated data)
- View a calendar of a client's times
- Talk directly to Supabase (no local server required)

---

## Data Needed (from existing schema)

**Read-only lookups:**
- `clients` — pick a client
- `job_types` — dropdown picker
- `rate_tiers` — rate selection
- `users` — who is logging (the logged-in tech)

**Read/write:**
- `time_entries` — core data: clientId, techId, jobTypeId, rateTierId, date, hours, notes

---

## Core Architectural Challenge: Auth

The current Supabase connection is a raw PostgreSQL pool using the database URL (essentially a superuser connection). This is fine for the server but **cannot be safely embedded in a mobile app**.

Supabase's mobile-safe API layer — PostgREST + anon/user keys + Row Level Security (RLS) — requires **Supabase Auth** (email/password). The existing custom bcrypt auth in the `users` table must be supplemented with Supabase Auth accounts.

---

## Recommended Stack

**Expo (React Native) + Supabase JS SDK**

- TypeScript throughout — same language as the rest of the codebase
- `@supabase/supabase-js` works natively in Expo: handles auth, RLS, and PostgREST
- Builds to Android (and iOS if ever wanted) from one codebase
- Can live as `packages/mobile` in this monorepo or a separate repo

---

## Setup Steps

1. **Supabase Auth** — enable email/password auth on the Supabase project; create auth users corresponding to existing `users` records (one-time migration script)
2. **RLS policies** — allow authenticated users to:
   - Read `clients`, `job_types`, `rate_tiers`, `users`
   - Read/write `time_entries` where `tech_id = auth.uid()` (or mapped)
   - Note: desktop sync uses the service role key which bypasses RLS — no conflict
3. **Expo project** — new package with the screens below

---

## Mobile Feature Scope

- Login / session persistence
- Client list → select a client
- Month/week calendar view of that client's time entries
- Add time entry (date, hours, job type, rate tier, notes)
- Edit/delete own time entries
- View total hours for a period

---

## Open Questions (to answer before starting)

1. **Auth mapping**: Create matching Supabase Auth accounts for all existing users, or is this single-user (just you)?
2. **Repo location**: `packages/mobile` in this monorepo, or a separate repo?
3. **RLS**: Confirmed OK to add RLS policies to Supabase without breaking the desktop sync (service role key bypasses RLS).
4. **Offline support**: Always-connected, or does the phone need to work without internet?
