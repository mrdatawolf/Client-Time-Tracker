'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWeekDates, toISODate } from '@/lib/utils';

interface DateRangePickerProps {
  weekStart: Date;
  onWeekChange: (newStart: Date) => void;
}

export default function DateRangePicker({ weekStart, onWeekChange }: DateRangePickerProps) {
  const dates = getWeekDates(weekStart);
  const weekEnd = dates[dates.length - 1];

  function goToPreviousWeek() {
    const prev = new Date(weekStart);
    prev.setDate(prev.getDate() - 7);
    onWeekChange(prev);
  }

  function goToNextWeek() {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7);
    onWeekChange(next);
  }

  function goToThisWeek() {
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    onWeekChange(monday);
  }

  const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <div className="text-sm font-medium min-w-[180px] text-center">
        {formatDate(weekStart)} - {formatDate(weekEnd)}
      </div>
      <Button variant="outline" size="sm" onClick={goToNextWeek}>
        <ChevronRight className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={goToThisWeek} className="text-xs">
        Today
      </Button>
    </div>
  );
}
