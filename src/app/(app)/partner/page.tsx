'use client';

import { useState, useEffect, useCallback } from 'react';
import { Handshake, DollarSign, Percent, Trash2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  partner as partnerApi,
  users as usersApi,
  type PartnerSplit,
  type PartnerSettlement,
  type PartnerSummaryResponse,
  type User,
} from '@/lib/api';
import { formatCurrency, formatDate, toISODate } from '@/lib/utils';

export default function PartnerPage() {
  const [splits, setSplits] = useState<PartnerSplit[]>([]);
  const [settlements, setSettlements] = useState<PartnerSettlement[]>([]);
  const [summary, setSummary] = useState<PartnerSummaryResponse | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Summary filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Split dialog
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [newSplits, setNewSplits] = useState<{ partnerId: string; splitPercent: string }[]>([]);
  const [splitEffective, setSplitEffective] = useState('');
  const [splitError, setSplitError] = useState('');
  const [savingSplit, setSavingSplit] = useState(false);

  // Settlement dialog
  const [settlementDialogOpen, setSettlementDialogOpen] = useState(false);
  const [settFrom, setSettFrom] = useState('');
  const [settTo, setSettTo] = useState('');
  const [settAmount, setSettAmount] = useState('');
  const [settDate, setSettDate] = useState('');
  const [settNotes, setSettNotes] = useState('');
  const [settError, setSettError] = useState('');
  const [savingSettlement, setSavingSettlement] = useState(false);

  // Default dates
  useEffect(() => {
    const now = new Date();
    const firstOfYear = new Date(now.getFullYear(), 0, 1);
    setDateFrom(toISODate(firstOfYear));
    setDateTo(toISODate(now));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sp, sett, admins] = await Promise.all([
        partnerApi.getSplits(),
        partnerApi.getSettlements(),
        usersApi.list(),
      ]);
      setSplits(sp);
      setSettlements(sett);
      setAdminUsers(admins.filter(u => u.role === 'admin'));
    } catch (err) {
      console.error('Failed to load partner data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    try {
      const s = await partnerApi.getSummary({ dateFrom, dateTo });
      setSummary(s);
    } catch (err) {
      console.error('Failed to load summary:', err);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // --- Split management ---
  function openSplitDialog() {
    // Pre-fill with current splits or empty rows for each admin
    if (splits.length > 0) {
      setNewSplits(splits.map(s => ({
        partnerId: s.partnerId,
        splitPercent: (Number(s.splitPercent) * 100).toFixed(2),
      })));
    } else {
      setNewSplits(adminUsers.map(u => ({
        partnerId: u.id,
        splitPercent: '',
      })));
    }
    setSplitEffective(toISODate(new Date()));
    setSplitError('');
    setSplitDialogOpen(true);
  }

  function updateSplitPercent(idx: number, value: string) {
    setNewSplits(prev => prev.map((s, i) => i === idx ? { ...s, splitPercent: value } : s));
  }

  async function handleSaveSplits() {
    const total = newSplits.reduce((s, sp) => s + (parseFloat(sp.splitPercent) || 0), 0);
    if (Math.abs(total - 100) > 0.01) {
      setSplitError(`Split percentages must total 100% (currently ${total.toFixed(2)}%)`);
      return;
    }
    if (!splitEffective) {
      setSplitError('Effective date is required');
      return;
    }

    setSavingSplit(true);
    setSplitError('');
    try {
      await partnerApi.setSplits({
        splits: newSplits.map(s => ({
          partnerId: s.partnerId,
          splitPercent: parseFloat(s.splitPercent) / 100,
        })),
        effectiveFrom: splitEffective,
      });
      setSplitDialogOpen(false);
      loadData();
      loadSummary();
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : 'Failed to save splits');
    } finally {
      setSavingSplit(false);
    }
  }

  // --- Settlement recording ---
  function openSettlementDialog() {
    setSettFrom(adminUsers[0]?.id || '');
    setSettTo(adminUsers[1]?.id || '');
    setSettAmount('');
    setSettDate(toISODate(new Date()));
    setSettNotes('');
    setSettError('');
    setSettlementDialogOpen(true);
  }

  async function handleRecordSettlement() {
    const amount = parseFloat(settAmount);
    if (isNaN(amount) || amount <= 0) {
      setSettError('Amount must be a positive number');
      return;
    }
    if (!settFrom || !settTo) {
      setSettError('Both partners are required');
      return;
    }
    if (settFrom === settTo) {
      setSettError('From and To partners must be different');
      return;
    }
    if (!settDate) {
      setSettError('Date is required');
      return;
    }

    setSavingSettlement(true);
    setSettError('');
    try {
      await partnerApi.recordSettlement({
        fromPartnerId: settFrom,
        toPartnerId: settTo,
        amount,
        datePaid: settDate,
        notes: settNotes || undefined,
      });
      setSettlementDialogOpen(false);
      loadData();
      loadSummary();
    } catch (err) {
      setSettError(err instanceof Error ? err.message : 'Failed to record settlement');
    } finally {
      setSavingSettlement(false);
    }
  }

  function getPartnerName(id: string) {
    return adminUsers.find(u => u.id === id)?.displayName || 'Unknown';
  }

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading partner data...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Handshake className="w-6 h-6" />
          Partner Settlements
        </h1>
        <p className="text-gray-500 mt-1">Manage revenue splits and inter-partner settlements</p>
      </div>

      {/* Summary section */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Revenue Summary</h2>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36"
            />
            <span className="text-gray-400">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36"
            />
          </div>
        </div>

        {summary ? (
          <>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="text-sm text-gray-500 mb-1">Total Paid Revenue</div>
              <div className="text-2xl font-bold text-gray-900">{formatCurrency(summary.totalRevenue)}</div>
            </div>

            {summary.partners.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {summary.partners.map((p) => (
                  <div key={p.partnerId} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-gray-900">{p.partnerName}</span>
                      <span className="text-sm text-gray-500">{(p.splitPercent * 100).toFixed(1)}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-gray-500 text-xs">Expected</div>
                        <div className="font-medium">{formatCurrency(p.expectedShare)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs">Received</div>
                        <div className="font-medium text-green-600">{formatCurrency(p.paidOut)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs">Balance</div>
                        <div className={`font-bold ${p.balance > 0.01 ? 'text-amber-600' : p.balance < -0.01 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatCurrency(p.balance)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-500 text-sm py-4">
                No partner splits configured.{' '}
                <button onClick={openSplitDialog} className="text-blue-600 hover:underline">
                  Set up splits
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-gray-500 py-4">Select a date range to view summary</div>
        )}
      </div>

      {/* Current Splits + Settlement actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Current Splits */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Percent className="w-4 h-4" />
              Current Splits
            </h2>
            <Button size="sm" variant="outline" onClick={openSplitDialog}>
              Update Splits
            </Button>
          </div>
          {splits.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No splits configured
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {splits.map((s) => (
                <div key={s.id} className="px-6 py-3 flex items-center justify-between">
                  <span className="font-medium text-gray-900">{s.partnerName}</span>
                  <div className="text-right">
                    <span className="text-lg font-semibold text-gray-900">
                      {(Number(s.splitPercent) * 100).toFixed(1)}%
                    </span>
                    <div className="text-xs text-gray-400">Since {formatDate(s.effectiveFrom)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <DollarSign className="w-4 h-4" />
            Settlements
          </h2>
          <Button onClick={openSettlementDialog} className="w-full mb-4">
            <DollarSign className="w-4 h-4 mr-2" />
            Record Settlement Payment
          </Button>
          <p className="text-sm text-gray-500">
            Record when one partner pays another to settle the revenue split difference.
          </p>
        </div>
      </div>

      {/* Settlement History */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Settlement History</h2>
        </div>
        {settlements.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No settlements recorded</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {settlements.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-600">{formatDate(s.datePaid)}</td>
                  <td className="px-6 py-3 text-gray-900">{getPartnerName(s.fromPartnerId)}</td>
                  <td className="px-6 py-3 text-gray-900">{getPartnerName(s.toPartnerId)}</td>
                  <td className="px-6 py-3 text-right font-medium text-green-600">{formatCurrency(s.amount)}</td>
                  <td className="px-6 py-3 text-gray-500 text-xs">{s.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Split Dialog */}
      <Dialog open={splitDialogOpen} onOpenChange={setSplitDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Revenue Splits</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {splitError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {splitError}
              </div>
            )}
            <div className="space-y-2">
              <Label>Effective From *</Label>
              <Input
                type="date"
                value={splitEffective}
                onChange={(e) => setSplitEffective(e.target.value)}
              />
            </div>
            <div className="space-y-3">
              {newSplits.map((s, i) => {
                const partner = adminUsers.find(u => u.id === s.partnerId);
                return (
                  <div key={s.partnerId} className="flex items-center gap-3">
                    <span className="w-32 text-sm font-medium text-gray-700 truncate">
                      {partner?.displayName || 'Unknown'}
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={s.splitPercent}
                      onChange={(e) => updateSplitPercent(i, e.target.value)}
                      placeholder="0.00"
                      className="w-28"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                );
              })}
            </div>
            {newSplits.length > 0 && (
              <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
                Total: <span className={`font-semibold ${
                  Math.abs(newSplits.reduce((s, sp) => s + (parseFloat(sp.splitPercent) || 0), 0) - 100) < 0.01
                    ? 'text-green-600' : 'text-red-600'
                }`}>
                  {newSplits.reduce((s, sp) => s + (parseFloat(sp.splitPercent) || 0), 0).toFixed(2)}%
                </span>
                {' '}(must equal 100%)
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitDialogOpen(false)} disabled={savingSplit}>
              Cancel
            </Button>
            <Button onClick={handleSaveSplits} disabled={savingSplit}>
              {savingSplit ? 'Saving...' : 'Save Splits'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settlement Dialog */}
      <Dialog open={settlementDialogOpen} onOpenChange={setSettlementDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Settlement Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {settError && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                {settError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From *</Label>
                <Select value={settFrom} onValueChange={setSettFrom}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select partner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {adminUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>To *</Label>
                <Select value={settTo} onValueChange={setSettTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select partner..." />
                  </SelectTrigger>
                  <SelectContent>
                    {adminUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={settAmount}
                  onChange={(e) => setSettAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={settDate}
                  onChange={(e) => setSettDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                value={settNotes}
                onChange={(e) => setSettNotes(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementDialogOpen(false)} disabled={savingSettlement}>
              Cancel
            </Button>
            <Button onClick={handleRecordSettlement} disabled={savingSettlement}>
              {savingSettlement ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
