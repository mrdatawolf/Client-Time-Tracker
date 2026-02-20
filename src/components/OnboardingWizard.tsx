'use client';

import { useState } from 'react';
import { Check, Plus, X, Sparkles, ChevronRight, ChevronLeft, Cloud, Monitor, Loader2, CheckCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  clients as clientsApi,
  jobTypes as jobTypesApi,
  settings as settingsApi,
  supabaseSync,
} from '@/lib/api';

const COMMON_JOB_TYPES = ['Consulting', 'Hardware', 'Programming', 'Network'];

type StepId = 'choose-path' | 'import-sync' | 'job-types' | 'client' | 'settings';

interface StepDef {
  id: StepId;
  title: string;
  description: string;
}

interface OnboardingWizardProps {
  needsJobTypes: boolean;
  needsClient: boolean;
  needsSettings: boolean;
  currentSettings: Record<string, string>;
  onComplete: () => void;
}

type ImportPhase = 'input' | 'importing' | 'testing' | 'schema' | 'syncing' | 'enabling' | 'done' | 'error';

export default function OnboardingWizard({
  needsJobTypes,
  needsClient,
  needsSettings,
  currentSettings,
  onComplete,
}: OnboardingWizardProps) {
  // Track whether user chose import or fresh setup
  const [setupPath, setSetupPath] = useState<'fresh' | 'import' | null>(null);

  // Build steps based on what's missing and chosen path
  const steps: StepDef[] = [];

  if (needsClient && setupPath === null) {
    // Show choice step first
    steps.push({ id: 'choose-path', title: 'How would you like to set up?', description: 'Choose how to get started with Client Time Tracker' });
  } else if (setupPath === 'import') {
    steps.push({ id: 'import-sync', title: 'Import from Cloud', description: 'Paste the config code from an existing installation' });
  } else {
    // Fresh setup path (or no client needed)
    if (needsJobTypes)
      steps.push({ id: 'job-types', title: 'Job Types', description: 'Add the types of work you do' });
    if (needsClient)
      steps.push({ id: 'client', title: 'First Client', description: 'Add your first client to start tracking time' });
    if (needsSettings)
      steps.push({ id: 'settings', title: 'Business Settings', description: 'Set your default rate and company info' });
  }

  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Job types state
  const [selectedPresets, setSelectedPresets] = useState<string[]>([...COMMON_JOB_TYPES]);
  const [customJobType, setCustomJobType] = useState('');
  const [customJobTypes, setCustomJobTypes] = useState<string[]>([]);

  // Client state
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientRate, setClientRate] = useState('');

  // Settings state
  const [baseRate, setBaseRate] = useState(currentSettings.baseHourlyRate || '');
  const [companyName, setCompanyName] = useState(currentSettings.companyName || '');
  const [payableTo, setPayableTo] = useState(currentSettings.invoicePayableTo || '');

  // Import state
  const [importCode, setImportCode] = useState('');
  const [importPhase, setImportPhase] = useState<ImportPhase>('input');
  const [importStatus, setImportStatus] = useState('');
  const [importStats, setImportStats] = useState<{ pushed: number; pulled: number } | null>(null);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const togglePreset = (name: string) => {
    setSelectedPresets((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const addCustomJobType = () => {
    const trimmed = customJobType.trim();
    if (!trimmed) return;
    if (
      customJobTypes.includes(trimmed) ||
      selectedPresets.includes(trimmed)
    ) {
      setError('That job type already exists');
      return;
    }
    setCustomJobTypes((prev) => [...prev, trimmed]);
    setCustomJobType('');
    setError('');
  };

  const removeCustomJobType = (name: string) => {
    setCustomJobTypes((prev) => prev.filter((n) => n !== name));
  };

  const canProceed = (): boolean => {
    if (!step) return false;
    switch (step.id) {
      case 'choose-path':
        return false; // buttons handle navigation directly
      case 'import-sync':
        return false; // handled by import flow
      case 'job-types':
        return selectedPresets.length + customJobTypes.length > 0;
      case 'client':
        return clientName.trim().length > 0;
      case 'settings':
        return true; // all optional
    }
  };

  const saveCurrentStep = async (): Promise<boolean> => {
    setSaving(true);
    setError('');
    try {
      switch (step.id) {
        case 'job-types': {
          const allTypes = [...selectedPresets, ...customJobTypes];
          for (const name of allTypes) {
            await jobTypesApi.create({ name });
          }
          break;
        }
        case 'client': {
          const data: { name: string; phone?: string; defaultHourlyRate?: string } = {
            name: clientName.trim(),
          };
          if (clientPhone.trim()) data.phone = clientPhone.trim();
          if (clientRate.trim()) data.defaultHourlyRate = clientRate.trim();
          await clientsApi.create(data);
          break;
        }
        case 'settings': {
          const updates: Record<string, string> = {};
          if (baseRate.trim()) updates.baseHourlyRate = baseRate.trim();
          if (companyName.trim()) updates.companyName = companyName.trim();
          if (payableTo.trim()) updates.invoicePayableTo = payableTo.trim();
          if (Object.keys(updates).length > 0) {
            await settingsApi.update(updates);
          }
          break;
        }
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    const ok = await saveCurrentStep();
    if (!ok) return;

    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
      setError('');
    }
  };

  const handleBack = () => {
    if (currentStep === 0 && setupPath !== null) {
      // Go back to choose-path
      setSetupPath(null);
      setCurrentStep(0);
      setError('');
      setImportPhase('input');
      setImportStatus('');
      setImportCode('');
      return;
    }
    setCurrentStep((prev) => prev - 1);
    setError('');
  };

  const handleDismiss = () => {
    localStorage.setItem('ctt_onboarding_dismissed', 'true');
    onComplete();
  };

  const handleChooseFresh = () => {
    setSetupPath('fresh');
    setCurrentStep(0);
    setError('');
  };

  const handleChooseImport = () => {
    setSetupPath('import');
    setCurrentStep(0);
    setError('');
  };

  const handleRunImport = async () => {
    const code = importCode.trim();
    if (!code) return;

    setError('');

    try {
      // Step 1: Decrypt the config string
      setImportPhase('importing');
      setImportStatus('Decrypting configuration...');
      const configFields = await supabaseSync.importConfig(code);

      // Step 2: Save the config
      setImportStatus('Saving connection settings...');
      await supabaseSync.updateConfig({
        supabaseUrl: configFields.supabaseUrl,
        databaseUrl: configFields.databaseUrl,
        supabaseAnonKey: configFields.supabaseAnonKey,
        supabaseServiceKey: configFields.supabaseServiceKey,
      });

      // Step 3: Test connection
      setImportPhase('testing');
      setImportStatus('Testing connection...');
      const testResult = await supabaseSync.testConnection();
      if (!testResult.success) {
        throw new Error(`Connection test failed: ${testResult.message}`);
      }

      // Step 4: Setup schema
      setImportPhase('schema');
      setImportStatus('Verifying database schema...');
      const schemaResult = await supabaseSync.setupSchema();
      if (!schemaResult.success) {
        throw new Error(`Schema setup failed: ${schemaResult.message}`);
      }

      // Step 5: Pull data from cloud
      setImportPhase('syncing');
      setImportStatus('Pulling data from cloud... this may take a moment');
      const syncResult = await supabaseSync.initialSync('pull');
      setImportStats(syncResult.stats);

      // Step 6: Enable ongoing sync
      setImportPhase('enabling');
      setImportStatus('Enabling sync...');
      await supabaseSync.updateConfig({ enabled: true });

      setImportPhase('done');
      setImportStatus('All data synced successfully!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportPhase('error');
      setError(message);
    }
  };

  const phaseLabel = (phase: ImportPhase): string => {
    switch (phase) {
      case 'importing': return 'Decrypting config';
      case 'testing': return 'Testing connection';
      case 'schema': return 'Setting up schema';
      case 'syncing': return 'Syncing data';
      case 'enabling': return 'Enabling sync';
      case 'done': return 'Complete';
      default: return '';
    }
  };

  const IMPORT_PHASES: ImportPhase[] = ['importing', 'testing', 'schema', 'syncing', 'enabling', 'done'];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-500" />
            Welcome! Let&apos;s get you set up
          </DialogTitle>
          <DialogDescription>
            {steps.length > 1 && step?.id !== 'choose-path' && (
              <span className="text-xs text-gray-400">
                Step {currentStep + 1} of {steps.length}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Progress dots */}
        {steps.length > 1 && step?.id !== 'choose-path' && (
          <div className="flex items-center justify-center gap-2">
            {steps.map((s, i) => (
              <div
                key={s.id}
                className={`h-2 rounded-full transition-all ${
                  i === currentStep
                    ? 'w-8 bg-blue-500'
                    : i < currentStep
                    ? 'w-2 bg-blue-300'
                    : 'w-2 bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        <div className="py-2">
          {step?.id !== 'choose-path' && step?.id !== 'import-sync' && (
            <>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">{step?.title}</h3>
              <p className="text-sm text-gray-500 mb-4">{step?.description}</p>
            </>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-4">
              {error}
            </div>
          )}

          {/* Choose Path Step */}
          {step?.id === 'choose-path' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleChooseImport}
                className="w-full flex items-start gap-4 p-4 border-2 border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors text-left cursor-pointer"
              >
                <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                  <Cloud className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">Join an existing team</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    Paste a config code (CTT:...) from another installation to sync all data from the cloud
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleChooseFresh}
                className="w-full flex items-start gap-4 p-4 border-2 border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50/50 transition-colors text-left cursor-pointer"
              >
                <div className="p-2 bg-green-100 rounded-lg shrink-0">
                  <Monitor className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">Start fresh</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    Set up your first client, job types, and business settings from scratch
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Import Sync Step */}
          {step?.id === 'import-sync' && (
            <div className="space-y-4">
              {importPhase === 'input' && (
                <>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">Import Configuration</h3>
                  <p className="text-sm text-gray-500 mb-4">
                    Paste the config code from an existing installation. You can generate one from Settings &gt; Supabase &gt; Export Config on any connected machine.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Config code
                    </label>
                    <textarea
                      value={importCode}
                      onChange={(e) => { setImportCode(e.target.value); setError(''); }}
                      placeholder="CTT:..."
                      rows={3}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoFocus
                    />
                  </div>
                </>
              )}

              {importPhase !== 'input' && (
                <>
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">
                    {importPhase === 'done' ? 'Setup Complete!' : 'Setting up...'}
                  </h3>
                  <div className="space-y-2">
                    {IMPORT_PHASES.map((phase) => {
                      const phaseIdx = IMPORT_PHASES.indexOf(phase);
                      const currentIdx = IMPORT_PHASES.indexOf(importPhase);

                      const isActive = phase === importPhase;
                      const isCompleted = importPhase === 'done'
                        ? true
                        : phaseIdx < currentIdx;

                      return (
                        <div
                          key={phase}
                          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                            isActive ? 'bg-blue-50 text-blue-700 font-medium' :
                            isCompleted ? 'text-green-700' :
                            'text-gray-400'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                          ) : isActive && importPhase !== 'done' ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : isActive && importPhase === 'done' ? (
                            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />
                          )}
                          {phaseLabel(phase)}
                        </div>
                      );
                    })}
                  </div>

                  {importPhase !== 'done' && importPhase !== 'error' && (
                    <p className="text-xs text-gray-500 italic mt-2">{importStatus}</p>
                  )}

                  {importPhase === 'done' && importStats && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                      Synced {importStats.pulled} records from the cloud. You&apos;re all set!
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Job Types Step */}
          {step?.id === 'job-types' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Common IT job types (click to toggle)
                </label>
                <div className="flex flex-wrap gap-2">
                  {COMMON_JOB_TYPES.map((name) => {
                    const selected = selectedPresets.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => togglePreset(name)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-blue-50 border-blue-300 text-blue-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {selected && <Check className="w-3.5 h-3.5" />}
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom job types list */}
              {customJobTypes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {customJobTypes.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium bg-green-50 border border-green-300 text-green-700"
                    >
                      {name}
                      <button
                        type="button"
                        onClick={() => removeCustomJobType(name)}
                        className="hover:text-red-500 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Add your own
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customJobType}
                    onChange={(e) => setCustomJobType(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomJobType(); } }}
                    placeholder="e.g. Data Recovery"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addCustomJobType}
                    disabled={!customJobType.trim()}
                    className="h-[38px]"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Client Step */}
          {step?.id === 'client' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default hourly rate <span className="text-gray-400">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={clientRate}
                    onChange={(e) => setClientRate(e.target.value)}
                    placeholder="185.00"
                    className="w-full rounded-md border border-gray-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Settings Step */}
          {step?.id === 'settings' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 italic">
                These are optional but recommended. You can always change them later in Settings.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default hourly rate
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={baseRate}
                    onChange={(e) => setBaseRate(e.target.value)}
                    placeholder="185.00"
                    className="w-full rounded-md border border-gray-300 pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Your Company Name"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invoice payable to
                </label>
                <textarea
                  value={payableTo}
                  onChange={(e) => setPayableTo(e.target.value)}
                  placeholder={"Your Name\n123 Main St\nCity, State ZIP"}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center !justify-between">
          <div>
            {step?.id === 'choose-path' ? null : step?.id === 'import-sync' && importPhase === 'input' ? (
              <Button variant="ghost" onClick={handleBack} disabled={saving}>
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            ) : step?.id === 'import-sync' ? null : currentStep > 0 ? (
              <Button variant="ghost" onClick={handleBack} disabled={saving}>
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            ) : setupPath === 'fresh' && needsClient ? (
              <Button variant="ghost" onClick={handleBack} disabled={saving}>
                <ChevronLeft className="w-4 h-4" />
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {step?.id === 'choose-path' && (
              <Button variant="ghost" onClick={handleDismiss}>
                Skip for now
              </Button>
            )}
            {step?.id === 'import-sync' && importPhase === 'input' && (
              <Button
                onClick={handleRunImport}
                disabled={!importCode.trim() || !importCode.trim().startsWith('CTT:')}
              >
                Import & Sync
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
            {step?.id === 'import-sync' && importPhase === 'done' && (
              <Button onClick={onComplete}>
                Get Started
              </Button>
            )}
            {step?.id === 'import-sync' && importPhase === 'error' && (
              <Button variant="outline" onClick={() => { setImportPhase('input'); setError(''); }}>
                Try Again
              </Button>
            )}
            {step?.id !== 'choose-path' && step?.id !== 'import-sync' && (
              <>
                {step?.id === 'settings' && (
                  <Button variant="ghost" onClick={handleDismiss} disabled={saving}>
                    Skip
                  </Button>
                )}
                <Button onClick={handleNext} disabled={saving || !canProceed()}>
                  {saving
                    ? 'Saving...'
                    : isLastStep
                    ? 'Finish Setup'
                    : (
                      <>
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
