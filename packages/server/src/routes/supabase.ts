import { Hono } from 'hono';
import dns from 'dns/promises';
import crypto from 'crypto';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';
import {
  loadSupabaseConfig,
  saveSupabaseConfig,
  maskKey,
  type SupabaseConfig,
} from '@ctt/shared/db/supabase-config';

/**
 * Resolve hostname in a PostgreSQL connection string to an IP address.
 * Tries IPv4 first, falls back to IPv6 (Supabase uses IPv6-only hosts).
 */
async function resolveConnectionString(connStr: string): Promise<string> {
  try {
    const url = new URL(connStr);
    const hostname = url.hostname;
    try {
      const { address } = await dns.lookup(hostname, { family: 4 });
      url.hostname = address;
      return url.toString();
    } catch {
      const { address } = await dns.lookup(hostname, { family: 6 });
      url.hostname = `[${address}]`;
      return url.toString();
    }
  } catch {
    return connStr;
  }
}

const app = new Hono<AppEnv>();

// Get Supabase config (keys masked for display)
app.get('/config', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();

  if (!config) {
    return c.json({
      enabled: false,
      supabaseUrl: '',
      supabaseAnonKey: '',
      supabaseServiceKey: '',
      databaseUrl: '',
      lastSyncAt: null,
      instanceId: '',
    });
  }

  return c.json({
    ...config,
    supabaseAnonKey: maskKey(config.supabaseAnonKey),
    supabaseServiceKey: maskKey(config.supabaseServiceKey),
    databaseUrl: config.databaseUrl ? maskKey(config.databaseUrl) : '',
  });
});

// Update Supabase config
app.put('/config', requireAdmin(), async (c) => {
  const body = await c.req.json() as Partial<SupabaseConfig>;

  // Don't allow overwriting keys with masked values
  const current = loadSupabaseConfig();
  if (current) {
    if (body.supabaseAnonKey && body.supabaseAnonKey.includes('...')) {
      delete body.supabaseAnonKey;
    }
    if (body.supabaseServiceKey && body.supabaseServiceKey.includes('...')) {
      delete body.supabaseServiceKey;
    }
    if (body.databaseUrl && body.databaseUrl.includes('...')) {
      delete body.databaseUrl;
    }
  }

  // Don't allow setting lastSyncAt from the client
  delete body.lastSyncAt;

  const saved = saveSupabaseConfig(body);
  return c.json({ success: true, instanceId: saved.instanceId });
});

// Built-in encryption key (obfuscation, not high-security)
const CONFIG_CIPHER_KEY = crypto.createHash('sha256').update('ctt-supabase-config-export-2024').digest();
const CONFIG_IV_LENGTH = 16;

// Export config as encrypted string
app.post('/config/export', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();
  if (!config?.databaseUrl) {
    return c.json({ error: 'No Supabase config to export' }, 400);
  }

  const payload = JSON.stringify({
    supabaseUrl: config.supabaseUrl,
    databaseUrl: config.databaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    supabaseServiceKey: config.supabaseServiceKey,
  });

  const iv = crypto.randomBytes(CONFIG_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', CONFIG_CIPHER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const exportString = 'CTT:' + Buffer.concat([iv, encrypted]).toString('base64');

  return c.json({ exportString });
});

