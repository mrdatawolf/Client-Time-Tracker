import { Hono } from 'hono';
import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { timeEntries, rateTiers, clients, users, jobTypes, invoices, invoiceLineItems, payments } from '@ctt/shared/schema';
import { requireAdmin, getUserId, getUserRole, isAtLeastAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// Client summary: hours and revenue by client
app.get('/client-summary', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const conditions = [];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);

  const entries = await db.select({
    clientId: timeEntries.clientId,
    clientName: clients.name,
    hours: timeEntries.hours,
    rate: rateTiers.amount,
    isBilled: timeEntries.isBilled,
    isPaid: timeEntries.isPaid,
  })
    .from(timeEntries)
    .innerJoin(clients, eq(timeEntries.clientId, clients.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Group by client
  const grouped = new Map<string, { clientId: string; clientName: string; totalHours: number; totalRevenue: number; entryCount: number; unbilledCount: number; billedCount: number; paidCount: number }>();

  for (const entry of entries) {
    const existing = grouped.get(entry.clientId) || {
      clientId: entry.clientId,
      clientName: entry.clientName,
      totalHours: 0,
      totalRevenue: 0,
      entryCount: 0,
      unbilledCount: 0,
      billedCount: 0,
      paidCount: 0,
    };
    existing.totalHours += Number(entry.hours);
    existing.totalRevenue += Number(entry.hours) * Number(entry.rate);
    existing.entryCount += 1;
    if (entry.isPaid) {
      existing.paidCount += 1;
    } else if (entry.isBilled) {
      existing.billedCount += 1;
    } else {
      existing.unbilledCount += 1;
    }
    grouped.set(entry.clientId, existing);
  }

  return c.json(Array.from(grouped.values()));
});

// Tech summary: hours and revenue by tech
app.get('/tech-summary', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const conditions = [];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);

  const entries = await db.select({
    techId: timeEntries.techId,
    techName: users.displayName,
    hours: timeEntries.hours,
    rate: rateTiers.amount,
    isBilled: timeEntries.isBilled,
    isPaid: timeEntries.isPaid,
  })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.techId, users.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Group by tech
  const grouped = new Map<string, { techId: string; techName: string; totalHours: number; totalRevenue: number; entryCount: number; unbilledCount: number; billedCount: number; paidCount: number }>();

  for (const entry of entries) {
    const existing = grouped.get(entry.techId) || {
      techId: entry.techId,
      techName: entry.techName,
      totalHours: 0,
      totalRevenue: 0,
      entryCount: 0,
      unbilledCount: 0,
      billedCount: 0,
      paidCount: 0,
    };
    existing.totalHours += Number(entry.hours);
    existing.totalRevenue += Number(entry.hours) * Number(entry.rate);
    existing.entryCount += 1;
    if (entry.isPaid) {
      existing.paidCount += 1;
    } else if (entry.isBilled) {
      existing.billedCount += 1;
    } else {
      existing.unbilledCount += 1;
    }
    grouped.set(entry.techId, existing);
  }

  return c.json(Array.from(grouped.values()));
});

// Date range report: all entries in a date range
app.get('/date-range', async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const clientId = c.req.query('clientId');

  const conditions = [];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);
  if (clientId) conditions.push(eq(timeEntries.clientId, clientId));

  // Basic users can only see their own entries
  const role = getUserRole(c);
  if (!isAtLeastAdmin(role)) {
    conditions.push(eq(timeEntries.techId, getUserId(c)));
  }

  const entries = await db.select({
    entry: timeEntries,
    clientName: clients.name,
    techName: users.displayName,
    jobTypeName: jobTypes.name,
    rate: rateTiers.amount,
  })
    .from(timeEntries)
    .innerJoin(clients, eq(timeEntries.clientId, clients.id))
    .innerJoin(users, eq(timeEntries.techId, users.id))
    .innerJoin(jobTypes, eq(timeEntries.jobTypeId, jobTypes.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(timeEntries.date));

  return c.json(entries.map(e => ({
    ...e.entry,
    clientName: e.clientName,
    techName: e.techName,
    jobTypeName: e.jobTypeName,
    rate: e.rate,
    total: (Number(e.entry.hours) * Number(e.rate)).toFixed(2),
  })));
});

