import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../schema';
import * as relations from '../relations';

const allSchema = { ...schema, ...relations };

// Resolve DB path relative to monorepo root (this file is at packages/shared/src/db/local.ts)
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const MONOREPO_ROOT = path.resolve(__dirname_local, '..', '..', '..', '..');
const DEFAULT_DB_PATH = path.join(MONOREPO_ROOT, 'data', 'time-tracker');
const DB_PATH = process.env.PGLITE_DB_LOCATION || DEFAULT_DB_PATH;

// HMR-safe global state (prevents multiple PGlite instances in development)
declare global {
  var __pgliteClient: PGlite | null | undefined;
  var __localDbInstance: ReturnType<typeof drizzle<typeof allSchema>> | null | undefined;
  var __initializationPromise: Promise<ReturnType<typeof drizzle<typeof allSchema>>> | null | undefined;
  var __initializationError: Error | null | undefined;
}

const isDev = process.env.NODE_ENV !== 'production';

function getPgliteClient(): PGlite | null {
  return isDev ? (globalThis.__pgliteClient ?? null) : pgliteClient;
}
function setPgliteClient(client: PGlite | null): void {
  if (isDev) globalThis.__pgliteClient = client;
  else pgliteClient = client;
}
function getLocalDbInstanceInternal(): ReturnType<typeof drizzle<typeof allSchema>> | null {
  return isDev ? (globalThis.__localDbInstance ?? null) : localDbInstance;
}
function setLocalDbInstance(instance: ReturnType<typeof drizzle<typeof allSchema>> | null): void {
  if (isDev) globalThis.__localDbInstance = instance;
  else localDbInstance = instance;
}
function getInitPromise(): Promise<ReturnType<typeof drizzle<typeof allSchema>>> | null {
  return isDev ? (globalThis.__initializationPromise ?? null) : initializationPromise;
}
function setInitPromise(promise: Promise<ReturnType<typeof drizzle<typeof allSchema>>> | null): void {
  if (isDev) globalThis.__initializationPromise = promise;
  else initializationPromise = promise;
}
function getInitError(): Error | null {
  return isDev ? (globalThis.__initializationError ?? null) : initializationError;
}
function setInitError(error: Error | null): void {
  if (isDev) globalThis.__initializationError = error;
  else initializationError = error;
}

let pgliteClient: PGlite | null = null;
let localDbInstance: ReturnType<typeof drizzle<typeof allSchema>> | null = null;
let initializationPromise: Promise<ReturnType<typeof drizzle<typeof allSchema>>> | null = null;
let initializationError: Error | null = null;

function ensureDataDirectory(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function clearStaleLockFile(): boolean {
  const lockFilePath = path.join(DB_PATH, 'postmaster.pid');
  if (!fs.existsSync(lockFilePath)) return false;

  try {
    const content = fs.readFileSync(lockFilePath, 'utf-8');
    const lines = content.split('\n');
    const pidLine = lines[0]?.trim();

    if (pidLine === '-42') {
      fs.unlinkSync(lockFilePath);
      console.log(`Removed stale lock file: ${lockFilePath}`);
      return true;
    }

    const pid = parseInt(pidLine, 10);
    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        fs.unlinkSync(lockFilePath);
        console.log(`Removed stale lock file (process ${pid} not found): ${lockFilePath}`);
        return true;
      }
    }

    fs.unlinkSync(lockFilePath);
    return true;
  } catch {
    return false;
  }
}

