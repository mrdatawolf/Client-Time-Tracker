'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Users, Briefcase, DollarSign, Plus, Pencil, Trash2, Key, Cloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  users as usersApi,
  jobTypes as jobTypesApi,
  rateTiers as rateTiersApi,
  settings as settingsApi,
  type User,
  type JobType,
  type RateTier,
} from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { isPartner as checkIsPartner } from '@/lib/api-client';
import SupabaseTab from './supabase-tab';

type Tab = 'general' | 'users' | 'jobTypes' | 'rateTiers' | 'supabase';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'general', label: 'General', icon: Settings },
    { key: 'users', label: 'Users', icon: Users },
    { key: 'jobTypes', label: 'Job Types', icon: Briefcase },
    { key: 'rateTiers', label: 'Rate Tiers', icon: DollarSign },
    { key: 'supabase', label: 'Supabase Sync', icon: Cloud },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Settings
        </h1>
        <p className="text-gray-500 mt-1">Manage general settings, users, job types, and rate tiers</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'jobTypes' && <JobTypesTab />}
      {tab === 'rateTiers' && <RateTiersTab />}
      {tab === 'supabase' && <SupabaseTab />}
    </div>
  );
}

// ============ General Tab ============

function GeneralTab() {
  const [baseRate, setBaseRate] = useState('185');
  const [companyName, setCompanyName] = useState('');
  const [payableTo, setPayableTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      if (data.baseHourlyRate) setBaseRate(data.baseHourlyRate);
      if (data.companyName) setCompanyName(data.companyName);
      if (data.invoicePayableTo) setPayableTo(data.invoicePayableTo);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await settingsApi.update({
        baseHourlyRate: baseRate,
        companyName,
        invoicePayableTo: payableTo,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Company</h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Company Name</label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Lost Coast IT"
            />
            <p className="text-xs text-gray-500">
              Shown at the top of generated invoices.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Invoice &quot;Payable To&quot;</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              rows={3}
              value={payableTo}
              onChange={(e) => setPayableTo(e.target.value)}
              placeholder={"Name\nAddress line 1\nCity, State ZIP"}
            />
            <p className="text-xs text-gray-500">
              Displayed in the &quot;Payable To&quot; footer of invoices. Use separate lines for name and address.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Rates</h2>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Base Hourly Rate ($)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
              placeholder="185.00"
            />
            <p className="text-xs text-gray-500">
              Default rate used when a client does not have a specific hourly rate set.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
      </div>
    </div>
  );
}

// ============ Users Tab ============

function UsersTab() {
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);

  // Form state
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'partner' | 'admin' | 'basic'>('basic');
  const currentUserIsPartner = checkIsPartner();
  const [saving, setSaving] = useState(false);

  // Reset password state
  const [newPassword, setNewPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUserList(await usersApi.list());
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function openCreate() {
    setEditingUser(null);
    setUsername('');
    setDisplayName('');
    setPassword('');
    setRole('basic');
    setDialogOpen(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setUsername(user.username);
    setDisplayName(user.displayName);
    setPassword('');
    setRole(user.role);
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingUser) {
        await usersApi.update(editingUser.id, { displayName, role });
      } else {
        if (!username || !displayName || !password) return;
        await usersApi.create({ username, displayName, password, role });
      }
      setDialogOpen(false);
      loadUsers();
    } catch (err) {
      console.error('Failed to save user:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(user: User) {
    try {
      await usersApi.update(user.id, { isActive: !user.isActive });
      loadUsers();
    } catch (err) {
      console.error('Failed to toggle user:', err);
    }
  }

  async function handleResetPassword() {
    if (!resetPwUser || !newPassword) return;
    setResetSaving(true);
    try {
      await usersApi.update(resetPwUser.id, { displayName: resetPwUser.displayName } as never);
      // The users route accepts password in the PUT body
      const token = localStorage.getItem('ctt_token');
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3701';
      await fetch(`${base}/api/users/${resetPwUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPassword }),
      });
      setResetPwUser(null);
      setNewPassword('');
    } catch (err) {
      console.error('Failed to reset password:', err);
    } finally {
      setResetSaving(false);
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Display Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {userList.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{user.username}</td>
                  <td className="px-6 py-3 text-gray-600">{user.displayName}</td>
                  <td className="px-6 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      user.role === 'partner' ? 'bg-amber-100 text-amber-700' :
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    {user.role === 'partner' && !currentUserIsPartner ? (
                      <span className="text-xs text-gray-400">—</span>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(user)} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setResetPwUser(user); setNewPassword(''); }} title="Reset Password">
                          <Key className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(user)}
                          title={user.isActive ? 'Deactivate' : 'Activate'}
                        >
                          <Trash2 className={`w-3.5 h-3.5 ${user.isActive ? 'text-red-500' : 'text-green-500'}`} />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit User Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Add User'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editingUser && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Username</label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">Display Name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Full Name" />
            </div>
            {!editingUser && (
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'partner' | 'admin' | 'basic')}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white h-10"
              >
                <option value="basic">Basic</option>
                <option value="admin">Admin</option>
                {currentUserIsPartner && <option value="partner">Partner</option>}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingUser ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwUser} onOpenChange={() => setResetPwUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password for {resetPwUser?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">New Password</label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetSaving || !newPassword}>
              {resetSaving ? 'Saving...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Job Types Tab ============

function JobTypesTab() {
  const [items, setItems] = useState<JobType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<JobType | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await jobTypesApi.list());
    } catch (err) {
      console.error('Failed to load job types:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function openCreate() {
    setEditing(null);
    setName('');
    setDescription('');
    setDialogOpen(true);
  }

  function openEdit(item: JobType) {
    setEditing(item);
    setName(item.name);
    setDescription(item.description || '');
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await jobTypesApi.update(editing.id, { name, description });
      } else {
        if (!name) return;
        await jobTypesApi.create({ name, description: description || undefined });
      }
      setDialogOpen(false);
      loadData();
    } catch (err) {
      console.error('Failed to save job type:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item: JobType) {
    try {
      await jobTypesApi.update(item.id, { isActive: !item.isActive });
      loadData();
    } catch (err) {
      console.error('Failed to toggle job type:', err);
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" /> Add Job Type
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-6 py-3 text-gray-600">{item.description || '-'}</td>
                  <td className="px-6 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(item)}
                        title={item.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${item.isActive ? 'text-red-500' : 'text-green-500'}`} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Job Type' : 'Add Job Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Job type name" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============ Rate Tiers Tab ============

function RateTiersTab() {
  const [items, setItems] = useState<RateTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RateTier | null>(null);
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await rateTiersApi.list());
    } catch (err) {
      console.error('Failed to load rate tiers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function openCreate() {
    setEditing(null);
    setAmount('');
    setLabel('');
    setDialogOpen(true);
  }

  function openEdit(item: RateTier) {
    setEditing(item);
    setAmount(item.amount);
    setLabel(item.label || '');
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editing) {
        await rateTiersApi.update(editing.id, { amount, label: label || undefined });
      } else {
        if (!amount) return;
        await rateTiersApi.create({ amount, label: label || undefined });
      }
      setDialogOpen(false);
      loadData();
    } catch (err) {
      console.error('Failed to save rate tier:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(item: RateTier) {
    try {
      await rateTiersApi.update(item.id, { isActive: !item.isActive });
      loadData();
    } catch (err) {
      console.error('Failed to toggle rate tier:', err);
    }
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" /> Add Rate Tier
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{formatCurrency(item.amount)}/h</td>
                  <td className="px-6 py-3 text-gray-600">{item.label || '-'}</td>
                  <td className="px-6 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      item.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(item)}
                        title={item.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <Trash2 className={`w-3.5 h-3.5 ${item.isActive ? 'text-red-500' : 'text-green-500'}`} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Rate Tier' : 'Add Rate Tier'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Amount (per hour)</label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Label</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional label (e.g. Standard, Premium)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !amount}>
              {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