// Import config from encrypted string
app.post('/config/import', requireAdmin(), async (c) => {
  const { exportString } = await c.req.json() as { exportString: string };

  if (!exportString || !exportString.startsWith('CTT:')) {
    return c.json({ error: 'Invalid config string. Must start with CTT:' }, 400);
  }

  try {
    const data = Buffer.from(exportString.slice(4), 'base64');
    const iv = data.subarray(0, CONFIG_IV_LENGTH);
    const encrypted = data.subarray(CONFIG_IV_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-cbc', CONFIG_CIPHER_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted);

    if (!parsed.databaseUrl) {
      return c.json({ error: 'Invalid config: missing database URL' }, 400);
    }

    return c.json({
      supabaseUrl: parsed.supabaseUrl || '',
      databaseUrl: parsed.databaseUrl,
      supabaseAnonKey: parsed.supabaseAnonKey || '',
      supabaseServiceKey: parsed.supabaseServiceKey || '',
    });
  } catch {
    return c.json({ error: 'Failed to decrypt config string. It may be corrupted or invalid.' }, 400);
  }
});

// Test the PostgreSQL connection to Supabase
app.post('/test-connection', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();

  if (!config?.databaseUrl) {
    return c.json({ success: false, message: 'No database URL configured' }, 400);
  }

  try {
    const pg = await import('pg');
    const resolved = await resolveConnectionString(config.databaseUrl);
    const pool = new pg.default.Pool({
      connectionString: resolved,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    const result = await pool.query('SELECT NOW() as time, current_database() as db');
    await pool.end();

    return c.json({
      success: true,
      message: `Connected to "${result.rows[0].db}" at ${result.rows[0].time}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, message: `Connection failed: ${message}` }, 400);
  }
});

// Setup schema on Supabase (creates tables if they don't exist)
app.post('/setup-schema', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();

  if (!config?.databaseUrl) {
    return c.json({ success: false, message: 'No database URL configured' }, 400);
  }

  try {
    const pg = await import('pg');
    const resolved = await resolveConnectionString(config.databaseUrl);
    const pool = new pg.default.Pool({
      connectionString: resolved,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });

    // Run the same schema SQL used for local PGlite
    await pool.query(getSchemaSQL());
    await pool.end();

    return c.json({ success: true, message: 'Schema created/verified on Supabase' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, message: `Schema setup failed: ${message}` }, 400);
  }
});

// Get sync status
app.get('/status', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();
  // Import sync status dynamically to avoid circular deps
  let pendingCount = 0;
  let syncState: 'idle' | 'syncing' | 'offline' | 'error' | 'disabled' = 'disabled';

  if (config?.enabled) {
    try {
      const { getSyncStatus } = await import('@ctt/shared/db/sync-scheduler');
      const status = getSyncStatus();
      pendingCount = status.pendingCount;
      syncState = status.state;
    } catch {
      syncState = 'idle';
    }
  }

  return c.json({
    enabled: config?.enabled ?? false,
    lastSyncAt: config?.lastSyncAt ?? null,
    instanceId: config?.instanceId ?? '',
    pendingCount,
    state: syncState,
  });
});

// Trigger manual sync
app.post('/sync', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();

  if (!config?.enabled) {
    return c.json({ success: false, message: 'Supabase sync is not enabled' }, 400);
  }

  try {
    const { triggerSync } = await import('@ctt/shared/db/sync-scheduler');
    const result = await triggerSync();
    return c.json({ 
      success: true, 
      message: `Sync complete. Pushed: ${result.pushed}, Pulled: ${result.pulled}`,
      ...result 
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, message: `Sync failed: ${message}` }, 500);
  }
});

// Initial sync (full push/pull/merge)
app.post('/initial-sync', requireAdmin(), async (c) => {
  const config = loadSupabaseConfig();

  if (!config?.databaseUrl) {
    return c.json({ success: false, message: 'No database URL configured' }, 400);
  }

  const body = await c.req.json() as { direction: 'push' | 'pull' | 'merge' };
  const direction = body.direction;

  if (!['push', 'pull', 'merge'].includes(direction)) {
    return c.json({ success: false, message: 'Invalid direction. Use push, pull, or merge.' }, 400);
  }

  try {
    const { runInitialSync } = await import('@ctt/shared/db/sync-engine');
    const result = await runInitialSync(direction);
    return c.json({ success: true, message: result.message, stats: result.stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, message: `Initial sync failed: ${message}` }, 500);
  }
});

/** Returns the SQL to create all tables (same as PGlite's initializeSchema) */
function getSchemaSQL(): string {
  return `
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';

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
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_hourly_rate NUMERIC(10, 2);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS mailing_address TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_holder_id UUID REFERENCES users(id);
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS invoice_payable_to TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_day NUMERIC(2, 0);

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
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT false;

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

    -- Projects
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

    -- Client Chat Logs
    CREATE TABLE IF NOT EXISTS client_chat_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id) UNIQUE,
      content TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );

    -- Auto-invoice log table
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
  `;
}

export default app;