async function initializeSchema(client: PGlite): Promise<void> {
  // 1. Create Enums and Extensions
  await client.exec(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('partner', 'admin', 'basic');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  // 2. Base Tables
  await client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role user_role NOT NULL DEFAULT 'basic',
      theme TEXT NOT NULL DEFAULT 'system',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      account_holder TEXT,
      account_holder_id UUID REFERENCES users(id),
      phone TEXT,
      mailing_address TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      default_hourly_rate NUMERIC(10, 2),
      invoice_payable_to TEXT,
      billing_cycle TEXT,
      billing_day NUMERIC(2, 0),
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_tiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      amount NUMERIC(10, 2) NOT NULL,
      label TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      invoice_number TEXT NOT NULL UNIQUE,
      date_issued DATE NOT NULL,
      date_due DATE,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      is_auto_generated BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      tech_id UUID NOT NULL REFERENCES users(id),
      job_type_id UUID NOT NULL REFERENCES job_types(id),
      rate_tier_id UUID NOT NULL REFERENCES rate_tiers(id),
      date DATE NOT NULL,
      hours NUMERIC(6, 2) NOT NULL,
      notes TEXT,
      group_id UUID,
      is_billed BOOLEAN NOT NULL DEFAULT false,
      is_paid BOOLEAN NOT NULL DEFAULT false,
      invoice_id UUID REFERENCES invoices(id),
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      time_entry_id UUID REFERENCES time_entries(id),
      description TEXT NOT NULL,
      hours NUMERIC(6, 2) NOT NULL,
      rate NUMERIC(10, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      amount NUMERIC(10, 2) NOT NULL,
      date_paid DATE NOT NULL,
      method TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS partner_splits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES users(id),
      split_percent NUMERIC(5, 4) NOT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS partner_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_partner_id UUID NOT NULL REFERENCES users(id),
      to_partner_id UUID NOT NULL REFERENCES users(id),
      amount NUMERIC(10, 2) NOT NULL,
      date_paid DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id UUID,
      old_values TEXT,
      new_values TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      assigned_to TEXT,
      note TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_chat_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id) UNIQUE,
      content TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_invoice_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      invoice_id UUID REFERENCES invoices(id),
      billing_period_start DATE NOT NULL,
      billing_period_end DATE NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_changelog (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      synced BOOLEAN DEFAULT false NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sync_changelog_unsynced
      ON sync_changelog (synced) WHERE synced = false;
  `);

  // 3. Sequential Migrations (for existing databases)
  await client.exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';
    
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_hourly_rate NUMERIC(10, 2);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS mailing_address TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_holder_id UUID REFERENCES users(id);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS invoice_payable_to TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_day NUMERIC(2, 0);

    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT false;
  `);

  // 4. Triggers and Functions
  await client.exec(`
    CREATE OR REPLACE FUNCTION sync_changelog_trigger() RETURNS trigger AS $$
    BEGIN
      IF current_setting('app.syncing', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;

      IF TG_OP = 'DELETE' THEN
        INSERT INTO sync_changelog (table_name, record_id, operation)
        VALUES (TG_TABLE_NAME, OLD.id::text, 'DELETE');
        RETURN OLD;
      ELSE
        INSERT INTO sync_changelog (table_name, record_id, operation)
        VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP);
        RETURN NEW;
      END IF;
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    DECLARE
      t text;
      tables text[] := ARRAY[
        'users', 'clients', 'job_types', 'rate_tiers', 'invoices', 
        'time_entries', 'invoice_line_items', 'payments', 
        'partner_splits', 'partner_payments', 'projects', 
        'client_chat_logs', 'auto_invoice_log'
      ];
    BEGIN
      FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_track_' || t, t);
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sync_changelog_trigger()', 'sync_track_' || t, t);
      END LOOP;
    END $$;
  `);

  // 5. Data Migrations & Seeding
  try {
    await client.exec("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner'");
  } catch {}

  await client.exec(`
    UPDATE users SET role = 'partner'
    WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'partner');

    UPDATE clients SET account_holder_id = u.id
    FROM users u
    WHERE clients.account_holder = u.display_name
      AND clients.account_holder_id IS NULL;

    INSERT INTO app_settings (key, value) VALUES ('splitTechPercent', '73') ON CONFLICT (key) DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('splitHolderPercent', '27') ON CONFLICT (key) DO NOTHING;
    INSERT INTO app_settings (key, value) VALUES ('autoInvoiceMinHours', '0.5') ON CONFLICT (key) DO NOTHING;
  `);

  // One-time data cleanup
  const migrationCheck = await client.query("SELECT value FROM app_settings WHERE key = 'migration_pre2026_paid'");
  if (migrationCheck.rows.length === 0) {
    await client.exec(`
      UPDATE time_entries SET is_billed = true, is_paid = true, updated_at = NOW() WHERE date < '2026-01-01' AND (is_paid = false OR is_billed = false);
      UPDATE invoices SET status = 'paid', updated_at = NOW()
        WHERE status NOT IN ('paid', 'void')
        AND id IN (SELECT DISTINCT invoice_id FROM time_entries WHERE invoice_id IS NOT NULL AND date < '2026-01-01');
      INSERT INTO app_settings (key, value) VALUES ('migration_pre2026_paid', 'done') ON CONFLICT (key) DO NOTHING;
    `);
  }
}

async function initializeLocalDb(): Promise<ReturnType<typeof drizzle<typeof allSchema>>> {
  ensureDataDirectory();
  clearStaleLockFile();

  let client: PGlite;
  try {
    client = new PGlite(DB_PATH);
    await client.waitReady;
    setPgliteClient(client);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullError = new Error(
      `PGlite database initialization failed.\n` +
      `Database location: ${DB_PATH}\n` +
      `Original error: ${errorMessage}`
    );
    setInitError(fullError);
    setPgliteClient(null);
    throw fullError;
  }

  const db = drizzle(client, { schema: allSchema });

  try {
    // Reset session state in case a previous sync cycle failed mid-run
    await client.query(`SET app.syncing = 'false'`);
    await initializeSchema(client);
  } catch (schemaError) {
    const errorMessage = schemaError instanceof Error ? schemaError.message : String(schemaError);
    const fullError = new Error(
      `Database schema initialization failed.\n` +
      `Original error: ${errorMessage}`
    );
    setInitError(fullError);
    await client.close();
    setPgliteClient(null);
    throw fullError;
  }

  setLocalDbInstance(db);
  setInitError(null);
  return db;
}

export async function getLocalDb() {
  const existingDb = getLocalDbInstanceInternal();
  if (existingDb) return existingDb;

  const existingError = getInitError();
  if (existingError) throw existingError;

  const existingPromise = getInitPromise();
  if (existingPromise) return existingPromise;

  const newPromise = initializeLocalDb();
  setInitPromise(newPromise);

  try {
    return await newPromise;
  } catch (error) {
    setInitPromise(null);
    throw error;
  }
}

export async function closeLocalDb(): Promise<void> {
  const client = getPgliteClient();
  if (client) {
    await client.close();
    setPgliteClient(null);
    setLocalDbInstance(null);
    setInitPromise(null);
  }
}

export function getDbInitError(): Error | null {
  return getInitError();
}

export function getDbPath(): string {
  return DB_PATH;
}

export function resetDbError(): void {
  setInitError(null);
  setInitPromise(null);
  setLocalDbInstance(null);
  setPgliteClient(null);
  clearStaleLockFile();
}

export function isDbInitialized(): boolean {
  return getLocalDbInstanceInternal() !== null && getInitError() === null;
}

export { allSchema as schema };
