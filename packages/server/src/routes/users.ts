import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { users } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/jwt';
import { requireAdmin, getUserRole } from '../middleware/auth';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// All user management routes require admin
route.use('*', requireAdmin());

// GET / - List all users
route.get('/', async (c) => {
  const db = await getDb();
  const allUsers = await db.query.users.findMany({
    columns: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
  return c.json(allUsers);
});

// POST / - Create a new user
route.post('/', async (c) => {
  const db = await getDb();
  const callerRole = getUserRole(c);
  const body = await c.req.json();
  const { username, displayName, password, role } = body;

  if (!username || !displayName || !password) {
    return c.json({ error: 'Username, display name, and password are required' }, 400);
  }

  if (role === 'partner' && callerRole !== 'partner') {
    return c.json({ error: 'Only partners can create partner-role users' }, 403);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existing) {
    return c.json({ error: 'Username already exists' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({
    username,
    displayName,
    passwordHash,
    role: role || 'basic',
  }).returning();

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
  }, 201);
});

// GET /:id - Get a specific user
route.get('/:id', async (c) => {
  const db = await getDb();
  const id = c.req.param('id');

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(user);
});

// PUT /:id - Update a user
route.put('/:id', async (c) => {
  const db = await getDb();
  const callerRole = getUserRole(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const { displayName, role, isActive, password } = body;

  // Fetch target user to check their current role
  const targetUser = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Admins cannot modify partner-role users
  if (targetUser.role === 'partner' && callerRole !== 'partner') {
    return c.json({ error: 'Only partners can modify partner-role users' }, 403);
  }

  // Admins cannot assign partner role
  if (role === 'partner' && callerRole !== 'partner') {
    return c.json({ error: 'Only partners can assign partner role' }, 403);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName !== undefined) updateData.displayName = displayName;
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (password) updateData.passwordHash = await hashPassword(password);

  const [updated] = await db.update(users)
    .set(updateData)
    .where(eq(users.id, id))
    .returning();

  return c.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role,
    isActive: updated.isActive,
  });
});

// DELETE /:id - Deactivate a user (soft delete)
route.delete('/:id', async (c) => {
  const db = await getDb();
  const callerRole = getUserRole(c);
  const id = c.req.param('id');

  // Fetch target user to check their role
  const targetUser = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Admins cannot deactivate partner-role users
  if (targetUser.role === 'partner' && callerRole !== 'partner') {
    return c.json({ error: 'Only partners can deactivate partner-role users' }, 403);
  }

  const [updated] = await db.update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  return c.json({ success: true });
});

export default route;
