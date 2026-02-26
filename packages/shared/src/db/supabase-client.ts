import dns from 'dns/promises';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../schema';
import * as relations from '../relations';
import { loadSupabaseConfig } from './supabase-config';

const allSchema = { ...schema, ...relations };

/**
 * Resolve the hostname in a PostgreSQL connection string to an IP address.
 * Tries IPv4 first, falls back to IPv6. This fixes connectivity to
 * Supabase hosts that only have AAAA (IPv6) DNS records.
 */
async function resolveConnectionString(connStr: string): Promise<string> {
  try {
    const url = new URL(connStr);
    const hostname = url.hostname;

    // Try IPv4 first
    try {
      const { address } = await dns.lookup(hostname, { family: 4 });
      url.hostname = address;
      return url.toString();
    } catch {
      // No IPv4, try IPv6
      const { address } = await dns.lookup(hostname, { family: 6 });
      url.hostname = `[${address}]`;
      return url.toString();
    }
  } catch {
    // If resolution fails entirely, return the original and let pg handle it
    return connStr;
  }
}

let pool: pg.Pool | null = null;
let drizzleInstance: ReturnType<typeof drizzle<typeof allSchema>> | null = null;
let resolvedConnStr: string | null = null;

async function ensurePool(): Promise<pg.Pool> {
  if (pool) return pool;

  const config = loadSupabaseConfig();
  if (!config?.databaseUrl) {
    throw new Error('Supabase database URL is not configured');
  }

  resolvedConnStr = await resolveConnectionString(config.databaseUrl);

  pool = new pg.Pool({
    connectionString: resolvedConnStr,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Kill queries that hang longer than 15 seconds (e.g., on dead TCP connections)
    statement_timeout: 15000,
    // Close idle connections that may have become stale
    allowExitOnIdle: true,
  });

  // Handle pool-level errors (e.g., lost connections) to prevent unhandled exceptions
  pool.on('error', (err) => {
    console.error('[Supabase Pool] Unexpected error on idle client:', err.message);
  });

  return pool;
}

/** Get or create a Drizzle instance connected to the remote Supabase PostgreSQL */
export async function getSupabaseDb() {
  if (drizzleInstance) return drizzleInstance;

  const p = await ensurePool();
  drizzleInstance = drizzle(p, { schema: allSchema });
  return drizzleInstance;
}

/** Get the raw pg Pool (for direct SQL queries during sync) */
export async function getSupabasePool(): Promise<pg.Pool> {
  return ensurePool();
}

/** Close the Supabase connection pool */
export async function closeSupabaseDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    drizzleInstance = null;
    resolvedConnStr = null;
  }
}

/** Reset the connection (e.g., when config changes) */
export async function resetSupabaseConnection(): Promise<void> {
  await closeSupabaseDb();
}
