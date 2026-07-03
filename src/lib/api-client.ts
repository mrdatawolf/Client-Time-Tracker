/**
 * Session facade over Supabase Auth + the app's users table.
 *
 * The app user (role, status, display name) is cached in localStorage so the
 * existing synchronous helpers (getUser / isAdmin / isPartner) keep working
 * throughout the component tree.
 */
import { getSupabase } from './supabase';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export interface SessionUser {
  id: string;            // app users.id (not the auth user id)
  authUserId: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'partner' | 'admin' | 'basic';
  status: 'pending' | 'active' | 'disabled';
  theme?: 'light' | 'dark' | 'system';
}

const USER_KEY = 'ctt_user';

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setUser(user: SessionUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser(): void {
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return getUser() !== null;
}

export function isAdmin(): boolean {
  const user = getUser();
  return user?.role === 'admin' || user?.role === 'partner';
}

export function isPartner(): boolean {
  return getUser()?.role === 'partner';
}

/**
 * Fetch the app user row for the current Supabase session and cache it.
 * Returns null when there is no session or no matching row (yet).
 */
export async function refreshCurrentUser(): Promise<SessionUser | null> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const authUser = sessionData.session?.user;
  if (!authUser) {
    clearUser();
    return null;
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, email, role, status, theme, auth_user_id')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (error) throw new ApiError(error.message, 500);
  if (!data) {
    clearUser();
    return null;
  }

  const user: SessionUser = {
    id: data.id,
    authUserId: data.auth_user_id,
    username: data.username,
    displayName: data.display_name,
    email: data.email,
    role: data.role,
    status: data.status,
    theme: data.theme,
  };
  setUser(user);
  return user;
}

export async function signOut(): Promise<void> {
  clearUser();
  try {
    await getSupabase().auth.signOut();
  } catch {
    // already signed out / unreachable — local state is cleared either way
  }
}
