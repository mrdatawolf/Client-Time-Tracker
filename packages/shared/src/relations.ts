import { relations } from 'drizzle-orm';
import {
  users,
  clients,
  jobTypes,
  rateTiers,
  timeEntries,
  invoices,
  invoiceLineItems,
  payments,
  partnerSplits,
  partnerPayments,
  auditLog,
  projects,
  clientChatLogs,
  autoInvoiceLog,
} from './schema';

export const usersRelations = relations(users, ({ many }) => ({
  timeEntries: many(timeEntries),
  partnerSplits: many(partnerSplits),
  paymentsFrom: many(partnerPayments, { relationName: 'fromPartner' }),
  paymentsTo: many(partnerPayments, { relationName: 'toPartner' }),
}));

export const clientsRelations = relations(clients, ({ many, one }) => ({
  timeEntries: many(timeEntries),
  invoices: many(invoices),
  projects: many(projects),
  chatLog: one(clientChatLogs, { fields: [clients.id], references: [clientChatLogs.clientId] }),
  accountHolderUser: one(users, { fields: [clients.accountHolderId], references: [users.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  client: one(clients, { fields: [timeEntries.clientId], references: [clients.id] }),
  tech: one(users, { fields: [timeEntries.techId], references: [users.id] }),
  jobType: one(jobTypes, { fields: [timeEntries.jobTypeId], references: [jobTypes.id] }),
  rateTier: one(rateTiers, { fields: [timeEntries.rateTierId], references: [rateTiers.id] }),
  invoice: one(invoices, { fields: [timeEntries.invoiceId], references: [invoices.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  lineItems: many(invoiceLineItems),
  payments: many(payments),
  timeEntries: many(timeEntries),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceLineItems.invoiceId], references: [invoices.id] }),
  timeEntry: one(timeEntries, { fields: [invoiceLineItems.timeEntryId], references: [timeEntries.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const partnerSplitsRelations = relations(partnerSplits, ({ one }) => ({
  partner: one(users, { fields: [partnerSplits.partnerId], references: [users.id] }),
}));

export const partnerPaymentsRelations = relations(partnerPayments, ({ one }) => ({
  fromPartner: one(users, { fields: [partnerPayments.fromPartnerId], references: [users.id], relationName: 'fromPartner' }),
  toPartner: one(users, { fields: [partnerPayments.toPartnerId], references: [users.id], relationName: 'toPartner' }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
}));

export const clientChatLogsRelations = relations(clientChatLogs, ({ one }) => ({
  client: one(clients, { fields: [clientChatLogs.clientId], references: [clients.id] }),
}));

export const autoInvoiceLogRelations = relations(autoInvoiceLog, ({ one }) => ({
  client: one(clients, { fields: [autoInvoiceLog.clientId], references: [clients.id] }),
  invoice: one(invoices, { fields: [autoInvoiceLog.invoiceId], references: [invoices.id] }),
}));
