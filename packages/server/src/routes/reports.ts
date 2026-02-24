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

// Partner Settlement Report: Calculates earnings and balances for each partner
app.get('/partner-settlement', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const localClient = (db as any)._.session.client;

  // 1. Get split settings
  const settingsRes = await localClient.query(`
    SELECT key, value FROM app_settings 
    WHERE key IN ('splitTechPercent', 'splitHolderPercent')
  `);
  const settings: Record<string, number> = {};
  settingsRes.rows.forEach((r: any) => {
    settings[r.key] = parseFloat(r.value) / 100;
  });

  const techSplit = settings.splitTechPercent || 0.73;
  const holderSplit = settings.splitHolderPercent || 0.27;

  // 2. Query all paid time entries and their splits
  const dateCondition = [];
  const params = [];
  if (dateFrom) {
    params.push(dateFrom);
    dateCondition.push(`te.date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    dateCondition.push(`te.date <= $${params.length}`);
  }

  const entriesQuery = `
    SELECT
      te.id,
      te.tech_id,
      c.account_holder_id,
      (CAST(te.hours AS NUMERIC) * CAST(rt.amount AS NUMERIC)) as revenue,
      u_tech.display_name as tech_name,
      u_holder.display_name as holder_name
    FROM time_entries te
    JOIN clients c ON te.client_id = c.id
    JOIN rate_tiers rt ON te.rate_tier_id = rt.id
    JOIN users u_tech ON te.tech_id = u_tech.id
    LEFT JOIN users u_holder ON c.account_holder_id = u_holder.id
    WHERE te.is_paid = true
    ${dateCondition.length > 0 ? `AND ${dateCondition.join(' AND ')}` : ''}
  `;

  const entriesRes = await localClient.query(entriesQuery, params);

  // 3. Query all partners (users with roles admin or partner)
  const partnersRes = await localClient.query(`
    SELECT id, display_name FROM users 
    WHERE role IN ('admin', 'partner') AND is_active = true
  `);

  // 4. Query payments made between partners
  const paymentsRes = await localClient.query(`
    SELECT to_partner_id, SUM(CAST(amount AS NUMERIC)) as total_paid
    FROM partner_payments
    GROUP BY to_partner_id
  `);

  const paymentMap = new Map();
  paymentsRes.rows.forEach((r: any) => paymentMap.set(r.to_partner_id, parseFloat(r.total_paid)));

  // 5. Aggregate data
  const report = new Map<string, { 
    id: string; 
    name: string; 
    earnedAsTech: number; 
    earnedAsHolder: number; 
    totalEarned: number;
    totalPaid: number;
    balance: number;
  }>();

  // Initialize with all active partners
  partnersRes.rows.forEach((p: any) => {
    report.set(p.id, {
      id: p.id,
      name: p.display_name,
      earnedAsTech: 0,
      earnedAsHolder: 0,
      totalEarned: 0,
      totalPaid: paymentMap.get(p.id) || 0,
      balance: 0
    });
  });

  // Calculate earnings from entries
  entriesRes.rows.forEach((row: any) => {
    const revenue = parseFloat(row.revenue);
    
    // Tech Earning
    if (report.has(row.tech_id)) {
      const p = report.get(row.tech_id)!;
      const share = row.tech_id === row.account_holder_id ? revenue : revenue * techSplit;
      p.earnedAsTech += share;
      p.totalEarned += share;
    }

    // Holder Earning (only if different from tech, or if we want to track it separately)
    // Note: If tech == holder, they already got 100% above.
    if (row.account_holder_id && row.tech_id !== row.account_holder_id && report.has(row.account_holder_id)) {
      const p = report.get(row.account_holder_id)!;
      const share = revenue * holderSplit;
      p.earnedAsHolder += share;
      p.totalEarned += share;
    }
  });

  // Calculate final balances
  const result = Array.from(report.values()).map(p => ({
    ...p,
    earnedAsTech: p.earnedAsTech.toFixed(2),
    earnedAsHolder: p.earnedAsHolder.toFixed(2),
    totalEarned: p.totalEarned.toFixed(2),
    totalPaid: p.totalPaid.toFixed(2),
    balance: (p.totalEarned - p.totalPaid).toFixed(2)
  }));

  return c.json(result);
});

// Aged Receivables Report: Categorizes unpaid invoices by age
app.get('/aged-receivables', requireAdmin(), async (c) => {
  const db = await getDb();
  const localClient = (db as any)._.session.client;

  const query = `
    WITH invoice_totals AS (
      SELECT 
        i.id,
        i.invoice_number,
        i.date_issued,
        i.client_id,
        cl.name as client_name,
        SUM(CAST(li.hours AS NUMERIC) * CAST(li.rate AS NUMERIC)) as total_amount
      FROM invoices i
      JOIN clients cl ON i.client_id = cl.id
      JOIN invoice_line_items li ON i.id = li.invoice_id
      WHERE i.status NOT IN ('paid', 'void')
      GROUP BY i.id, i.invoice_number, i.date_issued, i.client_id, cl.name
    ),
    invoice_payments AS (
      SELECT 
        invoice_id,
        SUM(CAST(amount AS NUMERIC)) as total_paid
      FROM payments
      GROUP BY invoice_id
    ),
    unpaid_invoices AS (
      SELECT
        it.id,
        it.invoice_number,
        it.date_issued,
        it.client_name,
        it.total_amount,
        COALESCE(ip.total_paid, 0) as total_paid,
        (it.total_amount - COALESCE(ip.total_paid, 0)) as balance,
        (CURRENT_DATE - it.date_issued) as days_old
      FROM invoice_totals it
      LEFT JOIN invoice_payments ip ON it.id = ip.invoice_id
    )
    SELECT 
      id,
      invoice_number,
      date_issued,
      client_name,
      balance,
      days_old,
      CASE 
        WHEN days_old <= 30 THEN 'current'
        WHEN days_old <= 60 THEN '31-60'
        WHEN days_old <= 90 THEN '61-90'
        ELSE '90+'
      END as bucket
    FROM unpaid_invoices
    WHERE balance > 0
    ORDER BY days_old DESC
  `;

  const res = await localClient.query(query);

  // Group by client for a summary view as well
  const clientSummary = new Map();
  res.rows.forEach((row: any) => {
    if (!clientSummary.has(row.client_name)) {
      clientSummary.set(row.client_name, { name: row.client_name, current: 0, thirtyToSixty: 0, sixtyToNinety: 0, ninetyPlus: 0, total: 0 });
    }
    const s = clientSummary.get(row.client_name);
    const bal = parseFloat(row.balance);
    s.total += bal;
    if (row.bucket === 'current') s.current += bal;
    else if (row.bucket === '31-60') s.thirtyToSixty += bal;
    else if (row.bucket === '61-90') s.sixtyToNinety += bal;
    else s.ninetyPlus += bal;
  });

  return c.json({
    invoices: res.rows.map((r: any) => ({
      ...r,
      dateIssued: r.date_issued instanceof Date ? r.date_issued.toISOString().split('T')[0] : String(r.date_issued).split('T')[0],
      clientName: r.client_name,
      invoiceNumber: r.invoice_number,
      daysOld: r.days_old
    })),
    summary: Array.from(clientSummary.values()).map(s => ({
      ...s,
      current: s.current.toFixed(2),
      thirtyToSixty: s.thirtyToSixty.toFixed(2),
      sixtyToNinety: s.sixtyToNinety.toFixed(2),
      ninetyPlus: s.ninetyPlus.toFixed(2),
      total: s.total.toFixed(2)
    }))
  });
});

// WIP Report: Tracks logged time that has not yet been billed
app.get('/wip', requireAdmin(), async (c) => {
  const db = await getDb();
  const localClient = (db as any)._.session.client;

  const query = `
    SELECT
      te.id,
      te.date,
      te.hours,
      te.client_id,
      cl.name as client_name,
      u.display_name as tech_name,
      rt.amount as rate,
      (CAST(te.hours AS NUMERIC) * CAST(rt.amount AS NUMERIC)) as revenue,
      (CURRENT_DATE - te.date) as days_old
    FROM time_entries te
    JOIN clients cl ON te.client_id = cl.id
    JOIN users u ON te.tech_id = u.id
    JOIN rate_tiers rt ON te.rate_tier_id = rt.id
    WHERE te.is_billed = false AND te.is_paid = false
    ORDER BY te.date ASC
  `;

  const res = await localClient.query(query);

  // Group by client
  const clientSummary = new Map();
  res.rows.forEach((row: any) => {
    if (!clientSummary.has(row.client_id)) {
      clientSummary.set(row.client_id, { 
        id: row.client_id,
        name: row.client_name, 
        totalHours: 0, 
        totalRevenue: 0, 
        staleHours: 0, 
        staleRevenue: 0,
        oldestEntryDate: row.date
      });
    }
    const s = clientSummary.get(row.client_id);
    const rev = parseFloat(row.revenue);
    const hrs = parseFloat(row.hours);
    
    s.totalHours += hrs;
    s.totalRevenue += rev;
    
    if (row.days_old > 30) {
      s.staleHours += hrs;
      s.staleRevenue += rev;
    }
  });

  return c.json({
    entries: res.rows.map((r: any) => ({
      ...r,
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0],
      clientName: r.client_name,
      techName: r.tech_name,
      daysOld: r.days_old
    })),
    summary: Array.from(clientSummary.values()).map(s => ({
      ...s,
      totalHours: s.totalHours.toFixed(2),
      totalRevenue: s.totalRevenue.toFixed(2),
      staleHours: s.staleHours.toFixed(2),
      staleRevenue: s.staleRevenue.toFixed(2),
      oldestEntryDate: s.oldestEntryDate instanceof Date ? s.oldestEntryDate.toISOString().split('T')[0] : String(s.oldestEntryDate).split('T')[0]
    }))
  });
});

// Effective Hourly Rate Report: Calculates revenue per hour for each client
app.get('/effective-rate', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const localClient = (db as any)._.session.client;

  const dateCondition = [];
  const params = [];
  if (dateFrom) {
    params.push(dateFrom);
    dateCondition.push(`te.date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    dateCondition.push(`te.date <= $${params.length}`);
  }

  const query = `
    SELECT
      cl.id as client_id,
      cl.name as client_name,
      SUM(CAST(te.hours AS NUMERIC)) as total_hours,
      SUM(CAST(te.hours AS NUMERIC) * CAST(rt.amount AS NUMERIC)) as total_revenue
    FROM time_entries te
    JOIN clients cl ON te.client_id = cl.id
    JOIN rate_tiers rt ON te.rate_tier_id = rt.id
    ${dateCondition.length > 0 ? `WHERE ${dateCondition.join(' AND ')}` : ''}
    GROUP BY cl.id, cl.name
    ORDER BY total_revenue DESC
  `;

  const res = await localClient.query(query, params);

  return c.json(res.rows.map((row: any) => {
    const hours = parseFloat(row.total_hours);
    const revenue = parseFloat(row.total_revenue);
    return {
      clientId: row.client_id,
      clientName: row.client_name,
      totalHours: hours.toFixed(2),
      totalRevenue: revenue.toFixed(2),
      effectiveRate: hours > 0 ? (revenue / hours).toFixed(2) : '0.00'
    };
  }));
});

