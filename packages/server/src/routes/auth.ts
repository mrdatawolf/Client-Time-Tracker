import { Hono } from 'hono';
import { getDb } from '@ctt/shared/db';
import { users } from '@ctt/shared/schema';
import { eq } from 'drizzle-orm';
import { createToken, comparePassword, hashPassword } from '../lib/jwt';
import { requireAuth, getUserId } from '../middleware/auth';
import type { AppEnv } from '../types';

const route = new Hono<AppEnv>();

// POST /login - Public: authenticate and return JWT
route.post('/login', async (c) => {
  const body = await c.req.json();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ error: 'Username and password are required' }, 400);
  }

  const db = await getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.username, username.trim().toLowerCase()),
  });

  if (!user || !user.isActive) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = createToken({ userId: user.id, role: user.role });

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      theme: user.theme,
      isActive: user.isActive,
    },
  });
});

// GET /me - Get current user info
route.get('/me', requireAuth(), async (c) => {
  const userId = getUserId(c);
  const db = await getDb();

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    theme: user.theme,
    isActive: user.isActive,
  });
});

// POST /preferences - Update own preferences (theme, etc.)
route.post('/preferences', requireAuth(), async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();
  const { theme } = body;

  if (theme && !['light', 'dark', 'system'].includes(theme)) {
    return c.json({ error: 'Invalid theme. Must be light, dark, or system.' }, 400);
  }

  const db = await getDb();
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (theme) updateData.theme = theme;

  const [updated] = await db.update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning();

  return c.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    role: updated.role,
    theme: updated.theme,
    isActive: updated.isActive,
  });
});

// POST /change-password - Change own password
route.post('/change-password', requireAuth(), async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return c.json({ error: 'Current password and new password are required' }, 400);
  }

  if (newPassword.length < 4) {
    return c.json({ error: 'New password must be at least 4 characters' }, 400);
  }

  const db = await getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hashPassword(newPassword);
  await db.update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return c.json({ success: true });
});

// GET /setup-status - Public: check if initial setup is needed
route.get('/setup-status', async (c) => {
  const db = await getDb();
  const userCount = await db.select({ id: users.id }).from(users).limit(1);
  return c.json({ needsSetup: userCount.length === 0 });
});

// POST /setup - Public: create the first admin user (only when no users exist)
route.post('/setup', async (c) => {
  const db = await getDb();

  // Only allow setup when no users exist
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'Setup already completed. Please log in.' }, 403);
  }

  const body = await c.req.json();
  const { username, displayName, password } = body;

  if (!username || !displayName || !password) {
    return c.json({ error: 'Username, display name, and password are required' }, 400);
  }

  if (password.length < 4) {
    return c.json({ error: 'Password must be at least 4 characters' }, 400);
  }

  const passwordHash = await hashPassword(password);
  const [newUser] = await db.insert(users).values({
    username: username.trim().toLowerCase(),
    displayName: displayName.trim(),
    passwordHash,
    role: 'partner',
  }).returning();

  const token = createToken({ userId: newUser.id, role: newUser.role });

  return c.json({
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      role: newUser.role,
      theme: newUser.theme,
      isActive: newUser.isActive,
    },
  });
});

export default route;
