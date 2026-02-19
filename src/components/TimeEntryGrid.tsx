'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, CheckSquare, Square, Receipt, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { timeEntries as timeEntriesApi, type TimeEntry } from '@/lib/api';
import { toISODate, formatCurrency } from '@/lib/utils';
import { isAdmin } from '@/lib/api-client';
import TimeEntryDialog from './TimeEntryDialog';

interface TimeEntryGridProps {
  clientId: string;
  dateFrom: string;
  dateTo: string;
}

const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getDatesInRange(from: string, to: string): Date[] {
  const dates: Date[] = [];
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Split dates into chunks of 7 (weeks), each chunk gets a label */
function groupIntoWeeks(dates: Date[]): { label: string; dates: Date[] }[] {
  const weeks: { label: string; dates: Date[] }[] = [];
  for (let i = 0; i < dates.length; i += 7) {
    const chunk = dates.slice(i, i + 7);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weeks.push({
      label: `${fmt(first)} – ${fmt(last)}`,
      dates: chunk,
    });
  }
  return weeks;
}

/** Check if a date range is aligned to full weeks (Mon–Sun boundaries) */
function isWeekAligned(from: string, to: string): boolean {
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  const numDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  // Monday = 1 in getDay()
  return start.getDay() === 1 && numDays % 7 === 0;
}

export default function TimeEntryGrid({ clientId, dateFrom, dateTo }: TimeEntryGridProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [defaultDate, setDefaultDate] = useState('');
  const [dialogClientId, setDialogClientId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const admin = isAdmin();
  const dates = useMemo(() => getDatesInRange(dateFrom, dateTo), [dateFrom, dateTo]);

  // Determine if we can use the multi-row week grid or fall back to list
  const weekAligned = useMemo(() => isWeekAligned(dateFrom, dateTo), [dateFrom, dateTo]);
  const weeks = useMemo(() => weekAligned ? groupIntoWeeks(dates) : [], [weekAligned, dates]);
  const useListView = !weekAligned || dates.length > 35; // list for non-week-aligned or > 5 weeks

  const loadEntries = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    try {
      const data = await timeEntriesApi.grid(dateFrom, dateTo, clientId || undefined);
      setEntries(data);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to load grid data:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId, dateFrom, dateTo]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Group entries by date
  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const d of dates) {
      map.set(toISODate(d), []);
    }
    for (const entry of entries) {
      const dateEntries = map.get(entry.date);
      if (dateEntries) dateEntries.push(entry);
    }
    return map;
  }, [dates, entries]);

  const totalHours = entries.reduce((sum, e) => sum + parseFloat(e.hours), 0);
  const totalAmount = entries.reduce((sum, e) => sum + (e.total ? parseFloat(e.total) : 0), 0);

  // Detect current week for highlighting
  const todayStr = toISODate(new Date());
  const currentWeekIndex = weeks.findIndex((w) =>
    w.dates.some((d) => toISODate(d) === todayStr)
  );

  function handleCellClick(date: string, entry?: TimeEntry) {
    if (entry) {
      setEditingEntry(entry);
      setDialogClientId(entry.clientId);
      setDefaultDate(date);
    } else {
      setEditingEntry(null);
      setDialogClientId(clientId);
      setDefaultDate(date);
    }
    setDialogOpen(true);
  }

  function handleAddClick(date: string) {
    setEditingEntry(null);
    setDialogClientId(clientId);
    setDefaultDate(date);
    setDialogOpen(true);
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  }

  async function handleBulkUpdate(updates: { isBilled?: boolean; isPaid?: boolean }) {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      await timeEntriesApi.bulkUpdate(Array.from(selectedIds), updates);
      loadEntries();
    } catch (err) {
      console.error('Bulk update failed:', err);
    } finally {
      setBulkLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        Loading...
      </div>
    );
  }

  const isToday = (d: Date) => toISODate(d) === todayStr;
  const showClientName = !clientId;
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
  const hasUnbilled = selectedEntries.some((e) => !e.isBilled);
  const hasBilled = selectedEntries.some((e) => e.isBilled);
  const hasUnpaid = selectedEntries.some((e) => !e.isPaid);
  const hasPaid = selectedEntries.some((e) => e.isPaid);

  /** Render a single entry card (used in both grid and list view) */
  function renderEntryCard(entry: TimeEntry, dateStr: string, compact: boolean) {
    const isSelected = selectedIds.has(entry.id);
    if (!compact) {
      // list view row
      return (
        <button
          key={entry.id}
          onClick={() => handleCellClick(dateStr, entry)}
          className="w-full text-left rounded-md border border-gray-200 hover:border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 transition-colors cursor-pointer flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            {showClientName && (
              <span className="text-gray-600 font-medium truncate">
                {entry.client?.name || 'Unknown'}
              </span>
            )}
            <span className="text-gray-800">{entry.jobType?.name || 'Unknown'}</span>
            {entry.tech && <span className="text-gray-400 text-xs">{entry.tech.displayName}</span>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-gray-500">{entry.hours}h</span>
            {entry.total && <span className="text-gray-600 font-medium">{formatCurrency(parseFloat(entry.total))}</span>}
            <div className="flex gap-1">
              {entry.isBilled && <span className="px-1 py-0 rounded text-[10px] bg-blue-100 text-blue-600">Billed</span>}
              {entry.isPaid && <span className="px-1 py-0 rounded text-[10px] bg-green-100 text-green-600">Paid</span>}
            </div>
            {admin && (
              <span onClick={(e) => toggleSelect(entry.id, e)}>
                {isSelected ? <CheckSquare className="w-4 h-4 text-blue-500" /> : <Square className="w-4 h-4 text-gray-300 hover:text-gray-500" />}
              </span>
            )}
          </div>
        </button>
      );
    }
    // compact grid card
    return (
      <button
        key={entry.id}
        onClick={() => handleCellClick(dateStr, entry)}
        className={`w-full text-left rounded-md border px-2 py-1 text-xs hover:border-gray-300 transition-colors cursor-pointer ${
          isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
        }`}
      >
        {showClientName && (
          <div className="text-[10px] text-blue-600 font-medium truncate">
            {entry.client?.name || 'Unknown'}
          </div>
        )}
        <div className="flex items-center justify-between gap-1">
          <div className="font-medium text-gray-800 truncate flex-1">
            {entry.jobType?.name || 'Unknown'}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {entry.tech && <span className="text-gray-400 truncate max-w-[60px]">{entry.tech.displayName}</span>}
            {admin && (
              <span onClick={(e) => toggleSelect(entry.id, e)}>
                {isSelected ? <CheckSquare className="w-3 h-3 text-blue-500" /> : <Square className="w-3 h-3 text-gray-300 hover:text-gray-500" />}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500">{entry.hours}h</span>
          <div className="flex items-center gap-1">
            {entry.isBilled && <span className="px-1 py-0 rounded text-[10px] bg-blue-100 text-blue-600">B</span>}
            {entry.isPaid && <span className="px-1 py-0 rounded text-[10px] bg-green-100 text-green-600">P</span>}
            {entry.total && <span className="text-gray-600 font-medium">{formatCurrency(parseFloat(entry.total))}</span>}
          </div>
        </div>
      </button>
    );
  }

  /** Render a single week row (7-column grid) */
  function renderWeekRow(weekDates: Date[], weekIndex: number) {
    const isCurrentWeek = weekIndex === currentWeekIndex;
    const weekHours = weekDates.reduce((sum, d) => {
      const dayEntries = entriesByDate.get(toISODate(d)) || [];
      return sum + dayEntries.reduce((s, e) => s + parseFloat(e.hours), 0);
    }, 0);
    const weekAmount = weekDates.reduce((sum, d) => {
      const dayEntries = entriesByDate.get(toISODate(d)) || [];
      return sum + dayEntries.reduce((s, e) => s + (e.total ? parseFloat(e.total) : 0), 0);
    }, 0);

    return (
      <div key={weekIndex} className={`${weekIndex > 0 ? 'border-t-2 border-gray-300' : ''}`}>
        <div className="grid grid-cols-7 divide-x divide-gray-200">
          {weekDates.map((date) => {
            const dateStr = toISODate(date);
            const dayEntries = entriesByDate.get(dateStr) || [];
            const dayHours = dayEntries.reduce((s, e) => s + parseFloat(e.hours), 0);
            const dayAmount = dayEntries.reduce((s, e) => s + (e.total ? parseFloat(e.total) : 0), 0);

            return (
              <div
                key={dateStr}
                className={`min-h-[160px] flex flex-col ${isToday(date) ? 'bg-blue-50/50' : ''}`}
              >
                {/* Day header */}
                <div
                  className={`px-2 py-1.5 border-b border-gray-200 text-center ${
                    isToday(date) ? 'bg-blue-100/60' : isCurrentWeek ? 'bg-gray-50' : 'bg-gray-100/50'
                  }`}
                >
                  <div className="text-xs font-medium text-gray-500 uppercase">{SHORT_DAY_NAMES[date.getDay()]}</div>
                  <div className={`text-sm font-semibold ${isToday(date) ? 'text-blue-700' : 'text-gray-800'}`}>
                    {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>

                {/* Entries */}
                <div className="flex-1 p-1.5 space-y-1">
                  {dayEntries.map((entry) => renderEntryCard(entry, dateStr, true))}
                </div>

                {/* Add button & daily total */}
                <div className="border-t border-gray-100 px-1.5 py-1">
                  {clientId && (
                    <button
                      onClick={() => handleAddClick(dateStr)}
                      className="w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-0.5 rounded hover:bg-gray-50 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  )}
                  {dayHours > 0 && (
                    <div className="text-center text-[11px] mt-0.5 pt-0.5 border-t border-gray-100">
                      <span className="text-gray-500">{dayHours}h</span>
                      <span className="text-gray-400 mx-0.5">|</span>
                      <span className="text-gray-600 font-medium">{formatCurrency(dayAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Week total row */}
        <div className={`border-t border-gray-200 px-4 py-1.5 flex items-center justify-between ${isCurrentWeek ? 'bg-blue-50/30' : 'bg-gray-50/50'}`}>
          <span className="text-xs font-medium text-gray-500">Week Total</span>
          <div className="text-xs">
            <span className="font-semibold text-gray-700">{weekHours}h</span>
            <span className="text-gray-400 mx-1.5">|</span>
            <span className="font-semibold text-gray-700">{formatCurrency(weekAmount)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Bulk actions bar */}
      {admin && entries.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <Button variant="outline" size="sm" onClick={selectAll}>
            {selectedIds.size === entries.length ? (
              <CheckSquare className="w-4 h-4 mr-1" />
            ) : (
              <Square className="w-4 h-4 mr-1" />
            )}
            {selectedIds.size === entries.length ? 'Deselect All' : 'Select All'}
          </Button>
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm text-gray-500">{selectedIds.size} selected</span>
              {hasUnbilled && (
                <Button variant="outline" size="sm" onClick={() => handleBulkUpdate({ isBilled: true })} disabled={bulkLoading}>
                  <Receipt className="w-4 h-4 mr-1" />
                  Mark Billed
                </Button>
              )}
              {hasBilled && (
                <Button variant="outline" size="sm" onClick={() => handleBulkUpdate({ isBilled: false })} disabled={bulkLoading}>
                  Unbill
                </Button>
              )}
              {hasUnpaid && (
                <Button variant="outline" size="sm" onClick={() => handleBulkUpdate({ isPaid: true })} disabled={bulkLoading}>
                  <CreditCard className="w-4 h-4 mr-1" />
                  Mark Paid
                </Button>
              )}
              {hasPaid && (
                <Button variant="outline" size="sm" onClick={() => handleBulkUpdate({ isPaid: false })} disabled={bulkLoading}>
                  Unpay
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {useListView ? (
        /* List view for non-week-aligned or very long ranges */
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {dates.map((date) => {
            const dateStr = toISODate(date);
            const dayEntries = entriesByDate.get(dateStr) || [];
            if (dayEntries.length === 0) return null;
            const dayHours = dayEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0);
            const dayAmount = dayEntries.reduce((sum, e) => sum + (e.total ? parseFloat(e.total) : 0), 0);

            return (
              <div key={dateStr} className={`border-b border-gray-200 last:border-b-0 ${isToday(date) ? 'bg-blue-50/50' : ''}`}>
                <div className={`px-4 py-2 flex items-center justify-between ${isToday(date) ? 'bg-blue-100/60' : 'bg-gray-50'}`}>
                  <span className="text-sm font-medium text-gray-700">
                    {SHORT_DAY_NAMES[date.getDay()]} {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="text-xs text-gray-500">{dayHours}h | {formatCurrency(dayAmount)}</span>
                </div>
                <div className="px-4 py-2 space-y-1">
                  {dayEntries.map((entry) => renderEntryCard(entry, dateStr, false))}
                </div>
              </div>
            );
          })}

          {entries.length === 0 && (
            <div className="p-8 text-center text-gray-500">No entries in this date range.</div>
          )}

          {/* Range total */}
          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Total</span>
            <div className="text-sm">
              <span className="font-semibold text-gray-800">{totalHours}h</span>
              <span className="text-gray-400 mx-2">|</span>
              <span className="font-semibold text-gray-800">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>
      ) : (
        /* Multi-week grid view: one row per week */
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {weeks.map((week, i) => renderWeekRow(week.dates, i))}

          {entries.length === 0 && (
            <div className="p-8 text-center text-gray-500">No entries in this date range.</div>
          )}

          {/* Grand total */}
          {weeks.length > 1 && (
            <div className="border-t-2 border-gray-300 bg-gray-50 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Total ({weeks.length} weeks)</span>
              <div className="text-sm">
                <span className="font-semibold text-gray-800">{totalHours}h</span>
                <span className="text-gray-400 mx-2">|</span>
                <span className="font-semibold text-gray-800">{formatCurrency(totalAmount)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <TimeEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingEntry}
        defaultClientId={dialogClientId || undefined}
        defaultDate={defaultDate}
        onSaved={loadEntries}
      />
    </>
  );
}
