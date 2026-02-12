import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { payments, invoices } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// List payments
app.get('/', async (c) => {
  const db = await getDb();
  const invoiceId = c.req.query('invoiceId');

  const query = invoiceId
    ? db.select().from(payments).where(eq(payments.invoiceId, invoiceId))
    : db.select().from(payments);

  const results = await query.orderBy(desc(payments.datePaid));
  return c.json(results);
});

// Get single payment
app.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const [payment] = await db.select().from(payments).where(eq(payments.id, id));
  if (!payment) return c.json({ error: 'Payment not found' }, 404);

  return c.json(payment);
});

// Record payment
app.post('/', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();

  const [payment] = await db.insert(payments).values({
    invoiceId: body.invoiceId,
    amount: String(body.amount),
    datePaid: body.datePaid,
    method: body.method,
    notes: body.notes,
  }).returning();

  // Check if invoice is fully paid
  const allPayments = await db.select().from(payments)
    .where(eq(payments.invoiceId, body.invoiceId));

  const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  // Get invoice total from line items
  const { invoiceLineItems } = await import('@ctt/shared/schema');
  const lines = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, body.invoiceId));
  const invoiceTotal = lines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);

  if (totalPaid >= invoiceTotal) {
    await db.update(invoices)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(eq(invoices.id, body.invoiceId));
  }

  return c.json(payment, 201);
});

// Update payment
app.put('/:id', requireAdmin(), async (c) => {
  const db = await getDb();
  const id = c.req.param('id');
  const body = await c.req.json();

  const [updated] = await db.update(payments)
    .set({
      amount: body.amount ? String(body.amount) : undefined,
      datePaid: body.datePaid,
      method: body.method,
      notes: body.notes,
    })
    .where(eq(payments.id, id))
    .returning();

  if (!updated) return c.json({ error: 'Payment not found' }, 404);
  return c.json(updated);
});

// Delete payment
app.delete('/:id', requireAdmin(), async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const [deleted] = await db.delete(payments).where(eq(payments.id, id)).returning();
  if (!deleted) return c.json({ error: 'Payment not found' }, 404);

  return c.json({ success: true });
});

export default app;
