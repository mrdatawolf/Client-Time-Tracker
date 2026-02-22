import { eq, and, sql, desc } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { clients, autoInvoiceLog, appSettings } from '@ctt/shared/schema';
import { generateInvoice, getUnbilledHours } from './invoice-generator';

const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;

export interface AutoInvoiceResult {
  clientName: string;
  status: 'generated' | 'skipped_no_entries' | 'skipped_below_threshold' | 'skipped_already_exists' | 'error';
  invoiceNumber?: string;
  message?: string;
}

export interface AutoInvoiceCheckResult {
  generated: number;
  skipped: number;
  results: AutoInvoiceResult[];
}

/** Compute the billing period for a client based on their cycle and billing day. */
function computeBillingPeriod(
  billingCycle: string,
  billingDay: number,
  clientCreatedAt: Date,
  referenceDate: Date = new Date()
): { dateFrom: string; dateTo: string } | null {
  const today = new Date(referenceDate);
  today.setHours(0, 0, 0, 0);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  if (billingCycle === 'monthly') {
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const effectiveBillingDay = Math.min(billingDay, daysInMonth);

    if (today.getDate() !== effectiveBillingDay) return null;

    // Period: previous billing day to yesterday
    const periodEnd = new Date(year, month, effectiveBillingDay - 1);
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
    const prevEffectiveDay = Math.min(billingDay, daysInPrevMonth);
    const periodStart = new Date(prevYear, prevMonth, prevEffectiveDay);

    return { dateFrom: formatDate(periodStart), dateTo: formatDate(periodEnd) };
  }

  if (billingCycle === 'weekly') {
    // billingDay: 1=Monday ... 7=Sunday
    const todayDow = today.getDay() === 0 ? 7 : today.getDay();
    if (todayDow !== billingDay) return null;

    const periodEnd = new Date(today);
    periodEnd.setDate(periodEnd.getDate() - 1);
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 6);

    return { dateFrom: formatDate(periodStart), dateTo: formatDate(periodEnd) };
  }

  if (billingCycle === 'bi-weekly') {
    const todayDow = today.getDay() === 0 ? 7 : today.getDay();
    if (todayDow !== billingDay) return null;

    // Use client creation date as anchor for bi-weekly cadence
    const anchor = new Date(clientCreatedAt);
    anchor.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - anchor.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (diffWeeks % 2 !== 0) return null;

    const periodEnd = new Date(today);
    periodEnd.setDate(periodEnd.getDate() - 1);
    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 13);

    return { dateFrom: formatDate(periodStart), dateTo: formatDate(periodEnd) };
  }

  if (billingCycle === 'quarterly') {
    const year = today.getFullYear();
    const month = today.getMonth();
    const quarterMonths = [0, 3, 6, 9]; // Jan, Apr, Jul, Oct

    if (!quarterMonths.includes(month)) return null;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const effectiveBillingDay = Math.min(billingDay, daysInMonth);
    if (today.getDate() !== effectiveBillingDay) return null;

    const periodEnd = new Date(year, month, effectiveBillingDay - 1);
    const prevQuarterMonth = month - 3 < 0 ? month - 3 + 12 : month - 3;
    const prevQuarterYear = month - 3 < 0 ? year - 1 : year;
    const daysInPrevQMonth = new Date(prevQuarterYear, prevQuarterMonth + 1, 0).getDate();
    const prevEffectiveDay = Math.min(billingDay, daysInPrevQMonth);
    const periodStart = new Date(prevQuarterYear, prevQuarterMonth, prevEffectiveDay);

    return { dateFrom: formatDate(periodStart), dateTo: formatDate(periodEnd) };
  }

  return null;
}

