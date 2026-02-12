import { Hono } from 'hono';
import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { timeEntries, rateTiers, clients, users, jobTypes } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import { getUserId, getUserRole } from '../middleware/auth';
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
  })
    .from(timeEntries)
    .innerJoin(clients, eq(timeEntries.clientId, clients.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Group by client
  const grouped = new Map<string, { clientId: string; clientName: string; totalHours: number; totalRevenue: number; entryCount: number }>();

  for (const entry of entries) {
    const existing = grouped.get(entry.clientId) || {
      clientId: entry.clientId,
      clientName: entry.clientName,
      totalHours: 0,
      totalRevenue: 0,
      entryCount: 0,
    };
    existing.totalHours += Number(entry.hours);
    existing.totalRevenue += Number(entry.hours) * Number(entry.rate);
    existing.entryCount += 1;
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
  })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.techId, users.id))
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  // Group by tech
  const grouped = new Map<string, { techId: string; techName: string; totalHours: number; totalRevenue: number; entryCount: number }>();

  for (const entry of entries) {
    const existing = grouped.get(entry.techId) || {
      techId: entry.techId,
      techName: entry.techName,
      totalHours: 0,
      totalRevenue: 0,
      entryCount: 0,
    };
    existing.totalHours += Number(entry.hours);
    existing.totalRevenue += Number(entry.hours) * Number(entry.rate);
    existing.entryCount += 1;
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
  if (role !== 'admin') {
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
  if (role !== 'admin') {
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

export default app;
