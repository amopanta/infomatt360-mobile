/**
 * Store de conectividad con deteccion reactiva basada en eventos.
 *
 * Usa Network.addNetworkStateListener() para deteccion instantanea
 * de cambios de red (en vez de polling) y:
 *   - Actualiza estado global isOnline
 *   - Dispara syncNow() al recuperar conexion (doc 107)
 *   - Expone hook para mostrar indicador offline en cualquier pantalla
 */

import { create } from 'zustand';
import * as Network from 'expo-network';
import type { EventSubscription } from 'expo-modules-core';
import { syncNow } from '../sync/syncService';

interface ConnectivityState {
  isOnline: boolean;
  networkType: string;
  lastChecked: number;
  /** Inicia el monitoreo de red basado en eventos */
  startMonitoring: () => void;
  /** Detiene el monitoreo */
  stopMonitoring: () => void;
  /** Forzar una verificacion manual */
  checkNow: () => Promise<void>;
}

let subscription: EventSubscription | null = null;
let wasOffline = false;

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  networkType: 'unknown',
  lastChecked: 0,

  startMonitoring: () => {
    if (subscription) return;

    // Verificacion inicial
    get().checkNow();

    // Suscribirse a cambios de red via event listener (no polling)
    subscription = Network.addNetworkStateListener((state) => {
      const online = !!(state.isConnected && state.isInternetReachable);
      const netType = String(state.type ?? 'unknown');

      set({ isOnline: online, networkType: netType, lastChecked: Date.now() });

      // Recupero conexion → sincronizar inmediatamente
      if (online && wasOffline) {
        syncNow();
      }
      wasOffline = !online;
    });
  },

  stopMonitoring: () => {
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
  },

  checkNow: async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      const online = !!(state.isConnected && state.isInternetReachable);
      const netType = String(state.type ?? 'unknown');

      set({ isOnline: online, networkType: netType, lastChecked: Date.now() });

      if (online && wasOffline) {
        syncNow();
      }
      wasOffline = !online;
    } catch {
      set({ isOnline: false, lastChecked: Date.now() });
      wasOffline = true;
    }
  },
}));
