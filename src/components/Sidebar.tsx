'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Clock,
  LayoutDashboard,
  Users,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  Handshake,
  ScrollText,
  FolderKanban,
  RefreshCw,
  Wifi,
  Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearToken, getUser } from '@/lib/api-client';
import { supabaseSync, type SyncStatus } from '@/lib/api';
import { ThemeToggle } from './ThemeToggle';
import { toast } from 'sonner';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/time-entry', label: 'Time Entry', icon: Clock },
  { href: '/clients', label: 'Clients', icon: Briefcase },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/invoices', label: 'Invoices', icon: FileText },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
];

const adminItems = [
  { href: '/partner', label: 'Partner', icon: Handshake },
  { href: '/audit-log', label: 'Audit Log', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const user = getUser();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const isAdminOrPartner = user?.role === 'admin' || user?.role === 'partner';

  // Load sync status and poll
  useEffect(() => {
    if (!isAdminOrPartner) return;
    let cancelled = false;

    async function fetchStatus() {
      try {
        const s = await supabaseSync.getStatus();
        if (!cancelled) setSyncStatus(s);
      } catch {
        // Not configured or not admin — ignore
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isAdminOrPartner]);


  async function handleSync() {
    setSyncing(true);
    try {
      const result = await supabaseSync.sync();
      setSyncStatus(await supabaseSync.getStatus());
      toast.success('Sync complete', {
        description: `Pushed ${result.pushed} and pulled ${result.pulled} records.`,
      });
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error('Sync failed', {
        description: errorMessage,
      });
      // Also update status to show error state
      try {
        setSyncStatus(await supabaseSync.getStatus());
      } catch {} // ignore if status fetch fails
    }
    finally { setSyncing(false); }
  }

  const handleLogout = () => {
    clearToken();
    window.location.href = '/login';
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-gray-900 text-gray-100 transition-all duration-200',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-400" />
            <span className="font-semibold text-lg">Time Tracker</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded hover:bg-gray-700 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {(user?.role === 'admin' || user?.role === 'partner') && (
          <>
            {!collapsed && (
              <div className="px-5 pt-6 pb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Admin</span>
              </div>
            )}
            <ul className="space-y-1 px-2">
              {adminItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>

      {/* Sync status */}
      {syncStatus?.enabled && syncStatus.state !== 'disabled' && (
        <div className="border-t border-gray-700 px-3 py-2">
          <div className="flex items-center gap-2">
            <SidebarSyncIndicator state={syncing ? 'syncing' : syncStatus.state} />
            {!collapsed && (
              <span className="text-xs text-gray-400 truncate flex-1">
                {syncing 
                  ? 'Syncing...' 
                  : syncStatus.state === 'idle' 
                    ? `Synced${syncStatus.pendingCount > 0 ? ` (${syncStatus.pendingCount})` : ''}` 
                    : syncStatus.state === 'error' 
                      ? 'Sync error' 
                      : syncStatus.state === 'offline' 
                        ? 'Offline' 
                        : 'Syncing...'}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="p-1 rounded hover:bg-gray-700 transition-colors"
              title="Sync now"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 text-gray-400', syncing && 'animate-spin')} />
            </button>
          </div>
        </div>
      )}

      {/* Theme toggle */}
      <div className={cn('border-t border-gray-700 px-3 py-2', collapsed && 'flex justify-center')}>
        <ThemeToggle collapsed={collapsed} />
      </div>

      {/* User section */}
      <div className="border-t border-gray-700 p-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-medium shrink-0">
            {user?.displayName?.charAt(0) || '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.displayName || 'User'}</p>
              <p className="text-xs text-gray-400 truncate">{user?.role || 'basic'}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="p-1 rounded hover:bg-gray-700 transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarSyncIndicator({ state }: { state: string }) {
  switch (state) {
    case 'idle':
      return <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />;
    case 'syncing':
      return <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />;
    case 'offline':
    case 'error':
      return <Ban className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    default:
      return null;
  }
}
