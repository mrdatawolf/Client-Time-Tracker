'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, DollarSign, Users, Plus, FolderKanban } from 'lucide-react';
import { getUser } from '@/lib/api-client';
import { timeEntries as timeEntriesApi, clients as clientsApi, projects as projectsApi, jobTypes as jobTypesApi, settings as settingsApi, type TimeEntry, type Client, type Project, type ProjectStatus } from '@/lib/api';
import { formatCurrency, toISODate, getWeekDates } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import OnboardingWizard from '@/components/OnboardingWizard';
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

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingNeeds, setOnboardingNeeds] = useState({
    jobTypes: false,
    client: false,
    settings: false,
  });
  const [currentSettingsData, setCurrentSettingsData] = useState<Record<string, string>>({});

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

      const [allEntries, unbilledEntries, clientList, allProjects] = await Promise.all([
        timeEntriesApi.list({ dateFrom: weekStart, dateTo: weekEnd }),
        timeEntriesApi.list({ isBilled: false }),
        clientsApi.list(),
        projectsApi.list(),
      ]);

      // Today's hours
      const todayEntries = allEntries.filter((e) => e.date === today);
      setTodayHours(todayEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0));

      // Week's hours
      setWeekHours(allEntries.reduce((sum, e) => sum + parseFloat(e.hours), 0));

      // Unbilled total (all unbilled, not just this week)
      setUnbilledTotal(
        unbilledEntries.reduce((sum, e) => sum + (e.total ? parseFloat(e.total) : 0), 0)
      );

      // Active clients
      setClientCount(clientList.filter((c) => c.isActive).length);

      // Unbilled entries for the table
      setRecentEntries(unbilledEntries);

      // Recent projects (last 5 by updatedAt, active only)
      const sorted = allProjects
        .filter((p) => p.isActive)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);
      setRecentProjects(sorted);

      // Onboarding check — only if not previously dismissed
      const dismissed = localStorage.getItem('ctt_onboarding_dismissed');
      if (!dismissed) {
        const [jobTypeList, appSettings] = await Promise.all([
          jobTypesApi.list(),
          settingsApi.get(),
        ]);
        const activeJobTypes = jobTypeList.filter((jt) => jt.isActive);
        const activeClients = clientList.filter((c) => c.isActive);
        const needsJT = activeJobTypes.length === 0;
        const needsClient = activeClients.length === 0;
        const needsSettings =
          !appSettings.baseHourlyRate ||
          !appSettings.companyName ||
          !appSettings.invoicePayableTo;

        if (needsJT || needsClient || needsSettings) {
          setOnboardingNeeds({
            jobTypes: needsJT,
            client: needsClient,
            settings: needsSettings,
          });
          setCurrentSettingsData(appSettings);
          setShowOnboarding(true);
        }
      }
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

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem('ctt_onboarding_dismissed', 'true');
    loadDashboard();
  };

  return (
    <div>
      {showOnboarding && (
        <OnboardingWizard
          needsJobTypes={onboardingNeeds.jobTypes}
          needsClient={onboardingNeeds.client}
          needsSettings={onboardingNeeds.settings}
          currentSettings={currentSettingsData}
          onComplete={handleOnboardingComplete}
        />
      )}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Welcome back, {user?.displayName || 'User'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Here&apos;s your time tracking overview</p>
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
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{card.label}</span>
              <div className={`${card.color} p-2 rounded-lg`}>
                <card.icon className="w-5 h-5 text-white" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? '...' : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Recent Projects */}
      {!loading && recentProjects.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              Recent Projects
            </h2>
            <Link href="/projects" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
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
                  className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{project.client?.name}</span>
                    </div>
                    {project.note && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{project.note}</p>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                    {sc.label}
                  </span>
                  {project.assignedTo && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                      {project.assignedTo}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unbilled Entries</h2>
        </div>
        {loading ? (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">Loading...</div>
        ) : recentEntries.length === 0 ? (
          <div className="p-6 text-center text-gray-500 dark:text-gray-400">
            No unbilled entries.{' '}
            <Link href="/time-entry" className="text-blue-600 dark:text-blue-400 hover:underline">
              Add your first entry
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Job Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tech</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {recentEntries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 text-gray-600 dark:text-gray-400">{entry.date}</td>
                  <td className="px-6 py-3 font-medium dark:text-gray-200">{entry.client?.name || '-'}</td>
                  <td className="px-6 py-3 text-gray-600 dark:text-gray-400">{entry.jobType?.name || '-'}</td>
                  <td className="px-6 py-3 text-gray-600 dark:text-gray-400">{entry.tech?.displayName || '-'}</td>
                  <td className="px-6 py-3 text-right dark:text-gray-300">{entry.hours}h</td>
                  <td className="px-6 py-3 text-right font-medium dark:text-gray-200">
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
