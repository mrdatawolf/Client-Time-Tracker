'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/api';
import { signOut, getUser } from '@/lib/api-client';

export default function PendingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const user = typeof window !== 'undefined' ? getUser() : null;

  async function checkStatus() {
    setChecking(true);
    try {
      const refreshed = await auth.me();
      if (refreshed?.status === 'active') {
        router.replace('/');
        return;
      }
    } catch {
      // stay on this page
    } finally {
      setChecking(false);
    }
  }

  // Poll every 15s so approval kicks in without a manual refresh
  useEffect(() => {
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-amber-500 p-3 rounded-full">
              <Hourglass className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Waiting for approval
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Your account{user?.email ? ` (${user.email})` : ''} has been created, but a team
            admin needs to approve it before you can use the app. This page will update
            automatically once you&apos;re approved.
          </p>
          <div className="space-y-2">
            <Button onClick={checkStatus} disabled={checking} className="w-full">
              {checking ? 'Checking...' : 'Check again'}
            </Button>
            <Button onClick={handleSignOut} variant="outline" className="w-full">
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
