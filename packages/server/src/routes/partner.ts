import { Hono } from 'hono';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { partnerSplits, partnerPayments, users, timeEntries, rateTiers } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// --- Splits ---

// Get current splits
app.get('/splits', requireAdmin(), async (c) => {
  const db = await getDb();
  const splits = await db.select({
    split: partnerSplits,
    partner: users,
  })
    .from(partnerSplits)
    .innerJoin(users, eq(partnerSplits.partnerId, users.id))
    .where(isNull(partnerSplits.effectiveTo))
    .orderBy(desc(partnerSplits.splitPercent));

  return c.json(splits.map(s => ({
    ...s.split,
    partnerName: s.partner.displayName,
  })));
});

// Create new split (closes existing one)
app.post('/splits', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  // body: { splits: [{ partnerId, splitPercent }], effectiveFrom }

  // Close current splits
  await db.update(partnerSplits)
    .set({ effectiveTo: body.effectiveFrom })
    .where(isNull(partnerSplits.effectiveTo));

  // Create new splits
  const created = [];
  for (const split of body.splits) {
    const [row] = await db.insert(partnerSplits).values({
      partnerId: split.partnerId,
      splitPercent: String(split.splitPercent),
      effectiveFrom: body.effectiveFrom,
    }).returning();
    created.push(row);
  }

  return c.json(created, 201);
});

// --- Settlements ---

// Get settlement history
app.get('/settlements', requireAdmin(), async (c) => {
  const db = await getDb();
  const settlements = await db.select().from(partnerPayments)
    .orderBy(desc(partnerPayments.datePaid));

  return c.json(settlements);
});

// Record a settlement payment
app.post('/settlements', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();

  const [payment] = await db.insert(partnerPayments).values({
    fromPartnerId: body.fromPartnerId,
    toPartnerId: body.toPartnerId,
    amount: String(body.amount),
    datePaid: body.datePaid,
    notes: body.notes,
  }).returning();

  return c.json(payment, 201);
});

// --- Summary ---

// Partner summary: who owes whom
app.get('/summary', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  // Get current splits
  const currentSplits = await db.select()
    .from(partnerSplits)
    .where(isNull(partnerSplits.effectiveTo));

  // Get total revenue in period
  const conditions = [eq(timeEntries.isPaid, true)];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);

  const entries = await db.select({
    entry: timeEntries,
    rate: rateTiers,
  })
    .from(timeEntries)
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .where(and(...conditions));

  const totalRevenue = entries.reduce((sum, { entry, rate }) => {
    return sum + Number(entry.hours) * Number(rate.amount);
  }, 0);

  // Get settlement payments in period
  const settlementConditions = [];
  if (dateFrom) settlementConditions.push(sql`${partnerPayments.datePaid} >= ${dateFrom}`);
  if (dateTo) settlementConditions.push(sql`${partnerPayments.datePaid} <= ${dateTo}`);

  const settlements = settlementConditions.length > 0
    ? await db.select().from(partnerPayments).where(and(...settlementConditions))
    : await db.select().from(partnerPayments);

  // Get partner names
  const partners = await db.select().from(users).where(eq(users.role, 'admin'));

  // Calculate expected splits
  const summary = currentSplits.map(split => {
    const partner = partners.find(p => p.id === split.partnerId);
    const expectedShare = totalRevenue * Number(split.splitPercent);

    const paidOut = settlements
      .filter(s => s.toPartnerId === split.partnerId)
      .reduce((sum, s) => sum + Number(s.amount), 0);

    const paidIn = settlements
      .filter(s => s.fromPartnerId === split.partnerId)
      .reduce((sum, s) => sum + Number(s.amount), 0);

    return {
      partnerId: split.partnerId,
      partnerName: partner?.displayName || 'Unknown',
      splitPercent: Number(split.splitPercent),
      expectedShare,
      paidOut,
      paidIn,
      balance: expectedShare - paidOut + paidIn,
    };
  });

  return c.json({
    totalRevenue,
    period: { dateFrom, dateTo },
    partners: summary,
  });
});

export default app;
