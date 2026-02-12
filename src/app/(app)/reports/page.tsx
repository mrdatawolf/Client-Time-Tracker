'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Download, Users, Briefcase, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  reports as reportsApi,
  clients as clientsApi,
  type ClientSummary,
  type TechSummary,
  type DateRangeEntry,
  type Client,
} from '@/lib/api';
import { formatCurrency, formatDate, toISODate } from '@/lib/utils';
import { isAdmin } from '@/lib/api-client';

type Tab = 'client' | 'tech' | 'entries';

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

  // Default date range: first of current month to today
  useEffect(() => {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateFrom(toISODate(firstOfMonth));
    setDateTo(toISODate(now));
    clientsApi.list().then(setClientList).catch(console.error);
  }, []);

  const loadData = useCallback(async () => {
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

  function handleExport() {
    const url = reportsApi.exportUrl({
      dateFrom,
      dateTo,
      clientId: clientFilter || undefined,
    });
    window.open(url, '_blank');
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

  const tabs: { key: Tab; label: string; icon: typeof BarChart3; adminOnly?: boolean }[] = [
    { key: 'client', label: 'By Client', icon: Briefcase, adminOnly: true },
    { key: 'tech', label: 'By Tech', icon: Users, adminOnly: true },
    { key: 'entries', label: 'Entries', icon: List },
  ];

  const visibleTabs = tabs.filter(t => !t.adminOnly || admin);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            Reports
          </h1>
          <p className="text-gray-500 mt-1">Time and revenue analytics</p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
        {tab === 'entries' && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Client</label>
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white h-9"
            >
              <option value="">All Clients</option>
              {clientList.filter(c => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          Loading...
        </div>
      ) : tab === 'client' ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {clientSummary.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No data for this period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clientSummary.map((row) => (
                  <tr key={row.clientId} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{row.clientName}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.entryCount}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.totalHours.toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">
                      {row.totalHours > 0 ? formatCurrency(row.totalRevenue / row.totalHours) : '-'}/h
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td className="px-6 py-3 text-gray-700">Total</td>
                  <td className="px-6 py-3 text-right text-gray-700">{clientTotalEntries}</td>
                  <td className="px-6 py-3 text-right text-gray-700">{clientTotalHours.toFixed(2)}h</td>
                  <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(clientTotalRevenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">
                    {clientTotalHours > 0 ? formatCurrency(clientTotalRevenue / clientTotalHours) : '-'}/h
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : tab === 'tech' ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {techSummary.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No data for this period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tech</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {techSummary.map((row) => (
                  <tr key={row.techId} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{row.techName}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.entryCount}</td>
                    <td className="px-6 py-3 text-right text-gray-600">{row.totalHours.toFixed(2)}h</td>
                    <td className="px-6 py-3 text-right font-medium text-gray-900">{formatCurrency(row.totalRevenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-600">
                      {row.totalHours > 0 ? formatCurrency(row.totalRevenue / row.totalHours) : '-'}/h
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <td className="px-6 py-3 text-gray-700">Total</td>
                  <td className="px-6 py-3 text-right text-gray-700">{techTotalEntries}</td>
                  <td className="px-6 py-3 text-right text-gray-700">{techTotalHours.toFixed(2)}h</td>
                  <td className="px-6 py-3 text-right text-gray-900">{formatCurrency(techTotalRevenue)}</td>
                  <td className="px-6 py-3 text-right text-gray-600">
                    {techTotalHours > 0 ? formatCurrency(techTotalRevenue / techTotalHours) : '-'}/h
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {entries.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No entries for this period</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tech</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Type</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entries.map((e) => (
                      <tr key={e.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="px-4 py-2 text-gray-900">{e.clientName}</td>
                        <td className="px-4 py-2 text-gray-600">{e.techName}</td>
                        <td className="px-4 py-2 text-gray-600">{e.jobTypeName}</td>
                        <td className="px-4 py-2 text-right">{parseFloat(e.hours).toFixed(2)}h</td>
                        <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(e.rate)}</td>
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
                    <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
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
      )}
    </div>
  );
}
