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

    // 2. Obtener registros pendientes y agrupar por (project, template).
    // Un registro con evidencias aún sin subir espera al siguiente ciclo, para
    // no enviar al servidor rutas de archivos que solo existen en el teléfono.
    const records = listPendingRecords().filter((r) =>
      getRecordEvidence(r.local_id).every((ev) => ev.uploaded),
    );
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

        const { project_id, template_id } = groupRecords[0];
        const payload: BulkSavePayload = {
          project_id,
          template_id,
          idempotency_key: idempotencyKey,
          records: groupRecords.map((r) => ({
            project_id,
            template_id,
            participant_id: r.participant_id ?? null,
            status: 'submitted',
            values: toBackendValues(JSON.parse(r.data_json) as RecordValue[], evidenceIdsFor(r.local_id)),
          })),
        };

        const result = await bulkSaveRecords(payload);

        // Procesar resultados por item; un item sin respuesta queda en error
        // para reintentarlo (misma regla que la PWA, offlineSync.ts).
        const byIndex = new Map(result.results.map((item) => [item.index, item]));
        groupRecords.forEach((rec, index) => {
          const item = byIndex.get(index);
          if (item?.status === 'created' || item?.status === 'queued') {
            markRecordSynced(rec.local_id);
          } else if (item?.status === 'conflict') {
            // Conflicto detectado por el servidor: guardar ambas versiones
            markRecordConflict(
              rec.local_id,
              item.server_values ?? [],
              item.id ?? null,
              item.server_updated_at ?? null,
            );
            hadFailures = true;
          } else {
            markRecordError(rec.local_id, item?.error ?? 'El servidor no confirmó este registro');
            hadFailures = true;
          }
        });
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

/** Valores locales → contrato del backend (field_value_json como texto JSON).
 * Si un valor apunta a un archivo local ya subido, se envía el id del archivo
 * en el servidor, que es lo que guarda la web para campos IMAGE/FILE/SIGNATURE. */
function toBackendValues(values: RecordValue[], uploaded: Map<string, string>): { field_name: string; field_value_json: string }[] {
  const seen = new Set<string>();
  const out: { field_name: string; field_value_json: string }[] = [];
  for (const v of values) {
    const name = v.field_name || v.field_id;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const raw = typeof v.field_value_json === 'string' && uploaded.has(v.field_value_json)
      ? uploaded.get(v.field_value_json)
      : v.field_value_json;
    out.push({ field_name: name, field_value_json: JSON.stringify(raw ?? null) });
  }
  return out;
}

/** uri local → id del archivo en el servidor, para las evidencias ya subidas */
function evidenceIdsFor(recordLocalId: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of getRecordEvidence(recordLocalId)) {
    if (ev.uploaded && ev.remote_url) map.set(ev.file_uri, ev.remote_url);
  }
  return map;
}

/** Tipo de evidencia local → asset_type aceptado por POST /files/upload */
function assetTypeFor(type: string, mime: string): string {
  if (type === 'signature') return 'SIGNATURE';
  if (type === 'fingerprint') return 'FINGERPRINT';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

// ── Subida de evidencias ─────────────────────────────────────────────

async function uploadPendingEvidence(): Promise<void> {
  const records = listPendingRecords();

  for (const rec of records) {
    const evidences = getRecordEvidence(rec.local_id);
    for (const ev of evidences) {
      if (ev.uploaded) continue;
      try {
        const result = await uploadEvidence(
          rec.project_id,
          ev.file_uri,
          ev.mime_type,
          `${ev.local_id}.${ev.mime_type.split('/')[1] ?? 'bin'}`,
          assetTypeFor(ev.type, ev.mime_type),
          rec.participant_id,
        );
        markEvidenceUploaded(ev.local_id, result.id);
      } catch {
        // Se reintentara en el proximo ciclo
      }
    }
  }
}
