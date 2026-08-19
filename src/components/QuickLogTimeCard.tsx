'use client';

import { Loader2 } from 'lucide-react';
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
import ClientSelector from './ClientSelector';
import TimeEntryFormFields from './TimeEntryFormFields';
import { useTimeEntryForm } from '@/lib/useTimeEntryForm';
import { useLastTech } from './LastTechProvider';
import { toISODate } from '@/lib/utils';

interface QuickLogTimeCardProps {
  onSaved: () => void;
}

export default function QuickLogTimeCard({ onSaved }: QuickLogTimeCardProps) {
  const { lastTechId } = useLastTech();

  const form = useTimeEntryForm({
    active: true,
    defaultDate: toISODate(new Date()),
    defaultTechId: lastTechId,
    resetOnSave: true,
    onSaved,
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-4 mb-6">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Log Time</h2>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Client *</Label>
          <ClientSelector value={form.clientId} onChange={form.setClientId} />
        </div>

        <div className="space-y-2">
          <Label>Date *</Label>
          <Input type="date" value={form.date} onChange={(e) => form.setDate(e.target.value)} />
        </div>

        {form.admin && (
          <div className="space-y-2">
            <Label>Tech</Label>
            <Select value={form.techId} onValueChange={form.setTechId}>
              <SelectTrigger>
                <SelectValue placeholder="Assign to self" />
              </SelectTrigger>
              <SelectContent>
                {form.techList.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {form.clientId && (
          <>
            <TimeEntryFormFields
              showClientPicker={false}
              showDate={false}
              showTech={false}
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

            {form.error && (
              <div className="text-sm text-red-600 dark:text-red-400">{form.error}</div>
            )}

            <Button onClick={form.handleSave} disabled={form.saving} className="w-full">
              {form.saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Entry'
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
