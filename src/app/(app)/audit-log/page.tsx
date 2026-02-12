'use client';

import { useState, useEffect, useCallback } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  auditLog as auditLogApi,
  users as usersApi,
  type AuditLogEntry,
  type User,
} from '@/lib/api';
import { formatDate } from '@/lib/utils';

const TABLE_OPTIONS = [
  { value: '', label: 'All Tables' },
  { value: 'users', label: 'Users' },
  { value: 'clients', label: 'Clients' },
  { value: 'job_types', label: 'Job Types' },
  { value: 'rate_tiers', label: 'Rate Tiers' },
  { value: 'time_entries', label: 'Time Entries' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'payments', label: 'Payments' },
  { value: 'partner_splits', label: 'Partner Splits' },
  { value: 'app_settings', label: 'Settings' },
];

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [userList, setUserList] = useState<User[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    usersApi.list().then(setUserList).catch(console.error);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditLogApi.list({
        table: tableFilter || undefined,
        userId: userFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setEntries(data);
    } catch (err) {
      console.error('Failed to load audit log:', err);
    } finally {
      setLoading(false);
    }
  }, [tableFilter, userFilter, offset]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleFilterChange() {
    setOffset(0);
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function formatJsonPreview(json: string | null): string {
    if (!json) return '-';
    try {
      const obj = JSON.parse(json);
      if (obj.success) return '{ success }';
      if (obj.id) return `{ id: ${obj.id.slice(0, 8)}... }`;
      return JSON.stringify(obj).slice(0, 80) + (JSON.stringify(obj).length > 80 ? '...' : '');
    } catch {
      return json.slice(0, 80);
    }
  }

  const actionColors: Record<string, string> = {
    create: 'bg-green-100 text-green-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    generate: 'bg-purple-100 text-purple-700',
    bulk: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ScrollText className="w-6 h-6" />
          Audit Log
        </h1>
        <p className="text-gray-500 mt-1">Track all changes made in the system</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Table</label>
          <select
            value={tableFilter}
            onChange={(e) => { setTableFilter(e.target.value); handleFilterChange(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white h-9"
          >
            {TABLE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">User</label>
          <select
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value); handleFilterChange(); }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white h-9"
          >
            <option value="">All Users</option>
            {userList.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No audit log entries found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Table</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Record</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatTime(entry.createdAt)}</td>
                      <td className="px-4 py-2 text-gray-900">{entry.userName || '-'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[entry.action] || 'bg-gray-100 text-gray-700'}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600 font-mono text-xs">{entry.tableName}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono text-xs">
                        {entry.recordId ? entry.recordId.slice(0, 8) + '...' : '-'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {expandedId === entry.id ? 'Click to collapse' : formatJsonPreview(entry.newValues)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expanded detail view */}
            {expandedId && entries.find(e => e.id === expandedId)?.newValues && (
              <div className="border-t border-gray-200 bg-gray-50 p-4">
                <p className="text-xs font-medium text-gray-500 mb-2">New Values:</p>
                <pre className="text-xs text-gray-700 bg-white p-3 rounded border overflow-x-auto max-h-64">
                  {JSON.stringify(JSON.parse(entries.find(e => e.id === expandedId)!.newValues!), null, 2)}
                </pre>
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-500">
                Showing {offset + 1}-{offset + entries.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={entries.length < PAGE_SIZE}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
