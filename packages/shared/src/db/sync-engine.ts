import { getLocalDb } from './local';
import { getSupabasePool } from './supabase-client';
import { loadSupabaseConfig, saveSupabaseConfig } from './supabase-config';
import { getPendingChanges, markSynced, clearSyncedEntries, setSyncingFlag } from './sync-changelog';
import type { ChangelogEntry } from './sync-changelog';

/**
 * Tables in dependency order (parents before children).
 * This order is used for push (insert) and reversed for pull (to avoid FK violations).
 */
const SYNC_TABLE_ORDER = [
  'users',
  'clients',
  'job_types',
  'rate_tiers',
  'projects',
  'client_chat_logs',
  'invoices',
  'time_entries',
  'invoice_line_items',
  'payments',
  'partner_splits',
  'partner_payments',
] as const;

/** Tables that use `updated_at` for conflict resolution */
const TABLES_WITH_UPDATED_AT = new Set([
  'users', 'clients', 'invoices', 'time_entries', 'projects', 'client_chat_logs',
]);

/** Tables that only have `created_at` (append-mostly, no update conflict) */
const TABLES_WITH_CREATED_AT_ONLY = new Set([
  'job_types', 'rate_tiers', 'invoice_line_items', 'payments',
  'partner_splits', 'partner_payments',
]);

/** Column definitions for each table (used for building upsert queries) */
function getTableColumns(tableName: string): string[] {
  const columnMap: Record<string, string[]> = {
    users: ['id', 'username', 'display_name', 'password_hash', 'role', 'is_active', 'created_at', 'updated_at'],
    clients: ['id', 'name', 'account_holder', 'account_holder_id', 'phone', 'mailing_address', 'is_active', 'notes', 'default_hourly_rate', 'invoice_payable_to', 'created_at', 'updated_at'],
    job_types: ['id', 'name', 'description', 'is_active', 'created_at'],
    rate_tiers: ['id', 'amount', 'label', 'is_active', 'created_at'],
    projects: ['id', 'client_id', 'name', 'status', 'assigned_to', 'note', 'is_active', 'created_at', 'updated_at'],
    client_chat_logs: ['id', 'client_id', 'content', 'updated_at'],
    invoices: ['id', 'client_id', 'invoice_number', 'date_issued', 'date_due', 'status', 'notes', 'created_at', 'updated_at'],
    time_entries: ['id', 'client_id', 'tech_id', 'job_type_id', 'rate_tier_id', 'date', 'hours', 'notes', 'group_id', 'is_billed', 'is_paid', 'invoice_id', 'created_at', 'updated_at'],
    invoice_line_items: ['id', 'invoice_id', 'time_entry_id', 'description', 'hours', 'rate', 'created_at'],
    payments: ['id', 'invoice_id', 'amount', 'date_paid', 'method', 'notes', 'created_at'],
    partner_splits: ['id', 'partner_id', 'split_percent', 'effective_from', 'effective_to', 'created_at'],
    partner_payments: ['id', 'from_partner_id', 'to_partner_id', 'amount', 'date_paid', 'notes', 'created_at'],
  };
  return columnMap[tableName] || [];
}

// ============================================================================
// PUSH: Local -> Supabase
// ============================================================================

