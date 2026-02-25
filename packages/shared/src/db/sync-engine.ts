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
  'auto_invoice_log',
] as const;

/** Tables that use `updated_at` for conflict resolution */
const TABLES_WITH_UPDATED_AT = new Set([
  'users', 'clients', 'invoices', 'time_entries', 'projects', 'client_chat_logs',
]);

/** Tables that only have `created_at` (append-mostly, no update conflict) */
const TABLES_WITH_CREATED_AT_ONLY = new Set([
  'job_types', 'rate_tiers', 'invoice_line_items', 'payments',
  'partner_splits', 'partner_payments', 'auto_invoice_log',
]);

/** Column definitions for each table (used for building upsert queries) */
function getTableColumns(tableName: string): string[] {
  const columnMap: Record<string, string[]> = {
    users: ['id', 'username', 'display_name', 'password_hash', 'role', 'theme', 'is_active', 'created_at', 'updated_at'],
    clients: ['id', 'name', 'account_holder', 'account_holder_id', 'phone', 'mailing_address', 'is_active', 'notes', 'default_hourly_rate', 'invoice_payable_to', 'billing_cycle', 'billing_day', 'created_at', 'updated_at'],
    job_types: ['id', 'name', 'description', 'is_active', 'created_at'],
    rate_tiers: ['id', 'amount', 'label', 'is_active', 'created_at'],
    projects: ['id', 'client_id', 'name', 'status', 'assigned_to', 'note', 'is_active', 'created_at', 'updated_at'],
    client_chat_logs: ['id', 'client_id', 'content', 'updated_at'],
    invoices: ['id', 'client_id', 'invoice_number', 'date_issued', 'date_due', 'status', 'notes', 'is_auto_generated', 'created_at', 'updated_at'],
    time_entries: ['id', 'client_id', 'tech_id', 'job_type_id', 'rate_tier_id', 'date', 'hours', 'notes', 'group_id', 'is_billed', 'is_paid', 'invoice_id', 'created_at', 'updated_at'],
    invoice_line_items: ['id', 'invoice_id', 'time_entry_id', 'description', 'hours', 'rate', 'created_at'],
    payments: ['id', 'invoice_id', 'amount', 'date_paid', 'method', 'notes', 'created_at'],
    partner_splits: ['id', 'partner_id', 'split_percent', 'effective_from', 'effective_to', 'created_at'],
    partner_payments: ['id', 'from_partner_id', 'to_partner_id', 'amount', 'date_paid', 'notes', 'created_at'],
    auto_invoice_log: ['id', 'client_id', 'invoice_id', 'billing_period_start', 'billing_period_end', 'status', 'message', 'created_at'],
  };
  return columnMap[tableName] || [];
}

// ============================================================================
// PUSH: Local -> Supabase
// ============================================================================

