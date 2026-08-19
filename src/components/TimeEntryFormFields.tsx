'use client';

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
  type JobType,
  type RateTier,
  type User,
  type Client,
} from '@/lib/api';

interface TimeEntryFormFieldsProps {
  showClientPicker: boolean;
  clientList: Client[];
  clientId: string;
  setClientId: (v: string) => void;

  showDate?: boolean;
  date: string;
  setDate: (v: string) => void;

  hours: string;
  setHours: (v: string) => void;

  jobTypeList: JobType[];
  jobTypeId: string;
  setJobTypeId: (v: string) => void;

  rateTierList: RateTier[];
  rateAmount: string;
  setRateAmount: (v: string) => void;
  rateTierId: string;
  setRateTierId: (v: string) => void;

  admin: boolean;
  showTech?: boolean;
  techList: User[];
  techId: string;
  setTechId: (v: string) => void;

  notes: string;
  setNotes: (v: string) => void;

  isBilled: boolean;
  setIsBilled: (v: boolean) => void;
  isPaid: boolean;
  setIsPaid: (v: boolean) => void;

  computedTotal: string | null;
}

export default function TimeEntryFormFields({
  showClientPicker,
  clientList,
  clientId,
  setClientId,
  showDate = true,
  date,
  setDate,
  hours,
  setHours,
  jobTypeList,
  jobTypeId,
  setJobTypeId,
  rateTierList,
  rateAmount,
  setRateAmount,
  rateTierId,
  setRateTierId,
  admin,
  showTech = true,
  techList,
  techId,
  setTechId,
  notes,
  setNotes,
  isBilled,
  setIsBilled,
  isPaid,
  setIsPaid,
  computedTotal,
}: TimeEntryFormFieldsProps) {
  return (
    <>
      {showClientPicker && (
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

      {showDate ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      ) : (
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
      )}

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

      {admin && showTech && (
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
    </>
  );
}
