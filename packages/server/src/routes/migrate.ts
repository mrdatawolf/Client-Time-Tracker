import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// Excel import endpoint (placeholder - full implementation in Phase 5)
app.post('/import-excel', requireAdmin(), async (c) => {
  return c.json({
    error: 'Excel import not yet implemented. Use scripts/migrate-excel.ts for now.',
  }, 501);
});

export default app;
