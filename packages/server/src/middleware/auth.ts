import { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/jwt';
import type { AppEnv } from '../types';

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
    if (c.get('userRole') !== 'admin') {
      return c.json({ error: 'Forbidden', message: 'Admin access required' }, 403);
    }
    await next();
  };
};

export function getUserId(c: { get: (key: 'userId') => string }): string {
  return c.get('userId');
}

export function getUserRole(c: { get: (key: 'userRole') => 'admin' | 'basic' }): 'admin' | 'basic' {
  return c.get('userRole');
}
