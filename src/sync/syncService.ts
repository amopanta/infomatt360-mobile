/**
 * Servicio de sincronizacion offline → backend.
 *
 * Replica la logica de docs/106 y docs/107:
 *   - Agrupa pendientes por (project_id, template_id)
 *   - Envia un POST /runtime/session/bulk-save por grupo
 *   - Idempotency key = SHA-256 de los local_ids ordenados
 *   - Backoff exponencial: 30s → 1m → 2m → 4m → techo 5m
 *   - Limpieza automatica de sincronizados > 7 dias
 */

import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { ENV } from '../config/env';
import { bulkSaveRecords, uploadEvidence } from '../api/syncApi';
import {
  listPendingRecords,
  markRecordSynced,
  markRecordError,
  markRecordConflict,
  getRecordEvidence,
  markEvidenceUploaded,
  purgeOldSynced,
  getPendingCount,
  getConflictCount,
} from '../db/database';
import { useAuthStore } from '../store/authStore';
import type { BulkSavePayload, RecordValue } from '../types';

// ── Estado del servicio ──────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let currentInterval = ENV.SYNC_INTERVAL_BASE;
let isSyncing = false;

type SyncStatus = 'idle' | 'syncing' | 'paused_offline' | 'paused_no_session';
let status: SyncStatus = 'idle';
const listeners = new Set<(s: SyncStatus) => void>();

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((cb) => cb(s));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

// ── Control del ciclo ────────────────────────────────────────────────

export function startAutoSync(): void {
  if (syncTimer) return; // idempotente
  scheduleNext(0); // primer intento inmediato
}

export function stopAutoSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  setStatus('idle');
}

function scheduleNext(delayMs: number): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(tick, delayMs);
}

async function tick(): Promise<void> {
  syncTimer = null;

  // Sin sesion: no intentar
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    setStatus('paused_no_session');
    scheduleNext(5_000);
    return;
  }

  // Sin red: esperar
  const networkState = await Network.getNetworkStateAsync();
  if (!networkState.isConnected || !networkState.isInternetReachable) {
    setStatus('paused_offline');
    scheduleNext(5_000);
    return;
  }

  // Nada pendiente: dormir al intervalo base
  const pending = getPendingCount();
  if (pending === 0) {
    setStatus('idle');
    scheduleNext(currentInterval);
    return;
  }

  // Sincronizar
  const hadFailures = await syncNow();

  if (hadFailures) {
    currentInterval = Math.min(currentInterval * 2, ENV.SYNC_INTERVAL_MAX);
  } else {
    currentInterval = ENV.SYNC_INTERVAL_BASE;
  }

  scheduleNext(currentInterval);
}

// ── Sincronizacion principal ─────────────────────────────────────────

export async function syncNow(): Promise<boolean> {
  if (isSyncing) return false;
  isSyncing = true;
  setStatus('syncing');
  let hadFailures = false;

  try {
    // 1. Subir evidencias pendientes
    await uploadPendingEvidence();

    // 2. Obtener registros pendientes y agrupar por (project, template)
    const records = listPendingRecords();
    const groups = new Map<string, typeof records>();

    for (const rec of records) {
      const key = `${rec.project_id}:${rec.template_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }

    // 3. Enviar un bulk-save por grupo
    for (const [, groupRecords] of groups) {
      try {
        // Idempotency key = SHA-256 de los local_ids ordenados
        const sortedIds = groupRecords.map((r) => r.local_id).sort().join(',');
        const idempotencyKey = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          sortedIds,
        );

        const payload: BulkSavePayload = {
          project_id: groupRecords[0].project_id,
          template_id: groupRecords[0].template_id,
          idempotency_key: idempotencyKey,
          records: groupRecords.map((r) => ({
            participant_id: r.participant_id ?? undefined,
            status: 'submitted',
            values: JSON.parse(r.data_json) as RecordValue[],
          })),
        };

        const result = await bulkSaveRecords(payload);

        // Procesar resultados por item
        for (const item of result.results) {
          const rec = groupRecords[item.index];
          if (!rec) continue;

          if (item.status === 'created' || item.status === 'replayed') {
            markRecordSynced(rec.local_id);
          } else if (item.status === 'conflict') {
            // Conflicto detectado por el servidor: guardar ambas versiones
            markRecordConflict(
              rec.local_id,
              item.server_values ?? [],
              item.record_id ?? null,
              item.server_updated_at ?? null,
            );
            hadFailures = true;
          } else {
            markRecordError(rec.local_id, item.error ?? 'Error desconocido');
            hadFailures = true;
          }
        }
      } catch (err: any) {
        // HTTP 409 Conflict: el servidor indica conflicto a nivel de lote
        if (err?.response?.status === 409) {
          const conflictData = err.response.data;
          for (const rec of groupRecords) {
            markRecordConflict(
              rec.local_id,
              conflictData?.server_values ?? [],
              conflictData?.record_id ?? null,
              conflictData?.server_updated_at ?? null,
            );
          }
          hadFailures = true;
        } else {
          // Error de red/HTTP: todo el grupo queda pendiente
          hadFailures = true;
          for (const rec of groupRecords) {
            markRecordError(rec.local_id, err.message ?? 'Error de red');
          }
        }
      }
    }

    // 4. Limpieza automatica de sincronizados antiguos (doc 107)
    purgeOldSynced(ENV.SYNCED_RETENTION_DAYS);
  } finally {
    isSyncing = false;
    setStatus('idle');
  }

  return hadFailures;
}

// ── Subida de evidencias ─────────────────────────────────────────────

async function uploadPendingEvidence(): Promise<void> {
  const records = listPendingRecords();
  const { activeProjectId } = useAuthStore.getState();
  if (!activeProjectId) return;

  for (const rec of records) {
    const evidences = getRecordEvidence(rec.local_id);
    for (const ev of evidences) {
      if (ev.uploaded) continue;
      try {
        const result = await uploadEvidence(
          activeProjectId,
          ev.file_uri,
          ev.mime_type,
          `${ev.local_id}.${ev.mime_type.split('/')[1] ?? 'bin'}`,
        );
        markEvidenceUploaded(ev.local_id, result.url);
      } catch {
        // Se reintentara en el proximo ciclo
      }
    }
  }
}
