import { Hono } from 'hono';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '@ctt/shared/db';
import { invoices, invoiceLineItems, timeEntries, rateTiers, clients, appSettings, users, autoInvoiceLog } from '@ctt/shared/schema';
import { requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';
import PDFDocument from 'pdfkit';
import { generateInvoice } from '../lib/invoice-generator';
import { runAutoInvoiceCheck } from '../lib/auto-invoice-scheduler';

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

// Download invoice as PDF
app.get('/:id/pdf', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  // Get invoice with client
  const rows = await db
    .select({ invoice: invoices, client: clients })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, id));

  if (rows.length === 0) return c.json({ error: 'Invoice not found' }, 404);
  const { invoice, client } = rows[0];

  // Get line items
  const lines = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id));

  const total = lines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);

  // Get company settings
  const settingsRows = await db.select().from(appSettings);
  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  const companyName = settings.companyName || 'Lost Coast IT';
  const payableTo = client.invoicePayableTo || settings.invoicePayableTo || 'Patrick, Moon\n6336 Purdue Dr. Eureka, Ca 95503';

  // Format date
  function formatInvoiceDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Build PDF
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pdfReady = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // --- Header ---
  doc.fontSize(24).font('Helvetica-Bold').text(companyName, 50, 50);
  doc.moveDown(1.5);

  // Date and invoice number (right-aligned)
  const headerY = doc.y;
  doc.fontSize(10).font('Helvetica')
    .text(formatInvoiceDate(invoice.dateIssued), 50, headerY)
    .text(`Invoice No. ${invoice.invoiceNumber}`, 50, headerY + 14);

  // --- INVOICE title ---
  doc.moveDown(1.5);
  doc.fontSize(20).font('Helvetica-Bold').text('INVOICE');
  doc.moveDown(0.5);

  // Client info
  doc.fontSize(11).font('Helvetica-Bold').text(client.name);
  if (client.phone) {
    doc.fontSize(10).font('Helvetica').text(client.phone);
  }
  if (client.mailingAddress) {
    doc.fontSize(10).font('Helvetica').text(client.mailingAddress);
  }

  doc.moveDown(1.5);

  // --- Line Items Table ---
  const tableTop = doc.y;
  const colDesc = 50;
  const colHrs = 330;
  const colRate = 410;
  const colTotal = 490;

  // Table header
  doc.fontSize(9).font('Helvetica-Bold')
    .text('DESCRIPTION OF WORK', colDesc, tableTop)
    .text('QTY/HRS', colHrs, tableTop)
    .text('UNIT PRICE', colRate, tableTop)
    .text('SUB TOTAL', colTotal, tableTop);

  doc.moveTo(50, tableTop + 14).lineTo(562, tableTop + 14).lineWidth(0.5).stroke();

  let rowY = tableTop + 22;
  doc.font('Helvetica').fontSize(10);

  for (const line of lines) {
    const lineTotal = Number(line.hours) * Number(line.rate);
    const desc = line.description || '';

    // Wrap long descriptions
    const descHeight = doc.heightOfString(desc, { width: 270 });
    const rowHeight = Math.max(descHeight, 16);

    if (rowY + rowHeight > 680) {
      doc.addPage();
      rowY = 50;
    }

    doc.text(desc, colDesc, rowY, { width: 270 });
    doc.text(Number(line.hours).toFixed(2), colHrs, rowY, { width: 70 });
    doc.text(`$${Number(line.rate).toFixed(2)}`, colRate, rowY, { width: 70 });
    doc.text(`$${lineTotal.toFixed(2)}`, colTotal, rowY, { width: 70, align: 'right' });

    rowY += rowHeight + 6;
  }

  // Notes
  if (invoice.notes) {
    rowY += 6;
    doc.fontSize(9).font('Helvetica-Oblique').text(invoice.notes, colDesc, rowY, { width: 400 });
    rowY += doc.heightOfString(invoice.notes, { width: 400 }) + 10;
  }

  // --- Grand Total ---
  rowY += 10;
  doc.moveTo(50, rowY).lineTo(562, rowY).lineWidth(0.5).stroke();
  rowY += 10;
  doc.fontSize(12).font('Helvetica-Bold')
    .text('GRAND TOTAL', colDesc, rowY)
    .text(`$${total.toFixed(2)}`, colTotal, rowY, { width: 70, align: 'right' });

  // --- Payable To ---
  rowY += 40;
  doc.fontSize(10).font('Helvetica-Bold').text('PAYABLE TO', colDesc, rowY);
  rowY += 16;
  doc.fontSize(10).font('Helvetica').text(payableTo, colDesc, rowY);

  doc.end();

  const pdfBuffer = await pdfReady;

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    },
  });
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
  const body = await c.req.json();
  const { clientId, dateFrom, dateTo } = body;

  const result = await generateInvoice({
    clientId,
    dateFrom,
    dateTo,
    dateDue: body.dateDue,
    notes: body.notes,
  });

  if (!result) {
    return c.json({ error: 'No unbilled entries found' }, 400);
  }

  return c.json(result.invoice, 201);
});

