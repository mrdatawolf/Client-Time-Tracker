'use client';

import { useState } from 'react';
import { Cloud, Copy, Check, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStoredConfig, encodeConfig, clearConfig, REQUIRED_SCHEMA_VERSION } from '@/lib/supabase';
import { signOut } from '@/lib/api-client';

/**
 * Connection tab: shows the org's Supabase connection and produces the
 * shareable CTTW connection code teammates paste on the /connect screen.
 */
export default function CloudTab() {
  const config = getStoredConfig();
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const code = config ? encodeConfig(config) : '';

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDisconnect() {
    await signOut();
    clearConfig();
    window.location.href = '/connect';
  }

  if (!config) {
    return <p className="text-sm text-gray-500">Not connected.</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Cloud className="w-4 h-4 text-blue-500" />
          Workspace Connection
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Project URL</dt>
            <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">{config.url}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Key</dt>
            <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">
              {config.anonKey.slice(0, 24)}…
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Schema version</dt>
            <dd className="text-gray-900 dark:text-gray-100">v{REQUIRED_SCHEMA_VERSION}</dd>
          </div>
        </dl>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Invite your team
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Share this connection code. Teammates open the app, paste it on the connect
          screen, and create their own account — you approve them here under Users.
        </p>
        <div className="flex gap-2">
          <textarea
            readOnly
            value={code}
            rows={3}
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-xs font-mono"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="outline" onClick={handleCopy} className="shrink-0 self-start">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          This code contains only the project URL and the public (anon) key — data access
          is controlled by each user&apos;s account and role.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-900 shadow-sm p-6">
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1 flex items-center gap-2">
          <Unplug className="w-4 h-4" />
          Disconnect
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Signs you out and removes the workspace connection from this browser. No data
          is deleted — reconnect anytime with the connection code.
        </p>
        {confirmDisconnect ? (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleDisconnect}>
              Yes, disconnect
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
            Disconnect this browser
          </Button>
        )}
      </div>
    </div>
  );
}
