import { isSupabaseEnabled } from './supabase-config';
import { getPendingCount } from './sync-changelog';
import { runSyncCycle } from './sync-engine';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';

interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastError: string | null;
  consecutiveFailures: number;
}

const DEFAULT_INTERVAL = 30_000; // 30 seconds
const MAX_BACKOFF = 300_000; // 5 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let currentInterval = DEFAULT_INTERVAL;
let status: SyncStatus = {
  state: 'disabled',
  pendingCount: 0,
  lastError: null,
  consecutiveFailures: 0,
};

/** Get current sync status */
export function getSyncStatus(): SyncStatus {
  return { ...status };
}

/** Start the background sync scheduler */
export function startSyncScheduler(intervalMs: number = DEFAULT_INTERVAL): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  if (!isSupabaseEnabled()) {
    status.state = 'disabled';
    console.log('[Sync] Supabase sync is not enabled, scheduler not started');
    return;
  }

  currentInterval = intervalMs;
  status.state = 'idle';
  console.log(`[Sync] Starting sync scheduler (interval: ${intervalMs}ms)`);

  // Run first sync immediately
  runSyncTick();

  intervalHandle = setInterval(runSyncTick, currentInterval);
}

/** Stop the sync scheduler */
export function stopSyncScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  status.state = 'disabled';
  console.log('[Sync] Scheduler stopped');
}

/** Trigger a manual sync (returns a promise that resolves when sync completes) */
export async function triggerSync(): Promise<void> {
  if (status.state === 'syncing') {
    throw new Error('Sync is already in progress');
  }
  await runSyncTick();
}

/** Restart the scheduler (e.g., when config changes) */
export function restartSyncScheduler(): void {
  stopSyncScheduler();
  startSyncScheduler(DEFAULT_INTERVAL);
}

async function runSyncTick(): Promise<void> {
  // Skip if already syncing
  if (status.state === 'syncing') return;

  // Check if still enabled
  if (!isSupabaseEnabled()) {
    status.state = 'disabled';
    return;
  }

  status.state = 'syncing';

  try {
    // Update pending count before sync
    status.pendingCount = await getPendingCount();

    const result = await runSyncCycle();

    // Success: reset backoff
    status.state = 'idle';
    status.lastError = null;
    status.consecutiveFailures = 0;
    status.pendingCount = await getPendingCount();

    if (result.pushed > 0 || result.pulled > 0) {
      console.log(`[Sync] Cycle complete: pushed=${result.pushed}, pulled=${result.pulled}`);
    }

    // Reset interval to default if we had backed off
    if (currentInterval !== DEFAULT_INTERVAL && intervalHandle) {
      clearInterval(intervalHandle);
      currentInterval = DEFAULT_INTERVAL;
      intervalHandle = setInterval(runSyncTick, currentInterval);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Determine if this is a network error (offline) vs other error
    const isNetworkError = message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('ETIMEDOUT') ||
      message.includes('getaddrinfo') ||
      message.includes('connect ECONNRESET') ||
      message.includes('Connection terminated unexpectedly');

    status.state = isNetworkError ? 'offline' : 'error';
    status.lastError = message;
    status.consecutiveFailures++;

    console.error(`[Sync] Error (attempt ${status.consecutiveFailures}): ${message}`);

    // Exponential backoff
    const backoffInterval = Math.min(
      DEFAULT_INTERVAL * Math.pow(2, status.consecutiveFailures),
      MAX_BACKOFF
    );

    if (backoffInterval !== currentInterval && intervalHandle) {
      clearInterval(intervalHandle);
      currentInterval = backoffInterval;
      intervalHandle = setInterval(runSyncTick, currentInterval);
      console.log(`[Sync] Backing off to ${currentInterval}ms interval`);
    }
  }
}
