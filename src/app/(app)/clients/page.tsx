'use client';

import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { clients as clientsApi, users as usersApi, type Client, type User } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function ClientsPage() {
  const [clientList, setClientList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [formName, setFormName] = useState('');
  const [formHolderId, setFormHolderId] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formPayableTo, setFormPayableTo] = useState('');
  const [formBillingCycle, setFormBillingCycle] = useState('');
  const [formBillingDay, setFormBillingDay] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [partners, setPartners] = useState<User[]>([]);

  const loadClients = useCallback(async () => {
    try {
      const [data, allUsers] = await Promise.all([
        clientsApi.list(),
        usersApi.list(),
      ]);
      setClientList(data);
      setPartners(allUsers.filter((u) => u.role === 'partner'));
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  function getHolderName(client: Client) {
    if (client.accountHolderId) {
      const p = partners.find((u) => u.id === client.accountHolderId);
      if (p) return p.displayName;
    }
    return client.accountHolder || '-';
  }

  const filtered = clientList.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    getHolderName(c).toLowerCase().includes(search.toLowerCase())
  );

  const activeClients = filtered.filter((c) => c.isActive);
  const inactiveClients = filtered.filter((c) => !c.isActive);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormHolderId('');
    setFormPhone('');
    setFormAddress('');
    setFormNotes('');
    setFormRate('');
    setFormPayableTo('');
    setFormBillingCycle('');
    setFormBillingDay('');
    setError('');
    setDialogOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setFormName(client.name);
    setFormHolderId(client.accountHolderId || '');
    setFormPhone(client.phone || '');
    setFormAddress(client.mailingAddress || '');
    setFormNotes(client.notes || '');
    setFormRate(client.defaultHourlyRate || '');
    setFormPayableTo(client.invoicePayableTo || '');
    setFormBillingCycle(client.billingCycle || '');
    setFormBillingDay(client.billingDay || '');
    setError('');
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      setError('Client name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const holderUser = partners.find((p) => p.id === formHolderId);
      if (editing) {
        await clientsApi.update(editing.id, {
          name: formName.trim(),
          accountHolderId: formHolderId || null,
          accountHolder: holderUser?.displayName || undefined,
          phone: formPhone.trim() || undefined,
          mailingAddress: formAddress.trim() || undefined,
          notes: formNotes.trim() || undefined,
          defaultHourlyRate: formRate.trim() || null,
          invoicePayableTo: formPayableTo.trim() || null,
          billingCycle: formBillingCycle || null,
          billingDay: formBillingCycle ? (parseInt(formBillingDay) || 1) : null,
        });
      } else {
        await clientsApi.create({
          name: formName.trim(),
          accountHolderId: formHolderId || null,
          accountHolder: holderUser?.displayName || undefined,
          phone: formPhone.trim() || undefined,
          mailingAddress: formAddress.trim() || undefined,
          notes: formNotes.trim() || undefined,
          defaultHourlyRate: formRate.trim() || undefined,
          invoicePayableTo: formPayableTo.trim() || undefined,
          billingCycle: formBillingCycle || null,
          billingDay: formBillingCycle ? (parseInt(formBillingDay) || 1) : null,
        });
      }
      setDialogOpen(false);
      loadClients();
      toast.success(editing ? 'Client updated' : 'Client created');
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error(editing ? 'Failed to update client' : 'Failed to create client', {
        description: errorMessage,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(client: Client) {
    if (!confirm(`Deactivate "${client.name}"?`)) return;
    try {
      await clientsApi.delete(client.id);
      loadClients();
      toast.success('Client deactivated');
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error('Failed to deactivate client', {
        description: errorMessage,
      });
    }
  }

  async function handleReactivate(client: Client) {
    try {
      await clientsApi.update(client.id, { isActive: true });
      loadClients();
      toast.success('Client reactivated');
    } catch (err) {
      const errorMessage = (err as any)?.body?.error || (err as Error).message || 'An unknown error occurred.';
      toast.error('Failed to reactivate client', {
        description: errorMessage,
      });
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Briefcase className="w-6 h-6" />
            Clients
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {clientList.filter((c) => c.isActive).length} active clients
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" />
          Add Client
        </Button>
      </div>

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
          Loading...
        </div>
      ) : activeClients.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
          {search ? 'No clients match your search' : 'No clients yet. Click "Add Client" to create one.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeClients.map((client) => (
              <div
                key={client.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate flex-1">{client.name}</h3>
                  <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(client)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDeactivate(client)}>
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Holder:</span>
                    <span className="truncate">{getHolderName(client)}</span>
                  </div>
                  {client.phone && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Phone:</span>
                      <span className="truncate">{client.phone}</span>
                    </div>
                  )}
                  {client.defaultHourlyRate && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Rate:</span>
                      <span>${client.defaultHourlyRate}/hr</span>
                    </div>
                  )}
                  {client.billingCycle && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Billing:</span>
                      <span className="capitalize">{client.billingCycle}</span>
                    </div>
                  )}
                </div>
                {(parseFloat(client.unbilledTotal || '0') > 0 || parseFloat(client.billedUnpaidTotal || '0') > 0) && (
                  <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-xs">
                    {parseFloat(client.unbilledTotal || '0') > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                        <span className="text-gray-500 dark:text-gray-400">Unbilled</span>
                        <span className="font-medium text-amber-700 dark:text-amber-400">{formatCurrency(parseFloat(client.unbilledTotal!))}</span>
                      </div>
                    )}
                    {parseFloat(client.billedUnpaidTotal || '0') > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                        <span className="text-gray-500 dark:text-gray-400">Unpaid</span>
                        <span className="font-medium text-blue-700 dark:text-blue-400">{formatCurrency(parseFloat(client.billedUnpaidTotal!))}</span>
                      </div>
                    )}
                  </div>
                )}
                {client.notes && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 truncate border-t border-gray-100 dark:border-gray-700 pt-2">{client.notes}</p>
                )}
              </div>
            ))}
          </div>

          {inactiveClients.length > 0 && (
            <details className="mt-6">
              <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                {inactiveClients.length} inactive client{inactiveClients.length > 1 ? 's' : ''}
              </summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-3">
                {inactiveClients.map((client) => (
                  <div
                    key={client.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 opacity-60 flex items-center justify-between"
                  >
                    <div>
                      <h3 className="font-medium text-gray-700 dark:text-gray-300 text-sm">{client.name}</h3>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{getHolderName(client)}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleReactivate(client)}>
                      Reactivate
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Client' : 'New Client'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Acme Corp"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="holder">Account Holder</Label>
              <Select value={formHolderId || '__none__'} onValueChange={(v) => setFormHolderId(v === '__none__' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a partner..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="e.g. (707) 555-1234"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Mailing Address</Label>
                <Input
                  id="address"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="e.g. 123 Main St, Eureka CA"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate">Default Hourly Rate ($)</Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                min="0"
                value={formRate}
                onChange={(e) => setFormRate(e.target.value)}
                placeholder="Leave blank to use base rate from settings"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingCycle">Auto-Invoice Billing Cycle</Label>
                <Select value={formBillingCycle || '__none__'} onValueChange={(v) => {
                  setFormBillingCycle(v === '__none__' ? '' : v);
                  if (v === '__none__') setFormBillingDay('');
                  else if (!formBillingDay) setFormBillingDay('1');
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="No auto-invoicing" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None (Manual)</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formBillingCycle && (
                <div className="space-y-2">
                  <Label htmlFor="billingDay">
                    {formBillingCycle === 'weekly' || formBillingCycle === 'bi-weekly'
                      ? 'Day of Week (1=Mon...7=Sun)'
                      : 'Day of Month (1-28)'}
                  </Label>
                  <Input
                    id="billingDay"
                    type="number"
                    min="1"
                    max={formBillingCycle === 'weekly' || formBillingCycle === 'bi-weekly' ? 7 : 28}
                    value={formBillingDay}
                    onChange={(e) => setFormBillingDay(e.target.value)}
                    placeholder="1"
                  />
                </div>
              )}
            </div>
            {formBillingCycle && (
              <p className="text-xs text-gray-500 -mt-2">
                Invoices will be auto-generated as drafts on the scheduled day.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="payableTo">Invoice &quot;Payable To&quot; Override</Label>
              <textarea
                id="payableTo"
                className="flex w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                rows={3}
                value={formPayableTo}
                onChange={(e) => setFormPayableTo(e.target.value)}
                placeholder="Leave blank to use global default"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Overrides the global &quot;Payable To&quot; on invoices for this client.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
