import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { jobTypes } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

route.get('/', async (c) => {
  const db = await getDb();
  const all = await db.query.jobTypes.findMany({
    orderBy: (jobTypes, { asc }) => [asc(jobTypes.name)],
  });
  return c.json(all);
});

route.post('/', async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { name, description } = body;

  if (!name) {
    return c.json({ error: 'Job type name is required' }, 400);
  }

  const [item] = await db.insert(jobTypes).values({
    name,
    description: description || null,
  }).returning();

  return c.json(item, 201);
});

route.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const item = await db.query.jobTypes.findFirst({ where: eq(jobTypes.id, id) });
  if (!item) return c.json({ error: 'Not found' }, 404);
  return c.json(item);
});

route.put('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, description, isActive } = body;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [updated] = await db.update(jobTypes).set(updateData).where(eq(jobTypes.id, id)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

route.delete('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [updated] = await db.update(jobTypes).set({ isActive: false }).where(eq(jobTypes.id, id)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

export default route;
