'use client';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('crm_token');
}

export function setToken(token: string): void {
  localStorage.setItem('crm_token', token);
}

export function removeToken(): void {
  localStorage.removeItem('crm_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
