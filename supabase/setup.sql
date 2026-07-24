-- ============================================================================
-- Client Time Tracker — Supabase setup script (schema version 1)
--
-- Run this once in your Supabase project's SQL Editor (paste-and-run).
-- It is idempotent: safe to run repeatedly, and safe to run on top of a
-- database restored from a legacy sync-target dump.
--
-- Creates: tables, Supabase Auth integration, Row Level Security, business
-- RPC functions (invoices, reports), audit triggers, and the pg_cron
-- auto-invoice job. The browser app connects with only the project URL and
-- the publishable (anon) key; RLS is the security boundary.
--
-- Role model (mirrors the legacy server):
--   basic   — own time entries only; read/write clients, job types, rate
--             tiers, projects, chat logs; read settings
--   admin   — everything except managing partner-role users
--   partner — everything
--   pending — authenticated but no data access until approved
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
do $do$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron not available (%). Auto-invoicing will not be scheduled.', sqlerrm;
end
$do$;

-- ----------------------------------------------------------------------------
-- 1. Schema version registry
-- ----------------------------------------------------------------------------
create table if not exists public.schema_meta (
  version int primary key,
  applied_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Enum + tables (full current schema; additive on existing databases)
-- ----------------------------------------------------------------------------
do $do$
begin
  create type user_role as enum ('admin', 'basic');
exception when duplicate_object then null;
end
$do$;
alter type user_role add value if not exists 'partner';

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text,
  role user_role not null default 'basic',
  theme text not null default 'system',
  is_active boolean not null default true,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.users add column if not exists theme text not null default 'system';
alter table public.users add column if not exists auth_user_id uuid;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists status text;
alter table public.users alter column password_hash drop not null;
update public.users set status = 'active' where status is null;
alter table public.users alter column status set default 'pending';
alter table public.users alter column status set not null;
do $do$
begin
  alter table public.users
    add constraint users_auth_user_id_fkey foreign key (auth_user_id)
    references auth.users(id) on delete set null;
exception when duplicate_object then null;
end
$do$;
create unique index if not exists users_auth_user_id_key on public.users (auth_user_id);
create index if not exists users_email_idx on public.users (lower(email));

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_holder text,
  account_holder_id uuid references public.users(id),
  phone text,
  mailing_address text,
  is_active boolean not null default true,
  notes text,
  default_hourly_rate numeric(10,2),
  invoice_payable_to text,
  billing_cycle text,
  billing_day numeric(2,0),
  invoice_prefix text,
  next_invoice_number numeric(10,0) default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients add column if not exists default_hourly_rate numeric(10,2);
alter table public.clients add column if not exists phone text;
alter table public.clients add column if not exists mailing_address text;
alter table public.clients add column if not exists account_holder_id uuid references public.users(id);
alter table public.clients add column if not exists invoice_payable_to text;
alter table public.clients add column if not exists billing_cycle text;
alter table public.clients add column if not exists billing_day numeric(2,0);
alter table public.clients add column if not exists invoice_prefix text;
alter table public.clients add column if not exists next_invoice_number numeric(10,0) default 1000;

create table if not exists public.job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_tiers (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null,
  label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  invoice_number text not null unique,
  date_issued date not null,
  date_due date,
  status text not null default 'draft',
  notes text,
  is_auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.invoices add column if not exists is_auto_generated boolean not null default false;

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  tech_id uuid not null references public.users(id),
  job_type_id uuid not null references public.job_types(id),
  rate_tier_id uuid not null references public.rate_tiers(id),
  date date not null,
  hours numeric(6,2) not null,
  notes text,
  group_id uuid,
  is_billed boolean not null default false,
  is_paid boolean not null default false,
  invoice_id uuid references public.invoices(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  time_entry_id uuid references public.time_entries(id) on delete set null,
  description text not null,
  hours numeric(6,2) not null,
  rate numeric(10,2) not null,
  line_item_type text not null default 'labor',
  created_at timestamptz not null default now()
);
alter table public.invoice_line_items add column if not exists line_item_type text not null default 'labor';
-- Ensure the time-entry FK is ON DELETE SET NULL (legacy DDL lacked it)
alter table public.invoice_line_items drop constraint if exists invoice_line_items_time_entry_id_fkey;
alter table public.invoice_line_items
  add constraint invoice_line_items_time_entry_id_fkey
  foreign key (time_entry_id) references public.time_entries(id) on delete set null;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(10,2) not null,
  date_paid date not null,
  method text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_splits (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.users(id),
  split_percent numeric(5,4) not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_payments (
  id uuid primary key default gen_random_uuid(),
  from_partner_id uuid not null references public.users(id),
  to_partner_id uuid not null references public.users(id),
  amount numeric(10,2) not null,
  date_paid date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  old_values text,
  new_values text,
  created_at timestamptz not null default now()
);
alter table public.audit_log add column if not exists old_values text;

create table if not exists public.auto_invoice_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  invoice_id uuid references public.invoices(id),
  billing_period_start date not null,
  billing_period_end date not null,
  status text not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_payout_flags (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  partner_id uuid not null references public.users(id),
  is_paid boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index if not exists invoice_payout_flags_invoice_partner_key
  on public.invoice_payout_flags (invoice_id, partner_id);

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  name text not null,
  status text not null default 'in_progress',
  assigned_to text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_chat_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) unique,
  content text not null,
  updated_at timestamptz not null default now()
);

-- Indexes for report/list performance
create index if not exists time_entries_client_id_idx on public.time_entries (client_id);
create index if not exists time_entries_tech_id_idx on public.time_entries (tech_id);
create index if not exists time_entries_date_idx on public.time_entries (date);
create index if not exists time_entries_invoice_id_idx on public.time_entries (invoice_id);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);
create index if not exists invoice_line_items_time_entry_id_idx on public.invoice_line_items (time_entry_id);
create index if not exists payments_invoice_id_idx on public.payments (invoice_id);
create index if not exists invoices_client_id_idx on public.invoices (client_id);

-- ----------------------------------------------------------------------------
-- 3. Auth helper functions (SECURITY DEFINER so RLS policies can call them
--    without recursing into the users table's own policies)
-- ----------------------------------------------------------------------------
create or replace function public.current_app_user_id()
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select id from public.users where auth_user_id = auth.uid() limit 1;
$fn$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid() and status = 'active' and is_active
  );
$fn$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role in ('admin', 'partner') and status = 'active' and is_active
  );
$fn$;

create or replace function public.is_partner()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and role = 'partner' and status = 'active' and is_active
  );
$fn$;

