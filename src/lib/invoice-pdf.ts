/**
 * Browser-side invoice PDF generation (ports the legacy pdfkit layout to jsPDF).
 */
import { jsPDF } from 'jspdf';
import { invoices, settings as settingsApi, type InvoiceLineItem } from './api';

const PAGE_BREAK_Y = 680;
const MARGIN = 50;
const RIGHT_EDGE = 562;

const COL_DESC = 50;
const COL_HRS = 330;
const COL_RATE = 410;
const COL_TOTAL = 490;
const TOTAL_RIGHT = COL_TOTAL + 70; // right edge of the totals column

function formatInvoiceDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export async function downloadInvoicePdf(id: string): Promise<void> {
  const invoice = await invoices.get(id);
  const client = invoice.client;
  if (!client) throw new Error('Invoice has no client');

  let settings: Record<string, string> = {};
  try {
    settings = await settingsApi.get();
  } catch {
    // settings unavailable — fall back to defaults
  }

  const lines = invoice.lineItems ?? [];
  const laborLines = lines.filter((l) => l.lineItemType !== 'part');
  const partLines = lines.filter((l) => l.lineItemType === 'part');
  const laborTotal = laborLines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);
  const partsSubtotal = partLines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);
  const total = laborTotal + partsSubtotal;

  const companyName = settings.companyName || 'Lost Coast IT';
  const payableTo = client.invoicePayableTo || settings.invoicePayableTo || '';

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setLineWidth(0.5);

  // --- Header ---
  doc.setFont('helvetica', 'bold').setFontSize(24);
  doc.text(companyName, MARGIN, 50, { baseline: 'top' });

  const headerY = 92;
  const numericInvoicePart = invoice.invoiceNumber.replace(/^.*-/, '');
  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(formatInvoiceDate(invoice.dateIssued), MARGIN, headerY, { baseline: 'top' });
  doc.text(`Invoice No. ${numericInvoicePart}`, MARGIN, headerY + 14, { baseline: 'top' });

  // --- INVOICE title ---
  doc.setFont('helvetica', 'bold').setFontSize(20);
  doc.text('INVOICE', MARGIN, headerY + 44, { baseline: 'top' });

  // Client info
  let y = headerY + 74;
  doc.setFont('helvetica', 'bold').setFontSize(11);
  doc.text(client.name, MARGIN, y, { baseline: 'top' });
  y += 14;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  if (client.phone) {
    doc.text(client.phone, MARGIN, y, { baseline: 'top' });
    y += 13;
  }
  if (client.mailingAddress) {
    const addr = doc.splitTextToSize(client.mailingAddress, 300) as string[];
    doc.text(addr, MARGIN, y, { baseline: 'top' });
    y += addr.length * 13;
  }

  // --- Line Items Table ---
  const tableTop = y + 24;
  doc.setFont('helvetica', 'bold').setFontSize(9);
  doc.text('DESCRIPTION OF WORK', COL_DESC, tableTop, { baseline: 'top' });
  doc.text('QTY/HRS', COL_HRS, tableTop, { baseline: 'top' });
  doc.text('UNIT PRICE', COL_RATE, tableTop, { baseline: 'top' });
  doc.text('SUB TOTAL', COL_TOTAL, tableTop, { baseline: 'top' });
  doc.line(MARGIN, tableTop + 14, RIGHT_EDGE, tableTop + 14);

  let rowY = tableTop + 22;
  doc.setFont('helvetica', 'normal').setFontSize(10);

  function renderRow(line: InvoiceLineItem) {
    const lineTotal = Number(line.hours) * Number(line.rate);
    const descLines = doc.splitTextToSize(line.description || '', 270) as string[];
    const rowHeight = Math.max(descLines.length * 12, 16);

    if (rowY + rowHeight > PAGE_BREAK_Y) {
      doc.addPage();
      rowY = MARGIN;
    }

    doc.text(descLines, COL_DESC, rowY, { baseline: 'top' });
    doc.text(Number(line.hours).toFixed(2), COL_HRS, rowY, { baseline: 'top' });
    doc.text(`$${Number(line.rate).toFixed(2)}`, COL_RATE, rowY, { baseline: 'top' });
    doc.text(`$${lineTotal.toFixed(2)}`, TOTAL_RIGHT, rowY, { baseline: 'top', align: 'right' });
    rowY += rowHeight + 6;
  }

  for (const line of laborLines) renderRow(line);

  // Parts & Expenses section (only if present)
  if (partLines.length > 0) {
    rowY += 10;
    doc.line(MARGIN, rowY, RIGHT_EDGE, rowY);
    rowY += 8;
    doc.setFont('helvetica', 'bold').setFontSize(9);
    doc.text('PARTS & EXPENSES', COL_DESC, rowY, { baseline: 'top' });
    doc.text('QTY', COL_HRS, rowY, { baseline: 'top' });
    doc.text('UNIT PRICE', COL_RATE, rowY, { baseline: 'top' });
    doc.text('SUB TOTAL', COL_TOTAL, rowY, { baseline: 'top' });
    doc.line(MARGIN, rowY + 12, RIGHT_EDGE, rowY + 12);
    rowY += 20;
    doc.setFont('helvetica', 'normal').setFontSize(10);

    for (const line of partLines) renderRow(line);

    rowY += 4;
    doc.setFont('helvetica', 'normal').setFontSize(10);
    doc.text('Parts & Expenses Subtotal', COL_DESC, rowY, { baseline: 'top' });
    doc.setFont('helvetica', 'bold');
    doc.text(`$${partsSubtotal.toFixed(2)}`, TOTAL_RIGHT, rowY, { baseline: 'top', align: 'right' });
    rowY += 18;
  }

  // Notes
  if (invoice.notes) {
    rowY += 6;
    doc.setFont('helvetica', 'italic').setFontSize(9);
    const noteLines = doc.splitTextToSize(invoice.notes, 400) as string[];
    doc.text(noteLines, COL_DESC, rowY, { baseline: 'top' });
    rowY += noteLines.length * 11 + 10;
  }

  // --- Grand Total ---
  rowY += 10;
  if (rowY > PAGE_BREAK_Y) {
    doc.addPage();
    rowY = MARGIN;
  }
  doc.line(MARGIN, rowY, RIGHT_EDGE, rowY);
  rowY += 10;
  doc.setFont('helvetica', 'bold').setFontSize(12);
  doc.text('GRAND TOTAL', COL_DESC, rowY, { baseline: 'top' });
  doc.text(`$${total.toFixed(2)}`, TOTAL_RIGHT, rowY, { baseline: 'top', align: 'right' });

  // --- Payable To ---
  rowY += 40;
  doc.setFont('helvetica', 'bold').setFontSize(10);
  doc.text('PAYABLE TO', COL_DESC, rowY, { baseline: 'top' });
  rowY += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(doc.splitTextToSize(payableTo, 400) as string[], COL_DESC, rowY, { baseline: 'top' });

  doc.save(`${invoice.invoiceNumber}.pdf`);
}
