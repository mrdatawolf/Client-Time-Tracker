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

  // Loading state while checking setup status
  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm">
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
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {needsSetup ? 'Create your admin account to get started' : 'Sign in to your account'}
            </p>
          </div>

          {needsSetup ? (
            <form onSubmit={handleSetup} className="space-y-4">
              <div>
                <Label htmlFor="setup-username">Username</Label>
                <Input
                  id="setup-username"
                  type="text"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
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
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
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
