'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, DollarSign, Users, Plus, FolderKanban } from 'lucide-react';
import { getUser } from '@/lib/api-client';
import { timeEntries as timeEntriesApi, clients as clientsApi, projects as projectsApi, type TimeEntry, type Client, type Project, type ProjectStatus } from '@/lib/api';
import { formatCurrency, toISODate, getWeekDates } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Dashboard() {
  const user = getUser();
  const [todayHours, setTodayHours] = useState(0);
  const [weekHours, setWeekHours] = useState(0);
  const [unbilledTotal, setUnbilledTotal] = useState(0);
  const [clientCount, setClientCount] = useState(0);
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([]);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      // Get dates
      const today = toISODate(new Date());
      const monday = new Date();
      const day = monday.getDay();
      monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
      const weekStart = toISODate(monday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const weekEnd = toISODate(sunday);

      const [allEntries, clientList, allProjects] = await Promise.all([
        timeEntriesApi.list({ dateFrom: weekStart, dateTo: weekEnd }),
        clientsApi.list(),
        projectsApi.list(),
      ]);

      // Today's hours
      const todayEntries = allEntries.filter((e) => e.date === today);
      setTodayHours(todayEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0));

      // Week's hours
      setWeekHours(allEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0));

      // Unbilled total
      const unbilled = allEntries.filter((e) => !e.isBilled);
      setUnbilledTotal(
        unbilled.reduce((sum, e) => sum + (e.total ? parseFloat(e.total) : 0), 0)
      );

      // Active clients
      setClientCount(clientList.filter((c) => c.isActive).length);

      // Recent entries (last 10)
      setRecentEntries(allEntries.slice(0, 10));

      // Recent projects (last 5 by updatedAt, active only)
      const sorted = allProjects
        .filter((p) => p.isActive)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);
      setRecentProjects(sorted);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const cards = [
    { label: "Today's Hours", value: todayHours.toFixed(1) + 'h', icon: Clock, color: 'bg-blue-500' },
    { label: "This Week", value: weekHours.toFixed(1) + 'h', icon: Clock, color: 'bg-green-500' },
    { label: 'Unbilled', value: formatCurrency(unbilledTotal), icon: DollarSign, color: 'bg-amber-500' },
    { label: 'Clients', value: String(clientCount), icon: Users, color: 'bg-purple-500' },
  ];

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.displayName || 'User'}
          </h1>
          <p className="text-gray-500 mt-1">Here&apos;s your time tracking overview</p>
        </div>
        <Link href="/time-entry">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Log Time
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-500">{card.label}</span>
              <div className={`${card.color} p-2 rounded-lg`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {loading ? '...' : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Projects */}
      {!loading && recentProjects.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-gray-400" />
              Recent Projects
            </h2>
            <Link href="/projects" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {recentProjects.map((project) => {
              const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
                in_progress: { label: 'In Progress', bg: 'bg-blue-100', text: 'text-blue-800' },
                waiting_on_client: { label: 'Waiting on Client', bg: 'bg-amber-100', text: 'text-amber-800' },
                need_to_reach_out: { label: 'Need to Reach Out', bg: 'bg-red-100', text: 'text-red-800' },
                needs_call: { label: 'Needs Call', bg: 'bg-purple-100', text: 'text-purple-800' },
                on_hold: { label: 'On Hold', bg: 'bg-gray-100', text: 'text-gray-600' },
                completed: { label: 'Completed', bg: 'bg-green-100', text: 'text-green-800' },
              };
              const sc = statusConfig[project.status] || statusConfig.in_progress;
              return (
                <Link
                  key={project.id}
                  href="/projects"
                  className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{project.name}</span>
                      <span className="text-xs text-gray-400">{project.client?.name}</span>
                    </div>
                    {project.note && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{project.note}</p>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                    {sc.label}
                  </span>
                  {project.assignedTo && (
                    <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                      {project.assignedTo}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Time Entries</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : recentEntries.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No time entries this week.{' '}
            <Link href="/time-entry" className="text-blue-600 hover:underline">
              Add your first entry
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Job Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tech</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-600">{entry.date}</td>
                  <td className="px-6 py-3 font-medium">{entry.client?.name || '-'}</td>
                  <td className="px-6 py-3 text-gray-600">{entry.jobType?.name || '-'}</td>
                  <td className="px-6 py-3 text-gray-600">{entry.tech?.displayName || '-'}</td>
                  <td className="px-6 py-3 text-right">{entry.hours}h</td>
                  <td className="px-6 py-3 text-right font-medium">
                    {entry.total ? formatCurrency(parseFloat(entry.total)) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
