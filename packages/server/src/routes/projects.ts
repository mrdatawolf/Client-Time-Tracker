import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { projects } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// GET / - List all projects (with client relation)
route.get('/', async (c) => {
  const db = await getDb();
  const all = await db.query.projects.findMany({
    with: { client: true },
    orderBy: (projects, { asc }) => [asc(projects.createdAt)],
  });
  return c.json(all);
});

// POST / - Create a project
route.post('/', async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { clientId, name, status, assignedTo, note } = body;

  if (!clientId || !name) {
    return c.json({ error: 'Client and project name are required' }, 400);
  }

  const [project] = await db.insert(projects).values({
    clientId,
    name,
    status: status || 'in_progress',
    assignedTo: assignedTo || null,
    note: note || null,
  }).returning();

  return c.json(project, 201);
});

// PUT /:id - Update a project
route.put('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, status, assignedTo, note, isActive, clientId } = body;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (status !== undefined) updateData.status = status;
  if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
  if (note !== undefined) updateData.note = note;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (clientId !== undefined) updateData.clientId = clientId;

  const [updated] = await db.update(projects)
    .set(updateData)
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json(updated);
});

// DELETE /:id - Soft delete a project
route.delete('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const [updated] = await db.update(projects)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();

  if (!updated) {
    return c.json({ error: 'Project not found' }, 404);
  }

  return c.json({ success: true });
});

export default route;
