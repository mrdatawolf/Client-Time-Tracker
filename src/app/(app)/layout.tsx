'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Toaster } from 'sonner';
import { refreshCurrentUser, getUser } from '@/lib/api-client';
import { isConfigured } from '@/lib/supabase';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      if (!isConfigured()) {
        router.replace('/connect');
        return;
      }
      // Cached user renders immediately; the session refresh below corrects it
      if (getUser()) setReady(true);

      try {
        const user = await refreshCurrentUser();
        if (cancelled) return;
        if (!user) {
          router.replace('/login');
        } else if (user.status !== 'active') {
          router.replace('/pending');
        } else {
          setReady(true);
        }
      } catch {
        if (!cancelled && !getUser()) router.replace('/login');
      }
    }

    checkSession();
    return () => { cancelled = true; };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Toaster position="top-right" richColors />
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 p-3 md:p-6 pt-14 md:pt-6">
        {children}
      </main>
    </div>
  );
}
