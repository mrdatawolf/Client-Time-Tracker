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
  timeEntries as timeEntriesApi,
  jobTypes as jobTypesApi,
  rateTiers as rateTiersApi,
  users as usersApi,
  clients as clientsApi,
  settings as settingsApi,
  type JobType,
  type RateTier,
  type User,
  type TimeEntry,
  type CreateTimeEntry,
} from '@/lib/api';
import { isAdmin } from '@/lib/api-client';

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

  const [jobTypeId, setJobTypeId] = useState('');
  const [rateTierId, setRateTierId] = useState('');
  const [techId, setTechId] = useState('');
  const [hours, setHours] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const admin = isAdmin();

  useEffect(() => {
    if (open) {
      Promise.all([
        jobTypesApi.list(),
        rateTiersApi.list(),
        admin ? usersApi.list() : Promise.resolve([]),
        // For new entries, fetch the client's rate and the base rate from settings
        !entry && defaultClientId ? clientsApi.get(defaultClientId) : Promise.resolve(null),
        !entry ? settingsApi.get().catch(() => ({} as Record<string, string>)) : Promise.resolve(null),
      ]).then(([jt, rt, u, client, appSettings]) => {
        const activeRates = rt.filter((r) => r.isActive);
        setJobTypeList(jt.filter((j) => j.isActive));
        setRateTierList(activeRates);
        setTechList(u.filter((user) => user.isActive));

        // Auto-select rate tier for new entries
        if (!entry && activeRates.length > 0) {
          const targetRate = client?.defaultHourlyRate
            || (appSettings as Record<string, string>)?.baseHourlyRate
            || '185';
          const targetNum = parseFloat(targetRate);
          const match = activeRates.find((r) => parseFloat(r.amount) === targetNum);
          if (match) {
            setRateTierId(match.id);
          }
        }
      });

      if (entry) {
        setJobTypeId(entry.jobTypeId);
        setRateTierId(entry.rateTierId);
        setTechId(entry.techId);
        setHours(entry.hours);
        setDate(entry.date);
        setNotes(entry.notes || '');
      } else {
        setJobTypeId('');
        setRateTierId('');
        setTechId('');
        setHours('');
        setDate(defaultDate || new Date().toISOString().split('T')[0]);
        setNotes('');
      }
      setError('');
    }
  }, [open, entry, defaultDate, defaultClientId, admin]);

  const selectedRate = rateTierList.find((r) => r.id === rateTierId);
  const computedTotal = hours && selectedRate
    ? (parseFloat(hours) * parseFloat(selectedRate.amount)).toFixed(2)
    : null;

  async function handleSave() {
    if (!jobTypeId || !rateTierId || !hours || !date) {
      setError('Job type, rate, hours, and date are required');
      return;
    }
    const h = parseFloat(hours);
    if (isNaN(h) || h <= 0) {
      setError('Hours must be a positive number');
      return;
    }

    setSaving(true);
    setError('');

    try {
      if (entry) {
        await timeEntriesApi.update(entry.id, {
          jobTypeId,
          rateTierId,
          hours: h,
          date,
          notes: notes || undefined,
          ...(admin && techId ? { techId } : {}),
        });
      } else {
        const data: CreateTimeEntry = {
          clientId: defaultClientId!,
          jobTypeId,
          rateTierId,
          hours: h,
          date,
          notes: notes || undefined,
        };
        if (admin && techId) data.techId = techId;
        await timeEntriesApi.create(data);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    if (!confirm('Delete this time entry?')) return;
    setSaving(true);
    try {
      await timeEntriesApi.delete(entry.id);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
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
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {error}
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
            <Label>Rate *</Label>
            <Select value={rateTierId} onValueChange={setRateTierId}>
              <SelectTrigger>
                <SelectValue placeholder="Select rate..." />
              </SelectTrigger>
              <SelectContent>
                {rateTierList.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>
                    {rt.label || `$${rt.amount}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          {computedTotal && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded p-3">
              Total: <span className="font-semibold">${computedTotal}</span>
              <span className="ml-2 text-gray-400">
                ({hours}h x ${selectedRate?.amount})
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
              className="mr-auto text-red-600 hover:text-red-700 hover:bg-red-50"
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
