/**
 * Typed data layer, backed directly by Supabase (PostgREST + RPCs).
 * Function signatures and response shapes mirror the legacy REST API so the
 * component tree stays unchanged. RLS is the security boundary.
 */
import { getSupabase } from './supabase';
import { toCamel, toSnake } from './case';
import { ApiError, refreshCurrentUser, getUser, setUser, type SessionUser } from './api-client';

// --- Types ---

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  role: 'partner' | 'admin' | 'basic';
  status?: 'pending' | 'active' | 'disabled';
  authUserId?: string | null;
  theme: 'light' | 'dark' | 'system';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  accountHolder: string | null;
  accountHolderId: string | null;
  phone: string | null;
  mailingAddress: string | null;
  isActive: boolean;
  notes: string | null;
  defaultHourlyRate: string | null;
  invoicePayableTo: string | null;
  billingCycle: string | null;
  billingDay: string | null;
  invoicePrefix: string | null;
  nextInvoiceNumber: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed balances from list endpoint
  unbilledTotal?: string;
  billedUnpaidTotal?: string;
}

export interface JobType {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RateTier {
  id: string;
  amount: string;
  label: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  clientId: string;
  techId: string;
  jobTypeId: string;
  rateTierId: string;
  date: string;
  hours: string;
  notes: string | null;
  groupId: string | null;
  isBilled: boolean;
  isPaid: boolean;
  invoiceId: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed/joined
  total?: string | null;
  invoicePaid?: boolean;
  invoice?: { id: string; status: 'draft' | 'sent' | 'paid' | 'void'; invoiceNumber?: string };
  client?: Client;
  tech?: Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'isActive'>;
  jobType?: JobType;
  rateTier?: RateTier;
}

// --- Internals ---

function db() {
  return getSupabase();
}

function fail(error: { message: string; code?: string }, status = 500): never {
  // Friendlier message for FK violations (mirrors the legacy server)
  if (error.code === '23503') {
    throw new ApiError('Invalid reference: one of the selected items does not exist.', 400);
  }
  if (error.code === '23505') {
    throw new ApiError('That name already exists.', 409);
  }
  throw new ApiError(error.message, status);
}

const TIME_ENTRY_SELECT = `*,
  client:clients(*),
  tech:users(id, username, display_name, role, is_active),
  jobType:job_types(*),
  rateTier:rate_tiers(*),
  invoice:invoices(id, status, invoice_number)`;

function decorateEntry(raw: Record<string, unknown>): TimeEntry {
  const entry = toCamel<TimeEntry>(raw);
  entry.total = entry.rateTier
    ? String(parseFloat(String(entry.hours)) * parseFloat(String(entry.rateTier.amount)))
    : null;
  entry.invoicePaid = entry.invoice?.status === 'paid';
  return entry;
}

function downloadFile(content: string, filename: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Auth ---

export const auth = {
  login: async (email: string, password: string): Promise<{ user: SessionUser }> => {
    const { error } = await db().auth.signInWithPassword({ email, password });
    if (error) throw new ApiError(error.message, 401);
    const user = await refreshCurrentUser();
    if (!user) throw new ApiError('Signed in, but no user record was found for this account.', 500);
    return { user };
  },

  signup: async (email: string, password: string, displayName: string): Promise<{ pending: boolean }> => {
    const { data, error } = await db().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw new ApiError(error.message, 400);
    if (!data.session) return { pending: true }; // email confirmation required
    const user = await refreshCurrentUser();
    return { pending: user?.status !== 'active' };
  },

  me: () => refreshCurrentUser(),

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: boolean }> => {
    const email = getUser()?.email;
    if (!email) throw new ApiError('No signed-in user', 401);
    const { error: verifyError } = await db().auth.signInWithPassword({ email, password: currentPassword });
    if (verifyError) throw new ApiError('Current password is incorrect', 400);
    const { error } = await db().auth.updateUser({ password: newPassword });
    if (error) throw new ApiError(error.message, 400);
    return { success: true };
  },

  updatePreferences: async (prefs: { theme: 'light' | 'dark' | 'system' }): Promise<User> => {
    const current = getUser();
    if (!current) throw new ApiError('No signed-in user', 401);
    const { data, error } = await db()
      .from('users')
      .update({ theme: prefs.theme })
      .eq('id', current.id)
      .select()
      .single();
    if (error) fail(error);
    setUser({ ...current, theme: prefs.theme });
    return toCamel<User>(data);
  },
};

// --- Clients ---

export const clients = {
  list: async (): Promise<Client[]> => {
    const [listRes, balances] = await Promise.all([
      db().from('clients').select('*').order('name'),
      db().rpc('client_balances'),
    ]);
    if (listRes.error) fail(listRes.error);
    const balanceMap = new Map<string, { unbilledTotal: string; billedUnpaidTotal: string }>();
    if (!balances.error && Array.isArray(balances.data)) {
      for (const b of balances.data as Array<{ clientId: string; unbilledTotal: string; billedUnpaidTotal: string }>) {
        balanceMap.set(b.clientId, b);
      }
    }
    return (listRes.data ?? []).map((row) => ({
      ...toCamel<Client>(row),
      unbilledTotal: balanceMap.get(row.id as string)?.unbilledTotal || '0',
      billedUnpaidTotal: balanceMap.get(row.id as string)?.billedUnpaidTotal || '0',
    }));
  },

  get: async (id: string): Promise<Client> => {
    const { data, error } = await db().from('clients').select('*').eq('id', id).single();
    if (error) fail(error, 404);
    return toCamel<Client>(data);
  },

  create: async (data: { name: string; accountHolder?: string; accountHolderId?: string | null; phone?: string; mailingAddress?: string; notes?: string; defaultHourlyRate?: string; invoicePayableTo?: string; billingCycle?: string | null; billingDay?: number | null; invoicePrefix?: string | null; nextInvoiceNumber?: string | null }): Promise<Client> => {
    const row = toSnake({
      ...data,
      billingDay: data.billingCycle ? (data.billingDay || 1) : null,
      nextInvoiceNumber: data.nextInvoiceNumber || '1000',
    });
    const { data: created, error } = await db().from('clients').insert(row).select().single();
    if (error) fail(error);
    return toCamel<Client>(created);
  },

  update: async (id: string, data: Partial<{ name: string; accountHolder: string; accountHolderId: string | null; phone: string; mailingAddress: string; isActive: boolean; notes: string; defaultHourlyRate: string | null; invoicePayableTo: string | null; billingCycle: string | null; billingDay: number | null; invoicePrefix: string | null; nextInvoiceNumber: string | null }>): Promise<Client> => {
    const row = toSnake(data);
    if (data.billingCycle === null) row.billing_day = null;
    const { data: updated, error } = await db().from('clients').update(row).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<Client>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('clients').update({ is_active: false }).eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Job Types ---

export const jobTypes = {
  list: async (): Promise<JobType[]> => {
    const { data, error } = await db().from('job_types').select('*').order('name');
    if (error) fail(error);
    return toCamel<JobType[]>(data);
  },

  create: async (data: { name: string; description?: string }): Promise<JobType> => {
    const { data: created, error } = await db().from('job_types').insert(toSnake(data)).select().single();
    if (error) fail(error);
    return toCamel<JobType>(created);
  },

  update: async (id: string, data: Partial<{ name: string; description: string; isActive: boolean }>): Promise<JobType> => {
    const { data: updated, error } = await db().from('job_types').update(toSnake(data)).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<JobType>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('job_types').update({ is_active: false }).eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Rate Tiers ---

export const rateTiers = {
  list: async (): Promise<RateTier[]> => {
    const { data, error } = await db().from('rate_tiers').select('*').order('amount');
    if (error) fail(error);
    return toCamel<RateTier[]>(data);
  },

  create: async (data: { amount: string; label?: string }): Promise<RateTier> => {
    const { data: created, error } = await db().from('rate_tiers').insert(toSnake(data)).select().single();
    if (error) fail(error);
    return toCamel<RateTier>(created);
  },

  update: async (id: string, data: Partial<{ amount: string; label: string; isActive: boolean }>): Promise<RateTier> => {
    const { data: updated, error } = await db().from('rate_tiers').update(toSnake(data)).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<RateTier>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('rate_tiers').update({ is_active: false }).eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Time Entries ---

export interface TimeEntryFilters {
  clientId?: string;
  techId?: string;
  dateFrom?: string;
  dateTo?: string;
  isBilled?: boolean;
}

export interface CreateTimeEntry {
  clientId: string;
  techId?: string;
  jobTypeId: string;
  rateTierId: string;
  date: string;
  hours: number;
  notes?: string;
  groupId?: string;
}

function createEntryRow(e: CreateTimeEntry) {
  return {
    client_id: e.clientId,
    tech_id: e.techId || getUser()?.id,
    job_type_id: e.jobTypeId,
    rate_tier_id: e.rateTierId,
    date: e.date,
    hours: String(e.hours),
    notes: e.notes || null,
    group_id: e.groupId && e.groupId.trim() ? e.groupId : null,
  };
}

export const timeEntries = {
  list: async (filters?: TimeEntryFilters): Promise<TimeEntry[]> => {
    let q = db().from('time_entries').select(TIME_ENTRY_SELECT).order('date', { ascending: false });
    if (filters?.clientId) q = q.eq('client_id', filters.clientId);
    if (filters?.techId) q = q.eq('tech_id', filters.techId);
    if (filters?.dateFrom) q = q.gte('date', filters.dateFrom);
    if (filters?.dateTo) q = q.lte('date', filters.dateTo);
    if (filters?.isBilled !== undefined) q = q.eq('is_billed', filters.isBilled);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []).map(decorateEntry);
  },

  grid: async (dateFrom: string, dateTo: string, clientId?: string): Promise<TimeEntry[]> => {
    let q = db().from('time_entries').select(TIME_ENTRY_SELECT)
      .gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: true });
    if (clientId) q = q.eq('client_id', clientId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []).map(decorateEntry);
  },

  get: async (id: string): Promise<TimeEntry> => {
    const { data, error } = await db().from('time_entries').select(TIME_ENTRY_SELECT).eq('id', id).single();
    if (error) fail(error, 404);
    return decorateEntry(data);
  },

  create: async (data: CreateTimeEntry): Promise<TimeEntry> => {
    const { data: created, error } = await db().from('time_entries').insert(createEntryRow(data)).select().single();
    if (error) fail(error);
    return toCamel<TimeEntry>(created);
  },

  bulkCreate: async (entries: CreateTimeEntry[]): Promise<TimeEntry[]> => {
    const { data, error } = await db().from('time_entries').insert(entries.map(createEntryRow)).select();
    if (error) fail(error);
    return toCamel<TimeEntry[]>(data);
  },

  update: async (id: string, data: Partial<CreateTimeEntry & { isBilled: boolean; isPaid: boolean }>): Promise<TimeEntry> => {
    const row: Record<string, unknown> = {};
    if (data.clientId !== undefined) row.client_id = data.clientId;
    if (data.techId !== undefined) row.tech_id = data.techId;
    if (data.jobTypeId !== undefined) row.job_type_id = data.jobTypeId;
    if (data.rateTierId !== undefined) row.rate_tier_id = data.rateTierId;
    if (data.date !== undefined) row.date = data.date;
    if (data.hours !== undefined) row.hours = String(data.hours);
    if (data.notes !== undefined) row.notes = data.notes;
    if (data.groupId !== undefined) row.group_id = data.groupId || null;
    if (data.isBilled !== undefined) row.is_billed = data.isBilled;
    if (data.isPaid !== undefined) row.is_paid = data.isPaid;
    const { data: updated, error } = await db().from('time_entries').update(row).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<TimeEntry>(updated);
  },

  bulkUpdate: async (ids: string[], updates: { isBilled?: boolean; isPaid?: boolean }): Promise<TimeEntry[]> => {
    const row: Record<string, unknown> = {};
    if (updates.isBilled !== undefined) row.is_billed = updates.isBilled;
    if (updates.isPaid !== undefined) row.is_paid = updates.isPaid;
    const { data, error } = await db().from('time_entries').update(row).in('id', ids).select();
    if (error) fail(error);
    return toCamel<TimeEntry[]>(data);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    // Draft-invoice line item cleanup happens via database trigger
    const { error } = await db().from('time_entries').delete().eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Invoices ---

export interface Invoice {
  id: string;
  clientId: string;
  invoiceNumber: string;
  dateIssued: string;
  dateDue: string | null;
  status: 'draft' | 'sent' | 'paid' | 'void';
  notes: string | null;
  isAutoGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  // Joined
  client?: Client;
  lineItems?: InvoiceLineItem[];
  total?: number;
}

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  timeEntryId: string | null;
  description: string;
  hours: string;
  rate: string;
  lineItemType: 'labor' | 'part';
  createdAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: string;
  datePaid: string;
  method: string | null;
  notes: string | null;
  createdAt: string;
}

export interface InvoiceSplitEntry {
  partnerId: string;
  partnerName: string;
  role: string;
  amount: string;
  isPaidOut: boolean;
}

export interface InvoiceSplitResponse {
  splits: InvoiceSplitEntry[];
  splitConfig: {
    techPercent: number;
    holderPercent: number;
  };
  partsTotal: string;
}

export interface GenerateInvoiceRequest {
  clientId: string;
  dateFrom: string;
  dateTo: string;
  dateDue?: string;
  notes?: string;
}

function lineTotal(lines: Array<{ hours: unknown; rate: unknown }>): number {
  return lines.reduce((sum, l) => sum + Number(l.hours) * Number(l.rate), 0);
}

export const invoices = {
  list: async (filters?: { clientId?: string; status?: string }): Promise<Invoice[]> => {
    let q = db().from('invoices')
      .select('*, client:clients(*), lineItems:invoice_line_items(hours, rate)')
      .order('date_issued', { ascending: false });
    if (filters?.clientId) q = q.eq('client_id', filters.clientId);
    if (filters?.status) q = q.eq('status', filters.status);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []).map((row) => {
      const { lineItems, ...rest } = row as { lineItems: Array<{ hours: unknown; rate: unknown }> } & Record<string, unknown>;
      return { ...toCamel<Invoice>(rest), total: lineTotal(lineItems ?? []) };
    });
  },

  get: async (id: string): Promise<Invoice> => {
    const { data, error } = await db().from('invoices')
      .select('*, client:clients(*), lineItems:invoice_line_items(*)')
      .eq('id', id).single();
    if (error) fail(error, 404);
    const invoice = toCamel<Invoice>(data);
    invoice.total = lineTotal((invoice.lineItems ?? []) as Array<{ hours: unknown; rate: unknown }>);
    return invoice;
  },

  create: async (data: { clientId: string; invoiceNumber: string; dateIssued: string; dateDue?: string; notes?: string }): Promise<Invoice> => {
    const { data: created, error } = await db().from('invoices').insert(toSnake({ status: 'draft', ...data })).select().single();
    if (error) fail(error);
    return toCamel<Invoice>(created);
  },

  generate: async (data: GenerateInvoiceRequest): Promise<Invoice> => {
    const { data: result, error } = await db().rpc('generate_invoice', {
      p_client_id: data.clientId,
      p_date_from: data.dateFrom || null,
      p_date_to: data.dateTo || null,
      p_date_due: data.dateDue || null,
      p_notes: data.notes || null,
    });
    if (error) fail(error);
    if (!result) throw new ApiError('No unbilled entries found', 400);
    return toCamel<Invoice>((result as { invoice: unknown }).invoice);
  },

  update: async (id: string, data: Partial<{ invoiceNumber: string; dateIssued: string; dateDue: string; status: string; notes: string }>): Promise<Invoice> => {
    const { data: updated, error } = await db().from('invoices').update(toSnake(data)).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<Invoice>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().rpc('delete_invoice', { p_invoice_id: id });
    if (error) fail(error);
    return { success: true };
  },

  updateLineItem: async (invoiceId: string, lineId: string, data: Partial<{ description: string; hours: string; rate: string }>): Promise<InvoiceLineItem> => {
    const { data: updated, error } = await db().from('invoice_line_items').update(toSnake(data)).eq('id', lineId).select().single();
    if (error) fail(error);
    return toCamel<InvoiceLineItem>(updated);
  },

  addLineItem: async (invoiceId: string, data: { description: string; hours: string; rate: string; lineItemType?: 'labor' | 'part' }): Promise<InvoiceLineItem> => {
    const { data: created, error } = await db().from('invoice_line_items')
      .insert({ invoice_id: invoiceId, ...toSnake({ lineItemType: 'labor', ...data }) })
      .select().single();
    if (error) fail(error);
    return toCamel<InvoiceLineItem>(created);
  },

  deleteLineItem: async (invoiceId: string, lineId: string): Promise<{ success: boolean }> => {
    const { data: existing, error: fetchError } = await db().from('invoice_line_items')
      .select('id, time_entry_id').eq('id', lineId).single();
    if (fetchError) fail(fetchError, 404);
    if (existing.time_entry_id) {
      await db().from('time_entries')
        .update({ is_billed: false, invoice_id: null })
        .eq('id', existing.time_entry_id);
    }
    const { error } = await db().from('invoice_line_items').delete().eq('id', lineId);
    if (error) fail(error);
    return { success: true };
  },

  triggerAutoGenerate: async (): Promise<{ generated: number; skipped: number; results: Array<{ clientName: string; status: string; invoiceNumber?: string }> }> => {
    const { data, error } = await db().rpc('auto_invoice_check');
    if (error) fail(error);
    return data as { generated: number; skipped: number; results: Array<{ clientName: string; status: string; invoiceNumber?: string }> };
  },

  getAutoGenerateLog: async (limit?: number) => {
    const { data, error } = await db().from('auto_invoice_log')
      .select('*, client:clients(name)')
      .order('created_at', { ascending: false })
      .limit(limit ?? 50);
    if (error) fail(error);
    return (data ?? []).map((row) => {
      const { client, ...rest } = row as { client: { name: string } | null } & Record<string, unknown>;
      return { ...toCamel<Record<string, unknown>>(rest), clientName: client?.name ?? '' };
    }) as Array<{ id: string; clientId: string; invoiceId: string | null; billingPeriodStart: string; billingPeriodEnd: string; status: string; message: string | null; createdAt: string; clientName: string }>;
  },

  downloadPdf: async (id: string): Promise<void> => {
    const { downloadInvoicePdf } = await import('./invoice-pdf');
    await downloadInvoicePdf(id);
  },

  getSplit: async (id: string): Promise<InvoiceSplitResponse> => {
    const { data, error } = await db().rpc('invoice_split', { p_invoice_id: id });
    if (error) fail(error);
    return data as InvoiceSplitResponse;
  },

  togglePayoutFlag: async (id: string, partnerId: string): Promise<{ id: string; isPaid: boolean }> => {
    const { data, error } = await db().rpc('toggle_payout_flag', { p_invoice_id: id, p_partner_id: partnerId });
    if (error) fail(error);
    return toCamel<{ id: string; isPaid: boolean }>(data);
  },
};

// --- Payments ---

export const payments = {
  list: async (invoiceId?: string): Promise<Payment[]> => {
    let q = db().from('payments').select('*').order('date_paid', { ascending: false });
    if (invoiceId) q = q.eq('invoice_id', invoiceId);
    const { data, error } = await q;
    if (error) fail(error);
    return toCamel<Payment[]>(data);
  },

  get: async (id: string): Promise<Payment> => {
    const { data, error } = await db().from('payments').select('*').eq('id', id).single();
    if (error) fail(error, 404);
    return toCamel<Payment>(data);
  },

  create: async (data: { invoiceId: string; amount: number; datePaid: string; method?: string; notes?: string }): Promise<Payment> => {
    const { data: created, error } = await db().from('payments')
      .insert(toSnake({ ...data, amount: String(data.amount) }))
      .select().single();
    if (error) fail(error);

    // Mark the invoice paid when payments cover the total (legacy behavior)
    const [{ data: lines }, { data: allPayments }] = await Promise.all([
      db().from('invoice_line_items').select('hours, rate').eq('invoice_id', data.invoiceId),
      db().from('payments').select('amount').eq('invoice_id', data.invoiceId),
    ]);
    const total = lineTotal(lines ?? []);
    const paid = (allPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
    if (paid >= total) {
      await db().from('invoices').update({ status: 'paid' }).eq('id', data.invoiceId);
    }
    return toCamel<Payment>(created);
  },

  update: async (id: string, data: Partial<{ amount: number; datePaid: string; method: string; notes: string }>): Promise<Payment> => {
    const row = toSnake({ ...data, ...(data.amount !== undefined ? { amount: String(data.amount) } : {}) });
    const { data: updated, error } = await db().from('payments').update(row).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<Payment>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('payments').delete().eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Users (admin) ---

export const users = {
  list: async (): Promise<User[]> => {
    const { data, error } = await db().from('users')
      .select('id, username, display_name, email, role, status, auth_user_id, theme, is_active, created_at, updated_at')
      .order('display_name');
    if (error) fail(error);
    return toCamel<User[]>(data);
  },

  get: async (id: string): Promise<User> => {
    const { data, error } = await db().from('users')
      .select('id, username, display_name, email, role, status, auth_user_id, theme, is_active, created_at, updated_at')
      .eq('id', id).single();
    if (error) fail(error, 404);
    return toCamel<User>(data);
  },

  /** Pre-create a user; when they sign up with this email they auto-link. */
  create: async (data: { displayName: string; email: string; role?: 'partner' | 'admin' | 'basic' }): Promise<User> => {
    const { data: created, error } = await db().from('users').insert({
      username: data.email.toLowerCase(),
      display_name: data.displayName,
      email: data.email.toLowerCase(),
      role: data.role || 'basic',
      status: 'active',
    }).select().single();
    if (error) fail(error);
    return toCamel<User>(created);
  },

  update: async (id: string, data: Partial<{ displayName: string; role: 'partner' | 'admin' | 'basic'; isActive: boolean; email: string }>): Promise<User> => {
    const row = toSnake(data);
    if (typeof row.email === 'string') row.email = row.email.toLowerCase();
    const { data: updated, error } = await db().from('users').update(row).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<User>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('users').delete().eq('id', id);
    if (error) fail(error);
    return { success: true };
  },

  /** Approve a pending signup with a role. */
  approve: async (id: string, role?: 'partner' | 'admin' | 'basic'): Promise<User> => {
    const { data, error } = await db().rpc('approve_user', { p_user_id: id, p_role: role ?? null });
    if (error) fail(error);
    return toCamel<User>(data);
  },

  /** Link a pending signup onto an existing (historical) user row. */
  linkPending: async (pendingId: string, targetId: string, role?: 'partner' | 'admin' | 'basic'): Promise<User> => {
    const { data, error } = await db().rpc('approve_user', {
      p_user_id: pendingId,
      p_link_to: targetId,
      p_role: role ?? null,
    });
    if (error) fail(error);
    return toCamel<User>(data);
  },
};

// --- Reports ---

export interface ClientSummary {
  clientId: string;
  clientName: string;
  totalHours: number;
  totalRevenue: number;
  entryCount: number;
  unbilledCount: number;
  billedCount: number;
  paidCount: number;
}

export interface TechSummary {
  techId: string;
  techName: string;
  totalHours: number;
  totalRevenue: number;
  entryCount: number;
  unbilledCount: number;
  billedCount: number;
  paidCount: number;
}

export interface DateRangeEntry {
  id: string;
  clientId: string;
  techId: string;
  jobTypeId: string;
  rateTierId: string;
  date: string;
  hours: string;
  notes: string | null;
  isBilled: boolean;
  isPaid: boolean;
  clientName: string;
  techName: string;
  jobTypeName: string;
  rate: string;
  total: string;
}

export interface BalanceEntry {
  id: string;
  date: string;
  clientName: string;
  techName: string;
  jobTypeName: string;
  hours: string;
  rate: string;
  total: string;
  notes: string | null;
  isBilled: boolean;
  isPaid: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  rateTierId: string;
  jobTypeId: string;
}

export interface PartnerSettlementReport {
  id: string;
  name: string;
  earnedAsTech: string;
  earnedAsHolder: string;
  totalEarned: string;
  totalPaid: string;
  balance: string;
}

export interface PartnerBreakdownReport {
  id: string;
  name: string;
  paidEarnedAsTech: string;
  paidEarnedAsHolder: string;
  paidTotal: string;
  paidHours: string;
  unpaidEarnedAsTech: string;
  unpaidEarnedAsHolder: string;
  unpaidTotal: string;
  unpaidHours: string;
  totalPaidOut: string;
  balance: string;
}

export interface AgedReceivablesReport {
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    dateIssued: string;
    clientName: string;
    balance: string;
    daysOld: number;
    bucket: string;
  }>;
  summary: Array<{
    name: string;
    current: string;
    thirtyToSixty: string;
    sixtyToNinety: string;
    ninetyPlus: string;
    total: string;
  }>;
}

export interface WipReport {
  entries: Array<{
    id: string;
    date: string;
    hours: string;
    clientName: string;
    techName: string;
    rate: string;
    revenue: string;
    daysOld: number;
  }>;
  summary: Array<{
    id: string;
    name: string;
    totalHours: string;
    totalRevenue: string;
    staleHours: string;
    staleRevenue: string;
    oldestEntryDate: string;
  }>;
}

export interface EffectiveRateReport {
  clientId: string;
  clientName: string;
  totalHours: string;
  totalRevenue: string;
  effectiveRate: string;
}

export interface TechUtilizationReport {
  techId: string;
  techName: string;
  totalHours: string;
  billableHours: string;
  utilization: string;
  totalRevenue: string;
  firmYield: string;
}

export interface AnnualRevenueReport {
  year: string;
  clients: Array<{
    clientId: string;
    clientName: string;
    totalHours: string;
    totalRevenue: string;
    billedRevenue: string;
    collectedRevenue: string;
    outstandingRevenue: string;
    q1: string;
    q2: string;
    q3: string;
    q4: string;
  }>;
  totals: {
    totalHours: string;
    totalRevenue: string;
    billedRevenue: string;
    collectedRevenue: string;
    outstandingRevenue: string;
    q1: string;
    q2: string;
    q3: string;
    q4: string;
  };
}

export interface PartnerEarningsReport {
  year: string;
  partners: Array<{
    id: string;
    name: string;
    earnedAsTech: string;
    earnedAsHolder: string;
    totalEarned: string;
    totalPaid: string;
    balance: string;
  }>;
  splitConfig: {
    techPercent: number;
    holderPercent: number;
  };
}

export interface PaymentsLedgerReport {
  year: string;
  clients: Array<{
    clientId: string;
    clientName: string;
    clientTotal: string;
    months: Array<{
      month: number;
      monthName: string;
      subtotal: string;
      payments: Array<{
        id: string;
        datePaid: string;
        invoiceNumber: string;
        amount: string;
        method: string | null;
        notes: string | null;
      }>;
    }>;
  }>;
  grandTotal: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const reports = {
  clientSummary: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<ClientSummary[]>('report_client_summary', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),

  techSummary: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<TechSummary[]>('report_tech_summary', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),

  partnerSettlement: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<PartnerSettlementReport[]>('report_partner_settlement', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),

  partnerBreakdown: (filters?: { dateFrom?: string; dateTo?: string; clientId?: string }) =>
    rpc<PartnerBreakdownReport[]>('report_partner_breakdown', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
      p_client_id: filters?.clientId || null,
    }),

  agedReceivables: () => rpc<AgedReceivablesReport>('report_aged_receivables'),

  wip: () => rpc<WipReport>('report_wip'),

  effectiveRate: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<EffectiveRateReport[]>('report_effective_rate', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),

  techUtilization: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<TechUtilizationReport[]>('report_tech_utilization', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),

  dateRange: async (filters?: { dateFrom?: string; dateTo?: string; clientId?: string }): Promise<DateRangeEntry[]> => {
    let q = db().from('time_entries')
      .select('*, client:clients(name), tech:users(display_name), jobType:job_types(name), rateTier:rate_tiers(amount)')
      .order('date', { ascending: false });
    if (filters?.dateFrom) q = q.gte('date', filters.dateFrom);
    if (filters?.dateTo) q = q.lte('date', filters.dateTo);
    if (filters?.clientId) q = q.eq('client_id', filters.clientId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []).map((row) => {
      const { client, tech, jobType, rateTier, ...rest } = row as Record<string, any>;
      const entry = toCamel<Record<string, any>>(rest);
      const rate = rateTier?.amount ?? 0;
      return {
        ...entry,
        clientName: client?.name ?? '',
        techName: tech?.display_name ?? '',
        jobTypeName: jobType?.name ?? '',
        rate: String(rate),
        total: (Number(entry.hours) * Number(rate)).toFixed(2),
      } as DateRangeEntry;
    });
  },

  /** Download the time-entries CSV (replaces the legacy /reports/export URL). */
  exportCsv: async (filters?: { dateFrom?: string; dateTo?: string; clientId?: string }): Promise<void> => {
    const entries = await reports.dateRange(filters);
    const headers = ['Date', 'Client', 'Tech', 'Job Type', 'Hours', 'Rate', 'Total', 'Notes', 'Billed', 'Paid'];
    const rows = entries.map((e) => [
      e.date, e.clientName, e.techName, e.jobTypeName, e.hours, e.rate, e.total,
      (e.notes || '').replace(/,/g, ';'), e.isBilled ? 'Yes' : 'No', e.isPaid ? 'Yes' : 'No',
    ].map(csvEscape).join(','));
    downloadFile([headers.join(','), ...rows].join('\n'),
      `time-report-${filters?.dateFrom || 'all'}-${filters?.dateTo || 'all'}.csv`);
  },

  balance: (clientId: string, filter?: 'all' | 'unbilled' | 'unpaid' | 'paid') =>
    rpc<BalanceEntry[]>('report_balance', { p_client_id: clientId, p_filter: filter || 'all' }),

  markPaid: async (invoiceId: string): Promise<{ success: boolean }> => {
    await rpc('mark_invoice_paid', { p_invoice_id: invoiceId });
    return { success: true };
  },

  annualRevenue: (year?: number) =>
    rpc<AnnualRevenueReport>('report_annual_revenue', year ? { p_year: year } : {}),

  partnerEarnings: (year?: number) =>
    rpc<PartnerEarningsReport>('report_partner_earnings', year ? { p_year: year } : {}),

  paymentsLedger: (year?: number) =>
    rpc<PaymentsLedgerReport>('report_payments_ledger', year ? { p_year: year } : {}),

  /** Download a tax CSV built from the corresponding report RPC. */
  taxExportCsv: async (year: number, type: 'annual-revenue' | 'partner-earnings' | 'payments-ledger'): Promise<void> => {
    if (type === 'annual-revenue') {
      const data = await reports.annualRevenue(year);
      const headers = ['Client', 'Total Hours', 'Total Revenue', 'Billed Amount', 'Collected Amount', 'Outstanding', 'Q1 Revenue', 'Q2 Revenue', 'Q3 Revenue', 'Q4 Revenue'];
      const rows = data.clients.map((r) => [r.clientName, r.totalHours, r.totalRevenue, r.billedRevenue, r.collectedRevenue, r.outstandingRevenue, r.q1, r.q2, r.q3, r.q4]);
      const t = data.totals;
      rows.push(['TOTAL', t.totalHours, t.totalRevenue, t.billedRevenue, t.collectedRevenue, t.outstandingRevenue, t.q1, t.q2, t.q3, t.q4]);
      downloadFile([headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n'), `annual-revenue-${year}.csv`);
    } else if (type === 'partner-earnings') {
      const data = await reports.partnerEarnings(year);
      const headers = ['Partner Name', 'Earned as Tech', 'Earned as Account Holder', 'Total Earned', 'Total Paid', 'Balance'];
      const rows = data.partners.map((r) => [r.name, r.earnedAsTech, r.earnedAsHolder, r.totalEarned, r.totalPaid, r.balance]);
      downloadFile([headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n'), `partner-earnings-${year}.csv`);
    } else {
      const data = await reports.paymentsLedger(year);
      const headers = ['Date', 'Client', 'Invoice #', 'Amount', 'Payment Method'];
      const rows: string[][] = [];
      for (const client of data.clients) {
        for (const month of client.months) {
          for (const payment of month.payments) {
            rows.push([payment.datePaid, client.clientName, payment.invoiceNumber || '', payment.amount, payment.method || '']);
          }
        }
      }
      rows.push(['', '', '', data.grandTotal, 'TOTAL']);
      downloadFile([headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n'), `payments-ledger-${year}.csv`);
    }
  },
};

// --- Partner ---

export interface SplitConfig {
  techPercent: number;
  holderPercent: number;
}

export interface PartnerSettlement {
  id: string;
  fromPartnerId: string;
  toPartnerId: string;
  amount: string;
  datePaid: string;
  notes: string | null;
  createdAt: string;
}

export interface PartnerSummaryItem {
  partnerId: string;
  partnerName: string;
  splitPercent: number;
  expectedShare: number;
  paidOut: number;
  paidIn: number;
  balance: number;
}

export interface PartnerSummaryResponse {
  totalRevenue: number;
  splitConfig: SplitConfig;
  period: { dateFrom: string | null; dateTo: string | null };
  partners: PartnerSummaryItem[];
}

export const partner = {
  getSplits: async (): Promise<SplitConfig> => {
    const { data, error } = await db().from('app_settings').select('key, value')
      .in('key', ['splitTechPercent', 'splitHolderPercent']);
    if (error) fail(error);
    const map = Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
    return {
      techPercent: Number(map.splitTechPercent || '73'),
      holderPercent: Number(map.splitHolderPercent || '27'),
    };
  },

  setSplits: async (data: SplitConfig): Promise<SplitConfig> => {
    if (Math.abs(data.techPercent + data.holderPercent - 100) > 0.01) {
      throw new ApiError('Percentages must sum to 100', 400);
    }
    const { error } = await db().from('app_settings').upsert([
      { key: 'splitTechPercent', value: String(data.techPercent) },
      { key: 'splitHolderPercent', value: String(data.holderPercent) },
    ]);
    if (error) fail(error);
    return data;
  },

  getSettlements: async (): Promise<PartnerSettlement[]> => {
    const { data, error } = await db().from('partner_payments').select('*').order('date_paid', { ascending: false });
    if (error) fail(error);
    return toCamel<PartnerSettlement[]>(data);
  },

  recordSettlement: async (data: { fromPartnerId: string; toPartnerId: string; amount: number; datePaid: string; notes?: string }): Promise<PartnerSettlement> => {
    const { data: created, error } = await db().from('partner_payments')
      .insert(toSnake({ ...data, amount: String(data.amount) })).select().single();
    if (error) fail(error);
    return toCamel<PartnerSettlement>(created);
  },

  getSummary: (filters?: { dateFrom?: string; dateTo?: string }) =>
    rpc<PartnerSummaryResponse>('partner_summary', {
      p_date_from: filters?.dateFrom || null,
      p_date_to: filters?.dateTo || null,
    }),
};

// --- Audit Log ---

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  action: string;
  tableName: string;
  recordId: string | null;
  oldValues: string | null;
  newValues: string | null;
  createdAt: string;
  userName: string | null;
}

export const auditLog = {
  list: async (filters?: { table?: string; userId?: string; limit?: number; offset?: number }): Promise<AuditLogEntry[]> => {
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    let q = db().from('audit_log')
      .select('*, user:users(display_name)')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (filters?.table) q = q.eq('table_name', filters.table);
    if (filters?.userId) q = q.eq('user_id', filters.userId);
    const { data, error } = await q;
    if (error) fail(error);
    return (data ?? []).map((row) => {
      const { user, ...rest } = row as { user: { display_name: string } | null } & Record<string, unknown>;
      return { ...toCamel<AuditLogEntry>(rest), userName: user?.display_name ?? null };
    });
  },
};

// --- Settings ---

export const settings = {
  get: async (): Promise<Record<string, string>> => {
    const { data, error } = await db().from('app_settings').select('key, value');
    if (error) fail(error);
    return Object.fromEntries((data ?? []).map((s) => [s.key, s.value]));
  },

  update: async (data: Record<string, string>): Promise<{ success: boolean }> => {
    const rows = Object.entries(data).map(([key, value]) => ({ key, value }));
    const { error } = await db().from('app_settings').upsert(rows);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Projects ---

export type ProjectStatus = 'in_progress' | 'waiting_on_client' | 'need_to_reach_out' | 'needs_call' | 'on_hold' | 'completed';

export interface Project {
  id: string;
  clientId: string;
  name: string;
  status: ProjectStatus;
  assignedTo: string | null;
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  client?: Client;
}

export const projects = {
  list: async (): Promise<Project[]> => {
    const { data, error } = await db().from('projects')
      .select('*, client:clients(*)').order('created_at', { ascending: false });
    if (error) fail(error);
    return toCamel<Project[]>(data);
  },

  create: async (data: { clientId: string; name: string; status?: ProjectStatus; assignedTo?: string; note?: string }): Promise<Project> => {
    const { data: created, error } = await db().from('projects').insert(toSnake(data)).select().single();
    if (error) fail(error);
    return toCamel<Project>(created);
  },

  update: async (id: string, data: Partial<{ name: string; status: ProjectStatus; assignedTo: string | null; note: string | null; isActive: boolean; clientId: string }>): Promise<Project> => {
    const { data: updated, error } = await db().from('projects').update(toSnake(data)).eq('id', id).select().single();
    if (error) fail(error);
    return toCamel<Project>(updated);
  },

  delete: async (id: string): Promise<{ success: boolean }> => {
    const { error } = await db().from('projects').delete().eq('id', id);
    if (error) fail(error);
    return { success: true };
  },
};

// --- Client Chat Logs ---

export interface ClientChatLog {
  id?: string;
  clientId: string;
  content: string;
  updatedAt?: string;
}

export const clientChatLogs = {
  get: async (clientId: string): Promise<ClientChatLog> => {
    const { data, error } = await db().from('client_chat_logs')
      .select('*').eq('client_id', clientId).maybeSingle();
    if (error) fail(error);
    return data ? toCamel<ClientChatLog>(data) : { clientId, content: '' };
  },

  save: async (clientId: string, content: string): Promise<ClientChatLog> => {
    const { data, error } = await db().from('client_chat_logs')
      .upsert({ client_id: clientId, content }, { onConflict: 'client_id' })
      .select().single();
    if (error) fail(error);
    return toCamel<ClientChatLog>(data);
  },
};
