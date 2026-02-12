'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  invoices as invoicesApi,
  timeEntries as timeEntriesApi,
  type Client,
  type TimeEntry,
} from '@/lib/api';
import { formatCurrency, toISODate } from '@/lib/utils';

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Client[];
  onGenerated: () => void;
}

export default function GenerateInvoiceDialog({
  open,
  onOpenChange,
  clients,
  onGenerated,
}: GenerateInvoiceDialogProps) {
  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateDue, setDateDue] = useState('');
  const [notes, setNotes] = useState('');
  const [unbilledEntries, setUnbilledEntries] = useState<TimeEntry[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setClientId('');
      setDateFrom('');
      setDateTo('');
      setDateDue('');
      setNotes('');
      setUnbilledEntries([]);
      setError('');

      // Default date range: first of current month to today
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(toISODate(firstOfMonth));
      setDateTo(toISODate(now));

      // Default due date: 30 days from now
      const due = new Date(now);
      due.setDate(due.getDate() + 30);
      setDateDue(toISODate(due));
    }
  }, [open]);

  // Preview unbilled entries when filters change
  useEffect(() => {
    if (!clientId || !dateFrom || !dateTo) {
      setUnbilledEntries([]);
      return;
    }

    setLoadingPreview(true);
    timeEntriesApi
      .list({ clientId, dateFrom, dateTo, isBilled: false })
      .then(setUnbilledEntries)
      .catch(console.error)
      .finally(() => setLoadingPreview(false));
  }, [clientId, dateFrom, dateTo]);

  const previewTotal = unbilledEntries.reduce(
    (sum, e) => sum + (e.total ? parseFloat(e.total) : 0),
    0
  );
  const previewHours = unbilledEntries.reduce(
    (sum, e) => sum + parseFloat(e.hours),
    0
  );

  async function handleGenerate() {
    if (!clientId || !dateFrom || !dateTo) {
      setError('Client, date from, and date to are required');
      return;
    }
    if (unbilledEntries.length === 0) {
      setError('No unbilled entries found for this period');
      return;
    }

    setGenerating(true);
    setError('');
    try {
      await invoicesApi.generate({
        clientId,
        dateFrom,
        dateTo,
        dateDue: dateDue || undefined,
        notes: notes || undefined,
      });
      onOpenChange(false);
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label>Client *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select client..." />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From *</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>To *</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input
              type="date"
              value={dateDue}
              onChange={(e) => setDateDue(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional invoice notes..."
            />
          </div>

          {/* Preview */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <span className="text-sm font-medium text-gray-700">
                Preview: Unbilled Entries
              </span>
            </div>
            {loadingPreview ? (
              <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
            ) : !clientId ? (
              <div className="p-4 text-center text-sm text-gray-400">
                Select a client to preview entries
              </div>
            ) : unbilledEntries.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">
                No unbilled entries for this period
              </div>
            ) : (
              <>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-3 py-1.5 text-left font-medium text-gray-500">Date</th>
                        <th className="px-3 py-1.5 text-left font-medium text-gray-500">Job</th>
                        <th className="px-3 py-1.5 text-right font-medium text-gray-500">Hours</th>
                        <th className="px-3 py-1.5 text-right font-medium text-gray-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {unbilledEntries.map((e) => (
                        <tr key={e.id}>
                          <td className="px-3 py-1.5 text-gray-600">{e.date}</td>
                          <td className="px-3 py-1.5 text-gray-600">{e.jobType?.name || '-'}</td>
                          <td className="px-3 py-1.5 text-right">{e.hours}h</td>
                          <td className="px-3 py-1.5 text-right font-medium">
                            {e.total ? formatCurrency(parseFloat(e.total)) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 flex justify-between text-sm">
                  <span className="text-gray-600">
                    {unbilledEntries.length} entries | {previewHours.toFixed(1)}h
                  </span>
                  <span className="font-semibold text-gray-800">
                    {formatCurrency(previewTotal)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={generating || unbilledEntries.length === 0}
          >
            {generating ? 'Generating...' : `Generate Invoice (${formatCurrency(previewTotal)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
