import { pgTable, uuid, text, timestamp, boolean, numeric, date, pgEnum } from 'drizzle-orm/pg-core';

// Enums
export const userRoleEnum = pgEnum('user_role', ['admin', 'basic']);

// ============================================================================
// CORE TABLES
// ============================================================================

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('basic'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  accountHolder: text('account_holder'),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const jobTypes = pgTable('job_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const rateTiers = pgTable('rate_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  label: text('label'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// BILLING & INVOICING (declared before time_entries due to FK reference)
// ============================================================================

export const invoices = pgTable('invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  invoiceNumber: text('invoice_number').notNull().unique(),
  dateIssued: date('date_issued').notNull(),
  dateDue: date('date_due'),
  status: text('status').notNull().default('draft'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// TIME ENTRIES
// ============================================================================

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  techId: uuid('tech_id').notNull().references(() => users.id),
  jobTypeId: uuid('job_type_id').notNull().references(() => jobTypes.id),
  rateTierId: uuid('rate_tier_id').notNull().references(() => rateTiers.id),
  date: date('date').notNull(),
  hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
  notes: text('notes'),
  groupId: uuid('group_id'),
  isBilled: boolean('is_billed').notNull().default(false),
  isPaid: boolean('is_paid').notNull().default(false),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  timeEntryId: uuid('time_entry_id').references(() => timeEntries.id),
  description: text('description').notNull(),
  hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
  rate: numeric('rate', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  datePaid: date('date_paid').notNull(),
  method: text('method'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// PARTNER SPLITS & SETTLEMENTS
// ============================================================================

export const partnerSplits = pgTable('partner_splits', {
  id: uuid('id').defaultRandom().primaryKey(),
  partnerId: uuid('partner_id').notNull().references(() => users.id),
  splitPercent: numeric('split_percent', { precision: 5, scale: 4 }).notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const partnerPayments = pgTable('partner_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  fromPartnerId: uuid('from_partner_id').notNull().references(() => users.id),
  toPartnerId: uuid('to_partner_id').notNull().references(() => users.id),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  datePaid: date('date_paid').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// SYSTEM
// ============================================================================

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  tableName: text('table_name').notNull(),
  recordId: uuid('record_id'),
  oldValues: text('old_values'),
  newValues: text('new_values'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
