'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, DollarSign, Trash2 } from 'lucide-react';
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
                {invoice.invoiceNumber}
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
          <div className="text-sm">
            <div>Issued: {formatDate(invoice.dateIssued)}</div>
            {invoice.dateDue && <div>Due: {formatDate(invoice.dateDue)}</div>}
          </div>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="text-sm font-medium text-yellow-800 mb-1">Notes</div>
          <div className="text-sm text-yellow-700">{invoice.notes}</div>
        </div>
      )}

      {/* Line Items */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Line Items</h2>
        </div>
        {!invoice.lineItems || invoice.lineItems.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No line items</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoice.lineItems.map((line) => {
                const lineTotal = Number(line.hours) * Number(line.rate);
                return (
                  <tr key={line.id}>
                    <td className="px-6 py-3 text-gray-600">{line.description}</td>
                    <td className="px-6 py-3 text-right">{Number(line.hours).toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right">{formatCurrency(Number(line.rate))}</td>
                    <td className="px-6 py-3 text-right font-medium">{formatCurrency(lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={3} className="px-6 py-3 text-right font-medium text-gray-700">Total</td>
                <td className="px-6 py-3 text-right font-bold text-gray-900">
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
