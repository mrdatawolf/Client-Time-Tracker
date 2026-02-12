'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import ClientSelector from '@/components/ClientSelector';
import DateRangePicker from '@/components/DateRangePicker';
import TimeEntryGrid from '@/components/TimeEntryGrid';

function getMonday(): Date {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export default function TimeEntryPage() {
  const [clientId, setClientId] = useState('');
  const [weekStart, setWeekStart] = useState(getMonday);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="w-6 h-6" />
          Time Entry
        </h1>
        <p className="text-gray-500 mt-1">Log hours for a client by day</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-6">
        <ClientSelector
          value={clientId}
          onChange={setClientId}
          className="w-64"
        />
        <DateRangePicker
          weekStart={weekStart}
          onWeekChange={setWeekStart}
        />
      </div>

      <TimeEntryGrid clientId={clientId} weekStart={weekStart} />
    </div>
  );
}