// CSV export
app.get('/export', async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const clientId = c.req.query('clientId');

  const conditions = [];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);
  if (clientId) conditions.push(eq(timeEntries.clientId, clientId));

  const role = getUserRole(c);
  if (!isAtLeastAdmin(role)) {
    conditions.push(eq(timeEntries.techId, getUserId(c)));
  }

  const entries = await db.select({
    date: timeEntries.date,
    clientName: clients.name,
    techName: users.displayName,
    jobTypeName: jobTypes.name,
    hours: timeEntries.hours,
    rate: rateTiers.amount,
    notes: timeEntries.notes,
    isBilled: timeEntries.isBilled,
    isPaid: timeEntries.isPaid,
  })
    .from(timeEntries)
    .innerJoin(clients, eq(timeEntries.clientId, clients.id))
    .innerJoin(users, eq(timeEntries.techId, users.id))
    .innerJoin(jobTypes, eq(timeEntries.jobTypeId, jobTypes.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(timeEntries.date));

  // Build CSV
  const headers = ['Date', 'Client', 'Tech', 'Job Type', 'Hours', 'Rate', 'Total', 'Notes', 'Billed', 'Paid'];
  const rows = entries.map(e => [
    e.date,
    e.clientName,
    e.techName,
    e.jobTypeName,
    e.hours,
    e.rate,
    (Number(e.hours) * Number(e.rate)).toFixed(2),
    (e.notes || '').replace(/,/g, ';'),
    e.isBilled ? 'Yes' : 'No',
    e.isPaid ? 'Yes' : 'No',
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="time-report-${dateFrom || 'all'}-${dateTo || 'all'}.csv"`,
    },
  });
});

// Balance report: outstanding (unbilled + billed-unpaid) entries for a client
app.get('/balance', requireAdmin(), async (c) => {
  const db = await getDb();
  const clientId = c.req.query('clientId');
  const filter = c.req.query('filter') || 'all'; // 'all' | 'unbilled' | 'unpaid' | 'paid'

  if (!clientId) {
    return c.json({ error: 'clientId is required' }, 400);
  }

  const localClient = (db as any)._.session.client;

  let statusCondition = '';
  if (filter === 'unbilled') {
    statusCondition = 'AND te.is_paid = false AND te.is_billed = false';
  } else if (filter === 'unpaid') {
    statusCondition = 'AND te.is_paid = false AND te.is_billed = true AND (i.status IS NULL OR i.status NOT IN (\'paid\', \'void\'))';
  } else if (filter === 'paid') {
    statusCondition = 'AND te.is_paid = true';
  } else {
    // all outstanding (default)
    statusCondition = `AND te.is_paid = false AND (
      te.is_billed = false
      OR (te.is_billed = true AND (i.status IS NULL OR i.status NOT IN ('paid', 'void')))
    )`;
  }

  const result = await localClient.query(`
    SELECT
      te.id,
      te.date,
      te.hours,
      te.notes,
      te.is_billed,
      te.is_paid,
      te.invoice_id,
      te.rate_tier_id,
      te.job_type_id,
      rt.amount AS rate,
      u.display_name AS tech_name,
      jt.name AS job_type_name,
      cl.name AS client_name,
      i.invoice_number,
      i.status AS invoice_status,
      (CAST(te.hours AS NUMERIC) * CAST(rt.amount AS NUMERIC)) AS total
    FROM time_entries te
    JOIN rate_tiers rt ON rt.id = te.rate_tier_id
    JOIN users u ON u.id = te.tech_id
    JOIN job_types jt ON jt.id = te.job_type_id
    JOIN clients cl ON cl.id = te.client_id
    LEFT JOIN invoices i ON i.id = te.invoice_id
    WHERE te.client_id = $1
    ${statusCondition}
    ORDER BY te.date DESC
  `, [clientId]);

  return c.json(result.rows.map((row: any) => ({
    id: row.id,
    date: row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0],
    clientName: row.client_name,
    techName: row.tech_name,
    jobTypeName: row.job_type_name,
    hours: row.hours,
    rate: row.rate,
    total: Number(row.total).toFixed(2),
    notes: row.notes,
    isBilled: row.is_billed,
    isPaid: row.is_paid,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    invoiceStatus: row.invoice_status,
    rateTierId: row.rate_tier_id,
    jobTypeId: row.job_type_id,
  })));
});

// Mark an invoice as paid (quick action from balance report)
app.post('/balance/mark-paid', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  const { invoiceId } = body;

  if (!invoiceId) {
    return c.json({ error: 'invoiceId is required' }, 400);
  }

  // Get invoice
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) {
    return c.json({ error: 'Invoice not found' }, 404);
  }
  if (invoice.status === 'paid') {
    return c.json({ error: 'Invoice is already paid' }, 400);
  }

  // Compute invoice total from line items
  const lines = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));
  const invoiceTotal = lines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);

  // Get existing payments
  const existingPayments = await db.select().from(payments)
    .where(eq(payments.invoiceId, invoiceId));
  const totalPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount), 0);

  const remaining = invoiceTotal - totalPaid;

  if (remaining > 0) {
    // Record a payment for the remaining amount
    await db.insert(payments).values({
      invoiceId,
      amount: String(remaining.toFixed(2)),
      datePaid: new Date().toISOString().split('T')[0],
      method: null,
      notes: 'Marked as paid from balance report',
    });
  }

  // Mark invoice as paid
  await db.update(invoices)
    .set({ status: 'paid', updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  return c.json({ success: true });
});

export default app;