// Tech Utilization Report: Analyzes tech performance and revenue yield
app.get('/tech-utilization', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  const localClient = (db as any)._.session.client;

  const dateCondition = [];
  const params = [];
  if (dateFrom) {
    params.push(dateFrom);
    dateCondition.push(`te.date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    dateCondition.push(`te.date <= $${params.length}`);
  }

  // Firm yield is typically the holder share (27%)
  const settingsRes = await localClient.query(`SELECT value FROM app_settings WHERE key = 'splitHolderPercent'`);
  const holderSplit = settingsRes.rows.length > 0 ? parseFloat(settingsRes.rows[0].value) / 100 : 0.27;

  const query = `
    SELECT
      u.id as tech_id,
      u.display_name as tech_name,
      SUM(CAST(te.hours AS NUMERIC)) as total_hours,
      SUM(CASE WHEN rt.amount > '0' THEN CAST(te.hours AS NUMERIC) ELSE 0 END) as billable_hours,
      SUM(CAST(te.hours AS NUMERIC) * CAST(rt.amount AS NUMERIC)) as total_revenue
    FROM users u
    JOIN time_entries te ON u.id = te.tech_id
    JOIN rate_tiers rt ON te.rate_tier_id = rt.id
    ${dateCondition.length > 0 ? `WHERE ${dateCondition.join(' AND ')}` : ''}
    GROUP BY u.id, u.display_name
    ORDER BY total_revenue DESC
  `;

  const res = await localClient.query(query, params);

  return c.json(res.rows.map((row: any) => {
    const totalHours = parseFloat(row.total_hours);
    const billableHours = parseFloat(row.billable_hours);
    const revenue = parseFloat(row.total_revenue);
    return {
      techId: row.tech_id,
      techName: row.tech_name,
      totalHours: totalHours.toFixed(2),
      billableHours: billableHours.toFixed(2),
      utilization: totalHours > 0 ? ((billableHours / totalHours) * 100).toFixed(1) : '0.00',
      totalRevenue: revenue.toFixed(2),
      firmYield: (revenue * holderSplit).toFixed(2)
    };
  }));
});

export default app;
