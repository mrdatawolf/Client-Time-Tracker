'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, CheckSquare, Square, Receipt, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { timeEntries as timeEntriesApi, type TimeEntry } from '@/lib/api';
import { getWeekDates, toISODate, formatCurrency } from '@/lib/utils';
import { isAdmin } from '@/lib/api-client';
import TimeEntryDialog from './TimeEntryDialog';

interface TimeEntryGridProps {
  clientId: string;
  weekStart: Date;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TimeEntryGrid({ clientId, weekStart }: TimeEntryGridProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [defaultDate, setDefaultDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const admin = isAdmin();
  const dates = getWeekDates(weekStart);
  const dateFrom = toISODate(dates[0]);
  const dateTo = toISODate(dates[dates.length - 1]);

  const loadEntries = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const data = await timeEntriesApi.grid(clientId, dateFrom, dateTo);
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
  const entriesByDate = new Map<string, TimeEntry[]>();
  for (const d of dates) {
    entriesByDate.set(toISODate(d), []);
  }
  for (const entry of entries) {
    const dateEntries = entriesByDate.get(entry.date);
    if (dateEntries) dateEntries.push(entry);
  }

  // Calculate daily totals
  const dailyTotals = dates.map((d) => {
    const dateEntries = entriesByDate.get(toISODate(d)) || [];
    return {
      hours: dateEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0),
      amount: dateEntries.reduce((sum, e) => sum + (e.total ? parseFloat(e.total) : 0), 0),
    };
  });

  const weekTotalHours = dailyTotals.reduce((sum, d) => sum + d.hours, 0);
  const weekTotalAmount = dailyTotals.reduce((sum, d) => sum + d.amount, 0);

  function handleCellClick(date: string, entry?: TimeEntry) {
    if (entry) {
      setEditingEntry(entry);
      setDefaultDate(date);
    } else {
      setEditingEntry(null);
      setDefaultDate(date);
    }
    setDialogOpen(true);
  }

  function handleAddClick(date: string) {
    setEditingEntry(null);
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

  if (!clientId) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        Select a client to view the time entry grid.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
        Loading...
      </div>
    );
  }

  const isToday = (d: Date) => toISODate(d) === toISODate(new Date());
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id));
  const hasUnbilled = selectedEntries.some((e) => !e.isBilled);
  const hasBilled = selectedEntries.some((e) => e.isBilled);
  const hasUnpaid = selectedEntries.some((e) => !e.isPaid);
  const hasPaid = selectedEntries.some((e) => e.isPaid);

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkUpdate({ isBilled: true })}
                  disabled={bulkLoading}
                >
                  <Receipt className="w-4 h-4 mr-1" />
                  Mark Billed
                </Button>
              )}
              {hasBilled && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkUpdate({ isBilled: false })}
                  disabled={bulkLoading}
                >
                  Unbill
                </Button>
              )}
              {hasUnpaid && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkUpdate({ isPaid: true })}
                  disabled={bulkLoading}
                >
                  <CreditCard className="w-4 h-4 mr-1" />
                  Mark Paid
                </Button>
              )}
              {hasPaid && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkUpdate({ isPaid: false })}
                  disabled={bulkLoading}
                >
                  Unpay
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 divide-x divide-gray-200">
          {dates.map((date, i) => {
            const dateStr = toISODate(date);
            const dayEntries = entriesByDate.get(dateStr) || [];
            const total = dailyTotals[i];

            return (
              <div
                key={dateStr}
                className={`min-h-[200px] flex flex-col ${isToday(date) ? 'bg-blue-50/50' : ''}`}
              >
                {/* Day header */}
                <div
                  className={`px-3 py-2 border-b border-gray-200 text-center ${
                    isToday(date) ? 'bg-blue-100/60' : 'bg-gray-50'
                  }`}
                >
                  <div className="text-xs font-medium text-gray-500 uppercase">{DAY_NAMES[i]}</div>
                  <div className={`text-lg font-semibold ${isToday(date) ? 'text-blue-700' : 'text-gray-800'}`}>
                    {date.getDate()}
                  </div>
                </div>

                {/* Entries */}
                <div className="flex-1 p-2 space-y-1.5">
                  {dayEntries.map((entry) => {
                    const isSelected = selectedIds.has(entry.id);
                    return (
                      <button
                        key={entry.id}
                        onClick={() => handleCellClick(dateStr, entry)}
                        className={`w-full text-left rounded-md border px-2 py-1.5 text-xs hover:border-gray-300 transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="font-medium text-gray-800 truncate flex-1">
                            {entry.jobType?.name || 'Unknown'}
                          </div>
                          {admin && (
                            <span
                              onClick={(e) => toggleSelect(entry.id, e)}
                              className="flex-shrink-0 mt-0.5"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-3 h-3 text-blue-500" />
                              ) : (
                                <Square className="w-3 h-3 text-gray-300 hover:text-gray-500" />
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-gray-500">{entry.hours}h</span>
                          {entry.total && (
                            <span className="text-gray-600 font-medium">
                              {formatCurrency(parseFloat(entry.total))}
                            </span>
                          )}
                        </div>
                        {entry.tech && (
                          <div className="text-gray-400 truncate mt-0.5">
                            {entry.tech.displayName}
                          </div>
                        )}
                        {/* Status indicators */}
                        <div className="flex gap-1 mt-1">
                          {entry.isBilled && (
                            <span className="inline-block px-1 py-0 rounded text-[10px] bg-blue-100 text-blue-600">
                              Billed
                            </span>
                          )}
                          {entry.isPaid && (
                            <span className="inline-block px-1 py-0 rounded text-[10px] bg-green-100 text-green-600">
                              Paid
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Add button & daily total */}
                <div className="border-t border-gray-100 px-2 py-1.5">
                  <button
                    onClick={() => handleAddClick(dateStr)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1 rounded hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                  {total.hours > 0 && (
                    <div className="text-center text-xs mt-1 pt-1 border-t border-gray-100">
                      <span className="text-gray-500">{total.hours}h</span>
                      <span className="text-gray-400 mx-1">|</span>
                      <span className="text-gray-600 font-medium">
                        {formatCurrency(total.amount)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Week total */}
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-600">Week Total</span>
          <div className="text-sm">
            <span className="font-semibold text-gray-800">{weekTotalHours}h</span>
            <span className="text-gray-400 mx-2">|</span>
            <span className="font-semibold text-gray-800">{formatCurrency(weekTotalAmount)}</span>
          </div>
        </div>
      </div>

      <TimeEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingEntry}
        defaultClientId={clientId}
        defaultDate={defaultDate}
        onSaved={loadEntries}
      />
    </>
  );
}
