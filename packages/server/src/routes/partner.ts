import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { partnerPayments, users, timeEntries, rateTiers, clients, appSettings } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// --- Splits (now stored as app_settings) ---

// Get current split config
app.get('/splits', requireAdmin(), async (c) => {
  const db = await getDb();
  const settings = await db.select().from(appSettings);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));

  return c.json({
    techPercent: Number(settingsMap.splitTechPercent || '73'),
    holderPercent: Number(settingsMap.splitHolderPercent || '27'),
  });
});

// Update split config
app.post('/splits', requireAdmin(), async (c) => {
  const db = await getDb();
  const body = await c.req.json();
  // body: { techPercent: number, holderPercent: number }

  const techPercent = Number(body.techPercent);
  const holderPercent = Number(body.holderPercent);

  if (isNaN(techPercent) || isNaN(holderPercent)) {
    return c.json({ error: 'techPercent and holderPercent must be numbers' }, 400);
  }
  if (Math.abs(techPercent + holderPercent - 100) > 0.01) {
    return c.json({ error: 'Percentages must sum to 100' }, 400);
  }

  await db.insert(appSettings)
    .values({ key: 'splitTechPercent', value: String(techPercent), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(techPercent), updatedAt: new Date() } });

  await db.insert(appSettings)
    .values({ key: 'splitHolderPercent', value: String(holderPercent), updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(holderPercent), updatedAt: new Date() } });

  return c.json({ techPercent, holderPercent }, 201);
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

// Partner summary: per-entry split calculation
app.get('/summary', requireAdmin(), async (c) => {
  const db = await getDb();
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');

  // Get split percentages from settings
  const settings = await db.select().from(appSettings);
  const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));
  const techPercent = Number(settingsMap.splitTechPercent || '73') / 100;
  const holderPercent = Number(settingsMap.splitHolderPercent || '27') / 100;

  // Get paid time entries in period with client and rate info
  const conditions = [eq(timeEntries.isPaid, true)];
  if (dateFrom) conditions.push(sql`${timeEntries.date} >= ${dateFrom}`);
  if (dateTo) conditions.push(sql`${timeEntries.date} <= ${dateTo}`);

  const entries = await db.select({
    entry: timeEntries,
    rate: rateTiers,
    client: clients,
  })
    .from(timeEntries)
    .innerJoin(rateTiers, eq(timeEntries.rateTierId, rateTiers.id))
    .innerJoin(clients, eq(timeEntries.clientId, clients.id))
    .where(and(...conditions));

  // Per-entry split calculation
  // Map: userId -> earned amount
  const earnings = new Map<string, number>();
  let totalRevenue = 0;

  for (const { entry, rate, client: clientRow } of entries) {
    const revenue = Number(entry.hours) * Number(rate.amount);
    totalRevenue += revenue;

    const techId = entry.techId;
    const holderId = clientRow.accountHolderId;

    if (!holderId || holderId === techId) {
      // No account holder, or tech IS the account holder → 100% to tech
      earnings.set(techId, (earnings.get(techId) || 0) + revenue);
    } else {
      // Different account holder → split
      earnings.set(techId, (earnings.get(techId) || 0) + revenue * techPercent);
      earnings.set(holderId, (earnings.get(holderId) || 0) + revenue * holderPercent);
    }
  }

  // Get settlement payments in period
  const settlementConditions: ReturnType<typeof sql>[] = [];
  if (dateFrom) settlementConditions.push(sql`${partnerPayments.datePaid} >= ${dateFrom}`);
  if (dateTo) settlementConditions.push(sql`${partnerPayments.datePaid} <= ${dateTo}`);

  const settlements = settlementConditions.length > 0
    ? await db.select().from(partnerPayments).where(and(...settlementConditions))
    : await db.select().from(partnerPayments);

  // Get partner names
  const partners = await db.select().from(users).where(eq(users.role, 'partner'));

  // Build summary for each partner who has earnings
  const summary = partners.map(partner => {
    const expectedShare = earnings.get(partner.id) || 0;

    const paidOut = settlements
      .filter(s => s.toPartnerId === partner.id)
      .reduce((sum, s) => sum + Number(s.amount), 0);

    const paidIn = settlements
      .filter(s => s.fromPartnerId === partner.id)
      .reduce((sum, s) => sum + Number(s.amount), 0);

    return {
      partnerId: partner.id,
      partnerName: partner.displayName,
      splitPercent: totalRevenue > 0 ? expectedShare / totalRevenue : 0,
      expectedShare,
      paidOut,
      paidIn,
      balance: expectedShare - paidOut + paidIn,
    };
  });

  return c.json({
    totalRevenue,
    splitConfig: { techPercent: techPercent * 100, holderPercent: holderPercent * 100 },
    period: { dateFrom, dateTo },
    partners: summary,
  });
});

export default app;
