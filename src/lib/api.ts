/**
 * Typed API functions for all endpoints.
 */
import { apiClient } from './api-client';

// --- Types ---

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'basic';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  accountHolder: string | null;
  phone: string | null;
  mailingAddress: string | null;
  isActive: boolean;
  notes: string | null;
  defaultHourlyRate: string | null;
  createdAt: string;
  updatedAt: string;
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
  client?: Client;
  tech?: Pick<User, 'id' | 'username' | 'displayName' | 'role' | 'isActive'>;
  jobType?: JobType;
  rateTier?: RateTier;
}

// --- Auth ---

export const auth = {
  login: (username: string, password: string) =>
    apiClient<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => apiClient<User>('/api/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// --- Clients ---

export const clients = {
  list: () => apiClient<Client[]>('/api/clients'),

  get: (id: string) => apiClient<Client>(`/api/clients/${id}`),

  create: (data: { name: string; accountHolder?: string; phone?: string; mailingAddress?: string; notes?: string; defaultHourlyRate?: string }) =>
    apiClient<Client>('/api/clients', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ name: string; accountHolder: string; phone: string; mailingAddress: string; isActive: boolean; notes: string; defaultHourlyRate: string | null }>) =>
    apiClient<Client>(`/api/clients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/clients/${id}`, { method: 'DELETE' }),
};

// --- Job Types ---

export const jobTypes = {
  list: () => apiClient<JobType[]>('/api/job-types'),

  create: (data: { name: string; description?: string }) =>
    apiClient<JobType>('/api/job-types', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ name: string; description: string; isActive: boolean }>) =>
    apiClient<JobType>(`/api/job-types/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/job-types/${id}`, { method: 'DELETE' }),
};

// --- Rate Tiers ---

