/**
 * Marca de la organización (logo, nombre, colores) para la app.
 *
 * Se configura en la web (Configuración → Marca) y el backend la publica sin
 * sesión en GET /public/branding?slug=..., para mostrarla desde el login.
 * El logo se descarga al teléfono y la marca se guarda en SecureStore, así se
 * ve también sin conexión.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { useServerStore } from './serverStore';

const STORAGE_KEY = 'branding';
const DEFAULT_SLUG = 'default';

export interface Branding {
  slug: string;
  organizationName: string;
  /** Logo descargado en el teléfono (file://...) */
  logoUri: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  slogan: string | null;
}

interface BrandingState {
  branding: Branding | null;
  hydrate: () => Promise<void>;
  /** Consulta la marca en el servidor; sin red conserva la guardada. */
  refresh: (slug?: string) => Promise<void>;
}

type PublicBranding = {
  organization_name: string;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  slogan: string | null;
};

/** El backend arma logo_url con su propia dirección (p. ej. localhost); se
 * conserva la ruta y se usa el servidor que la app tiene configurado. */
export function logoUrlFor(apiBaseUrl: string, logoUrl: string): string {
  const path = logoUrl.replace(/^https?:\/\/[^/]+/i, '');
  const origin = apiBaseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  return `${origin}${path}`;
}

async function persist(branding: Branding): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(branding)).catch(() => {});
}

export const useBrandingStore = create<BrandingState>((set, get) => ({
  branding: null,

  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) set({ branding: JSON.parse(raw) as Branding });
    } catch {
      // Sin marca guardada: se muestra la de InfoMatt360
    }
  },

  refresh: async (slug) => {
    const effectiveSlug = (slug || get().branding?.slug || DEFAULT_SLUG).trim().toLowerCase();
    const apiBase = useServerStore.getState().getEffectiveUrl();
    try {
      const response = await fetch(`${apiBase}/public/branding?slug=${encodeURIComponent(effectiveSlug)}`);
      if (!response.ok) return;
      const data = (await response.json()) as PublicBranding;

      let logoUri: string | null = null;
      if (data.logo_url && FileSystem.documentDirectory) {
        const target = `${FileSystem.documentDirectory}branding_logo`;
        try {
          const downloaded = await FileSystem.downloadAsync(logoUrlFor(apiBase, data.logo_url), target);
          // Se agrega la marca de tiempo para que la imagen no quede en caché vieja.
          if (downloaded.status === 200) logoUri = `${downloaded.uri}?v=${Date.now()}`;
        } catch {
          logoUri = get().branding?.logoUri ?? null;
        }
      }

      const branding: Branding = {
        slug: effectiveSlug,
        organizationName: data.organization_name,
        logoUri,
        primaryColor: data.primary_color,
        accentColor: data.accent_color,
        slogan: data.slogan,
      };
      set({ branding });
      await persist(branding);
    } catch {
      // Sin red: se queda la marca guardada
    }
  },
}));
