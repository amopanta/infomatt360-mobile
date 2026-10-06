/**
 * Cliente HTTP centralizado para la API de InfoMatt360.
 *
 * - Inyecta Authorization header con el access_token guardado.
 * - Maneja refresh automatico cuando el token expira (401).
 * - Envia X-Project-Id con el proyecto activo.
 */

import axios, {
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import { ENV } from '../config/env';
import { useAuthStore } from '../store/authStore';

const api = axios.create({
  baseURL: ENV.API_BASE_URL,
  timeout: ENV.REQUEST_TIMEOUT,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: inyectar token y proyecto ───────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken, activeProjectId } = useAuthStore.getState();

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  if (activeProjectId) {
    config.headers['X-Project-Id'] = String(activeProjectId);
  }

  return config;
});

// ── Response interceptor: refresh token en 401 ──────────────────────

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config;
    if (!original || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // Evitar bucle infinito si ya era un intento de refresh
    if ((original as any)._retried) {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }

    // Un solo refresh concurrente
    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    try {
      const newToken = await refreshPromise;
      (original as any)._retried = true;
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch {
      useAuthStore.getState().logout();
      return Promise.reject(error);
    }
  },
);

async function performRefresh(): Promise<string> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) throw new Error('No refresh token');

  const res = await axios.post(`${ENV.API_BASE_URL}/auth/refresh`, {
    refresh_token: refreshToken,
  });

  const { access_token, refresh_token } = res.data;
  useAuthStore.getState().setTokens(access_token, refresh_token);
  return access_token;
}

export default api;