export const rateTiers = {
  list: () => apiClient<RateTier[]>('/api/rate-tiers'),

  create: (data: { amount: string; label?: string }) =>
    apiClient<RateTier>('/api/rate-tiers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ amount: string; label: string; isActive: boolean }>) =>
    apiClient<RateTier>(`/api/rate-tiers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/rate-tiers/${id}`, { method: 'DELETE' }),
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

export const timeEntries = {
  list: (filters?: TimeEntryFilters) => {
    const params = new URLSearchParams();
    if (filters?.clientId) params.set('clientId', filters.clientId);
    if (filters?.techId) params.set('techId', filters.techId);
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.isBilled !== undefined) params.set('isBilled', String(filters.isBilled));
    const qs = params.toString();
    return apiClient<TimeEntry[]>(`/api/time-entries${qs ? `?${qs}` : ''}`);
  },

  grid: (clientId: string, dateFrom: string, dateTo: string) =>
    apiClient<TimeEntry[]>(`/api/time-entries/grid?clientId=${clientId}&dateFrom=${dateFrom}&dateTo=${dateTo}`),

  get: (id: string) => apiClient<TimeEntry>(`/api/time-entries/${id}`),

  create: (data: CreateTimeEntry) =>
    apiClient<TimeEntry>('/api/time-entries', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  bulkCreate: (entries: CreateTimeEntry[]) =>
    apiClient<TimeEntry[]>('/api/time-entries/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),

  update: (id: string, data: Partial<CreateTimeEntry & { isBilled: boolean; isPaid: boolean }>) =>
    apiClient<TimeEntry>(`/api/time-entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  bulkUpdate: (ids: string[], updates: { isBilled?: boolean; isPaid?: boolean }) =>
    apiClient<TimeEntry[]>('/api/time-entries/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids, updates }),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/time-entries/${id}`, { method: 'DELETE' }),
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

export interface GenerateInvoiceRequest {
  clientId: string;
  dateFrom: string;
  dateTo: string;
  dateDue?: string;
  notes?: string;
}

export const invoices = {
  list: (filters?: { clientId?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (filters?.clientId) params.set('clientId', filters.clientId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString();
    return apiClient<Invoice[]>(`/api/invoices${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => apiClient<Invoice>(`/api/invoices/${id}`),

  create: (data: { clientId: string; invoiceNumber: string; dateIssued: string; dateDue?: string; notes?: string }) =>
    apiClient<Invoice>('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  generate: (data: GenerateInvoiceRequest) =>
    apiClient<Invoice>('/api/invoices/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ invoiceNumber: string; dateIssued: string; dateDue: string; status: string; notes: string }>) =>
    apiClient<Invoice>(`/api/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/invoices/${id}`, { method: 'DELETE' }),

  updateLineItem: (invoiceId: string, lineId: string, data: Partial<{ description: string; hours: string; rate: string }>) =>
    apiClient<InvoiceLineItem>(`/api/invoices/${invoiceId}/line-items/${lineId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  addLineItem: (invoiceId: string, data: { description: string; hours: string; rate: string }) =>
    apiClient<InvoiceLineItem>(`/api/invoices/${invoiceId}/line-items`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteLineItem: (invoiceId: string, lineId: string) =>
    apiClient<{ success: boolean }>(`/api/invoices/${invoiceId}/line-items/${lineId}`, { method: 'DELETE' }),

  downloadPdf: async (id: string) => {
    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3701';
    const token = typeof window !== 'undefined' ? localStorage.getItem('ctt_token') : null;
    const res = await fetch(`${API_BASE}/api/invoices/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to download PDF');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `invoice-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// --- Payments ---

export const payments = {
  list: (invoiceId?: string) => {
    const qs = invoiceId ? `?invoiceId=${invoiceId}` : '';
    return apiClient<Payment[]>(`/api/payments${qs}`);
  },

  get: (id: string) => apiClient<Payment>(`/api/payments/${id}`),

  create: (data: { invoiceId: string; amount: number; datePaid: string; method?: string; notes?: string }) =>
    apiClient<Payment>('/api/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ amount: number; datePaid: string; method: string; notes: string }>) =>
    apiClient<Payment>(`/api/payments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/payments/${id}`, { method: 'DELETE' }),
};

// --- Users (admin) ---

export const users = {
  list: () => apiClient<User[]>('/api/users'),

  get: (id: string) => apiClient<User>(`/api/users/${id}`),

  create: (data: { username: string; displayName: string; password: string; role?: 'admin' | 'basic' }) =>
    apiClient<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ displayName: string; role: 'admin' | 'basic'; isActive: boolean }>) =>
    apiClient<User>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
};

// --- Reports ---

export interface ClientSummary {
  clientId: string;
  clientName: string;
  totalHours: number;
  totalRevenue: number;
  entryCount: number;
}

export interface TechSummary {
  techId: string;
  techName: string;
  totalHours: number;
  totalRevenue: number;
  entryCount: number;
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

export const reports = {
  clientSummary: (filters?: { dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    const qs = params.toString();
    return apiClient<ClientSummary[]>(`/api/reports/client-summary${qs ? `?${qs}` : ''}`);
  },

  techSummary: (filters?: { dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    const qs = params.toString();
    return apiClient<TechSummary[]>(`/api/reports/tech-summary${qs ? `?${qs}` : ''}`);
  },

  dateRange: (filters?: { dateFrom?: string; dateTo?: string; clientId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.clientId) params.set('clientId', filters.clientId);
    const qs = params.toString();
    return apiClient<DateRangeEntry[]>(`/api/reports/date-range${qs ? `?${qs}` : ''}`);
  },

  exportUrl: (filters?: { dateFrom?: string; dateTo?: string; clientId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.clientId) params.set('clientId', filters.clientId);
    const token = typeof window !== 'undefined' ? localStorage.getItem('ctt_token') : '';
    if (token) params.set('token', token);
    const qs = params.toString();
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3701';
    return `${base}/api/reports/export${qs ? `?${qs}` : ''}`;
  },
};

// --- Partner ---

export interface PartnerSplit {
  id: string;
  partnerId: string;
  splitPercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  partnerName: string;
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
  period: { dateFrom: string | null; dateTo: string | null };
  partners: PartnerSummaryItem[];
}

export const partner = {
  getSplits: () => apiClient<PartnerSplit[]>('/api/partner/splits'),

  setSplits: (data: { splits: { partnerId: string; splitPercent: number }[]; effectiveFrom: string }) =>
    apiClient<PartnerSplit[]>('/api/partner/splits', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSettlements: () => apiClient<PartnerSettlement[]>('/api/partner/settlements'),

  recordSettlement: (data: { fromPartnerId: string; toPartnerId: string; amount: number; datePaid: string; notes?: string }) =>
    apiClient<PartnerSettlement>('/api/partner/settlements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSummary: (filters?: { dateFrom?: string; dateTo?: string }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    const qs = params.toString();
    return apiClient<PartnerSummaryResponse>(`/api/partner/summary${qs ? `?${qs}` : ''}`);
  },
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
  list: (filters?: { table?: string; userId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (filters?.table) params.set('table', filters.table);
    if (filters?.userId) params.set('userId', filters.userId);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return apiClient<AuditLogEntry[]>(`/api/audit-log${qs ? `?${qs}` : ''}`);
  },
};

// --- Settings ---

export const settings = {
  get: () => apiClient<Record<string, string>>('/api/settings'),

  update: (data: Record<string, string>) =>
    apiClient<{ success: boolean }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
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
  list: () => apiClient<Project[]>('/api/projects'),

  create: (data: { clientId: string; name: string; status?: ProjectStatus; assignedTo?: string; note?: string }) =>
    apiClient<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<{ name: string; status: ProjectStatus; assignedTo: string | null; note: string | null; isActive: boolean; clientId: string }>) =>
    apiClient<Project>(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiClient<{ success: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
};

// --- Client Chat Logs ---

export interface ClientChatLog {
  id?: string;
  clientId: string;
  content: string;
  updatedAt?: string;
}

export const clientChatLogs = {
  get: (clientId: string) =>
    apiClient<ClientChatLog>(`/api/client-chat-logs/${clientId}`),

  save: (clientId: string, content: string) =>
    apiClient<ClientChatLog>(`/api/client-chat-logs/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
};

// --- Supabase Sync ---

export interface SupabaseConfig {
  enabled: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  databaseUrl: string;
  lastSyncAt: string | null;
  instanceId: string;
}

export interface SyncStatus {
  enabled: boolean;
  lastSyncAt: string | null;
  instanceId: string;
  pendingCount: number;
  state: 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';
}

export const supabaseSync = {
  getConfig: () =>
    apiClient<SupabaseConfig>('/api/supabase/config'),

  updateConfig: (data: Partial<SupabaseConfig>) =>
    apiClient<{ success: boolean; instanceId: string }>('/api/supabase/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  testConnection: () =>
    apiClient<{ success: boolean; message: string }>('/api/supabase/test-connection', {
      method: 'POST',
    }),

  setupSchema: () =>
    apiClient<{ success: boolean; message: string }>('/api/supabase/setup-schema', {
      method: 'POST',
    }),

  getStatus: () =>
    apiClient<SyncStatus>('/api/supabase/status'),

  sync: () =>
    apiClient<{ success: boolean; message: string }>('/api/supabase/sync', {
      method: 'POST',
    }),

  initialSync: (direction: 'push' | 'pull' | 'merge') =>
    apiClient<{ success: boolean; message: string; stats: { pushed: number; pulled: number } }>('/api/supabase/initial-sync', {
      method: 'POST',
      body: JSON.stringify({ direction }),
    }),
};
