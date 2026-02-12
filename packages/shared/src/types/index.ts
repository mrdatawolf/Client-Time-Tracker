// API request/response types shared between frontend and backend

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserResponse;
}

export interface UserResponse {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'basic';
  isActive: boolean;
}

export interface ClientResponse {
  id: string;
  name: string;
  accountHolder: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface JobTypeResponse {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface RateTierResponse {
  id: string;
  amount: string;
  label: string | null;
  isActive: boolean;
}

export interface TimeEntryResponse {
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
  // Joined fields (populated when requested)
  client?: ClientResponse;
  tech?: UserResponse;
  jobType?: JobTypeResponse;
  rateTier?: RateTierResponse;
  total?: string; // computed: hours * rate
}

export interface CreateTimeEntryRequest {
  clientId: string;
  techId?: string; // defaults to current user
  jobTypeId: string;
  rateTierId: string;
  date: string;
  hours: string;
  notes?: string;
  groupId?: string;
}

export interface InvoiceResponse {
  id: string;
  clientId: string;
  invoiceNumber: string;
  dateIssued: string;
  dateDue: string | null;
  status: string;
  notes: string | null;
  client?: ClientResponse;
  lineItems?: InvoiceLineItemResponse[];
  payments?: PaymentResponse[];
  total?: string; // computed from line items
}

export interface InvoiceLineItemResponse {
  id: string;
  invoiceId: string;
  timeEntryId: string | null;
  description: string;
  hours: string;
  rate: string;
  amount?: string; // computed: hours * rate
}

export interface PaymentResponse {
  id: string;
  invoiceId: string;
  amount: string;
  datePaid: string;
  method: string | null;
  notes: string | null;
}

export interface PartnerSplitResponse {
  id: string;
  partnerId: string;
  splitPercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  partner?: UserResponse;
}

export interface PartnerPaymentResponse {
  id: string;
  fromPartnerId: string;
  toPartnerId: string;
  amount: string;
  datePaid: string;
  notes: string | null;
}

export interface AuditLogResponse {
  id: string;
  userId: string | null;
  action: string;
  tableName: string;
  recordId: string | null;
  oldValues: string | null;
  newValues: string | null;
  createdAt: string;
  user?: UserResponse;
}
