import { Hono } from 'hono';
import { desc, eq, and, sql } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { auditLog, users } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// List audit log entries (admin only)
app.get('/', requireAdmin(), async (c) => {
  const db = await getDb();
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const tableName = c.req.query('table');
  const userId = c.req.query('userId');

  const conditions = [];
  if (tableName) conditions.push(eq(auditLog.tableName, tableName));
  if (userId) conditions.push(eq(auditLog.userId, userId));

  const entries = await db.select({
    log: auditLog,
    userName: users.displayName,
  })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(entries.map(e => ({
    ...e.log,
    userName: e.userName,
  })));
});

export default app;
