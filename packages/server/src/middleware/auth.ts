import { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt';
import type { AppEnv } from '../types';

export type UserRole = 'partner' | 'admin' | 'basic';

/** Returns true if the role is admin or higher (admin or partner) */
export function isAtLeastAdmin(role: UserRole): boolean {
  return role === 'partner' || role === 'admin';
}

/**
 * Like requireAdmin(), but also allows unauthenticated access when no users
 * exist in the database (fresh install). This lets the login page import
 * Supabase config and pull team data before the first user is created.
 */
export const requireAdminOrSetup = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    // If there's an auth token, validate it normally and require admin
    const authHeader = c.req.header('Authorization');
    const queryToken = c.req.query('token');
    const hasToken = (authHeader?.startsWith('Bearer ') && authHeader.length > 7) || !!queryToken;

    if (hasToken) {
      // Authenticated path — require admin
      let token: string | null = null;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      } else if (queryToken) {
        token = queryToken;
      }
      try {
        const payload = verifyToken(token!);
        c.set('userId', payload.userId);
        c.set('userRole', payload.role);
      } catch {
        return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
      }
      if (!isAtLeastAdmin(c.get('userRole'))) {
        return c.json({ error: 'Forbidden', message: 'Admin access required' }, 403);
      }
      return next();
    }

    // No token — only allow if DB has no users (fresh install)
    const { getDb } = await import('@ctt/shared/db');
    const { users } = await import('@ctt/shared/schema');
    const db = await getDb();
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
      return c.json({ error: 'Unauthorized', message: 'Missing or invalid authorization header' }, 401);
    }

    // Fresh install — allow through without auth
    await next();
  };
};

export const requireAuth = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    // Also accept ?token= query param (for direct browser downloads like CSV export)
    const queryToken = c.req.query('token');

    let token: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      return c.json({ error: 'Unauthorized', message: 'Missing or invalid authorization header' }, 401);
    }

    try {
      const payload = verifyToken(token);
      c.set('userId', payload.userId);
      c.set('userRole', payload.role);
    } catch {
      return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
    }

    await next();
  };
};

export const requireAdmin = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    if (!isAtLeastAdmin(c.get('userRole'))) {
      return c.json({ error: 'Forbidden', message: 'Admin access required' }, 403);
    }
    await next();
  };
};

export const requirePartner = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    if (c.get('userRole') !== 'partner') {
      return c.json({ error: 'Forbidden', message: 'Partner access required' }, 403);
    }
    await next();
  };
};

export function getUserId(c: { get: (key: 'userId') => string }): string {
  return c.get('userId');
}

export function getUserRole(c: { get: (key: 'userRole') => UserRole }): UserRole {
  return c.get('userRole');
}
