'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Wifi, WifiOff, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabaseSync, type SupabaseConfig, type SyncStatus } from '@/lib/api';

export default function SupabaseTab() {
  const [config, setConfig] = useState<SupabaseConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state (editable fields)
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceKey, setServiceKey] = useState('');

  // Action states
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [settingUpSchema, setSettingUpSchema] = useState(false);
  const [schemaResult, setSchemaResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Export/Import
  const [exporting, setExporting] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [importString, setImportString] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);

  // Initial sync dialog
  const [initialSyncOpen, setInitialSyncOpen] = useState(false);
  const [initialSyncDirection, setInitialSyncDirection] = useState<'push' | 'pull' | 'merge'>('push');
  const [initialSyncing, setInitialSyncing] = useState(false);
  const [initialSyncResult, setInitialSyncResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, statusData] = await Promise.all([
        supabaseSync.getConfig(),
        supabaseSync.getStatus(),
      ]);
      setConfig(configData);
      setStatus(statusData);
      setSupabaseUrl(configData.supabaseUrl || '');
      setDatabaseUrl(configData.databaseUrl || '');
      setAnonKey(configData.supabaseAnonKey || '');
      setServiceKey(configData.supabaseServiceKey || '');
    } catch (err) {
      console.error('Failed to load Supabase config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll status every 10 seconds when enabled
  useEffect(() => {
    if (!config?.enabled) return;
    const interval = setInterval(async () => {
      try {
        setStatus(await supabaseSync.getStatus());
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [config?.enabled]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await supabaseSync.updateConfig({
        supabaseUrl,
        databaseUrl,
        supabaseAnonKey: anonKey,
        supabaseServiceKey: serviceKey,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      await loadData();
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await supabaseSync.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSetupSchema() {
    setSettingUpSchema(true);
    setSchemaResult(null);
    try {
      const result = await supabaseSync.setupSchema();
      setSchemaResult(result);
    } catch (err) {
      setSchemaResult({ success: false, message: err instanceof Error ? err.message : 'Schema setup failed' });
    } finally {
      setSettingUpSchema(false);
    }
  }

  async function handleToggleEnabled() {
    try {
      await supabaseSync.updateConfig({ enabled: !config?.enabled });
      await loadData();
    } catch (err) {
      console.error('Failed to toggle sync:', err);
    }
  }

  async function handleManualSync() {
    setSyncing(true);
    try {
      await supabaseSync.sync();
      await loadData();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleInitialSync() {
    setInitialSyncing(true);
    setInitialSyncResult(null);
    try {
      const result = await supabaseSync.initialSync(initialSyncDirection);
      setInitialSyncResult(result.message);
      await loadData();
    } catch (err) {
      setInitialSyncResult(err instanceof Error ? err.message : 'Initial sync failed');
    } finally {
      setInitialSyncing(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportCopied(false);
    try {
      const { exportString } = await supabaseSync.exportConfig();
      await navigator.clipboard.writeText(exportString);
      setExportCopied(true);
      setTimeout(() => setExportCopied(false), 3000);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    if (!importString.trim()) return;
    setImporting(true);
    setImportError('');
    setImportSuccess(false);
    try {
      const result = await supabaseSync.importConfig(importString.trim());
      setSupabaseUrl(result.supabaseUrl || '');
      setDatabaseUrl(result.databaseUrl || '');
      setAnonKey(result.supabaseAnonKey || '');
      setServiceKey(result.supabaseServiceKey || '');
      setImportString('');
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Connection Settings */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Supabase Connection</h2>
        <p className="text-sm text-gray-500 mb-4">
          Connect to a remote Supabase PostgreSQL database for team collaboration and cloud backup.
        </p>

        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Supabase Project URL <span className="text-red-500">*</span></label>
            <Input
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://your-project.supabase.co"
            />
            <p className="text-xs text-gray-500">
              Your project URL from the Supabase dashboard.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Database URL (PostgreSQL connection string) <span className="text-red-500">*</span></label>
            <Input
              type="password"
              value={databaseUrl}
              onChange={(e) => setDatabaseUrl(e.target.value)}
              placeholder="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
            />
            <ConnectionHint supabaseUrl={supabaseUrl} />
          </div>

          <details className="pt-2">
            <summary className="text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900">
              Optional: API Keys (not required for sync)
            </summary>
            <div className="space-y-4 mt-3 pl-2 border-l-2 border-gray-100">
              <div className="space-y-1">
                <label className="text-sm font-medium">Anon / Publishable Key</label>
                <Input
                  type="password"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJ... or sb_publishable_..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Service Role / Secret Key</label>
                <Input
                  type="password"
                  value={serviceKey}
                  onChange={(e) => setServiceKey(e.target.value)}
                  placeholder="eyJ... or sb_secret_..."
                />
                <p className="text-xs text-gray-500">
                  Found in Supabase Dashboard &gt; Settings &gt; API Keys. Stored for potential future features; not used by the sync engine.
                </p>
              </div>
            </div>
          </details>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving || !databaseUrl}>
              {saving ? 'Saving...' : 'Save Connection'}
            </Button>
            {saved && <span className="text-sm text-green-600">Saved</span>}
          </div>

          {/* Export / Import */}
          <div className="pt-4 border-t border-gray-100 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || !config?.databaseUrl}
              >
                {exporting ? 'Exporting...' : exportCopied ? 'Copied!' : 'Export Config'}
              </Button>
              <span className="text-xs text-gray-500">
                Copy an encrypted config string to share with another installation
              </span>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Import Config</label>
              <div className="flex gap-2">
                <Input
                  value={importString}
                  onChange={(e) => { setImportString(e.target.value); setImportError(''); }}
                  placeholder="Paste CTT:... string here"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImport}
                  disabled={importing || !importString.trim()}
                >
                  {importing ? 'Importing...' : 'Import'}
                </Button>
              </div>
              {importError && <p className="text-xs text-red-600">{importError}</p>}
              {importSuccess && <p className="text-xs text-green-600">Imported! Review the fields above, then click Save Connection.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Setup & Actions</h2>

        <div className="space-y-4">
          {/* Test Connection */}
          <div className="flex items-start gap-3">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !config?.databaseUrl}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </Button>
            {testResult && (
              <div className={`flex items-center gap-1.5 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </div>
            )}
          </div>

          {/* Setup Schema */}
          <div className="flex items-start gap-3">
            <Button
              variant="outline"
              onClick={handleSetupSchema}
              disabled={settingUpSchema || !config?.databaseUrl}
            >
              <Database className="w-4 h-4 mr-1" />
              {settingUpSchema ? 'Setting up...' : 'Setup Schema on Supabase'}
            </Button>
            {schemaResult && (
              <div className={`flex items-center gap-1.5 text-sm ${schemaResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {schemaResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {schemaResult.message}
              </div>
            )}
          </div>

          {/* Enable / Disable */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <Button
              variant={config?.enabled ? 'destructive' : 'default'}
              onClick={handleToggleEnabled}
              disabled={!config?.databaseUrl}
            >
              {config?.enabled ? 'Disable Sync' : 'Enable Sync'}
            </Button>
            <span className="text-sm text-gray-500">
              {config?.enabled ? 'Sync is active' : 'Sync is currently disabled'}
            </span>
          </div>

          {/* Initial Sync */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={() => setInitialSyncOpen(true)}
              disabled={!config?.databaseUrl}
            >
              Initial Sync
            </Button>
            <span className="text-xs text-gray-500">
              Run a one-time full sync when connecting for the first time
            </span>
          </div>
        </div>
      </div>

      {/* Sync Status */}
      {config?.enabled && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Sync Status</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualSync}
              disabled={syncing}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">State</div>
              <div className="flex items-center gap-1.5">
                <SyncStateIndicator state={status?.state || 'disabled'} />
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Pending Changes</div>
              <div className="text-sm font-medium">
                {status?.pendingCount ?? 0}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Last Sync</div>
              <div className="text-sm text-gray-700">
                {status?.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleString()
                  : 'Never'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Instance ID</div>
              <div className="text-xs text-gray-500 font-mono truncate" title={status?.instanceId}>
                {status?.instanceId?.slice(0, 8) || '-'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Initial Sync Dialog */}
      <Dialog open={initialSyncOpen} onOpenChange={setInitialSyncOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initial Sync</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Choose how to handle the first-time sync between your local database and Supabase.
            </p>
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="direction"
                  value="push"
                  checked={initialSyncDirection === 'push'}
                  onChange={() => setInitialSyncDirection('push')}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">Push Local to Remote</div>
                  <div className="text-xs text-gray-500">Upload all your local data to the empty Supabase database</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="direction"
                  value="pull"
                  checked={initialSyncDirection === 'pull'}
                  onChange={() => setInitialSyncDirection('pull')}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">Pull Remote to Local</div>
                  <div className="text-xs text-gray-500">Download all data from Supabase into your local database (new team member)</div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="direction"
                  value="merge"
                  checked={initialSyncDirection === 'merge'}
                  onChange={() => setInitialSyncDirection('merge')}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium text-sm">Merge Both</div>
                  <div className="text-xs text-gray-500">Merge local and remote data using timestamps (most recent wins)</div>
                </div>
              </label>
            </div>

            {initialSyncResult && (
              <div className="p-3 rounded-lg bg-blue-50 text-sm text-blue-800">
                {initialSyncResult}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInitialSyncOpen(false)} disabled={initialSyncing}>
              {initialSyncResult ? 'Close' : 'Cancel'}
            </Button>
            {!initialSyncResult && (
              <Button onClick={handleInitialSync} disabled={initialSyncing}>
                {initialSyncing ? 'Syncing...' : 'Start Sync'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Extracts the project ref from a Supabase URL like https://xxxx.supabase.co */
function extractProjectRef(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function ConnectionHint({ supabaseUrl }: { supabaseUrl: string }) {
  const ref = extractProjectRef(supabaseUrl);

  if (ref) {
    const connectUrl = `https://supabase.com/dashboard/project/${ref}/integrations/data_api/overview?showConnect=true&method=session`;
    return (
      <p className="text-xs text-gray-500">
        Use the <strong>Session pooler</strong> connection string (not Direct).{' '}
        <a
          href={connectUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Open connection settings for your project
        </a>
      </p>
    );
  }

  return (
    <p className="text-xs text-gray-500">
      Enter your Supabase Project URL above to get a direct link to your connection settings.
      Use the <strong>Session pooler</strong> connection string (not Direct).
    </p>
  );
}

function SyncStateIndicator({ state }: { state: string }) {
  switch (state) {
    case 'idle':
      return (
        <span className="flex items-center gap-1.5 text-sm text-green-600">
          <Wifi className="w-4 h-4" /> Connected
        </span>
      );
    case 'syncing':
      return (
        <span className="flex items-center gap-1.5 text-sm text-blue-600">
          <RefreshCw className="w-4 h-4 animate-spin" /> Syncing...
        </span>
      );
    case 'offline':
      return (
        <span className="flex items-center gap-1.5 text-sm text-orange-600">
          <WifiOff className="w-4 h-4" /> Offline
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" /> Error
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1.5 text-sm text-gray-500">
          Disabled
        </span>
      );
  }
}
