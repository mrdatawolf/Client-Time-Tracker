'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type TimeEntry } from '@/lib/api';
import { useTimeEntryForm } from '@/lib/useTimeEntryForm';
import TimeEntryFormFields from './TimeEntryFormFields';

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
  const form = useTimeEntryForm({
    active: open,
    entry,
    defaultClientId,
    defaultDate,
    onSaved: () => {
      onOpenChange(false);
      onSaved();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Time Entry' : 'New Time Entry'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <TimeEntryFormFields
            showClientPicker={form.needsClientPicker}
            clientList={form.clientList}
            clientId={form.clientId}
            setClientId={form.setClientId}
            date={form.date}
            setDate={form.setDate}
            hours={form.hours}
            setHours={form.setHours}
            jobTypeList={form.jobTypeList}
            jobTypeId={form.jobTypeId}
            setJobTypeId={form.setJobTypeId}
            rateTierList={form.rateTierList}
            rateAmount={form.rateAmount}
            setRateAmount={form.setRateAmount}
            rateTierId={form.rateTierId}
            setRateTierId={form.setRateTierId}
            admin={form.admin}
            techList={form.techList}
            techId={form.techId}
            setTechId={form.setTechId}
            notes={form.notes}
            setNotes={form.setNotes}
            isBilled={form.isBilled}
            setIsBilled={form.setIsBilled}
            isPaid={form.isPaid}
            setIsPaid={form.setIsPaid}
            computedTotal={form.computedTotal}
          />
        </div>

        <DialogFooter>
          {entry && (
            <Button
              variant="outline"
              onClick={form.handleDelete}
              disabled={form.saving}
              className="mr-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"
            >
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.saving}>
            Cancel
          </Button>
          <Button onClick={form.handleSave} disabled={form.saving}>
            {form.saving ? 'Saving...' : entry ? 'Update' : 'Add Entry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
