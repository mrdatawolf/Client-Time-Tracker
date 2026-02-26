'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, setToken, setUser } from '@/lib/api-client';
import type { LoginResponse } from '@ctt/shared/types';

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Setup form state
  const [setupUsername, setSetupUsername] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importLoading, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    apiClient<{ needsSetup: boolean }>('/api/auth/setup-status')
      .then((data) => setNeedsSetup(data.needsSetup))
      .catch(() => setNeedsSetup(false)); // If check fails, show login form
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiClient<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      setToken(data.token);
      setUser(data.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiClient<LoginResponse>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({
          username: setupUsername,
          displayName: setupDisplayName,
          password: setupPassword,
        }),
      });

      setToken(data.token);
      setUser(data.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setImportStatus('Importing configuration...');

    try {
      // 1. Import config
      const config = await apiClient<any>('/api/supabase/config/import', {
        method: 'POST',
        body: JSON.stringify({ exportString: importCode }),
      });

      // 2. Save config
      await apiClient('/api/supabase/config', {
        method: 'PUT',
        body: JSON.stringify({ ...config, enabled: true }),
      });

      // 3. Setup Schema (important for fresh install)
      setImportStatus('Verifying schema...');
      await apiClient('/api/supabase/setup-schema', { method: 'POST' });

      // 4. Initial Sync (Pull)
      setImportStatus('Pulling data from cloud...');
      await apiClient('/api/supabase/initial-sync', {
        method: 'POST',
        body: JSON.stringify({ direction: 'pull' }),
      });

      setImportStatus(null);
      // Re-check setup status - hopefully users are pulled in now
      const status = await apiClient<{ needsSetup: boolean }>('/api/auth/setup-status');
      setNeedsSetup(status.needsSetup);
      setShowImport(false);
      
      if (!status.needsSetup) {
        setError('Import complete! You can now sign in with your team account.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setImportStatus(null);
    }
  };

  // Loading state while checking setup status
  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      {isDemo && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-amber-950 text-center text-xs font-semibold py-1">
          DEMO MODE — data resets on restart (login: demo / demo)
        </div>
      )}
      <div className="w-full max-w-sm px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className={`${needsSetup ? 'bg-green-600' : 'bg-blue-600'} p-3 rounded-full mb-4`}>
              {needsSetup ? (
                <UserPlus className="w-8 h-8 text-white" />
              ) : (
                <Clock className="w-8 h-8 text-white" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Time Tracker</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 text-center">
              {needsSetup 
                ? (showImport ? 'Import team settings to join' : 'Create your admin account to get started') 
                : 'Sign in to your account'}
            </p>
          </div>

          {needsSetup ? (
            showImport ? (
              <form onSubmit={handleImport} className="space-y-4">
                <div>
                  <Label htmlFor="import-code">Team Config Code</Label>
                  <textarea
                    id="import-code"
                    value={importCode}
                    onChange={(e) => setImportCode(e.target.value)}
                    placeholder="CTT:..."
                    required
                    className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                  />
                </div>

                {error && (
                  <div className={`text-sm ${error.includes('complete') ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200'} border rounded-md p-3`}>
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={!!importLoading}>
                  {importLoading || 'Import & Sync'}
                </Button>

                <button
                  type="button"
                  onClick={() => { setShowImport(false); setError(''); }}
                  className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-2"
                >
                  Back to fresh setup
                </button>
              </form>
            ) : (
              <>
                <form onSubmit={handleSetup} className="space-y-4">
                  <div>
                    <Label htmlFor="setup-username">Username</Label>
                    <Input
                      id="setup-username"
                      type="text"
                      value={setupUsername}
                      onChange={(e) => setSetupUsername(e.target.value.toLowerCase())}
                      placeholder="Choose a username"
                      required
                      autoFocus
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="setup-displayname">Display Name</Label>
                    <Input
                      id="setup-displayname"
                      type="text"
                      value={setupDisplayName}
                      onChange={(e) => setSetupDisplayName(e.target.value)}
                      placeholder="Your full name"
                      required
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="setup-password">Password</Label>
                    <Input
                      id="setup-password"
                      type="password"
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="Choose a password"
                      required
                      minLength={4}
                      className="mt-1"
                    />
                  </div>

                  {error && (
                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Creating account...' : 'Create Account'}
                  </Button>
                </form>

                <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-center text-sm text-gray-500 mb-3">Joining an existing team?</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setShowImport(true); setError(''); }}
                  >
                    Import Team Config
                  </Button>
                </div>
              </>
            )
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="Enter your username"
                  required
                  autoFocus
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="mt-1"
                />
              </div>

              {error && (
                <div className={`text-sm ${error.includes('complete') ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200'} border rounded-md p-3`}>
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
