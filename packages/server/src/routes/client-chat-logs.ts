import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { clientChatLogs } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// GET /:clientId - Get chat log for a client
route.get('/:clientId', async (c) => {
  const db = await getDb();
  const clientId = c.req.param('clientId');

  const log = await db.query.clientChatLogs.findFirst({
    where: eq(clientChatLogs.clientId, clientId),
  });

  return c.json(log || { clientId, content: '' });
});

// PUT /:clientId - Upsert chat log for a client
route.put('/:clientId', async (c) => {
  const db = await getDb();
  const clientId = c.req.param('clientId');
  const body = await c.req.json();
  const { content } = body;

  if (content === undefined) {
    return c.json({ error: 'Content is required' }, 400);
  }

  // Check if log exists
  const existing = await db.query.clientChatLogs.findFirst({
    where: eq(clientChatLogs.clientId, clientId),
  });

  if (existing) {
    const [updated] = await db.update(clientChatLogs)
      .set({ content, updatedAt: new Date() })
      .where(eq(clientChatLogs.clientId, clientId))
      .returning();
    return c.json(updated);
  } else {
    const [created] = await db.insert(clientChatLogs)
      .values({ clientId, content })
      .returning();
    return c.json(created, 201);
  }
});

export default route;
