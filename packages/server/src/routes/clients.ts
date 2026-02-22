import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { clients } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// GET / - List all clients (with balance summaries)
route.get('/', async (c) => {
  const db = await getDb();
  const allClients = await db.query.clients.findMany({
    orderBy: (clients, { asc }) => [asc(clients.name)],
  });

  // Compute unbilled and billed-unpaid balances per client in a single query
  const localClient = (db as any)._.session.client;
  const balanceResult = await localClient.query(`
    SELECT
      te.client_id,
      COALESCE(SUM(CASE WHEN te.is_billed = false THEN te.hours * rt.amount ELSE 0 END), 0) AS unbilled_total,
      COALESCE(SUM(CASE WHEN te.is_billed = true AND (i.status IS NULL OR i.status NOT IN ('paid', 'void')) THEN te.hours * rt.amount ELSE 0 END), 0) AS billed_unpaid_total
    FROM time_entries te
    JOIN rate_tiers rt ON rt.id = te.rate_tier_id
    LEFT JOIN invoices i ON i.id = te.invoice_id
    WHERE te.is_paid = false
    GROUP BY te.client_id
  `);

  const balanceMap = new Map<string, { unbilledTotal: string; billedUnpaidTotal: string }>();
  for (const row of balanceResult.rows) {
    balanceMap.set(row.client_id, {
      unbilledTotal: row.unbilled_total,
      billedUnpaidTotal: row.billed_unpaid_total,
    });
  }

  const result = allClients.map(client => ({
    ...client,
    unbilledTotal: balanceMap.get(client.id)?.unbilledTotal || '0',
    billedUnpaidTotal: balanceMap.get(client.id)?.billedUnpaidTotal || '0',
  }));

  return c.json(result);
});

// POST / - Create a client
route.post('/', async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { name, accountHolder, accountHolderId, phone, mailingAddress, notes, defaultHourlyRate, invoicePayableTo, billingCycle, billingDay } = body;

  if (!name) {
    return c.json({ error: 'Client name is required' }, 400);
  }

  // Validate billing fields
  const validCycles = ['weekly', 'bi-weekly', 'monthly', 'quarterly'];
  if (billingCycle && !validCycles.includes(billingCycle)) {
    return c.json({ error: 'Invalid billing cycle' }, 400);
  }
  if (billingDay !== undefined && billingDay !== null) {
    const day = Number(billingDay);
    const maxDay = (billingCycle === 'weekly' || billingCycle === 'bi-weekly') ? 7 : 28;
    if (isNaN(day) || day < 1 || day > maxDay) {
      return c.json({ error: `Billing day must be between 1 and ${maxDay}` }, 400);
    }
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
    accountHolderId: accountHolderId || null,
    phone: phone || null,
    mailingAddress: mailingAddress || null,
    notes: notes || null,
    defaultHourlyRate: defaultHourlyRate || null,
    invoicePayableTo: invoicePayableTo || null,
    billingCycle: billingCycle || null,
    billingDay: billingCycle ? (billingDay || '1') : null,
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
  const { name, accountHolder, accountHolderId, phone, mailingAddress, isActive, notes, defaultHourlyRate, invoicePayableTo, billingCycle, billingDay } = body;

  // Validate billing fields
  if (billingCycle !== undefined && billingCycle !== null) {
    const validCycles = ['weekly', 'bi-weekly', 'monthly', 'quarterly'];
    if (!validCycles.includes(billingCycle)) {
      return c.json({ error: 'Invalid billing cycle' }, 400);
    }
  }
  if (billingDay !== undefined && billingDay !== null && billingCycle) {
    const day = Number(billingDay);
    const maxDay = (billingCycle === 'weekly' || billingCycle === 'bi-weekly') ? 7 : 28;
    if (isNaN(day) || day < 1 || day > maxDay) {
      return c.json({ error: `Billing day must be between 1 and ${maxDay}` }, 400);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name;
  if (accountHolder !== undefined) updateData.accountHolder = accountHolder;
  if (accountHolderId !== undefined) updateData.accountHolderId = accountHolderId;
  if (phone !== undefined) updateData.phone = phone;
  if (mailingAddress !== undefined) updateData.mailingAddress = mailingAddress;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (notes !== undefined) updateData.notes = notes;
  if (defaultHourlyRate !== undefined) updateData.defaultHourlyRate = defaultHourlyRate;
  if (invoicePayableTo !== undefined) updateData.invoicePayableTo = invoicePayableTo;
  if (billingCycle !== undefined) {
    updateData.billingCycle = billingCycle;
    // Clear billingDay if cycle is cleared
    if (!billingCycle) {
      updateData.billingDay = null;
    }
  }
  if (billingDay !== undefined) updateData.billingDay = billingDay;

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
