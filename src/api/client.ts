/**
 * Cliente HTTP centralizado para la API de InfoMatt360.
 *
 * - Usa la URL del servidor configurada por el usuario (serverStore).
 * - Inyecta Authorization header con el access_token guardado.
 * - Maneja refresh automatico cuando el token expira (401).
 */

import axios, {
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import { ENV } from '../config/env';
import { useAuthStore } from '../store/authStore';
import { useServerStore } from '../store/serverStore';

const api = axios.create({
  baseURL: ENV.API_BASE_URL,
  timeout: ENV.REQUEST_TIMEOUT,
  // El backend solo entrega el refresh token en el cuerpo a clientes
  // nativos (sin Origin); la web lo recibe en una cookie httponly.
  headers: { 'Content-Type': 'application/json', 'X-Client-Platform': 'native' },
});

/**
 * Actualizar el baseURL del cliente axios.
 * Se llama cuando el usuario cambia la URL del servidor.
 */
export function updateApiBaseUrl(url: string): void {
  api.defaults.baseURL = url;
}

// ── Request interceptor: inyectar token y proyecto ───────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = useAuthStore.getState();

  // Usar siempre la URL mas reciente del serverStore
  const effectiveUrl = useServerStore.getState().getEffectiveUrl();
  if (effectiveUrl !== api.defaults.baseURL) {
    api.defaults.baseURL = effectiveUrl;
    config.baseURL = effectiveUrl;
  }

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
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

  const baseUrl = useServerStore.getState().getEffectiveUrl();
  const res = await axios.post(
    `${baseUrl}/auth/refresh`,
    { refresh_token: refreshToken },
    { headers: { 'X-Client-Platform': 'native' } },
  );

  const { access_token, refresh_token } = res.data;
  useAuthStore.getState().setTokens(access_token, refresh_token);
  return access_token;
}

export default api;
