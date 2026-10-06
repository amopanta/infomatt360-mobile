/**
 * Store de autenticacion (Zustand).
 *
 * Tokens en memoria (no localStorage como en la web).
 * SecureStore para persistencia cifrada entre reinicios de la app.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { ProjectAssignment, UserSession } from '../types';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  session: UserSession | null;
  activeProjectId: number | null;
  activePermissions: string[];

  // Acciones
  setTokens: (access: string, refresh: string) => void;
  setSession: (session: UserSession) => void;
  selectProject: (projectId: number) => void;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  refreshToken: null,
  session: null,
  activeProjectId: null,
  activePermissions: [],

  setTokens: (access, refresh) => {
    set({ accessToken: access, refreshToken: refresh });
    // Persistir en SecureStore (cifrado del OS)
    SecureStore.setItemAsync('access_token', access).catch(() => {});
    SecureStore.setItemAsync('refresh_token', refresh).catch(() => {});
  },

  setSession: (session) => {
    set({ session });
    // Si solo tiene un proyecto, seleccionarlo automaticamente
    if (session.projects.length === 1) {
      get().selectProject(session.projects[0].id);
    }
  },

  selectProject: (projectId) => {
    const { session } = get();
    const project = session?.projects.find((p) => p.id === projectId);
    set({
      activeProjectId: projectId,
      activePermissions: project?.permissions ?? [],
    });
    SecureStore.setItemAsync('active_project_id', String(projectId)).catch(() => {});
  },

  logout: () => {
    set({
      accessToken: null,
      refreshToken: null,
      session: null,
      activeProjectId: null,
      activePermissions: [],
    });
    SecureStore.deleteItemAsync('access_token').catch(() => {});
    SecureStore.deleteItemAsync('refresh_token').catch(() => {});
    SecureStore.deleteItemAsync('active_project_id').catch(() => {});
  },

  hydrate: async () => {
    try {
      const [access, refresh, projId] = await Promise.all([
        SecureStore.getItemAsync('access_token'),
        SecureStore.getItemAsync('refresh_token'),
        SecureStore.getItemAsync('active_project_id'),
      ]);
      if (access && refresh) {
        set({
          accessToken: access,
          refreshToken: refresh,
          activeProjectId: projId ? Number(projId) : null,
        });
      }
    } catch {
      // SecureStore no disponible en algunos emuladores
    }
  },
}));