/** Run the auto-invoice check for all eligible clients. */
export async function runAutoInvoiceCheck(referenceDate?: Date): Promise<AutoInvoiceCheckResult> {
  const db = await getDb();
  const results: AutoInvoiceResult[] = [];
  let generated = 0;
  let skipped = 0;

  // Get minimum hours threshold
  const settingsRows = await db.select().from(appSettings);
  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }
  const minHours = parseFloat(settings.autoInvoiceMinHours || '0.5');

  // Get all active clients with a billing cycle
  const eligibleClients = await db.select().from(clients)
    .where(and(
      eq(clients.isActive, true),
      sql`${clients.billingCycle} IS NOT NULL`,
    ));

  for (const client of eligibleClients) {
    const billingCycle = client.billingCycle!;
    const billingDay = Number(client.billingDay || 1);

    try {
      const period = computeBillingPeriod(billingCycle, billingDay, client.createdAt, referenceDate);

      if (!period) {
        continue; // Not a billing day for this client
      }

      // Check for duplicate: already generated for this period?
      const existingLog = await db.select().from(autoInvoiceLog)
        .where(and(
          eq(autoInvoiceLog.clientId, client.id),
          eq(autoInvoiceLog.billingPeriodStart, period.dateFrom),
          eq(autoInvoiceLog.billingPeriodEnd, period.dateTo),
          eq(autoInvoiceLog.status, 'generated'),
        ));

      if (existingLog.length > 0) {
        skipped++;
        results.push({
          clientName: client.name,
          status: 'skipped_already_exists',
          message: `Invoice already generated for period ${period.dateFrom} to ${period.dateTo}`,
        });
        continue;
      }

      // Check minimum hours threshold
      const unbilledHours = await getUnbilledHours(client.id, period.dateFrom, period.dateTo);
      if (unbilledHours < minHours) {
        skipped++;
        const result: AutoInvoiceResult = {
          clientName: client.name,
          status: unbilledHours === 0 ? 'skipped_no_entries' : 'skipped_below_threshold',
          message: `${unbilledHours.toFixed(2)} hours (threshold: ${minHours})`,
        };
        results.push(result);

        await db.insert(autoInvoiceLog).values({
          clientId: client.id,
          billingPeriodStart: period.dateFrom,
          billingPeriodEnd: period.dateTo,
          status: result.status,
          message: result.message || null,
        });
        continue;
      }

      // Generate the invoice
      const invoiceResult = await generateInvoice({
        clientId: client.id,
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        isAutoGenerated: true,
      });

      if (!invoiceResult) {
        skipped++;
        const result: AutoInvoiceResult = {
          clientName: client.name,
          status: 'skipped_no_entries',
          message: 'No unbilled entries found',
        };
        results.push(result);
        await db.insert(autoInvoiceLog).values({
          clientId: client.id,
          billingPeriodStart: period.dateFrom,
          billingPeriodEnd: period.dateTo,
          status: 'skipped_no_entries',
          message: 'No unbilled entries found',
        });
        continue;
      }

      generated++;
      const result: AutoInvoiceResult = {
        clientName: client.name,
        status: 'generated',
        invoiceNumber: invoiceResult.invoice.invoiceNumber,
        message: `${invoiceResult.lineItemCount} items, ${invoiceResult.totalHours.toFixed(2)} hours, $${invoiceResult.totalAmount.toFixed(2)}`,
      };
      results.push(result);

      await db.insert(autoInvoiceLog).values({
        clientId: client.id,
        invoiceId: invoiceResult.invoice.id,
        billingPeriodStart: period.dateFrom,
        billingPeriodEnd: period.dateTo,
        status: 'generated',
        message: result.message || null,
      });

      console.log(`[AutoInvoice] Generated ${invoiceResult.invoice.invoiceNumber} for ${client.name} (${period.dateFrom} to ${period.dateTo})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped++;
      results.push({
        clientName: client.name,
        status: 'error',
        message,
      });

      await db.insert(autoInvoiceLog).values({
        clientId: client.id,
        billingPeriodStart: '1970-01-01',
        billingPeriodEnd: '1970-01-01',
        status: 'error',
        message,
      });

      console.error(`[AutoInvoice] Error for ${client.name}: ${message}`);
    }
  }

  lastRunAt = new Date();

  if (generated > 0) {
    console.log(`[AutoInvoice] Check complete: ${generated} generated, ${skipped} skipped`);
  }

  return { generated, skipped, results };
}

/** Start the auto-invoice scheduler */
export function startAutoInvoiceScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  console.log(`[AutoInvoice] Starting scheduler (interval: ${CHECK_INTERVAL / 1000}s)`);

  // Run first check after a short delay (let server fully start)
  setTimeout(() => {
    runAutoInvoiceTick();
  }, 5000);

  intervalHandle = setInterval(runAutoInvoiceTick, CHECK_INTERVAL);
}

/** Stop the auto-invoice scheduler */
export function stopAutoInvoiceScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[AutoInvoice] Scheduler stopped');
}

/** Get scheduler status */
export function getAutoInvoiceSchedulerStatus() {
  return {
    running: intervalHandle !== null,
    lastRunAt: lastRunAt?.toISOString() || null,
  };
}

async function runAutoInvoiceTick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    await runAutoInvoiceCheck();
  } catch (error) {
    console.error('[AutoInvoice] Tick error:', error instanceof Error ? error.message : error);
  } finally {
    isRunning = false;
  }
}
