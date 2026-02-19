'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import ClientSelector from '@/components/ClientSelector';
import DateRangePicker, { getDefaultDateFrom, getDefaultDateTo } from '@/components/DateRangePicker';
import TimeEntryGrid from '@/components/TimeEntryGrid';

export default function TimeEntryPage() {
  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [dateTo, setDateTo] = useState(getDefaultDateTo);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clock className="w-6 h-6" />
          Time Entry
        </h1>
        <p className="text-gray-500 mt-1">Log hours for a client by day</p>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <ClientSelector
          value={clientId}
          onChange={setClientId}
          className="w-64"
          allowAll
        />
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </div>

      <TimeEntryGrid clientId={clientId} dateFrom={dateFrom} dateTo={dateTo} />
    </div>
  );
}
