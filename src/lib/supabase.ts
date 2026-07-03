/**
 * Supabase connection bootstrap.
 *
 * The browser app is generic: each org runs its own Supabase project and
 * shares a config string (`CTTW:` + base64 of { url, anonKey }). The anon key
 * is public by design — Row Level Security is the security boundary.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const REQUIRED_SCHEMA_VERSION = 1;

const CONFIG_KEY = 'ctt_supabase_config';
const CONFIG_PREFIX = 'CTTW:';

export interface ConnectionConfig {
  url: string;
  anonKey: string;
}

export function encodeConfig(config: ConnectionConfig): string {
  return CONFIG_PREFIX + btoa(JSON.stringify({ url: config.url, anonKey: config.anonKey }));
}

export function decodeConfig(raw: string): ConnectionConfig {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(CONFIG_PREFIX)) {
    throw new Error('Not a valid connection code (expected it to start with "CTTW:")');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(trimmed.slice(CONFIG_PREFIX.length)));
  } catch {
    throw new Error('Connection code is corrupted or incomplete');
  }
  const { url, anonKey } = (parsed ?? {}) as Partial<ConnectionConfig>;
  if (!url || !anonKey || !/^https:\/\//.test(url)) {
    throw new Error('Connection code is missing the project URL or key');
  }
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export function getStoredConfig(): ConnectionConfig | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConnectionConfig;
    return parsed.url && parsed.anonKey ? parsed : null;
  } catch {
    return null;
  }
}

export function storeConfig(config: ConnectionConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  client = null; // force re-create with new config
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
  client = null;
}

export function isConfigured(): boolean {
  return getStoredConfig() !== null;
}

let client: SupabaseClient | null = null;

/** The Supabase client for the configured org project. Throws if unconfigured. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const config = getStoredConfig();
  if (!config) {
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/connect')) {
      window.location.href = '/connect';
    }
    throw new Error('No Supabase connection configured');
  }
  client = createClient(config.url, config.anonKey, {
    auth: { storageKey: 'ctt_auth' },
  });
  return client;
}

export type SchemaCheck =
  | { ok: true; version: number }
  | { ok: false; reason: 'unreachable' | 'missing' | 'outdated' | 'newer'; version?: number; message: string };

/**
 * Pre-login schema gate: schema_meta is anon-readable so the app can verify
 * the org's database is set up and current before anything else runs.
 */
export async function checkSchemaVersion(config?: ConnectionConfig): Promise<SchemaCheck> {
  const conf = config ?? getStoredConfig();
  if (!conf) return { ok: false, reason: 'missing', message: 'Not configured' };

  let rows: Array<{ version: number }>;
  try {
    const res = await fetch(`${conf.url}/rest/v1/schema_meta?select=version&order=version.desc&limit=1`, {
      headers: { apikey: conf.anonKey },
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 401 || res.status === 406) {
        return { ok: false, reason: 'missing', message: 'The database has not been set up yet — run setup.sql in the Supabase SQL Editor.' };
      }
      return { ok: false, reason: 'unreachable', message: `Could not reach the project (HTTP ${res.status})` };
    }
    rows = await res.json();
  } catch (err) {
    return { ok: false, reason: 'unreachable', message: err instanceof Error ? err.message : 'Could not reach the project' };
  }

  const version = rows[0]?.version;
  if (version === undefined) {
    return { ok: false, reason: 'missing', message: 'The database has not been set up yet — run setup.sql in the Supabase SQL Editor.' };
  }
  if (version < REQUIRED_SCHEMA_VERSION) {
    return { ok: false, reason: 'outdated', version, message: `The database schema (v${version}) is older than this app needs (v${REQUIRED_SCHEMA_VERSION}). Run the latest setup.sql.` };
  }
  if (version > REQUIRED_SCHEMA_VERSION) {
    return { ok: false, reason: 'newer', version, message: `The database schema (v${version}) is newer than this app (v${REQUIRED_SCHEMA_VERSION}). Refresh or update the app.` };
  }
  return { ok: true, version };
}
