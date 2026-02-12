'use client';

import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { clients as clientsApi, type Client } from '@/lib/api';

export default function ClientsPage() {
  const [clientList, setClientList] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [formName, setFormName] = useState('');
  const [formHolder, setFormHolder] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadClients = useCallback(async () => {
    try {
      const data = await clientsApi.list();
      setClientList(data);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const filtered = clientList.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.accountHolder || '').toLowerCase().includes(search.toLowerCase())
  );

  const activeClients = filtered.filter((c) => c.isActive);
  const inactiveClients = filtered.filter((c) => !c.isActive);

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormHolder('');
    setFormNotes('');
    setError('');
    setDialogOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setFormName(client.name);
    setFormHolder(client.accountHolder || '');
    setFormNotes(client.notes || '');
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
      if (editing) {
        await clientsApi.update(editing.id, {
          name: formName.trim(),
          accountHolder: formHolder.trim() || undefined,
          notes: formNotes.trim() || undefined,
        });
      } else {
        await clientsApi.create({
          name: formName.trim(),
          accountHolder: formHolder.trim() || undefined,
          notes: formNotes.trim() || undefined,
        });
      }
      setDialogOpen(false);
      loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(client: Client) {
    if (!confirm(`Deactivate "${client.name}"?`)) return;
    try {
      await clientsApi.delete(client.id);
      loadClients();
    } catch (err) {
      console.error('Failed to deactivate client:', err);
    }
  }

  async function handleReactivate(client: Client) {
    try {
      await clientsApi.update(client.id, { isActive: true });
      loadClients();
    } catch (err) {
      console.error('Failed to reactivate client:', err);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="w-6 h-6" />
            Clients
          </h1>
          <p className="text-gray-500 mt-1">
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
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          Loading...
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Account Holder</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Notes</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeClients.map((client) => (
                <tr key={client.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{client.name}</td>
                  <td className="px-4 py-3 text-gray-600">{client.accountHolder || '-'}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{client.notes || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(client)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeactivate(client)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {activeClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    {search ? 'No clients match your search' : 'No clients yet. Click "Add Client" to create one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {inactiveClients.length > 0 && (
            <details className="border-t border-gray-200">
              <summary className="px-4 py-3 text-sm text-gray-500 cursor-pointer hover:bg-gray-50">
                {inactiveClients.length} inactive client{inactiveClients.length > 1 ? 's' : ''}
              </summary>
              <table className="w-full text-sm">
                <tbody>
                  {inactiveClients.map((client) => (
                    <tr key={client.id} className="border-b border-gray-100 bg-gray-50/50 opacity-60">
                      <td className="px-4 py-3">{client.name}</td>
                      <td className="px-4 py-3">{client.accountHolder || '-'}</td>
                      <td className="px-4 py-3">{client.notes || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleReactivate(client)}>
                          Reactivate
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Client' : 'New Client'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {error}
              </div>
            )}
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
              <Input
                id="holder"
                value={formHolder}
                onChange={(e) => setFormHolder(e.target.value)}
                placeholder="e.g. Patrick"
              />
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
