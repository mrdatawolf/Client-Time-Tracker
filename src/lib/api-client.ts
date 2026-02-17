const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3701';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function apiClient<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ctt_token') : null;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));

    // If the server says unauthorized, the token is invalid/expired — force re-login
    // Skip redirect if already on the login page (e.g. setup-status check)
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      localStorage.removeItem('ctt_token');
      localStorage.removeItem('ctt_user');
      window.location.href = '/login';
    }

    throw new ApiError(body.error || body.message || res.statusText, res.status);
  }

  return res.json();
}

// Auth helpers
export function setToken(token: string) {
  localStorage.setItem('ctt_token', token);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ctt_token');
}

export function clearToken() {
  localStorage.removeItem('ctt_token');
  localStorage.removeItem('ctt_user');
}

export function setUser(user: { id: string; username: string; displayName: string; role: string }) {
  localStorage.setItem('ctt_user', JSON.stringify(user));
}

export function getUser(): { id: string; username: string; displayName: string; role: string } | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('ctt_user');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function isAdmin(): boolean {
  const user = getUser();
  return user?.role === 'admin';
}

export { ApiError };
