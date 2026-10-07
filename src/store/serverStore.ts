/**
 * Store de configuracion del servidor API (Zustand).
 *
 * Permite que cada despliegue/cliente configure la URL de su servidor.
 * La URL se persiste en SecureStore para que sobreviva reinicios.
 *
 * Flujo:
 *   1. Al abrir la app, hydrate() carga la URL guardada
 *   2. Si no hay URL guardada, usa el default de ENV
 *   3. El usuario puede cambiar la URL desde Login o Settings
 *   4. Al cambiar, se actualiza el baseURL del cliente axios
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { ENV } from '../config/env';

const STORE_KEY = 'api_server_url';

interface ServerState {
  /** URL configurada por el usuario (null = usar default) */
  customUrl: string | null;
  /** true cuando ya se leyo SecureStore */
  hydrated: boolean;

  /** URL efectiva que se usa para las peticiones */
  getEffectiveUrl: () => string;

  /** Guardar una URL personalizada */
  setServerUrl: (url: string) => void;

  /** Volver al servidor por defecto */
  resetToDefault: () => void;

  /** Cargar URL guardada desde SecureStore */
  hydrate: () => Promise<void>;
}

/** Normaliza la URL: quita barra final, agrega /api/v1 si no lo tiene */
function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');

  // Si el usuario solo puso el dominio, agregar /api/v1
  if (!url.includes('/api/')) {
    url = `${url}/api/v1`;
  }

  return url;
}

export const useServerStore = create<ServerState>((set, get) => ({
  customUrl: null,
  hydrated: false,

  getEffectiveUrl: () => {
    const { customUrl } = get();
    return customUrl ?? ENV.API_BASE_URL;
  },

  setServerUrl: (url: string) => {
    const normalized = normalizeUrl(url);
    set({ customUrl: normalized });
    SecureStore.setItemAsync(STORE_KEY, normalized).catch(() => {});
  },

  resetToDefault: () => {
    set({ customUrl: null });
    SecureStore.deleteItemAsync(STORE_KEY).catch(() => {});
  },

  hydrate: async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORE_KEY);
      if (stored) {
        set({ customUrl: stored, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },
}));
