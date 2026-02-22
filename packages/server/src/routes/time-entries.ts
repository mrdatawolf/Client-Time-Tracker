import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { timeEntries, rateTiers } from '@ctt/shared/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getUserId, getUserRole, isAtLeastAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// GET / - List time entries (filterable)
route.get('/', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);

  const clientId = c.req.query('clientId');
  const techId = c.req.query('techId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const isBilled = c.req.query('isBilled');

  const conditions = [];

  // Basic users can only see their own entries
  if (role === 'basic') {
    conditions.push(eq(timeEntries.techId, userId));
  } else if (techId) {
    conditions.push(eq(timeEntries.techId, techId));
  }

  if (clientId) conditions.push(eq(timeEntries.clientId, clientId));
  if (dateFrom) conditions.push(gte(timeEntries.date, dateFrom));
  if (dateTo) conditions.push(lte(timeEntries.date, dateTo));
  if (isBilled !== undefined) conditions.push(eq(timeEntries.isBilled, isBilled === 'true'));

  const entries = await db.query.timeEntries.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      client: true,
      tech: { columns: { id: true, username: true, displayName: true, role: true, isActive: true } },
      jobType: true,
      rateTier: true,
      invoice: { columns: { id: true, status: true } },
    },
    orderBy: (timeEntries, { desc }) => [desc(timeEntries.date)],
  });

  // Compute totals and derive invoicePaid from linked invoice status
  const result = entries.map(({ invoice, ...entry }) => ({
    ...entry,
    total: entry.rateTier
      ? String(parseFloat(entry.hours) * parseFloat(entry.rateTier.amount))
      : null,
    invoicePaid: invoice?.status === 'paid',
  }));

  return c.json(result);
});

// GET /grid - Get attendance grid data for a client + date range
route.get('/grid', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);

  const clientId = c.req.query('clientId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  if (!dateFrom || !dateTo) {
    return c.json({ error: 'dateFrom and dateTo are required' }, 400);
  }

  const conditions = [
    gte(timeEntries.date, dateFrom),
    lte(timeEntries.date, dateTo),
  ];

  if (clientId) {
    conditions.push(eq(timeEntries.clientId, clientId));
  }

  if (role === 'basic') {
    conditions.push(eq(timeEntries.techId, userId));
  }

  const entries = await db.query.timeEntries.findMany({
    where: and(...conditions),
    with: {
      client: { columns: { id: true, name: true } },
      tech: { columns: { id: true, displayName: true } },
      jobType: true,
      rateTier: true,
      invoice: { columns: { id: true, status: true } },
    },
    orderBy: (timeEntries, { asc }) => [asc(timeEntries.date)],
  });

  const result = entries.map(({ invoice, ...entry }) => ({
    ...entry,
    total: entry.rateTier
      ? String(parseFloat(entry.hours) * parseFloat(entry.rateTier.amount))
      : null,
    invoicePaid: invoice?.status === 'paid',
  }));

  return c.json(result);
});

// POST / - Create a time entry
route.post('/', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);
  const body = await c.req.json();

  const { clientId, techId, jobTypeId, rateTierId, date, hours, notes, groupId } = body;

  if (!clientId || !jobTypeId || !rateTierId || !date || !hours) {
    return c.json({ error: 'clientId, jobTypeId, rateTierId, date, and hours are required' }, 400);
  }

  // Basic users can only create entries for themselves
  const entryTechId = isAtLeastAdmin(role) && techId ? techId : userId;

  try {
    const [entry] = await db.insert(timeEntries).values({
      clientId,
      techId: entryTechId,
      jobTypeId,
      rateTierId,
      date,
      hours: String(hours),
      notes: notes || null,
      groupId: groupId || null,
    }).returning();

    return c.json(entry, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create time entry';
    console.error('Time entry creation failed:', msg);
    console.error('  Values:', JSON.stringify({ clientId, techId: entryTechId, jobTypeId, rateTierId, date, hours }));
    if (msg.includes('foreign key') || msg.includes('violates') || msg.includes('FOREIGN KEY')) {
      return c.json({ error: 'Invalid reference: one of the selected items (client, job type, or rate tier) does not exist.' }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});

// POST /bulk - Batch create time entries
route.post('/bulk', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);
  const body = await c.req.json();
  const { entries } = body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return c.json({ error: 'entries array is required' }, 400);
  }

  const values = entries.map((e: Record<string, unknown>) => ({
    clientId: e.clientId as string,
    techId: (isAtLeastAdmin(role) && e.techId ? e.techId : userId) as string,
    jobTypeId: e.jobTypeId as string,
    rateTierId: e.rateTierId as string,
    date: e.date as string,
    hours: String(e.hours),
    notes: (e.notes as string) || null,
    groupId: (e.groupId as string) || null,
  }));

  const created = await db.insert(timeEntries).values(values).returning();
  return c.json(created, 201);
});

// PUT /bulk - Batch update time entries (admin only - for marking billed/paid)
route.put('/bulk', async (c) => {
  const db = await getDb();
  const role = getUserRole(c);

  if (!isAtLeastAdmin(role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json();
  const { ids, updates } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.isBilled !== undefined) updateData.isBilled = updates.isBilled;
  if (updates.isPaid !== undefined) updateData.isPaid = updates.isPaid;

  const updated = [];
  for (const id of ids) {
    const [entry] = await db.update(timeEntries)
      .set(updateData)
      .where(eq(timeEntries.id, id))
      .returning();
    if (entry) updated.push(entry);
  }

  return c.json(updated);
});

// GET /:id - Get a specific time entry
route.get('/:id', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);
  const id = c.req.param('id');

  const entry = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
    with: {
      client: true,
      tech: { columns: { id: true, username: true, displayName: true, role: true, isActive: true } },
      jobType: true,
      rateTier: true,
    },
  });

  if (!entry) {
    return c.json({ error: 'Time entry not found' }, 404);
  }

  if (role === 'basic' && entry.techId !== userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json({
    ...entry,
    total: entry.rateTier
      ? String(parseFloat(entry.hours) * parseFloat(entry.rateTier.amount))
      : null,
  });
});

// PUT /:id - Update a time entry
route.put('/:id', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  // Verify ownership for basic users
  const existing = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Time entry not found' }, 404);
  }

  if (role === 'basic' && existing.techId !== userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { clientId, jobTypeId, rateTierId, date, hours, notes, isBilled, isPaid, groupId } = body;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (clientId !== undefined) updateData.clientId = clientId;
  if (jobTypeId !== undefined) updateData.jobTypeId = jobTypeId;
  if (rateTierId !== undefined) updateData.rateTierId = rateTierId;
  if (date !== undefined) updateData.date = date;
  if (hours !== undefined) updateData.hours = String(hours);
  if (notes !== undefined) updateData.notes = notes;
  if (groupId !== undefined) updateData.groupId = groupId;

  // Only admins+ can change billing status
  if (isAtLeastAdmin(role)) {
    if (isBilled !== undefined) updateData.isBilled = isBilled;
    if (isPaid !== undefined) updateData.isPaid = isPaid;
  }

  const [updated] = await db.update(timeEntries)
    .set(updateData)
    .where(eq(timeEntries.id, id))
    .returning();

  return c.json(updated);
});

// DELETE /:id - Delete a time entry
route.delete('/:id', async (c) => {
  const db = await getDb();
  const userId = getUserId(c);
  const role = getUserRole(c);
  const id = c.req.param('id');

  const existing = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Time entry not found' }, 404);
  }

  if (role === 'basic' && existing.techId !== userId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.delete(timeEntries).where(eq(timeEntries.id, id));
  return c.json({ success: true });
});

export default route;