/** Push pending local changes to Supabase */
export async function pushChanges(): Promise<{ pushed: number; skipped: number }> {
  const pending = await getPendingChanges();
  if (pending.length === 0) return { pushed: 0, skipped: 0 };

  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;

  // Group changes by table, keeping only the latest operation per record
  const latestByRecord = new Map<string, ChangelogEntry>();
  for (const entry of pending) {
    const key = `${entry.table_name}:${entry.record_id}`;
    latestByRecord.set(key, entry);
  }

  let pushed = 0;
  let skipped = 0;
  const syncedIds: number[] = pending.map(e => e.id);

  for (const [, entry] of latestByRecord) {
    try {
      if (entry.operation === 'DELETE') {
        // For soft-delete tables, we push the is_active=false state via UPDATE
        // For hard deletes, we delete on remote too
        const columns = getTableColumns(entry.table_name);
        if (columns.includes('is_active')) {
          // Record may have been soft-deleted, push the update
          const localRow = await localClient.query(
            `SELECT * FROM ${entry.table_name} WHERE id = $1`,
            [entry.record_id]
          );
          if (localRow.rows.length > 0) {
            await upsertToRemote(pool, entry.table_name, localRow.rows[0]);
            pushed++;
          }
          // If record truly doesn't exist locally, delete on remote too
          else {
            await pool.query(
              `DELETE FROM ${entry.table_name} WHERE id = $1`,
              [entry.record_id]
            );
            pushed++;
          }
        } else {
          await pool.query(
            `DELETE FROM ${entry.table_name} WHERE id = $1`,
            [entry.record_id]
          );
          pushed++;
        }
        continue;
      }

      // INSERT or UPDATE: fetch the local record
      const localRow = await localClient.query(
        `SELECT * FROM ${entry.table_name} WHERE id = $1`,
        [entry.record_id]
      );

      if (localRow.rows.length === 0) {
        // Record was deleted after the changelog entry - skip
        skipped++;
        continue;
      }

      const localRecord = localRow.rows[0];

      // Check if Supabase has a newer version (conflict resolution)
      if (TABLES_WITH_UPDATED_AT.has(entry.table_name)) {
        const remoteRow = await pool.query(
          `SELECT updated_at FROM ${entry.table_name} WHERE id = $1`,
          [entry.record_id]
        );

        if (remoteRow.rows.length > 0) {
          const remoteUpdatedAt = new Date(remoteRow.rows[0].updated_at);
          const localUpdatedAt = new Date(localRecord.updated_at);

          // Supabase wins if it's newer or equal (tiebreaker)
          if (remoteUpdatedAt >= localUpdatedAt) {
            skipped++;
            continue;
          }
        }
      }

      await upsertToRemote(pool, entry.table_name, localRecord);
      pushed++;
    } catch (error) {
      console.error(`Sync push error for ${entry.table_name}:${entry.record_id}:`, error);
      skipped++;
    }
  }

  // Mark all processed changelog entries as synced
  await markSynced(syncedIds);

  return { pushed, skipped };
}

// ============================================================================
// PULL: Supabase -> Local
// ============================================================================

/** Pull remote changes from Supabase into local PGlite */
export async function pullChanges(): Promise<{ pulled: number; skipped: number }> {
  const config = loadSupabaseConfig();
  if (!config) return { pulled: 0, skipped: 0 };

  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;

  const lastSyncAt = config.lastSyncAt ? new Date(config.lastSyncAt) : new Date(0);
  let pulled = 0;
  let skipped = 0;

  // Set the syncing flag to suppress local triggers
  await setSyncingFlag(true);

  try {
    // Process tables in reverse dependency order for pulls (children first doesn't matter
    // for upserts, but we process parents first to satisfy FK constraints)
    for (const tableName of SYNC_TABLE_ORDER) {
      const columns = getTableColumns(tableName);
      if (columns.length === 0) continue;

      // Determine which timestamp column to use for detecting changes
      let timestampCol = 'created_at';
      if (TABLES_WITH_UPDATED_AT.has(tableName)) {
        timestampCol = 'updated_at';
      }

      // Fetch records modified since last sync
      const remoteRows = await pool.query(
        `SELECT * FROM ${tableName} WHERE ${timestampCol} > $1 ORDER BY ${timestampCol} ASC`,
        [lastSyncAt.toISOString()]
      );

      for (const remoteRecord of remoteRows.rows) {
        try {
          // Check if local has a newer version
          if (TABLES_WITH_UPDATED_AT.has(tableName)) {
            const localRow = await localClient.query(
              `SELECT updated_at FROM ${tableName} WHERE id = $1`,
              [remoteRecord.id]
            );

            if (localRow.rows.length > 0) {
              const localUpdatedAt = new Date(localRow.rows[0].updated_at);
              const remoteUpdatedAt = new Date(remoteRecord.updated_at);

              // If local is strictly newer, skip (will be pushed in next cycle)
              if (localUpdatedAt > remoteUpdatedAt) {
                skipped++;
                continue;
              }
            }
          }

          await upsertToLocal(localClient, tableName, remoteRecord, columns);
          pulled++;
        } catch (error) {
          console.error(`Sync pull error for ${tableName}:${remoteRecord.id}:`, error);
          skipped++;
        }
      }
    }

    // Also sync app_settings (special: text PK, not UUID)
    await pullAppSettings(pool, localClient, lastSyncAt);

    // Update lastSyncAt
    const newSyncTime = new Date().toISOString();
    saveSupabaseConfig({ lastSyncAt: newSyncTime });
  } finally {
    await setSyncingFlag(false);
  }

  // Housekeeping: clear old synced changelog entries
  await clearSyncedEntries();

  return { pulled, skipped };
}

