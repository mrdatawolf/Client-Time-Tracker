import { MiddlewareHandler } from 'hono';
import { getDb } from '@ctt/shared/db';
import { auditLog } from '@ctt/shared/schema';
import type { AppEnv } from '../types';

/**
 * Route-to-table mapping based on URL path segments.
 */
function resolveTableName(path: string): string | null {
  const segment = path.replace(/^\/api\//, '').split('/')[0];
  const map: Record<string, string> = {
    users: 'users',
    clients: 'clients',
    'job-types': 'job_types',
    'rate-tiers': 'rate_tiers',
    'time-entries': 'time_entries',
    invoices: 'invoices',
    payments: 'payments',
    partner: 'partner_splits',
    settings: 'app_settings',
  };
  return map[segment] ?? null;
}

/**
 * Derive the action from HTTP method + URL path.
 */
function resolveAction(method: string, path: string): string {
  const segments = path.replace(/^\/api\//, '').split('/');
  // e.g. POST /api/invoices/generate -> "generate"
  if (segments.length >= 2 && method === 'POST' && !/^[0-9a-f-]{36}$/.test(segments[1])) {
    return segments[1];
  }
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return method.toLowerCase();
  }
}

/**
 * Extract a record ID from the URL path (UUID in path segments).
 */
function extractRecordId(path: string): string | null {
  const segments = path.replace(/^\/api\//, '').split('/');
  for (const s of segments) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
      return s;
    }
  }
  return null;
}

/**
 * Audit middleware — logs all successful write operations (POST, PUT, PATCH, DELETE)
 * to the audit_log table. Runs AFTER the handler so it captures the outcome.
 */
export const auditLogger = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    await next();

    const method = c.req.method;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;

    const status = c.res.status;
    if (status < 200 || status >= 300) return;

    const path = new URL(c.req.url).pathname;
    const tableName = resolveTableName(path);
    if (!tableName) return;

    // Skip audit-log and auth endpoints to avoid noise / recursion
    if (path.startsWith('/api/audit-log') || path.startsWith('/api/auth')) return;

    const action = resolveAction(method, path);
    const recordId = extractRecordId(path);

    // Try to capture response body as "new values"
    let newValues: string | null = null;
    try {
      const cloned = c.res.clone();
      const body = await cloned.json();
      newValues = JSON.stringify(body);
    } catch {
      // non-JSON response, skip
    }

    const userId = c.get('userId') ?? null;

    // Fire-and-forget — don't block the response
    getDb().then(db =>
      db.insert(auditLog).values({
        userId,
        action,
        tableName,
        recordId,
        newValues,
      }).execute()
    ).catch(() => {
      // Audit logging should never break the app
    });
  };
};
