import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { rateTiers } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

route.get('/', async (c) => {
  const db = await getDb();
  const all = await db.query.rateTiers.findMany({
    orderBy: (rateTiers, { asc }) => [asc(rateTiers.amount)],
  });
  return c.json(all);
});

route.post('/', async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { amount, label } = body;

  if (amount === undefined) {
    return c.json({ error: 'Amount is required' }, 400);
  }

  const [item] = await db.insert(rateTiers).values({
    amount: String(amount),
    label: label || null,
  }).returning();

  return c.json(item, 201);
});

route.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const item = await db.query.rateTiers.findFirst({ where: eq(rateTiers.id, id) });
  if (!item) return c.json({ error: 'Not found' }, 404);
  return c.json(item);
});

route.put('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();
  const { amount, label, isActive } = body;

  const updateData: Record<string, unknown> = {};
  if (amount !== undefined) updateData.amount = String(amount);
  if (label !== undefined) updateData.label = label;
  if (isActive !== undefined) updateData.isActive = isActive;

  const [updated] = await db.update(rateTiers).set(updateData).where(eq(rateTiers.id, id)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

route.delete('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const [updated] = await db.update(rateTiers).set({ isActive: false }).where(eq(rateTiers.id, id)).returning();
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

export default route;
