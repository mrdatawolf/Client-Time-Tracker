'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Download, Users, Briefcase, List, DollarSign, Pencil, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  reports as reportsApi,
  clients as clientsApi,
  timeEntries as timeEntriesApi,
  type ClientSummary,
  type TechSummary,
  type DateRangeEntry,
  type BalanceEntry,
  type Client,
} from '@/lib/api';
import { formatCurrency, formatDate, toISODate } from '@/lib/utils';
import { isAdmin } from '@/lib/api-client';

type Tab = 'client' | 'tech' | 'entries' | 'balance';

export default function ReportsPage() {
  const admin = isAdmin();
  const [tab, setTab] = useState<Tab>('client');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [clientList, setClientList] = useState<Client[]>([]);
  const [clientSummary, setClientSummary] = useState<ClientSummary[]>([]);
  const [techSummary, setTechSummary] = useState<TechSummary[]>([]);
  const [entries, setEntries] = useState<DateRangeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Balance tab state
  const [balanceClient, setBalanceClient] = useState('');
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'unbilled' | 'unpaid' | 'paid'>('all');
  const [balanceEntries, setBalanceEntries] = useState<BalanceEntry[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Edit dialog state
  const [editEntry, setEditEntry] = useState<BalanceEntry | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editHours, setEditHours] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editIsBilled, setEditIsBilled] = useState(false);
  const [editIsPaid, setEditIsPaid] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Mark paid confirmation
  const [confirmPaidEntry, setConfirmPaidEntry] = useState<BalanceEntry | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);

  // Default date range: first of current month to today
  useEffect(() => {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateFrom(toISODate(firstOfMonth));
    setDateTo(toISODate(now));
    clientsApi.list().then((clients) => {
      setClientList(clients);
      // Default balance client to first active client
      const active = clients.filter(c => c.isActive);
      if (active.length > 0 && !balanceClient) {
        setBalanceClient(active[0].id);
      }
    }).catch(console.error);
  }, []);

  const loadData = useCallback(async () => {
    if (tab === 'balance') return; // balance tab has its own loader
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    try {
      const filters = { dateFrom, dateTo };
      if (tab === 'client') {
        setClientSummary(await reportsApi.clientSummary(filters));
      } else if (tab === 'tech') {
        setTechSummary(await reportsApi.techSummary(filters));
      } else {
        setEntries(await reportsApi.dateRange({ ...filters, clientId: clientFilter || undefined }));
      }
    } catch (err) {
      console.error('Failed to load report:', err);
    } finally {
      setLoading(false);
    }
  }, [tab, dateFrom, dateTo, clientFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Balance tab data loader
  const loadBalance = useCallback(async () => {
    if (!balanceClient) return;
    setBalanceLoading(true);
    try {
      setBalanceEntries(await reportsApi.balance(balanceClient, balanceFilter));
    } catch (err) {
      console.error('Failed to load balance:', err);
    } finally {
      setBalanceLoading(false);
    }
  }, [balanceClient, balanceFilter]);

  useEffect(() => {
    if (tab === 'balance') {
      loadBalance();
    }
  }, [tab, loadBalance]);

  function handleExport() {
    const url = reportsApi.exportUrl({
      dateFrom,
      dateTo,
      clientId: clientFilter || undefined,
    });
    window.open(url, '_blank');
  }

  function openEdit(entry: BalanceEntry) {
    setEditEntry(entry);
    setEditDate(entry.date);
    setEditHours(entry.hours);
    setEditNotes(entry.notes || '');
    setEditIsBilled(entry.isBilled);
    setEditIsPaid(entry.isPaid);
  }

  async function handleEditSave() {
    if (!editEntry) return;
    setEditSaving(true);
    try {
      await timeEntriesApi.update(editEntry.id, {
        date: editDate,
        hours: parseFloat(editHours),
        notes: editNotes || undefined,
        isBilled: editIsBilled,
        isPaid: editIsPaid,
      });
      setEditEntry(null);
      loadBalance();
    } catch (err) {
      console.error('Failed to update entry:', err);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleMarkPaid() {
    if (!confirmPaidEntry?.invoiceId) return;
    setMarkingPaid(true);
    try {
      await reportsApi.markPaid(confirmPaidEntry.invoiceId);
      setConfirmPaidEntry(null);
      loadBalance();
    } catch (err) {
      console.error('Failed to mark paid:', err);
    } finally {
      setMarkingPaid(false);
    }
  }

  // Totals for client summary
  const clientTotalHours = clientSummary.reduce((s, c) => s + c.totalHours, 0);
  const clientTotalRevenue = clientSummary.reduce((s, c) => s + c.totalRevenue, 0);
  const clientTotalEntries = clientSummary.reduce((s, c) => s + c.entryCount, 0);

  // Totals for tech summary
  const techTotalHours = techSummary.reduce((s, t) => s + t.totalHours, 0);
  const techTotalRevenue = techSummary.reduce((s, t) => s + t.totalRevenue, 0);
  const techTotalEntries = techSummary.reduce((s, t) => s + t.entryCount, 0);

  // Totals for entries
  const entriesTotalHours = entries.reduce((s, e) => s + parseFloat(e.hours), 0);
  const entriesTotalRevenue = entries.reduce((s, e) => s + parseFloat(e.total), 0);

  // Totals for balance
  const balanceTotalHours = balanceEntries.reduce((s, e) => s + parseFloat(e.hours), 0);
  const balanceTotalAmount = balanceEntries.reduce((s, e) => s + parseFloat(e.total), 0);

  const tabs: { key: Tab; label: string; icon: typeof BarChart3; adminOnly?: boolean }[] = [
    { key: 'client', label: 'By Client', icon: Briefcase, adminOnly: true },
    { key: 'tech', label: 'By Tech', icon: Users, adminOnly: true },
    { key: 'entries', label: 'Entries', icon: List },
    { key: 'balance', label: 'Balance', icon: DollarSign, adminOnly: true },
  ];

  const visibleTabs = tabs.filter(t => !t.adminOnly || admin);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            Reports
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Time and revenue analytics</p>
        </div>
        {tab !== 'balance' && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        )}
      </div>

      {/* Filters */}
      {tab !== 'balance' ? (
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">From</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">To</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
            />
          </div>
          {tab === 'entries' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Client</label>
              <select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 h-9"
              >
                <option value="">All Clients</option>
                {clientList.filter(c => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3 mb-6">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Client</label>
            <select
              value={balanceClient}
              onChange={(e) => setBalanceClient(e.target.value)}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 h-9"
            >
              {clientList.filter(c => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Show</label>
            <select
              value={balanceFilter}
              onChange={(e) => setBalanceFilter(e.target.value as 'all' | 'unbilled' | 'unpaid' | 'paid')}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-gray-100 h-9"
            >
              <option value="all">All Outstanding</option>
              <option value="unbilled">Unbilled Only</option>
              <option value="unpaid">Unpaid (Billed) Only</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && tab !== 'balance' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
          Loading...
        </div>
      ) : tab === 'client' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {clientSummary.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">No data for this period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Client</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Entries</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unbilled</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Billed</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Paid</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Revenue</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Avg Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {clientSummary.map((row) => (
                  <tr key={row.clientId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{row.clientName}</td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{row.entryCount}</td>
                    <td className="px-6 py-3 text-right">
                      {row.unbilledCount > 0 ? <span className="text-amber-600">{row.unbilledCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {row.billedCount > 0 ? <span className="text-blue-600">{row.billedCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {row.paidCount > 0 ? <span className="text-green-600">{row.paidCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{row.totalHours.toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">
                      {row.totalHours > 0 ? formatCurrency(row.totalRevenue / row.totalHours) : '-'}/h
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-semibold">
                  <td className="px-6 py-3 text-gray-700 dark:text-gray-300">Total</td>
                  <td className="px-6 py-3 text-right text-gray-700 dark:text-gray-300">{clientTotalEntries}</td>
                  <td className="px-6 py-3 text-right text-amber-600">{clientSummary.reduce((s, c) => s + c.unbilledCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-blue-600">{clientSummary.reduce((s, c) => s + c.billedCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-green-600">{clientSummary.reduce((s, c) => s + c.paidCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-gray-700 dark:text-gray-300">{clientTotalHours.toFixed(2)}h</td>
                  <td className="px-6 py-3 text-right text-gray-900 dark:text-gray-100">{formatCurrency(clientTotalRevenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">
                    {clientTotalHours > 0 ? formatCurrency(clientTotalRevenue / clientTotalHours) : '-'}/h
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : tab === 'tech' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {techSummary.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">No data for this period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tech</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Entries</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unbilled</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Billed</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Paid</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Revenue</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Avg Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {techSummary.map((row) => (
                  <tr key={row.techId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{row.techName}</td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{row.entryCount}</td>
                    <td className="px-6 py-3 text-right">
                      {row.unbilledCount > 0 ? <span className="text-amber-600">{row.unbilledCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {row.billedCount > 0 ? <span className="text-blue-600">{row.billedCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {row.paidCount > 0 ? <span className="text-green-600">{row.paidCount}</span> : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-400">{row.totalHours.toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">
                      {row.totalHours > 0 ? formatCurrency(row.totalRevenue / row.totalHours) : '-'}/h
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-semibold">
                  <td className="px-6 py-3 text-gray-700 dark:text-gray-300">Total</td>
                  <td className="px-6 py-3 text-right text-gray-700 dark:text-gray-300">{techTotalEntries}</td>
                  <td className="px-6 py-3 text-right text-amber-600">{techSummary.reduce((s, t) => s + t.unbilledCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-blue-600">{techSummary.reduce((s, t) => s + t.billedCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-green-600">{techSummary.reduce((s, t) => s + t.paidCount, 0)}</td>
                  <td className="px-6 py-3 text-right text-gray-700 dark:text-gray-300">{techTotalHours.toFixed(2)}h</td>
                  <td className="px-6 py-3 text-right text-gray-900 dark:text-gray-100">{formatCurrency(techTotalRevenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">
                    {techTotalHours > 0 ? formatCurrency(techTotalRevenue / techTotalHours) : '-'}/h
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : tab === 'entries' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {entries.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">No entries for this period</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Client</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tech</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Job Type</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {entries.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{e.clientName}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{e.techName}</td>
                        <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{e.jobTypeName}</td>
                        <td className="px-4 py-2 text-right">{parseFloat(e.hours).toFixed(2)}h</td>
                        <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(e.rate)}</td>
                        <td className="px-4 py-2 text-right font-medium">{formatCurrency(e.total)}</td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex gap-1 justify-center">
                            {e.isBilled && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-600">Billed</span>
                            )}
                            {e.isPaid && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-600">Paid</span>
                            )}
                            {!e.isBilled && !e.isPaid && (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-semibold">
                      <td colSpan={4} className="px-4 py-3 text-gray-700">
                        {entries.length} entries
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{entriesTotalHours.toFixed(2)}h</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(entriesTotalRevenue)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Balance tab */
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          {balanceLoading ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">Loading...</div>
          ) : !balanceClient ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">Select a client to view outstanding items</div>
          ) : balanceEntries.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              {balanceFilter === 'paid' ? 'No paid items for this client' : 'No outstanding items for this client'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Client</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tech</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Job Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Notes</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {balanceEntries.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">{e.clientName}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{e.techName}</td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{e.jobTypeName}</td>
                      <td className="px-4 py-2 text-right">{parseFloat(e.hours).toFixed(2)}h</td>
                      <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{formatCurrency(e.rate)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(e.total)}</td>
                      <td className="px-4 py-2 text-center">
                        {e.isPaid ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-700">
                            Paid
                          </span>
                        ) : e.isBilled ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-600" title={e.invoiceNumber || undefined}>
                            Unpaid {e.invoiceNumber && `(${e.invoiceNumber})`}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">
                            Unbilled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500 max-w-[200px] truncate" title={e.notes || undefined}>
                        {e.notes || '-'}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Edit entry"
                            onClick={() => openEdit(e)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {e.isBilled && e.invoiceId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                              title="Mark invoice as paid"
                              onClick={() => setConfirmPaidEntry(e)}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 font-semibold">
                    <td colSpan={4} className="px-4 py-3 text-gray-700">
                      {balanceEntries.length} entries
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{balanceTotalHours.toFixed(2)}h</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(balanceTotalAmount)}</td>
                    <td colSpan={3} className="px-4 py-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit Entry Dialog */}
      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Time Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Date</label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Hours</label>
              <Input
                type="number"
                step="0.25"
                min="0"
                value={editHours}
                onChange={(e) => setEditHours(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsBilled}
                  onChange={(e) => setEditIsBilled(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Billed
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editIsPaid}
                  onChange={(e) => setEditIsPaid(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Paid
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Paid Confirmation Dialog */}
      <Dialog open={!!confirmPaidEntry} onOpenChange={(open) => !open && setConfirmPaidEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Invoice as Paid</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-400 py-2">
            Mark invoice <span className="font-semibold">{confirmPaidEntry?.invoiceNumber}</span> as fully paid?
            This will record a payment for the remaining balance and mark the invoice as paid.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPaidEntry(null)}>Cancel</Button>
            <Button onClick={handleMarkPaid} disabled={markingPaid}>
              {markingPaid ? 'Processing...' : 'Mark as Paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
