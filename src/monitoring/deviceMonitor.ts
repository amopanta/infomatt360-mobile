/**
 * Monitoreo del equipo de campo (doc 140, sección 7).
 *
 * 1. Latido: cada 5 minutos, al volver a primer plano y después de cada
 *    sincronización, la app informa al servidor cuántos registros tiene sin
 *    enviar, con error o en conflicto, cuándo sincronizó y sus últimos
 *    errores. El supervisor lo ve en la web, en "Equipos de campo".
 * 2. Recorrido: mientras la app está abierta (primer plano) y el gestor ya
 *    vio el aviso, se toma un punto GPS cada 2 minutos o al moverse 30 m.
 *
 * Funciona sin conexión: los puntos se guardan en SQLite y se envían con el
 * primer latido que logre llegar; sin red el latido simplemente se omite.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import api from '../api/client';
import { ENV } from '../config/env';
import {
  getDeviceQueueSummary,
  insertRoutePoint,
  listUnsentRoutePoints,
  markRoutePointsSent,
  purgeSentRoutePoints,
} from '../db/database';
import { useAuthStore } from '../store/authStore';
import { getDeviceFingerprint } from '../utils/deviceFingerprint';
import { getLastSuccessfulSyncAt, onSyncStatusChange } from '../sync/syncService';

const NOTICE_KEY = 'route_notice_ack';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let watcher: Location.LocationSubscription | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncSub: (() => void) | null = null;
let sending = false;
let lastSentAt = 0;
let lastPointAt = 0;

/** Nombre legible del equipo ("samsung SM-T295", "sdk_gphone64") */
function deviceName(): string {
  const c = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  const parts = [c.Brand, c.Model].filter((v) => typeof v === 'string' && v) as string[];
  return parts.join(' ') || Platform.OS;
}

// ── Aviso del recorrido ──────────────────────────────────────────────

export async function hasAcknowledgedRouteNotice(): Promise<boolean> {
  return (await SecureStore.getItemAsync(NOTICE_KEY).catch(() => null)) === '1';
}

export async function acknowledgeRouteNotice(): Promise<void> {
  await SecureStore.setItemAsync(NOTICE_KEY, '1').catch(() => {});
  await startRouteTracking();
}

// ── Latido ───────────────────────────────────────────────────────────

/** Envía el estado y los puntos pendientes. Devuelve false si no se pudo. */
export async function sendHeartbeat(): Promise<boolean> {
  const { accessToken, activeProjectId } = useAuthStore.getState();
  if (!accessToken || sending) return false;
  try {
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected || net.isInternetReachable === false) return false;
  } catch {
    return false;
  }
  sending = true;
  try {
    const summary = getDeviceQueueSummary();
    const points = listUnsentRoutePoints(1000);
    // Los puntos de otro proyecto se envían en su propio latido más adelante.
    const projectPoints = points.filter((p) => (p.project_id ?? null) === (activeProjectId ?? null));
    await api.post('/field-devices/heartbeat', {
      device_id: await getDeviceFingerprint(),
      project_id: activeProjectId,
      device_name: deviceName(),
      platform: `${Platform.OS} ${Platform.Version}`,
      app_version: ENV.APP_VERSION,
      pending_count: summary.pending,
      error_count: summary.error,
      conflict_count: summary.conflict,
      draft_count: summary.draft,
      pending_evidence_count: summary.pendingEvidence,
      oldest_pending_at: summary.oldestPendingAt,
      last_sync_at: getLastSuccessfulSyncAt(),
      recent_errors: summary.recentErrors,
      route_points: projectPoints.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_m: p.accuracy_m,
        recorded_at: p.recorded_at,
      })),
    });
    markRoutePointsSent(projectPoints.map((p) => p.id));
    purgeSentRoutePoints(7);
    lastSentAt = Date.now();
    return true;
  } catch {
    // Servidor caído o sin permiso: se reintenta en el siguiente ciclo.
    return false;
  } finally {
    sending = false;
  }
}

// ── Recorrido (solo en primer plano) ─────────────────────────────────

async function startRouteTracking(): Promise<void> {
  if (watcher || AppState.currentState !== 'active') return;
  if (!(await hasAcknowledgedRouteNotice())) return;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    const granted = status === 'granted' || (await Location.requestForegroundPermissionsAsync()).status === 'granted';
    if (!granted || watcher || AppState.currentState !== 'active') return;
    // Precisión alta = GPS: funciona sin señal celular ni Wi-Fi (la
    // "equilibrada" de Android depende de la red y en campo deja de dar puntos).
    watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: ENV.ROUTE_INTERVAL, distanceInterval: ENV.ROUTE_DISTANCE_M },
      (location) => {
        // Android puede entregar lecturas más seguidas de lo pedido.
        if (location.timestamp - lastPointAt < ENV.ROUTE_INTERVAL / 2) return;
        lastPointAt = location.timestamp;
        insertRoutePoint({
          projectId: useAuthStore.getState().activeProjectId,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null,
          recordedAt: new Date(location.timestamp).toISOString(),
        });
      },
    );
  } catch {
    // GPS apagado: no se registra recorrido, la captura sigue normal.
  }
}

function stopRouteTracking(): void {
  watcher?.remove();
  watcher = null;
}

function onAppState(state: AppStateStatus): void {
  if (state === 'active') {
    void startRouteTracking();
    void sendHeartbeat();
  } else {
    stopRouteTracking();
  }
}

// ── Ciclo ────────────────────────────────────────────────────────────

export function startDeviceMonitor(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => void sendHeartbeat(), ENV.HEARTBEAT_INTERVAL);
  appStateSub = AppState.addEventListener('change', onAppState);
  // Tras sincronizar el tablero de la web debe reflejarlo pronto (máx. 1 por minuto).
  syncSub = onSyncStatusChange((s) => {
    if (s === 'idle' && Date.now() - lastSentAt > 60_000) void sendHeartbeat();
  });
  void startRouteTracking();
  void sendHeartbeat();
}

export function stopDeviceMonitor(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  syncSub?.();
  syncSub = null;
  stopRouteTracking();
}