// ============================================================================
// APP SETTINGS SYNC (special handling for text PK)
// ============================================================================

async function pullAppSettings(pool: any, localClient: any, lastSyncAt: Date): Promise<void> {
  try {
    const remoteSettings = await pool.query(
      `SELECT * FROM app_settings WHERE updated_at > $1`,
      [lastSyncAt.toISOString()]
    );

    for (const row of remoteSettings.rows) {
      const localRow = await localClient.query(
        `SELECT updated_at FROM app_settings WHERE key = $1`,
        [row.key]
      );

      if (localRow.rows.length > 0) {
        const localUpdatedAt = new Date(localRow.rows[0].updated_at);
        const remoteUpdatedAt = new Date(row.updated_at);
        if (localUpdatedAt > remoteUpdatedAt) continue; // local is newer
      }

      await localClient.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        [row.key, row.value, row.updated_at]
      );
    }
  } catch (error) {
    console.error('Error syncing app_settings:', error);
  }
}

/** Push app_settings to Supabase */
async function pushAppSettings(pool: any, localClient: any): Promise<void> {
  try {
    const localSettings = await localClient.query(`SELECT * FROM app_settings`);

    for (const row of localSettings.rows) {
      const remoteRow = await pool.query(
        `SELECT updated_at FROM app_settings WHERE key = $1`,
        [row.key]
      );

      if (remoteRow.rows.length > 0) {
        const remoteUpdatedAt = new Date(remoteRow.rows[0].updated_at);
        const localUpdatedAt = new Date(row.updated_at);
        if (remoteUpdatedAt >= localUpdatedAt) continue; // remote is newer or equal
      }

      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
        [row.key, row.value, row.updated_at]
      );
    }
  } catch (error) {
    console.error('Error pushing app_settings:', error);
  }
}

// ============================================================================
// FULL SYNC CYCLE
// ============================================================================

/** Run a complete sync cycle: push local changes, then pull remote changes */
export async function runSyncCycle(): Promise<{ pushed: number; pulled: number; skippedPush: number; skippedPull: number }> {
  const pushResult = await pushChanges();

  // Also push app_settings
  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;
  await pushAppSettings(pool, localClient);

  const pullResult = await pullChanges();

  return {
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    skippedPush: pushResult.skipped,
    skippedPull: pullResult.skipped,
  };
}

// ============================================================================
// INITIAL SYNC
// ============================================================================

export interface InitialSyncResult {
  message: string;
  stats: { pushed: number; pulled: number };
}

