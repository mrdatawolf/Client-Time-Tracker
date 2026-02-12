import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { clients } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// GET / - List all clients
route.get('/', async (c) => {
  const db = await getDb();
  const allClients = await db.query.clients.findMany({
    orderBy: (clients, { asc }) => [asc(clients.name)],
  });
  return c.json(allClients);
});

// POST / - Create a client
route.post('/', async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { name, accountHolder, notes } = body;

  if (!name) {
    return c.json({ error: 'Client name is required' }, 400);
  }

  const existing = await db.query.clients.findFirst({
    where: eq(clients.name, name),
  });
  if (existing) {
    return c.json({ error: 'Client name already exists' }, 409);
  }

  const [client] = await db.insert(clients).values({
    name,
    accountHolder: accountHolder || null,
    notes: notes || null,
  }).returning();

  return c.json(client, 201);
});

// GET /:id - Get a specific client
route.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, id),
  });

  if (!client) {
    return c.json({ error: 'Client not found' }, 404);
  }

  return c.json(client);
});

// PUT /:id - Update a client
route.put('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, accountHolder, isActive, notes } = body;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (accountHolder !== undefined) updateData.accountHolder = accountHolder;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (notes !== undefined) updateData.notes = notes;

  const [updated] = await db.update(clients)
    .set(updateData)
    .where(eq(clients.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Client not found' }, 404);
  }

  return c.json(updated);
});

// DELETE /:id - Deactivate a client
route.delete('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const [updated] = await db.update(clients)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Client not found' }, 404);
  }

  return c.json({ success: true });
});

export default route;
