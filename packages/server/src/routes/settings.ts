import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { appSettings } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// Get all settings
app.get('/', requireAdmin(), async (c) => {
  const db = await getDb();
  const settings = await db.select().from(appSettings);

  // Convert to key-value object
  const result: Record<string, string> = {};
  for (const s of settings) {
    result[s.key] = s.value;
  }

  return c.json(result);
});

// Update settings (upsert)
app.put('/', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json() as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    const [existing] = await db.select().from(appSettings).where(eq(appSettings.key, key));

    if (existing) {
      await db.update(appSettings)
        .set({ value, updatedAt: new Date() })
        .where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  return c.json({ success: true });
});

export default app;