/** Run initial sync in the specified direction */
export async function runInitialSync(direction: 'push' | 'pull' | 'merge'): Promise<InitialSyncResult> {
  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;

  let totalPushed = 0;
  let totalPulled = 0;

  if (direction === 'push' || direction === 'merge') {
    // Push all local data to Supabase
    for (const tableName of SYNC_TABLE_ORDER) {
      const columns = getTableColumns(tableName);
      if (columns.length === 0) continue;

      const localRows = await localClient.query(`SELECT * FROM ${tableName}`);
      for (const row of localRows.rows) {
        try {
          await upsertToRemote(pool, tableName, row);
          totalPushed++;
        } catch (error) {
          console.error(`Initial push error for ${tableName}:${row.id}:`, error);
        }
      }
    }

    // Push app_settings
    await pushAppSettings(pool, localClient);
  }

  if (direction === 'pull' || direction === 'merge') {
    // Pull all remote data to local
    await setSyncingFlag(true);
    try {
      for (const tableName of SYNC_TABLE_ORDER) {
        const columns = getTableColumns(tableName);
        if (columns.length === 0) continue;

        const remoteRows = await pool.query(`SELECT * FROM ${tableName}`);
        for (const row of remoteRows.rows) {
          try {
            if (direction === 'merge') {
              // In merge mode, check timestamps - only pull if remote is newer
              if (TABLES_WITH_UPDATED_AT.has(tableName)) {
                const localRow = await localClient.query(
                  `SELECT updated_at FROM ${tableName} WHERE id = $1`,
                  [row.id]
                );
                if (localRow.rows.length > 0) {
                  const localUpdatedAt = new Date(localRow.rows[0].updated_at);
                  const remoteUpdatedAt = new Date(row.updated_at);
                  if (localUpdatedAt > remoteUpdatedAt) continue;
                }
              }
            }

            await upsertToLocal(localClient, tableName, row, columns);
            totalPulled++;
          } catch (error) {
            console.error(`Initial pull error for ${tableName}:${row.id}:`, error);
          }
        }
      }

      // Pull app_settings
      await pullAppSettings(pool, localClient, new Date(0));
    } finally {
      await setSyncingFlag(false);
    }
  }

  // Update lastSyncAt and enable sync
  saveSupabaseConfig({ lastSyncAt: new Date().toISOString(), enabled: true });

  // Clear any existing changelog entries (they've been handled by initial sync)
  await clearSyncedEntries();

  const directionLabel = direction === 'push' ? 'Push' : direction === 'pull' ? 'Pull' : 'Merge';
  return {
    message: `Initial ${directionLabel} complete. Pushed: ${totalPushed}, Pulled: ${totalPulled}`,
    stats: { pushed: totalPushed, pulled: totalPulled },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/** Upsert a record into the remote Supabase database */
async function upsertToRemote(pool: any, tableName: string, record: Record<string, any>): Promise<void> {
  const columns = getTableColumns(tableName);
  const values: any[] = [];
  const placeholders: string[] = [];
  const updateParts: string[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    values.push(record[col] ?? null);
    placeholders.push(`$${i + 1}`);
    if (col !== 'id') {
      updateParts.push(`${col} = $${i + 1}`);
    }
  }

  const sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (id) DO UPDATE SET ${updateParts.join(', ')}
  `;

  await pool.query(sql, values);
}

/** Upsert a record into the local PGlite database */
async function upsertToLocal(
  localClient: any,
  tableName: string,
  record: Record<string, any>,
  columns: string[]
): Promise<void> {
  const values: any[] = [];
  const placeholders: string[] = [];
  const updateParts: string[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    values.push(record[col] ?? null);
    placeholders.push(`$${i + 1}`);
    if (col !== 'id') {
      updateParts.push(`${col} = $${i + 1}`);
    }
  }

  // For client_chat_logs, the unique constraint is on client_id, not just id
  let conflictTarget = 'id';
  if (tableName === 'client_chat_logs') {
    // Has both id PK and client_id unique constraint; use id for upsert
    conflictTarget = 'id';
  }

  const sql = `
    INSERT INTO ${tableName} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updateParts.join(', ')}
  `;

  await localClient.query(sql, values);
}
