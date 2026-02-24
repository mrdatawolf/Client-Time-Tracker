'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
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
  timeEntries as timeEntriesApi,
  jobTypes as jobTypesApi,
  rateTiers as rateTiersApi,
  users as usersApi,
  clients as clientsApi,
  settings as settingsApi,
  type JobType,
  type RateTier,
  type User,
  type Client,
  type TimeEntry,
  type CreateTimeEntry,
} from '@/lib/api';
import { isAdmin } from '@/lib/api-client';
import { toISODate } from '@/lib/utils';

interface TimeEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: TimeEntry | null;
  defaultClientId?: string;
  defaultDate?: string;
  onSaved: () => void;
}

export default function TimeEntryDialog({
  open,
  onOpenChange,
  entry,
  defaultClientId,
  defaultDate,
  onSaved,
}: TimeEntryDialogProps) {
  const [jobTypeList, setJobTypeList] = useState<JobType[]>([]);
  const [rateTierList, setRateTierList] = useState<RateTier[]>([]);
  const [techList, setTechList] = useState<User[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);

  const [clientId, setClientId] = useState('');
  const [jobTypeId, setJobTypeId] = useState('');
  const [rateTierId, setRateTierId] = useState('');
  const [rateAmount, setRateAmount] = useState('');
  const [techId, setTechId] = useState('');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isBilled, setIsBilled] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const admin = isAdmin();
  const needsClientPicker = !defaultClientId && !entry;

  useEffect(() => {
    if (open) {
      Promise.all([
        jobTypesApi.list(),
        rateTiersApi.list(),
        admin ? usersApi.list() : Promise.resolve([]),
        // For new entries, fetch the client's rate and the base rate from settings
        !entry && defaultClientId ? clientsApi.get(defaultClientId) : Promise.resolve(null),
        !entry ? settingsApi.get().catch(() => ({} as Record<string, string>)) : Promise.resolve(null),
        // Load client list when no default client (All Clients mode)
        needsClientPicker ? clientsApi.list() : Promise.resolve([]),
      ]).then(([jt, rt, u, client, appSettings, allClients]) => {
        const activeRates = rt.filter((r) => r.isActive);
        setJobTypeList(jt.filter((j) => j.isActive));
        setRateTierList(activeRates);
        setTechList(u.filter((user) => user.isActive));
        setClientList((allClients as Client[]).filter((c) => c.isActive));

        // Auto-select rate for new entries: client default → global default → first tier
        if (!entry) {
          const targetRate = client?.defaultHourlyRate
            || (appSettings as Record<string, string>)?.baseHourlyRate
            || (activeRates.length > 0 ? activeRates[0].amount : '');
          if (targetRate) {
            setRateAmount(targetRate);
            const match = activeRates.find((r) => parseFloat(r.amount) === parseFloat(targetRate));
            if (match) setRateTierId(match.id);
          }
        }
      });

      if (entry) {
        setClientId(entry.clientId);
        setJobTypeId(entry.jobTypeId);
        setRateTierId(entry.rateTierId);
        setRateAmount(entry.rateTier?.amount || '');
        setTechId(entry.techId);
        setHours(entry.hours);
        setDate(entry.date);
        setNotes(entry.notes || '');
        setIsBilled(entry.isBilled);
        setIsPaid(entry.isPaid);
      } else {
        setClientId(defaultClientId || '');
        setJobTypeId('');
        setRateTierId('');
        setRateAmount('');
        setTechId('');
        setHours('');
        setDate(defaultDate || toISODate(new Date()));
        setNotes('');
        setIsBilled(false);
        setIsPaid(false);
      }
      setError('');
    }
  }, [open, entry, defaultDate, defaultClientId, admin, needsClientPicker]);

  const computedTotal = hours && rateAmount && !isNaN(parseFloat(rateAmount))
    ? (parseFloat(hours) * parseFloat(rateAmount)).toFixed(2)
    : null;

  async function resolveRateTierId(): Promise<string | null> {
    const amount = parseFloat(rateAmount);
    if (isNaN(amount) || amount <= 0) return null;

    // Check if the current rateTierId still matches
    const current = rateTierList.find((r) => r.id === rateTierId);
    if (current && parseFloat(current.amount) === amount) return rateTierId;

    // Find an existing tier matching this amount
    const match = rateTierList.find((r) => parseFloat(r.amount) === amount);
    if (match) return match.id;

    // Create a new rate tier for this custom amount
    const newTier = await rateTiersApi.create({ amount: amount.toFixed(2), label: `$${amount.toFixed(2)}` });
    setRateTierList((prev) => [...prev, newTier]);
    return newTier.id;
  }

  async function handleSave() {
    const resolvedClientId = defaultClientId || clientId;
    if (!resolvedClientId && !entry) {
      setError('Client is required');
      return;
    }
    if (!jobTypeId || !rateAmount || !hours || !date) {
      setError('Job type, rate, hours, and date are required');
      return;
    }
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) {
      setError('Hours must be a positive number');
      return;
    }
    const rateNum = parseFloat(rateAmount);
    if (isNaN(rateNum) || rateNum <= 0) {
      setError('Rate must be a positive number');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const resolvedTierId = await resolveRateTierId();
      if (!resolvedTierId) {
        setError('Invalid rate');
        setSaving(false);
        return;
      }

      if (entry) {
        await timeEntriesApi.update(entry.id, {
          jobTypeId,
          rateTierId: resolvedTierId,
          hours: h,
          date,
          notes: notes || undefined,
          ...(admin && techId ? { techId } : {}),
          ...(admin ? { isBilled, isPaid } : {}),
        });
      } else {
        const data: CreateTimeEntry & { isBilled?: boolean; isPaid?: boolean } = {
          clientId: resolvedClientId,
          jobTypeId,
          rateTierId: resolvedTierId,
          hours: h,
          date,
          notes: notes || undefined,
          ...(admin ? { isBilled, isPaid } : {}),
        };
        if (admin && techId) data.techId = techId;
        await timeEntriesApi.create(data);
      }
      onOpenChange(false);
      onSaved();
      toast.success(entry ? 'Time entry updated' : 'Time entry created');
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error(entry ? 'Failed to update entry' : 'Failed to create entry', {
        description: errorMessage,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;

    let confirmMsg = 'Delete this time entry?';
    if (entry.invoice) {
      if (entry.invoice.status === 'draft') {
        confirmMsg = `This entry is linked to Draft Invoice #${entry.invoice.invoiceNumber}. Deleting it will also remove it from that invoice. Proceed?`;
      } else {
        confirmMsg = `This entry is linked to Invoice #${entry.invoice.invoiceNumber} (${entry.invoice.status}). Deleting it will unlink it from the invoice but will NOT change the invoice total. Proceed?`;
      }
    }

    if (!confirm(confirmMsg)) return;
    setSaving(true);
    try {
      await timeEntriesApi.delete(entry.id);
      onOpenChange(false);
      onSaved();
      toast.success('Time entry deleted');
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error('Failed to delete entry', {
        description: errorMessage,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Time Entry' : 'New Time Entry'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {needsClientPicker && (
            <div className="space-y-2">
              <Label>Client *</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clientList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Hours *</Label>
              <Input
                type="number"
                step="0.25"
                min="0"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="e.g. 1.5"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Job Type *</Label>
            <Select value={jobTypeId} onValueChange={setJobTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select job type..." />
              </SelectTrigger>
              <SelectContent>
                {jobTypeList.map((jt) => (
                  <SelectItem key={jt.id} value={jt.id}>
                    {jt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Rate ($/hr) *</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={rateAmount}
              onChange={(e) => {
                setRateAmount(e.target.value);
                // Clear tier selection when typing custom value
                const match = rateTierList.find((r) => parseFloat(r.amount) === parseFloat(e.target.value));
                setRateTierId(match?.id || '');
              }}
              placeholder="Enter rate..."
            />
            {rateTierList.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rateTierList.map((rt) => (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => {
                      setRateAmount(rt.amount);
                      setRateTierId(rt.id);
                    }}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      rateTierId === rt.id
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                        : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    ${rt.amount}{rt.label && rt.label !== `$${rt.amount}` ? ` (${rt.label})` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {admin && (
            <div className="space-y-2">
              <Label>Tech</Label>
              <Select value={techId} onValueChange={setTechId}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign to self" />
                </SelectTrigger>
                <SelectContent>
                  {techList.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
            />
          </div>

          {admin && (
            <div className="flex gap-6 py-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isBilled"
                  checked={isBilled}
                  onChange={(e) => setIsBilled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 dark:border-gray-700 dark:bg-gray-900"
                />
                <Label htmlFor="isBilled" className="cursor-pointer">Billed</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPaid"
                  checked={isPaid}
                  onChange={(e) => setIsPaid(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 dark:border-gray-700 dark:bg-gray-900"
                />
                <Label htmlFor="isPaid" className="cursor-pointer">Paid</Label>
              </div>
            </div>
          )}

          {computedTotal && (
            <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-3">
              Total: <span className="font-semibold">${computedTotal}</span>
              <span className="ml-2 text-gray-400 dark:text-gray-500">
                ({hours}h x ${rateAmount})
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          {entry && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={saving}
              className="mr-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : entry ? 'Update' : 'Add Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