-- Raises unless the caller is an active admin/partner. Sessions with no JWT
-- (SQL editor, pg_cron, psql) are trusted — they already bypass RLS.
create or replace function public.assert_admin()
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if v_claims is null or v_claims = '' then
    return; -- direct database session (owner)
  end if;
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 4. Supabase Auth integration: signup handling + admin approval
-- ----------------------------------------------------------------------------
-- On signup:
--   1. If an app user already has this email (and no auth link), link it.
--   2. Else if nobody can log in yet (fresh install or just-migrated data),
--      the first signup becomes an active partner (bootstrap owner).
--   3. Else create a 'pending' basic user awaiting admin approval.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_bootstrap boolean;
begin
  perform pg_advisory_xact_lock(hashtext('ctt_user_bootstrap'));

  update public.users
     set auth_user_id = new.id,
         email = new.email,
         status = 'active',
         updated_at = now()
   where auth_user_id is null
     and email is not null
     and lower(email) = lower(new.email);
  if found then
    return new;
  end if;

  select not exists (select 1 from public.users where auth_user_id is not null)
    into v_bootstrap;

  insert into public.users (username, display_name, role, is_active, auth_user_id, email, status)
  values (
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)),
    case when v_bootstrap then 'partner'::user_role else 'basic'::user_role end,
    true,
    new.id,
    new.email,
    case when v_bootstrap then 'active' else 'pending' end
  )
  on conflict (username) do update
    set auth_user_id = excluded.auth_user_id,
        email = excluded.email,
        updated_at = now();

  return new;
