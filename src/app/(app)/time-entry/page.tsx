'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Clock } from 'lucide-react';
import { useSelectedClient } from '@/components/SelectedClientProvider';
import DateRangePicker, { getDefaultDateFrom, getDefaultDateTo } from '@/components/DateRangePicker';
import TimeEntryGrid from '@/components/TimeEntryGrid';
import { users as usersApi, type User } from '@/lib/api';
import { isAdmin } from '@/lib/api-client';

function TimeEntryPageInner() {
  const searchParams = useSearchParams();
  const admin = isAdmin();
  const { selectedClientId } = useSelectedClient();
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom);
  const [dateTo, setDateTo] = useState(getDefaultDateTo);
  const [techId, setTechId] = useState(() => searchParams.get('techId') || '');
  const [techList, setTechList] = useState<User[]>([]);

  useEffect(() => {
    if (!admin) return;
    usersApi.list().then((list) => setTechList(list.filter((u) => u.isActive))).catch(console.error);
  }, [admin]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Clock className="w-6 h-6" />
          Time Entry
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Log hours for a client by day</p>
      </div>

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
        {admin && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Person</label>
            <select
              value={techId}
              onChange={(e) => setTechId(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 h-9"
            >
              <option value="">Everyone</option>
              {techList.map((t) => (
                <option key={t.id} value={t.id}>{t.displayName}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <TimeEntryGrid clientId={selectedClientId} dateFrom={dateFrom} dateTo={dateTo} techId={techId} />
    </div>
  );
}

export default function TimeEntryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-500">Loading...</div>}>
      <TimeEntryPageInner />
    </Suspense>
  );
}
