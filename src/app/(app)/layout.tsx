'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { SyncOverlay } from '@/components/SyncOverlay';
import { Toaster, toast } from 'sonner';
import { isAuthenticated } from '@/lib/api-client';
import { supabaseSync } from '@/lib/api';

const SYNC_TIMEOUT = 15_000; // 15s max wait for sync

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Syncing...');
  const closingRef = useRef(false);

  // Run sync on app open (after auth check)
  const initSync = useCallback(async () => {
    try {
      const status = await supabaseSync.getStatus();
      if (!status.enabled || status.state === 'disabled') {
        return; // Sync not configured, skip
      }

      setSyncing(true);
      setSyncMessage('Syncing...');

      // Race sync against timeout
      await Promise.race([
        supabaseSync.sync().catch((err) => {
          const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
          toast.error('Sync failed', {
            description: errorMessage,
          });
        }),
        new Promise((resolve) => setTimeout(resolve, SYNC_TIMEOUT)),
      ]);
    } catch {
      // Status fetch failed (e.g. not admin) — skip silently
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    } else {
      setReady(true);
      initSync();
    }
  }, [router, initSync]);

  // Electron close-sync: listen for close-requested IPC
  useEffect(() => {
    const electronAPI = (window as unknown as Record<string, unknown>).electronAPI as {
      onCloseRequested?: (callback: () => void) => void;
      closeReady?: () => void;
    } | undefined;

    if (!electronAPI?.onCloseRequested || !electronAPI?.closeReady) return;

    electronAPI.onCloseRequested(async () => {
      if (closingRef.current) return;
      closingRef.current = true;

      setSyncMessage('Syncing before close...');
      setSyncing(true);

      try {
        const status = await supabaseSync.getStatus();
        if (status.enabled && status.state !== 'disabled') {
          await Promise.race([
            supabaseSync.sync().catch((err) => {
              // Don't show toast on close, just log for debugging
              console.error('Sync on close failed:', err);
            }),
            new Promise((resolve) => setTimeout(resolve, SYNC_TIMEOUT)),
          ]);
        }
      } catch {
        // Skip on error
      }

      electronAPI.closeReady!();
    });
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  return (
    <div className="flex h-screen overflow-hidden">
      <Toaster position="top-right" richColors />
      <SyncOverlay visible={syncing} message={syncMessage} />
      {isDemo && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 text-center text-xs font-semibold py-1">
          DEMO MODE — data resets on restart (login: demo / demo)
        </div>
      )}
      <Sidebar />
      <main className={`flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-6 ${isDemo ? 'pt-12' : ''}`}>
        {children}
      </main>
    </div>
  );
}
