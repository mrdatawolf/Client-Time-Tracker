'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Wifi, Ban, Database, History, Info, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { supabaseSync, type SupabaseConfig, type SyncStatus, type SyncChangelogEntry, type SyncConflict } from '@/lib/api';

export default function SupabaseTab() {
  const [config, setConfig] = useState<SupabaseConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [changelog, setChangelog] = useState<SyncChangelogEntry[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
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
  const [resolving, setResolving] = useState<number | null>(null);

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

      if (configData.enabled) {
        const [logs, conflictData] = await Promise.all([
          supabaseSync.getChangelog(),
          supabaseSync.getConflicts()
        ]);
        setChangelog(logs);
        setConflicts(conflictData);
      }
    } catch (err) {
      console.error('Failed to load Supabase config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll status and changelog every 10 seconds when enabled
  useEffect(() => {
    if (!config?.enabled) return;
    const interval = setInterval(async () => {
      try {
        const [newStatus, logs, conflictData] = await Promise.all([
          supabaseSync.getStatus(),
          supabaseSync.getChangelog(),
          supabaseSync.getConflicts()
        ]);
        setStatus(newStatus);
        setChangelog(logs);
        setConflicts(conflictData);
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
      const [logs, conflictData] = await Promise.all([
        supabaseSync.getChangelog(),
        supabaseSync.getConflicts()
      ]);
      setChangelog(logs);
      setConflicts(conflictData);
      setStatus(await supabaseSync.getStatus());
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleResolveConflict(changelogId: number, strategy: 'keep-local' | 'use-remote' | 'discard') {
    setResolving(changelogId);
    try {
      await supabaseSync.resolveConflict(changelogId, strategy);
      // Refresh data
      const [logs, conflictData] = await Promise.all([
        supabaseSync.getChangelog(),
        supabaseSync.getConflicts()
      ]);
      setChangelog(logs);
      setConflicts(conflictData);
    } catch (err) {
      console.error('Resolution failed:', err);
    } finally {
      setResolving(null);
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
    <div className="space-y-6 max-w-4xl text-gray-900 dark:text-gray-100">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Connection Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Supabase Connection</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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

              <div className="flex items-center gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving || !databaseUrl}>
                  {saving ? 'Saving...' : 'Save Connection'}
                </Button>
                {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !config?.databaseUrl}>
                    {exporting ? 'Exporting...' : exportCopied ? 'Copied!' : 'Export Config'}
                  </Button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Copy encrypted config string</span>
                </div>
                <div className="flex gap-2">
                  <Input value={importString} onChange={(e) => { setImportString(e.target.value); setImportError(''); }} placeholder="Paste CTT:... string here" className="flex-1 h-9" />
                  <Button variant="outline" size="sm" onClick={handleImport} disabled={importing || !importString.trim()}>
                    {importing ? 'Importing...' : 'Import'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Sync Audit / Conflict Resolution */}
          {config?.enabled && conflicts.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-900/50 shadow-sm overflow-hidden">
              <div className="bg-amber-50 dark:bg-amber-900/20 px-6 py-4 border-b border-amber-100 dark:border-amber-900/30 flex items-center gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-500" />
                <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">Sync Conflicts ({conflicts.length})</h2>
              </div>
              <div className="p-6 space-y-8">
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Multiple records are fighting for the same spot (e.g. same username but different IDs). 
                  Please choose which version is correct for each conflict below.
                </p>

                {conflicts.map((conflict) => (
                  <div key={conflict.changelogId} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                      <span className="text-sm font-bold uppercase tracking-wider text-gray-500">{conflict.tableName}</span>
                      <span className="text-[10px] font-mono text-gray-400">ID: {conflict.recordId}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-gray-700">
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-400 uppercase">Local Version</h4>
                          {!conflict.local && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded">Deleted</span>}
                        </div>
                        {conflict.local ? (
                          <pre className="text-[10px] bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-32 overflow-auto font-mono">
                            {JSON.stringify(conflict.local, null, 2)}
                          </pre>
                        ) : (
                          <div className="h-20 flex items-center justify-center text-xs text-gray-400 italic border-2 border-dashed border-gray-100 dark:border-gray-800 rounded">
                            No local data
                          </div>
                        )}
                        <Button 
                          size="sm" 
                          className="w-full h-8 text-xs" 
                          onClick={() => handleResolveConflict(conflict.changelogId, 'keep-local')}
                          disabled={resolving === conflict.changelogId || !conflict.local}
                        >
                          Keep Local & Update Cloud
                        </Button>
                      </div>

                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-gray-400 uppercase">Remote (Supabase)</h4>
                          {!conflict.remote && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded">Deleted</span>}
                        </div>
                        {conflict.remote ? (
                          <pre className="text-[10px] bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded max-h-32 overflow-auto font-mono text-blue-900 dark:text-blue-300">
                            {JSON.stringify(conflict.remote, null, 2)}
                          </pre>
                        ) : (
                          <div className="h-20 flex items-center justify-center text-xs text-gray-400 italic border-2 border-dashed border-gray-100 dark:border-gray-800 rounded">
                            No remote data
                          </div>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full h-8 text-xs border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30" 
                          onClick={() => handleResolveConflict(conflict.changelogId, 'use-remote')}
                          disabled={resolving === conflict.changelogId || !conflict.remote}
                        >
                          Use Remote & Update Local
                        </Button>
                      </div>
                    </div>
                    
                    <div className="p-3 bg-red-50/50 dark:bg-red-900/10 border-t border-gray-200 dark:border-gray-700 text-[11px] text-red-700 dark:text-red-400">
                      <span className="font-bold mr-2">BLOCKING ERROR:</span> {conflict.errorMessage}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Sync Status Sidebar */}
          {config?.enabled && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Sync Status</h2>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleManualSync} disabled={syncing}>
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">State</div>
                  <SyncStateIndicator state={status?.state || 'disabled'} />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Pending</div>
                  <div className="text-xl font-bold">{status?.pendingCount ?? 0}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Last Sync</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">{status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString() : 'Never'}</div>
                </div>
              </div>
            </div>
          )}

          {/* Setup Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">Maintenance</h2>
            <div className="space-y-3">
              <div>
                <Button variant="outline" size="sm" className="w-full justify-start h-9" onClick={handleTestConnection} disabled={testing || !config?.databaseUrl}>
                  <Wifi className="w-4 h-4 mr-2" /> {testing ? 'Testing...' : 'Test Connection'}
                </Button>
                {testResult && (
                  <div className={`mt-2 flex items-start gap-1.5 text-[11px] ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {testResult.success ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    <span className="break-words">{testResult.message}</span>
                  </div>
                )}
              </div>

              <div>
                <Button variant="outline" size="sm" className="w-full justify-start h-9" onClick={handleSetupSchema} disabled={settingUpSchema || !config?.databaseUrl}>
                  <Database className="w-4 h-4 mr-2" /> {settingUpSchema ? 'Setting up...' : 'Verify Schema'}
                </Button>
                {schemaResult && (
                  <div className={`mt-2 flex items-start gap-1.5 text-[11px] ${schemaResult.success ? 'text-green-600' : 'text-red-600'}`}>
                    {schemaResult.success ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    <span className="break-words">{schemaResult.message}</span>
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" className="w-full justify-start h-9 text-amber-600" onClick={() => setInitialSyncOpen(true)} disabled={!config?.databaseUrl}>
                <History className="w-4 h-4 mr-2" /> Initial Sync
              </Button>
              <div className="pt-2">
                <Button variant={config?.enabled ? 'destructive' : 'default'} size="sm" className="w-full h-9" onClick={handleToggleEnabled} disabled={!config?.databaseUrl}>
                  {config?.enabled ? 'Disable Sync' : 'Enable Sync'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Sync Issues List (Old Log) */}
      {config?.enabled && changelog.some(e => e.error_message) && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <SyncLog changelog={changelog} />
        </div>
      )}

      {/* Initial Sync Dialog */}
      <Dialog open={initialSyncOpen} onOpenChange={setInitialSyncOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initial Sync</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Choose how to handle the first-time sync between your local database and Supabase.
            </p>
            <div className="space-y-2">
              {[
                { id: 'push', label: 'Push Local to Remote', desc: 'Upload all local data to the cloud' },
                { id: 'pull', label: 'Pull Remote to Local', desc: 'Download all team data from the cloud' },
                { id: 'merge', label: 'Merge Both', desc: 'Merge both databases (most recent wins)' }
              ].map((d) => (
                <label key={d.id} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <input type="radio" name="direction" value={d.id} checked={initialSyncDirection === d.id} onChange={() => setInitialSyncDirection(d.id as any)} className="mt-0.5" />
                  <div>
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{d.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{d.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            {initialSyncResult && <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">{initialSyncResult}</div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInitialSyncOpen(false)} disabled={initialSyncing}>{initialSyncResult ? 'Close' : 'Cancel'}</Button>
            {!initialSyncResult && <Button onClick={handleInitialSync} disabled={initialSyncing}>{initialSyncing ? 'Syncing...' : 'Start Sync'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncStateIndicator({ state }: { state: string }) {
  switch (state) {
    case 'idle': return <span className="flex items-center gap-1.5 text-sm text-green-600"><Wifi className="w-4 h-4" /> Connected</span>;
    case 'syncing': return <span className="flex items-center gap-1.5 text-sm text-blue-600"><RefreshCw className="w-4 h-4 animate-spin" /> Syncing...</span>;
    case 'offline': return <span className="flex items-center gap-1.5 text-sm text-red-600"><Ban className="w-4 h-4" /> Offline</span>;
    case 'error': return <span className="flex items-center gap-1.5 text-sm text-red-600"><Ban className="w-4 h-4" /> Error</span>;
    default: return <span className="flex items-center gap-1.5 text-sm text-gray-500">Disabled</span>;
  }
}

function ConnectionHint({ supabaseUrl }: { supabaseUrl: string }) {
  const parsed = (url: string) => { try { return new URL(url).hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1]; } catch { return null; }};
  const ref = parsed(supabaseUrl);
  return (
    <p className="text-xs text-gray-500 mt-1">
      Use the <strong>Session pooler</strong> connection string.{' '}
      {ref && <a href={`https://supabase.com/dashboard/project/${ref}/integrations/data_api/overview?showConnect=true&method=session`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Settings</a>}
    </p>
  );
}

function SyncLog({ changelog }: { changelog: SyncChangelogEntry[] }) {
  const errors = changelog.filter(e => e.error_message);
  if (errors.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Recent Sync Errors</h3>
      <div className="space-y-2 max-h-48 overflow-auto pr-2">
        {errors.map((e) => (
          <div key={e.id} className="p-2 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded text-[11px]">
            <div className="font-bold text-red-800 dark:text-red-400">{e.table_name}: {e.operation}</div>
            <div className="text-red-700 dark:text-red-300 line-clamp-2">{e.error_message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
