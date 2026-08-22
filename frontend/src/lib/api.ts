import axios from 'axios';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor: adjuntar token JWT
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('crm_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Interceptor: redirigir al login si el token expira
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('crm_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

// ---- Auth ----
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/auth/change-password', { currentPassword, newPassword }),
};

// ---- Dashboard ----
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
};

// ---- Contacts ----
export const contactsApi = {
  getAll: (params?: { search?: string; status?: string }) =>
    api.get('/contacts', { params }),
  getOne: (id: string) => api.get(`/contacts/${id}`),
  create: (data: any) => api.post('/contacts', data),
  update: (id: string, data: any) => api.patch(`/contacts/${id}`, data),
  delete: (id: string) => api.delete(`/contacts/${id}`),
};

// ---- Simulacros ----
export const simulacrosApi = {
  getAll: () => api.get('/simulacros'),
  getActive: () => api.get('/simulacros/active'),
  getOne: (id: string) => api.get(`/simulacros/${id}`),
  create: (data: any) => api.post('/simulacros', data),
  update: (id: string, data: any) => api.patch(`/simulacros/${id}`, data),
  delete: (id: string) => api.delete(`/simulacros/${id}`),
  uploadFlyer: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/simulacros/${id}/upload-flyer`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ---- Conversations ----
export const conversationsApi = {
  getAll: () => api.get('/conversations'),
  getOne: (id: string) => api.get(`/conversations/${id}`),
  pauseAll: () => api.post('/conversations/pause-all'),
  getMessages: (id: string) => api.get(`/conversations/${id}/messages`),
  toggleAgent: (id: string, paused: boolean) =>
    api.patch(`/conversations/${id}/toggle-agent`, { paused }),
  markAsRead: (id: string) => api.post(`/conversations/${id}/mark-read`),
};

// ---- Settings ----
export const settingsApi = {
  getAll: () => api.get('/settings'),
  update: (data: Record<string, string>) => api.patch('/settings', data),
  clearTestData: (phone: string) => api.delete(`/settings/clear-test-data?phone=${encodeURIComponent(phone)}`),
  clearTestPhones: () => api.delete('/settings/clear-test-phones'),
  uploadFlyer: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/settings/upload-flyer', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadPromoFlyer: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/settings/upload-promo-flyer', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// SSE URL
export const SSE_URL = `${API_BASE}/api/sse/events`;
