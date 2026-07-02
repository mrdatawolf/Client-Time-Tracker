-- ============================================================================
-- Client Time Tracker — legacy sync-engine cleanup
--
-- Run this after restoring a database dump taken from a Supabase project that
-- the legacy desktop/server app used as its sync target. It removes the
-- changelog table and per-table triggers the old sync engine installed.
-- Safe to run repeatedly, and a no-op on databases that never had sync.
-- ============================================================================

do $do$
declare
  r record;
begin
  for r in
    select t.tgname, c.relname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal
       and c.relnamespace = 'public'::regnamespace
       and t.tgname like 'remote_sync_track_%'
  loop
    execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
  end loop;
end
$do$;

drop function if exists public.remote_sync_changelog_trigger() cascade;
drop table if exists public.remote_sync_changelog;
