'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, DollarSign, Trash2, Download, Plus, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  invoices as invoicesApi,
  payments as paymentsApi,
  type Invoice,
  type InvoiceLineItem,
  type Payment,
} from '@/lib/api';
import { formatCurrency, formatDate, toISODate } from '@/lib/utils';
import Link from 'next/link';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
};

const STATUS_TRANSITIONS: Record<string, { label: string; value: string }[]> = {
  draft: [{ label: 'Mark as Sent', value: 'sent' }, { label: 'Void', value: 'void' }],
  sent: [{ label: 'Void', value: 'void' }],
  paid: [],
  void: [],
};

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paymentList, setPaymentList] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  // Editing state for invoice header fields
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Line item editing
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editLineDesc, setEditLineDesc] = useState('');
  const [editLineHours, setEditLineHours] = useState('');
  const [editLineRate, setEditLineRate] = useState('');
  const [savingLine, setSavingLine] = useState(false);

  // Add line item
  const [addingLine, setAddingLine] = useState(false);
  const [newLineDesc, setNewLineDesc] = useState('');
  const [newLineHours, setNewLineHours] = useState('');
  const [newLineRate, setNewLineRate] = useState('');

  // Payment form state
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  const loadInvoice = useCallback(async () => {
    try {
      const [inv, pmts] = await Promise.all([
        invoicesApi.get(id),
        paymentsApi.list(id),
      ]);
      setInvoice(inv);
      setPaymentList(pmts);
    } catch (err) {
      console.error('Failed to load invoice:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  // --- Invoice field editing ---
  function startEditField(field: string, currentValue: string) {
    setEditingField(field);
    setEditValue(currentValue);
  }

  async function saveField(field: string) {
    if (!editValue.trim()) return;
    try {
      await invoicesApi.update(id, { [field]: editValue.trim() });
      setEditingField(null);
      loadInvoice();
    } catch (err) {
      console.error('Failed to update field:', err);
    }
  }

  function cancelEditField() {
    setEditingField(null);
    setEditValue('');
  }

  // --- Line item editing ---
  function startEditLine(line: InvoiceLineItem) {
    setEditingLineId(line.id);
    setEditLineDesc(line.description);
    setEditLineHours(String(Number(line.hours)));
    setEditLineRate(String(Number(line.rate)));
  }

  async function saveLineEdit() {
    if (!editingLineId || !editLineDesc.trim()) return;
    setSavingLine(true);
    try {
      await invoicesApi.updateLineItem(id, editingLineId, {
        description: editLineDesc.trim(),
        hours: editLineHours,
        rate: editLineRate,
      });
      setEditingLineId(null);
      loadInvoice();
    } catch (err) {
      console.error('Failed to update line item:', err);
    } finally {
      setSavingLine(false);
    }
  }

  function cancelLineEdit() {
    setEditingLineId(null);
  }

  // --- Add line item ---
  function openAddLine() {
    setAddingLine(true);
    setNewLineDesc('');
    setNewLineHours('1');
    // Default rate from last line item if available
    const lastLine = invoice?.lineItems?.[invoice.lineItems.length - 1];
    setNewLineRate(lastLine ? String(Number(lastLine.rate)) : '185');
  }

  async function saveNewLine() {
    if (!newLineDesc.trim() || !newLineHours || !newLineRate) return;
    setSavingLine(true);
    try {
      await invoicesApi.addLineItem(id, {
        description: newLineDesc.trim(),
        hours: newLineHours,
        rate: newLineRate,
      });
      setAddingLine(false);
      loadInvoice();
    } catch (err) {
      console.error('Failed to add line item:', err);
    } finally {
      setSavingLine(false);
    }
  }

  // --- Delete line item ---
  async function handleDeleteLine(lineId: string) {
    if (!confirm('Delete this line item?')) return;
    try {
      await invoicesApi.deleteLineItem(id, lineId);
      loadInvoice();
    } catch (err) {
      console.error('Failed to delete line item:', err);
    }
  }

  // --- Status / Delete ---
  async function handleStatusChange(newStatus: string) {
    try {
      await invoicesApi.update(id, { status: newStatus });
      loadInvoice();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this invoice? This will unmark all linked time entries as billed.')) return;
    try {
      await invoicesApi.delete(id);
      router.push('/invoices');
    } catch (err) {
      console.error('Failed to delete invoice:', err);
    }
  }

  // --- Payments ---
  function openPaymentDialog() {
    const remaining = (invoice?.total || 0) - totalPaid;
    setPayAmount(remaining > 0 ? remaining.toFixed(2) : '');
    setPayDate(toISODate(new Date()));
    setPayMethod('');
    setPayNotes('');
    setPayError('');
    setPaymentDialogOpen(true);
  }

  async function handleRecordPayment() {
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) {
      setPayError('Amount must be a positive number');
      return;
    }
    if (!payDate) {
      setPayError('Date is required');
      return;
    }

    setPaying(true);
    setPayError('');
    try {
      await paymentsApi.create({
        invoiceId: id,
        amount,
        datePaid: payDate,
        method: payMethod || undefined,
        notes: payNotes || undefined,
      });
      setPaymentDialogOpen(false);
      loadInvoice();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm('Delete this payment?')) return;
    try {
      await paymentsApi.delete(paymentId);
      loadInvoice();
    } catch (err) {
      console.error('Failed to delete payment:', err);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">Loading invoice...</div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-8 text-center text-gray-500">Invoice not found</div>
    );
  }

  const totalPaid = paymentList.reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = (invoice.total || 0) - totalPaid;
  const transitions = STATUS_TRANSITIONS[invoice.status] || [];
  const isEditable = invoice.status === 'draft' || invoice.status === 'sent';

  // Inline editable field helper
  function renderEditableField(
    field: string,
    label: string,
    value: string,
    displayValue: string,
    type: string = 'text',
  ) {
    if (editingField === field) {
      return (
        <div className="flex items-center gap-1">
          <Input
            type={type}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 text-sm w-40"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveField(field);
              if (e.key === 'Escape') cancelEditField();
            }}
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => saveField(field)}>
            <Check className="w-3 h-3 text-green-600" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={cancelEditField}>
            <X className="w-3 h-3 text-gray-400" />
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 group">
        <span>{displayValue}</span>
        {isEditable && (
          <button
            onClick={() => startEditField(field, value)}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Pencil className="w-3 h-3 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/invoices"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Invoices
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-gray-400" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {renderEditableField('invoiceNumber', 'Invoice #', invoice.invoiceNumber, invoice.invoiceNumber)}
              </h1>
              <p className="text-gray-500">{invoice.client?.name || 'Unknown Client'}</p>
            </div>
            <span
              className={`ml-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[invoice.status] || ''}`}
            >
              {invoice.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => invoicesApi.downloadPdf(id)}
            >
              <Download className="w-4 h-4 mr-1" />
              PDF
            </Button>
            {transitions.map((t) => (
              <Button
                key={t.value}
                variant="outline"
                size="sm"
                onClick={() => handleStatusChange(t.value)}
              >
                {t.label}
              </Button>
            ))}
            {invoice.status !== 'paid' && invoice.status !== 'void' && (
              <Button size="sm" onClick={openPaymentDialog}>
                <DollarSign className="w-4 h-4 mr-1" />
                Record Payment
              </Button>
            )}
            {invoice.status === 'draft' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Invoice Total</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(invoice.total || 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Paid</div>
          <div className="text-xl font-bold text-green-600">
            {formatCurrency(totalPaid)}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Remaining</div>
          <div className={`text-xl font-bold ${remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {formatCurrency(remaining > 0 ? remaining : 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500 mb-1">Dates</div>
          <div className="text-sm space-y-0.5">
            <div>Issued: {renderEditableField('dateIssued', 'Issued', invoice.dateIssued, formatDate(invoice.dateIssued), 'date')}</div>
            <div>Due: {renderEditableField('dateDue', 'Due', invoice.dateDue || '', invoice.dateDue ? formatDate(invoice.dateDue) : 'Not set', 'date')}</div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div className="text-sm font-medium text-yellow-800 mb-1">Notes</div>
        {editingField === 'notes' ? (
          <div className="flex items-start gap-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 text-sm border border-yellow-300 rounded p-2 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
              rows={3}
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => saveField('notes')}>
                <Check className="w-3 h-3 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={cancelEditField}>
                <X className="w-3 h-3 text-gray-400" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1 group">
            <div className="text-sm text-yellow-700 flex-1">
              {invoice.notes || <span className="text-yellow-400 italic">No notes</span>}
            </div>
            {isEditable && (
              <button
                onClick={() => startEditField('notes', invoice.notes || '')}
                className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
              >
                <Pencil className="w-3 h-3 text-yellow-600 hover:text-yellow-800" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Line Items</h2>
          {isEditable && !addingLine && (
            <Button size="sm" variant="outline" onClick={openAddLine}>
              <Plus className="w-4 h-4 mr-1" />
              Add Line
            </Button>
          )}
        </div>
        {!invoice.lineItems || invoice.lineItems.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No line items</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase w-24">Hours</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase w-28">Rate</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase w-28">Amount</th>
                {isEditable && (
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase w-20">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoice.lineItems.map((line) => {
                const isEditingThis = editingLineId === line.id;
                const lineTotal = isEditingThis
                  ? (parseFloat(editLineHours) || 0) * (parseFloat(editLineRate) || 0)
                  : Number(line.hours) * Number(line.rate);

                if (isEditingThis) {
                  return (
                    <tr key={line.id} className="bg-blue-50/50">
                      <td className="px-6 py-2">
                        <Input
                          value={editLineDesc}
                          onChange={(e) => setEditLineDesc(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveLineEdit();
                            if (e.key === 'Escape') cancelLineEdit();
                          }}
                        />
                      </td>
                      <td className="px-6 py-2">
                        <Input
                          type="number"
                          step="0.25"
                          min="0"
                          value={editLineHours}
                          onChange={(e) => setEditLineHours(e.target.value)}
                          className="h-8 text-sm text-right w-20 ml-auto"
                        />
                      </td>
                      <td className="px-6 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editLineRate}
                          onChange={(e) => setEditLineRate(e.target.value)}
                          className="h-8 text-sm text-right w-24 ml-auto"
                        />
                      </td>
                      <td className="px-6 py-2 text-right font-medium text-gray-500">
                        {formatCurrency(lineTotal)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={saveLineEdit}
                            disabled={savingLine}
                          >
                            <Check className="w-3.5 h-3.5 text-green-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={cancelLineEdit}
                          >
                            <X className="w-3.5 h-3.5 text-gray-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={line.id} className="group hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-600">{line.description}</td>
                    <td className="px-6 py-3 text-right">{Number(line.hours).toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right">{formatCurrency(Number(line.rate))}</td>
                    <td className="px-6 py-3 text-right font-medium">{formatCurrency(lineTotal)}</td>
                    {isEditable && (
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => startEditLine(line)}
                          >
                            <Pencil className="w-3 h-3 text-gray-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => handleDeleteLine(line.id)}
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Add new line row */}
              {addingLine && (
                <tr className="bg-green-50/50">
                  <td className="px-6 py-2">
                    <Input
                      value={newLineDesc}
                      onChange={(e) => setNewLineDesc(e.target.value)}
                      placeholder="Description of work..."
                      className="h-8 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveNewLine();
                        if (e.key === 'Escape') setAddingLine(false);
                      }}
                    />
                  </td>
                  <td className="px-6 py-2">
                    <Input
                      type="number"
                      step="0.25"
                      min="0"
                      value={newLineHours}
                      onChange={(e) => setNewLineHours(e.target.value)}
                      className="h-8 text-sm text-right w-20 ml-auto"
                    />
                  </td>
                  <td className="px-6 py-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newLineRate}
                      onChange={(e) => setNewLineRate(e.target.value)}
                      className="h-8 text-sm text-right w-24 ml-auto"
                    />
                  </td>
                  <td className="px-6 py-2 text-right font-medium text-gray-500">
                    {formatCurrency((parseFloat(newLineHours) || 0) * (parseFloat(newLineRate) || 0))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={saveNewLine}
                        disabled={savingLine}
                      >
                        <Check className="w-3.5 h-3.5 text-green-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setAddingLine(false)}
                      >
                        <X className="w-3.5 h-3.5 text-gray-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={isEditable ? 4 : 3} className="px-6 py-3 text-right font-medium text-gray-700">Total</td>
                <td className={`px-6 py-3 text-right font-bold text-gray-900 ${isEditable ? '' : ''}`}>
                  {formatCurrency(invoice.total || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Payments */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Payments</h2>
          {invoice.status !== 'paid' && invoice.status !== 'void' && (
            <Button size="sm" variant="outline" onClick={openPaymentDialog}>
              <DollarSign className="w-4 h-4 mr-1" />
              Record Payment
            </Button>
          )}
        </div>
        {paymentList.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No payments recorded</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paymentList.map((p) => (
                <tr key={p.id}>
                  <td className="px-6 py-3 text-gray-600">{formatDate(p.datePaid)}</td>
                  <td className="px-6 py-3 text-gray-600">{p.method || '-'}</td>
                  <td className="px-6 py-3 text-gray-500 text-xs">{p.notes || '-'}</td>
                  <td className="px-6 py-3 text-right font-medium text-green-600">
                    {formatCurrency(Number(p.amount))}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePayment(p.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {payError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {payError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Input
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                placeholder="e.g. Check, Transfer, Cash..."
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
            {remaining > 0 && (
              <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
                Remaining balance: <span className="font-semibold">{formatCurrency(remaining)}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={paying}>
              {paying ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
