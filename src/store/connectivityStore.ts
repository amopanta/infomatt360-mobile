/**
 * Store de conectividad con deteccion reactiva.
 *
 * Escucha cambios de red via polling de expo-network y:
 *   - Actualiza estado global isOnline
 *   - Dispara syncNow() al recuperar conexion (doc 107)
 *   - Expone hook para mostrar indicador offline en cualquier pantalla
 */

import { create } from 'zustand';
import * as Network from 'expo-network';
import { syncNow } from '../sync/syncService';

interface ConnectivityState {
  isOnline: boolean;
  networkType: string;
  lastChecked: number;
  /** Inicia el monitoreo periodico de red */
  startMonitoring: () => void;
  /** Detiene el monitoreo */
  stopMonitoring: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let wasOffline = false;

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  networkType: 'unknown',
  lastChecked: 0,

  startMonitoring: () => {
    if (pollTimer) return;

    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        const online = !!(state.isConnected && state.isInternetReachable);
        const netType = String(state.type ?? 'unknown');

        set({ isOnline: online, networkType: netType, lastChecked: Date.now() });

        // Recupero conexion → sincronizar inmediatamente
        if (online && wasOffline) {
          syncNow();
        }
        wasOffline = !online;
      } catch {
        set({ isOnline: false, lastChecked: Date.now() });
        wasOffline = true;
      }
    };

    // Primera verificacion inmediata
    check();
    // Polling cada 5 segundos
    pollTimer = setInterval(check, 5_000);
  },

  stopMonitoring: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
