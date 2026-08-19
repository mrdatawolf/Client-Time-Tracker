'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
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
import { useLastTech } from '@/components/LastTechProvider';

interface UseTimeEntryFormOptions {
  active: boolean;
  entry?: TimeEntry | null;
  defaultClientId?: string;
  defaultDate?: string;
  defaultTechId?: string;
  resetOnSave?: boolean;
  onSaved: () => void;
}

export function useTimeEntryForm({
  active,
  entry,
  defaultClientId,
  defaultDate,
  defaultTechId,
  resetOnSave,
  onSaved,
}: UseTimeEntryFormOptions) {
  const { setLastTechId } = useLastTech();

  const [jobTypeList, setJobTypeList] = useState<JobType[]>([]);
  const [rateTierList, setRateTierList] = useState<RateTier[]>([]);
  const [techList, setTechList] = useState<User[]>([]);
  const [clientList, setClientList] = useState<Client[]>([]);
  const [baseRateDefault, setBaseRateDefault] = useState<{ amount: string; tierId: string }>({ amount: '', tierId: '' });

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
    if (active) {
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
            const match = activeRates.find((r) => parseFloat(r.amount) === parseFloat(targetRate));
            setRateAmount(targetRate);
            if (match) setRateTierId(match.id);
            setBaseRateDefault({ amount: targetRate, tierId: match?.id || '' });
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
  }, [active, entry, defaultDate, defaultClientId, admin, needsClientPicker]);

  // Backfill the last-used tech once it's known/changes, without disturbing anything else already entered.
  useEffect(() => {
    if (!entry && defaultTechId) {
      setTechId((current) => current || defaultTechId);
    }
  }, [defaultTechId, entry]);

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

  function resetFields() {
    setClientId(defaultClientId || '');
    setJobTypeId('');
    setRateTierId(baseRateDefault.tierId);
    setRateAmount(baseRateDefault.amount);
    setTechId('');
    setHours('');
    setDate(defaultDate || toISODate(new Date()));
    setNotes('');
    setIsBilled(false);
    setIsPaid(false);
    setError('');
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

      if (admin && techId) setLastTechId(techId);
      if (resetOnSave) resetFields();

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

  return {
    jobTypeList,
    rateTierList,
    techList,
    clientList,
    clientId,
    setClientId,
    jobTypeId,
    setJobTypeId,
    rateTierId,
    setRateTierId,
    rateAmount,
    setRateAmount,
    techId,
    setTechId,
    hours,
    setHours,
    date,
    setDate,
    notes,
    setNotes,
    isBilled,
    setIsBilled,
    isPaid,
    setIsPaid,
    admin,
    needsClientPicker,
    computedTotal,
    error,
    saving,
    handleSave,
    handleDelete,
  };
}
