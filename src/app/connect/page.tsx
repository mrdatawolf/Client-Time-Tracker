'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { decodeConfig, storeConfig, checkSchemaVersion, type ConnectionConfig } from '@/lib/supabase';

export default function ConnectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'code' | 'manual'>('code');
  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function connect(config: ConnectionConfig) {
    setStatus('Checking connection...');
    const check = await checkSchemaVersion(config);
    if (!check.ok) {
      setError(check.message);
      setStatus(null);
      return;
    }
    storeConfig(config);
    router.push('/login');
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const config = mode === 'code'
        ? decodeConfig(code)
        : { url: url.trim().replace(/\/+$/, ''), anonKey: anonKey.trim() };
      if (!config.url || !config.anonKey) {
        setError('Both the project URL and the publishable key are required');
        return;
      }
      await connect(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid connection details');
      setStatus(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-600 p-3 rounded-full mb-4">
              <Cloud className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Time Tracker</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 text-center">
              Connect to your team&apos;s workspace
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'code' ? (
              <div>
                <Label htmlFor="connect-code">Team Connection Code</Label>
                <textarea
                  id="connect-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CTTW:..."
                  required
                  autoFocus
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Get this code from your team admin.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="sb-url">Supabase Project URL</Label>
                  <Input
                    id="sb-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://xxxx.supabase.co"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="sb-key">Publishable (anon) Key</Label>
                  <Input
                    id="sb-key"
                    type="text"
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    placeholder="sb_publishable_..."
                    required
                    className="mt-1 font-mono"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={!!status}>
              {status || 'Connect'}
            </Button>

            <button
              type="button"
              onClick={() => { setMode(mode === 'code' ? 'manual' : 'code'); setError(''); }}
              className="w-full text-center text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              {mode === 'code' ? 'Enter project URL and key manually' : 'Use a team connection code instead'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