/** Push pending local changes to Supabase */
export async function pushChanges(): Promise<{ pushed: number; skipped: number; errors: { message: string, entry: ChangelogEntry }[] }> {
  const pending = await getPendingChanges();
  if (pending.length === 0) return { pushed: 0, skipped: 0, errors: [] };

  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;

  // Group changes by table, keeping only the latest operation per record.
  // Deletes must be processed after all upserts, and in reverse dependency order.
  const latestUpsertMap = new Map<string, ChangelogEntry>();
  const deleteMap = new Map<string, ChangelogEntry>();

  for (const entry of pending) {
    const key = `${entry.table_name}:${entry.record_id}`;
    if (entry.operation === 'DELETE') {
      deleteMap.set(key, entry);
      // If a record was updated then deleted, we no longer need to upsert it.
      if (latestUpsertMap.has(key)) {
        latestUpsertMap.delete(key);
      }
    } else {
      // It's an INSERT or UPDATE
      latestUpsertMap.set(key, entry);
    }
  }

  const tableOrderIndex = new Map<string, number>(SYNC_TABLE_ORDER.map((t, i) => [t, i]));
  
  // Sort final upserts by dependency order (parents first)
  const finalUpserts = Array.from(latestUpsertMap.values()).sort((a, b) => {
    const aIdx = tableOrderIndex.get(a.table_name) ?? 999;
    const bIdx = tableOrderIndex.get(b.table_name) ?? 999;
    return aIdx - bIdx;
  });

  // Sort final deletes by reverse dependency order (children first)
  const finalDeletes = Array.from(deleteMap.values()).sort((a, b) => {
    const aIdx = tableOrderIndex.get(a.table_name) ?? 999;
    const bIdx = tableOrderIndex.get(b.table_name) ?? 999;
    return bIdx - aIdx; // reversed
  });

  const orderedEntries = [...finalUpserts, ...finalDeletes];

  let pushed = 0;
  let skipped = 0;
  const errors: { message: string, entry: ChangelogEntry }[] = [];
  const successfulSyncIds: number[] = [];


  for (const entry of orderedEntries) {
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
        successfulSyncIds.push(entry.id);
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
        successfulSyncIds.push(entry.id);
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
            successfulSyncIds.push(entry.id);
            continue;
          }
        }
      }

      await upsertToRemote(pool, entry.table_name, localRecord);
      pushed++;
      successfulSyncIds.push(entry.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Sync push error for ${entry.table_name}:${entry.record_id}:`, message);
      
      // Log the error to the changelog so it's visible in the UI
      const { markSyncError } = await import('./sync-changelog');
      await markSyncError(entry.id, message);
      
      errors.push({ message: `[${entry.table_name}] ${message}`, entry });
      skipped++;
    }
  }

  // Mark only successfully synced or skipped entries as synced
  if (successfulSyncIds.length > 0) {
    await markSynced(successfulSyncIds);
  }

  return { pushed, skipped, errors };
}

// ============================================================================
// PULL: Supabase -> Local
// ============================================================================

/** Pull remote changes from Supabase into local PGlite */
export async function pullChanges(): Promise<{ pulled: number; skipped: number; errors: { message: string, recordId: any }[] }> {
  const config = loadSupabaseConfig();
  if (!config) return { pulled: 0, skipped: 0, errors: [] };

  const pool = await getSupabasePool();
  const localDb = await getLocalDb();
  const localClient = (localDb as any)._.session.client;

  const lastSyncAt = config.lastSyncAt ? new Date(config.lastSyncAt) : new Date(0);
  let pulled = 0;
  let skipped = 0;
  const errors: { message: string, recordId: any }[] = [];

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
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Sync pull error for ${tableName}:${remoteRecord.id}:`, message);
          errors.push({ message: `[${tableName}] ${message}`, recordId: remoteRecord.id });
          skipped++;
        }
      }
    }

    // Process remote deletes
    try {
      const remoteDeletes = await pool.query(
        `SELECT * FROM remote_sync_changelog WHERE changed_at > $1 AND operation = 'DELETE' ORDER BY changed_at ASC`,
        [lastSyncAt.toISOString()]
      );

      for (const del of remoteDeletes.rows) {
        // Ensure table exists in our sync list
        if (SYNC_TABLE_ORDER.includes(del.table_name as any)) {
          await localClient.transaction(async (tx: any) => {
            await tx.query("SET LOCAL app.syncing = 'true'");
            await tx.query(`DELETE FROM ${del.table_name} WHERE id = $1`, [del.record_id]);
          });
          pulled++;
        }
      }
    } catch (e) {
      console.error('Error syncing remote deletes:', e);
    }

    // Also sync app_settings (special: text PK, not UUID)
    await pullAppSettings(pool, localClient, lastSyncAt);

    // Update lastSyncAt
    const newSyncTime = new Date().toISOString();
    saveSupabaseConfig({ lastSyncAt: newSyncTime });
  } catch (error) {
    // Re-throw to be caught by the caller
    throw error;
  }

  // Housekeeping: clear old synced changelog entries
  await clearSyncedEntries();

  return { pulled, skipped, errors };
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
export async function runSyncCycle(): Promise<{ 
  pushed: number; 
  pulled: number; 
  skippedPush: number; 
  skippedPull: number;
  pushErrors: number;
  pullErrors: number;
}> {
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
    pushErrors: pushResult.errors.length,
    pullErrors: pullResult.errors.length,
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
  // Ensure local DB is ready and schema is initialized
  const localDb = await getLocalDb();
  const pool = await getSupabasePool();
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
    } catch (error) {
      console.error(`Initial pull error:`, error);
      throw error;
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

/** Columns that are PostgreSQL DATE type (no time component).
 *  The pg driver returns these as JS Date objects at midnight UTC,
 *  which can shift when interpreted in a different timezone.
 *  We normalize them to plain 'YYYY-MM-DD' strings to prevent drift. */
const DATE_ONLY_COLUMNS = new Set([
  'date',                  // time_entries.date
  'date_issued',           // invoices.date_issued
  'date_due',              // invoices.date_due
  'date_paid',             // payments.date_paid
  'effective_from',        // partner_splits.effective_from
  'effective_to',          // partner_splits.effective_to
  'billing_period_start',  // auto_invoice_log.billing_period_start
  'billing_period_end',    // auto_invoice_log.billing_period_end
]);

/** Convert a value to a plain 'YYYY-MM-DD' string if it's a Date object
 *  for a DATE-only column, using UTC components to avoid timezone shift. */
function normalizeDateValue(col: string, value: any): any {
  if (value == null) return value;
  if (!DATE_ONLY_COLUMNS.has(col)) return value;

  if (value instanceof Date) {
    // Use UTC components to get the correct date regardless of local timezone
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // If it's already a string like '2026-02-21', return as-is
  if (typeof value === 'string') return value;

  return value;
}

/** Upsert a record into the remote Supabase database */
async function upsertToRemote(pool: any, tableName: string, record: Record<string, any>): Promise<void> {
  const columns = getTableColumns(tableName);
  const values: any[] = [];
  const placeholders: string[] = [];
  const updateParts: string[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    values.push(normalizeDateValue(col, record[col] ?? null));
    placeholders.push(`$${i + 1}`);
    if (col !== 'id') {
      updateParts.push(`${col} = $${i + 1}`);
    }
  }

  // Handle specific unique constraint conflicts
  if (tableName === 'users' && record.username) {
    // If username exists on remote with a different ID, we should ideally merge.
    // To resolve the immediate sync error, we'll ensure the remote record with this username
    // is updated to our local ID (if no other records point to the remote ID yet)
    // or we'll simply update our local ID to match remote (handled in a separate step).
    // For now, we use a custom conflict target for users.
    const userSql = `
      INSERT INTO users (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (username) DO UPDATE SET 
        id = EXCLUDED.id,
        ${updateParts.filter(p => !p.startsWith('username =')).join(', ')}
    `;
    await pool.query(userSql, values);
    return;
  }

  // For invoices, handle the unique invoice_number constraint:
  if (tableName === 'invoices' && record.invoice_number) {
    await pool.query(
      `UPDATE invoices SET invoice_number = invoice_number || '_dup_' || id
       WHERE invoice_number = $1 AND id != $2`,
      [record.invoice_number, record.id]
    );
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
    values.push(normalizeDateValue(col, record[col] ?? null));
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

  // Wrap the upsert in a transaction with SET LOCAL app.syncing = 'true'
  // to suppress the trigger only for this specific sync update.
  // This avoids the global race condition with user-triggered changes.
  await localClient.transaction(async (tx: any) => {
    await tx.query("SET LOCAL app.syncing = 'true'");
    await tx.query(sql, values);
  });
}
