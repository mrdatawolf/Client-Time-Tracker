import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { requireAdmin } from '../middleware/auth';
import { getDbPath, closeLocalDb, resetDbError, initializeSchema, getPgliteClientInstance } from '@ctt/shared/db';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

/** Recursively calculate the total size of a directory in bytes */
function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirSize(fullPath);
    } else {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

/** Recursively copy a directory */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Recursively delete a directory */
function rmDirSync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function getBackupsDir(): string {
  const dbPath = getDbPath();
  return path.join(path.dirname(dbPath), 'backups');
}

// Get database info
app.get('/info', requireAdmin(), async (c) => {
  const dbPath = getDbPath();
  const exists = fs.existsSync(dbPath);
  const sizeMB = exists ? +(getDirSize(dbPath) / (1024 * 1024)).toFixed(2) : 0;

  return c.json({
    path: dbPath,
    sizeMB,
    exists,
  });
});

// Create a backup
app.post('/backup', requireAdmin(), async (c) => {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    return c.json({ error: 'Database directory does not exist' }, 400);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `backup-${timestamp}`;
  const backupsDir = getBackupsDir();
  const backupPath = path.join(backupsDir, backupName);

  try {
    copyDirSync(dbPath, backupPath);
    const sizeMB = +(getDirSize(backupPath) / (1024 * 1024)).toFixed(2);
    return c.json({ name: backupName, sizeMB });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Backup failed: ${message}` }, 500);
  }
});

// List backups
app.get('/backups', requireAdmin(), async (c) => {
  const backupsDir = getBackupsDir();
  if (!fs.existsSync(backupsDir)) {
    return c.json([]);
  }

  const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
    .map((e) => {
      const fullPath = path.join(backupsDir, e.name);
      const sizeMB = +(getDirSize(fullPath) / (1024 * 1024)).toFixed(2);
      const stat = fs.statSync(fullPath);
      return {
        name: e.name,
        sizeMB,
        createdAt: stat.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return c.json(entries);
});

// Delete a backup
app.delete('/backups/:name', requireAdmin(), async (c) => {
  const name = c.req.param('name');
  if (!name.startsWith('backup-')) {
    return c.json({ error: 'Invalid backup name' }, 400);
  }

  const backupPath = path.join(getBackupsDir(), name);
  if (!fs.existsSync(backupPath)) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  try {
    rmDirSync(backupPath);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Delete failed: ${message}` }, 500);
  }
});

// Reset database (delete and reinitialize)
app.post('/reset', requireAdmin(), async (c) => {
  const dbPath = getDbPath();

  try {
    // Close the active PGlite connection
    await closeLocalDb();
    resetDbError();

    // Remove the database directory
    rmDirSync(dbPath);

    return c.json({ success: true, message: 'Database deleted. Restart the server to reinitialize.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Reset failed: ${message}` }, 500);
  }
});

// Restore from a backup
app.post('/restore/:name', requireAdmin(), async (c) => {
  const name = c.req.param('name');
  if (!name.startsWith('backup-')) {
    return c.json({ error: 'Invalid backup name' }, 400);
  }

  const backupPath = path.join(getBackupsDir(), name);
  if (!fs.existsSync(backupPath)) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  const dbPath = getDbPath();

  try {
    // Close the active PGlite connection
    await closeLocalDb();
    resetDbError();

    // Remove current database
    rmDirSync(dbPath);

    // Copy backup into the database location
    copyDirSync(backupPath, dbPath);

    return c.json({ success: true, message: 'Database restored. Restart the server to load the restored data.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Restore failed: ${message}` }, 500);
  }
});

// Run database migrations (re-applies all schema migrations)
app.post('/run-migrations', requireAdmin(), async (c) => {
  try {
    const client = getPgliteClientInstance();
    if (!client) {
      return c.json({ success: false, message: 'Database is not initialized. Try restarting the server.' }, 400);
    }

    await initializeSchema(client);
    return c.json({ success: true, message: 'All migrations applied successfully.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, message: `Migration failed: ${message}` }, 500);
  }
});

export default app;