end
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Admin approves a pending signup: assign role/status, or link the new auth
-- account onto an existing (historical) user row and remove the stub.
create or replace function public.approve_user(
  p_user_id uuid,
  p_role user_role default null,
  p_status text default 'active',
  p_link_to uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_stub public.users%rowtype;
  v_target public.users%rowtype;
begin
  perform public.assert_admin();

  select * into v_stub from public.users where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if p_link_to is not null then
    if p_link_to = p_user_id then
      raise exception 'Cannot link a user to itself';
    end if;
    if v_stub.auth_user_id is null then
      raise exception 'User has no auth account to transfer';
    end if;

    select * into v_target from public.users where id = p_link_to;
    if not found then
      raise exception 'Link target user not found';
    end if;
    if (v_target.role = 'partner' or coalesce(p_role, v_target.role) = 'partner')
       and not public.is_partner()
       and current_setting('request.jwt.claims', true) is not null then
      raise exception 'Only partners can manage partner users';
    end if;

    -- reassign any audit history before removing the stub (same human)
    update public.audit_log set user_id = p_link_to where user_id = p_user_id;
    delete from public.users where id = p_user_id;

    update public.users
       set auth_user_id = v_stub.auth_user_id,
           email = coalesce(email, v_stub.email),
           role = coalesce(p_role, role),
           status = 'active',
           updated_at = now()
     where id = p_link_to
     returning * into v_target;

    return to_jsonb(v_target) - 'password_hash';
  end if;

  if (v_stub.role = 'partner' or coalesce(p_role, v_stub.role) = 'partner')
     and not public.is_partner()
     and current_setting('request.jwt.claims', true) is not null then
    raise exception 'Only partners can manage partner users';
  end if;

  update public.users
     set role = coalesce(p_role, role),
         status = coalesce(p_status, status),
         updated_at = now()
   where id = p_user_id
   returning * into v_stub;

  return to_jsonb(v_stub) - 'password_hash';
end
$fn$;

-- ----------------------------------------------------------------------------
-- 5. Column-guard triggers (field-level rules RLS cannot express)
-- ----------------------------------------------------------------------------
-- users: non-admins may only edit their own cosmetic fields; only partners
-- may touch partner-role users (mirrors legacy users route).
create or replace function public.guard_users_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return coalesce(new, old); -- trusted server-side session (auth hook, cron, SQL editor)
  end if;

  if tg_op = 'DELETE' then
    if old.role = 'partner' and not public.is_partner() then
      raise exception 'Only partners can manage partner users';
    end if;
    return old;
  end if;

  if public.is_admin() then
    if (tg_op = 'UPDATE' and old.role = 'partner' or new.role = 'partner')
       and not public.is_partner() then
      raise exception 'Only partners can manage partner users';
    end if;
    return new;
  end if;

  -- self-service update: revert protected fields
  if tg_op = 'UPDATE' then
    new.role := old.role;
    new.status := old.status;
    new.is_active := old.is_active;
    new.auth_user_id := old.auth_user_id;
    new.username := old.username;
    new.password_hash := old.password_hash;
  end if;
  return new;
end
$fn$;

drop trigger if exists users_guard on public.users;
create trigger users_guard
  before update or delete on public.users
  for each row execute function public.guard_users_change();

-- time_entries: basic users cannot set billing status or reassign the tech
-- (silently ignored, matching the legacy server behavior).
create or replace function public.guard_time_entries_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.tech_id := coalesce(public.current_app_user_id(), new.tech_id);
    new.is_billed := false;
    new.is_paid := false;
    new.invoice_id := null;
  else
    new.tech_id := old.tech_id;
    new.is_billed := old.is_billed;
    new.is_paid := old.is_paid;
    new.invoice_id := old.invoice_id;
  end if;
  return new;
end
$fn$;

drop trigger if exists time_entries_guard on public.time_entries;
create trigger time_entries_guard
  before insert or update on public.time_entries
  for each row execute function public.guard_time_entries_change();

-- Deleting a time entry linked to a DRAFT invoice also removes its line item
-- (legacy delete-entry behavior).
create or replace function public.cleanup_draft_line_items()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  delete from public.invoice_line_items li
   using public.invoices i
   where li.time_entry_id = old.id
     and i.id = li.invoice_id
     and i.status = 'draft';
  return old;
end
$fn$;

drop trigger if exists time_entries_draft_cleanup on public.time_entries;
create trigger time_entries_draft_cleanup
  before delete on public.time_entries
  for each row execute function public.cleanup_draft_line_items();

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

do $do$
declare
  t text;
begin
  foreach t in array array['users','clients','projects','client_chat_logs','invoices','time_entries','invoice_payout_flags','app_settings']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end
$do$;

-- ----------------------------------------------------------------------------
-- 6. Audit triggers (replace the legacy HTTP audit middleware)
-- ----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'password_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'password_hash';
  end if;
  begin
    v_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
  exception when others then
    v_id := null;
  end;

  insert into public.audit_log (user_id, action, table_name, record_id, old_values, new_values)
  values (public.current_app_user_id(), lower(tg_op), tg_table_name, v_id, v_old::text, v_new::text);

  return coalesce(new, old);
end
$fn$;

do $do$
declare
  t text;
begin
  foreach t in array array['users','clients','job_types','rate_tiers','time_entries','invoices',
    'invoice_line_items','payments','partner_splits','partner_payments','projects',
    'client_chat_logs','invoice_payout_flags','app_settings']
  loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end
$do$;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------
do $do$
declare
  t text;
begin
  foreach t in array array['users','clients','job_types','rate_tiers','invoices','time_entries',
    'invoice_line_items','payments','partner_splits','partner_payments','audit_log',
    'auto_invoice_log','invoice_payout_flags','app_settings','projects','client_chat_logs','schema_meta']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$do$;

-- schema_meta: readable pre-login so the app can gate on version
drop policy if exists schema_meta_read on public.schema_meta;
create policy schema_meta_read on public.schema_meta
  for select using (true);

-- users
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select using (public.is_admin() or auth_user_id = auth.uid());
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert with check (public.is_admin());
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update using (public.is_admin() or auth_user_id = auth.uid())
  with check (public.is_admin() or auth_user_id = auth.uid());
drop policy if exists users_delete on public.users;
create policy users_delete on public.users
  for delete using (public.is_admin());

-- shared reference tables: full access for every active user (legacy parity)
do $do$
declare
  t text;
begin
  foreach t in array array['clients','job_types','rate_tiers','projects','client_chat_logs']
  loop
    execute format('drop policy if exists %I_rw on public.%I', t, t);
    execute format(
      'create policy %I_rw on public.%I for all using (public.is_active_user()) with check (public.is_active_user())',
      t, t);
  end loop;
end
$do$;

-- time entries: admins all; basic users only their own rows
drop policy if exists time_entries_rw on public.time_entries;
create policy time_entries_rw on public.time_entries
  for all
  using (public.is_admin() or (public.is_active_user() and tech_id = public.current_app_user_id()))
  with check (public.is_admin() or (public.is_active_user() and tech_id = public.current_app_user_id()));

-- admin-only tables
do $do$
declare
  t text;
begin
  foreach t in array array['invoices','invoice_line_items','payments','partner_splits',
    'partner_payments','invoice_payout_flags','auto_invoice_log']
  loop
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format(
      'create policy %I_admin on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t, t);
  end loop;
end
$do$;

-- basic users may see status of invoices linked to their own entries
drop policy if exists invoices_own_entries on public.invoices;
create policy invoices_own_entries on public.invoices
  for select using (
    public.is_active_user() and exists (
      select 1 from public.time_entries te
      where te.invoice_id = invoices.id
        and te.tech_id = public.current_app_user_id()
    )
  );

-- app settings: readable by active users, writable by admins
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select using (public.is_active_user());
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- audit log: admins read; rows are written by the SECURITY DEFINER trigger
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 8. Business RPCs — invoices
-- ----------------------------------------------------------------------------
-- Generate an invoice from unbilled entries. Serializes per client via
-- FOR UPDATE on the client row (fixes the legacy read-then-write race).
create or replace function public.generate_invoice(
  p_client_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_date_due date default null,
  p_notes text default null,
  p_is_auto boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_client public.clients%rowtype;
  v_prefix text;
  v_next int;
  v_max int;
  v_invoice public.invoices%rowtype;
  v_count int := 0;
  v_hours numeric := 0;
  v_amount numeric := 0;
  r record;
begin
  perform public.assert_admin();

  select * into v_client from public.clients where id = p_client_id for update;
  if not found then
    raise exception 'Client not found';
  end if;

  if not exists (
    select 1 from public.time_entries te
    where te.client_id = p_client_id and te.is_billed = false
      and (p_date_from is null or te.date >= p_date_from)
      and (p_date_to is null or te.date <= p_date_to)
  ) then
    return null; -- no unbilled entries
  end if;

  v_prefix := coalesce(v_client.invoice_prefix, upper(left(coalesce(v_client.name, 'INV'), 3)));
  v_next := coalesce(v_client.next_invoice_number::int, 1000);
  select coalesce(max((substring(invoice_number from '-(\d+)$'))::int), 0)
    into v_max
    from public.invoices
   where client_id = p_client_id and invoice_number ~ '-\d+$';
  v_next := greatest(v_next, v_max + 1);

  update public.clients
     set next_invoice_number = (v_next + 1)::numeric, updated_at = now()
   where id = p_client_id;

  insert into public.invoices (client_id, invoice_number, date_issued, date_due, status, notes, is_auto_generated)
  values (p_client_id, v_prefix || '-' || lpad(v_next::text, 4, '0'),
          current_date, p_date_due, 'draft', p_notes, p_is_auto)
  returning * into v_invoice;

  for r in
    select te.id, te.date, te.hours, te.notes,
           rt.amount as rate_amount,
           coalesce(u.display_name, u.username) as tech_name
      from public.time_entries te
      join public.rate_tiers rt on rt.id = te.rate_tier_id
      join public.users u on u.id = te.tech_id
     where te.client_id = p_client_id and te.is_billed = false
       and (p_date_from is null or te.date >= p_date_from)
       and (p_date_to is null or te.date <= p_date_to)
  loop
    insert into public.invoice_line_items (invoice_id, time_entry_id, description, hours, rate)
    values (
      v_invoice.id, r.id,
      case when coalesce(r.notes, '') <> ''
        then r.notes || ' (' || r.tech_name || ') (' || to_char(r.date, 'FMMM/FMDD') || ')'
        else '(' || r.tech_name || ') (' || to_char(r.date, 'FMMM/FMDD') || ')'
      end,
      r.hours, r.rate_amount
    );

    update public.time_entries
       set is_billed = true, invoice_id = v_invoice.id, updated_at = now()
     where id = r.id;

    v_count := v_count + 1;
    v_hours := v_hours + r.hours;
    v_amount := v_amount + r.hours * r.rate_amount;
  end loop;

  return jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'lineItemCount', v_count,
    'totalHours', v_hours,
    'totalAmount', v_amount
  );
end
$fn$;

-- Delete an invoice and unwind everything attached to it (legacy behavior).
create or replace function public.delete_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  perform public.assert_admin();

  update public.time_entries
     set is_billed = false, invoice_id = null, updated_at = now()
   where invoice_id = p_invoice_id;

  delete from public.invoice_line_items where invoice_id = p_invoice_id;
  delete from public.payments where invoice_id = p_invoice_id;
  delete from public.invoice_payout_flags where invoice_id = p_invoice_id;
  update public.auto_invoice_log set invoice_id = null where invoice_id = p_invoice_id;

  delete from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  return jsonb_build_object('success', true);
end
$fn$;

-- Mark an invoice paid, recording a payment for the outstanding remainder.
create or replace function public.mark_invoice_paid(p_invoice_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_invoice public.invoices%rowtype;
  v_total numeric;
  v_paid numeric;
begin
  perform public.assert_admin();

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status = 'paid' then
    raise exception 'Invoice is already paid';
  end if;

  select coalesce(sum(hours * rate), 0) into v_total
    from public.invoice_line_items where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.payments where invoice_id = p_invoice_id;

  if v_total - v_paid > 0 then
    insert into public.payments (invoice_id, amount, date_paid, method, notes)
    values (p_invoice_id, round(v_total - v_paid, 2), current_date, null,
            'Marked as paid from balance report');
  end if;

  update public.invoices set status = 'paid', updated_at = now() where id = p_invoice_id;

  return jsonb_build_object('success', true);
end
$fn$;

-- Toggle a partner's payout flag on an invoice.
create or replace function public.toggle_payout_flag(p_invoice_id uuid, p_partner_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_row public.invoice_payout_flags%rowtype;
begin
  perform public.assert_admin();

  insert into public.invoice_payout_flags (invoice_id, partner_id, is_paid)
  values (p_invoice_id, p_partner_id, true)
  on conflict (invoice_id, partner_id)
    do update set is_paid = not invoice_payout_flags.is_paid, updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end
$fn$;

-- Earnings split for one invoice (who earns what).
create or replace function public.invoice_split(p_invoice_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_holder uuid;
  v_ts numeric := coalesce((select value::numeric from public.app_settings where key = 'splitTechPercent'), 73) / 100;
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_splits jsonb;
  v_parts numeric;
begin
  perform public.assert_admin();

  select c.account_holder_id into v_holder
    from public.invoices i join public.clients c on c.id = i.client_id
   where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  with li as (
    select li.hours * li.rate as revenue, li.line_item_type, te.tech_id
      from public.invoice_line_items li
      left join public.time_entries te on te.id = li.time_entry_id
     where li.invoice_id = p_invoice_id
  ),
  shares as (
    select tech_id as partner_id,
           case when v_holder is null or tech_id = v_holder then revenue else revenue * v_ts end as amount
      from li where line_item_type <> 'part' and tech_id is not null
    union all
    select v_holder, revenue * v_hs
      from li where line_item_type <> 'part' and tech_id is not null
        and v_holder is not null and tech_id <> v_holder
    union all
    select v_holder, revenue
      from li where line_item_type <> 'part' and tech_id is null and v_holder is not null
  ),
  agg as (
    select s.partner_id, sum(s.amount) as amount
      from shares s group by s.partner_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'partnerId', a.partner_id,
           'partnerName', u.display_name,
           'role', case
             when a.partner_id = v_holder and exists (
               select 1 from public.invoice_line_items li2
               join public.time_entries te2 on te2.id = li2.time_entry_id
               where li2.invoice_id = p_invoice_id and te2.tech_id = v_holder
             ) then 'Tech & Holder'
             when a.partner_id = v_holder then 'Account Holder'
             else 'Tech'
           end,
           'amount', to_char(a.amount, 'FM999999999990.00'),
           'isPaidOut', coalesce(f.is_paid, false)
         )), '[]'::jsonb)
    into v_splits
    from agg a
    join public.users u on u.id = a.partner_id
    left join public.invoice_payout_flags f
      on f.invoice_id = p_invoice_id and f.partner_id = a.partner_id;

  select coalesce(sum(hours * rate), 0) into v_parts
    from public.invoice_line_items
   where invoice_id = p_invoice_id and line_item_type = 'part';

  return jsonb_build_object(
    'splits', v_splits,
    'splitConfig', jsonb_build_object('techPercent', v_ts * 100, 'holderPercent', v_hs * 100),
    'partsTotal', to_char(v_parts, 'FM999999999990.00')
  );
end
$fn$;

-- ----------------------------------------------------------------------------
-- 9. Auto-invoicing (ports the legacy hourly scheduler; runs under pg_cron)
-- ----------------------------------------------------------------------------
create or replace function public.compute_billing_period(
  p_cycle text,
  p_billing_day int,
  p_client_created timestamptz,
  p_ref date
)
returns table (date_from date, date_to date)
language plpgsql stable
as $fn$
declare
  v_days int;
  v_eff int;
  v_prev_month date;
  v_diff_weeks int;
begin
  if p_cycle = 'monthly' then
    v_days := extract(day from (date_trunc('month', p_ref) + interval '1 month - 1 day'))::int;
    v_eff := least(p_billing_day, v_days);
    if extract(day from p_ref)::int <> v_eff then return; end if;
    v_prev_month := (date_trunc('month', p_ref) - interval '1 month')::date;
    v_days := extract(day from (date_trunc('month', v_prev_month) + interval '1 month - 1 day'))::int;
    return query select (v_prev_month + least(p_billing_day, v_days) - 1)::date, p_ref - 1;
  elsif p_cycle = 'weekly' then
    if extract(isodow from p_ref)::int <> p_billing_day then return; end if;
    return query select p_ref - 7, p_ref - 1;
  elsif p_cycle = 'bi-weekly' then
    if extract(isodow from p_ref)::int <> p_billing_day then return; end if;
    v_diff_weeks := (p_ref - p_client_created::date) / 7;
    if v_diff_weeks % 2 <> 0 then return; end if;
    return query select p_ref - 14, p_ref - 1;
  elsif p_cycle = 'quarterly' then
    if extract(month from p_ref)::int not in (1, 4, 7, 10) then return; end if;
    v_days := extract(day from (date_trunc('month', p_ref) + interval '1 month - 1 day'))::int;
    v_eff := least(p_billing_day, v_days);
    if extract(day from p_ref)::int <> v_eff then return; end if;
    v_prev_month := (date_trunc('month', p_ref) - interval '3 months')::date;
    v_days := extract(day from (date_trunc('month', v_prev_month) + interval '1 month - 1 day'))::int;
    return query select (v_prev_month + least(p_billing_day, v_days) - 1)::date, p_ref - 1;
  end if;
  return;
end
$fn$;

create or replace function public.auto_invoice_check(p_reference_date date default current_date)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_min_hours numeric;
  v_client record;
  v_from date;
  v_to date;
  v_unbilled numeric;
  v_gen jsonb;
  v_generated int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_msg text;
begin
  perform public.assert_admin();

  v_min_hours := coalesce((select value::numeric from public.app_settings where key = 'autoInvoiceMinHours'), 0.5);

  for v_client in
    select * from public.clients where is_active and billing_cycle is not null
  loop
    begin
      select date_from, date_to into v_from, v_to
        from public.compute_billing_period(
          v_client.billing_cycle, coalesce(v_client.billing_day, 1)::int,
          v_client.created_at, p_reference_date);
      if not found then
        continue; -- not a billing day for this client
      end if;

      if exists (
        select 1 from public.auto_invoice_log
        where client_id = v_client.id and billing_period_start = v_from
          and billing_period_end = v_to and status = 'generated'
      ) then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object(
          'clientName', v_client.name, 'status', 'skipped_already_exists',
          'message', format('Invoice already generated for period %s to %s', v_from, v_to));
        continue;
      end if;

      select coalesce(sum(hours), 0) into v_unbilled
        from public.time_entries
       where client_id = v_client.id and is_billed = false
         and date >= v_from and date <= v_to;

      if v_unbilled < v_min_hours then
        v_skipped := v_skipped + 1;
        v_msg := format('%s hours (threshold: %s)', to_char(v_unbilled, 'FM999999990.00'), v_min_hours);
        v_results := v_results || jsonb_build_object(
          'clientName', v_client.name,
          'status', case when v_unbilled = 0 then 'skipped_no_entries' else 'skipped_below_threshold' end,
          'message', v_msg);
        insert into public.auto_invoice_log (client_id, billing_period_start, billing_period_end, status, message)
        values (v_client.id, v_from, v_to,
                case when v_unbilled = 0 then 'skipped_no_entries' else 'skipped_below_threshold' end, v_msg);
        continue;
      end if;

      v_gen := public.generate_invoice(v_client.id, v_from, v_to, null, null, true);

      if v_gen is null then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object(
          'clientName', v_client.name, 'status', 'skipped_no_entries',
          'message', 'No unbilled entries found');
        insert into public.auto_invoice_log (client_id, billing_period_start, billing_period_end, status, message)
        values (v_client.id, v_from, v_to, 'skipped_no_entries', 'No unbilled entries found');
        continue;
      end if;

      v_generated := v_generated + 1;
      v_msg := format('%s items, %s hours, $%s',
        v_gen->>'lineItemCount',
        to_char((v_gen->>'totalHours')::numeric, 'FM999999990.00'),
        to_char((v_gen->>'totalAmount')::numeric, 'FM999999990.00'));
      v_results := v_results || jsonb_build_object(
        'clientName', v_client.name, 'status', 'generated',
        'invoiceNumber', v_gen->'invoice'->>'invoice_number', 'message', v_msg);
      insert into public.auto_invoice_log (client_id, invoice_id, billing_period_start, billing_period_end, status, message)
      values (v_client.id, (v_gen->'invoice'->>'id')::uuid, v_from, v_to, 'generated', v_msg);

    exception when others then
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'clientName', v_client.name, 'status', 'error', 'message', sqlerrm);
      insert into public.auto_invoice_log (client_id, billing_period_start, billing_period_end, status, message)
      values (v_client.id, '1970-01-01', '1970-01-01', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('generated', v_generated, 'skipped', v_skipped, 'results', v_results);
end
$fn$;

-- Schedule hourly via pg_cron (no-op if pg_cron is unavailable)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ctt-auto-invoice';
    perform cron.schedule('ctt-auto-invoice', '7 * * * *', 'select public.auto_invoice_check();');
  end if;
end
$do$;

-- ----------------------------------------------------------------------------
-- 10. Report RPCs (mirror legacy /api/reports/* response shapes)
-- ----------------------------------------------------------------------------
create or replace function public.report_client_summary(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_out jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'clientId', c.id, 'clientName', c.name,
      'totalHours', sum(te.hours),
      'totalRevenue', sum(te.hours * rt.amount),
      'entryCount', count(*),
      'unbilledCount', count(*) filter (where not te.is_paid and not te.is_billed),
      'billedCount', count(*) filter (where not te.is_paid and te.is_billed),
      'paidCount', count(*) filter (where te.is_paid)
    ) as j
    from public.time_entries te
    join public.clients c on c.id = te.client_id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    where (p_date_from is null or te.date >= p_date_from)
      and (p_date_to is null or te.date <= p_date_to)
    group by c.id, c.name
  ) s;
  return v_out;
end
$fn$;

create or replace function public.report_tech_summary(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_out jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'techId', u.id, 'techName', u.display_name,
      'totalHours', sum(te.hours),
      'totalRevenue', sum(te.hours * rt.amount),
      'entryCount', count(*),
      'unbilledCount', count(*) filter (where not te.is_paid and not te.is_billed),
      'billedCount', count(*) filter (where not te.is_paid and te.is_billed),
      'paidCount', count(*) filter (where te.is_paid)
    ) as j
    from public.time_entries te
    join public.users u on u.id = te.tech_id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    where (p_date_from is null or te.date >= p_date_from)
      and (p_date_to is null or te.date <= p_date_to)
    group by u.id, u.display_name
  ) s;
  return v_out;
end
$fn$;

create or replace function public.report_balance(p_client_id uuid default null, p_filter text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_out jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(j order by d desc), '[]'::jsonb) into v_out from (
    select te.date as d, jsonb_build_object(
      'id', te.id,
      'date', to_char(te.date, 'YYYY-MM-DD'),
      'clientId', te.client_id,
      'clientName', cl.name,
      'techName', u.display_name,
      'jobTypeName', jt.name,
      'hours', te.hours,
      'rate', rt.amount,
      'total', to_char(te.hours * rt.amount, 'FM999999999990.00'),
      'notes', te.notes,
      'isBilled', te.is_billed,
      'isPaid', te.is_paid,
      'invoiceId', te.invoice_id,
      'invoiceNumber', i.invoice_number,
      'invoiceStatus', i.status,
      'rateTierId', te.rate_tier_id,
      'jobTypeId', te.job_type_id
    ) as j
    from public.time_entries te
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    join public.users u on u.id = te.tech_id
    join public.job_types jt on jt.id = te.job_type_id
    join public.clients cl on cl.id = te.client_id
    left join public.invoices i on i.id = te.invoice_id
    where (p_client_id is null or te.client_id = p_client_id)
      and case p_filter
        when 'unbilled' then not te.is_paid and not te.is_billed
        when 'unpaid' then not te.is_paid and te.is_billed
          and (i.status is null or i.status not in ('paid', 'void'))
        when 'paid' then te.is_paid
        else not te.is_paid and (
          not te.is_billed
          or (te.is_billed and (i.status is null or i.status not in ('paid', 'void')))
        )
      end
  ) s;
  return v_out;
end
$fn$;

create or replace function public.report_partner_settlement(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_ts numeric := coalesce((select value::numeric from public.app_settings where key = 'splitTechPercent'), 73) / 100;
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_out jsonb;
begin
  perform public.assert_admin();
  with entries as (
    select te.tech_id, c.account_holder_id as holder_id, te.hours * rt.amount as revenue
      from public.time_entries te
      join public.clients c on c.id = te.client_id
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where te.is_paid
       and (p_date_from is null or te.date >= p_date_from)
       and (p_date_to is null or te.date <= p_date_to)
  ),
  partners as (
    select id, display_name from public.users
    where role in ('admin', 'partner') and is_active
  ),
  paid as (
    select to_partner_id, sum(amount) as total from public.partner_payments group by 1
  ),
  earn as (
    select p.id, p.display_name,
      coalesce(sum(case when e.tech_id = p.id then
        case when e.holder_id is null or e.tech_id = e.holder_id then e.revenue else e.revenue * v_ts end
      end), 0) as as_tech,
      coalesce(sum(case when e.holder_id = p.id and e.tech_id <> p.id then e.revenue * v_hs end), 0) as as_holder
    from partners p
    left join entries e on e.tech_id = p.id or e.holder_id = p.id
    group by p.id, p.display_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.display_name,
      'earnedAsTech', to_char(e.as_tech, 'FM999999999990.00'),
      'earnedAsHolder', to_char(e.as_holder, 'FM999999999990.00'),
      'totalEarned', to_char(e.as_tech + e.as_holder, 'FM999999999990.00'),
      'totalPaid', to_char(coalesce(pd.total, 0), 'FM999999999990.00'),
      'balance', to_char(e.as_tech + e.as_holder - coalesce(pd.total, 0), 'FM999999999990.00')
    )), '[]'::jsonb)
    into v_out
    from earn e left join paid pd on pd.to_partner_id = e.id;
  return v_out;
end
$fn$;

create or replace function public.report_aged_receivables()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_invoices jsonb;
  v_summary jsonb;
begin
  perform public.assert_admin();
  with invoice_totals as (
    select i.id, i.invoice_number, i.date_issued, i.client_id, cl.name as client_name,
           sum(li.hours * li.rate) as total_amount
      from public.invoices i
      join public.clients cl on cl.id = i.client_id
      join public.invoice_line_items li on li.invoice_id = i.id
     where i.status not in ('paid', 'void')
     group by i.id, i.invoice_number, i.date_issued, i.client_id, cl.name
  ),
  invoice_payments as (
    select invoice_id, sum(amount) as total_paid from public.payments group by invoice_id
  ),
  unpaid as (
    select it.*, coalesce(ip.total_paid, 0) as total_paid,
           it.total_amount - coalesce(ip.total_paid, 0) as balance,
           (current_date - it.date_issued) as days_old
      from invoice_totals it
      left join invoice_payments ip on ip.invoice_id = it.id
  ),
  bucketed as (
    select *, case
        when days_old <= 30 then 'current'
        when days_old <= 60 then '31-60'
        when days_old <= 90 then '61-90'
        else '90+'
      end as bucket
      from unpaid where balance > 0
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'invoiceNumber', invoice_number,
      'dateIssued', to_char(date_issued, 'YYYY-MM-DD'),
      'clientName', client_name,
      'balance', balance,
      'daysOld', days_old,
      'bucket', bucket
    ) order by days_old desc), '[]'::jsonb)
    into v_invoices
    from bucketed;

  with invoice_totals as (
    select i.id, i.date_issued, cl.name as client_name,
           sum(li.hours * li.rate) as total_amount
      from public.invoices i
      join public.clients cl on cl.id = i.client_id
      join public.invoice_line_items li on li.invoice_id = i.id
     where i.status not in ('paid', 'void')
     group by i.id, i.date_issued, cl.name
  ),
  invoice_payments as (
    select invoice_id, sum(amount) as total_paid from public.payments group by invoice_id
  ),
  bucketed as (
    select it.client_name,
           it.total_amount - coalesce(ip.total_paid, 0) as balance,
           (current_date - it.date_issued) as days_old
      from invoice_totals it
      left join invoice_payments ip on ip.invoice_id = it.id
     where it.total_amount - coalesce(ip.total_paid, 0) > 0
  )
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_summary from (
    select jsonb_build_object(
      'name', client_name,
      'current', to_char(coalesce(sum(balance) filter (where days_old <= 30), 0), 'FM999999999990.00'),
      'thirtyToSixty', to_char(coalesce(sum(balance) filter (where days_old > 30 and days_old <= 60), 0), 'FM999999999990.00'),
      'sixtyToNinety', to_char(coalesce(sum(balance) filter (where days_old > 60 and days_old <= 90), 0), 'FM999999999990.00'),
      'ninetyPlus', to_char(coalesce(sum(balance) filter (where days_old > 90), 0), 'FM999999999990.00'),
      'total', to_char(sum(balance), 'FM999999999990.00')
    ) as j
    from bucketed group by client_name
  ) s;

  return jsonb_build_object('invoices', v_invoices, 'summary', v_summary);
end
$fn$;

create or replace function public.report_wip()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_entries jsonb;
  v_summary jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', te.id,
      'date', to_char(te.date, 'YYYY-MM-DD'),
      'hours', te.hours,
      'clientId', te.client_id,
      'clientName', cl.name,
      'techName', u.display_name,
      'rate', rt.amount,
      'revenue', te.hours * rt.amount,
      'daysOld', (current_date - te.date)
    ) order by te.date asc), '[]'::jsonb)
    into v_entries
    from public.time_entries te
    join public.clients cl on cl.id = te.client_id
    join public.users u on u.id = te.tech_id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
   where te.is_billed = false and te.is_paid = false;

  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_summary from (
    select jsonb_build_object(
      'id', te.client_id,
      'name', cl.name,
      'totalHours', to_char(sum(te.hours), 'FM999999999990.00'),
      'totalRevenue', to_char(sum(te.hours * rt.amount), 'FM999999999990.00'),
      'staleHours', to_char(coalesce(sum(te.hours) filter (where current_date - te.date > 30), 0), 'FM999999999990.00'),
      'staleRevenue', to_char(coalesce(sum(te.hours * rt.amount) filter (where current_date - te.date > 30), 0), 'FM999999999990.00'),
      'oldestEntryDate', to_char(min(te.date), 'YYYY-MM-DD')
    ) as j
    from public.time_entries te
    join public.clients cl on cl.id = te.client_id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    where te.is_billed = false and te.is_paid = false
    group by te.client_id, cl.name
  ) s;

  return jsonb_build_object('entries', v_entries, 'summary', v_summary);
end
$fn$;

create or replace function public.report_effective_rate(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_out jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(j order by rev desc), '[]'::jsonb) into v_out from (
    select sum(te.hours * rt.amount) as rev, jsonb_build_object(
      'clientId', cl.id,
      'clientName', cl.name,
      'totalHours', to_char(sum(te.hours), 'FM999999999990.00'),
      'totalRevenue', to_char(sum(te.hours * rt.amount), 'FM999999999990.00'),
      'effectiveRate', case when sum(te.hours) > 0
        then to_char(sum(te.hours * rt.amount) / sum(te.hours), 'FM999999999990.00')
        else '0.00' end
    ) as j
    from public.time_entries te
    join public.clients cl on cl.id = te.client_id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    where (p_date_from is null or te.date >= p_date_from)
      and (p_date_to is null or te.date <= p_date_to)
    group by cl.id, cl.name
  ) s;
  return v_out;
end
$fn$;

create or replace function public.report_tech_utilization(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_out jsonb;
begin
  perform public.assert_admin();
  select coalesce(jsonb_agg(j order by rev desc), '[]'::jsonb) into v_out from (
    select sum(te.hours * rt.amount) as rev, jsonb_build_object(
      'techId', u.id,
      'techName', u.display_name,
      'totalHours', to_char(sum(te.hours), 'FM999999999990.00'),
      'billableHours', to_char(coalesce(sum(te.hours) filter (where rt.amount > 0), 0), 'FM999999999990.00'),
      'utilization', case when sum(te.hours) > 0
        then to_char(coalesce(sum(te.hours) filter (where rt.amount > 0), 0) / sum(te.hours) * 100, 'FM999999999990.0')
        else '0.00' end,
      'totalRevenue', to_char(sum(te.hours * rt.amount), 'FM999999999990.00'),
      'firmYield', to_char(sum(te.hours * rt.amount) * v_hs, 'FM999999999990.00')
    ) as j
    from public.users u
    join public.time_entries te on te.tech_id = u.id
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    where (p_date_from is null or te.date >= p_date_from)
      and (p_date_to is null or te.date <= p_date_to)
    group by u.id, u.display_name
  ) s;
  return v_out;
end
$fn$;

create or replace function public.report_annual_revenue(p_year int default extract(year from current_date)::int)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_clients jsonb;
  v_totals jsonb;
begin
  perform public.assert_admin();
  with base as (
    select cl.id as client_id, cl.name as client_name,
           te.hours, te.hours * rt.amount as revenue,
           te.is_billed, te.is_paid,
           extract(quarter from te.date)::int as q
      from public.time_entries te
      join public.clients cl on cl.id = te.client_id
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where te.date >= make_date(p_year, 1, 1) and te.date <= make_date(p_year, 12, 31)
  ),
  per_client as (
    select client_id, client_name,
           sum(hours) as total_hours,
           sum(revenue) as total_revenue,
           coalesce(sum(revenue) filter (where is_billed), 0) as billed,
           coalesce(sum(revenue) filter (where is_paid), 0) as collected,
           coalesce(sum(revenue) filter (where q = 1), 0) as q1,
           coalesce(sum(revenue) filter (where q = 2), 0) as q2,
           coalesce(sum(revenue) filter (where q = 3), 0) as q3,
           coalesce(sum(revenue) filter (where q = 4), 0) as q4
      from base group by client_id, client_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'clientId', client_id, 'clientName', client_name,
      'totalHours', to_char(total_hours, 'FM999999999990.00'),
      'totalRevenue', to_char(total_revenue, 'FM999999999990.00'),
      'billedRevenue', to_char(billed, 'FM999999999990.00'),
      'collectedRevenue', to_char(collected, 'FM999999999990.00'),
      'outstandingRevenue', to_char(total_revenue - collected, 'FM999999999990.00'),
      'q1', to_char(q1, 'FM999999999990.00'),
      'q2', to_char(q2, 'FM999999999990.00'),
      'q3', to_char(q3, 'FM999999999990.00'),
      'q4', to_char(q4, 'FM999999999990.00')
    ) order by total_revenue desc), '[]'::jsonb)
    into v_clients
    from per_client;

  with base as (
    select te.hours, te.hours * rt.amount as revenue, te.is_billed, te.is_paid,
           extract(quarter from te.date)::int as q
      from public.time_entries te
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where te.date >= make_date(p_year, 1, 1) and te.date <= make_date(p_year, 12, 31)
  )
  select jsonb_build_object(
      'totalHours', to_char(coalesce(sum(hours), 0), 'FM999999999990.00'),
      'totalRevenue', to_char(coalesce(sum(revenue), 0), 'FM999999999990.00'),
      'billedRevenue', to_char(coalesce(sum(revenue) filter (where is_billed), 0), 'FM999999999990.00'),
      'collectedRevenue', to_char(coalesce(sum(revenue) filter (where is_paid), 0), 'FM999999999990.00'),
      'outstandingRevenue', to_char(coalesce(sum(revenue), 0) - coalesce(sum(revenue) filter (where is_paid), 0), 'FM999999999990.00'),
      'q1', to_char(coalesce(sum(revenue) filter (where q = 1), 0), 'FM999999999990.00'),
      'q2', to_char(coalesce(sum(revenue) filter (where q = 2), 0), 'FM999999999990.00'),
      'q3', to_char(coalesce(sum(revenue) filter (where q = 3), 0), 'FM999999999990.00'),
      'q4', to_char(coalesce(sum(revenue) filter (where q = 4), 0), 'FM999999999990.00')
    )
    into v_totals
    from base;

  return jsonb_build_object('year', p_year::text, 'clients', v_clients, 'totals', v_totals);
end
$fn$;

create or replace function public.report_partner_earnings(p_year int default extract(year from current_date)::int)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_ts numeric := coalesce((select value::numeric from public.app_settings where key = 'splitTechPercent'), 73) / 100;
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_partners jsonb;
begin
  perform public.assert_admin();
  with entries as (
    select te.tech_id, c.account_holder_id as holder_id, te.hours * rt.amount as revenue
      from public.time_entries te
      join public.clients c on c.id = te.client_id
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where te.is_paid
       and te.date >= make_date(p_year, 1, 1) and te.date <= make_date(p_year, 12, 31)
  ),
  partners as (
    select id, display_name from public.users
    where role in ('admin', 'partner') and is_active
  ),
  paid as (
    select to_partner_id, sum(amount) as total
      from public.partner_payments
     where date_paid >= make_date(p_year, 1, 1) and date_paid <= make_date(p_year, 12, 31)
     group by 1
  ),
  earn as (
    select p.id, p.display_name,
      coalesce(sum(case when e.tech_id = p.id then
        case when e.holder_id is null or e.tech_id = e.holder_id then e.revenue else e.revenue * v_ts end
      end), 0) as as_tech,
      coalesce(sum(case when e.holder_id = p.id and e.tech_id <> p.id then e.revenue * v_hs end), 0) as as_holder
    from partners p
    left join entries e on e.tech_id = p.id or e.holder_id = p.id
    group by p.id, p.display_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.display_name,
      'earnedAsTech', to_char(e.as_tech, 'FM999999999990.00'),
      'earnedAsHolder', to_char(e.as_holder, 'FM999999999990.00'),
      'totalEarned', to_char(e.as_tech + e.as_holder, 'FM999999999990.00'),
      'totalPaid', to_char(coalesce(pd.total, 0), 'FM999999999990.00'),
      'balance', to_char(e.as_tech + e.as_holder - coalesce(pd.total, 0), 'FM999999999990.00')
    )), '[]'::jsonb)
    into v_partners
    from earn e left join paid pd on pd.to_partner_id = e.id;

  return jsonb_build_object(
    'year', p_year::text,
    'partners', v_partners,
    'splitConfig', jsonb_build_object('techPercent', v_ts * 100, 'holderPercent', v_hs * 100)
  );
end
$fn$;

create or replace function public.report_payments_ledger(p_year int default extract(year from current_date)::int)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_clients jsonb;
  v_grand numeric;
begin
  perform public.assert_admin();
  with pays as (
    select p.id, p.amount, p.date_paid, p.method, p.notes,
           i.invoice_number, cl.id as client_id, cl.name as client_name,
           extract(month from p.date_paid)::int as m
      from public.payments p
      join public.invoices i on i.id = p.invoice_id
      join public.clients cl on cl.id = i.client_id
     where p.date_paid >= make_date(p_year, 1, 1) and p.date_paid <= make_date(p_year, 12, 31)
  ),
  months as (
    select client_id, client_name, m,
           sum(amount) as subtotal,
           jsonb_agg(jsonb_build_object(
             'id', id,
             'datePaid', to_char(date_paid, 'YYYY-MM-DD'),
             'invoiceNumber', invoice_number,
             'amount', to_char(amount, 'FM999999999990.00'),
             'method', method,
             'notes', notes
           ) order by date_paid) as payments
      from pays group by client_id, client_name, m
  ),
  per_client as (
    select client_id, client_name,
           sum(subtotal) as client_total,
           jsonb_agg(jsonb_build_object(
             'month', m,
             'monthName', to_char(make_date(2000, m, 1), 'FMMonth'),
             'subtotal', to_char(subtotal, 'FM999999999990.00'),
             'payments', payments
           ) order by m) as months
      from months group by client_id, client_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clientId', client_id,
           'clientName', client_name,
           'clientTotal', to_char(client_total, 'FM999999999990.00'),
           'months', months
         ) order by client_name), '[]'::jsonb),
         coalesce(sum(client_total), 0)
    into v_clients, v_grand
    from per_client;

  return jsonb_build_object(
    'year', p_year::text,
    'clients', v_clients,
    'grandTotal', to_char(v_grand, 'FM999999999990.00')
  );
end
$fn$;

create or replace function public.report_partner_breakdown(
  p_date_from date default null,
  p_date_to date default null,
  p_client_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_ts numeric := coalesce((select value::numeric from public.app_settings where key = 'splitTechPercent'), 73) / 100;
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_out jsonb;
begin
  perform public.assert_admin();
  with entries as (
    select te.tech_id, c.account_holder_id as holder_id,
           te.hours * rt.amount as revenue, te.hours, te.is_paid,
           (c.account_holder_id is null or te.tech_id = c.account_holder_id) as is_sole
      from public.time_entries te
      join public.clients c on c.id = te.client_id
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where (te.is_billed or te.is_paid)
       and (p_date_from is null or te.date >= p_date_from)
       and (p_date_to is null or te.date <= p_date_to)
       and (p_client_id is null or te.client_id = p_client_id)
  ),
  partners as (
    select id, display_name from public.users
    where role in ('admin', 'partner') and is_active
  ),
  payouts as (
    select to_partner_id, sum(amount) as total from public.partner_payments group by 1
  ),
  calc as (
    select p.id, p.display_name,
      coalesce(sum(case when e.tech_id = p.id and e.is_paid then
        case when e.is_sole then e.revenue else e.revenue * v_ts end end), 0) as paid_tech,
      coalesce(sum(case when e.tech_id = p.id and not e.is_paid then
        case when e.is_sole then e.revenue else e.revenue * v_ts end end), 0) as unpaid_tech,
      coalesce(sum(case when e.holder_id = p.id and not e.is_sole and e.is_paid then e.revenue * v_hs end), 0) as paid_holder,
      coalesce(sum(case when e.holder_id = p.id and not e.is_sole and not e.is_paid then e.revenue * v_hs end), 0) as unpaid_holder,
      coalesce(sum(case when e.tech_id = p.id and e.is_paid then e.hours end), 0) as paid_hours,
      coalesce(sum(case when e.tech_id = p.id and not e.is_paid then e.hours end), 0) as unpaid_hours
    from partners p
    left join entries e on e.tech_id = p.id or e.holder_id = p.id
    group by p.id, p.display_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.display_name,
      'paidEarnedAsTech', to_char(c.paid_tech, 'FM999999999990.00'),
      'paidEarnedAsHolder', to_char(c.paid_holder, 'FM999999999990.00'),
      'paidTotal', to_char(c.paid_tech + c.paid_holder, 'FM999999999990.00'),
      'unpaidEarnedAsTech', to_char(c.unpaid_tech, 'FM999999999990.00'),
      'unpaidEarnedAsHolder', to_char(c.unpaid_holder, 'FM999999999990.00'),
      'unpaidTotal', to_char(c.unpaid_tech + c.unpaid_holder, 'FM999999999990.00'),
      'paidHours', to_char(c.paid_hours, 'FM999999999990.00'),
      'unpaidHours', to_char(c.unpaid_hours, 'FM999999999990.00'),
      'totalPaidOut', to_char(coalesce(po.total, 0), 'FM999999999990.00'),
      'balance', to_char(c.paid_tech + c.paid_holder - coalesce(po.total, 0), 'FM999999999990.00')
    ) order by c.display_name), '[]'::jsonb)
    into v_out
    from calc c left join payouts po on po.to_partner_id = c.id;
  return v_out;
end
$fn$;

-- /api/partner/summary equivalent (partner-role users only, JS-number output)
create or replace function public.partner_summary(p_date_from date default null, p_date_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare
  v_ts numeric := coalesce((select value::numeric from public.app_settings where key = 'splitTechPercent'), 73) / 100;
  v_hs numeric := coalesce((select value::numeric from public.app_settings where key = 'splitHolderPercent'), 27) / 100;
  v_total numeric;
  v_partners jsonb;
begin
  perform public.assert_admin();

  select coalesce(sum(te.hours * rt.amount), 0) into v_total
    from public.time_entries te
    join public.rate_tiers rt on rt.id = te.rate_tier_id
   where te.is_paid
     and (p_date_from is null or te.date >= p_date_from)
     and (p_date_to is null or te.date <= p_date_to);

  with entries as (
    select te.tech_id, c.account_holder_id as holder_id, te.hours * rt.amount as revenue
      from public.time_entries te
      join public.clients c on c.id = te.client_id
      join public.rate_tiers rt on rt.id = te.rate_tier_id
     where te.is_paid
       and (p_date_from is null or te.date >= p_date_from)
       and (p_date_to is null or te.date <= p_date_to)
  ),
  partners as (
    select id, display_name from public.users where role = 'partner'
  ),
  settle as (
    select * from public.partner_payments
     where (p_date_from is null or date_paid >= p_date_from)
       and (p_date_to is null or date_paid <= p_date_to)
  ),
  earn as (
    select p.id, p.display_name,
      coalesce(sum(case
        when e.tech_id = p.id and (e.holder_id is null or e.holder_id = e.tech_id) then e.revenue
        when e.tech_id = p.id then e.revenue * v_ts
      end), 0)
      + coalesce(sum(case
          when e.holder_id = p.id and e.holder_id <> e.tech_id then e.revenue * v_hs
        end), 0) as expected
    from partners p
    left join entries e on e.tech_id = p.id or e.holder_id = p.id
    group by p.id, p.display_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'partnerId', e.id,
      'partnerName', e.display_name,
      'splitPercent', case when v_total > 0 then e.expected / v_total else 0 end,
      'expectedShare', e.expected,
      'paidOut', coalesce((select sum(amount) from settle where to_partner_id = e.id), 0),
      'paidIn', coalesce((select sum(amount) from settle where from_partner_id = e.id), 0),
      'balance', e.expected
        - coalesce((select sum(amount) from settle where to_partner_id = e.id), 0)
        + coalesce((select sum(amount) from settle where from_partner_id = e.id), 0)
    )), '[]'::jsonb)
    into v_partners
    from earn e;

  return jsonb_build_object(
    'totalRevenue', v_total,
    'splitConfig', jsonb_build_object('techPercent', v_ts * 100, 'holderPercent', v_hs * 100),
    'period', jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to),
    'partners', v_partners
  );
end
$fn$;

-- Outstanding balances per client for the client list (any active user,
-- matching the legacy /api/clients list endpoint).
create or replace function public.client_balances()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
declare v_out jsonb;
begin
  if current_setting('request.jwt.claims', true) is not null
     and not public.is_active_user() then
    raise exception 'Not authorized';
  end if;
  select coalesce(jsonb_agg(j), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'clientId', te.client_id,
      'unbilledTotal', to_char(coalesce(sum(case when not te.is_billed then te.hours * rt.amount end), 0), 'FM999999999990.00'),
      'billedUnpaidTotal', to_char(coalesce(sum(case when te.is_billed and (i.status is null or i.status not in ('paid', 'void')) then te.hours * rt.amount end), 0), 'FM999999999990.00')
    ) as j
    from public.time_entries te
    join public.rate_tiers rt on rt.id = te.rate_tier_id
    left join public.invoices i on i.id = te.invoice_id
    where te.is_paid = false
    group by te.client_id
  ) s;
  return v_out;
end
$fn$;

-- ----------------------------------------------------------------------------
-- 11. Grants
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.schema_meta to anon;

-- ----------------------------------------------------------------------------
-- 12. Stamp schema version + reload PostgREST schema cache
-- ----------------------------------------------------------------------------
insert into public.schema_meta (version) values (1) on conflict (version) do nothing;

notify pgrst, 'reload schema';
