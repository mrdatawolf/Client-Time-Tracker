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
  await client.exec(`
    -- User role enum
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'basic');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role user_role NOT NULL DEFAULT 'basic',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Clients
    CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      account_holder TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Job Types
    CREATE TABLE IF NOT EXISTS job_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Rate Tiers
    CREATE TABLE IF NOT EXISTS rate_tiers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      amount NUMERIC(10, 2) NOT NULL,
      label TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Invoices
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id),
      invoice_number TEXT NOT NULL UNIQUE,
      date_issued DATE NOT NULL,
      date_due DATE,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Time Entries
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

    -- Invoice Line Items
    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      time_entry_id UUID REFERENCES time_entries(id),
      description TEXT NOT NULL,
      hours NUMERIC(6, 2) NOT NULL,
      rate NUMERIC(10, 2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Payments
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id),
      amount NUMERIC(10, 2) NOT NULL,
      date_paid DATE NOT NULL,
      method TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Partner Splits
    CREATE TABLE IF NOT EXISTS partner_splits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      partner_id UUID NOT NULL REFERENCES users(id),
      split_percent NUMERIC(5, 4) NOT NULL,
      effective_from DATE NOT NULL,
      effective_to DATE,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Partner Payments
    CREATE TABLE IF NOT EXISTS partner_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_partner_id UUID NOT NULL REFERENCES users(id),
      to_partner_id UUID NOT NULL REFERENCES users(id),
      amount NUMERIC(10, 2) NOT NULL,
      date_paid DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Audit Log
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

    -- App Settings
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
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