// Manually trigger auto-invoice generation for all eligible clients
app.post('/auto-generate', requireAdmin(), async (c) => {
  const results = await runAutoInvoiceCheck();
  return c.json(results);
});

// Get auto-invoice generation log
app.get('/auto-generate/log', requireAdmin(), async (c) => {
  const db = await getDb();
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const rows = await db.select({
    log: autoInvoiceLog,
    client: clients,
  })
    .from(autoInvoiceLog)
    .innerJoin(clients, eq(autoInvoiceLog.clientId, clients.id))
    .orderBy(desc(autoInvoiceLog.createdAt))
    .limit(limit);

  return c.json(rows.map(({ log, client }) => ({
    ...log,
    clientName: client.name,
  })));
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

// --- Line Item CRUD ---

// Update a line item
app.put('/:invoiceId/line-items/:lineId', requireAdmin(), async (c) => {
  const db = await getDb();
  const lineId = c.req.param('lineId');
  const body = await c.req.json();

  const updateData: Record<string, unknown> = {};
  if (body.description !== undefined) updateData.description = body.description;
  if (body.hours !== undefined) updateData.hours = body.hours;
  if (body.rate !== undefined) updateData.rate = body.rate;

  if (Object.keys(updateData).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  const [updated] = await db.update(invoiceLineItems)
    .set(updateData)
    .where(eq(invoiceLineItems.id, lineId))
    .returning();

  if (!updated) return c.json({ error: 'Line item not found' }, 404);
  return c.json(updated);
});

// Add a line item to an invoice
app.post('/:invoiceId/line-items', requireAdmin(), async (c) => {
  const db = await getDb();
  const invoiceId = c.req.param('invoiceId');
  const body = await c.req.json();

  if (!body.description || body.hours === undefined || body.rate === undefined) {
    return c.json({ error: 'Description, hours, and rate are required' }, 400);
  }

  const [line] = await db.insert(invoiceLineItems).values({
    invoiceId,
    description: body.description,
    hours: body.hours,
    rate: body.rate,
    timeEntryId: body.timeEntryId || null,
  }).returning();

  return c.json(line, 201);
});

// Delete a line item
app.delete('/:invoiceId/line-items/:lineId', requireAdmin(), async (c) => {
  const db = await getDb();
  const lineId = c.req.param('lineId');

  // If linked to a time entry, unmark it
  const [existing] = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.id, lineId));

  if (!existing) return c.json({ error: 'Line item not found' }, 404);

  if (existing.timeEntryId) {
    await db.update(timeEntries)
      .set({ isBilled: false, invoiceId: null, updatedAt: new Date() })
      .where(eq(timeEntries.id, existing.timeEntryId));
  }

  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.id, lineId));
  return c.json({ success: true });
});

export default app;
