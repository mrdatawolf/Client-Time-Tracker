import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { invoices, invoiceLineItems, timeEntries, rateTiers, clients } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// List invoices (with client + computed total)
app.get('/', async (c) => {
  const db = await getDb();
  const clientId = c.req.query('clientId');
  const status = c.req.query('status');

  const conditions = [];
  if (clientId) conditions.push(eq(invoices.clientId, clientId));
  if (status) conditions.push(eq(invoices.status, status));

  // Get invoices with client join
  const rows = await db
    .select({
      invoice: invoices,
      client: clients,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(invoices.dateIssued));

  // For each invoice, compute total from line items
  const results = await Promise.all(rows.map(async ({ invoice, client }) => {
    const lines = await db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice.id));
    const total = lines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);
    return { ...invoice, client, total };
  }));

  return c.json(results);
});

// Get single invoice with line items and client
app.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const rows = await db
    .select({ invoice: invoices, client: clients })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, id));

  if (rows.length === 0) return c.json({ error: 'Invoice not found' }, 404);
  const { invoice, client } = rows[0];

  const lines = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id));

  const total = lines.reduce((sum, line) => {
    return sum + Number(line.hours) * Number(line.rate);
  }, 0);

  return c.json({ ...invoice, client, lineItems: lines, total });
});

// Create invoice
app.post('/', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();

  const [invoice] = await db.insert(invoices).values({
    clientId: body.clientId,
    invoiceNumber: body.invoiceNumber,
    dateIssued: body.dateIssued,
    dateDue: body.dateDue,
    status: body.status || 'draft',
    notes: body.notes,
  }).returning();

  return c.json(invoice, 201);
});

// Generate invoice from unbilled time entries
app.post('/generate', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { clientId, dateFrom, dateTo } = body;

  // Get unbilled entries for this client
  const conditions = [
    eq(timeEntries.clientId, clientId),
    eq(timeEntries.isBilled, false),
  ];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);

  const unbilled = await db.select({
    entry: timeEntries,
    rate: rateTiers,
  })
    .from(timeEntries)
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(and(...conditions));

  if (unbilled.length === 0) {
    return c.json({ error: 'No unbilled entries found' }, 400);
  }

  // Generate invoice number
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  const prefix = (client?.name || 'INV').substring(0, 3).toUpperCase();
  const invoiceNumber = `${prefix}-${Date.now().toString(36).toUpperCase()}`;

  // Create the invoice
  const [invoice] = await db.insert(invoices).values({
    clientId,
    invoiceNumber,
    dateIssued: new Date().toISOString().split('T')[0],
    dateDue: body.dateDue,
    status: 'draft',
    notes: body.notes,
  }).returning();

  // Create line items from entries
  for (const { entry, rate } of unbilled) {
    await db.insert(invoiceLineItems).values({
      invoiceId: invoice.id,
      timeEntryId: entry.id,
      description: `${entry.date} - ${entry.hours}h`,
      hours: entry.hours,
      rate: rate.amount,
    });

    // Mark entry as billed
    await db.update(timeEntries)
      .set({ isBilled: true, invoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(timeEntries.id, entry.id));
  }

  return c.json(invoice, 201);
});

// Update invoice
app.put('/:id', requireAdmin(), async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();

  const [updated] = await db.update(invoices)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, id))
    .returning();

  if (!updated) return c.json({ error: 'Invoice not found' }, 404);
  return c.json(updated);
});

// Delete invoice (and unlink entries)
app.delete('/:id', requireAdmin(), async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  // Unmark entries as billed
  await db.update(timeEntries)
    .set({ isBilled: false, invoiceId: null, updatedAt: new Date() })
    .where(eq(timeEntries.invoiceId, id));

  // Delete line items
  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));

  // Delete invoice
  const [deleted] = await db.delete(invoices).where(eq(invoices.id, id)).returning();
  if (!deleted) return c.json({ error: 'Invoice not found' }, 404);

  return c.json({ success: true });
});

export default app;
