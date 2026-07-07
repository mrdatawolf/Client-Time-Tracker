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
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { signOut, getUser } from '@/lib/api-client';
import { BASE_PATH } from '@/lib/supabase';
import { ThemeToggle } from './ThemeToggle';

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = getUser();

  // Close mobile drawer on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await signOut();
    window.location.href = `${BASE_PATH}/login`;
  };

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Clock className="w-6 h-6 text-blue-400" />
            <span className="font-semibold text-lg">Time Tracker</span>
          </div>
        )}
        {/* Desktop: collapse toggle. Mobile: close button */}
        <button
          onClick={() => {
            if (mobileOpen) setMobileOpen(false);
            else setCollapsed(!collapsed);
          }}
          className="p-1 rounded hover:bg-gray-700 transition-colors"
        >
          {mobileOpen ? (
            <X className="w-5 h-5" />
          ) : collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <ChevronLeft className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
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
                  title={collapsed && !mobileOpen ? item.label : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {(!collapsed || mobileOpen) && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        {(user?.role === 'admin' || user?.role === 'partner') && (
          <>
            {(!collapsed || mobileOpen) && (
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
                      title={collapsed && !mobileOpen ? item.label : undefined}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      {(!collapsed || mobileOpen) && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </nav>

      {/* Theme toggle */}
      <div className={cn('border-t border-gray-700 px-3 py-2', collapsed && !mobileOpen && 'flex justify-center')}>
        <ThemeToggle collapsed={collapsed && !mobileOpen} />
      </div>

      {/* User section */}
      <div className="border-t border-gray-700 p-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-medium shrink-0">
            {user?.displayName?.charAt(0) || '?'}
          </div>
          {(!collapsed || mobileOpen) && (
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
    </>
  );

  return (
    <>
      {/* Mobile hamburger button - fixed at top left */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-gray-900 text-gray-100 shadow-lg"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          'md:hidden fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-gray-900 text-gray-100 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen bg-gray-900 text-gray-100 transition-all duration-200',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
