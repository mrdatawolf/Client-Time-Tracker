'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toISODate } from '@/lib/utils';

interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
}

function getMonday(): string {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return toISODate(monday);
}

function getSunday(): string {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return toISODate(sunday);
}

export function getDefaultDateFrom() {
  // Previous Monday (1 week before current Monday)
  const monday = new Date(getMonday() + 'T00:00:00');
  monday.setDate(monday.getDate() - 7);
  return toISODate(monday);
}

export function getDefaultDateTo() {
  // Next Sunday (1 week after current Sunday)
  const sunday = new Date(getSunday() + 'T00:00:00');
  sunday.setDate(sunday.getDate() + 7);
  return toISODate(sunday);
}

export default function DateRangePicker({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: DateRangePickerProps) {
  function shiftDays(days: number) {
    const from = new Date(dateFrom + 'T00:00:00');
    const to = new Date(dateTo + 'T00:00:00');
    from.setDate(from.getDate() + days);
    to.setDate(to.getDate() + days);
    onDateFromChange(toISODate(from));
    onDateToChange(toISODate(to));
  }

  function goToThisWeek() {
    onDateFromChange(getDefaultDateFrom());
    onDateToChange(getDefaultDateTo());
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-gray-500">From</Label>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="w-40 h-9"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-gray-500">To</Label>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="w-40 h-9"
        />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => shiftDays(-7)} title="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => shiftDays(7)} title="Next week">
          <ChevronRight className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={goToThisWeek} className="text-xs">
          This Week
        </Button>
      </div>
    </div>
  );
}
