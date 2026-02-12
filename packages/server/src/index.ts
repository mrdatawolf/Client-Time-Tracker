import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requireAuth } from './middleware/auth';
import { auditLogger } from './middleware/audit';
import type { AppEnv } from './types';

// Route imports
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import clientRoutes from './routes/clients';
import jobTypeRoutes from './routes/job-types';
import rateTierRoutes from './routes/rate-tiers';
import timeEntryRoutes from './routes/time-entries';
import invoiceRoutes from './routes/invoices';
import paymentRoutes from './routes/payments';
import partnerRoutes from './routes/partner';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import auditLogRoutes from './routes/audit-log';
import migrateRoutes from './routes/migrate';

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => {
    // Allow any origin for LAN access
    if (origin) return origin;
    return 'http://localhost:3000';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Health check (no auth required)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (login is public, /me and /change-password use their own auth)
app.route('/api/auth', authRoutes);

// Auth middleware for all other /api/* routes
app.use('/api/*', requireAuth());

// Audit logging for write operations (runs after route handlers)
app.use('/api/*', auditLogger());

// Authenticated routes
app.route('/api/users', userRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/job-types', jobTypeRoutes);
app.route('/api/rate-tiers', rateTierRoutes);
app.route('/api/time-entries', timeEntryRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/partner', partnerRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/audit-log', auditLogRoutes);
app.route('/api/migrate', migrateRoutes);

// Start the server
const port = parseInt(process.env.API_PORT || '3001', 10);
const hostname = process.env.API_HOST || '0.0.0.0';

console.log(`Starting Time Tracker API server on ${hostname}:${port}...`);

serve({
  fetch: app.fetch,
  port,
  hostname,
}, (info) => {
  console.log(`Time Tracker API running at http://${hostname}:${info.port}`);
});

export default app;
